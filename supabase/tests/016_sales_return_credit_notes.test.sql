begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

select has_table('public', 'sales_return_credit_notes', 'sales return credit note table exists');
select has_table('public', 'sales_return_credit_allocations', 'sales return credit allocation table exists');

insert into auth.users (id, email) values
  ('94940000-0000-4000-8000-000000000001', 'credit-owner@test.local'),
  ('94940000-0000-4000-8000-000000000002', 'credit-viewer@test.local');
insert into public.organizations (id, name, slug) values
  ('94940000-0000-4000-8000-000000000010', 'Credit Return Tenant', 'credit-return-tenant');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('94940000-0000-4000-8000-000000000010', '94940000-0000-4000-8000-000000000001', 'owner'),
  ('94940000-0000-4000-8000-000000000010', '94940000-0000-4000-8000-000000000002', 'viewer');
insert into public.items (id, organization_id, sku, name) values
  ('94940000-0000-4000-8000-000000000020', '94940000-0000-4000-8000-000000000010', 'CR-ITEM', 'Credit Return Item');
insert into public.warehouses (id, organization_id, code, name) values
  ('94940000-0000-4000-8000-000000000030', '94940000-0000-4000-8000-000000000010', 'CRW', 'Credit Return Warehouse');
insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values
  ('94940000-0000-4000-8000-000000000040', '94940000-0000-4000-8000-000000000010', 'CUST-CR', 'Credit Return Customer Private Limited', 'Credit Return Customer', '94940000-0000-4000-8000-000000000001', '94940000-0000-4000-8000-000000000001');
insert into public.party_roles (organization_id, party_id, role) values
  ('94940000-0000-4000-8000-000000000010', '94940000-0000-4000-8000-000000000040', 'customer');
insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping, is_registered_address,
  created_by, updated_by
) values (
  '94940000-0000-4000-8000-000000000050', '94940000-0000-4000-8000-000000000010',
  '94940000-0000-4000-8000-000000000040', 'Billing', '20 Credit Road', 'Bhopal',
  'Madhya Pradesh', '23', '462001', 'IN', true, true, true,
  '94940000-0000-4000-8000-000000000001', '94940000-0000-4000-8000-000000000001'
);
insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  '94940000-0000-4000-8000-000000000060', '94940000-0000-4000-8000-000000000010',
  'SELL-CR', 'Credit Return Seller Private Limited', '23ABCDE1234F1Z5', '2 Seller Road', 'Bhopal',
  'Madhya Pradesh', '23', '462002', true,
  '94940000-0000-4000-8000-000000000001', '94940000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = '94940000-0000-4000-8000-000000000001';

select public.post_inventory_movement(
  '94940000-0000-4000-8000-000000000010', '94940000-0000-4000-8000-000000000020',
  '94940000-0000-4000-8000-000000000030', 'receipt', 10, 50, 'opening_stock', null, 'credit-return-opening'
);
select public.create_financial_document_draft_from_profiles(
  '94940000-0000-4000-8000-000000000010', '94940000-0000-4000-8000-000000000060',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '94940000-0000-4000-8000-000000000040', '94940000-0000-4000-8000-000000000050',
  null, null, null, 'INR', '23', false, 'credit return invoice'
);
select public.upsert_financial_document_line_calculated(
  '94940000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'credit return invoice'),
  1, 'Credit Return Item', 4, 'EA', 100,
  '94940000-0000-4000-8000-000000000020', '{}'::jsonb, '8708', 20,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  '94940000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'credit return invoice'),
  'credit-return-invoice-issue'
);
select public.fulfill_sales_invoice(
  '94940000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'credit return invoice'),
  '94940000-0000-4000-8000-000000000030', 'credit-return-fulfill'
);
select public.return_sales_fulfillment(
  '94940000-0000-4000-8000-000000000010',
  (select id from public.sales_fulfillments where request_key = 'credit-return-fulfill'),
  jsonb_build_array(jsonb_build_object(
    'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
    'quantity', '3'
  )),
  'three units returned', 'credit-return-stock'
);

select throws_ok(
  $$insert into public.sales_return_credit_notes (
      organization_id, sales_return_id, credit_note_id, document_date, series_code,
      request_key, request_payload, created_by
    ) values (
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      (select id from public.financial_documents where notes = 'credit return invoice'),
      '2026-10-30', 'CRN', 'direct-credit-link', '[]'::jsonb,
      '94940000-0000-4000-8000-000000000001'
    )$$,
  '42501', null, 'authenticated clients cannot insert return-credit links directly'
);

set local request.jwt.claim.sub = '94940000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
        'quantity', '1'
      )),
      '2026-10-30', 'CRN', 'viewer-credit'
    )$$,
  '42501', null, 'viewer cannot issue a sales-return credit note'
);

set local request.jwt.claim.sub = '94940000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
        'quantity', '1'
      )),
      '2026-10-30', 'CRN', 'credit-part-1'
    )$$,
  'owner can issue a partial credit note for returned quantity'
);

select results_eq(
  $$select document_type::text, status::text, linked_document_id
    from public.financial_documents
    where id = (select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1')$$,
  $$values (
    'credit_note'::text,
    'issued'::text,
    (select id from public.financial_documents where notes = 'credit return invoice')
  )$$,
  'return credit is an issued credit note linked to the original invoice'
);

select results_eq(
  $$select quantity, unit_price, discount_amount, taxable_value
    from public.financial_document_lines
    where document_id = (select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1')$$,
  $$values (1::numeric, 100::numeric, 5::numeric, 95::numeric)$$,
  'partial credit line derives price discount and taxable value from original invoice ratio'
);

select results_eq(
  $$select item_snapshot ->> 'sku'
    from public.financial_document_lines
    where document_id = (select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1')$$,
  array['CR-ITEM'::text],
  'credit line preserves the original issued item snapshot'
);

select results_eq(
  $$select component::text, rate, amount
    from public.financial_document_line_taxes
    where line_id = (
      select id from public.financial_document_lines
      where document_id = (select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1')
    ) order by component$$,
  $$values ('CGST'::text, 9::numeric, 8.55::numeric), ('SGST'::text, 9::numeric, 8.55::numeric)$$,
  'credit taxes use original tax components and rates with PostgreSQL arithmetic'
);

select results_eq(
  $$select quantity from public.sales_return_credit_allocations
    where credit_note_id = (select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1')$$,
  array[1::numeric],
  'credit allocation records the exact returned quantity financially credited'
);

select results_eq(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
        'quantity', '1'
      )),
      '2026-10-30', 'CRN', 'credit-part-1'
    )$$,
  $$select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1'$$,
  'identical credit request is idempotent'
);

select results_eq(
  $$select count(*) from public.sales_return_credit_notes$$,
  array[1::bigint],
  'idempotent retry creates no duplicate credit note linkage'
);

select throws_ok(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
        'quantity', '3'
      )),
      '2026-10-30', 'CRN', 'credit-over'
    )$$,
  '23514', null, 'credit cannot exceed remaining uncredited returned quantity'
);

select lives_ok(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
        'quantity', '2'
      )),
      '2026-10-30', 'CRN', 'credit-part-2'
    )$$,
  'remaining returned quantity can be credited in another note'
);

select results_eq(
  $$select sum(a.quantity)
    from public.sales_return_credit_allocations a
    join public.financial_documents d on d.id = a.credit_note_id and d.organization_id = a.organization_id
    where d.status <> 'cancelled'$$,
  array[3::numeric],
  'active credit allocations reach but do not exceed returned quantity'
);

select throws_ok(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', gen_random_uuid(),
        'quantity', '1'
      )),
      '2026-10-30', 'CRN', 'credit-wrong-line'
    )$$,
  'P0002', null, 'credit cannot use a line outside the selected sales return'
);

select lives_ok(
  $$select public.cancel_financial_document(
      '94940000-0000-4000-8000-000000000010',
      (select credit_note_id from public.sales_return_credit_notes where request_key = 'credit-part-1'),
      'replace partial credit'
    )$$,
  'issued return credit note can be cancelled'
);

select results_eq(
  $$select sum(a.quantity)
    from public.sales_return_credit_allocations a
    join public.financial_documents d on d.id = a.credit_note_id and d.organization_id = a.organization_id
    where d.status <> 'cancelled'$$,
  array[2::numeric],
  'cancelled credit note releases its credited quantity from active total'
);

select lives_ok(
  $$select public.issue_sales_return_credit_note(
      '94940000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'credit-return-stock'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = '94940000-0000-4000-8000-000000000010' limit 1),
        'quantity', '1'
      )),
      '2026-10-30', 'CRN', 'credit-replacement'
    )$$,
  'quantity released by cancelled credit note can be credited again'
);

select results_eq(
  $$select sum(a.quantity)
    from public.sales_return_credit_allocations a
    join public.financial_documents d on d.id = a.credit_note_id and d.organization_id = a.organization_id
    where d.status <> 'cancelled'$$,
  array[3::numeric],
  'replacement credit restores active credited quantity to returned quantity'
);

select results_eq(
  $$select status::text, grand_total
    from public.financial_documents where notes = 'credit return invoice'$$,
  $$values ('issued'::text, 448.4::numeric)$$,
  'original invoice remains issued and financially unchanged by return credits'
);

reset role;
select throws_ok(
  $$update public.sales_return_credit_notes set request_key = 'tampered' where request_key = 'credit-part-2'$$,
  '55000', null, 'return-credit linkage headers are immutable'
);
select throws_ok(
  $$delete from public.sales_return_credit_allocations where organization_id = '94940000-0000-4000-8000-000000000010'$$,
  '55000', null, 'return-credit allocations are immutable'
);

set local role authenticated;
set local request.jwt.claim.sub = '94940000-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*) from public.audit_events
    where organization_id = '94940000-0000-4000-8000-000000000010'
      and action = 'sales_return.credit_note_issued'$$,
  array[3::bigint],
  'each accepted non-idempotent return credit is audited once'
);
select results_eq(
  $$select count(*) from public.sales_return_credit_notes$$,
  array[3::bigint],
  'rejected and idempotent requests create no extra credit link rows'
);

reset role;
select * from finish();
rollback;
