-- Financial documents must derive seller legal identity from an active organization billing profile.
-- The legacy arbitrary-supplier-snapshot RPC remains only as an internal implementation helper.

alter table public.financial_documents
  add column supplier_profile_id uuid;

alter table public.financial_documents
  add constraint financial_documents_supplier_profile_fk
  foreign key (supplier_profile_id, organization_id)
  references public.organization_billing_profiles(id, organization_id)
  on delete restrict;

create index financial_documents_supplier_profile_idx
  on public.financial_documents (organization_id, supplier_profile_id, document_date desc)
  where supplier_profile_id is not null;

-- Clients may no longer call the legacy RPC that accepts arbitrary supplier JSON.
revoke execute on function public.create_financial_document_draft(
  uuid, public.financial_document_type, date, text, public.supply_type, jsonb, jsonb,
  uuid, uuid, text, text, text, boolean, jsonb, text
) from authenticated;

create or replace function public.create_financial_document_draft_from_profile(
  p_organization_id uuid,
  p_supplier_profile_id uuid,
  p_document_type public.financial_document_type,
  p_document_date date,
  p_series_code text,
  p_supply_type public.supply_type,
  p_bill_to_snapshot jsonb,
  p_recipient_party_id uuid default null,
  p_linked_document_id uuid default null,
  p_currency_code text default 'INR',
  p_place_of_supply_state_code text default null,
  p_reverse_charge boolean default false,
  p_ship_to_snapshot jsonb default '{}'::jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_snapshot jsonb;
  v_document_id uuid;
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

  -- The profile lookup is tenant-scoped and requires an active profile.
  v_supplier_snapshot := app_private.organization_billing_profile_snapshot(
    p_organization_id,
    p_supplier_profile_id
  );

  select public.create_financial_document_draft(
    p_organization_id,
    p_document_type,
    p_document_date,
    p_series_code,
    p_supply_type,
    v_supplier_snapshot,
    p_bill_to_snapshot,
    p_recipient_party_id,
    p_linked_document_id,
    p_currency_code,
    v_supplier_snapshot ->> 'state_code',
    p_place_of_supply_state_code,
    p_reverse_charge,
    p_ship_to_snapshot,
    p_notes
  ) into v_document_id;

  update public.financial_documents
  set supplier_profile_id = p_supplier_profile_id,
      updated_by = v_user_id
  where id = v_document_id
    and organization_id = p_organization_id
    and status = 'draft';

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'financial_document.supplier_profile_bound',
    'financial_document',
    v_document_id,
    jsonb_build_object('supplier_profile_id', p_supplier_profile_id)
  );

  return v_document_id;
end;
$$;

revoke all on function public.create_financial_document_draft_from_profile(
  uuid, uuid, public.financial_document_type, date, text, public.supply_type, jsonb,
  uuid, uuid, text, text, boolean, jsonb, text
) from public;

grant execute on function public.create_financial_document_draft_from_profile(
  uuid, uuid, public.financial_document_type, date, text, public.supply_type, jsonb,
  uuid, uuid, text, text, boolean, jsonb, text
) to authenticated;
