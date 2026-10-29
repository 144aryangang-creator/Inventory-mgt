-- Party profile lifecycle: addresses and tax registrations are archived, not deleted.
-- GSTIN validation here is structural only. Verification remains 'unverified' until a trusted verifier confirms it.

alter table public.party_addresses
  add column status public.party_status not null default 'active',
  add column created_by uuid references auth.users(id) on delete restrict,
  add column updated_by uuid references auth.users(id) on delete restrict,
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete restrict,
  add constraint party_addresses_archive_state_ck check (
    (status = 'active' and archived_at is null and archived_by is null)
    or
    (status = 'archived' and archived_at is not null and archived_by is not null)
  );

alter table public.party_tax_registrations
  add column status public.party_status not null default 'active',
  add column created_by uuid references auth.users(id) on delete restrict,
  add column updated_by uuid references auth.users(id) on delete restrict,
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete restrict,
  add constraint party_tax_registrations_archive_state_ck check (
    (status = 'active' and archived_at is null and archived_by is null)
    or
    (status = 'archived' and archived_at is not null and archived_by is not null)
  ),
  add constraint party_tax_registrations_gstin_structure_ck check (
    scheme <> 'GSTIN'
    or (
      country_code = 'IN'
      and registration_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'
      and state_code is not null
      and state_code = substring(registration_number from 1 for 2)
    )
  );

create index party_addresses_org_party_status_idx
  on public.party_addresses (organization_id, party_id, status, id);

create index party_tax_registrations_org_party_status_idx
  on public.party_tax_registrations (organization_id, party_id, status, scheme, id);

drop index public.party_addresses_one_default_billing_uq;
drop index public.party_addresses_one_default_shipping_uq;
drop index public.party_tax_registrations_one_default_uq;

create unique index party_addresses_one_active_default_billing_uq
  on public.party_addresses (organization_id, party_id)
  where status = 'active' and is_default_billing;

create unique index party_addresses_one_active_default_shipping_uq
  on public.party_addresses (organization_id, party_id)
  where status = 'active' and is_default_shipping;

create unique index party_tax_registrations_one_active_default_uq
  on public.party_tax_registrations (organization_id, party_id, scheme)
  where status = 'active' and is_default;

create or replace function public.create_party_address(
  p_organization_id uuid,
  p_party_id uuid,
  p_label text,
  p_address_line_1 text,
  p_city text,
  p_country_code text default 'IN',
  p_recipient_name text default null,
  p_address_line_2 text default null,
  p_district text default null,
  p_state_name text default null,
  p_state_code text default null,
  p_postal_code text default null,
  p_is_default_billing boolean default false,
  p_is_default_shipping boolean default false,
  p_is_registered_address boolean default false,
  p_custom_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_address_id uuid;
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

  perform 1
  from public.parties
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  if coalesce(p_is_default_billing, false) then
    update public.party_addresses
    set is_default_billing = false,
        updated_by = v_user_id
    where organization_id = p_organization_id
      and party_id = p_party_id
      and status = 'active'
      and is_default_billing;
  end if;

  if coalesce(p_is_default_shipping, false) then
    update public.party_addresses
    set is_default_shipping = false,
        updated_by = v_user_id
    where organization_id = p_organization_id
      and party_id = p_party_id
      and status = 'active'
      and is_default_shipping;
  end if;

  insert into public.party_addresses (
    organization_id,
    party_id,
    label,
    recipient_name,
    address_line_1,
    address_line_2,
    city,
    district,
    state_name,
    state_code,
    postal_code,
    country_code,
    is_default_billing,
    is_default_shipping,
    is_registered_address,
    custom_data,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    p_party_id,
    trim(p_label),
    nullif(trim(p_recipient_name), ''),
    trim(p_address_line_1),
    nullif(trim(p_address_line_2), ''),
    trim(p_city),
    nullif(trim(p_district), ''),
    nullif(trim(p_state_name), ''),
    nullif(trim(p_state_code), ''),
    nullif(trim(p_postal_code), ''),
    upper(trim(p_country_code)),
    coalesce(p_is_default_billing, false),
    coalesce(p_is_default_shipping, false),
    coalesce(p_is_registered_address, false),
    p_custom_data,
    v_user_id,
    v_user_id
  ) returning id into v_address_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party_address.created',
    'party_address',
    v_address_id,
    jsonb_build_object('party_id', p_party_id, 'label', trim(p_label))
  );

  return v_address_id;
end;
$$;

revoke all on function public.create_party_address(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, jsonb
) from public;
grant execute on function public.create_party_address(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, jsonb
) to authenticated;

create or replace function public.update_party_address(
  p_organization_id uuid,
  p_party_id uuid,
  p_address_id uuid,
  p_label text,
  p_address_line_1 text,
  p_city text,
  p_country_code text default 'IN',
  p_recipient_name text default null,
  p_address_line_2 text default null,
  p_district text default null,
  p_state_name text default null,
  p_state_code text default null,
  p_postal_code text default null,
  p_is_default_billing boolean default false,
  p_is_default_shipping boolean default false,
  p_is_registered_address boolean default false,
  p_custom_data jsonb default '{}'::jsonb
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

  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'custom_data must be a JSON object' using errcode = '22023';
  end if;

  perform 1
  from public.parties
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.party_addresses
  where id = p_address_id
    and party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active party address not found' using errcode = 'P0002';
  end if;

  if coalesce(p_is_default_billing, false) then
    update public.party_addresses
    set is_default_billing = false,
        updated_by = v_user_id
    where organization_id = p_organization_id
      and party_id = p_party_id
      and id <> p_address_id
      and status = 'active'
      and is_default_billing;
  end if;

  if coalesce(p_is_default_shipping, false) then
    update public.party_addresses
    set is_default_shipping = false,
        updated_by = v_user_id
    where organization_id = p_organization_id
      and party_id = p_party_id
      and id <> p_address_id
      and status = 'active'
      and is_default_shipping;
  end if;

  update public.party_addresses
  set label = trim(p_label),
      recipient_name = nullif(trim(p_recipient_name), ''),
      address_line_1 = trim(p_address_line_1),
      address_line_2 = nullif(trim(p_address_line_2), ''),
      city = trim(p_city),
      district = nullif(trim(p_district), ''),
      state_name = nullif(trim(p_state_name), ''),
      state_code = nullif(trim(p_state_code), ''),
      postal_code = nullif(trim(p_postal_code), ''),
      country_code = upper(trim(p_country_code)),
      is_default_billing = coalesce(p_is_default_billing, false),
      is_default_shipping = coalesce(p_is_default_shipping, false),
      is_registered_address = coalesce(p_is_registered_address, false),
      custom_data = p_custom_data,
      updated_by = v_user_id
  where id = p_address_id
    and party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party_address.updated',
    'party_address',
    p_address_id,
    jsonb_build_object('party_id', p_party_id, 'label', trim(p_label))
  );
end;
$$;

revoke all on function public.update_party_address(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, jsonb
) from public;
grant execute on function public.update_party_address(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, jsonb
) to authenticated;

create or replace function public.archive_party_address(
  p_organization_id uuid,
  p_party_id uuid,
  p_address_id uuid
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

  update public.party_addresses
  set status = 'archived',
      is_default_billing = false,
      is_default_shipping = false,
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where id = p_address_id
    and party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active party address not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party_address.archived',
    'party_address',
    p_address_id,
    jsonb_build_object('party_id', p_party_id)
  );
end;
$$;

revoke all on function public.archive_party_address(uuid, uuid, uuid) from public;
grant execute on function public.archive_party_address(uuid, uuid, uuid) to authenticated;

create or replace function public.create_party_tax_registration(
  p_organization_id uuid,
  p_party_id uuid,
  p_scheme text,
  p_registration_number text,
  p_country_code text default 'IN',
  p_registered_name text default null,
  p_state_code text default null,
  p_is_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_registration_id uuid;
  v_scheme text := upper(trim(p_scheme));
  v_registration_number text := upper(trim(p_registration_number));
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

  perform 1
  from public.parties
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  if coalesce(p_is_default, false) then
    update public.party_tax_registrations
    set is_default = false,
        updated_by = v_user_id
    where organization_id = p_organization_id
      and party_id = p_party_id
      and scheme = v_scheme
      and status = 'active'
      and is_default;
  end if;

  insert into public.party_tax_registrations (
    organization_id,
    party_id,
    scheme,
    registration_number,
    registered_name,
    country_code,
    state_code,
    is_default,
    verification_status,
    verified_at,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    p_party_id,
    v_scheme,
    v_registration_number,
    nullif(trim(p_registered_name), ''),
    upper(trim(p_country_code)),
    nullif(trim(p_state_code), ''),
    coalesce(p_is_default, false),
    'unverified',
    null,
    v_user_id,
    v_user_id
  ) returning id into v_registration_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party_tax_registration.created',
    'party_tax_registration',
    v_registration_id,
    jsonb_build_object('party_id', p_party_id, 'scheme', v_scheme)
  );

  return v_registration_id;
end;
$$;

revoke all on function public.create_party_tax_registration(
  uuid, uuid, text, text, text, text, text, boolean
) from public;
grant execute on function public.create_party_tax_registration(
  uuid, uuid, text, text, text, text, text, boolean
) to authenticated;

create or replace function public.update_party_tax_registration(
  p_organization_id uuid,
  p_party_id uuid,
  p_registration_id uuid,
  p_scheme text,
  p_registration_number text,
  p_country_code text default 'IN',
  p_registered_name text default null,
  p_state_code text default null,
  p_is_default boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scheme text := upper(trim(p_scheme));
  v_registration_number text := upper(trim(p_registration_number));
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

  perform 1
  from public.parties
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.party_tax_registrations
  where id = p_registration_id
    and party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active party tax registration not found' using errcode = 'P0002';
  end if;

  if coalesce(p_is_default, false) then
    update public.party_tax_registrations
    set is_default = false,
        updated_by = v_user_id
    where organization_id = p_organization_id
      and party_id = p_party_id
      and scheme = v_scheme
      and id <> p_registration_id
      and status = 'active'
      and is_default;
  end if;

  update public.party_tax_registrations
  set scheme = v_scheme,
      registration_number = v_registration_number,
      registered_name = nullif(trim(p_registered_name), ''),
      country_code = upper(trim(p_country_code)),
      state_code = nullif(trim(p_state_code), ''),
      is_default = coalesce(p_is_default, false),
      verification_status = 'unverified',
      verified_at = null,
      updated_by = v_user_id
  where id = p_registration_id
    and party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party_tax_registration.updated',
    'party_tax_registration',
    p_registration_id,
    jsonb_build_object('party_id', p_party_id, 'scheme', v_scheme)
  );
end;
$$;

revoke all on function public.update_party_tax_registration(
  uuid, uuid, uuid, text, text, text, text, text, boolean
) from public;
grant execute on function public.update_party_tax_registration(
  uuid, uuid, uuid, text, text, text, text, text, boolean
) to authenticated;

create or replace function public.archive_party_tax_registration(
  p_organization_id uuid,
  p_party_id uuid,
  p_registration_id uuid
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

  update public.party_tax_registrations
  set status = 'archived',
      is_default = false,
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where id = p_registration_id
    and party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  if not found then
    raise exception 'active party tax registration not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party_tax_registration.archived',
    'party_tax_registration',
    p_registration_id,
    jsonb_build_object('party_id', p_party_id)
  );
end;
$$;

revoke all on function public.archive_party_tax_registration(uuid, uuid, uuid) from public;
grant execute on function public.archive_party_tax_registration(uuid, uuid, uuid) to authenticated;
