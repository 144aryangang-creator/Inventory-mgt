-- Derive recipient invoice snapshots from tenant-owned active party profile records.
-- This removes free-form bill-to/ship-to JSON from the authenticated invoice creation path.

alter table public.party_addresses
  add constraint party_addresses_invoice_reference_uq
  unique (id, organization_id, party_id);

alter table public.party_tax_registrations
  add constraint party_tax_registrations_invoice_reference_uq
  unique (id, organization_id, party_id);

alter table public.financial_documents
  add column billing_address_id uuid,
  add column shipping_address_id uuid,
  add column recipient_tax_registration_id uuid;

alter table public.financial_documents
  add constraint financial_documents_billing_address_fk
  foreign key (billing_address_id, organization_id, recipient_party_id)
  references public.party_addresses(id, organization_id, party_id)
  on delete restrict,
  add constraint financial_documents_shipping_address_fk
  foreign key (shipping_address_id, organization_id, recipient_party_id)
  references public.party_addresses(id, organization_id, party_id)
  on delete restrict,
  add constraint financial_documents_recipient_tax_registration_fk
  foreign key (recipient_tax_registration_id, organization_id, recipient_party_id)
  references public.party_tax_registrations(id, organization_id, party_id)
  on delete restrict;

create index financial_documents_recipient_profile_idx
  on public.financial_documents (
    organization_id, recipient_party_id, billing_address_id, recipient_tax_registration_id, document_date desc
  );

create or replace function app_private.party_invoice_snapshot(
  p_organization_id uuid,
  p_party_id uuid,
  p_address_id uuid,
  p_tax_registration_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_party public.parties%rowtype;
  v_address public.party_addresses%rowtype;
  v_tax public.party_tax_registrations%rowtype;
  v_tax_json jsonb := jsonb_build_object(
    'tax_registration_id', null,
    'tax_scheme', null,
    'tax_registration_number', null,
    'tax_registered_name', null,
    'tax_state_code', null,
    'tax_verification_status', null
  );
begin
  select p.* into v_party
  from public.parties p
  where p.id = p_party_id
    and p.organization_id = p_organization_id
    and p.status = 'active';

  if not found then
    raise exception 'active recipient party not found' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.party_roles r
    where r.organization_id = p_organization_id
      and r.party_id = p_party_id
      and r.role = 'customer'
  ) then
    raise exception 'recipient party must have customer role' using errcode = '23503';
  end if;

  select a.* into v_address
  from public.party_addresses a
  where a.id = p_address_id
    and a.organization_id = p_organization_id
    and a.party_id = p_party_id
    and a.status = 'active';

  if not found then
    raise exception 'active recipient address not found' using errcode = '23503';
  end if;

  if p_tax_registration_id is not null then
    select t.* into v_tax
    from public.party_tax_registrations t
    where t.id = p_tax_registration_id
      and t.organization_id = p_organization_id
      and t.party_id = p_party_id
      and t.status = 'active';

    if not found then
      raise exception 'active recipient tax registration not found' using errcode = '23503';
    end if;

    v_tax_json := jsonb_build_object(
      'tax_registration_id', v_tax.id,
      'tax_scheme', v_tax.scheme,
      'tax_registration_number', v_tax.registration_number,
      'tax_registered_name', v_tax.registered_name,
      'tax_state_code', v_tax.state_code,
      'tax_verification_status', v_tax.verification_status
    );
  end if;

  return jsonb_build_object(
    'party_id', v_party.id,
    'party_code', v_party.code,
    'legal_name', v_party.legal_name,
    'display_name', v_party.display_name,
    'email', v_party.email,
    'phone', v_party.phone,
    'address_id', v_address.id,
    'address_label', v_address.label,
    'recipient_name', coalesce(v_address.recipient_name, v_party.legal_name),
    'address_line_1', v_address.address_line_1,
    'address_line_2', v_address.address_line_2,
    'city', v_address.city,
    'district', v_address.district,
    'state_name', v_address.state_name,
    'state_code', v_address.state_code,
    'postal_code', v_address.postal_code,
    'country_code', v_address.country_code,
    'is_registered_address', v_address.is_registered_address
  ) || v_tax_json;
end;
$$;

create or replace function app_private.party_shipping_snapshot(
  p_organization_id uuid,
  p_party_id uuid,
  p_address_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return app_private.party_invoice_snapshot(
    p_organization_id,
    p_party_id,
    p_address_id,
    null
  ) - array[
    'tax_registration_id',
    'tax_scheme',
    'tax_registration_number',
    'tax_registered_name',
    'tax_state_code',
    'tax_verification_status'
  ];
end;
$$;

revoke all on function app_private.party_invoice_snapshot(uuid, uuid, uuid, uuid) from public;
revoke all on function app_private.party_shipping_snapshot(uuid, uuid, uuid) from public;

-- The seller-only RPC still accepted free-form buyer JSON. Keep it internal only.
revoke execute on function public.create_financial_document_draft_from_profile(
  uuid, uuid, public.financial_document_type, date, text, public.supply_type, jsonb,
  uuid, uuid, text, text, boolean, jsonb, text
) from authenticated;

create or replace function public.create_financial_document_draft_from_profiles(
  p_organization_id uuid,
  p_supplier_profile_id uuid,
  p_document_type public.financial_document_type,
  p_document_date date,
  p_series_code text,
  p_supply_type public.supply_type,
  p_recipient_party_id uuid,
  p_billing_address_id uuid,
  p_shipping_address_id uuid default null,
  p_recipient_tax_registration_id uuid default null,
  p_linked_document_id uuid default null,
  p_currency_code text default 'INR',
  p_place_of_supply_state_code text default null,
  p_reverse_charge boolean default false,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_bill_to_snapshot jsonb;
  v_ship_to_snapshot jsonb;
  v_shipping_address_id uuid := coalesce(p_shipping_address_id, p_billing_address_id);
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

  v_bill_to_snapshot := app_private.party_invoice_snapshot(
    p_organization_id,
    p_recipient_party_id,
    p_billing_address_id,
    p_recipient_tax_registration_id
  );

  v_ship_to_snapshot := app_private.party_shipping_snapshot(
    p_organization_id,
    p_recipient_party_id,
    v_shipping_address_id
  );

  select public.create_financial_document_draft_from_profile(
    p_organization_id,
    p_supplier_profile_id,
    p_document_type,
    p_document_date,
    p_series_code,
    p_supply_type,
    v_bill_to_snapshot,
    p_recipient_party_id,
    p_linked_document_id,
    p_currency_code,
    p_place_of_supply_state_code,
    p_reverse_charge,
    v_ship_to_snapshot,
    p_notes
  ) into v_document_id;

  update public.financial_documents
  set billing_address_id = p_billing_address_id,
      shipping_address_id = v_shipping_address_id,
      recipient_tax_registration_id = p_recipient_tax_registration_id,
      updated_by = v_user_id
  where id = v_document_id
    and organization_id = p_organization_id
    and status = 'draft';

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'financial_document.recipient_profile_bound',
    'financial_document',
    v_document_id,
    jsonb_build_object(
      'recipient_party_id', p_recipient_party_id,
      'billing_address_id', p_billing_address_id,
      'shipping_address_id', v_shipping_address_id,
      'recipient_tax_registration_id', p_recipient_tax_registration_id
    )
  );

  return v_document_id;
end;
$$;

revoke all on function public.create_financial_document_draft_from_profiles(
  uuid, uuid, public.financial_document_type, date, text, public.supply_type,
  uuid, uuid, uuid, uuid, uuid, text, text, boolean, text
) from public;

grant execute on function public.create_financial_document_draft_from_profiles(
  uuid, uuid, public.financial_document_type, date, text, public.supply_type,
  uuid, uuid, uuid, uuid, uuid, text, text, boolean, text
) to authenticated;
