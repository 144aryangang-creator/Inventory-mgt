begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

select has_column('public', 'sales_fulfillments', 'request_payload', 'fulfillment header stores idempotency payload');

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000001', 'partial-owner@test.local'),
  ('c1000000-0000-4000-8000-000000000002', 'partial-viewer@test.local'),
  ('d1000000-0000-4000-8000-000000000001', 'partial-other@test.local');

insert into public.organizations (id, name, slug) values
  ('c1000000-0000-4000-8000-000000000010', 'Partial Fulfillment Tenant', 'partial-fulfillment-tenant'),
  ('d1000000-0000-4000-8000-000000000010', 'Other Fulfillment Tenant', 'other-fulfillment-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000001', 'owner'),
  ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000002', 'viewer'),
  ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000001', 'owner');

insert into public.items (id, organization_id, sku, name) values
  ('c1000000-0000-4000-8000-000000000020', 'c1000000-0000-4000-8000-000000000010', 'PART-A', 'Tracked Part A'),
  ('c1000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000010', 'PART-B', 'Tracked Part B');

insert into public.warehouses (id, organization_id, code, name) values
  ('c1000000-0000-4000-8000-000000000030', 'c1000000-0000-4000-8000-000000000010', 'W1', 'Warehouse One'),
  ('c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000010', 'W2', 'Warehouse Two');

insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values (
  'c1000000-0000-4000-8000-000000000040', 'c1000000-0000-4000-8000-000000000010',
  'CUST-PF', 'Partial Fulfillment Customer Private Limited', 'Partial Fulfillment Customer',
  'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'
);
insert into public.party_roles (organization_id, party_id, role) values
  ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000040', 'customer');
insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping, is_registered_address,
  created_by, updated_by
) values (
  'c1000000-0000-4000-8000-000000000050', 'c1000000-0000-4000-8000-000000000010',
  'c1000000-0000-4000-8000-000000000040', 'Billing', '10 Partial Road', 'Bhopal',
  'Madhya Pradesh', '23', '462001', 'IN', true, true, true,
  'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'
);
insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  'c1000000-0000-4000-8000-000000000060', 'c1000000-0000-4000-8000-000000000010',
  'SELL-PF', 'Partial Fulfillment Seller Private Limited', '23ABCDE1234F1Z5',
  '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462002', true,
  'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select public.post_inventory_movement('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000020', 'c1000000-0000-4000-8000-000000000030', 'receipt', 10, 10, 'opening_stock', null, 'pf-w1-a');
select public.post_inventory_movement('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000030', 'receipt', 10, 10, 'opening_stock', null, 'pf-w1-b');
select public.post_inventory_movement('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000020', 'c1000000-0000-4000-8000-000000000031', 'receipt', 10, 10, 'opening_stock', null, 'pf-w2-a');
select public.post_inventory_movement('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000031', 'receipt', 10, 10, 'opening_stock', null, 'pf-w2-b');

select public.create_financial_document_draft_from_profiles(
  'c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000060',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  'c1000000-0000-4000-8000-000000000040', 'c1000000-0000-4000-8000-000000000050',
  null, null, null, 'INR', '23', false, 'partial multiwarehouse invoice'
);
select public.upsert_financial_document_line_calculated(
  'c1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
  1, 'Tracked Part A', 5, 'EA', 100, 'c1000000-0000-4000-8000-000000000020', '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.upsert_financial_document_line_calculated(
  'c1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
  2, 'Tracked Part B', 4, 'EA', 200, 'c1000000-0000-4000-8000-000000000021', '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.upsert_financial_document_line_calculated(
  'c1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
  3, 'Installation service', 1, 'EA', 50, null, '{}'::jsonb, '9987', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  'c1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
  'pf-issue'
);

select results_eq(
  $$select public.get_sales_invoice_fulfillment_summary(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')
    ) ->> 'status'$$,
  array['unfulfilled'::text],
  'new issued stock-backed invoice starts unfulfilled'
);
select results_eq(
  $$select (public.get_sales_invoice_fulfillment_summary(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')
    ) ->> 'stockLineCount')::integer$$,
  array[2],
  'service line is excluded from stock fulfillment summary'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(jsonb_build_object(
        'financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1),
        'quantity', '2'
      )), 'pf-viewer'
    )$$,
  '42501', null, 'viewer cannot post a fulfillment'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(jsonb_build_object(
        'financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1),
        'quantity', '2'
      )), 'pf-w1-part-a'
    )$$,
  'owner can partially fulfill one invoice line from warehouse one'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = 'c1000000-0000-4000-8000-000000000010'
      and item_id = 'c1000000-0000-4000-8000-000000000020'
      and warehouse_id = 'c1000000-0000-4000-8000-000000000030'$$,
  array[8::numeric], 'warehouse one stock decreases by partial quantity'
);
select results_eq(
  $$select jsonb_typeof(request_payload) from public.sales_fulfillments where request_key = 'pf-w1-part-a'$$,
  array['array'::text], 'partial fulfillment persists its idempotency payload'
);
select results_eq(
  $$select quantity from public.sales_fulfillment_lines fl join public.sales_fulfillments f on f.id = fl.fulfillment_id and f.organization_id = fl.organization_id where f.request_key = 'pf-w1-part-a'$$,
  array[2::numeric], 'fulfillment line records exact posted quantity'
);
select results_eq(
  $$select public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) ->> 'status'$$,
  array['partial'::text], 'first partial posting changes invoice fulfillment status to partial'
);
select results_eq(
  $$select (x ->> 'fulfilledQuantity')::numeric, (x ->> 'remainingQuantity')::numeric
    from jsonb_array_elements(public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) -> 'lines') x
    where (x ->> 'lineNumber')::integer = 1$$,
  $$values (2::numeric, 3::numeric)$$,
  'summary derives fulfilled and remaining quantity for line one'
);
select results_eq(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(jsonb_build_object(
        'financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1),
        'quantity', '2'
      )), 'pf-w1-part-a'
    )$$,
  $$select id from public.sales_fulfillments where request_key = 'pf-w1-part-a'$$,
  'identical partial fulfillment retry is idempotent'
);
select results_eq($$select count(*) from public.sales_fulfillments where organization_id = 'c1000000-0000-4000-8000-000000000010'$$, array[1::bigint], 'idempotent retry creates no duplicate header');
select throws_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(jsonb_build_object(
        'financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1),
        'quantity', '1'
      )), 'pf-w1-part-a'
    )$$,
  '22023', null, 'same request key cannot be reused with a different partial payload'
);

select lives_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000031',
      jsonb_build_array(
        jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1), 'quantity', '3'),
        jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 2), 'quantity', '2')
      ), 'pf-w2-mixed'
    )$$,
  'second warehouse can fulfill remaining line one plus part of line two'
);
select results_eq($$select count(*) from public.sales_fulfillments where organization_id = 'c1000000-0000-4000-8000-000000000010'$$, array[2::bigint], 'same invoice can have multiple immutable fulfillment headers');
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'c1000000-0000-4000-8000-000000000010' and item_id = 'c1000000-0000-4000-8000-000000000020' and warehouse_id = 'c1000000-0000-4000-8000-000000000031'$$,
  array[7::numeric], 'warehouse two line-one stock reflects its own posting'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'c1000000-0000-4000-8000-000000000010' and item_id = 'c1000000-0000-4000-8000-000000000021' and warehouse_id = 'c1000000-0000-4000-8000-000000000031'$$,
  array[8::numeric], 'warehouse two line-two stock reflects its partial posting'
);
select results_eq(
  $$select public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) ->> 'status'$$,
  array['partial'::text], 'invoice remains partial until every stock-backed line is fully fulfilled'
);
select results_eq(
  $$select (x ->> 'remainingQuantity')::numeric from jsonb_array_elements(public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) -> 'lines') x where (x ->> 'lineNumber')::integer = 1$$,
  array[0::numeric], 'line one is fully fulfilled across two warehouses'
);
select results_eq(
  $$select (x ->> 'fulfilledQuantity')::numeric, (x ->> 'remainingQuantity')::numeric from jsonb_array_elements(public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) -> 'lines') x where (x ->> 'lineNumber')::integer = 2$$,
  $$values (2::numeric, 2::numeric)$$,
  'line two remains partially fulfilled'
);

select throws_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000031',
      jsonb_build_array(jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1), 'quantity', '1')),
      'pf-over-line-one'
    )$$,
  '23514', null, 'aggregate fulfillment cannot exceed original invoice line quantity'
);
select results_eq($$select count(*) from public.sales_fulfillments where organization_id = 'c1000000-0000-4000-8000-000000000010'$$, array[2::bigint], 'failed over-fulfillment rolls back its header');
select throws_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(
        jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 2), 'quantity', '1'),
        jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 2), 'quantity', '1')
      ), 'pf-duplicate-line'
    )$$,
  '22023', null, 'one fulfillment request cannot repeat the same invoice line'
);
select throws_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 3), 'quantity', '1')),
      'pf-service-line'
    )$$,
  '23514', null, 'non-stock service line cannot be fulfilled as inventory'
);

select lives_ok(
  $$select public.post_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030',
      jsonb_build_array(jsonb_build_object('financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 2), 'quantity', '2')),
      'pf-w1-final-b'
    )$$,
  'remaining line-two quantity can be fulfilled from another warehouse'
);
select results_eq($$select count(*) from public.sales_fulfillments where organization_id = 'c1000000-0000-4000-8000-000000000010'$$, array[3::bigint], 'three independent fulfillment postings are retained');
select results_eq(
  $$select public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) ->> 'status'$$,
  array['fulfilled'::text], 'derived status becomes fulfilled only after all stock lines reach invoiced quantity'
);
select results_eq(
  $$select (x ->> 'fulfilledQuantity')::numeric, (x ->> 'remainingQuantity')::numeric from jsonb_array_elements(public.get_sales_invoice_fulfillment_summary('c1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')) -> 'lines') x where (x ->> 'lineNumber')::integer = 2$$,
  $$values (4::numeric, 0::numeric)$$,
  'line two aggregate fulfillment reaches exactly the invoiced quantity'
);
select throws_ok(
  $$select public.fulfill_sales_invoice(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'c1000000-0000-4000-8000-000000000030', 'pf-legacy-no-remaining'
    )$$,
  '23514', null, 'legacy wrapper refuses a fully fulfilled invoice with no remaining stock quantity'
);

select lives_ok(
  $$select public.return_sales_fulfillment(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.sales_fulfillments where request_key = 'pf-w2-mixed'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'partial multiwarehouse invoice') and line_number = 1),
        'quantity', '1'
      )), 'warehouse-specific return', 'pf-return-w2-a'
    )$$,
  'return remains tied to the exact fulfillment posting'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'c1000000-0000-4000-8000-000000000010' and item_id = 'c1000000-0000-4000-8000-000000000020' and warehouse_id = 'c1000000-0000-4000-8000-000000000031'$$,
  array[8::numeric], 'return restores stock to the original fulfillment warehouse'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'c1000000-0000-4000-8000-000000000010' and item_id = 'c1000000-0000-4000-8000-000000000020' and warehouse_id = 'c1000000-0000-4000-8000-000000000030'$$,
  array[8::numeric], 'warehouse one balance is unchanged by warehouse-two return'
);
select throws_ok(
  $$select public.cancel_financial_document(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice'),
      'cannot cancel while delivered stock remains'
    )$$,
  '23514', null, 'invoice cancellation remains blocked until every fulfillment posting is fully returned'
);

set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.get_sales_invoice_fulfillment_summary(
      'c1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'partial multiwarehouse invoice')
    )$$,
  '42501', null, 'another tenant cannot read fulfillment summary'
);

reset role;
select throws_ok(
  $$update public.sales_fulfillment_lines set quantity = 999 where organization_id = 'c1000000-0000-4000-8000-000000000010'$$,
  '55000', null, 'partial fulfillment lines remain immutable'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*) from public.audit_events where organization_id = 'c1000000-0000-4000-8000-000000000010' and action = 'sales_invoice.fulfillment_posted'$$,
  array[3::bigint], 'each successful partial fulfillment appends one high-level audit event'
);

select * from finish();
rollback;
