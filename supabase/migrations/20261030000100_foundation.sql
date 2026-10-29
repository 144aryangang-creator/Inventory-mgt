-- Inventory Management + Invoicing SaaS
-- Foundation migration: tenancy, RLS, immutable stock ledger, balance locking, audit trail.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create type public.organization_role as enum ('owner', 'admin', 'staff', 'viewer');
create type public.membership_status as enum ('active', 'suspended');
create type public.inventory_movement_type as enum (
  'receipt',
  'sale',
  'return_in',
  'return_out',
  'transfer_in',
  'transfer_out',
  'adjustment_in',
  'adjustment_out'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null unique
    check (slug = lower(slug))
    check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  country_code varchar(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  base_currency varchar(3) not null default 'INR' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Kolkata',
  allow_negative_stock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'staff',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_id_idx
  on public.organization_memberships (user_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sku text not null check (char_length(trim(sku)) between 1 and 80),
  name text not null check (char_length(trim(name)) between 1 and 200),
  description text,
  base_uom text not null default 'EA' check (char_length(trim(base_uom)) between 1 and 20),
  track_inventory boolean not null default true,
  is_active boolean not null default true,
  custom_data jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku),
  unique (id, organization_id)
);

create index items_organization_id_idx on public.items (organization_id);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (char_length(trim(code)) between 1 and 40),
  name text not null check (char_length(trim(name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create index warehouses_organization_id_idx on public.warehouses (organization_id);

create table public.inventory_balances (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  item_id uuid not null,
  warehouse_id uuid not null,
  quantity_on_hand numeric(20,6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, item_id, warehouse_id),
  foreign key (item_id, organization_id)
    references public.items(id, organization_id) on delete restrict,
  foreign key (warehouse_id, organization_id)
    references public.warehouses(id, organization_id) on delete restrict
);

create index inventory_balances_item_id_idx on public.inventory_balances (item_id);
create index inventory_balances_warehouse_id_idx on public.inventory_balances (warehouse_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  item_id uuid not null,
  warehouse_id uuid not null,
  movement_type public.inventory_movement_type not null,
  quantity numeric(20,6) not null check (quantity <> 0),
  unit_cost numeric(20,6) check (unit_cost is null or unit_cost >= 0),
  reference_type text,
  reference_id uuid,
  request_key text check (request_key is null or char_length(request_key) between 1 and 128),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  foreign key (item_id, organization_id)
    references public.items(id, organization_id) on delete restrict,
  foreign key (warehouse_id, organization_id)
    references public.warehouses(id, organization_id) on delete restrict,
  check (
    (movement_type in ('receipt', 'return_in', 'transfer_in', 'adjustment_in') and quantity > 0)
    or
    (movement_type in ('sale', 'return_out', 'transfer_out', 'adjustment_out') and quantity < 0)
  )
);

create index inventory_movements_organization_id_idx
  on public.inventory_movements (organization_id);
create index inventory_movements_item_warehouse_idx
  on public.inventory_movements (organization_id, item_id, warehouse_id, occurred_at);
create unique index inventory_movements_org_request_key_uq
  on public.inventory_movements (organization_id, request_key)
  where request_key is not null;

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 120),
  entity_type text not null check (char_length(trim(entity_type)) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_organization_created_idx
  on public.audit_events (organization_id, created_at desc);

-- Generic timestamp trigger.
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function app_private.set_updated_at();

create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row execute function app_private.set_updated_at();

create trigger items_set_updated_at
before update on public.items
for each row execute function app_private.set_updated_at();

create trigger warehouses_set_updated_at
before update on public.warehouses
for each row execute function app_private.set_updated_at();

-- Ledger and audit records are append-only. Corrections must be represented by new records.
create or replace function app_private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; create a reversing/correcting record instead', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function app_private.reject_immutable_mutation();

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function app_private.reject_immutable_mutation();

-- RLS helper functions. SECURITY DEFINER avoids recursive policies on membership rows.
create or replace function app_private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app_private.has_org_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed_roles)
  );
$$;

grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.has_org_role(uuid, public.organization_role[]) to authenticated;

-- Row Level Security.
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.items enable row level security;
alter table public.warehouses enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_select_member
on public.organizations for select to authenticated
using (app_private.is_org_member(id));

create policy organizations_update_admin
on public.organizations for update to authenticated
using (app_private.has_org_role(id, array['owner','admin']::public.organization_role[]))
with check (app_private.has_org_role(id, array['owner','admin']::public.organization_role[]));

create policy memberships_select_member
on public.organization_memberships for select to authenticated
using (app_private.is_org_member(organization_id));

create policy items_select_member
on public.items for select to authenticated
using (app_private.is_org_member(organization_id));

create policy items_insert_staff
on public.items for insert to authenticated
with check (app_private.has_org_role(organization_id, array['owner','admin','staff']::public.organization_role[]));

create policy items_update_staff
on public.items for update to authenticated
using (app_private.has_org_role(organization_id, array['owner','admin','staff']::public.organization_role[]))
with check (app_private.has_org_role(organization_id, array['owner','admin','staff']::public.organization_role[]));

create policy warehouses_select_member
on public.warehouses for select to authenticated
using (app_private.is_org_member(organization_id));

create policy warehouses_insert_admin
on public.warehouses for insert to authenticated
with check (app_private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));

create policy warehouses_update_admin
on public.warehouses for update to authenticated
using (app_private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]))
with check (app_private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));

create policy inventory_balances_select_member
on public.inventory_balances for select to authenticated
using (app_private.is_org_member(organization_id));

create policy inventory_movements_select_member
on public.inventory_movements for select to authenticated
using (app_private.is_org_member(organization_id));

create policy audit_events_select_admin
on public.audit_events for select to authenticated
using (app_private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));

-- Explicit privileges. anon receives no application-table access.
revoke all on public.organizations from anon, authenticated;
revoke all on public.organization_memberships from anon, authenticated;
revoke all on public.items from anon, authenticated;
revoke all on public.warehouses from anon, authenticated;
revoke all on public.inventory_balances from anon, authenticated;
revoke all on public.inventory_movements from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;

grant select, update on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant select, insert, update on public.items to authenticated;
grant select, insert, update on public.warehouses to authenticated;
grant select on public.inventory_balances to authenticated;
grant select on public.inventory_movements to authenticated;
grant select on public.audit_events to authenticated;

-- Secure onboarding RPC: creates the tenant and its first owner atomically.
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_country_code text default 'IN',
  p_base_currency text default 'INR',
  p_timezone text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, country_code, base_currency, timezone)
  values (
    trim(p_name),
    lower(trim(p_slug)),
    upper(trim(p_country_code)),
    upper(trim(p_base_currency)),
    p_timezone
  )
  returning id into v_organization_id;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_organization_id, v_user_id, 'owner', 'active');

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_organization_id,
    v_user_id,
    'organization.created',
    'organization',
    v_organization_id,
    jsonb_build_object('slug', lower(trim(p_slug)))
  );

  return v_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text) from public;
grant execute on function public.create_organization(text, text, text, text, text) to authenticated;

-- Secure inventory posting RPC.
-- Balance row is locked before stock is changed, preventing overselling races.
create or replace function public.post_inventory_movement(
  p_organization_id uuid,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_movement_type public.inventory_movement_type,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_request_key text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.inventory_movements%rowtype;
  v_balance numeric(20,6);
  v_allow_negative boolean;
  v_movement_id uuid;
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

  if p_request_key is not null then
    select * into v_existing
    from public.inventory_movements
    where organization_id = p_organization_id
      and request_key = p_request_key;

    if found then
      if v_existing.item_id is distinct from p_item_id
         or v_existing.warehouse_id is distinct from p_warehouse_id
         or v_existing.movement_type is distinct from p_movement_type
         or v_existing.quantity is distinct from p_quantity
         or v_existing.unit_cost is distinct from p_unit_cost
         or v_existing.reference_type is distinct from p_reference_type
         or v_existing.reference_id is distinct from p_reference_id then
        raise exception 'idempotency key reused with different payload' using errcode = '22023';
      end if;
      return v_existing.id;
    end if;
  end if;

  perform 1 from public.items
  where id = p_item_id
    and organization_id = p_organization_id
    and is_active
    and track_inventory;
  if not found then
    raise exception 'active inventory item not found in organization' using errcode = '23503';
  end if;

  perform 1 from public.warehouses
  where id = p_warehouse_id
    and organization_id = p_organization_id
    and is_active;
  if not found then
    raise exception 'active warehouse not found in organization' using errcode = '23503';
  end if;

  insert into public.inventory_balances (
    organization_id, item_id, warehouse_id, quantity_on_hand
  ) values (
    p_organization_id, p_item_id, p_warehouse_id, 0
  ) on conflict (organization_id, item_id, warehouse_id) do nothing;

  select quantity_on_hand
    into v_balance
  from public.inventory_balances
  where organization_id = p_organization_id
    and item_id = p_item_id
    and warehouse_id = p_warehouse_id
  for update;

  -- Recheck after lock to make same-key retries safe when requests race.
  if p_request_key is not null then
    select * into v_existing
    from public.inventory_movements
    where organization_id = p_organization_id
      and request_key = p_request_key;

    if found then
      if v_existing.item_id is distinct from p_item_id
         or v_existing.warehouse_id is distinct from p_warehouse_id
         or v_existing.movement_type is distinct from p_movement_type
         or v_existing.quantity is distinct from p_quantity
         or v_existing.unit_cost is distinct from p_unit_cost
         or v_existing.reference_type is distinct from p_reference_type
         or v_existing.reference_id is distinct from p_reference_id then
        raise exception 'idempotency key reused with different payload' using errcode = '22023';
      end if;
      return v_existing.id;
    end if;
  end if;

  select allow_negative_stock
    into v_allow_negative
  from public.organizations
  where id = p_organization_id;

  if not v_allow_negative and (v_balance + p_quantity) < 0 then
    raise exception 'insufficient stock: current %, requested change %', v_balance, p_quantity
      using errcode = '23514';
  end if;

  insert into public.inventory_movements (
    organization_id,
    item_id,
    warehouse_id,
    movement_type,
    quantity,
    unit_cost,
    reference_type,
    reference_id,
    request_key,
    occurred_at,
    created_by
  ) values (
    p_organization_id,
    p_item_id,
    p_warehouse_id,
    p_movement_type,
    p_quantity,
    p_unit_cost,
    p_reference_type,
    p_reference_id,
    p_request_key,
    p_occurred_at,
    v_user_id
  )
  returning id into v_movement_id;

  update public.inventory_balances
  set quantity_on_hand = quantity_on_hand + p_quantity,
      updated_at = now()
  where organization_id = p_organization_id
    and item_id = p_item_id
    and warehouse_id = p_warehouse_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'inventory.movement_posted',
    'inventory_movement',
    v_movement_id,
    jsonb_build_object(
      'item_id', p_item_id,
      'warehouse_id', p_warehouse_id,
      'movement_type', p_movement_type,
      'quantity', p_quantity,
      'request_key', p_request_key
    )
  );

  return v_movement_id;
end;
$$;

revoke all on function public.post_inventory_movement(
  uuid, uuid, uuid, public.inventory_movement_type, numeric, numeric, text, uuid, text, timestamptz
) from public;
grant execute on function public.post_inventory_movement(
  uuid, uuid, uuid, public.inventory_movement_type, numeric, numeric, text, uuid, text, timestamptz
) to authenticated;
