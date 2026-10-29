-- Customer / supplier party master.
-- One legal party may have customer and supplier roles, multiple addresses,
-- and multiple tax registrations. Financial documents will snapshot these values.

create type public.party_role as enum ('customer', 'supplier');
create type public.party_status as enum ('active', 'archived');

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null
    check (code = upper(trim(code)))
    check (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
  legal_name text not null check (char_length(trim(legal_name)) between 1 and 200),
  display_name text not null check (char_length(trim(display_name)) between 1 and 200),
  email text check (email is null or char_length(trim(email)) between 3 and 254),
  phone text check (phone is null or char_length(trim(phone)) between 5 and 40),
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
  )
);

create index parties_organization_status_name_idx
  on public.parties (organization_id, status, display_name, id);

create table public.party_roles (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  party_id uuid not null,
  role public.party_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, party_id, role),
  foreign key (party_id, organization_id)
    references public.parties(id, organization_id) on delete restrict
);

create index party_roles_org_role_party_idx
  on public.party_roles (organization_id, role, party_id);

create table public.party_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  party_id uuid not null,
  label text not null default 'Main' check (char_length(trim(label)) between 1 and 80),
  recipient_name text check (recipient_name is null or char_length(trim(recipient_name)) between 1 and 200),
  address_line_1 text not null check (char_length(trim(address_line_1)) between 1 and 240),
  address_line_2 text check (address_line_2 is null or char_length(trim(address_line_2)) between 1 and 240),
  city text not null check (char_length(trim(city)) between 1 and 120),
  district text check (district is null or char_length(trim(district)) between 1 and 120),
  state_name text check (state_name is null or char_length(trim(state_name)) between 1 and 120),
  state_code text check (state_code is null or char_length(trim(state_code)) between 1 and 20),
  postal_code text check (postal_code is null or char_length(trim(postal_code)) between 1 and 20),
  country_code varchar(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  is_default_billing boolean not null default false,
  is_default_shipping boolean not null default false,
  is_registered_address boolean not null default false,
  custom_data jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (party_id, organization_id)
    references public.parties(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create index party_addresses_org_party_idx
  on public.party_addresses (organization_id, party_id, id);

create unique index party_addresses_one_default_billing_uq
  on public.party_addresses (organization_id, party_id)
  where is_default_billing;

create unique index party_addresses_one_default_shipping_uq
  on public.party_addresses (organization_id, party_id)
  where is_default_shipping;

create table public.party_tax_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  party_id uuid not null,
  scheme text not null
    check (scheme = upper(trim(scheme)))
    check (scheme ~ '^[A-Z0-9_-]{2,30}$'),
  registration_number text not null
    check (registration_number = upper(trim(registration_number)))
    check (char_length(registration_number) between 2 and 80),
  registered_name text check (registered_name is null or char_length(trim(registered_name)) between 1 and 200),
  country_code varchar(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  state_code text check (state_code is null or char_length(trim(state_code)) between 1 and 20),
  is_default boolean not null default false,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'invalid')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (party_id, organization_id)
    references public.parties(id, organization_id) on delete restrict,
  unique (organization_id, scheme, registration_number),
  unique (id, organization_id),
  check (
    (verification_status = 'verified' and verified_at is not null)
    or
    (verification_status <> 'verified' and verified_at is null)
  )
);

create index party_tax_registrations_org_party_idx
  on public.party_tax_registrations (organization_id, party_id, scheme);

create unique index party_tax_registrations_one_default_uq
  on public.party_tax_registrations (organization_id, party_id, scheme)
  where is_default;

create trigger parties_set_updated_at
before update on public.parties
for each row execute function app_private.set_updated_at();

create trigger party_addresses_set_updated_at
before update on public.party_addresses
for each row execute function app_private.set_updated_at();

create trigger party_tax_registrations_set_updated_at
before update on public.party_tax_registrations
for each row execute function app_private.set_updated_at();

create trigger parties_organization_immutable
before update on public.parties
for each row execute function app_private.reject_organization_reassignment();

create trigger party_addresses_organization_immutable
before update on public.party_addresses
for each row execute function app_private.reject_organization_reassignment();

create trigger party_tax_registrations_organization_immutable
before update on public.party_tax_registrations
for each row execute function app_private.reject_organization_reassignment();

alter table public.parties enable row level security;
alter table public.party_roles enable row level security;
alter table public.party_addresses enable row level security;
alter table public.party_tax_registrations enable row level security;

create policy parties_select_member
on public.parties for select to authenticated
using (app_private.is_org_member(organization_id));

create policy party_roles_select_member
on public.party_roles for select to authenticated
using (app_private.is_org_member(organization_id));

create policy party_addresses_select_member
on public.party_addresses for select to authenticated
using (app_private.is_org_member(organization_id));

create policy party_tax_registrations_select_member
on public.party_tax_registrations for select to authenticated
using (app_private.is_org_member(organization_id));

-- Business writes go through audited RPCs. Direct table mutation is denied to clients.
revoke all on public.parties from anon, authenticated;
revoke all on public.party_roles from anon, authenticated;
revoke all on public.party_addresses from anon, authenticated;
revoke all on public.party_tax_registrations from anon, authenticated;

grant select on public.parties to authenticated;
grant select on public.party_roles to authenticated;
grant select on public.party_addresses to authenticated;
grant select on public.party_tax_registrations to authenticated;

create or replace function public.create_party(
  p_organization_id uuid,
  p_code text,
  p_legal_name text,
  p_display_name text,
  p_roles public.party_role[],
  p_email text default null,
  p_phone text default null,
  p_custom_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_party_id uuid;
  v_role public.party_role;
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

  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'at least one party role is required' using errcode = '22023';
  end if;

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  insert into public.parties (
    organization_id,
    code,
    legal_name,
    display_name,
    email,
    phone,
    custom_data,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    upper(trim(p_code)),
    trim(p_legal_name),
    trim(p_display_name),
    nullif(lower(trim(p_email)), ''),
    nullif(trim(p_phone), ''),
    p_custom_data,
    v_user_id,
    v_user_id
  ) returning id into v_party_id;

  foreach v_role in array p_roles loop
    insert into public.party_roles (organization_id, party_id, role)
    values (p_organization_id, v_party_id, v_role)
    on conflict do nothing;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party.created',
    'party',
    v_party_id,
    jsonb_build_object('roles', to_jsonb(p_roles), 'code', upper(trim(p_code)))
  );

  return v_party_id;
end;
$$;

revoke all on function public.create_party(
  uuid, text, text, text, public.party_role[], text, text, jsonb
) from public;
grant execute on function public.create_party(
  uuid, text, text, text, public.party_role[], text, text, jsonb
) to authenticated;

create or replace function public.update_party(
  p_organization_id uuid,
  p_party_id uuid,
  p_code text,
  p_legal_name text,
  p_display_name text,
  p_roles public.party_role[],
  p_email text default null,
  p_phone text default null,
  p_custom_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.party_role;
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

  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'at least one party role is required' using errcode = '22023';
  end if;

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  update public.parties
  set code = upper(trim(p_code)),
      legal_name = trim(p_legal_name),
      display_name = trim(p_display_name),
      email = nullif(lower(trim(p_email)), ''),
      phone = nullif(trim(p_phone), ''),
      custom_data = p_custom_data,
      updated_by = v_user_id
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  delete from public.party_roles
  where organization_id = p_organization_id
    and party_id = p_party_id;

  foreach v_role in array p_roles loop
    insert into public.party_roles (organization_id, party_id, role)
    values (p_organization_id, p_party_id, v_role)
    on conflict do nothing;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party.updated',
    'party',
    p_party_id,
    jsonb_build_object('roles', to_jsonb(p_roles), 'code', upper(trim(p_code)))
  );
end;
$$;

revoke all on function public.update_party(
  uuid, uuid, text, text, text, public.party_role[], text, text, jsonb
) from public;
grant execute on function public.update_party(
  uuid, uuid, text, text, text, public.party_role[], text, text, jsonb
) to authenticated;

create or replace function public.archive_party(
  p_organization_id uuid,
  p_party_id uuid
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

  update public.parties
  set status = 'archived',
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party.archived',
    'party',
    p_party_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.archive_party(uuid, uuid) from public;
grant execute on function public.archive_party(uuid, uuid) to authenticated;
