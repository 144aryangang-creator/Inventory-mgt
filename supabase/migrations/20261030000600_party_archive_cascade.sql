-- Keep lifecycle state consistent: archiving a party also archives its active profile records.

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
  v_archived_addresses integer := 0;
  v_archived_registrations integer := 0;
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

  -- Lock the parent so profile edits and archival serialize on the same party row.
  perform 1
  from public.parties
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'active party not found' using errcode = 'P0002';
  end if;

  update public.party_addresses
  set status = 'archived',
      is_default_billing = false,
      is_default_shipping = false,
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';
  get diagnostics v_archived_addresses = row_count;

  update public.party_tax_registrations
  set status = 'archived',
      is_default = false,
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where party_id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';
  get diagnostics v_archived_registrations = row_count;

  update public.parties
  set status = 'archived',
      archived_at = now(),
      archived_by = v_user_id,
      updated_by = v_user_id
  where id = p_party_id
    and organization_id = p_organization_id
    and status = 'active';

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'party.archived',
    'party',
    p_party_id,
    jsonb_build_object(
      'archived_addresses', v_archived_addresses,
      'archived_tax_registrations', v_archived_registrations
    )
  );
end;
$$;

revoke all on function public.archive_party(uuid, uuid) from public;
grant execute on function public.archive_party(uuid, uuid) to authenticated;
