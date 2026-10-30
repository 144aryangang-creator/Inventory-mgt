-- Operational dashboard summary.
-- Money is aggregated in PostgreSQL and always grouped by currency. Inventory quantities are not
-- summed across unrelated items/UOMs; the dashboard reports counts/statuses instead.

create index if not exists audit_events_org_created_idx
  on public.audit_events (organization_id, created_at desc, id);

create index if not exists financial_documents_dashboard_idx
  on public.financial_documents (organization_id, status, document_type, document_date desc, currency_code);

create index if not exists purchase_receipts_dashboard_idx
  on public.purchase_receipts (organization_id, received_at desc);

create or replace function public.get_operational_dashboard_summary(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_window_start timestamptz;
  v_sales jsonb;
  v_inventory jsonb;
  v_receiving jsonb;
  v_fulfillment jsonb;
  v_activity jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.is_org_member(p_organization_id) then
    raise exception 'organization membership required' using errcode = '42501';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'dashboard window must be between 1 and 365 days' using errcode = '22023';
  end if;

  v_window_start := now() - make_interval(days => p_days);

  with currencies as (
    select distinct d.currency_code
    from public.financial_documents d
    where d.organization_id = p_organization_id
      and d.status = 'issued'::public.financial_document_status
      and d.issued_at >= v_window_start
  ), totals as (
    select
      c.currency_code,
      count(*) filter (where d.document_type = 'tax_invoice'::public.financial_document_type)::integer as invoice_count,
      coalesce(sum(d.grand_total) filter (where d.document_type = 'tax_invoice'::public.financial_document_type), 0)::numeric(20,6) as invoice_total,
      count(*) filter (where d.document_type = 'credit_note'::public.financial_document_type)::integer as credit_note_count,
      coalesce(sum(d.grand_total) filter (where d.document_type = 'credit_note'::public.financial_document_type), 0)::numeric(20,6) as credit_note_total,
      count(*) filter (where d.document_type = 'debit_note'::public.financial_document_type)::integer as debit_note_count,
      coalesce(sum(d.grand_total) filter (where d.document_type = 'debit_note'::public.financial_document_type), 0)::numeric(20,6) as debit_note_total
    from currencies c
    left join public.financial_documents d
      on d.organization_id = p_organization_id
     and d.currency_code = c.currency_code
     and d.status = 'issued'::public.financial_document_status
     and d.issued_at >= v_window_start
    group by c.currency_code
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'currencyCode', currency_code,
    'invoiceCount', invoice_count,
    'invoiceTotal', invoice_total,
    'creditNoteCount', credit_note_count,
    'creditNoteTotal', credit_note_total,
    'debitNoteCount', debit_note_count,
    'debitNoteTotal', debit_note_total,
    'netDocumentValue', invoice_total - credit_note_total + debit_note_total
  ) order by currency_code), '[]'::jsonb)
  into v_sales
  from totals;

  select jsonb_build_object(
    'activeTrackedItems', (
      select count(*)::integer
      from public.items i
      where i.organization_id = p_organization_id
        and i.is_active
        and i.track_inventory
    ),
    'activeServiceItems', (
      select count(*)::integer
      from public.items i
      where i.organization_id = p_organization_id
        and i.is_active
        and not i.track_inventory
    ),
    'activeWarehouses', (
      select count(*)::integer
      from public.warehouses w
      where w.organization_id = p_organization_id
        and w.is_active
    ),
    'positiveStockPositions', (
      select count(*)::integer
      from public.inventory_balances b
      join public.items i
        on i.id = b.item_id and i.organization_id = b.organization_id
      join public.warehouses w
        on w.id = b.warehouse_id and w.organization_id = b.organization_id
      where b.organization_id = p_organization_id
        and i.is_active and i.track_inventory and w.is_active
        and b.quantity_on_hand > 0
    ),
    'negativeStockPositions', (
      select count(*)::integer
      from public.inventory_balances b
      join public.items i
        on i.id = b.item_id and i.organization_id = b.organization_id
      join public.warehouses w
        on w.id = b.warehouse_id and w.organization_id = b.organization_id
      where b.organization_id = p_organization_id
        and i.is_active and i.track_inventory and w.is_active
        and b.quantity_on_hand < 0
    )
  ) into v_inventory;

  select jsonb_build_object(
    'receiptCount', count(*)::integer,
    'receiptLineCount', coalesce(sum(line_count), 0)::integer,
    'supplierCount', count(distinct supplier_party_id)::integer
  )
  into v_receiving
  from (
    select r.id, r.supplier_party_id, count(l.line_number)::integer as line_count
    from public.purchase_receipts r
    left join public.purchase_receipt_lines l
      on l.receipt_id = r.id
     and l.organization_id = r.organization_id
    where r.organization_id = p_organization_id
      and r.received_at >= v_window_start
    group by r.id, r.supplier_party_id
  ) x;

  with issued_stock_invoices as (
    select d.id
    from public.financial_documents d
    where d.organization_id = p_organization_id
      and d.document_type = 'tax_invoice'::public.financial_document_type
      and d.status = 'issued'::public.financial_document_status
      and exists (
        select 1
        from public.financial_document_lines l
        where l.organization_id = d.organization_id
          and l.document_id = d.id
          and l.item_id is not null
          and coalesce((l.item_snapshot ->> 'track_inventory')::boolean, false)
      )
  ), line_progress as (
    select
      d.id as document_id,
      l.id as line_id,
      l.quantity as invoiced_quantity,
      coalesce(sum(fl.quantity), 0)::numeric(20,6) as fulfilled_quantity
    from issued_stock_invoices d
    join public.financial_document_lines l
      on l.document_id = d.id
     and l.organization_id = p_organization_id
     and l.item_id is not null
     and coalesce((l.item_snapshot ->> 'track_inventory')::boolean, false)
    left join public.sales_fulfillment_lines fl
      on fl.organization_id = l.organization_id
     and fl.financial_document_line_id = l.id
    left join public.sales_fulfillments f
      on f.organization_id = fl.organization_id
     and f.id = fl.fulfillment_id
     and f.financial_document_id = d.id
    group by d.id, l.id, l.quantity
  ), invoice_progress as (
    select
      document_id,
      bool_or(fulfilled_quantity > 0) as any_started,
      bool_and(fulfilled_quantity >= invoiced_quantity) as all_complete
    from line_progress
    group by document_id
  )
  select jsonb_build_object(
    'unfulfilledInvoices', count(*) filter (where not any_started)::integer,
    'partialInvoices', count(*) filter (where any_started and not all_complete)::integer,
    'fulfilledInvoices', count(*) filter (where all_complete)::integer
  )
  into v_fulfillment
  from invoice_progress;

  select jsonb_build_object(
    'auditEventCount', count(*)::integer,
    'activeUsers', count(distinct actor_user_id)::integer
  )
  into v_activity
  from public.audit_events a
  where a.organization_id = p_organization_id
    and a.created_at >= v_window_start;

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'generatedAt', now(),
    'windowDays', p_days,
    'salesByCurrency', coalesce(v_sales, '[]'::jsonb),
    'inventory', coalesce(v_inventory, '{}'::jsonb),
    'receiving', coalesce(v_receiving, '{}'::jsonb),
    'fulfillment', coalesce(v_fulfillment, '{}'::jsonb),
    'activity', coalesce(v_activity, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.get_operational_dashboard_summary(uuid, integer) from public;
grant execute on function public.get_operational_dashboard_summary(uuid, integer) to authenticated;
