-- Financial correction linkage for physical sales returns.
-- Credit notes are built entirely from the original issued invoice's immutable snapshots,
-- prices, discounts and tax rates. Return and financial ledgers remain separate and append-only.

create table public.sales_return_credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sales_return_id uuid not null,
  credit_note_id uuid not null,
  document_date date not null,
  series_code text not null
    check (series_code = upper(trim(series_code)))
    check (series_code ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (organization_id, credit_note_id),
  unique (id, organization_id),
  foreign key (sales_return_id, organization_id)
    references public.sales_returns(id, organization_id) on delete restrict,
  foreign key (credit_note_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict
);

create index sales_return_credit_notes_org_return_idx
  on public.sales_return_credit_notes (organization_id, sales_return_id, created_at, id);

create table public.sales_return_credit_allocations (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sales_return_credit_note_id uuid not null,
  sales_return_id uuid not null,
  fulfillment_line_id uuid not null,
  credit_note_id uuid not null,
  credit_note_line_id uuid not null,
  quantity numeric(20,6) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, credit_note_id, credit_note_line_id),
  unique (organization_id, sales_return_credit_note_id, fulfillment_line_id),
  foreign key (sales_return_credit_note_id, organization_id)
    references public.sales_return_credit_notes(id, organization_id) on delete restrict,
  foreign key (organization_id, sales_return_id, fulfillment_line_id)
    references public.sales_return_lines(organization_id, return_id, fulfillment_line_id) on delete restrict,
  foreign key (credit_note_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict,
  foreign key (credit_note_line_id, organization_id)
    references public.financial_document_lines(id, organization_id) on delete restrict
);

create index sales_return_credit_allocations_source_idx
  on public.sales_return_credit_allocations (
    organization_id, sales_return_id, fulfillment_line_id, created_at, credit_note_id
  );

alter table public.sales_return_credit_notes enable row level security;
alter table public.sales_return_credit_allocations enable row level security;

create policy sales_return_credit_notes_select_member
on public.sales_return_credit_notes for select to authenticated
using (app_private.is_org_member(organization_id));

create policy sales_return_credit_allocations_select_member
on public.sales_return_credit_allocations for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.sales_return_credit_notes from anon, authenticated;
revoke all on public.sales_return_credit_allocations from anon, authenticated;
grant select on public.sales_return_credit_notes to authenticated;
grant select on public.sales_return_credit_allocations to authenticated;

create or replace function app_private.reject_sales_return_credit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sales return credit linkage is immutable' using errcode = '55000';
end;
$$;

create trigger sales_return_credit_notes_immutable
before update or delete on public.sales_return_credit_notes
for each row execute function app_private.reject_sales_return_credit_mutation();

create trigger sales_return_credit_allocations_immutable
before update or delete on public.sales_return_credit_allocations
for each row execute function app_private.reject_sales_return_credit_mutation();

create or replace function app_private.validate_sales_return_credit_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original_invoice_id uuid;
  v_credit_linked_document_id uuid;
  v_credit_document_type public.financial_document_type;
  v_credit_line_document_id uuid;
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

  select l.document_id
  into v_credit_line_document_id
  from public.financial_document_lines l
  where l.id = new.credit_note_line_id
    and l.organization_id = new.organization_id;

  if not found or v_credit_line_document_id is distinct from new.credit_note_id then
    raise exception 'credit note line must belong to linked credit note' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger sales_return_credit_allocations_validate
before insert on public.sales_return_credit_allocations
for each row execute function app_private.validate_sales_return_credit_allocation();

create or replace function public.issue_sales_return_credit_note(
  p_organization_id uuid,
  p_sales_return_id uuid,
  p_lines jsonb,
  p_document_date date,
  p_series_code text,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_return public.sales_returns%rowtype;
  v_fulfillment public.sales_fulfillments%rowtype;
  v_original public.financial_documents%rowtype;
  v_existing public.sales_return_credit_notes%rowtype;
  v_link_id uuid;
  v_credit_note_id uuid;
  v_credit_note_line_id uuid;
  v_document_number text;
  v_entry jsonb;
  v_source_return_line record;
  v_original_line public.financial_document_lines%rowtype;
  v_quantity numeric(20,6);
  v_credited numeric(20,6);
  v_gross numeric(20,6);
  v_taxable numeric(20,6);
  v_discount numeric(20,6);
  v_line_number integer := 0;
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

  if p_document_date is null then
    raise exception 'credit note date is required' using errcode = '22023';
  end if;
  if p_series_code is null
     or char_length(trim(p_series_code)) = 0
     or char_length(trim(p_series_code)) > 8
     or upper(trim(p_series_code)) !~ '^[A-Z0-9][A-Z0-9-]{0,7}$' then
    raise exception 'invalid credit note series' using errcode = '22023';
  end if;
  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one credit line is required' using errcode = '22023';
  end if;

  select * into v_return
  from public.sales_returns
  where id = p_sales_return_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'sales return not found' using errcode = 'P0002';
  end if;

  select * into v_fulfillment
  from public.sales_fulfillments
  where id = v_return.fulfillment_id
    and organization_id = p_organization_id
  for share;

  if not found then
    raise exception 'sales fulfillment not found' using errcode = 'P0002';
  end if;

  select * into v_original
  from public.financial_documents
  where id = v_fulfillment.financial_document_id
    and organization_id = p_organization_id
    and document_type = 'tax_invoice'
    and status in ('issued','cancelled')
  for share;

  if not found then
    raise exception 'original tax invoice not found' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.sales_return_credit_notes
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.sales_return_id = p_sales_return_id
       and v_existing.document_date = p_document_date
       and v_existing.series_code = upper(trim(p_series_code))
       and v_existing.request_payload = p_lines then
      return v_existing.credit_note_id;
    end if;
    raise exception 'request key already belongs to another sales return credit note' using errcode = '22023';
  end if;

  -- Create the correction document from the immutable original invoice snapshots.
  select public.create_financial_document_draft(
    p_organization_id,
    'credit_note'::public.financial_document_type,
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
    format('Credit for sales return %s', p_sales_return_id)
  ) into v_credit_note_id;

  -- Preserve the original profile references for traceability without re-reading current master data.
  update public.financial_documents
  set supplier_profile_id = v_original.supplier_profile_id,
      billing_address_id = v_original.billing_address_id,
      shipping_address_id = v_original.shipping_address_id,
      recipient_tax_registration_id = v_original.recipient_tax_registration_id,
      updated_by = v_user_id
  where id = v_credit_note_id
    and organization_id = p_organization_id
    and status = 'draft';

  insert into public.sales_return_credit_notes (
    organization_id, sales_return_id, credit_note_id, document_date, series_code,
    request_key, request_payload, created_by
  ) values (
    p_organization_id, p_sales_return_id, v_credit_note_id, p_document_date,
    upper(trim(p_series_code)), trim(p_request_key), p_lines, v_user_id
  ) returning id into v_link_id;

  for v_entry in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_source_return_line := null;
      v_quantity := (v_entry->>'quantity')::numeric;
    exception when others then
      raise exception 'credit lines require fulfillmentLineId uuid and decimal quantity' using errcode = '22023';
    end;

    if v_entry->>'fulfillmentLineId' is null then
      raise exception 'credit lines require fulfillmentLineId uuid and decimal quantity' using errcode = '22023';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'credit quantity must be positive' using errcode = '23514';
    end if;

    select rl.fulfillment_line_id, rl.item_id, rl.quantity
    into v_source_return_line
    from public.sales_return_lines rl
    where rl.organization_id = p_organization_id
      and rl.return_id = p_sales_return_id
      and rl.fulfillment_line_id = (v_entry->>'fulfillmentLineId')::uuid
    for update;

    if not found then
      raise exception 'sales return line not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(a.quantity), 0)
    into v_credited
    from public.sales_return_credit_allocations a
    join public.financial_documents d
      on d.id = a.credit_note_id
     and d.organization_id = a.organization_id
    where a.organization_id = p_organization_id
      and a.sales_return_id = p_sales_return_id
      and a.fulfillment_line_id = v_source_return_line.fulfillment_line_id
      and d.status <> 'cancelled';

    if v_quantity > v_source_return_line.quantity - v_credited then
      raise exception 'credit quantity exceeds uncredited returned quantity' using errcode = '23514';
    end if;

    select l.* into v_original_line
    from public.financial_document_lines l
    where l.id = v_source_return_line.fulfillment_line_id
      and l.organization_id = p_organization_id
      and l.document_id = v_original.id;

    if not found then
      raise exception 'original invoice line not found' using errcode = 'P0002';
    end if;

    v_line_number := v_line_number + 1;
    v_gross := round(v_quantity * v_original_line.unit_price, 6);
    v_taxable := round(v_original_line.taxable_value * v_quantity / v_original_line.quantity, 6);
    v_discount := round(v_gross - v_taxable, 6);

    if v_discount < 0 then
      raise exception 'derived credit discount is invalid' using errcode = '23514';
    end if;

    insert into public.financial_document_lines (
      organization_id, document_id, line_number, item_id, item_snapshot, description,
      hsn_sac, quantity, uom, unit_price, discount_amount, taxable_value
    ) values (
      p_organization_id, v_credit_note_id, v_line_number, v_original_line.item_id,
      v_original_line.item_snapshot, v_original_line.description, v_original_line.hsn_sac,
      v_quantity, v_original_line.uom, v_original_line.unit_price, v_discount, v_taxable
    ) returning id into v_credit_note_line_id;

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
        v_credit_note_line_id,
        v_tax.component,
        v_tax.rate,
        round(v_taxable * v_tax.rate / 100, 6)
      );
    end loop;

    insert into public.sales_return_credit_allocations (
      organization_id, sales_return_credit_note_id, sales_return_id,
      fulfillment_line_id, credit_note_id, credit_note_line_id, quantity
    ) values (
      p_organization_id, v_link_id, p_sales_return_id,
      v_source_return_line.fulfillment_line_id, v_credit_note_id, v_credit_note_line_id, v_quantity
    );
  end loop;

  select public.issue_financial_document(
    p_organization_id,
    v_credit_note_id,
    format('sales-return-credit:%s', v_credit_note_id)
  ) into v_document_number;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'sales_return.credit_note_issued',
    'sales_return',
    p_sales_return_id,
    jsonb_build_object(
      'credit_note_id', v_credit_note_id,
      'document_number', v_document_number,
      'request_key', trim(p_request_key),
      'line_count', v_line_number
    )
  );

  return v_credit_note_id;
end;
$$;

revoke all on function public.issue_sales_return_credit_note(uuid, uuid, jsonb, date, text, text) from public;
grant execute on function public.issue_sales_return_credit_note(uuid, uuid, jsonb, date, text, text) to authenticated;
