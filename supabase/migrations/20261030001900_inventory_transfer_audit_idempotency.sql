-- Avoid duplicate high-level transfer audit events when the same transfer request is retried.

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
  v_key text := trim(p_request_key);
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

  if p_request_key is null or char_length(v_key) = 0 then
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
    v_key || ':out',
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
    v_key || ':in',
    p_occurred_at
  );

  if not exists (
    select 1
    from public.audit_events a
    where a.organization_id = p_organization_id
      and a.action = 'inventory.transferred'
      and a.metadata ->> 'request_key' = v_key
  ) then
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
        'request_key', v_key
      )
    );
  end if;

  return v_outbound_id;
end;
$$;
