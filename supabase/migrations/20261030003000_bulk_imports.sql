-- Versioned, immutable bulk-import ledger.
-- CSV parsing/shape validation happens at the API boundary; PostgreSQL re-validates authoritative
-- references and applies each accepted batch atomically. V1 imports are create-only.

create table public.data_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  import_type text not null check (import_type in ('items','customers','suppliers','opening_stock')),
  schema_version smallint not null default 1 check (schema_version = 1),
  request_key text not null check (char_length(trim(request_key)) between 1 and 128),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  row_count integer not null check (row_count between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  unique (id, organization_id)
);

create index data_import_batches_org_created_idx
  on public.data_import_batches (organization_id, created_at desc, id);

alter table public.data_import_batches enable row level security;
create policy data_import_batches_select_member
on public.data_import_batches for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.data_import_batches from anon, authenticated;
grant select on public.data_import_batches to authenticated;

create or replace function app_private.reject_data_import_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'data import batches are immutable' using errcode = '55000';
end;
$$;

create trigger data_import_batches_immutable
before update or delete on public.data_import_batches
for each row execute function app_private.reject_data_import_mutation();

create or replace function app_private.validate_import_request(
  p_organization_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'import requires between 1 and 1000 rows' using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.validate_import_request(uuid, jsonb, text) from public;

create or replace function public.import_items_v1(
  p_organization_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.data_import_batches%rowtype;
  v_batch_id uuid;
  v_entry jsonb;
  v_track_inventory boolean;
  v_count integer := 0;
begin
  perform app_private.validate_import_request(p_organization_id, p_rows, p_request_key);

  select * into v_existing
  from public.data_import_batches
  where organization_id = p_organization_id and request_key = trim(p_request_key);

  if found then
    if v_existing.import_type = 'items'
       and v_existing.schema_version = 1
       and v_existing.request_payload = p_rows then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different import payload' using errcode = '22023';
  end if;

  insert into public.data_import_batches (
    organization_id, import_type, schema_version, request_key, request_payload, row_count, created_by
  ) values (
    p_organization_id, 'items', 1, trim(p_request_key), p_rows, jsonb_array_length(p_rows), v_user_id
  ) returning id into v_batch_id;

  for v_entry in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or nullif(trim(v_entry->>'sku'), '') is null
       or nullif(trim(v_entry->>'name'), '') is null
       or nullif(trim(v_entry->>'baseUom'), '') is null then
      raise exception 'item import rows require sku, name and baseUom' using errcode = '22023';
    end if;

    if v_entry ? 'trackInventory' then
      if jsonb_typeof(v_entry->'trackInventory') <> 'boolean' then
        raise exception 'trackInventory must be boolean' using errcode = '22023';
      end if;
      v_track_inventory := (v_entry->>'trackInventory')::boolean;
    else
      v_track_inventory := true;
    end if;

    perform public.create_item(
      p_organization_id,
      v_entry->>'sku',
      v_entry->>'name',
      v_entry->>'description',
      v_entry->>'baseUom',
      v_track_inventory,
      '{}'::jsonb
    );
    v_count := v_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'data_import.completed', 'data_import_batch', v_batch_id,
    jsonb_build_object('import_type', 'items', 'schema_version', 1, 'row_count', v_count)
  );

  return v_batch_id;
end;
$$;

revoke all on function public.import_items_v1(uuid, jsonb, text) from public;
grant execute on function public.import_items_v1(uuid, jsonb, text) to authenticated;

create or replace function public.import_parties_v1(
  p_organization_id uuid,
  p_role public.party_role,
  p_rows jsonb,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.data_import_batches%rowtype;
  v_batch_id uuid;
  v_entry jsonb;
  v_import_type text;
  v_count integer := 0;
begin
  perform app_private.validate_import_request(p_organization_id, p_rows, p_request_key);

  if p_role not in ('customer'::public.party_role, 'supplier'::public.party_role) then
    raise exception 'unsupported party import role' using errcode = '22023';
  end if;
  v_import_type := case when p_role = 'customer' then 'customers' else 'suppliers' end;

  select * into v_existing
  from public.data_import_batches
  where organization_id = p_organization_id and request_key = trim(p_request_key);

  if found then
    if v_existing.import_type = v_import_type
       and v_existing.schema_version = 1
       and v_existing.request_payload = p_rows then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different import payload' using errcode = '22023';
  end if;

  insert into public.data_import_batches (
    organization_id, import_type, schema_version, request_key, request_payload, row_count, created_by
  ) values (
    p_organization_id, v_import_type, 1, trim(p_request_key), p_rows, jsonb_array_length(p_rows), v_user_id
  ) returning id into v_batch_id;

  for v_entry in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or nullif(trim(v_entry->>'code'), '') is null
       or nullif(trim(v_entry->>'legalName'), '') is null
       or nullif(trim(v_entry->>'displayName'), '') is null then
      raise exception 'party import rows require code, legalName and displayName' using errcode = '22023';
    end if;

    perform public.create_party(
      p_organization_id,
      v_entry->>'code',
      v_entry->>'legalName',
      v_entry->>'displayName',
      array[p_role]::public.party_role[],
      v_entry->>'email',
      v_entry->>'phone',
      '{}'::jsonb
    );
    v_count := v_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'data_import.completed', 'data_import_batch', v_batch_id,
    jsonb_build_object('import_type', v_import_type, 'schema_version', 1, 'row_count', v_count)
  );

  return v_batch_id;
end;
$$;

revoke all on function public.import_parties_v1(uuid, public.party_role, jsonb, text) from public;
grant execute on function public.import_parties_v1(uuid, public.party_role, jsonb, text) to authenticated;

create or replace function public.import_opening_stock_v1(
  p_organization_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.data_import_batches%rowtype;
  v_batch_id uuid;
  v_entry jsonb;
  v_item_id uuid;
  v_warehouse_id uuid;
  v_quantity numeric(20,6);
  v_unit_cost numeric(20,6);
  v_ordinal bigint;
  v_count integer := 0;
begin
  perform app_private.validate_import_request(p_organization_id, p_rows, p_request_key);

  select * into v_existing
  from public.data_import_batches
  where organization_id = p_organization_id and request_key = trim(p_request_key);

  if found then
    if v_existing.import_type = 'opening_stock'
       and v_existing.schema_version = 1
       and v_existing.request_payload = p_rows then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different import payload' using errcode = '22023';
  end if;

  insert into public.data_import_batches (
    organization_id, import_type, schema_version, request_key, request_payload, row_count, created_by
  ) values (
    p_organization_id, 'opening_stock', 1, trim(p_request_key), p_rows, jsonb_array_length(p_rows), v_user_id
  ) returning id into v_batch_id;

  for v_entry, v_ordinal in
    select value, ordinality from jsonb_array_elements(p_rows) with ordinality
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or nullif(trim(v_entry->>'itemSku'), '') is null
       or nullif(trim(v_entry->>'warehouseCode'), '') is null
       or nullif(trim(v_entry->>'quantity'), '') is null then
      raise exception 'opening stock rows require itemSku, warehouseCode and quantity' using errcode = '22023';
    end if;

    begin
      v_quantity := (v_entry->>'quantity')::numeric;
      v_unit_cost := case
        when nullif(trim(v_entry->>'unitCost'), '') is null then null
        else (v_entry->>'unitCost')::numeric
      end;
    exception when others then
      raise exception 'opening stock quantity/unitCost must be decimal values' using errcode = '22023';
    end;

    if v_quantity <= 0 or v_unit_cost < 0 then
      raise exception 'opening stock quantity must be positive and unitCost non-negative' using errcode = '23514';
    end if;

    select i.id into v_item_id
    from public.items i
    where i.organization_id = p_organization_id
      and i.sku = upper(trim(v_entry->>'itemSku'))
      and i.is_active
      and i.track_inventory;
    if not found then
      raise exception 'active tracked item not found for opening stock' using errcode = '23503';
    end if;

    select w.id into v_warehouse_id
    from public.warehouses w
    where w.organization_id = p_organization_id
      and w.code = upper(trim(v_entry->>'warehouseCode'))
      and w.is_active;
    if not found then
      raise exception 'active warehouse not found for opening stock' using errcode = '23503';
    end if;

    insert into public.inventory_balances (organization_id, item_id, warehouse_id, quantity_on_hand)
    values (p_organization_id, v_item_id, v_warehouse_id, 0)
    on conflict do nothing;

    perform 1
    from public.inventory_balances b
    where b.organization_id = p_organization_id
      and b.item_id = v_item_id
      and b.warehouse_id = v_warehouse_id
    for update;

    if exists (
      select 1 from public.inventory_movements m
      where m.organization_id = p_organization_id
        and m.item_id = v_item_id
        and m.warehouse_id = v_warehouse_id
    ) then
      raise exception 'opening stock position already has inventory history' using errcode = '23514';
    end if;

    perform public.post_inventory_movement(
      p_organization_id,
      v_item_id,
      v_warehouse_id,
      'adjustment_in'::public.inventory_movement_type,
      v_quantity,
      v_unit_cost,
      'opening_stock_import',
      v_batch_id,
      format('opening-import:%s:%s', v_batch_id, v_ordinal)
    );
    v_count := v_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'data_import.completed', 'data_import_batch', v_batch_id,
    jsonb_build_object('import_type', 'opening_stock', 'schema_version', 1, 'row_count', v_count)
  );

  return v_batch_id;
end;
$$;

revoke all on function public.import_opening_stock_v1(uuid, jsonb, text) from public;
grant execute on function public.import_opening_stock_v1(uuid, jsonb, text) to authenticated;
