begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

select has_table('public', 'sales_fulfillments', 'sales fulfillment table exists');
select has_table('public', 'sales_fulfillment_lines', 'sales fulfillment line table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sales_fulfillments'::regclass),
  'RLS is enabled on sales fulfillments'
);

insert into auth.users (id, email) values
  ('71717171-7171-4171-8171-717171717171', 'fulfillment-owner@test.local'),
  ('72727272-7272-4272-8272-727272727272', 'fulfillment-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('73737373-7373-4373-8373-737373737373', 'Fulfillment Tenant', 'fulfillment-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('73737373-7373-4373-8373-737373737373', '71717171-7171-4171-8171-717171717171', 'owner'),
  ('73737373-7373-4373-8373-737373737373', '72727272-7272-4272-8272-727272727272', 'viewer');

insert into public.items (id, organization_id, sku, name) values
  ('74747474-7474-4474-8474-747474747474', '73737373-7373-4373-8373-737373737373', 'ITEM-001', 'Stock Item');

insert into public.warehouses (id, organization_id, code, name) values
  ('75757575-7575-4575-8575-757575757575', '73737373-7373-4373-8373-737373737373', 'MAIN', 'Main Warehouse');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values (
  '76767676-7676-4676-8676-767676767676',
  '73737373-7373-4373-8373-737373737373',
  'CUST-FUL', 'Fulfillment Customer Private Limited', 'Fulfillment Customer',
  '71717171-7171-4171-8171-717171717171', '71717171-7171-4171-8171-717171717171'
);

insert into public.party_roles (organization_id, party_id, role) values
  ('73737373-7373-4373-8373-737373737373', '76767676-7676-4676-8676-767676767676', 'customer');

insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping,
  is_registered_address, created_by, updated_by
) values (
  '77777777-7777-4777-8777-777777777777',
  '73737373-7373-4373-8373-737373737373',
  '76767676-7676-4676-8676-767676767676',
  'Billing', '10 Customer Road', 'Bhopal', 'Madhya Pradesh', '23',
  '462001', 'IN', true, true, true,
  '71717171-7171-4171-8171-717171717171', '71717171-7171-4171-8171-717171717171'
);

insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  '78787878-7878-4878-8878-787878787878',
  '73737373-7373-4373-8373-737373737373',
  'SELL-FUL', 'Fulfillment Seller Private Limited', '23ABCDE1234F1Z5',
  '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462002', true,
  '71717171-7171-4171-8171-717171717171', '71717171-7171-4171-8171-717171717171'
);

set local role authenticated;
set local request.jwt.claim.sub = '71717171-7171-4171-8171-717171717171';

select throws_ok(
  $$insert into public.sales_fulfillments (
      organization_id, financial_document_id, warehouse_id, request_key, created_by
    ) values (
      '73737373-7373-4373-8373-737373737373',
      gen_random_uuid(),
      '75757575-7575-4575-8575-757575757575',
      'direct-write',
      '71717171-7171-4171-8171-717171717171'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert fulfillments directly'
);

select public.post_inventory_movement(
  '73737373-7373-4373-8373-737373737373',
  '74747474-7474-4474-8474-747474747474',
  '75757575-7575-4575-8575-757575757575',
  'receipt', 10, 100, 'opening_stock', null, 'fulfillment-opening-stock'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '73737373-7373-4373-8373-737373737373'
      and item_id = '74747474-7474-4474-8474-747474747474'
      and warehouse_id = '75757575-7575-4575-8575-757575757575'$$,
  array[10::numeric],
  'opening receipt establishes stock balance'
);

select public.create_financial_document_draft_from_profiles(
  '73737373-7373-4373-8373-737373737373',
  '78787878-7878-4878-8878-787878787878',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '76767676-7676-4676-8676-767676767676',
  '77777777-7777-4777-8777-777777777777',
  null, null, null, 'INR', '23', false, 'fulfillment invoice one'
);

select public.upsert_financial_document_line_calculated(
  '73737373-7373-4373-8373-737373737373',
  (select id from public.financial_documents where notes = 'fulfillment invoice one'),
  1, 'Stock Item', 3, 'EA', 500,
  '74747474-7474-4474-8474-747474747474',
  '{"sku":"ITEM-001","name":"Stock Item"}'::jsonb,
  '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);

select public.issue_financial_document(
  '73737373-7373-4373-8373-737373737373',
  (select id from public.financial_documents where notes = 'fulfillment invoice one'),
  'fulfillment-issue-one'
);

select lives_ok(
  $$select public.fulfill_sales_invoice(
      '73737373-7373-4373-8373-737373737373',
      (select id from public.financial_documents where notes = 'fulfillment invoice one'),
      '75757575-7575-4575-8575-757575757575',
      'fulfill-one'
    )$$,
  'owner can atomically fulfill an issued stock-backed invoice'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '73737373-7373-4373-8373-737373737373'
      and item_id = '74747474-7474-4474-8474-747474747474'
      and warehouse_id = '75757575-7575-4575-8575-757575757575'$$,
  array[7::numeric],
  'fulfillment decrements stock by invoice quantity'
);

select results_eq(
  $$select quantity from public.inventory_movements
    where organization_id = '73737373-7373-4373-8373-737373737373'
      and movement_type = 'sale'
      and reference_type = 'sales_fulfillment'$$,
  array[-3::numeric],
  'fulfillment posts an outbound sale movement'
);

select results_eq(
  $$select count(*) from public.sales_fulfillment_lines$$,
  array[1::bigint],
  'fulfillment line links the invoice line to one inventory movement'
);

select results_eq(
  $$select public.fulfill_sales_invoice(
      '73737373-7373-4373-8373-737373737373',
      (select id from public.financial_documents where notes = 'fulfillment invoice one'),
      '75757575-7575-4575-8575-757575757575',
      'fulfill-one'
    )$$,
  $$select id from public.sales_fulfillments where request_key = 'fulfill-one'$$,
  'same fulfillment request key is idempotent'
);

select results_eq(
  $$select count(*) from public.sales_fulfillments$$,
  array[1::bigint],
  'idempotent retry does not create another fulfillment'
);

select throws_ok(
  $$select public.fulfill_sales_invoice(
      '73737373-7373-4373-8373-737373737373',
      (select id from public.financial_documents where notes = 'fulfillment invoice one'),
      '75757575-7575-4575-8575-757575757575',
      'fulfill-one-again'
    )$$,
  '22023',
  null,
  'a second fulfillment with a different request key is rejected'
);

set local request.jwt.claim.sub = '72727272-7272-4272-8272-727272727272';
select throws_ok(
  $$select public.fulfill_sales_invoice(
      '73737373-7373-4373-8373-737373737373',
      (select id from public.financial_documents where notes = 'fulfillment invoice one'),
      '75757575-7575-4575-8575-757575757575',
      'viewer-fulfill'
    )$$,
  '42501',
  null,
  'viewer cannot fulfill an invoice'
);

set local request.jwt.claim.sub = '71717171-7171-4171-8171-717171717171';
select throws_ok(
  $$select public.cancel_financial_document(
      '73737373-7373-4373-8373-737373737373',
      (select id from public.financial_documents where notes = 'fulfillment invoice one'),
      'cancel after delivery'
    )$$,
  '23514',
  null,
  'fulfilled invoice cannot be cancelled without a stock reversal workflow'
);

reset role;
select throws_ok(
  $$update public.sales_fulfillments set request_key = 'tampered' where request_key = 'fulfill-one'$$,
  '55000',
  null,
  'fulfillment records are immutable even for privileged writes'
);

set local role authenticated;
set local request.jwt.claim.sub = '71717171-7171-4171-8171-717171717171';

select public.create_financial_document_draft_from_profiles(
  '73737373-7373-4373-8373-737373737373',
  '78787878-7878-4878-8878-787878787878',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '76767676-7676-4676-8676-767676767676',
  '77777777-7777-4777-8777-777777777777',
  null, null, null, 'INR', '23', false, 'fulfillment invoice two'
);

select public.upsert_financial_document_line_calculated(
  '73737373-7373-4373-8373-737373737373',
  (select id from public.financial_documents where notes = 'fulfillment invoice two'),
  1, 'Stock Item', 20, 'EA', 500,
  '74747474-7474-4474-8474-747474747474',
  '{"sku":"ITEM-001","name":"Stock Item"}'::jsonb,
  '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  '73737373-7373-4373-8373-737373737373',
  (select id from public.financial_documents where notes = 'fulfillment invoice two'),
  'fulfillment-issue-two'
);

select throws_ok(
  $$select public.fulfill_sales_invoice(
      '73737373-7373-4373-8373-737373737373',
      (select id from public.financial_documents where notes = 'fulfillment invoice two'),
      '75757575-7575-4575-8575-757575757575',
      'fulfill-insufficient'
    )$$,
  '23514',
  null,
  'insufficient stock rolls back the whole fulfillment'
);

select results_eq(
  $$select count(*) from public.sales_fulfillments$$,
  array[1::bigint],
  'failed fulfillment leaves no fulfillment header behind'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '73737373-7373-4373-8373-737373737373'
      and item_id = '74747474-7474-4474-8474-747474747474'
      and warehouse_id = '75757575-7575-4575-8575-757575757575'$$,
  array[7::numeric],
  'failed fulfillment leaves stock unchanged'
);

select ok(
  exists (
    select 1 from public.audit_events
    where organization_id = '73737373-7373-4373-8373-737373737373'
      and action = 'sales_invoice.fulfilled'
  ),
  'successful fulfillment creates an audit event'
);

reset role;
select * from finish();
rollback;
