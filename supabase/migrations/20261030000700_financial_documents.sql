-- Financial document core: tax invoices, credit/debit notes, numbering, tax components.
-- Issued documents are immutable snapshots. Corrections use credit/debit notes or cancellation.

create type public.financial_document_type as enum ('tax_invoice', 'credit_note', 'debit_note');
create type public.financial_document_status as enum ('draft', 'issued', 'cancelled');
create type public.supply_type as enum ('intra_state', 'inter_state', 'export', 'sez');
create type public.tax_component as enum ('CGST', 'SGST', 'UTGST', 'IGST', 'CESS');

alter table public.organizations
  add column financial_year_start_month smallint not null default 4
  check (financial_year_start_month between 1 and 12);

create table public.financial_document_sequences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_type public.financial_document_type not null,
  financial_year_start_year smallint not null check (financial_year_start_year between 2000 and 9999),
  series_code text not null
    check (series_code = upper(trim(series_code)))
    check (series_code ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'),
  next_number bigint not null default 1 check (next_number between 1 and 9999999),
  updated_at timestamptz not null default now(),
  primary key (organization_id, document_type, financial_year_start_year, series_code)
);

create table public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_type public.financial_document_type not null,
  status public.financial_document_status not null default 'draft',
  document_date date not null,
  financial_year_start_year smallint check (financial_year_start_year between 2000 and 9999),
  series_code text not null
    check (series_code = upper(trim(series_code)))
    check (series_code ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'),
  document_number text
    check (document_number is null or char_length(document_number) between 1 and 16)
    check (document_number is null or document_number ~ '^[A-Z0-9/-]+$'),
  issue_request_key text check (issue_request_key is null or char_length(issue_request_key) between 1 and 128),
  recipient_party_id uuid,
  linked_document_id uuid,
  currency_code varchar(3) not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  supply_type public.supply_type not null,
  supplier_state_code text check (supplier_state_code is null or char_length(trim(supplier_state_code)) between 1 and 20),
  place_of_supply_state_code text check (place_of_supply_state_code is null or char_length(trim(place_of_supply_state_code)) between 1 and 20),
  reverse_charge boolean not null default false,
  supplier_snapshot jsonb not null check (jsonb_typeof(supplier_snapshot) = 'object'),
  bill_to_snapshot jsonb not null check (jsonb_typeof(bill_to_snapshot) = 'object'),
  ship_to_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(ship_to_snapshot) = 'object'),
  subtotal numeric(20,6) not null default 0 check (subtotal >= 0),
  discount_total numeric(20,6) not null default 0 check (discount_total >= 0),
  taxable_total numeric(20,6) not null default 0 check (taxable_total >= 0),
  cgst_total numeric(20,6) not null default 0 check (cgst_total >= 0),
  sgst_total numeric(20,6) not null default 0 check (sgst_total >= 0),
  utgst_total numeric(20,6) not null default 0 check (utgst_total >= 0),
  igst_total numeric(20,6) not null default 0 check (igst_total >= 0),
  cess_total numeric(20,6) not null default 0 check (cess_total >= 0),
  round_off numeric(20,6) not null default 0,
  grand_total numeric(20,6) not null default 0 check (grand_total >= 0),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz,
  issued_by uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  cancellation_reason text check (cancellation_reason is null or char_length(trim(cancellation_reason)) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (recipient_party_id, organization_id)
    references public.parties(id, organization_id) on delete restrict,
  foreign key (linked_document_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict,
  check (
    (document_type = 'tax_invoice' and linked_document_id is null)
    or
    (document_type in ('credit_note', 'debit_note') and linked_document_id is not null)
  ),
  check (
    (status = 'draft'
      and document_number is null
      and financial_year_start_year is null
      and issue_request_key is null
      and issued_at is null
      and issued_by is null
      and cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null)
    or
    (status = 'issued'
      and document_number is not null
      and financial_year_start_year is not null
      and issue_request_key is not null
      and issued_at is not null
      and issued_by is not null
      and cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null)
    or
    (status = 'cancelled'
      and document_number is not null
      and financial_year_start_year is not null
      and issue_request_key is not null
      and issued_at is not null
      and issued_by is not null
      and cancelled_at is not null
      and cancelled_by is not null
      and cancellation_reason is not null)
  )
);

create unique index financial_documents_number_uq
  on public.financial_documents (
    organization_id, document_type, financial_year_start_year, document_number
  ) where document_number is not null;

create unique index financial_documents_issue_request_key_uq
  on public.financial_documents (organization_id, issue_request_key)
  where issue_request_key is not null;

create index financial_documents_org_date_idx
  on public.financial_documents (organization_id, document_date desc, id);
create index financial_documents_party_idx
  on public.financial_documents (organization_id, recipient_party_id, document_date desc);

create table public.financial_document_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_id uuid not null,
  line_number integer not null check (line_number between 1 and 9999),
  item_id uuid,
  item_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(item_snapshot) = 'object'),
  description text not null check (char_length(trim(description)) between 1 and 500),
  hsn_sac text check (hsn_sac is null or char_length(trim(hsn_sac)) between 1 and 16),
  quantity numeric(20,6) not null check (quantity > 0),
  uom text not null check (char_length(trim(uom)) between 1 and 20),
  unit_price numeric(20,6) not null check (unit_price >= 0),
  discount_amount numeric(20,6) not null default 0 check (discount_amount >= 0),
  taxable_value numeric(20,6) not null check (taxable_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, document_id, line_number),
  unique (id, organization_id),
  foreign key (document_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict,
  foreign key (item_id, organization_id)
    references public.items(id, organization_id) on delete restrict
);

create index financial_document_lines_document_idx
  on public.financial_document_lines (organization_id, document_id, line_number);

create table public.financial_document_line_taxes (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  line_id uuid not null,
  component public.tax_component not null,
  rate numeric(9,4) not null check (rate between 0 and 100),
  amount numeric(20,6) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, line_id, component),
  foreign key (line_id, organization_id)
    references public.financial_document_lines(id, organization_id) on delete restrict
);

create or replace function app_private.financial_year_start_year(
  target_organization_id uuid,
  target_date date
)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month smallint;
begin
  select financial_year_start_month into v_month
  from public.organizations
  where id = target_organization_id;

  if not found then
    raise exception 'organization not found' using errcode = '23503';
  end if;

  if extract(month from target_date)::int >= v_month then
    return extract(year from target_date)::smallint;
  end if;

  return (extract(year from target_date)::int - 1)::smallint;
end;
$$;

create or replace function app_private.ensure_document_is_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_organization_id uuid;
  v_status public.financial_document_status;
begin
  if tg_table_name = 'financial_document_lines' then
    v_document_id := coalesce(new.document_id, old.document_id);
    v_organization_id := coalesce(new.organization_id, old.organization_id);
  else
    select l.document_id, l.organization_id
      into v_document_id, v_organization_id
    from public.financial_document_lines l
    where l.id = coalesce(new.line_id, old.line_id)
      and l.organization_id = coalesce(new.organization_id, old.organization_id);
  end if;

  select d.status into v_status
  from public.financial_documents d
  where d.id = v_document_id
    and d.organization_id = v_organization_id;

  if v_status is distinct from 'draft'::public.financial_document_status then
    raise exception 'issued financial document detail is immutable' using errcode = '55000';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function app_private.protect_financial_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if old.status = 'issued'
     and new.status = 'cancelled'
     and (to_jsonb(new) - array['status','cancelled_at','cancelled_by','cancellation_reason','updated_at'])
       = (to_jsonb(old) - array['status','cancelled_at','cancelled_by','cancellation_reason','updated_at']) then
    return new;
  end if;

  raise exception 'issued financial document is immutable; use credit/debit note or cancellation'
    using errcode = '55000';
end;
$$;

create trigger financial_documents_set_updated_at
before update on public.financial_documents
for each row execute function app_private.set_updated_at();

create trigger financial_document_lines_set_updated_at
before update on public.financial_document_lines
for each row execute function app_private.set_updated_at();

create trigger financial_documents_organization_immutable
before update on public.financial_documents
for each row execute function app_private.reject_organization_reassignment();

create trigger financial_document_lines_organization_immutable
before update on public.financial_document_lines
for each row execute function app_private.reject_organization_reassignment();

create trigger financial_documents_protect_issued
before update or delete on public.financial_documents
for each row execute function app_private.protect_financial_document();

create trigger financial_document_lines_draft_only
before insert or update or delete on public.financial_document_lines
for each row execute function app_private.ensure_document_is_draft();

create trigger financial_document_line_taxes_draft_only
before insert or update or delete on public.financial_document_line_taxes
for each row execute function app_private.ensure_document_is_draft();

alter table public.financial_document_sequences enable row level security;
alter table public.financial_documents enable row level security;
alter table public.financial_document_lines enable row level security;
alter table public.financial_document_line_taxes enable row level security;

create policy financial_documents_select_member
on public.financial_documents for select to authenticated
using (app_private.is_org_member(organization_id));

create policy financial_document_lines_select_member
on public.financial_document_lines for select to authenticated
using (app_private.is_org_member(organization_id));

create policy financial_document_line_taxes_select_member
on public.financial_document_line_taxes for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.financial_document_sequences from anon, authenticated;
revoke all on public.financial_documents from anon, authenticated;
revoke all on public.financial_document_lines from anon, authenticated;
revoke all on public.financial_document_line_taxes from anon, authenticated;

grant select on public.financial_documents to authenticated;
grant select on public.financial_document_lines to authenticated;
grant select on public.financial_document_line_taxes to authenticated;

create or replace function public.create_financial_document_draft(
  p_organization_id uuid,
  p_document_type public.financial_document_type,
  p_document_date date,
  p_series_code text,
  p_supply_type public.supply_type,
  p_supplier_snapshot jsonb,
  p_bill_to_snapshot jsonb,
  p_recipient_party_id uuid default null,
  p_linked_document_id uuid default null,
  p_currency_code text default 'INR',
  p_supplier_state_code text default null,
  p_place_of_supply_state_code text default null,
  p_reverse_charge boolean default false,
  p_ship_to_snapshot jsonb default '{}'::jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
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

  if p_supplier_snapshot is null or jsonb_typeof(p_supplier_snapshot) <> 'object'
     or p_bill_to_snapshot is null or jsonb_typeof(p_bill_to_snapshot) <> 'object'
     or p_ship_to_snapshot is null or jsonb_typeof(p_ship_to_snapshot) <> 'object' then
    raise exception 'document snapshots must be JSON objects' using errcode = '22023';
  end if;

  if p_recipient_party_id is not null then
    perform 1 from public.parties
    where id = p_recipient_party_id
      and organization_id = p_organization_id
      and status = 'active';
    if not found then
      raise exception 'active recipient party not found' using errcode = '23503';
    end if;
  end if;

  if p_document_type = 'tax_invoice' and p_linked_document_id is not null then
    raise exception 'tax invoice cannot link to another financial document' using errcode = '22023';
  end if;

  if p_document_type in ('credit_note','debit_note') then
    perform 1 from public.financial_documents
    where id = p_linked_document_id
      and organization_id = p_organization_id
      and document_type = 'tax_invoice'
      and status in ('issued','cancelled');
    if not found then
      raise exception 'credit/debit note requires an issued tax invoice in the same organization' using errcode = '23503';
    end if;
  end if;

  insert into public.financial_documents (
    organization_id, document_type, document_date, series_code, recipient_party_id,
    linked_document_id, currency_code, supply_type, supplier_state_code,
    place_of_supply_state_code, reverse_charge, supplier_snapshot, bill_to_snapshot,
    ship_to_snapshot, notes, created_by, updated_by
  ) values (
    p_organization_id, p_document_type, p_document_date, upper(trim(p_series_code)), p_recipient_party_id,
    p_linked_document_id, upper(trim(p_currency_code)), p_supply_type, nullif(trim(p_supplier_state_code), ''),
    nullif(trim(p_place_of_supply_state_code), ''), p_reverse_charge, p_supplier_snapshot, p_bill_to_snapshot,
    p_ship_to_snapshot, nullif(trim(p_notes), ''), v_user_id, v_user_id
  ) returning id into v_document_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'financial_document.draft_created', 'financial_document', v_document_id,
    jsonb_build_object('document_type', p_document_type, 'series_code', upper(trim(p_series_code)))
  );

  return v_document_id;
end;
$$;

create or replace function public.upsert_financial_document_line(
  p_organization_id uuid,
  p_document_id uuid,
  p_line_number integer,
  p_description text,
  p_quantity numeric,
  p_uom text,
  p_unit_price numeric,
  p_taxable_value numeric,
  p_item_id uuid default null,
  p_item_snapshot jsonb default '{}'::jsonb,
  p_hsn_sac text default null,
  p_discount_amount numeric default 0,
  p_taxes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_line_id uuid;
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

  perform 1 from public.financial_documents
  where id = p_document_id
    and organization_id = p_organization_id
    and status = 'draft'
  for update;
  if not found then
    raise exception 'editable draft financial document not found' using errcode = 'P0002';
  end if;

  if p_item_snapshot is null or jsonb_typeof(p_item_snapshot) <> 'object' then
    raise exception 'item_snapshot must be a JSON object' using errcode = '22023';
  end if;

  if p_taxes is null or jsonb_typeof(p_taxes) <> 'array' then
    raise exception 'taxes must be a JSON array' using errcode = '22023';
  end if;

  if p_item_id is not null then
    perform 1 from public.items
    where id = p_item_id and organization_id = p_organization_id and is_active;
    if not found then
      raise exception 'active item not found in organization' using errcode = '23503';
    end if;
  end if;

  insert into public.financial_document_lines (
    organization_id, document_id, line_number, item_id, item_snapshot, description,
    hsn_sac, quantity, uom, unit_price, discount_amount, taxable_value
  ) values (
    p_organization_id, p_document_id, p_line_number, p_item_id, p_item_snapshot, trim(p_description),
    nullif(trim(p_hsn_sac), ''), p_quantity, trim(p_uom), p_unit_price, p_discount_amount, p_taxable_value
  )
  on conflict (organization_id, document_id, line_number) do update set
    item_id = excluded.item_id,
    item_snapshot = excluded.item_snapshot,
    description = excluded.description,
    hsn_sac = excluded.hsn_sac,
    quantity = excluded.quantity,
    uom = excluded.uom,
    unit_price = excluded.unit_price,
    discount_amount = excluded.discount_amount,
    taxable_value = excluded.taxable_value
  returning id into v_line_id;

  delete from public.financial_document_line_taxes
  where organization_id = p_organization_id and line_id = v_line_id;

  for v_tax in
    select * from jsonb_to_recordset(p_taxes) as x(component text, rate numeric, amount numeric)
  loop
    insert into public.financial_document_line_taxes (
      organization_id, line_id, component, rate, amount
    ) values (
      p_organization_id, v_line_id, upper(trim(v_tax.component))::public.tax_component,
      v_tax.rate, v_tax.amount
    );
  end loop;

  update public.financial_documents
  set updated_by = v_user_id
  where id = p_document_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'financial_document.line_upserted', 'financial_document', p_document_id,
    jsonb_build_object('line_number', p_line_number)
  );

  return v_line_id;
end;
$$;

create or replace function public.remove_financial_document_line(
  p_organization_id uuid,
  p_document_id uuid,
  p_line_number integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_line_id uuid;
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

  select l.id into v_line_id
  from public.financial_document_lines l
  join public.financial_documents d
    on d.id = l.document_id and d.organization_id = l.organization_id
  where l.organization_id = p_organization_id
    and l.document_id = p_document_id
    and l.line_number = p_line_number
    and d.status = 'draft'
  for update of d;

  if not found then
    raise exception 'editable draft line not found' using errcode = 'P0002';
  end if;

  delete from public.financial_document_line_taxes
  where organization_id = p_organization_id and line_id = v_line_id;

  delete from public.financial_document_lines
  where organization_id = p_organization_id and id = v_line_id;

  update public.financial_documents
  set updated_by = v_user_id
  where id = p_document_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'financial_document.line_removed', 'financial_document', p_document_id,
    jsonb_build_object('line_number', p_line_number)
  );
end;
$$;

create or replace function public.issue_financial_document(
  p_organization_id uuid,
  p_document_id uuid,
  p_request_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_doc public.financial_documents%rowtype;
  v_financial_year smallint;
  v_sequence bigint;
  v_number text;
  v_line_count bigint;
  v_subtotal numeric(20,6);
  v_discount numeric(20,6);
  v_taxable numeric(20,6);
  v_cgst numeric(20,6);
  v_sgst numeric(20,6);
  v_utgst numeric(20,6);
  v_igst numeric(20,6);
  v_cess numeric(20,6);
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

  if p_request_key is null or char_length(trim(p_request_key)) = 0 then
    raise exception 'request key is required for issuing' using errcode = '22023';
  end if;

  select * into v_doc
  from public.financial_documents
  where id = p_document_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'financial document not found' using errcode = 'P0002';
  end if;

  if v_doc.status in ('issued','cancelled') then
    if v_doc.issue_request_key = trim(p_request_key) then
      return v_doc.document_number;
    end if;
    raise exception 'financial document already issued with another request key' using errcode = '22023';
  end if;

  select count(*) into v_line_count
  from public.financial_document_lines
  where organization_id = p_organization_id and document_id = p_document_id;

  if v_line_count = 0 then
    raise exception 'financial document requires at least one line' using errcode = '23514';
  end if;

  if v_doc.supply_type = 'intra_state' and exists (
    select 1
    from public.financial_document_line_taxes t
    join public.financial_document_lines l
      on l.id = t.line_id and l.organization_id = t.organization_id
    where l.organization_id = p_organization_id
      and l.document_id = p_document_id
      and t.component = 'IGST'
      and t.amount <> 0
  ) then
    raise exception 'intra-state document cannot contain IGST' using errcode = '23514';
  end if;

  if v_doc.supply_type in ('inter_state','export','sez') and exists (
    select 1
    from public.financial_document_line_taxes t
    join public.financial_document_lines l
      on l.id = t.line_id and l.organization_id = t.organization_id
    where l.organization_id = p_organization_id
      and l.document_id = p_document_id
      and t.component in ('CGST','SGST','UTGST')
      and t.amount <> 0
  ) then
    raise exception 'inter-state/export/SEZ document cannot contain CGST, SGST or UTGST' using errcode = '23514';
  end if;

  select
    coalesce(sum(l.taxable_value + l.discount_amount), 0),
    coalesce(sum(l.discount_amount), 0),
    coalesce(sum(l.taxable_value), 0)
  into v_subtotal, v_discount, v_taxable
  from public.financial_document_lines l
  where l.organization_id = p_organization_id and l.document_id = p_document_id;

  select
    coalesce(sum(t.amount) filter (where t.component = 'CGST'), 0),
    coalesce(sum(t.amount) filter (where t.component = 'SGST'), 0),
    coalesce(sum(t.amount) filter (where t.component = 'UTGST'), 0),
    coalesce(sum(t.amount) filter (where t.component = 'IGST'), 0),
    coalesce(sum(t.amount) filter (where t.component = 'CESS'), 0)
  into v_cgst, v_sgst, v_utgst, v_igst, v_cess
  from public.financial_document_line_taxes t
  join public.financial_document_lines l
    on l.id = t.line_id and l.organization_id = t.organization_id
  where l.organization_id = p_organization_id and l.document_id = p_document_id;

  v_financial_year := app_private.financial_year_start_year(p_organization_id, v_doc.document_date);

  insert into public.financial_document_sequences (
    organization_id, document_type, financial_year_start_year, series_code, next_number
  ) values (
    p_organization_id, v_doc.document_type, v_financial_year, v_doc.series_code, 1
  ) on conflict do nothing;

  select next_number into v_sequence
  from public.financial_document_sequences
  where organization_id = p_organization_id
    and document_type = v_doc.document_type
    and financial_year_start_year = v_financial_year
    and series_code = v_doc.series_code
  for update;

  v_number := v_doc.series_code || '/' || v_sequence::text;

  if char_length(v_number) > 16 then
    raise exception 'generated document number exceeds 16 characters' using errcode = '22023';
  end if;

  update public.financial_document_sequences
  set next_number = next_number + 1, updated_at = now()
  where organization_id = p_organization_id
    and document_type = v_doc.document_type
    and financial_year_start_year = v_financial_year
    and series_code = v_doc.series_code;

  update public.financial_documents
  set status = 'issued',
      financial_year_start_year = v_financial_year,
      document_number = v_number,
      issue_request_key = trim(p_request_key),
      subtotal = v_subtotal,
      discount_total = v_discount,
      taxable_total = v_taxable,
      cgst_total = v_cgst,
      sgst_total = v_sgst,
      utgst_total = v_utgst,
      igst_total = v_igst,
      cess_total = v_cess,
      grand_total = v_taxable + v_cgst + v_sgst + v_utgst + v_igst + v_cess + v_doc.round_off,
      updated_by = v_user_id,
      issued_at = now(),
      issued_by = v_user_id
  where id = p_document_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'financial_document.issued', 'financial_document', p_document_id,
    jsonb_build_object('document_number', v_number, 'financial_year_start_year', v_financial_year)
  );

  return v_number;
end;
$$;

create or replace function public.cancel_financial_document(
  p_organization_id uuid,
  p_document_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
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

  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'cancellation reason is required' using errcode = '22023';
  end if;

  update public.financial_documents
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_user_id,
      cancellation_reason = trim(p_reason),
      updated_by = v_user_id
  where id = p_document_id
    and organization_id = p_organization_id
    and status = 'issued';

  if not found then
    raise exception 'issued financial document not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'financial_document.cancelled', 'financial_document', p_document_id,
    jsonb_build_object('reason', trim(p_reason))
  );
end;
$$;

revoke all on function public.create_financial_document_draft(
  uuid, public.financial_document_type, date, text, public.supply_type, jsonb, jsonb,
  uuid, uuid, text, text, text, boolean, jsonb, text
) from public;
revoke all on function public.upsert_financial_document_line(
  uuid, uuid, integer, text, numeric, text, numeric, numeric, uuid, jsonb, text, numeric, jsonb
) from public;
revoke all on function public.remove_financial_document_line(uuid, uuid, integer) from public;
revoke all on function public.issue_financial_document(uuid, uuid, text) from public;
revoke all on function public.cancel_financial_document(uuid, uuid, text) from public;

grant execute on function public.create_financial_document_draft(
  uuid, public.financial_document_type, date, text, public.supply_type, jsonb, jsonb,
  uuid, uuid, text, text, text, boolean, jsonb, text
) to authenticated;
grant execute on function public.upsert_financial_document_line(
  uuid, uuid, integer, text, numeric, text, numeric, numeric, uuid, jsonb, text, numeric, jsonb
) to authenticated;
grant execute on function public.remove_financial_document_line(uuid, uuid, integer) to authenticated;
grant execute on function public.issue_financial_document(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_financial_document(uuid, uuid, text) to authenticated;
