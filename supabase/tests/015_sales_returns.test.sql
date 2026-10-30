begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

select has_table('public', 'sales_returns', 'sales return table exists');
select has_table('public', 'sales_return_lines', 'sales return line table exists');

insert into auth.users (id, email) values
  ('93930000-0000-4000-8000-000000000001', 'return-owner@test.local'),
  ('93930000-0000-4000-8000-000000000002', 'return-viewer@test.local');
insert into public.organizations (id, name, slug) values
  ('93930000-0000-4000-8000-000000000010', 'Return Tenant', 'return-tenant');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('93930000-0000-4000-8000-000000000010', '93930000-0000-4000-8000-000000000001', 'owner'),
  ('93930000-0000-4000-8000-000000000010', '93930000-0000-4000-8000-000000000002', 'viewer');
insert into public.items (id, organization_id, sku, name) values
  ('93930000-0000-4000-8000-000000000020', '93930000-0000-4000-8000-000000000010', 'RET-ITEM', 'Return Item');
insert into public.warehouses (id, organization_id, code, name) values
  ('93930000-0000-4000-8000-000000000030', '93930000-0000-4000-8000-000000000010', 'RET', 'Return Warehouse');
insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values
  ('93930000-0000-4000-8000-000000000040', '93930000-0000-4000-8000-000000000010', 'CUST-RET', 'Return Customer Private Limited', 'Return Customer', '93930000-0000-4000-8000-000000000001', '93930000-0000-4000-8000-000000000001');
insert into public.party_roles (organization_id, party_id, role) values
  ('93930000-0000-4000-8000-000000000010', '93930000-0000-4000-8000-000000000040', 'customer');
insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping, is_registered_address,
  created_by, updated_by
) values (
  '93930000-0000-4000-8000-000000000050', '93930000-0000-4000-8000-000000000010',
  '93930000-0000-4000-8000-000000000040', 'Billing', '10 Return Road', 'Bhopal',
  'Madhya Pradesh', '23', '462001', 'IN', true, true, true,
  '93930000-0000-4000-8000-000000000001', '93930000-0000-4000-8000-000000000001'
);
insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  '93930000-0000-4000-8000-000000000060', '93930000-0000-4000-8000-000000000010',
  'SELL-RET', 'Return Seller Private Limited', '23ABCDE1234F1Z5', '1 Seller Road', 'Bhopal',
  'Madhya Pradesh', '23', '462002', true,
  '93930000-0000-4000-8000-000000000001', '93930000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = '93930000-0000-4000-8000-000000000001';

select public.post_inventory_movement(
  '93930000-0000-4000-8000-000000000010', '93930000-0000-4000-8000-000000000020',
  '93930000-0000-4000-8000-000000000030', 'receipt', 10, 100, 'opening_stock', null, 'return-opening-stock'
);
select public.create_financial_document_draft_from_profiles(
  '93930000-0000-4000-8000-000000000010', '93930000-0000-4000-8000-000000000060',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '93930000-0000-4000-8000-000000000040', '93930000-0000-4000-8000-000000000050',
  null, null, null, 'INR', '23', false, 'sales return invoice'
);
select public.upsert_financial_document_line_calculated(
  '93930000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'sales return invoice'),
  1, 'Return Item', 3, 'EA', 500,
  '93930000-0000-4000-8000-000000000020', '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  '93930000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'sales return invoice'),
  'return-issue'
);
select public.fulfill_sales_invoice(
  '93930000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'sales return invoice'),
  '93930000-0000-4000-8000-000000000030', 'return-fulfill'
);

select lives_ok(
  $$select public.return_sales_fulfillment(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.sales_fulfillments where request_key = 'return-fulfill'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines limit 1),
        'quantity', '1'
      )),
      'customer returned one unit', 'sales-return-1'
    )$$,
  'owner can partially return fulfilled stock'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '93930000-0000-4000-8000-000000000010'
      and item_id = '93930000-0000-4000-8000-000000000020'
      and warehouse_id = '93930000-0000-4000-8000-000000000030'$$,
  array[8::numeric],
  'partial return restores stock through return_in movement'
);

select results_eq(
  $$select quantity from public.inventory_movements
    where organization_id = '93930000-0000-4000-8000-000000000010'
      and movement_type = 'return_in' and reference_type = 'sales_return'$$,
  array[1::numeric],
  'sales return posts positive return_in quantity'
);

select results_eq(
  $$select public.return_sales_fulfillment(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.sales_fulfillments where request_key = 'return-fulfill'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines limit 1),
        'quantity', '1'
      )),
      'customer returned one unit', 'sales-return-1'
    )$$,
  $$select id from public.sales_returns where request_key = 'sales-return-1'$$,
  'same return request is idempotent'
);

select throws_ok(
  $$select public.return_sales_fulfillment(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.sales_fulfillments where request_key = 'return-fulfill'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines limit 1),
        'quantity', '3'
      )),
      'too many', 'sales-return-over'
    )$$,
  '23514', null, 'return cannot exceed remaining fulfilled quantity'
);

select throws_ok(
  $$select public.cancel_financial_document(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'sales return invoice'),
      'partial return only'
    )$$,
  '23514', null, 'invoice cancellation remains blocked after only a partial stock return'
);

set local request.jwt.claim.sub = '93930000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.return_sales_fulfillment(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.sales_fulfillments where request_key = 'return-fulfill'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines limit 1),
        'quantity', '1'
      )),
      'viewer return', 'viewer-return'
    )$$,
  '42501', null, 'viewer cannot post a sales return'
);

set local request.jwt.claim.sub = '93930000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.return_sales_fulfillment(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.sales_fulfillments where request_key = 'return-fulfill'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines limit 1),
        'quantity', '2'
      )),
      'return remainder', 'sales-return-2'
    )$$,
  'remaining fulfilled quantity can be returned'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '93930000-0000-4000-8000-000000000010'
      and item_id = '93930000-0000-4000-8000-000000000020'
      and warehouse_id = '93930000-0000-4000-8000-000000000030'$$,
  array[10::numeric],
  'full return restores original stock balance'
);

select lives_ok(
  $$select public.cancel_financial_document(
      '93930000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'sales return invoice'),
      'all fulfilled stock returned'
    )$$,
  'invoice may be cancelled after every fulfilled unit is returned'
);

reset role;
select throws_ok(
  $$update public.sales_returns set reason = 'tampered' where request_key = 'sales-return-1'$$,
  '55000', null, 'sales return headers are immutable'
);
select throws_ok(
  $$delete from public.sales_return_lines where organization_id = '93930000-0000-4000-8000-000000000010'$$,
  '55000', null, 'sales return lines are immutable'
);

set local role authenticated;
set local request.jwt.claim.sub = '93930000-0000-4000-8000-000000000001';
select ok(
  (select count(*) from public.audit_events
   where organization_id = '93930000-0000-4000-8000-000000000010'
     and action = 'sales_invoice.returned') = 2,
  'each accepted sales return is audited once'
);
select results_eq(
  $$select count(*) from public.sales_returns$$,
  array[2::bigint],
  'idempotent retry and rejected returns create no extra return headers'
);

reset role;
select * from finish();
rollback;
