-- Prevent tenant-owned records from being reassigned to another organization.
-- Cross-tenant moves must be modeled as explicit business operations, never row edits.

create or replace function app_private.reject_organization_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger items_organization_immutable
before update on public.items
for each row execute function app_private.reject_organization_reassignment();

create trigger warehouses_organization_immutable
before update on public.warehouses
for each row execute function app_private.reject_organization_reassignment();
