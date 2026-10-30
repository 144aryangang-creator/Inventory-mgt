-- Immutable sales-return ledger.
-- Returns restore stock through append-only return_in movements and never rewrite fulfilment history.

create table public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  fulfillment_id uuid not null references public.sales_fulfillments(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  posted_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (id, organization_id)
);

create index sales_returns_org_fulfillment_idx
  on public.sales_returns (organization_id, fulfillment_id, posted_at, id);

create table public.sales_return_lines (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  return_id uuid not null references public.sales_returns(id) on delete restrict,
  fulfillment_id uuid not null,
  fulfillment_line_id uuid not null,
  item_id uuid not null references public.items(id) on delete restrict,
  inventory_movement_id uuid not null references public.inventory_movements(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, return_id, fulfillment_line_id),
  unique (organization_id, inventory_movement_id),
  foreign key (organization_id, fulfillment_id, fulfillment_line_id)
    references public.sales_fulfillment_lines(organization_id, fulfillment_id, financial_document_line_id)
    on delete restrict
);

create index sales_return_lines_org_fulfillment_line_idx
  on public.sales_return_lines (organization_id, fulfillment_id, fulfillment_line_id, created_at, return_id);

alter table public.sales_returns enable row level security;
alter table public.sales_return_lines enable row level security;

create policy sales_returns_select_member
on public.sales_returns for select to authenticated
using (app_private.is_org_member(organization_id));

create policy sales_return_lines_select_member
on public.sales_return_lines for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.sales_returns from anon, authenticated;
revoke all on public.sales_return_lines from anon, authenticated;
grant select on public.sales_returns to authenticated;
grant select on public.sales_return_lines to authenticated;

create or replace function app_private.reject_sales_return_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sales return records are immutable' using errcode = '55000';
end;
$$;

create trigger sales_returns_immutable
before update or delete on public.sales_returns
for each row execute function app_private.reject_sales_return_mutation();

create trigger sales_return_lines_immutable
before update or delete on public.sales_return_lines
for each row execute function app_private.reject_sales_return_mutation();

create or replace function public.return_sales_fulfillment(
  p_organization_id uuid,
  p_fulfillment_id uuid,
  p_lines jsonb,
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
  v_fulfillment public.sales_fulfillments%rowtype;
  v_existing public.sales_returns%rowtype;
  v_return_id uuid;
  v_entry jsonb;
  v_fulfillment_line record;
  v_fulfillment_line_id uuid;
  v_quantity numeric(20,6);
  v_returned numeric(20,6);
  v_movement_id uuid;
  v_line_count integer := 0;
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

  if p_reason is null or char_length(trim(p_reason)) = 0 or char_length(trim(p_reason)) > 240 then
    raise exception 'return reason is required and must be at most 240 characters' using errcode = '22023';
  end if;
  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one return line is required' using errcode = '22023';
  end if;

  select * into v_fulfillment
  from public.sales_fulfillments
  where id = p_fulfillment_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'sales fulfillment not found' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.sales_returns
  where organization_id = p_organization_id
    and request_key = trim(p_request_key);

  if found then
    if v_existing.fulfillment_id = p_fulfillment_id
       and v_existing.reason = trim(p_reason)
       and v_existing.request_payload = p_lines then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different sales return' using errcode = '22023';
  end if;

  insert into public.sales_returns (
    organization_id, fulfillment_id, reason, request_key, request_payload, created_by
  ) values (
    p_organization_id, p_fulfillment_id, trim(p_reason), trim(p_request_key), p_lines, v_user_id
  ) returning id into v_return_id;

  for v_entry in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_fulfillment_line_id := (v_entry->>'fulfillmentLineId')::uuid;
      v_quantity := (v_entry->>'quantity')::numeric;
    exception when others then
      raise exception 'return lines require fulfillmentLineId uuid and decimal quantity' using errcode = '22023';
    end;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'return quantity must be positive' using errcode = '23514';
    end if;

    select
      fl.financial_document_line_id,
      fl.item_id,
      fl.quantity
    into v_fulfillment_line
    from public.sales_fulfillment_lines fl
    where fl.organization_id = p_organization_id
      and fl.fulfillment_id = p_fulfillment_id
      and fl.financial_document_line_id = v_fulfillment_line_id
    for update;

    if not found then
      raise exception 'fulfillment line not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(rl.quantity), 0)
    into v_returned
    from public.sales_return_lines rl
    where rl.organization_id = p_organization_id
      and rl.fulfillment_id = p_fulfillment_id
      and rl.fulfillment_line_id = v_fulfillment_line_id;

    if v_quantity > v_fulfillment_line.quantity - v_returned then
      raise exception 'return quantity exceeds remaining fulfilled quantity' using errcode = '23514';
    end if;

    select public.post_inventory_movement(
      p_organization_id,
      v_fulfillment_line.item_id,
      v_fulfillment.warehouse_id,
      'return_in'::public.inventory_movement_type,
      v_quantity,
      null,
      'sales_return',
      v_return_id,
      format('return:%s:%s', v_return_id, v_fulfillment_line_id)
    ) into v_movement_id;

    insert into public.sales_return_lines (
      organization_id,
      return_id,
      fulfillment_id,
      fulfillment_line_id,
      item_id,
      inventory_movement_id,
      quantity
    ) values (
      p_organization_id,
      v_return_id,
      p_fulfillment_id,
      v_fulfillment_line_id,
      v_fulfillment_line.item_id,
      v_movement_id,
      v_quantity
    );

    v_line_count := v_line_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'sales_invoice.returned',
    'sales_return',
    v_return_id,
    jsonb_build_object(
      'fulfillment_id', p_fulfillment_id,
      'financial_document_id', v_fulfillment.financial_document_id,
      'warehouse_id', v_fulfillment.warehouse_id,
      'line_count', v_line_count,
      'reason', trim(p_reason),
      'request_key', trim(p_request_key)
    )
  );

  return v_return_id;
end;
$$;

revoke all on function public.return_sales_fulfillment(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.return_sales_fulfillment(uuid, uuid, jsonb, text, text) to authenticated;

-- A fulfilled invoice may be cancelled only once every fulfilled stock quantity has been returned.
create or replace function app_private.block_fulfilled_document_cancellation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'issued'
     and new.status = 'cancelled'
     and exists (
       select 1
       from public.sales_fulfillments f
       join public.sales_fulfillment_lines fl
         on fl.organization_id = f.organization_id
        and fl.fulfillment_id = f.id
       where f.organization_id = old.organization_id
         and f.financial_document_id = old.id
         and fl.quantity > coalesce((
           select sum(rl.quantity)
           from public.sales_return_lines rl
           where rl.organization_id = fl.organization_id
             and rl.fulfillment_id = fl.fulfillment_id
             and rl.fulfillment_line_id = fl.financial_document_line_id
         ), 0)
     ) then
    raise exception 'fulfilled invoice cannot be cancelled until all fulfilled stock is returned' using errcode = '23514';
  end if;

  return new;
end;
$$;
