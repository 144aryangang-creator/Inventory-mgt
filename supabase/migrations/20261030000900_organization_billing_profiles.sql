-- Seller/billing identities used to generate immutable supplier snapshots on financial documents.
-- Legal profile mutation is owner/admin only. GSTIN verification is structural until a trusted verifier is integrated.

create table public.organization_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null
    check (code = upper(trim(code)))
    check (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
  legal_name text not null check (char_length(trim(legal_name)) between 1 and 200),
  trade_name text check (trade_name is null or char_length(trim(trade_name)) between 1 and 200),
  gstin text check (gstin is null or gstin = upper(trim(gstin))),
  gstin_verification_status text not null default 'unverified'
    check (gstin_verification_status in ('unverified', 'verified', 'invalid')),
  gstin_verified_at timestamptz,
  address_line_1 text not null check (char_length(trim(address_line_1)) between 1 and 240),
  address_line_2 text check (address_line_2 is null or char_length(trim(address_line_2)) between 1 and 240),
  city text not null check (char_length(trim(city)) between 1 and 120),
  district text check (district is null or char_length(trim(district)) between 1 and 120),
  state_name text not null check (char_length(trim(state_name)) between 1 and 120),
  state_code text not null check (char_length(trim(state_code)) between 1 and 20),
  postal_code text not null check (char_length(trim(postal_code)) between 1 and 20),
  country_code varchar(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  is_default boolean not null default false,
  status public.party_status not null default 'active',
  custom_data jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_data) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id),
  check (
    (status = 'active' and archived_at is null and archived_by is null)
    or
    (status = 'archived' and archived_at is not null and archived_by is not null)
  ),
  check (
    gstin is null
    or (
      country_code = 'IN'
      and gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'
      and state_code = substring(gstin from 1 for 2)
    )
  ),
  check (
    (gstin_verification_status = 'verified' and gstin is not null and gstin_verified_at is not null)
    or
    (gstin_verification_status <> 'verified' and gstin_verified_at is null)
  )
);

create index organization_billing_profiles_org_status_idx
  on public.organization_billing_profiles (organization_id, status, code, id);

create unique index organization_billing_profiles_one_active_default_uq
  on public.organization_billing_profiles (organization_id)
  where status = 'active' and is_default;

create unique index organization_billing_profiles_gstin_uq
  on public.organization_billing_profiles (organization_id, gstin)
  where gstin is not null;

create trigger organization_billing_profiles_set_updated_at
before update on public.organization_billing_profiles
for each row execute function app_private.set_updated_at();

create trigger organization_billing_profiles_organization_immutable
before update on public.organization_billing_profiles
for each row execute function app_private.reject_organization_reassignment();

alter table public.organization_billing_profiles enable row level security;

create policy organization_billing_profiles_select_member
on public.organization_billing_profiles for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on public.organization_billing_profiles from anon, authenticated;
grant select on public.organization_billing_profiles to authenticated;

create or replace function app_private.organization_billing_profile_snapshot(
  p_organization_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.organization_billing_profiles%rowtype;
begin
  select * into v_profile
  from public.organization_billing_profiles
  where id = p_profile_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active organization billing profile not found' using errcode = '23503';
  end if;

  return jsonb_build_object(
    'profile_id', v_profile.id,
    'code', v_profile.code,
    'legal_name', v_profile.legal_name,
    'trade_name', v_profile.trade_name,
    'gstin', v_profile.gstin,
    'gstin_verification_status', v_profile.gstin_verification_status,
    'address_line_1', v_profile.address_line_1,
    'address_line_2', v_profile.address_line_2,
    'city', v_profile.city,
    'district', v_profile.district,
    'state_name', v_profile.state_name,
    'state_code', v_profile.state_code,
    'postal_code', v_profile.postal_code,
    'country_code', v_profile.country_code
  );
end;
$$;

create or replace function public.create_organization_billing_profile(
  p_organization_id uuid,
  p_code text,
  p_legal_name text,
  p_address_line_1 text,
  p_city text,
  p_state_name text,
  p_state_code text,
  p_postal_code text,
  p_country_code text default 'IN',
  p_trade_name text default null,
  p_gstin text default null,
  p_address_line_2 text default null,
  p_district text default null,
  p_is_default boolean default false,
  p_custom_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_is_default boolean;
  v_gstin text := nullif(upper(trim(p_gstin)), '');
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin']::public.organization_role[]
  ) then
    raise exception 'owner or admin permission required' using errcode = '42501';
  end if;

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'organization not found' using errcode = '23503';
  end if;

  v_is_default := p_is_default or not exists (
    select 1 from public.organization_billing_profiles
    where organization_id = p_organization_id and status = 'active'
  );

  if v_is_default then
    update public.organization_billing_profiles
    set is_default = false, updated_by = v_user_id
    where organization_id = p_organization_id
      and status = 'active'
      and is_default;
  end if;

  insert into public.organization_billing_profiles (
    organization_id, code, legal_name, trade_name, gstin,
    address_line_1, address_line_2, city, district, state_name, state_code,
    postal_code, country_code, is_default, custom_data, created_by, updated_by
  ) values (
    p_organization_id, upper(trim(p_code)), trim(p_legal_name), nullif(trim(p_trade_name), ''), v_gstin,
    trim(p_address_line_1), nullif(trim(p_address_line_2), ''), trim(p_city), nullif(trim(p_district), ''),
    trim(p_state_name), trim(p_state_code), trim(p_postal_code), upper(trim(p_country_code)),
    v_is_default, p_custom_data, v_user_id, v_user_id
  ) returning id into v_profile_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'organization_billing_profile.created',
    'organization_billing_profile', v_profile_id,
    jsonb_build_object('code', upper(trim(p_code)), 'is_default', v_is_default)
  );

  return v_profile_id;
end;
$$;

create or replace function public.update_organization_billing_profile(
  p_organization_id uuid,
  p_profile_id uuid,
  p_code text,
  p_legal_name text,
  p_address_line_1 text,
  p_city text,
  p_state_name text,
  p_state_code text,
  p_postal_code text,
  p_country_code text default 'IN',
  p_trade_name text default null,
  p_gstin text default null,
  p_address_line_2 text default null,
  p_district text default null,
  p_is_default boolean default false,
  p_custom_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_gstin text;
  v_gstin text := nullif(upper(trim(p_gstin)), '');
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin']::public.organization_role[]
  ) then
    raise exception 'owner or admin permission required' using errcode = '42501';
  end if;

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  perform 1 from public.organizations where id = p_organization_id for update;

  select gstin into v_old_gstin
  from public.organization_billing_profiles
  where id = p_profile_id
    and organization_id = p_organization_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'active organization billing profile not found' using errcode = 'P0002';
  end if;

  if p_is_default then
    update public.organization_billing_profiles
    set is_default = false, updated_by = v_user_id
    where organization_id = p_organization_id
      and status = 'active'
      and is_default
      and id <> p_profile_id;
  end if;

  update public.organization_billing_profiles
  set code = upper(trim(p_code)),
      legal_name = trim(p_legal_name),
      trade_name = nullif(trim(p_trade_name), ''),
      gstin = v_gstin,
      gstin_verification_status = case when v_old_gstin is distinct from v_gstin then 'unverified' else gstin_verification_status end,
      gstin_verified_at = case when v_old_gstin is distinct from v_gstin then null else gstin_verified_at end,
      address_line_1 = trim(p_address_line_1),
      address_line_2 = nullif(trim(p_address_line_2), ''),
      city = trim(p_city),
      district = nullif(trim(p_district), ''),
      state_name = trim(p_state_name),
      state_code = trim(p_state_code),
      postal_code = trim(p_postal_code),
      country_code = upper(trim(p_country_code)),
      is_default = p_is_default,
      custom_data = p_custom_data,
      updated_by = v_user_id
  where id = p_profile_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'organization_billing_profile.updated',
    'organization_billing_profile', p_profile_id,
    jsonb_build_object('code', upper(trim(p_code)), 'is_default', p_is_default)
  );
end;
$$;

create or replace function public.archive_organization_billing_profile(
  p_organization_id uuid,
  p_profile_id uuid
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
    raise exception 'owner or admin permission required' using errcode = '42501';
  end if;

  update public.organization_billing_profiles
  set status = 'archived',
      is_default = false,
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where id = p_profile_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active organization billing profile not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'organization_billing_profile.archived',
    'organization_billing_profile', p_profile_id, '{}'::jsonb
  );
end;
$$;

revoke all on function public.create_organization_billing_profile(
  uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb
) from public;
revoke all on function public.update_organization_billing_profile(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb
) from public;
revoke all on function public.archive_organization_billing_profile(uuid,uuid) from public;

grant execute on function public.create_organization_billing_profile(
  uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb
) to authenticated;
grant execute on function public.update_organization_billing_profile(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb
) to authenticated;
grant execute on function public.archive_organization_billing_profile(uuid,uuid) to authenticated;
