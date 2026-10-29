begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

select has_column(
  'public', 'financial_document_lines', 'source_warehouse_id',
  'invoice lines bind tracked items to a source warehouse'
);

insert into auth.users (id, email) values
  ('91919191-9191-4191-8191-919191919191', 'invoice-stock-owner@test.local');

insert into public.organizations (id, name, slug) values
  ('91919191-aaaa-4aaa-8aaa-919191919191', 'Invoice Stock Tenant', 'invoice-stock-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('91919191-aaaa-4aaa-8aaa-919191919191', '91919191-9191-4191-8191-919191919191', 'owner');

insert into public.items (
  id, organization_id, sku, name, description, base_uom, track_inventory, is_active
) values
  (
    '91919191-bbbb-4bbb-8bbb-919191919191',
    '91919191-aaaa-4aaa-8aaa-919191919191',
    'TRACTOR-001', 'Test Tractor', 'Inventory linked invoice item', 'EA', true, true
  );

insert into public.warehouses (id, organization_id, code, name, is_active) values
  (
    '91919191-cccc-4ccc-8ccc-919191919191',
    '91919191-aaaa-4aaa-8aaa-919191919191',
    'MAIN', 'Main Warehouse', true
  );

insert into public.financial_documents (
  id, organization_id, document_type, document_date, series_code, supply_type,
  supplier_snapshot, bill_to_snapshot, created_by, updated_by, notes
) values
  (
    '91919191-dddd-4ddd-8ddd-919191919191',
    '91919191-aaaa-4aaa-8aaa-919191919191',
    'tax_invoice', '2026-10-30', 'INV', 'intra_state',
    '{"legal_name":"Stock Seller"}'::jsonb,
    '{"legal_name":"Stock Buyer"}'::jsonb,
    '91919191-9191-4191-8191-919191919191',
    '91919191-9191-4191-8191-919191919191',
    'stock invoice success'
  ),
  (
    '91919191-eeee-4eee-8eee-919191919191',
    '91919191-aaaa-4aaa-8aaa-919191919191',
    'tax_invoice', '2026-10-30', 'INV', 'intra_state',
    '{"legal_name":"Stock Seller"}'::jsonb,
    '{"legal_name":"Stock Buyer"}'::jsonb,
    '91919191-9191-4191-8191-919191919191',
    '91919191-9191-4191-8191-919191919191',
    'stock invoice insufficient'
  );

set local role authenticated;
set local request.jwt.claim.sub = '91919191-9191-4191-8191-919191919191';

select throws_ok(
  $$select public.upsert_financial_document_line_calculated(
      '91919191-aaaa-4aaa-8aaa-919191919191',
      '91919191-dddd-4ddd-8ddd-919191919191',
      1, 'Forged item snapshot', 1, 'EA', 100,
      '91919191-bbbb-4bbb-8bbb-919191919191',
      '{"sku":"FORGED","name":"Forged"}'::jsonb,
      null, 0, '[]'::jsonb
    )$$,
  '42501',
  null,
  'authenticated clients cannot call the older arbitrary item snapshot line RPC'
);

-- Seed five units of stock through the real inventory posting path.
do $$
begin
  perform public.post_inventory_movement(
    '91919191-aaaa-4aaa-8aaa-919191919191',
    '91919191-bbbb-4bbb-8bbb-919191919191',
    '91919191-cccc-4ccc-8ccc-919191919191',
    'receipt', 5, 100, 'test_seed', null, 'seed-stock-5', now()
  );
end;
$$;

select lives_ok(
  $$select public.upsert_financial_document_line_from_item(
      '91919191-aaaa-4aaa-8aaa-919191919191',
      '91919191-dddd-4ddd-8ddd-919191919191',
      1, '', 2, '', 150,
      '91919191-bbbb-4bbb-8bbb-919191919191',
      '91919191-cccc-4ccc-8ccc-919191919191',
      '8701', 0, '[]'::jsonb
    )$$,
  'tracked invoice line can be created from a selected item and warehouse'
);

select results_eq(
  $$select item_snapshot ->> 'sku', item_snapshot ->> 'name', item_snapshot ->> 'track_inventory'
    from public.financial_document_lines
    where document_id = '91919191-dddd-4ddd-8ddd-919191919191'$$,
  $$values ('TRACTOR-001'::text, 'Test Tractor'::text, 'true'::text)$$,
  'item snapshot is derived from the authoritative item record'
);

select results_eq(
  $$select source_warehouse_id
    from public.financial_document_lines
    where document_id = '91919191-dddd-4ddd-8ddd-919191919191'$$,
  $$values ('91919191-cccc-4ccc-8ccc-919191919191'::uuid)$$,
  'selected source warehouse is stored on the draft line'
);

select throws_ok(
  $$select public.upsert_financial_document_line_from_item(
      '91919191-aaaa-4aaa-8aaa-919191919191',
      '91919191-dddd-4ddd-8ddd-919191919191',
      2, 'Missing warehouse', 1, 'EA', 10,
      '91919191-bbbb-4bbb-8bbb-919191919191',
      null, null, 0, '[]'::jsonb
    )$$,
  '23514',
  null,
  'tracked item line cannot be saved without a source warehouse'
);

select lives_ok(
  $$select public.issue_financial_document(
      '91919191-aaaa-4aaa-8aaa-919191919191',
      '91919191-dddd-4ddd-8ddd-919191919191',
      'issue-stock-success-1'
    )$$,
  'issuing a stocked tax invoice succeeds when sufficient stock exists'
);

select results_eq(
  $$select status::text, document_number is not null
    from public.financial_documents
    where id = '91919191-dddd-4ddd-8ddd-919191919191'$$,
  $$values ('issued'::text, true)$$,
  'invoice becomes issued only after inventory posting succeeds'
);

select results_eq(
  $$select quantity_on_hand
    from public.inventory_balances
    where organization_id = '91919191-aaaa-4aaa-8aaa-919191919191'
      and item_id = '91919191-bbbb-4bbb-8bbb-919191919191'
      and warehouse_id = '91919191-cccc-4ccc-8ccc-919191919191'$$,
  $$values (3::numeric)$$,
  'invoice issue decrements stock by the invoiced quantity'
);

select results_eq(
  $$select count(*)
    from public.inventory_movements
    where organization_id = '91919191-aaaa-4aaa-8aaa-919191919191'
      and reference_type = 'financial_document'
      and reference_id = '91919191-dddd-4ddd-8ddd-919191919191'
      and movement_type = 'sale'$$,
  array[1::bigint],
  'exactly one sale movement is created for the tracked invoice line'
);

select results_eq(
  $$select request_key
    from public.inventory_movements
    where reference_id = '91919191-dddd-4ddd-8ddd-919191919191'
      and movement_type = 'sale'$$,
  $$values ('tax-invoice-sale:91919191-dddd-4ddd-8ddd-919191919191:line:1'::text)$$,
  'invoice stock movement uses a deterministic idempotency key'
);

select results_eq(
  $$select public.issue_financial_document(
      '91919191-aaaa-4aaa-8aaa-919191919191',
      '91919191-dddd-4ddd-8ddd-919191919191',
      'issue-stock-success-1'
    )$$,
  $$select document_number from public.financial_documents
    where id = '91919191-dddd-4ddd-8ddd-919191919191'$$,
  'same issue request key returns the existing invoice number'
);

select results_eq(
  $$select count(*)
    from public.inventory_movements
    where reference_id = '91919191-dddd-4ddd-8ddd-919191919191'
      and movement_type = 'sale'$$,
  array[1::bigint],
  'idempotent issue retry does not duplicate stock movement'
);

-- Prepare a second invoice that requests more stock than remains.
do $$
begin
  perform public.upsert_financial_document_line_from_item(
    '91919191-aaaa-4aaa-8aaa-919191919191',
    '91919191-eeee-4eee-8eee-919191919191',
    1, 'Too much stock', 4, 'EA', 150,
    '91919191-bbbb-4bbb-8bbb-919191919191',
    '91919191-cccc-4ccc-8ccc-919191919191',
    '8701', 0, '[]'::jsonb
  );
end;
$$;

select throws_ok(
  $$select public.issue_financial_document(
      '91919191-aaaa-4aaa-8aaa-919191919191',
      '91919191-eeee-4eee-8eee-919191919191',
      'issue-stock-fail-1'
    )$$,
  '23514',
  null,
  'invoice issue fails atomically when stock is insufficient'
);

select results_eq(
  $$select status::text, document_number is null, issue_request_key is null
    from public.financial_documents
    where id = '91919191-eeee-4eee-8eee-919191919191'$$,
  $$values ('draft'::text, true, true)$$,
  'failed stock posting leaves invoice as an unnumbered draft'
);

select results_eq(
  $$select quantity_on_hand
    from public.inventory_balances
    where organization_id = '91919191-aaaa-4aaa-8aaa-919191919191'
      and item_id = '91919191-bbbb-4bbb-8bbb-919191919191'
      and warehouse_id = '91919191-cccc-4ccc-8ccc-919191919191'$$,
  $$values (3::numeric)$$,
  'failed invoice issue leaves inventory unchanged'
);

reset role;
select * from finish();
rollback;
