-- Supplier-side physical stock receipt workflow.
-- A Purchase Receipt records accepted goods entering one warehouse. It does not create a supplier
-- payable or supplier invoice; financial/AP workflows remain separate future documents.

create table public.purchase_receipt_sequences (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  next_number bigint not null default 1 check (next_number between 1 and 999999999),
  updated_at timestamptz not null default now()
);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  receipt_number bigint not null check (receipt_number > 0),
  supplier_party_id uuid not null,
  supplier_snapshot jsonb not null check (jsonb_typeof(supplier_snapshot) = 'object'),
  warehouse_id uuid not null,
  supplier_reference text check (supplier_reference is null or char_length(trim(supplier_reference)) between 1 and 120),
  notes text check (notes is null or char_length(trim(notes)) between 1 and 2000),
  received_at timestamptz not null,
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, receipt_number),
  unique (organization_id, request_key),
  unique (id, organization_id),
  foreign key (supplier_party_id, organization_id)
    references public.parties(id, organization_id) on delete restrict,
  foreign key (warehouse_id, organization_id)
    references public.warehouses(id, organization_id) on delete restrict
);

create index purchase_receipts_org_received_idx
  on public.purchase_receipts (organization_id, received_at desc, receipt_number desc);
create index purchase_receipts_supplier_idx
  on public.purchase_receipts (organization_id, supplier_party_id, received_at desc);

create table public.purchase_receipt_lines (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  receipt_id uuid not null,
  line_number integer not null check (line_number between 1 and 9999),
  item_id uuid not null,
  item_snapshot jsonb not null check (jsonb_typeof(item_snapshot) = 'object'),
  uom text not null check (char_length(trim(uom)) between 1 and 20),
  quantity numeric(20,6) not null check (quantity > 0),
  unit_cost numeric(20,6) not null check (unit_cost >= 0),
  inventory_movement_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, receipt_id, line_number),
  unique (organization_id, inventory_movement_id),
  foreign key (receipt_id, organization_id)
    references public.purchase_receipts(id, organization_id) on delete restrict,
  foreign key (item_id, organization_id)
    references public.items(id, organization_id) on delete restrict,
  foreign key (inventory_movement_id, organization_id)
    references public.inventory_movements(id, organization_id) on delete restrict
);

create index purchase_receipt_lines_item_idx
  on public.purchase_receipt_lines (organization_id, item_id, created_at desc);

alter table public.purchase_receipt_sequences enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;

create policy purchase_receipts_select_member
on public.purchase_receipts for select to authenticated
using (app_private.is_org_member(organization_id));

create policy purchase_receipt_lines_select_member
on public.purchase_receipt_lines for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.purchase_receipt_sequences from anon, authenticated;
revoke all on public.purchase_receipts from anon, authenticated;
revoke all on public.purchase_receipt_lines from anon, authenticated;
grant select on public.purchase_receipts to authenticated;
grant select on public.purchase_receipt_lines to authenticated;

create or replace function app_private.reject_purchase_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'purchase receipt records are immutable; use a purchase return/correction workflow'
    using errcode = '55000';
end;
$$;

create trigger purchase_receipts_immutable
before update or delete on public.purchase_receipts
for each row execute function app_private.reject_purchase_receipt_mutation();

create trigger purchase_receipt_lines_immutable
before update or delete on public.purchase_receipt_lines
for each row execute function app_private.reject_purchase_receipt_mutation();

create or replace function app_private.purchase_supplier_snapshot(
  p_organization_id uuid,
  p_supplier_party_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_supplier public.parties%rowtype;
begin
  select * into v_supplier
  from public.parties p
  where p.id = p_supplier_party_id
    and p.organization_id = p_organization_id
    and p.status = 'active';

  if not found then
    raise exception 'active supplier party not found' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.party_roles r
    where r.organization_id = p_organization_id
      and r.party_id = p_supplier_party_id
      and r.role = 'supplier'
  ) then
    raise exception 'party must have supplier role' using errcode = '23503';
  end if;

  return jsonb_build_object(
    'party_id', v_supplier.id,
    'code', v_supplier.code,
    'legal_name', v_supplier.legal_name,
    'display_name', v_supplier.display_name,
    'email', v_supplier.email,
    'phone', v_supplier.phone
  );
end;
$$;

revoke all on function app_private.purchase_supplier_snapshot(uuid, uuid) from public;

create or replace function app_private.allocate_purchase_receipt_number(
  p_organization_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number bigint;
begin
  insert into public.purchase_receipt_sequences (organization_id, next_number)
  values (p_organization_id, 1)
  on conflict (organization_id) do nothing;

  select next_number into v_number
  from public.purchase_receipt_sequences
  where organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'purchase receipt sequence not found' using errcode = 'P0002';
  end if;

  update public.purchase_receipt_sequences
  set next_number = v_number + 1,
      updated_at = now()
  where organization_id = p_organization_id;

  return v_number;
end;
$$;

revoke all on function app_private.allocate_purchase_receipt_number(uuid) from public;

create or replace function public.post_purchase_receipt(
  p_organization_id uuid,
  p_supplier_party_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_request_key text,
  p_supplier_reference text default null,
  p_notes text default null,
  p_received_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.purchase_receipts%rowtype;
  v_supplier_snapshot jsonb;
  v_received_at timestamptz := coalesce(p_received_at, now());
  v_receipt_number bigint;
  v_receipt_id uuid;
  v_entry jsonb;
  v_item_id uuid;
  v_quantity numeric(20,6);
  v_unit_cost numeric(20,6);
  v_item public.items%rowtype;
  v_item_snapshot jsonb;
  v_movement_id uuid;
  v_line_number integer := 0;
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
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one purchase receipt line is required' using errcode = '22023';
  end if;
  if p_supplier_reference is not null and (char_length(trim(p_supplier_reference)) = 0 or char_length(trim(p_supplier_reference)) > 120) then
    raise exception 'supplier reference must be at most 120 characters' using errcode = '22023';
  end if;
  if p_notes is not null and (char_length(trim(p_notes)) = 0 or char_length(trim(p_notes)) > 2000) then
    raise exception 'notes must be at most 2000 characters' using errcode = '22023';
  end if;
  if v_received_at > now() + interval '5 minutes' then
    raise exception 'received_at cannot be in the future' using errcode = '22023';
  end if;

  select * into v_existing
  from public.purchase_receipts r
  where r.organization_id = p_organization_id
    and r.request_key = trim(p_request_key);

  if found then
    if v_existing.supplier_party_id = p_supplier_party_id
       and v_existing.warehouse_id = p_warehouse_id
       and v_existing.request_payload = p_lines
       and v_existing.supplier_reference is not distinct from nullif(trim(p_supplier_reference), '')
       and v_existing.notes is not distinct from nullif(trim(p_notes), '')
       and (p_received_at is null or v_existing.received_at = p_received_at) then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different purchase receipt' using errcode = '22023';
  end if;

  v_supplier_snapshot := app_private.purchase_supplier_snapshot(p_organization_id, p_supplier_party_id);

  perform 1
  from public.warehouses w
  where w.id = p_warehouse_id
    and w.organization_id = p_organization_id
    and w.is_active
  for share;

  if not found then
    raise exception 'active warehouse not found in organization' using errcode = '23503';
  end if;

  v_receipt_number := app_private.allocate_purchase_receipt_number(p_organization_id);

  insert into public.purchase_receipts (
    organization_id, receipt_number, supplier_party_id, supplier_snapshot, warehouse_id,
    supplier_reference, notes, received_at, request_key, request_payload, created_by
  ) values (
    p_organization_id, v_receipt_number, p_supplier_party_id, v_supplier_snapshot, p_warehouse_id,
    nullif(trim(p_supplier_reference), ''), nullif(trim(p_notes), ''), v_received_at,
    trim(p_request_key), p_lines, v_user_id
  ) returning id into v_receipt_id;

  for v_entry in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_item_id := (v_entry ->> 'itemId')::uuid;
      v_quantity := (v_entry ->> 'quantity')::numeric;
      v_unit_cost := (v_entry ->> 'unitCost')::numeric;
    exception when others then
      raise exception 'receipt lines require itemId uuid plus decimal quantity and unitCost' using errcode = '22023';
    end;

    if v_item_id is null or v_quantity is null or v_unit_cost is null then
      raise exception 'receipt lines require itemId uuid plus decimal quantity and unitCost' using errcode = '22023';
    end if;
    if v_quantity <= 0 then
      raise exception 'received quantity must be positive' using errcode = '23514';
    end if;
    if v_unit_cost < 0 then
      raise exception 'unit cost must be non-negative' using errcode = '23514';
    end if;

    select * into v_item
    from public.items i
    where i.id = v_item_id
      and i.organization_id = p_organization_id
      and i.is_active
      and i.track_inventory
    for share;

    if not found then
      raise exception 'active tracked inventory item not found in organization' using errcode = '23503';
    end if;

    v_line_number := v_line_number + 1;
    v_item_snapshot := jsonb_build_object(
      'item_id', v_item.id,
      'sku', v_item.sku,
      'name', v_item.name,
      'description', v_item.description,
      'base_uom', v_item.base_uom,
      'track_inventory', v_item.track_inventory
    );

    select public.post_inventory_movement(
      p_organization_id,
      v_item.id,
      p_warehouse_id,
      'receipt'::public.inventory_movement_type,
      v_quantity,
      v_unit_cost,
      'purchase_receipt',
      v_receipt_id,
      format('purchase-receipt:%s:%s', v_receipt_id, v_line_number),
      v_received_at
    ) into v_movement_id;

    insert into public.purchase_receipt_lines (
      organization_id, receipt_id, line_number, item_id, item_snapshot, uom,
      quantity, unit_cost, inventory_movement_id
    ) values (
      p_organization_id, v_receipt_id, v_line_number, v_item.id, v_item_snapshot, v_item.base_uom,
      v_quantity, v_unit_cost, v_movement_id
    );
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'purchase_receipt.posted',
    'purchase_receipt',
    v_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'supplier_party_id', p_supplier_party_id,
      'warehouse_id', p_warehouse_id,
      'line_count', v_line_number,
      'supplier_reference', nullif(trim(p_supplier_reference), ''),
      'request_key', trim(p_request_key)
    )
  );

  return v_receipt_id;
end;
$$;

revoke all on function public.post_purchase_receipt(uuid, uuid, uuid, jsonb, text, text, text, timestamptz) from public;
grant execute on function public.post_purchase_receipt(uuid, uuid, uuid, jsonb, text, text, text, timestamptz) to authenticated;
