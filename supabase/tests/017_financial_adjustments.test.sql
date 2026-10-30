begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

select has_table('public', 'financial_adjustments', 'financial adjustments table exists');
select has_table('public', 'financial_adjustment_lines', 'financial adjustment lines table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.financial_adjustments'::regclass),
  'RLS is enabled on financial adjustments'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.financial_adjustment_lines'::regclass),
  'RLS is enabled on financial adjustment lines'
);

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'adjust-owner@test.local'),
  ('a1000000-0000-4000-8000-000000000002', 'adjust-viewer@test.local'),
  ('b1000000-0000-4000-8000-000000000001', 'adjust-other-owner@test.local');

insert into public.organizations (id, name, slug) values
  ('a1000000-0000-4000-8000-000000000010', 'Adjustment Tenant A', 'adjustment-tenant-a'),
  ('b1000000-0000-4000-8000-000000000010', 'Adjustment Tenant B', 'adjustment-tenant-b');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000002', 'viewer'),
  ('b1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000001', 'owner');

insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values
  ('a1000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000010', 'CUST-A', 'Adjustment Customer A Private Limited', 'Adjustment Customer A', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000020', 'b1000000-0000-4000-8000-000000000010', 'CUST-B', 'Adjustment Customer B Private Limited', 'Adjustment Customer B', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');

insert into public.party_roles (organization_id, party_id, role) values
  ('a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000020', 'customer'),
  ('b1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000020', 'customer');

insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping, is_registered_address,
  created_by, updated_by
) values
  ('a1000000-0000-4000-8000-000000000030', 'a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000020', 'Billing', '10 Adjustment Road', 'Bhopal', 'Madhya Pradesh', '23', '462001', 'IN', true, true, true, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000030', 'b1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000020', 'Billing', '20 Adjustment Road', 'Bhopal', 'Madhya Pradesh', '23', '462002', 'IN', true, true, true, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');

insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values
  ('a1000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000010', 'SELL-A', 'Adjustment Seller A Private Limited', '23ABCDE1234F1Z5', '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462010', true, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000040', 'b1000000-0000-4000-8000-000000000010', 'SELL-B', 'Adjustment Seller B Private Limited', '23ABCDE1234F2Z6', '2 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462020', true, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');

insert into public.items (id, organization_id, sku, name) values
  ('a1000000-0000-4000-8000-000000000050', 'a1000000-0000-4000-8000-000000000010', 'ADJ-ITEM', 'Adjustment Stock Item');
insert into public.warehouses (id, organization_id, code, name) values
  ('a1000000-0000-4000-8000-000000000060', 'a1000000-0000-4000-8000-000000000010', 'MAIN', 'Main Warehouse');

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

select public.create_financial_document_draft_from_profiles(
  'a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000040',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  'a1000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000030',
  null, null, null, 'INR', '23', false, 'commercial adjustment service invoice'
);
select public.upsert_financial_document_line_calculated(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
  1, 'Consulting service', 2, 'EA', 500, null, '{}'::jsonb, '9983', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
  'issue-adjust-service'
);

select public.post_inventory_movement(
  'a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000050',
  'a1000000-0000-4000-8000-000000000060', 'receipt', 20, 50, 'opening_stock', null, 'adjust-opening-stock'
);
select public.create_financial_document_draft_from_profiles(
  'a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000040',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  'a1000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000030',
  null, null, null, 'INR', '23', false, 'commercial adjustment stock invoice'
);
select public.upsert_financial_document_line_calculated(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'),
  1, 'Adjustment Stock Item', 10, 'EA', 100,
  'a1000000-0000-4000-8000-000000000050', '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'),
  'issue-adjust-stock'
);
select public.fulfill_sales_invoice(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'),
  'a1000000-0000-4000-8000-000000000060', 'adjust-stock-fulfill'
);
select public.return_sales_fulfillment(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.sales_fulfillments where request_key = 'adjust-stock-fulfill'),
  jsonb_build_array(jsonb_build_object(
    'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = 'a1000000-0000-4000-8000-000000000010' and fulfillment_id = (select id from public.sales_fulfillments where request_key = 'adjust-stock-fulfill')),
    'quantity', '4'
  )),
  'four units returned', 'adjust-stock-return-4'
);
select public.issue_sales_return_credit_note(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.sales_returns where request_key = 'adjust-stock-return-4'),
  jsonb_build_array(jsonb_build_object(
    'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = 'a1000000-0000-4000-8000-000000000010' and fulfillment_id = (select id from public.sales_fulfillments where request_key = 'adjust-stock-fulfill')),
    'quantity', '4'
  )),
  '2026-10-30', 'CRN', 'adjust-return-credit-4'
);

select throws_ok(
  $$insert into public.financial_adjustments (
      organization_id, original_invoice_id, adjustment_document_id, adjustment_type,
      reason, document_date, series_code, request_key, request_payload, created_by
    ) values (
      'a1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
      (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
      'credit_note', 'direct write', '2026-10-30', 'CRN', 'direct-adjust', '[]'::jsonb,
      'a1000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null, 'authenticated clients cannot insert financial adjustment links directly'
);

select throws_ok(
  $$select public.create_financial_document_draft_from_profiles(
      'a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000040',
      'credit_note', '2026-10-30', 'CRN', 'intra_state',
      'a1000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000030',
      null, null,
      (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
      'INR', '23', false, 'bypass credit'
    )$$,
  '42501', null, 'generic profile draft RPC cannot bypass controlled credit/debit workflows'
);

set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.issue_invoice_adjustment(
      'a1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
      'credit_note',
      jsonb_build_array(jsonb_build_object(
        'originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')),
        'basisQuantity', '1', 'taxableAdjustment', '300'
      )),
      '2026-10-30', 'CRN', 'service deficiency', 'viewer-adjust'
    )$$,
  '42501', null, 'viewer cannot issue a commercial credit/debit adjustment'
);

set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.issue_invoice_adjustment(
      'a1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
      'credit_note',
      jsonb_build_array(jsonb_build_object(
        'originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')),
        'basisQuantity', '1', 'taxableAdjustment', '300'
      )),
      '2026-10-30', 'CRN', 'service deficiency', 'service-credit-300'
    )$$,
  'owner can issue a commercial credit note from an issued invoice line'
);

select results_eq(
  $$select document_type::text, status::text, linked_document_id, grand_total
    from public.financial_documents
    where id = (select adjustment_document_id from public.financial_adjustments where request_key = 'service-credit-300')$$,
  $$values ('credit_note'::text, 'issued'::text, (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 354::numeric)$$,
  'commercial credit is issued, linked and uses original GST treatment'
);

select results_eq(
  $$select l.quantity, l.taxable_value, l.description
    from public.financial_document_lines l
    where l.document_id = (select adjustment_document_id from public.financial_adjustments where request_key = 'service-credit-300')$$,
  $$values (1::numeric, 300::numeric, 'Consulting service'::text)$$,
  'credit line preserves original description and requested taxable adjustment'
);

select results_eq(
  $$select component::text, rate, amount
    from public.financial_document_line_taxes
    where line_id = (select id from public.financial_document_lines where document_id = (select adjustment_document_id from public.financial_adjustments where request_key = 'service-credit-300')) order by component$$,
  $$values ('CGST'::text, 9::numeric, 27::numeric), ('SGST'::text, 9::numeric, 27::numeric)$$,
  'credit line copies original GST components and rates'
);

select results_eq(
  $$select public.issue_invoice_adjustment(
      'a1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'commercial adjustment service invoice'),
      'credit_note',
      jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')), 'basisQuantity', '1', 'taxableAdjustment', '300')),
      '2026-10-30', 'CRN', 'service deficiency', 'service-credit-300'
    )$$,
  $$select adjustment_document_id from public.financial_adjustments where request_key = 'service-credit-300'$$,
  'identical adjustment request is idempotent'
);

select results_eq($$select count(*) from public.financial_adjustments where request_key = 'service-credit-300'$$, array[1::bigint], 'idempotent retry creates no duplicate adjustment linkage');

select throws_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')), 'basisQuantity', '1', 'taxableAdjustment', '301')), '2026-10-30', 'CRN', 'service deficiency', 'service-credit-300')$$,
  '22023', null, 'same request key cannot be reused for a different adjustment payload'
);

select throws_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')), 'basisQuantity', '2', 'taxableAdjustment', '800')), '2026-10-30', 'CRN', 'too much credit', 'service-credit-over')$$,
  '23514', null, 'active commercial credits cannot exceed original taxable value'
);

select throws_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')), 'basisQuantity', '3', 'taxableAdjustment', '50')), '2026-10-30', 'CRN', 'bad basis', 'service-credit-basis-over')$$,
  '23514', null, 'adjustment basis quantity cannot exceed original invoice quantity'
);

select throws_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')), 'basisQuantity', '1', 'taxableAdjustment', '50')), '2026-10-30', 'CRN', 'wrong line', 'service-credit-wrong-line')$$,
  'P0002', null, 'adjustment cannot reference a line from another invoice'
);

select lives_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'debit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment service invoice')), 'basisQuantity', '2', 'taxableAdjustment', '1500')), '2026-10-30', 'DBN', 'undercharged service value', 'service-debit-1500')$$,
  'debit note may increase taxable value beyond the original line value'
);

select results_eq(
  $$select document_type::text, status::text, linked_document_id, grand_total from public.financial_documents where id = (select adjustment_document_id from public.financial_adjustments where request_key = 'service-debit-1500')$$,
  $$values ('debit_note'::text, 'issued'::text, (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 1770::numeric)$$,
  'debit note is issued and linked to original tax invoice'
);

select results_eq(
  $$select component::text, rate, amount from public.financial_document_line_taxes where line_id = (select id from public.financial_document_lines where document_id = (select adjustment_document_id from public.financial_adjustments where request_key = 'service-debit-1500')) order by component$$,
  $$values ('CGST'::text, 9::numeric, 135::numeric), ('SGST'::text, 9::numeric, 135::numeric)$$,
  'debit note preserves original GST rates'
);

select throws_ok(
  $$select public.cancel_financial_document('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'cancel original with active corrections')$$,
  '23514', null, 'original invoice cannot be cancelled while active correction documents exist'
);

select lives_ok(
  $$select public.cancel_financial_document('a1000000-0000-4000-8000-000000000010', (select adjustment_document_id from public.financial_adjustments where request_key = 'service-credit-300'), 'credit created in error')$$,
  'commercial credit note can be cancelled without mutating original invoice'
);
select throws_ok(
  $$select public.cancel_financial_document('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'debit still active')$$,
  '23514', null, 'original cancellation remains blocked while any active correction remains'
);
select lives_ok(
  $$select public.cancel_financial_document('a1000000-0000-4000-8000-000000000010', (select adjustment_document_id from public.financial_adjustments where request_key = 'service-debit-1500'), 'debit created in error')$$,
  'commercial debit note can be cancelled'
);
select lives_ok(
  $$select public.cancel_financial_document('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment service invoice'), 'all commercial corrections cancelled')$$,
  'service invoice can be cancelled after all linked corrections are cancelled'
);

reset role;
select throws_ok($$update public.financial_adjustments set reason = 'tampered' where request_key = 'service-credit-300'$$, '55000', null, 'financial adjustment headers are immutable even for privileged writes');
select throws_ok($$update public.financial_adjustment_lines set taxable_adjustment = 1 where adjustment_document_id = (select adjustment_document_id from public.financial_adjustments where request_key = 'service-credit-300')$$, '55000', null, 'financial adjustment line links are immutable even for privileged writes');

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select results_eq(
  $$select app_private.active_credited_taxable_for_invoice_line('a1000000-0000-4000-8000-000000000010', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')))$$,
  array[400::numeric], 'shared credit helper includes active return-linked credit taxable value'
);

select lives_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')), 'basisQuantity', '5', 'taxableAdjustment', '500')), '2026-10-30', 'CRN', 'commercial stock concession', 'stock-credit-500')$$,
  'commercial credit can use remaining taxable capacity after a return credit'
);
select results_eq(
  $$select app_private.active_credited_taxable_for_invoice_line('a1000000-0000-4000-8000-000000000010', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')))$$,
  array[900::numeric], 'shared credit ceiling aggregates return and commercial credits'
);
select throws_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')), 'basisQuantity', '2', 'taxableAdjustment', '200')), '2026-10-30', 'CRN', 'would exceed combined ceiling', 'stock-credit-over')$$,
  '23514', null, 'commercial credit cannot exceed remaining value after return-linked credits'
);
select lives_ok(
  $$select public.cancel_financial_document('a1000000-0000-4000-8000-000000000010', (select adjustment_document_id from public.financial_adjustments where request_key = 'stock-credit-500'), 'replace stock concession')$$,
  'cancelling commercial credit releases its taxable capacity'
);
select lives_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')), 'basisQuantity', '6', 'taxableAdjustment', '600')), '2026-10-30', 'CRN', 'replacement stock concession', 'stock-credit-600')$$,
  'released capacity can be reused by a replacement commercial credit'
);
select throws_ok(
  $$select public.issue_invoice_adjustment('a1000000-0000-4000-8000-000000000010', (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'), 'credit_note', jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')), 'basisQuantity', '1', 'taxableAdjustment', '1')), '2026-10-30', 'CRN', 'no credit capacity left', 'stock-credit-full')$$,
  '23514', null, 'combined active credits cannot exceed the original taxable value'
);

select public.return_sales_fulfillment(
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.sales_fulfillments where request_key = 'adjust-stock-fulfill'),
  jsonb_build_array(jsonb_build_object(
    'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = 'a1000000-0000-4000-8000-000000000010' and fulfillment_id = (select id from public.sales_fulfillments where request_key = 'adjust-stock-fulfill')),
    'quantity', '1'
  )), 'one more unit returned', 'adjust-stock-return-1'
);
select throws_ok(
  $$select public.issue_sales_return_credit_note(
      'a1000000-0000-4000-8000-000000000010',
      (select id from public.sales_returns where request_key = 'adjust-stock-return-1'),
      jsonb_build_array(jsonb_build_object(
        'fulfillmentLineId', (select financial_document_line_id from public.sales_fulfillment_lines where organization_id = 'a1000000-0000-4000-8000-000000000010' and fulfillment_id = (select id from public.sales_fulfillments where request_key = 'adjust-stock-fulfill')),
        'quantity', '1'
      )),
      '2026-10-30', 'CRN', 'adjust-return-credit-over-global'
    )$$,
  '23514', null, 'return-linked credit also respects taxable capacity already consumed by commercial credits'
);

set local request.jwt.claim.sub = 'b1000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.issue_invoice_adjustment(
      'a1000000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'commercial adjustment stock invoice'),
      'debit_note',
      jsonb_build_array(jsonb_build_object('originalLineId', (select id from public.financial_document_lines where document_id = (select id from public.financial_documents where notes = 'commercial adjustment stock invoice')), 'basisQuantity', '1', 'taxableAdjustment', '10')),
      '2026-10-30', 'DBN', 'cross tenant attempt', 'cross-tenant-adjust'
    )$$,
  '42501', null, 'another tenant cannot issue adjustments in this organization'
);

set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*) from public.audit_events where organization_id = 'a1000000-0000-4000-8000-000000000010' and action = 'financial_document.adjustment_issued'$$,
  array[4::bigint], 'every accepted commercial adjustment appends one high-level audit event'
);

select * from finish();
rollback;
