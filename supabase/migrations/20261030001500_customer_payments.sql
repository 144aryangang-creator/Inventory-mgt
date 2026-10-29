-- Immutable customer receipts and invoice allocations.
-- V1 intentionally has no edit/delete/unallocate path; corrections will use explicit reversal records later.

create type public.payment_method as enum ('cash', 'bank_transfer', 'card', 'upi', 'cheque', 'other');

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_party_id uuid not null,
  payment_date date not null,
  amount numeric(20,6) not null check (amount > 0),
  currency_code varchar(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  method public.payment_method not null,
  reference text check (reference is null or char_length(trim(reference)) between 1 and 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (id, organization_id),
  foreign key (customer_party_id, organization_id)
    references public.parties(id, organization_id) on delete restrict
);

create index customer_payments_org_customer_date_idx
  on public.customer_payments (organization_id, customer_party_id, payment_date desc, id);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_id uuid not null,
  financial_document_id uuid not null,
  amount numeric(20,6) not null check (amount > 0),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (id, organization_id),
  foreign key (payment_id, organization_id)
    references public.customer_payments(id, organization_id) on delete restrict,
  foreign key (financial_document_id, organization_id)
    references public.financial_documents(id, organization_id) on delete restrict
);

create index payment_allocations_org_payment_idx
  on public.payment_allocations (organization_id, payment_id, created_at, id);
create index payment_allocations_org_document_idx
  on public.payment_allocations (organization_id, financial_document_id, created_at, id);

alter table public.customer_payments enable row level security;
alter table public.payment_allocations enable row level security;

create policy customer_payments_select_member
on public.customer_payments for select to authenticated
using (app_private.is_org_member(organization_id));

create policy payment_allocations_select_member
on public.payment_allocations for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.customer_payments from anon, authenticated;
revoke all on public.payment_allocations from anon, authenticated;
grant select on public.customer_payments to authenticated;
grant select on public.payment_allocations to authenticated;

create or replace function app_private.reject_payment_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment ledger records are immutable' using errcode = '55000';
end;
$$;

create trigger customer_payments_immutable
before update or delete on public.customer_payments
for each row execute function app_private.reject_payment_ledger_mutation();

create trigger payment_allocations_immutable
before update or delete on public.payment_allocations
for each row execute function app_private.reject_payment_ledger_mutation();

create or replace function app_private.block_allocated_document_cancellation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'issued'
     and new.status = 'cancelled'
     and exists (
       select 1
       from public.payment_allocations a
       where a.organization_id = old.organization_id
         and a.financial_document_id = old.id
     ) then
    raise exception 'invoice with payment allocations cannot be cancelled without payment reversal' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger financial_documents_block_allocated_cancel
before update on public.financial_documents
for each row execute function app_private.block_allocated_document_cancellation();

create or replace function public.create_customer_payment(
  p_organization_id uuid,
  p_customer_party_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency_code text,
  p_method public.payment_method,
  p_request_key text,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.customer_payments%rowtype;
  v_payment_id uuid;
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

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive' using errcode = '23514';
  end if;

  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;

  perform 1
  from public.parties p
  where p.id = p_customer_party_id
    and p.organization_id = p_organization_id
    and p.status = 'active'
    and exists (
      select 1 from public.party_roles r
      where r.organization_id = p_organization_id
        and r.party_id = p_customer_party_id
        and r.role = 'customer'
    );
  if not found then
    raise exception 'active customer party not found' using errcode = '23503';
  end if;

  select * into v_existing
  from public.customer_payments
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.customer_party_id = p_customer_party_id
       and v_existing.payment_date = p_payment_date
       and v_existing.amount = p_amount
       and v_existing.currency_code = upper(trim(p_currency_code))
       and v_existing.method = p_method
       and coalesce(v_existing.reference, '') = coalesce(nullif(trim(p_reference), ''), '')
       and coalesce(v_existing.notes, '') = coalesce(nullif(p_notes, ''), '') then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different payment' using errcode = '22023';
  end if;

  insert into public.customer_payments (
    organization_id, customer_party_id, payment_date, amount, currency_code,
    method, reference, notes, request_key, created_by
  ) values (
    p_organization_id, p_customer_party_id, p_payment_date, p_amount,
    upper(trim(p_currency_code)), p_method, nullif(trim(p_reference), ''),
    nullif(p_notes, ''), trim(p_request_key), v_user_id
  ) returning id into v_payment_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'customer_payment.created', 'customer_payment', v_payment_id,
    jsonb_build_object(
      'customer_party_id', p_customer_party_id,
      'payment_date', p_payment_date,
      'amount', p_amount,
      'currency_code', upper(trim(p_currency_code)),
      'method', p_method,
      'request_key', trim(p_request_key)
    )
  );

  return v_payment_id;
end;
$$;

create or replace function public.allocate_customer_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_financial_document_id uuid,
  p_amount numeric,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.customer_payments%rowtype;
  v_document public.financial_documents%rowtype;
  v_existing public.payment_allocations%rowtype;
  v_payment_allocated numeric(20,6);
  v_invoice_allocated numeric(20,6);
  v_allocation_id uuid;
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

  if p_amount is null or p_amount <= 0 then
    raise exception 'allocation amount must be positive' using errcode = '23514';
  end if;

  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;

  select * into v_payment
  from public.customer_payments
  where id = p_payment_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into v_document
  from public.financial_documents
  where id = p_financial_document_id
    and organization_id = p_organization_id
    and document_type = 'tax_invoice'
    and status = 'issued'
  for update;
  if not found then
    raise exception 'issued tax invoice not found' using errcode = 'P0002';
  end if;

  if v_document.recipient_party_id is distinct from v_payment.customer_party_id then
    raise exception 'payment customer does not match invoice customer' using errcode = '23514';
  end if;

  if v_document.currency_code <> v_payment.currency_code then
    raise exception 'payment currency does not match invoice currency' using errcode = '23514';
  end if;

  select * into v_existing
  from public.payment_allocations
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.payment_id = p_payment_id
       and v_existing.financial_document_id = p_financial_document_id
       and v_existing.amount = p_amount then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different allocation' using errcode = '22023';
  end if;

  select coalesce(sum(a.amount), 0) into v_payment_allocated
  from public.payment_allocations a
  where a.organization_id = p_organization_id
    and a.payment_id = p_payment_id;

  select coalesce(sum(a.amount), 0) into v_invoice_allocated
  from public.payment_allocations a
  where a.organization_id = p_organization_id
    and a.financial_document_id = p_financial_document_id;

  if p_amount > v_payment.amount - v_payment_allocated then
    raise exception 'allocation exceeds unallocated payment amount' using errcode = '23514';
  end if;

  if p_amount > v_document.grand_total - v_invoice_allocated then
    raise exception 'allocation exceeds invoice balance due' using errcode = '23514';
  end if;

  insert into public.payment_allocations (
    organization_id, payment_id, financial_document_id, amount, request_key, created_by
  ) values (
    p_organization_id, p_payment_id, p_financial_document_id, p_amount,
    trim(p_request_key), v_user_id
  ) returning id into v_allocation_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'customer_payment.allocated', 'customer_payment', p_payment_id,
    jsonb_build_object(
      'allocation_id', v_allocation_id,
      'financial_document_id', p_financial_document_id,
      'amount', p_amount,
      'request_key', trim(p_request_key)
    )
  );

  return v_allocation_id;
end;
$$;

create or replace function public.invoice_payment_balance(
  p_organization_id uuid,
  p_financial_document_id uuid
)
returns table (
  grand_total numeric,
  allocated_total numeric,
  balance_due numeric,
  payment_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app_private.is_org_member(p_organization_id) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  return query
  select d.grand_total,
         coalesce(sum(a.amount), 0)::numeric as allocated_total,
         (d.grand_total - coalesce(sum(a.amount), 0))::numeric as balance_due,
         case
           when coalesce(sum(a.amount), 0) = 0 then 'unpaid'
           when coalesce(sum(a.amount), 0) >= d.grand_total then 'paid'
           else 'part_paid'
         end::text as payment_status
  from public.financial_documents d
  left join public.payment_allocations a
    on a.organization_id = d.organization_id
   and a.financial_document_id = d.id
  where d.organization_id = p_organization_id
    and d.id = p_financial_document_id
    and d.document_type = 'tax_invoice'
  group by d.id, d.grand_total;
end;
$$;

revoke all on function public.create_customer_payment(uuid, uuid, date, numeric, text, public.payment_method, text, text, text) from public;
revoke all on function public.allocate_customer_payment(uuid, uuid, uuid, numeric, text) from public;
revoke all on function public.invoice_payment_balance(uuid, uuid) from public;

grant execute on function public.create_customer_payment(uuid, uuid, date, numeric, text, public.payment_method, text, text, text) to authenticated;
grant execute on function public.allocate_customer_payment(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.invoice_payment_balance(uuid, uuid) to authenticated;
