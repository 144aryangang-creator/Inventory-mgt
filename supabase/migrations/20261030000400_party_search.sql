-- Tenant-checked search/list service for party master data.
-- SECURITY DEFINER is intentional: explicit membership authorization is mandatory before query execution.

create or replace function public.search_parties(
  p_organization_id uuid,
  p_role public.party_role default null,
  p_status public.party_status default 'active',
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  organization_id uuid,
  code text,
  legal_name text,
  display_name text,
  email text,
  phone text,
  status public.party_status,
  roles public.party_role[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
  v_query text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.is_org_member(p_organization_id) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_query := nullif(trim(p_query), '');

  return query
  select
    p.id,
    p.organization_id,
    p.code,
    p.legal_name,
    p.display_name,
    p.email,
    p.phone,
    p.status,
    array(
      select pr.role
      from public.party_roles pr
      where pr.organization_id = p.organization_id
        and pr.party_id = p.id
      order by pr.role
    )::public.party_role[] as roles,
    p.created_at,
    p.updated_at
  from public.parties p
  where p.organization_id = p_organization_id
    and p.status = coalesce(p_status, 'active'::public.party_status)
    and (
      p_role is null
      or exists (
        select 1
        from public.party_roles role_filter
        where role_filter.organization_id = p.organization_id
          and role_filter.party_id = p.id
          and role_filter.role = p_role
      )
    )
    and (
      v_query is null
      or p.code ilike ('%' || v_query || '%')
      or p.display_name ilike ('%' || v_query || '%')
      or p.legal_name ilike ('%' || v_query || '%')
    )
  order by p.display_name, p.id
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.search_parties(
  uuid, public.party_role, public.party_status, text, integer, integer
) from public;
grant execute on function public.search_parties(
  uuid, public.party_role, public.party_status, text, integer, integer
) to authenticated;
