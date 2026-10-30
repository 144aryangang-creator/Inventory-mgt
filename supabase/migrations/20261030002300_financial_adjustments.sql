-- General commercial credit/debit adjustments linked to an issued tax invoice.
-- The original invoice remains immutable. Correction documents are built from its snapshots,
-- item identity and GST treatment, then issued atomically through an audited workflow.

create table public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  original_invoice_id uuid not null,
  adjustment_document_id uuid not null,
  adjustment_type public.financial_document_type not null
    check (adjustment_type in ('credit_note', 'debit_note')),
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  document_date date not null,
  series_code text not null
    check (series_code = upper(trim(series_code)))
    check (series_code ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (organization_id, adjustment_document_id),
  unique (id, organization_id),
  foreign key (original_invoice_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict,
  foreign key (adjustment_document_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict
);

create index financial_adjustments_original_invoice_idx
  on public.financial_adjustments (organization_id, original_invoice_id, created_at, id);

create table public.financial_adjustment_lines (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  adjustment_id uuid not null,
  original_invoice_line_id uuid not null,
  adjustment_document_id uuid not null,
  adjustment_document_line_id uuid not null,
  basis_quantity numeric(20,6) not null check (basis_quantity > 0),
  taxable_adjustment numeric(20,6) not null check (taxable_adjustment > 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, adjustment_document_id, adjustment_document_line_id),
  unique (organization_id, adjustment_id, original_invoice_line_id),
  foreign key (adjustment_id, organization_id)
    references public.financial_adjustments(id, organization_id) on delete restrict,
  foreign key (original_invoice_line_id, organization_id)
    references public.financial_document_lines(id, organization_id) on delete restrict,
  foreign key (adjustment_document_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict,
  foreign key (adjustment_document_line_id, organization_id)
    references public.financial_document_lines(id, organization_id) on delete restrict
);

create index financial_adjustment_lines_original_line_idx
  on public.financial_adjustment_lines (
    organization_id, original_invoice_line_id, created_at, adjustment_document_id
  );

alter table public.financial_adjustments enable row level security;
alter table public.financial_adjustment_lines enable row level security;

create policy financial_adjustments_select_member
on public.financial_adjustments for select to authenticated
using (app_private.is_org_member(organization_id));

create policy financial_adjustment_lines_select_member
on public.financial_adjustment_lines for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.financial_adjustments from anon, authenticated;
revoke all on public.financial_adjustment_lines from anon, authenticated;
grant select on public.financial_adjustments to authenticated;
grant select on public.financial_adjustment_lines to authenticated;

create or replace function app_private.reject_financial_adjustment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'financial adjustment linkage is immutable' using errcode = '55000';
end;
$$;

create trigger financial_adjustments_immutable
before update or delete on public.financial_adjustments
for each row execute function app_private.reject_financial_adjustment_mutation();

create trigger financial_adjustment_lines_immutable
before update or delete on public.financial_adjustment_lines
for each row execute function app_private.reject_financial_adjustment_mutation();

-- Sum every active controlled credit against one original invoice line.
-- This deliberately spans both commercial credit notes and physical-return credit notes.
create or replace function app_private.active_credited_taxable_for_invoice_line(
  p_organization_id uuid,
  p_original_invoice_line_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(x.taxable_value), 0)::numeric
  from (
    select al.taxable_adjustment as taxable_value
    from public.financial_adjustment_lines al
    join public.financial_adjustments a
      on a.id = al.adjustment_id
     and a.organization_id = al.organization_id
    join public.financial_documents d
      on d.id = a.adjustment_document_id
     and d.organization_id = a.organization_id
    where al.organization_id = p_organization_id
      and al.original_invoice_line_id = p_original_invoice_line_id
      and a.adjustment_type = 'credit_note'::public.financial_document_type
      and d.status <> 'cancelled'::public.financial_document_status

    union all

    select cl.taxable_value
    from public.sales_return_credit_allocations ra
    join public.financial_document_lines cl
      on cl.id = ra.credit_note_line_id
     and cl.organization_id = ra.organization_id
    join public.financial_documents d
      on d.id = ra.credit_note_id
     and d.organization_id = ra.organization_id
    where ra.organization_id = p_organization_id
      and ra.fulfillment_line_id = p_original_invoice_line_id
      and d.status <> 'cancelled'::public.financial_document_status
  ) x;
$$;

revoke all on function app_private.active_credited_taxable_for_invoice_line(uuid, uuid) from public;

create or replace function app_private.validate_financial_adjustment_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_adjustment public.financial_adjustments%rowtype;
  v_original_line public.financial_document_lines%rowtype;
  v_adjustment_line public.financial_document_lines%rowtype;
  v_document public.financial_documents%rowtype;
  v_existing_credit numeric(20,6);
begin
  select * into v_adjustment
  from public.financial_adjustments
  where id = new.adjustment_id
    and organization_id = new.organization_id;

  if not found
     or v_adjustment.adjustment_document_id is distinct from new.adjustment_document_id then
    raise exception 'financial adjustment header mismatch' using errcode = '23514';
  end if;

  select * into v_document
  from public.financial_documents
  where id = new.adjustment_document_id
    and organization_id = new.organization_id;

  if not found
     or v_document.document_type is distinct from v_adjustment.adjustment_type
     or v_document.linked_document_id is distinct from v_adjustment.original_invoice_id then
    raise exception 'adjustment document must link to its original tax invoice' using errcode = '23514';
  end if;

  select * into v_original_line
  from public.financial_document_lines
  where id = new.original_invoice_line_id
    and organization_id = new.organization_id
    and document_id = v_adjustment.original_invoice_id;

  if not found then
    raise exception 'original invoice line does not belong to adjustment invoice' using errcode = '23514';
  end if;

  if new.basis_quantity > v_original_line.quantity then
    raise exception 'adjustment basis quantity exceeds original invoice quantity' using errcode = '23514';
  end if;

  select * into v_adjustment_line
  from public.financial_document_lines
  where id = new.adjustment_document_line_id
    and organization_id = new.organization_id
    and document_id = new.adjustment_document_id;

  if not found
     or v_adjustment_line.taxable_value is distinct from new.taxable_adjustment then
    raise exception 'adjustment line taxable value mismatch' using errcode = '23514';
  end if;

  if v_adjustment.adjustment_type = 'credit_note'::public.financial_document_type then
    v_existing_credit := app_private.active_credited_taxable_for_invoice_line(
      new.organization_id,
      new.original_invoice_line_id
    );

    if v_existing_credit + new.taxable_adjustment > v_original_line.taxable_value then
      raise exception 'credit adjustment exceeds remaining original taxable value' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger financial_adjustment_lines_validate
before insert on public.financial_adjustment_lines
for each row execute function app_private.validate_financial_adjustment_line();

-- Extend the existing return-credit guard so commercial credits and return credits share one
-- global credit ceiling per original invoice line.
create or replace function app_private.validate_sales_return_credit_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original_invoice_id uuid;
  v_credit_linked_document_id uuid;
  v_credit_document_type public.financial_document_type;
  v_credit_line public.financial_document_lines%rowtype;
  v_original_line public.financial_document_lines%rowtype;
  v_existing_credit numeric(20,6);
begin
  select f.financial_document_id
  into v_original_invoice_id
  from public.sales_returns r
  join public.sales_fulfillments f
    on f.id = r.fulfillment_id
   and f.organization_id = r.organization_id
  where r.id = new.sales_return_id
    and r.organization_id = new.organization_id;

  if not found then
    raise exception 'sales return does not resolve to an original invoice' using errcode = '23503';
  end if;

  select d.document_type, d.linked_document_id
  into v_credit_document_type, v_credit_linked_document_id
  from public.financial_documents d
  where d.id = new.credit_note_id
    and d.organization_id = new.organization_id;

  if not found
     or v_credit_document_type <> 'credit_note'::public.financial_document_type
     or v_credit_linked_document_id is distinct from v_original_invoice_id then
    raise exception 'credit note must link to the sales return original invoice' using errcode = '23514';
  end if;

  select * into v_credit_line
  from public.financial_document_lines l
  where l.id = new.credit_note_line_id
    and l.organization_id = new.organization_id
    and l.document_id = new.credit_note_id;

  if not found then
    raise exception 'credit note line must belong to linked credit note' using errcode = '23514';
  end if;

  select * into v_original_line
  from public.financial_document_lines l
  where l.id = new.fulfillment_line_id
    and l.organization_id = new.organization_id
    and l.document_id = v_original_invoice_id;

  if not found then
    raise exception 'sales return line must resolve to original invoice line' using errcode = '23514';
  end if;

  v_existing_credit := app_private.active_credited_taxable_for_invoice_line(
    new.organization_id,
    new.fulfillment_line_id
  );

  if v_existing_credit + v_credit_line.taxable_value > v_original_line.taxable_value then
    raise exception 'combined credit exceeds original invoice line taxable value' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Authenticated clients may create tax-invoice drafts from current profiles, but credit/debit
-- notes must use controlled correction workflows that copy immutable original-invoice data.
create or replace function public.create_financial_document_draft_from_profiles(
  p_organization_id uuid,
  p_supplier_profile_id uuid,
  p_document_type public.financial_document_type,
  p_document_date date,
  p_series_code text,
  p_supply_type public.supply_type,
  p_recipient_party_id uuid,
  p_billing_address_id uuid,
  p_shipping_address_id uuid default null,
  p_recipient_tax_registration_id uuid default null,
  p_linked_document_id uuid default null,
  p_currency_code text default 'INR',
  p_place_of_supply_state_code text default null,
  p_reverse_charge boolean default false,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_bill_to_snapshot jsonb;
  v_ship_to_snapshot jsonb;
  v_shipping_address_id uuid := coalesce(p_shipping_address_id, p_billing_address_id);
  v_document_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin','staff']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  if p_document_type <> 'tax_invoice'::public.financial_document_type then
    raise exception 'credit/debit notes require a controlled adjustment workflow' using errcode = '42501';
  end if;

  v_bill_to_snapshot := app_private.party_invoice_snapshot(
    p_organization_id,
    p_recipient_party_id,
    p_billing_address_id,
    p_recipient_tax_registration_id
  );

  v_ship_to_snapshot := app_private.party_shipping_snapshot(
    p_organization_id,
    p_recipient_party_id,
    v_shipping_address_id
  );

  select public.create_financial_document_draft_from_profile(
    p_organization_id,
    p_supplier_profile_id,
    p_document_type,
    p_document_date,
    p_series_code,
    p_supply_type,
    v_bill_to_snapshot,
    p_recipient_party_id,
    p_linked_document_id,
    p_currency_code,
    p_place_of_supply_state_code,
    p_reverse_charge,
    v_ship_to_snapshot,
    p_notes
  ) into v_document_id;

  update public.financial_documents
  set billing_address_id = p_billing_address_id,
      shipping_address_id = v_shipping_address_id,
      recipient_tax_registration_id = p_recipient_tax_registration_id,
      updated_by = v_user_id
  where id = v_document_id
    and organization_id = p_organization_id
    and status = 'draft';

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'financial_document.recipient_profile_bound',
    'financial_document',
    v_document_id,
    jsonb_build_object(
      'recipient_party_id', p_recipient_party_id,
      'billing_address_id', p_billing_address_id,
      'shipping_address_id', v_shipping_address_id,
      'recipient_tax_registration_id', p_recipient_tax_registration_id
    )
  );

  return v_document_id;
end;
$$;

create or replace function public.issue_invoice_adjustment(
  p_organization_id uuid,
  p_original_invoice_id uuid,
  p_adjustment_type public.financial_document_type,
  p_lines jsonb,
  p_document_date date,
  p_series_code text,
  p_reason text,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_original public.financial_documents%rowtype;
  v_existing public.financial_adjustments%rowtype;
  v_adjustment_id uuid;
  v_adjustment_document_id uuid;
  v_adjustment_line_id uuid;
  v_document_number text;
  v_entry jsonb;
  v_original_line_id uuid;
  v_original_line public.financial_document_lines%rowtype;
  v_basis_quantity numeric(20,6);
  v_taxable_adjustment numeric(20,6);
  v_unit_price numeric(20,6);
  v_line_number integer := 0;
  v_seen_line_ids uuid[] := array[]::uuid[];
  v_tax record;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin','staff']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  if p_adjustment_type not in ('credit_note'::public.financial_document_type, 'debit_note'::public.financial_document_type) then
    raise exception 'adjustment type must be credit_note or debit_note' using errcode = '22023';
  end if;
  if p_document_date is null then
    raise exception 'adjustment document date is required' using errcode = '22023';
  end if;
  if p_series_code is null
     or char_length(trim(p_series_code)) = 0
     or char_length(trim(p_series_code)) > 8
     or upper(trim(p_series_code)) !~ '^[A-Z0-9][A-Z0-9-]{0,7}$' then
    raise exception 'invalid adjustment series' using errcode = '22023';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 or char_length(trim(p_reason)) > 240 then
    raise exception 'adjustment reason is required and must be at most 240 characters' using errcode = '22023';
  end if;
  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one adjustment line is required' using errcode = '22023';
  end if;

  select * into v_existing
  from public.financial_adjustments
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.original_invoice_id = p_original_invoice_id
       and v_existing.adjustment_type = p_adjustment_type
       and v_existing.document_date = p_document_date
       and v_existing.series_code = upper(trim(p_series_code))
       and v_existing.reason = trim(p_reason)
       and v_existing.request_payload = p_lines then
      return v_existing.adjustment_document_id;
    end if;
    raise exception 'request key already belongs to another financial adjustment' using errcode = '22023';
  end if;

  -- Lock the original invoice to serialize competing credit adjustments.
  select * into v_original
  from public.financial_documents
  where id = p_original_invoice_id
    and organization_id = p_organization_id
    and document_type = 'tax_invoice'::public.financial_document_type
    and status = 'issued'::public.financial_document_status
  for update;

  if not found then
    raise exception 'issued original tax invoice not found' using errcode = 'P0002';
  end if;

  select public.create_financial_document_draft(
    p_organization_id,
    p_adjustment_type,
    p_document_date,
    upper(trim(p_series_code)),
    v_original.supply_type,
    v_original.supplier_snapshot,
    v_original.bill_to_snapshot,
    v_original.recipient_party_id,
    v_original.id,
    v_original.currency_code,
    v_original.supplier_state_code,
    v_original.place_of_supply_state_code,
    v_original.reverse_charge,
    v_original.ship_to_snapshot,
    trim(p_reason)
  ) into v_adjustment_document_id;

  update public.financial_documents
  set supplier_profile_id = v_original.supplier_profile_id,
      billing_address_id = v_original.billing_address_id,
      shipping_address_id = v_original.shipping_address_id,
      recipient_tax_registration_id = v_original.recipient_tax_registration_id,
      updated_by = v_user_id
  where id = v_adjustment_document_id
    and organization_id = p_organization_id
    and status = 'draft';

  insert into public.financial_adjustments (
    organization_id, original_invoice_id, adjustment_document_id, adjustment_type,
    reason, document_date, series_code, request_key, request_payload, created_by
  ) values (
    p_organization_id, p_original_invoice_id, v_adjustment_document_id, p_adjustment_type,
    trim(p_reason), p_document_date, upper(trim(p_series_code)), trim(p_request_key), p_lines, v_user_id
  ) returning id into v_adjustment_id;

  for v_entry in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_original_line_id := (v_entry->>'originalLineId')::uuid;
      v_basis_quantity := (v_entry->>'basisQuantity')::numeric;
      v_taxable_adjustment := (v_entry->>'taxableAdjustment')::numeric;
    exception when others then
      raise exception 'adjustment lines require originalLineId uuid plus decimal basisQuantity and taxableAdjustment' using errcode = '22023';
    end;

    if v_original_line_id is null or v_basis_quantity is null or v_taxable_adjustment is null then
      raise exception 'adjustment lines require originalLineId uuid plus decimal basisQuantity and taxableAdjustment' using errcode = '22023';
    end if;

    if v_original_line_id = any(v_seen_line_ids) then
      raise exception 'each original invoice line may appear only once per adjustment' using errcode = '22023';
    end if;
    v_seen_line_ids := array_append(v_seen_line_ids, v_original_line_id);

    if v_basis_quantity <= 0 or v_taxable_adjustment <= 0 then
      raise exception 'adjustment quantity and taxable value must be positive' using errcode = '23514';
    end if;

    select * into v_original_line
    from public.financial_document_lines
    where id = v_original_line_id
      and organization_id = p_organization_id
      and document_id = p_original_invoice_id;

    if not found then
      raise exception 'original invoice line not found' using errcode = 'P0002';
    end if;

    if v_basis_quantity > v_original_line.quantity then
      raise exception 'adjustment basis quantity exceeds original invoice quantity' using errcode = '23514';
    end if;

    v_line_number := v_line_number + 1;
    v_unit_price := round(v_taxable_adjustment / v_basis_quantity, 6);

    insert into public.financial_document_lines (
      organization_id, document_id, line_number, item_id, item_snapshot, description,
      hsn_sac, quantity, uom, unit_price, discount_amount, taxable_value
    ) values (
      p_organization_id,
      v_adjustment_document_id,
      v_line_number,
      v_original_line.item_id,
      v_original_line.item_snapshot,
      v_original_line.description,
      v_original_line.hsn_sac,
      v_basis_quantity,
      v_original_line.uom,
      v_unit_price,
      0,
      v_taxable_adjustment
    ) returning id into v_adjustment_line_id;

    for v_tax in
      select t.component, t.rate
      from public.financial_document_line_taxes t
      where t.organization_id = p_organization_id
        and t.line_id = v_original_line.id
      order by t.component
    loop
      insert into public.financial_document_line_taxes (
        organization_id, line_id, component, rate, amount
      ) values (
        p_organization_id,
        v_adjustment_line_id,
        v_tax.component,
        v_tax.rate,
        round(v_taxable_adjustment * v_tax.rate / 100, 6)
      );
    end loop;

    insert into public.financial_adjustment_lines (
      organization_id, adjustment_id, original_invoice_line_id,
      adjustment_document_id, adjustment_document_line_id,
      basis_quantity, taxable_adjustment
    ) values (
      p_organization_id, v_adjustment_id, v_original_line_id,
      v_adjustment_document_id, v_adjustment_line_id,
      v_basis_quantity, v_taxable_adjustment
    );
  end loop;

  select public.issue_financial_document(
    p_organization_id,
    v_adjustment_document_id,
    format('invoice-adjustment:%s', v_adjustment_document_id)
  ) into v_document_number;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'financial_document.adjustment_issued',
    'financial_document',
    v_adjustment_document_id,
    jsonb_build_object(
      'original_invoice_id', p_original_invoice_id,
      'adjustment_type', p_adjustment_type,
      'document_number', v_document_number,
      'request_key', trim(p_request_key),
      'reason', trim(p_reason),
      'line_count', v_line_number
    )
  );

  return v_adjustment_document_id;
end;
$$;

revoke all on function public.issue_invoice_adjustment(
  uuid, uuid, public.financial_document_type, jsonb, date, text, text, text
) from public;
grant execute on function public.issue_invoice_adjustment(
  uuid, uuid, public.financial_document_type, jsonb, date, text, text, text
) to authenticated;

-- Once a tax invoice has active correction documents, preserve the audit chain instead of
-- cancelling the original underneath them. Cancel corrections first if they were created in error.
create or replace function app_private.block_invoice_cancellation_with_active_adjustments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.document_type = 'tax_invoice'::public.financial_document_type
     and old.status = 'issued'::public.financial_document_status
     and new.status = 'cancelled'::public.financial_document_status
     and exists (
       select 1
       from public.financial_documents correction
       where correction.organization_id = old.organization_id
         and correction.linked_document_id = old.id
         and correction.document_type in ('credit_note', 'debit_note')
         and correction.status <> 'cancelled'::public.financial_document_status
     ) then
    raise exception 'original invoice cannot be cancelled while active credit/debit notes exist' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger financial_documents_block_cancel_with_active_adjustments
before update on public.financial_documents
for each row execute function app_private.block_invoice_cancellation_with_active_adjustments();
