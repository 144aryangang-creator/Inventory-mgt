-- Evolve sales fulfillment from one full posting per invoice to multiple immutable partial postings.
-- Each fulfillment remains tied to exactly one warehouse. Aggregate fulfilled quantity across all
-- warehouses may never exceed the original issued invoice line quantity.

alter table public.sales_fulfillments
  drop constraint if exists sales_fulfillments_organization_id_financial_document_id_key;

alter table public.sales_fulfillments
  add column request_payload jsonb;

alter table public.sales_fulfillments
  add constraint sales_fulfillments_request_payload_shape
  check (request_payload is null or jsonb_typeof(request_payload) = 'array');

create index sales_fulfillments_org_document_posted_idx
  on public.sales_fulfillments (organization_id, financial_document_id, posted_at, id);

create or replace function app_private.invoice_line_is_stock_backed(
  p_organization_id uuid,
  p_financial_document_line_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((l.item_snapshot ->> 'track_inventory')::boolean, false)
  from public.financial_document_lines l
  where l.organization_id = p_organization_id
    and l.id = p_financial_document_line_id;
$$;

revoke all on function app_private.invoice_line_is_stock_backed(uuid, uuid) from public;

create or replace function public.get_sales_invoice_fulfillment_summary(
  p_organization_id uuid,
  p_financial_document_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_document public.financial_documents%rowtype;
  v_lines jsonb;
  v_stock_line_count integer;
  v_fulfilled_line_count integer;
  v_started_line_count integer;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.is_org_member(p_organization_id) then
    raise exception 'organization membership required' using errcode = '42501';
  end if;

  select * into v_document
  from public.financial_documents
  where id = p_financial_document_id
    and organization_id = p_organization_id
    and document_type = 'tax_invoice'::public.financial_document_type;

  if not found then
    raise exception 'tax invoice not found' using errcode = 'P0002';
  end if;

  with stock_lines as (
    select
      l.id,
      l.line_number,
      l.item_id,
      l.description,
      l.uom,
      l.quantity as invoiced_quantity,
      coalesce((
        select sum(fl.quantity)
        from public.sales_fulfillment_lines fl
        join public.sales_fulfillments f
          on f.id = fl.fulfillment_id
         and f.organization_id = fl.organization_id
        where fl.organization_id = l.organization_id
          and f.financial_document_id = l.document_id
          and fl.financial_document_line_id = l.id
      ), 0)::numeric(20,6) as fulfilled_quantity
    from public.financial_document_lines l
    where l.organization_id = p_organization_id
      and l.document_id = p_financial_document_id
      and l.item_id is not null
      and coalesce((l.item_snapshot ->> 'track_inventory')::boolean, false)
  ), summary as (
    select
      count(*)::integer as stock_line_count,
      count(*) filter (where fulfilled_quantity > 0)::integer as started_line_count,
      count(*) filter (where fulfilled_quantity >= invoiced_quantity)::integer as fulfilled_line_count
    from stock_lines
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'financialDocumentLineId', s.id,
      'lineNumber', s.line_number,
      'itemId', s.item_id,
      'description', s.description,
      'uom', s.uom,
      'invoicedQuantity', s.invoiced_quantity,
      'fulfilledQuantity', s.fulfilled_quantity,
      'remainingQuantity', greatest(s.invoiced_quantity - s.fulfilled_quantity, 0)
    ) order by s.line_number), '[]'::jsonb),
    max(x.stock_line_count),
    max(x.fulfilled_line_count),
    max(x.started_line_count)
  into v_lines, v_stock_line_count, v_fulfilled_line_count, v_started_line_count
  from stock_lines s
  cross join summary x;

  v_stock_line_count := coalesce(v_stock_line_count, 0);
  v_fulfilled_line_count := coalesce(v_fulfilled_line_count, 0);
  v_started_line_count := coalesce(v_started_line_count, 0);

  if v_stock_line_count = 0 then
    v_status := 'not_applicable';
  elsif v_started_line_count = 0 then
    v_status := 'unfulfilled';
  elsif v_fulfilled_line_count = v_stock_line_count then
    v_status := 'fulfilled';
  else
    v_status := 'partial';
  end if;

  return jsonb_build_object(
    'financialDocumentId', p_financial_document_id,
    'documentStatus', v_document.status,
    'status', v_status,
    'stockLineCount', v_stock_line_count,
    'lines', coalesce(v_lines, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_sales_invoice_fulfillment_summary(uuid, uuid) from public;
grant execute on function public.get_sales_invoice_fulfillment_summary(uuid, uuid) to authenticated;

create or replace function public.post_sales_fulfillment(
  p_organization_id uuid,
  p_financial_document_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.sales_fulfillments%rowtype;
  v_fulfillment_id uuid;
  v_entry jsonb;
  v_line_id uuid;
  v_quantity numeric(20,6);
  v_invoice_line public.financial_document_lines%rowtype;
  v_fulfilled numeric(20,6);
  v_movement_id uuid;
  v_seen_line_ids uuid[] := array[]::uuid[];
  v_line_count integer := 0;
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

  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one fulfillment line is required' using errcode = '22023';
  end if;

  -- Keep cancellation from racing a posting while allowing line-level serialization for capacity.
  perform 1
  from public.financial_documents d
  where d.id = p_financial_document_id
    and d.organization_id = p_organization_id
    and d.document_type = 'tax_invoice'::public.financial_document_type
    and d.status = 'issued'::public.financial_document_status
  for share;

  if not found then
    raise exception 'issued tax invoice not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.warehouses w
  where w.id = p_warehouse_id
    and w.organization_id = p_organization_id
    and w.is_active
  for share;

  if not found then
    raise exception 'active warehouse not found in organization' using errcode = '23503';
  end if;

  select * into v_existing
  from public.sales_fulfillments f
  where f.organization_id = p_organization_id
    and f.request_key = trim(p_request_key);

  if found then
    if v_existing.financial_document_id = p_financial_document_id
       and v_existing.warehouse_id = p_warehouse_id
       and v_existing.request_payload = p_lines then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to a different fulfillment' using errcode = '22023';
  end if;

  insert into public.sales_fulfillments (
    organization_id,
    financial_document_id,
    warehouse_id,
    request_key,
    request_payload,
    created_by
  ) values (
    p_organization_id,
    p_financial_document_id,
    p_warehouse_id,
    trim(p_request_key),
    p_lines,
    v_user_id
  ) returning id into v_fulfillment_id;

  for v_entry in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_line_id := (v_entry ->> 'financialDocumentLineId')::uuid;
      v_quantity := (v_entry ->> 'quantity')::numeric;
    exception when others then
      raise exception 'fulfillment lines require financialDocumentLineId uuid and decimal quantity' using errcode = '22023';
    end;

    if v_line_id is null or v_quantity is null then
      raise exception 'fulfillment lines require financialDocumentLineId uuid and decimal quantity' using errcode = '22023';
    end if;
    if v_line_id = any(v_seen_line_ids) then
      raise exception 'each invoice line may appear only once per fulfillment request' using errcode = '22023';
    end if;
    v_seen_line_ids := array_append(v_seen_line_ids, v_line_id);

    if v_quantity <= 0 then
      raise exception 'fulfillment quantity must be positive' using errcode = '23514';
    end if;

    -- The immutable original line is the shared capacity lock across all warehouses.
    select * into v_invoice_line
    from public.financial_document_lines l
    where l.id = v_line_id
      and l.organization_id = p_organization_id
      and l.document_id = p_financial_document_id
    for update;

    if not found then
      raise exception 'invoice line not found' using errcode = 'P0002';
    end if;

    if v_invoice_line.item_id is null
       or not coalesce((v_invoice_line.item_snapshot ->> 'track_inventory')::boolean, false) then
      raise exception 'invoice line is not stock-backed' using errcode = '23514';
    end if;

    select coalesce(sum(fl.quantity), 0)
    into v_fulfilled
    from public.sales_fulfillment_lines fl
    join public.sales_fulfillments f
      on f.id = fl.fulfillment_id
     and f.organization_id = fl.organization_id
    where fl.organization_id = p_organization_id
      and f.financial_document_id = p_financial_document_id
      and fl.financial_document_line_id = v_line_id;

    if v_quantity > v_invoice_line.quantity - v_fulfilled then
      raise exception 'fulfillment quantity exceeds remaining invoice quantity' using errcode = '23514';
    end if;

    select public.post_inventory_movement(
      p_organization_id,
      v_invoice_line.item_id,
      p_warehouse_id,
      'sale'::public.inventory_movement_type,
      -v_quantity,
      null,
      'sales_fulfillment',
      v_fulfillment_id,
      format('fulfill:%s:%s', v_fulfillment_id, v_line_id)
    ) into v_movement_id;

    insert into public.sales_fulfillment_lines (
      organization_id,
      fulfillment_id,
      financial_document_line_id,
      item_id,
      inventory_movement_id,
      quantity
    ) values (
      p_organization_id,
      v_fulfillment_id,
      v_line_id,
      v_invoice_line.item_id,
      v_movement_id,
      v_quantity
    );

    v_line_count := v_line_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    v_user_id,
    'sales_invoice.fulfillment_posted',
    'financial_document',
    p_financial_document_id,
    jsonb_build_object(
      'fulfillment_id', v_fulfillment_id,
      'warehouse_id', p_warehouse_id,
      'line_count', v_line_count,
      'request_key', trim(p_request_key)
    )
  );

  return v_fulfillment_id;
end;
$$;

revoke all on function public.post_sales_fulfillment(uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.post_sales_fulfillment(uuid, uuid, uuid, jsonb, text) to authenticated;

-- Compatibility wrapper: fulfil every remaining stock-backed quantity from one warehouse.
-- For a partially fulfilled invoice this posts only the remaining quantities.
create or replace function public.fulfill_sales_invoice(
  p_organization_id uuid,
  p_financial_document_id uuid,
  p_warehouse_id uuid,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.sales_fulfillments%rowtype;
  v_lines jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_existing
  from public.sales_fulfillments f
  where f.organization_id = p_organization_id
    and f.request_key = trim(p_request_key);

  if found then
    if v_existing.financial_document_id = p_financial_document_id
       and v_existing.warehouse_id = p_warehouse_id then
      return v_existing.id;
    end if;
    raise exception 'request key already belongs to another fulfillment' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'financialDocumentLineId', l.id,
    'quantity', l.quantity - coalesce((
      select sum(fl.quantity)
      from public.sales_fulfillment_lines fl
      join public.sales_fulfillments f
        on f.id = fl.fulfillment_id
       and f.organization_id = fl.organization_id
      where fl.organization_id = l.organization_id
        and f.financial_document_id = l.document_id
        and fl.financial_document_line_id = l.id
    ), 0)
  ) order by l.line_number) filter (where l.quantity > coalesce((
      select sum(fl.quantity)
      from public.sales_fulfillment_lines fl
      join public.sales_fulfillments f
        on f.id = fl.fulfillment_id
       and f.organization_id = fl.organization_id
      where fl.organization_id = l.organization_id
        and f.financial_document_id = l.document_id
        and fl.financial_document_line_id = l.id
    ), 0)), '[]'::jsonb)
  into v_lines
  from public.financial_document_lines l
  where l.organization_id = p_organization_id
    and l.document_id = p_financial_document_id
    and l.item_id is not null
    and coalesce((l.item_snapshot ->> 'track_inventory')::boolean, false);

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'invoice has no remaining stock-backed quantity to fulfill' using errcode = '23514';
  end if;

  return public.post_sales_fulfillment(
    p_organization_id,
    p_financial_document_id,
    p_warehouse_id,
    v_lines,
    p_request_key
  );
end;
$$;

revoke all on function public.fulfill_sales_invoice(uuid, uuid, uuid, text) from public;
grant execute on function public.fulfill_sales_invoice(uuid, uuid, uuid, text) to authenticated;
