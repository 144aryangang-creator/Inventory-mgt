-- Keep the legacy full/remaining-quantity wrapper safe on idempotent retry paths.
-- The wrapper is retained for compatibility; new clients should use post_sales_fulfillment(...).

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

  if not app_private.has_org_role(
    p_organization_id,
    array['owner','admin','staff']::public.organization_role[]
  ) then
    raise exception 'insufficient organization permission' using errcode = '42501';
  end if;

  if p_request_key is null or char_length(trim(p_request_key)) = 0 or char_length(trim(p_request_key)) > 128 then
    raise exception 'request key is required and must be at most 128 characters' using errcode = '22023';
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
