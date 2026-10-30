-- Read-only authoritative validation used by CSV dry-runs before an atomic import RPC is called.

create or replace function public.validate_data_import_v1(
  p_organization_id uuid,
  p_import_type text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_ordinal bigint;
  v_issues jsonb := '[]'::jsonb;
  v_item_id uuid;
  v_warehouse_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin','staff']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  if p_import_type not in ('items','customers','suppliers','opening_stock') then
    raise exception 'unsupported import type' using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'validation requires between 1 and 1000 rows' using errcode = '22023';
  end if;

  for v_entry, v_ordinal in
    select value, ordinality from jsonb_array_elements(p_rows) with ordinality
  loop
    if p_import_type = 'items' then
      v_code := upper(trim(v_entry->>'sku'));
      if exists (
        select 1 from public.items i
        where i.organization_id = p_organization_id and i.sku = v_code
      ) then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'row', v_ordinal + 1, 'field', 'sku', 'code', 'already_exists',
          'message', 'SKU already exists in this organization'
        ));
      end if;

    elsif p_import_type in ('customers','suppliers') then
      v_code := upper(trim(v_entry->>'code'));
      if exists (
        select 1 from public.parties p
        where p.organization_id = p_organization_id and p.code = v_code
      ) then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'row', v_ordinal + 1, 'field', 'code', 'code', 'already_exists',
          'message', 'Party code already exists in this organization'
        ));
      end if;

    else
      v_item_id := null;
      v_warehouse_id := null;

      select i.id into v_item_id
      from public.items i
      where i.organization_id = p_organization_id
        and i.sku = upper(trim(v_entry->>'itemSku'))
        and i.is_active
        and i.track_inventory;

      if v_item_id is null then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'row', v_ordinal + 1, 'field', 'item_sku', 'code', 'item_not_found',
          'message', 'Active tracked item was not found'
        ));
      end if;

      select w.id into v_warehouse_id
      from public.warehouses w
      where w.organization_id = p_organization_id
        and w.code = upper(trim(v_entry->>'warehouseCode'))
        and w.is_active;

      if v_warehouse_id is null then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'row', v_ordinal + 1, 'field', 'warehouse_code', 'code', 'warehouse_not_found',
          'message', 'Active warehouse was not found'
        ));
      end if;

      if v_item_id is not null and v_warehouse_id is not null and exists (
        select 1 from public.inventory_movements m
        where m.organization_id = p_organization_id
          and m.item_id = v_item_id
          and m.warehouse_id = v_warehouse_id
      ) then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'row', v_ordinal + 1, 'field', 'quantity', 'code', 'position_has_history',
          'message', 'Opening stock is only allowed for positions with no inventory history'
        ));
      end if;
    end if;
  end loop;

  return v_issues;
end;
$$;

revoke all on function public.validate_data_import_v1(uuid, text, jsonb) from public;
grant execute on function public.validate_data_import_v1(uuid, text, jsonb) to authenticated;
