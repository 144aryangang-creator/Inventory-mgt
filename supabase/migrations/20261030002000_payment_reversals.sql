-- Immutable correction ledgers for customer receipts and allocations.
-- Original payment/allocation rows remain append-only. Corrections append reversal rows.

create table public.payment_allocation_reversals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  allocation_id uuid not null,
  amount numeric(20,6) not null check (amount > 0),
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (id, organization_id),
  foreign key (allocation_id, organization_id)
    references public.payment_allocations(id, organization_id) on delete restrict
);

create index payment_allocation_reversals_org_allocation_idx
  on public.payment_allocation_reversals (organization_id, allocation_id, created_at, id);

create table public.customer_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_id uuid not null,
  amount numeric(20,6) not null check (amount > 0),
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (id, organization_id),
  foreign key (payment_id, organization_id)
    references public.customer_payments(id, organization_id) on delete restrict
);

create index customer_payment_reversals_org_payment_idx
  on public.customer_payment_reversals (organization_id, payment_id, created_at, id);

alter table public.payment_allocation_reversals enable row level security;
alter table public.customer_payment_reversals enable row level security;

create policy payment_allocation_reversals_select_member
on public.payment_allocation_reversals for select to authenticated
using (app_private.is_org_member(organization_id));

create policy customer_payment_reversals_select_member
on public.customer_payment_reversals for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.payment_allocation_reversals from anon, authenticated;
revoke all on public.customer_payment_reversals from anon, authenticated;
grant select on public.payment_allocation_reversals to authenticated;
grant select on public.customer_payment_reversals to authenticated;

create trigger payment_allocation_reversals_immutable
before update or delete on public.payment_allocation_reversals
for each row execute function app_private.reject_payment_ledger_mutation();

create trigger customer_payment_reversals_immutable
before update or delete on public.customer_payment_reversals
for each row execute function app_private.reject_payment_ledger_mutation();

create or replace function public.reverse_payment_allocation(
  p_organization_id uuid,
  p_allocation_id uuid,
  p_amount numeric,
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
  v_allocation public.payment_allocations%rowtype;
  v_existing public.payment_allocation_reversals%rowtype;
  v_reversed numeric(20,6);
  v_reversal_id uuid;
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
    raise exception 'reversal amount must be positive' using errcode = '23514';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 or char_length(trim(p_reason)) > 240 then
    raise exception 'reversal reason is required and must be at most 240 characters' using errcode = '22023';
  end if;
  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;

  select * into v_allocation
  from public.payment_allocations
  where id = p_allocation_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'payment allocation not found' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.payment_allocation_reversals
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.allocation_id = p_allocation_id
       and v_existing.amount = p_amount
       and v_existing.reason = trim(p_reason) then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different allocation reversal' using errcode = '22023';
  end if;

  select coalesce(sum(r.amount), 0) into v_reversed
  from public.payment_allocation_reversals r
  where r.organization_id = p_organization_id
    and r.allocation_id = p_allocation_id;

  if p_amount > v_allocation.amount - v_reversed then
    raise exception 'allocation reversal exceeds remaining allocated amount' using errcode = '23514';
  end if;

  insert into public.payment_allocation_reversals (
    organization_id, allocation_id, amount, reason, request_key, created_by
  ) values (
    p_organization_id, p_allocation_id, p_amount, trim(p_reason), trim(p_request_key), v_user_id
  ) returning id into v_reversal_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'customer_payment.allocation_reversed',
    'payment_allocation_reversal', v_reversal_id,
    jsonb_build_object(
      'allocation_id', p_allocation_id,
      'payment_id', v_allocation.payment_id,
      'financial_document_id', v_allocation.financial_document_id,
      'amount', p_amount,
      'reason', trim(p_reason),
      'request_key', trim(p_request_key)
    )
  );

  return v_reversal_id;
end;
$$;

create or replace function public.reverse_customer_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_amount numeric,
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
  v_payment public.customer_payments%rowtype;
  v_existing public.customer_payment_reversals%rowtype;
  v_payment_reversed numeric(20,6);
  v_net_allocated numeric(20,6);
  v_reversal_id uuid;
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
    raise exception 'reversal amount must be positive' using errcode = '23514';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 or char_length(trim(p_reason)) > 240 then
    raise exception 'reversal reason is required and must be at most 240 characters' using errcode = '22023';
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

  select * into v_existing
  from public.customer_payment_reversals
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.payment_id = p_payment_id
       and v_existing.amount = p_amount
       and v_existing.reason = trim(p_reason) then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different payment reversal' using errcode = '22023';
  end if;

  select coalesce(sum(r.amount), 0) into v_payment_reversed
  from public.customer_payment_reversals r
  where r.organization_id = p_organization_id
    and r.payment_id = p_payment_id;

  select coalesce(sum(a.amount), 0) - coalesce(sum(ar.reversed_amount), 0)
  into v_net_allocated
  from public.payment_allocations a
  left join (
    select allocation_id, sum(amount) as reversed_amount
    from public.payment_allocation_reversals
    where organization_id = p_organization_id
    group by allocation_id
  ) ar on ar.allocation_id = a.id
  where a.organization_id = p_organization_id
    and a.payment_id = p_payment_id;

  v_net_allocated := coalesce(v_net_allocated, 0);

  if p_amount > v_payment.amount - v_payment_reversed - v_net_allocated then
    raise exception 'payment reversal exceeds currently unallocated receipt amount' using errcode = '23514';
  end if;

  insert into public.customer_payment_reversals (
    organization_id, payment_id, amount, reason, request_key, created_by
  ) values (
    p_organization_id, p_payment_id, p_amount, trim(p_reason), trim(p_request_key), v_user_id
  ) returning id into v_reversal_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'customer_payment.reversed',
    'customer_payment_reversal', v_reversal_id,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', p_amount,
      'reason', trim(p_reason),
      'request_key', trim(p_request_key)
    )
  );

  return v_reversal_id;
end;
$$;

-- Allocation math now uses net allocations after reversal and available receipt amount after refund.
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
  v_payment_reversed numeric(20,6);
  v_invoice_allocated numeric(20,6);
  v_allocation_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not app_private.has_org_role(p_organization_id, array['owner','admin','staff']::public.organization_role[]) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'allocation amount must be positive' using errcode = '23514'; end if;
  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;

  select * into v_payment from public.customer_payments
  where id = p_payment_id and organization_id = p_organization_id for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;

  select * into v_document from public.financial_documents
  where id = p_financial_document_id and organization_id = p_organization_id
    and document_type = 'tax_invoice' and status = 'issued' for update;
  if not found then raise exception 'issued tax invoice not found' using errcode = 'P0002'; end if;

  if v_document.recipient_party_id is distinct from v_payment.customer_party_id then
    raise exception 'payment customer does not match invoice customer' using errcode = '23514';
  end if;
  if v_document.currency_code <> v_payment.currency_code then
    raise exception 'payment currency does not match invoice currency' using errcode = '23514';
  end if;

  select * into v_existing from public.payment_allocations
  where organization_id = p_organization_id and request_key = trim(p_request_key);
  if found then
    if v_existing.payment_id = p_payment_id and v_existing.financial_document_id = p_financial_document_id and v_existing.amount = p_amount then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different allocation' using errcode = '22023';
  end if;

  select coalesce(sum(a.amount), 0) - coalesce(sum(ar.reversed_amount), 0)
  into v_payment_allocated
  from public.payment_allocations a
  left join (
    select allocation_id, sum(amount) as reversed_amount
    from public.payment_allocation_reversals
    where organization_id = p_organization_id
    group by allocation_id
  ) ar on ar.allocation_id = a.id
  where a.organization_id = p_organization_id and a.payment_id = p_payment_id;
  v_payment_allocated := coalesce(v_payment_allocated, 0);

  select coalesce(sum(amount), 0) into v_payment_reversed
  from public.customer_payment_reversals
  where organization_id = p_organization_id and payment_id = p_payment_id;

  select coalesce(sum(a.amount), 0) - coalesce(sum(ar.reversed_amount), 0)
  into v_invoice_allocated
  from public.payment_allocations a
  left join (
    select allocation_id, sum(amount) as reversed_amount
    from public.payment_allocation_reversals
    where organization_id = p_organization_id
    group by allocation_id
  ) ar on ar.allocation_id = a.id
  where a.organization_id = p_organization_id and a.financial_document_id = p_financial_document_id;
  v_invoice_allocated := coalesce(v_invoice_allocated, 0);

  if p_amount > v_payment.amount - v_payment_reversed - v_payment_allocated then
    raise exception 'allocation exceeds available payment amount' using errcode = '23514';
  end if;
  if p_amount > v_document.grand_total - v_invoice_allocated then
    raise exception 'allocation exceeds invoice balance due' using errcode = '23514';
  end if;

  insert into public.payment_allocations (
    organization_id, payment_id, financial_document_id, amount, request_key, created_by
  ) values (
    p_organization_id, p_payment_id, p_financial_document_id, p_amount, trim(p_request_key), v_user_id
  ) returning id into v_allocation_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'customer_payment.allocated', 'customer_payment', p_payment_id,
    jsonb_build_object('allocation_id', v_allocation_id, 'financial_document_id', p_financial_document_id, 'amount', p_amount, 'request_key', trim(p_request_key))
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
  with net_allocations as (
    select a.financial_document_id,
           sum(a.amount - coalesce(ar.reversed_amount, 0))::numeric as amount
    from public.payment_allocations a
    left join (
      select allocation_id, sum(amount) as reversed_amount
      from public.payment_allocation_reversals
      where organization_id = p_organization_id
      group by allocation_id
    ) ar on ar.allocation_id = a.id
    where a.organization_id = p_organization_id
    group by a.financial_document_id
  )
  select d.grand_total,
         coalesce(n.amount, 0)::numeric as allocated_total,
         (d.grand_total - coalesce(n.amount, 0))::numeric as balance_due,
         case
           when coalesce(n.amount, 0) = 0 then 'unpaid'
           when coalesce(n.amount, 0) >= d.grand_total then 'paid'
           else 'part_paid'
         end::text as payment_status
  from public.financial_documents d
  left join net_allocations n on n.financial_document_id = d.id
  where d.organization_id = p_organization_id
    and d.id = p_financial_document_id
    and d.document_type = 'tax_invoice';
end;
$$;

create or replace function app_private.block_allocated_document_cancellation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_net_allocated numeric(20,6);
begin
  if old.status = 'issued' and new.status = 'cancelled' then
    select coalesce(sum(a.amount - coalesce(ar.reversed_amount, 0)), 0)
    into v_net_allocated
    from public.payment_allocations a
    left join (
      select allocation_id, sum(amount) as reversed_amount
      from public.payment_allocation_reversals
      where organization_id = old.organization_id
      group by allocation_id
    ) ar on ar.allocation_id = a.id
    where a.organization_id = old.organization_id
      and a.financial_document_id = old.id;

    if v_net_allocated > 0 then
      raise exception 'invoice with net payment allocations cannot be cancelled without payment reversal' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.reverse_payment_allocation(uuid, uuid, numeric, text, text) from public;
revoke all on function public.reverse_customer_payment(uuid, uuid, numeric, text, text) from public;
grant execute on function public.reverse_payment_allocation(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.reverse_customer_payment(uuid, uuid, numeric, text, text) to authenticated;
