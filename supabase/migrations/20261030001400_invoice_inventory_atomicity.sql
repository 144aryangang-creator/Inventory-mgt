-- Bind invoice lines to selected stock items/warehouses and post sales inventory atomically on issue.
-- Item snapshots are derived by PostgreSQL; authenticated clients cannot forge authoritative item identity.

alter table public.financial_document_lines
  add column source_warehouse_id uuid;

alter table public.financial_document_lines
  add constraint financial_document_lines_source_warehouse_fk
  foreign key (source_warehouse_id, organization_id)
  references public.warehouses(id, organization_id) on delete restrict;

create index financial_document_lines_source_warehouse_idx
  on public.financial_document_lines (organization_id, source_warehouse_id)
  where source_warehouse_id is not null;

create or replace function app_private.build_item_snapshot(
  p_organization_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  select * into v_item
  from public.items
  where id = p_item_id
    and organization_id = p_organization_id
    and is_active;

  if not found then
    raise exception 'active item not found in organization' using errcode = '23503';
  end if;

  return jsonb_build_object(
    'item_id', v_item.id,
    'sku', v_item.sku,
    'name', v_item.name,
    'description', v_item.description,
    'base_uom', v_item.base_uom,
    'track_inventory', v_item.track_inventory
  );
end;
$$;

revoke all on function app_private.build_item_snapshot(uuid, uuid) from public;

-- Supersede the prior authenticated line RPC because it accepted arbitrary item_snapshot JSON.
revoke execute on function public.upsert_financial_document_line_calculated(
  uuid, uuid, integer, text, numeric, text, numeric, uuid, jsonb, text, numeric, jsonb
) from authenticated;

create or replace function public.upsert_financial_document_line_from_item(
  p_organization_id uuid,
  p_document_id uuid,
  p_line_number integer,
  p_description text,
  p_quantity numeric,
  p_uom text,
  p_unit_price numeric,
  p_item_id uuid default null,
  p_source_warehouse_id uuid default null,
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
  v_item public.items%rowtype;
  v_item_snapshot jsonb := '{}'::jsonb;
  v_description text;
  v_uom text;
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

  if p_taxes is null or jsonb_typeof(p_taxes) <> 'array' then
    raise exception 'taxes must be a JSON array' using errcode = '22023';
  end if;

  if p_item_id is not null then
    select * into v_item
    from public.items
    where id = p_item_id
      and organization_id = p_organization_id
      and is_active;

    if not found then
      raise exception 'active item not found in organization' using errcode = '23503';
    end if;

    v_item_snapshot := app_private.build_item_snapshot(p_organization_id, p_item_id);
    v_description := coalesce(nullif(trim(p_description), ''), v_item.name);
    v_uom := coalesce(nullif(trim(p_uom), ''), v_item.base_uom);

    if v_item.track_inventory then
      if p_source_warehouse_id is null then
        raise exception 'source warehouse is required for inventory-tracked item' using errcode = '23514';
      end if;

      perform 1 from public.warehouses
      where id = p_source_warehouse_id
        and organization_id = p_organization_id
        and is_active;
      if not found then
        raise exception 'active source warehouse not found in organization' using errcode = '23503';
      end if;
    elsif p_source_warehouse_id is not null then
      raise exception 'source warehouse is only valid for inventory-tracked items' using errcode = '23514';
    end if;
  else
    if p_source_warehouse_id is not null then
      raise exception 'source warehouse requires an item' using errcode = '23514';
    end if;

    v_description := nullif(trim(p_description), '');
    v_uom := nullif(trim(p_uom), '');

    if v_description is null then
      raise exception 'description is required for free-form line' using errcode = '23514';
    end if;
    if v_uom is null then
      raise exception 'uom is required for free-form line' using errcode = '23514';
    end if;
  end if;

  v_gross_value := round(p_quantity * p_unit_price, 6);
  if p_discount_amount > v_gross_value then
    raise exception 'discount cannot exceed gross line value' using errcode = '23514';
  end if;
  v_taxable_value := round(v_gross_value - p_discount_amount, 6);

  insert into public.financial_document_lines (
    organization_id, document_id, line_number, item_id, source_warehouse_id,
    item_snapshot, description, hsn_sac, quantity, uom, unit_price,
    discount_amount, taxable_value
  ) values (
    p_organization_id, p_document_id, p_line_number, p_item_id, p_source_warehouse_id,
    v_item_snapshot, v_description, nullif(trim(p_hsn_sac), ''), p_quantity, v_uom,
    p_unit_price, p_discount_amount, v_taxable_value
  )
  on conflict (organization_id, document_id, line_number) do update set
    item_id = excluded.item_id,
    source_warehouse_id = excluded.source_warehouse_id,
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
      'item_id', p_item_id,
      'source_warehouse_id', p_source_warehouse_id,
      'gross_value', v_gross_value,
      'discount_amount', p_discount_amount,
      'taxable_value', v_taxable_value
    )
  );

  return v_line_id;
end;
$$;

revoke all on function public.upsert_financial_document_line_from_item(
  uuid, uuid, integer, text, numeric, text, numeric, uuid, uuid, text, numeric, jsonb
) from public;

grant execute on function public.upsert_financial_document_line_from_item(
  uuid, uuid, integer, text, numeric, text, numeric, uuid, uuid, text, numeric, jsonb
) to authenticated;

create or replace function app_private.post_tax_invoice_inventory_on_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_request_key text;
begin
  if old.status = 'draft'
     and new.status = 'issued'
     and new.document_type = 'tax_invoice' then
    for v_line in
      select l.id, l.line_number, l.item_id, l.source_warehouse_id, l.quantity
      from public.financial_document_lines l
      join public.items i
        on i.id = l.item_id
       and i.organization_id = l.organization_id
      where l.organization_id = new.organization_id
        and l.document_id = new.id
        and i.track_inventory
      order by l.line_number
    loop
      if v_line.source_warehouse_id is null then
        raise exception 'source warehouse missing for tracked invoice line %', v_line.line_number
          using errcode = '23514';
      end if;

      v_request_key := 'tax-invoice-sale:' || new.id::text || ':line:' || v_line.line_number::text;

      perform public.post_inventory_movement(
        new.organization_id,
        v_line.item_id,
        v_line.source_warehouse_id,
        'sale'::public.inventory_movement_type,
        -v_line.quantity,
        null,
        'financial_document',
        new.id,
        v_request_key,
        new.issued_at
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function app_private.post_tax_invoice_inventory_on_issue() from public;

create trigger financial_documents_post_inventory_on_issue
after update on public.financial_documents
for each row execute function app_private.post_tax_invoice_inventory_on_issue();
