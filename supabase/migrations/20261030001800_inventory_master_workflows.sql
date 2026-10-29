-- Audited inventory-master lifecycle and atomic transfer workflow.
-- Direct authenticated item/warehouse writes are revoked so audit rules cannot be bypassed.

revoke insert, update on public.items from authenticated;
revoke insert, update on public.warehouses from authenticated;

create or replace function public.create_item(
  p_organization_id uuid,
  p_sku text,
  p_name text,
  p_description text default null,
  p_base_uom text default 'EA',
  p_track_inventory boolean default true,
  p_custom_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item_id uuid;
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

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  insert into public.items (
    organization_id, sku, name, description, base_uom, track_inventory, custom_data
  ) values (
    p_organization_id,
    upper(trim(p_sku)),
    trim(p_name),
    nullif(trim(p_description), ''),
    upper(trim(p_base_uom)),
    p_track_inventory,
    p_custom_data
  ) returning id into v_item_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'inventory.item_created', 'item', v_item_id,
    jsonb_build_object('sku', upper(trim(p_sku)), 'track_inventory', p_track_inventory)
  );

  return v_item_id;
end;
$$;

create or replace function public.update_item(
  p_organization_id uuid,
  p_item_id uuid,
  p_sku text,
  p_name text,
  p_description text default null,
  p_base_uom text default 'EA',
  p_track_inventory boolean default true,
  p_custom_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.items%rowtype;
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

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  select * into v_existing
  from public.items
  where id = p_item_id
    and organization_id = p_organization_id
    and is_active
  for update;

  if not found then
    raise exception 'active item not found' using errcode = 'P0002';
  end if;

  if v_existing.track_inventory and not p_track_inventory and exists (
    select 1 from public.inventory_balances b
    where b.organization_id = p_organization_id
      and b.item_id = p_item_id
      and b.quantity_on_hand <> 0
  ) then
    raise exception 'cannot disable inventory tracking while stock remains' using errcode = '23514';
  end if;

  update public.items
  set sku = upper(trim(p_sku)),
      name = trim(p_name),
      description = nullif(trim(p_description), ''),
      base_uom = upper(trim(p_base_uom)),
      track_inventory = p_track_inventory,
      custom_data = p_custom_data
  where id = p_item_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'inventory.item_updated', 'item', p_item_id,
    jsonb_build_object('sku', upper(trim(p_sku)), 'track_inventory', p_track_inventory)
  );
end;
$$;

create or replace function public.archive_item(
  p_organization_id uuid,
  p_item_id uuid
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

  perform 1 from public.items
  where id = p_item_id
    and organization_id = p_organization_id
    and is_active
  for update;
  if not found then
    raise exception 'active item not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.inventory_balances b
    where b.organization_id = p_organization_id
      and b.item_id = p_item_id
      and b.quantity_on_hand <> 0
  ) then
    raise exception 'cannot archive item while stock remains' using errcode = '23514';
  end if;

  update public.items
  set is_active = false
  where id = p_item_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id
  ) values (
    p_organization_id, v_user_id, 'inventory.item_archived', 'item', p_item_id
  );
end;
$$;

create or replace function public.create_warehouse(
  p_organization_id uuid,
  p_code text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_warehouse_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  insert into public.warehouses (organization_id, code, name)
  values (p_organization_id, upper(trim(p_code)), trim(p_name))
  returning id into v_warehouse_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'inventory.warehouse_created', 'warehouse', v_warehouse_id,
    jsonb_build_object('code', upper(trim(p_code)))
  );

  return v_warehouse_id;
end;
$$;

create or replace function public.update_warehouse(
  p_organization_id uuid,
  p_warehouse_id uuid,
  p_code text,
  p_name text
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
    array['owner','admin']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  perform 1 from public.warehouses
  where id = p_warehouse_id
    and organization_id = p_organization_id
    and is_active
  for update;
  if not found then
    raise exception 'active warehouse not found' using errcode = 'P0002';
  end if;

  update public.warehouses
  set code = upper(trim(p_code)), name = trim(p_name)
  where id = p_warehouse_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'inventory.warehouse_updated', 'warehouse', p_warehouse_id,
    jsonb_build_object('code', upper(trim(p_code)))
  );
end;
$$;

create or replace function public.archive_warehouse(
  p_organization_id uuid,
  p_warehouse_id uuid
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
    array['owner','admin']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  perform 1 from public.warehouses
  where id = p_warehouse_id
    and organization_id = p_organization_id
    and is_active
  for update;
  if not found then
    raise exception 'active warehouse not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.inventory_balances b
    where b.organization_id = p_organization_id
      and b.warehouse_id = p_warehouse_id
      and b.quantity_on_hand <> 0
  ) then
    raise exception 'cannot archive warehouse while stock remains' using errcode = '23514';
  end if;

  update public.warehouses
  set is_active = false
  where id = p_warehouse_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id
  ) values (
    p_organization_id, v_user_id, 'inventory.warehouse_archived', 'warehouse', p_warehouse_id
  );
end;
$$;

create or replace function public.transfer_inventory(
  p_organization_id uuid,
  p_item_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_quantity numeric,
  p_request_key text,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_outbound_id uuid;
  v_inbound_id uuid;
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

  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'source and destination warehouse must differ' using errcode = '23514';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'transfer quantity must be positive' using errcode = '23514';
  end if;

  if p_request_key is null or char_length(trim(p_request_key)) = 0 then
    raise exception 'request key is required' using errcode = '22023';
  end if;

  v_outbound_id := public.post_inventory_movement(
    p_organization_id,
    p_item_id,
    p_from_warehouse_id,
    'transfer_out'::public.inventory_movement_type,
    -p_quantity,
    null,
    'inventory_transfer',
    null,
    trim(p_request_key) || ':out',
    p_occurred_at
  );

  v_inbound_id := public.post_inventory_movement(
    p_organization_id,
    p_item_id,
    p_to_warehouse_id,
    'transfer_in'::public.inventory_movement_type,
    p_quantity,
    null,
    'inventory_transfer',
    null,
    trim(p_request_key) || ':in',
    p_occurred_at
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'inventory.transferred', 'inventory_movement', v_outbound_id,
    jsonb_build_object(
      'item_id', p_item_id,
      'from_warehouse_id', p_from_warehouse_id,
      'to_warehouse_id', p_to_warehouse_id,
      'quantity', p_quantity,
      'outbound_movement_id', v_outbound_id,
      'inbound_movement_id', v_inbound_id,
      'request_key', trim(p_request_key)
    )
  );

  return v_outbound_id;
end;
$$;

revoke all on function public.create_item(uuid, text, text, text, text, boolean, jsonb) from public;
revoke all on function public.update_item(uuid, uuid, text, text, text, text, boolean, jsonb) from public;
revoke all on function public.archive_item(uuid, uuid) from public;
revoke all on function public.create_warehouse(uuid, text, text) from public;
revoke all on function public.update_warehouse(uuid, uuid, text, text) from public;
revoke all on function public.archive_warehouse(uuid, uuid) from public;
revoke all on function public.transfer_inventory(uuid, uuid, uuid, uuid, numeric, text, timestamptz) from public;

grant execute on function public.create_item(uuid, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.update_item(uuid, uuid, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.archive_item(uuid, uuid) to authenticated;
grant execute on function public.create_warehouse(uuid, text, text) to authenticated;
grant execute on function public.update_warehouse(uuid, uuid, text, text) to authenticated;
grant execute on function public.archive_warehouse(uuid, uuid) to authenticated;
grant execute on function public.transfer_inventory(uuid, uuid, uuid, uuid, numeric, text, timestamptz) to authenticated;
