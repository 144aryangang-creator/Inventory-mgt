-- Physical stock movement is a separate event from financial invoice issue.
-- V1 supports one atomic full fulfillment of all stock-backed invoice lines from one warehouse.

create table public.sales_fulfillments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  financial_document_id uuid not null references public.financial_documents(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  created_by uuid not null references auth.users(id) on delete restrict,
  posted_at timestamptz not null default now(),
  unique (organization_id, financial_document_id),
  unique (organization_id, request_key)
);

create index sales_fulfillments_org_posted_idx
  on public.sales_fulfillments (organization_id, posted_at desc, id);

create table public.sales_fulfillment_lines (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  fulfillment_id uuid not null references public.sales_fulfillments(id) on delete restrict,
  financial_document_line_id uuid not null references public.financial_document_lines(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  inventory_movement_id uuid not null references public.inventory_movements(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, fulfillment_id, financial_document_line_id),
  unique (organization_id, inventory_movement_id)
);

create index sales_fulfillment_lines_org_item_idx
  on public.sales_fulfillment_lines (organization_id, item_id, created_at desc);

alter table public.sales_fulfillments enable row level security;
alter table public.sales_fulfillment_lines enable row level security;

create policy sales_fulfillments_select_member
on public.sales_fulfillments for select to authenticated
using (app_private.is_org_member(organization_id));

create policy sales_fulfillment_lines_select_member
on public.sales_fulfillment_lines for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.sales_fulfillments from anon, authenticated;
revoke all on public.sales_fulfillment_lines from anon, authenticated;
grant select on public.sales_fulfillments to authenticated;
grant select on public.sales_fulfillment_lines to authenticated;

create or replace function app_private.reject_sales_fulfillment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sales fulfillment records are immutable' using errcode = '55000';
end;
$$;

create trigger sales_fulfillments_immutable
before update or delete on public.sales_fulfillments
for each row execute function app_private.reject_sales_fulfillment_mutation();

create trigger sales_fulfillment_lines_immutable
before update or delete on public.sales_fulfillment_lines
for each row execute function app_private.reject_sales_fulfillment_mutation();

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
       where f.organization_id = old.organization_id
         and f.financial_document_id = old.id
     ) then
    raise exception 'fulfilled invoice cannot be cancelled without stock reversal' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger financial_documents_block_fulfilled_cancel
before update on public.financial_documents
for each row execute function app_private.block_fulfilled_document_cancellation();

create or replace function public.fulfill_sales_invoice(
  p_organization_id uuid,
  p_financial_document_id uuid,
  p_warehouse_id uuid,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_id uuid;
  v_existing_document_id uuid;
  v_existing_request_key text;
  v_fulfillment_id uuid;
  v_line record;
  v_movement_id uuid;
  v_stock_line_count integer := 0;
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

  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;

  -- Serialize fulfilment against document state changes and concurrent fulfilment attempts.
  perform 1
  from public.financial_documents d
  where d.id = p_financial_document_id
    and d.organization_id = p_organization_id
    and d.document_type = 'tax_invoice'
    and d.status = 'issued'
  for update;

  if not found then
    raise exception 'issued tax invoice not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.warehouses w
  where w.id = p_warehouse_id
    and w.organization_id = p_organization_id
    and w.is_active
  for share;

  if not found then
    raise exception 'active warehouse not found in organization' using errcode = '23503';
  end if;

  select f.id, f.financial_document_id, f.request_key
  into v_existing_id, v_existing_document_id, v_existing_request_key
  from public.sales_fulfillments f
  where f.organization_id = p_organization_id
    and f.request_key = trim(p_request_key);

  if found then
    if v_existing_document_id = p_financial_document_id then
      return v_existing_id;
    end if;
    raise exception 'request key already belongs to another fulfillment' using errcode = '22023';
  end if;

  select f.id, f.request_key
  into v_existing_id, v_existing_request_key
  from public.sales_fulfillments f
  where f.organization_id = p_organization_id
    and f.financial_document_id = p_financial_document_id;

  if found then
    raise exception 'invoice already fulfilled with a different request key' using errcode = '22023';
  end if;

  insert into public.sales_fulfillments (
    organization_id, financial_document_id, warehouse_id, request_key, created_by
  ) values (
    p_organization_id, p_financial_document_id, p_warehouse_id, trim(p_request_key), v_user_id
  ) returning id into v_fulfillment_id;

  for v_line in
    select l.id, l.line_number, l.item_id, l.quantity
    from public.financial_document_lines l
    where l.organization_id = p_organization_id
      and l.document_id = p_financial_document_id
      and l.item_id is not null
    order by l.line_number
  loop
    v_stock_line_count := v_stock_line_count + 1;

    select public.post_inventory_movement(
      p_organization_id,
      v_line.item_id,
      p_warehouse_id,
      'sale'::public.inventory_movement_type,
      -v_line.quantity,
      null,
      'sales_fulfillment',
      v_fulfillment_id,
      format('fulfill:%s:%s', v_fulfillment_id, v_line.line_number)
    ) into v_movement_id;

    insert into public.sales_fulfillment_lines (
      organization_id,
      fulfillment_id,
      financial_document_line_id,
      item_id,
      inventory_movement_id,
      quantity
    ) values (
      p_organization_id,
      v_fulfillment_id,
      v_line.id,
      v_line.item_id,
      v_movement_id,
      v_line.quantity
    );
  end loop;

  if v_stock_line_count = 0 then
    raise exception 'invoice has no stock-backed lines to fulfill' using errcode = '23514';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'sales_invoice.fulfilled',
    'financial_document',
    p_financial_document_id,
    jsonb_build_object(
      'fulfillment_id', v_fulfillment_id,
      'warehouse_id', p_warehouse_id,
      'stock_line_count', v_stock_line_count,
      'request_key', trim(p_request_key)
    )
  );

  return v_fulfillment_id;
end;
$$;

revoke all on function public.fulfill_sales_invoice(uuid, uuid, uuid, text) from public;
grant execute on function public.fulfill_sales_invoice(uuid, uuid, uuid, text) to authenticated;
