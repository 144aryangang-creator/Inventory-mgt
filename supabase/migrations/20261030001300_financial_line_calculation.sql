-- Financial arithmetic is authoritative in PostgreSQL.
-- Clients submit quantity, unit price, discount and tax rates only; taxable/tax amounts are derived.

revoke execute on function public.upsert_financial_document_line(
  uuid, uuid, integer, text, numeric, text, numeric, numeric, uuid, jsonb, text, numeric, jsonb
) from authenticated;

create or replace function public.upsert_financial_document_line_calculated(
  p_organization_id uuid,
  p_document_id uuid,
  p_line_number integer,
  p_description text,
  p_quantity numeric,
  p_uom text,
  p_unit_price numeric,
  p_item_id uuid default null,
  p_item_snapshot jsonb default '{}'::jsonb,
  p_hsn_sac text default null,
  p_discount_amount numeric default 0,
  p_taxes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_line_id uuid;
  v_tax record;
  v_gross_value numeric(20,6);
  v_taxable_value numeric(20,6);
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

  perform 1 from public.financial_documents
  where id = p_document_id
    and organization_id = p_organization_id
    and status = 'draft'
  for update;
  if not found then
    raise exception 'editable draft financial document not found' using errcode = 'P0002';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = '23514';
  end if;

  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'unit price must be non-negative' using errcode = '23514';
  end if;

  if p_discount_amount is null or p_discount_amount < 0 then
    raise exception 'discount must be non-negative' using errcode = '23514';
  end if;

  if p_item_snapshot is null or jsonb_typeof(p_item_snapshot) <> 'object' then
    raise exception 'item_snapshot must be a JSON object' using errcode = '22023';
  end if;

  if p_taxes is null or jsonb_typeof(p_taxes) <> 'array' then
    raise exception 'taxes must be a JSON array' using errcode = '22023';
  end if;

  if p_item_id is not null then
    perform 1 from public.items
    where id = p_item_id and organization_id = p_organization_id and is_active;
    if not found then
      raise exception 'active item not found in organization' using errcode = '23503';
    end if;
  end if;

  v_gross_value := round(p_quantity * p_unit_price, 6);
  if p_discount_amount > v_gross_value then
    raise exception 'discount cannot exceed gross line value' using errcode = '23514';
  end if;
  v_taxable_value := round(v_gross_value - p_discount_amount, 6);

  insert into public.financial_document_lines (
    organization_id, document_id, line_number, item_id, item_snapshot, description,
    hsn_sac, quantity, uom, unit_price, discount_amount, taxable_value
  ) values (
    p_organization_id, p_document_id, p_line_number, p_item_id, p_item_snapshot, trim(p_description),
    nullif(trim(p_hsn_sac), ''), p_quantity, trim(p_uom), p_unit_price, p_discount_amount, v_taxable_value
  )
  on conflict (organization_id, document_id, line_number) do update set
    item_id = excluded.item_id,
    item_snapshot = excluded.item_snapshot,
    description = excluded.description,
    hsn_sac = excluded.hsn_sac,
    quantity = excluded.quantity,
    uom = excluded.uom,
    unit_price = excluded.unit_price,
    discount_amount = excluded.discount_amount,
    taxable_value = excluded.taxable_value
  returning id into v_line_id;

  delete from public.financial_document_line_taxes
  where organization_id = p_organization_id and line_id = v_line_id;

  for v_tax in
    select * from jsonb_to_recordset(p_taxes) as x(component text, rate numeric)
  loop
    if v_tax.rate is null or v_tax.rate < 0 or v_tax.rate > 100 then
      raise exception 'tax rate must be between 0 and 100' using errcode = '23514';
    end if;

    insert into public.financial_document_line_taxes (
      organization_id, line_id, component, rate, amount
    ) values (
      p_organization_id,
      v_line_id,
      upper(trim(v_tax.component))::public.tax_component,
      v_tax.rate,
      round(v_taxable_value * v_tax.rate / 100, 6)
    );
  end loop;

  update public.financial_documents
  set updated_by = v_user_id
  where id = p_document_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, v_user_id, 'financial_document.line_upserted', 'financial_document', p_document_id,
    jsonb_build_object(
      'line_number', p_line_number,
      'gross_value', v_gross_value,
      'discount_amount', p_discount_amount,
      'taxable_value', v_taxable_value
    )
  );

  return v_line_id;
end;
$$;

revoke all on function public.upsert_financial_document_line_calculated(
  uuid, uuid, integer, text, numeric, text, numeric, uuid, jsonb, text, numeric, jsonb
) from public;

grant execute on function public.upsert_financial_document_line_calculated(
  uuid, uuid, integer, text, numeric, text, numeric, uuid, jsonb, text, numeric, jsonb
) to authenticated;
