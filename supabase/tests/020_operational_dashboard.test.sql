begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('91000000-0000-4000-8000-000000000001', 'dashboard-owner@test.local'),
  ('91000000-0000-4000-8000-000000000002', 'dashboard-viewer@test.local'),
  ('92000000-0000-4000-8000-000000000001', 'dashboard-other@test.local');

insert into public.organizations (id, name, slug) values
  ('91000000-0000-4000-8000-000000000010', 'Dashboard Tenant', 'dashboard-tenant'),
  ('92000000-0000-4000-8000-000000000010', 'Dashboard Other Tenant', 'dashboard-other-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000001', 'owner'),
  ('91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000002', 'viewer'),
  ('92000000-0000-4000-8000-000000000010', '92000000-0000-4000-8000-000000000001', 'owner');

insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values
  ('91000000-0000-4000-8000-000000000020', '91000000-0000-4000-8000-000000000010', 'CUST-DASH', 'Dashboard Customer Private Limited', 'Dashboard Customer', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000021', '91000000-0000-4000-8000-000000000010', 'SUP-DASH', 'Dashboard Supplier Private Limited', 'Dashboard Supplier', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001');
insert into public.party_roles (organization_id, party_id, role) values
  ('91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000020', 'customer'),
  ('91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000021', 'supplier');
insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping, is_registered_address,
  created_by, updated_by
) values (
  '91000000-0000-4000-8000-000000000030', '91000000-0000-4000-8000-000000000010',
  '91000000-0000-4000-8000-000000000020', 'Billing', '10 Dashboard Road', 'Bhopal',
  'Madhya Pradesh', '23', '462001', 'IN', true, true, true,
  '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001'
);
insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city, state_name,
  state_code, postal_code, is_default, created_by, updated_by
) values (
  '91000000-0000-4000-8000-000000000040', '91000000-0000-4000-8000-000000000010',
  'SELL-DASH', 'Dashboard Seller Private Limited', '23ABCDE1234F1Z5', '1 Seller Road', 'Bhopal',
  'Madhya Pradesh', '23', '462002', true,
  '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001'
);

insert into public.items (id, organization_id, sku, name, base_uom, track_inventory, is_active) values
  ('91000000-0000-4000-8000-000000000050', '91000000-0000-4000-8000-000000000010', 'DASH-STOCK', 'Dashboard Stock Item', 'EA', true, true),
  ('91000000-0000-4000-8000-000000000051', '91000000-0000-4000-8000-000000000010', 'DASH-SERVICE', 'Dashboard Service', 'EA', false, true);
insert into public.warehouses (id, organization_id, code, name) values
  ('91000000-0000-4000-8000-000000000060', '91000000-0000-4000-8000-000000000010', 'MAIN', 'Dashboard Warehouse');

set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';

select public.post_purchase_receipt(
  '91000000-0000-4000-8000-000000000010',
  '91000000-0000-4000-8000-000000000021',
  '91000000-0000-4000-8000-000000000060',
  '[{"itemId":"91000000-0000-4000-8000-000000000050","quantity":"5","unitCost":"50"}]'::jsonb,
  'dashboard-receipt', 'DN-DASH', null, now() - interval '1 day'
);

select public.create_financial_document_draft_from_profiles(
  '91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000040',
  'tax_invoice', current_date, 'INV', 'intra_state',
  '91000000-0000-4000-8000-000000000020', '91000000-0000-4000-8000-000000000030',
  null, null, null, 'INR', '23', false, 'dashboard INR invoice'
);
select public.upsert_financial_document_line_calculated(
  '91000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'dashboard INR invoice'),
  1, 'Dashboard Stock Item', 2, 'EA', 100,
  '91000000-0000-4000-8000-000000000050', '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  '91000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'dashboard INR invoice'),
  'dashboard-inr-issue'
);
select public.post_sales_fulfillment(
  '91000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'dashboard INR invoice'),
  '91000000-0000-4000-8000-000000000060',
  jsonb_build_array(jsonb_build_object(
    'financialDocumentLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'dashboard INR invoice')),
    'quantity', '1'
  )),
  'dashboard-partial-fulfill'
);
select public.issue_invoice_adjustment(
  '91000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'dashboard INR invoice'),
  'credit_note',
  jsonb_build_array(jsonb_build_object(
    'originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'dashboard INR invoice')),
    'basisQuantity', '1',
    'taxableAdjustment', '50'
  )),
  current_date, 'CRN', 'dashboard concession', 'dashboard-credit'
);

select public.create_financial_document_draft_from_profiles(
  '91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000040',
  'tax_invoice', current_date, 'USDINV', 'intra_state',
  '91000000-0000-4000-8000-000000000020', '91000000-0000-4000-8000-000000000030',
  null, null, null, 'USD', '23', false, 'dashboard USD service invoice'
);
select public.upsert_financial_document_line_calculated(
  '91000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'dashboard USD service invoice'),
  1, 'Dashboard Service', 1, 'EA', 50,
  '91000000-0000-4000-8000-000000000051', '{}'::jsonb, '9983', 0,
  '[]'::jsonb
);
select public.issue_financial_document(
  '91000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'dashboard USD service invoice'),
  'dashboard-usd-issue'
);

select lives_ok(
  $$select public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30)$$,
  'organization owner can read operational dashboard summary'
);

select results_eq(
  $$select jsonb_array_length(public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) -> 'salesByCurrency')$$,
  array[2],
  'money is separated into two currency buckets'
);
select results_eq(
  $$select (x ->> 'invoiceTotal')::numeric, (x ->> 'creditNoteTotal')::numeric, (x ->> 'netDocumentValue')::numeric
    from jsonb_array_elements(public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) -> 'salesByCurrency') x
    where x ->> 'currencyCode' = 'INR'$$,
  $$values (236::numeric, 59::numeric, 177::numeric)$$,
  'INR dashboard totals net issued credit notes in PostgreSQL'
);
select results_eq(
  $$select (x ->> 'invoiceTotal')::numeric, (x ->> 'creditNoteTotal')::numeric, (x ->> 'netDocumentValue')::numeric
    from jsonb_array_elements(public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) -> 'salesByCurrency') x
    where x ->> 'currencyCode' = 'USD'$$,
  $$values (50::numeric, 0::numeric, 50::numeric)$$,
  'USD dashboard totals remain independent from INR'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{inventory,activeTrackedItems}')::integer$$,
  array[1],
  'dashboard counts active tracked items'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{inventory,activeServiceItems}')::integer$$,
  array[1],
  'dashboard counts active service items separately'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{inventory,activeWarehouses}')::integer$$,
  array[1],
  'dashboard counts active warehouses'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{inventory,positiveStockPositions}')::integer$$,
  array[1],
  'dashboard reports positive stock positions without cross-UOM quantity summation'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{inventory,negativeStockPositions}')::integer$$,
  array[0],
  'dashboard reports negative stock positions separately'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{receiving,receiptCount}')::integer,
           (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{receiving,receiptLineCount}')::integer,
           (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{receiving,supplierCount}')::integer$$,
  $$values (1, 1, 1)$$,
  'dashboard reports purchase receiving activity without treating it as payable value'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{fulfillment,unfulfilledInvoices}')::integer,
           (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{fulfillment,partialInvoices}')::integer,
           (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{fulfillment,fulfilledInvoices}')::integer$$,
  $$values (0, 1, 0)$$,
  'dashboard derives partial fulfillment status from immutable postings'
);
select ok(
  (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{activity,auditEventCount}')::integer > 0,
  'dashboard reports recent audit activity'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) #>> '{activity,activeUsers}')::integer$$,
  array[1],
  'dashboard reports distinct recent actors'
);
select results_eq(
  $$select (public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30) ->> 'windowDays')::integer$$,
  array[30],
  'dashboard reports its requested time window'
);
select throws_ok(
  $$select public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 0)$$,
  '22023', null, 'dashboard rejects zero-day windows'
);
select throws_ok(
  $$select public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 366)$$,
  '22023', null, 'dashboard rejects windows longer than one year'
);

set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000002';
select lives_ok(
  $$select public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30)$$,
  'read-only organization member can view dashboard summary'
);

set local request.jwt.claim.sub = '92000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.get_operational_dashboard_summary('91000000-0000-4000-8000-000000000010', 30)$$,
  '42501', null, 'another tenant cannot read dashboard summary'
);

reset role;
select * from finish();
rollback;
