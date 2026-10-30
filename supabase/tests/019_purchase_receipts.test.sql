begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

select has_table('public', 'purchase_receipt_sequences', 'purchase receipt sequence table exists');
select has_table('public', 'purchase_receipts', 'purchase receipt table exists');
select has_table('public', 'purchase_receipt_lines', 'purchase receipt line table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.purchase_receipts'::regclass), 'RLS is enabled on purchase receipts');
select ok((select relrowsecurity from pg_class where oid = 'public.purchase_receipt_lines'::regclass), 'RLS is enabled on purchase receipt lines');

insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-000000000001', 'receipt-owner@test.local'),
  ('e1000000-0000-4000-8000-000000000002', 'receipt-viewer@test.local'),
  ('f1000000-0000-4000-8000-000000000001', 'receipt-other@test.local');

insert into public.organizations (id, name, slug) values
  ('e1000000-0000-4000-8000-000000000010', 'Receipt Tenant', 'receipt-tenant'),
  ('f1000000-0000-4000-8000-000000000010', 'Other Receipt Tenant', 'other-receipt-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000001', 'owner'),
  ('e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000002', 'viewer'),
  ('f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000001', 'owner');

insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values
  ('e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000010', 'SUP-001', 'Receipt Supplier Private Limited', 'Receipt Supplier', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000021', 'e1000000-0000-4000-8000-000000000010', 'CUST-ONLY', 'Customer Only Private Limited', 'Customer Only', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000010', 'SUP-OTHER', 'Other Supplier Private Limited', 'Other Supplier', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001');

insert into public.party_roles (organization_id, party_id, role) values
  ('e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000020', 'supplier'),
  ('e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000021', 'customer'),
  ('f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000020', 'supplier');

insert into public.items (id, organization_id, sku, name, base_uom, track_inventory, is_active) values
  ('e1000000-0000-4000-8000-000000000030', 'e1000000-0000-4000-8000-000000000010', 'REC-A', 'Receipt Item A', 'EA', true, true),
  ('e1000000-0000-4000-8000-000000000031', 'e1000000-0000-4000-8000-000000000010', 'REC-B', 'Receipt Item B', 'BOX', true, true),
  ('e1000000-0000-4000-8000-000000000032', 'e1000000-0000-4000-8000-000000000010', 'SERVICE', 'Non-stock Service', 'EA', false, true),
  ('e1000000-0000-4000-8000-000000000033', 'e1000000-0000-4000-8000-000000000010', 'INACTIVE', 'Inactive Stock Item', 'EA', true, false);

insert into public.warehouses (id, organization_id, code, name, is_active) values
  ('e1000000-0000-4000-8000-000000000040', 'e1000000-0000-4000-8000-000000000010', 'MAIN', 'Main Receiving Warehouse', true),
  ('e1000000-0000-4000-8000-000000000041', 'e1000000-0000-4000-8000-000000000010', 'CLOSED', 'Inactive Warehouse', false);

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into public.purchase_receipts (
      organization_id, receipt_number, supplier_party_id, supplier_snapshot, warehouse_id,
      received_at, request_key, request_payload, created_by
    ) values (
      'e1000000-0000-4000-8000-000000000010', 999,
      'e1000000-0000-4000-8000-000000000020', '{}'::jsonb,
      'e1000000-0000-4000-8000-000000000040', now(), 'direct-write', '[]'::jsonb,
      'e1000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null, 'authenticated clients cannot insert purchase receipts directly'
);

set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.post_purchase_receipt(
      'e1000000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000020',
      'e1000000-0000-4000-8000-000000000040',
      '[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"1","unitCost":"10"}]'::jsonb,
      'viewer-receipt'
    )$$,
  '42501', null, 'viewer cannot post a purchase receipt'
);

set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.post_purchase_receipt(
      'e1000000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000020',
      'e1000000-0000-4000-8000-000000000040',
      '[
        {"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"3","unitCost":"100.50"},
        {"itemId":"e1000000-0000-4000-8000-000000000031","quantity":"2","unitCost":"250"}
      ]'::jsonb,
      'receipt-one', 'DN-1001', 'first physical receipt', '2026-10-29T10:00:00+00'
    )$$,
  'owner can atomically receive multiple tracked items'
);

select results_eq($$select receipt_number from public.purchase_receipts where request_key = 'receipt-one'$$, array[1::bigint], 'first receipt gets organization sequence number one');
select results_eq(
  $$select supplier_snapshot ->> 'code', supplier_snapshot ->> 'legal_name' from public.purchase_receipts where request_key = 'receipt-one'$$,
  $$values ('SUP-001'::text, 'Receipt Supplier Private Limited'::text)$$,
  'receipt snapshots supplier identity'
);
select results_eq(
  $$select supplier_reference, notes, received_at from public.purchase_receipts where request_key = 'receipt-one'$$,
  $$values ('DN-1001'::text, 'first physical receipt'::text, '2026-10-29T10:00:00+00'::timestamptz)$$,
  'receipt preserves supplier reference notes and physical receipt timestamp'
);
select results_eq($$select count(*) from public.purchase_receipt_lines where receipt_id = (select id from public.purchase_receipts where request_key = 'receipt-one')$$, array[2::bigint], 'receipt stores two immutable lines');
select results_eq(
  $$select line_number, item_snapshot ->> 'sku', uom from public.purchase_receipt_lines where receipt_id = (select id from public.purchase_receipts where request_key = 'receipt-one') order by line_number$$,
  $$values (1, 'REC-A'::text, 'EA'::text), (2, 'REC-B'::text, 'BOX'::text)$$,
  'receipt lines preserve item identity and stock UOM snapshots'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'e1000000-0000-4000-8000-000000000010' and item_id = 'e1000000-0000-4000-8000-000000000030' and warehouse_id = 'e1000000-0000-4000-8000-000000000040'$$,
  array[3::numeric], 'first item stock increases by received quantity'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'e1000000-0000-4000-8000-000000000010' and item_id = 'e1000000-0000-4000-8000-000000000031' and warehouse_id = 'e1000000-0000-4000-8000-000000000040'$$,
  array[2::numeric], 'second item stock increases by received quantity'
);
select results_eq(
  $$select m.quantity, m.unit_cost from public.inventory_movements m join public.purchase_receipt_lines l on l.inventory_movement_id = m.id and l.organization_id = m.organization_id where l.receipt_id = (select id from public.purchase_receipts where request_key = 'receipt-one') order by l.line_number$$,
  $$values (3::numeric, 100.50::numeric), (2::numeric, 250::numeric)$$,
  'inventory movements retain exact received quantities and unit costs'
);
select results_eq(
  $$select count(*) from public.inventory_movements where organization_id = 'e1000000-0000-4000-8000-000000000010' and reference_type = 'purchase_receipt' and reference_id = (select id from public.purchase_receipts where request_key = 'receipt-one')$$,
  array[2::bigint], 'every receipt line links to a purchase-receipt inventory movement'
);
select results_eq(
  $$select count(*) from public.audit_events where organization_id = 'e1000000-0000-4000-8000-000000000010' and action = 'purchase_receipt.posted'$$,
  array[1::bigint], 'accepted receipt appends one high-level audit event'
);

select results_eq(
  $$select public.post_purchase_receipt(
      'e1000000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000020',
      'e1000000-0000-4000-8000-000000000040',
      '[
        {"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"3","unitCost":"100.50"},
        {"itemId":"e1000000-0000-4000-8000-000000000031","quantity":"2","unitCost":"250"}
      ]'::jsonb,
      'receipt-one', 'DN-1001', 'first physical receipt', '2026-10-29T10:00:00+00'
    )$$,
  $$select id from public.purchase_receipts where request_key = 'receipt-one'$$,
  'identical receipt request is idempotent'
);
select results_eq($$select count(*) from public.purchase_receipts$$, array[1::bigint], 'idempotent retry creates no duplicate receipt');
select throws_ok(
  $$select public.post_purchase_receipt(
      'e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000040',
      '[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"4","unitCost":"100.50"}]'::jsonb,
      'receipt-one', 'DN-1001', 'first physical receipt', '2026-10-29T10:00:00+00'
    )$$,
  '22023', null, 'same request key cannot be reused with different receipt payload'
);

select lives_ok(
  $$select public.post_purchase_receipt(
      'e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000040',
      '[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"1","unitCost":"0"}]'::jsonb,
      'receipt-two', 'FREE-SAMPLE', 'zero-cost sample', '2026-10-29T11:00:00+00'
    )$$,
  'zero-cost stock receipts are allowed when physically received'
);
select results_eq($$select receipt_number from public.purchase_receipts where request_key = 'receipt-two'$$, array[2::bigint], 'second receipt gets sequence number two');
select results_eq(
  $$select unit_cost from public.inventory_movements where reference_type = 'purchase_receipt' and reference_id = (select id from public.purchase_receipts where request_key = 'receipt-two')$$,
  array[0::numeric], 'zero unit cost is preserved exactly'
);
select results_eq($$select next_number from public.purchase_receipt_sequences where organization_id = 'e1000000-0000-4000-8000-000000000010'$$, array[3::bigint], 'receipt sequence advances transactionally');

select throws_ok(
  $$select public.post_purchase_receipt(
      'e1000000-0000-4000-8000-000000000010', 'e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000040',
      '[
        {"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"2","unitCost":"90"},
        {"itemId":"e1000000-0000-4000-8000-000000000032","quantity":"1","unitCost":"50"}
      ]'::jsonb,
      'receipt-mixed-invalid'
    )$$,
  '23503', null, 'one invalid service line rolls back the whole multi-line receipt'
);
select results_eq($$select count(*) from public.purchase_receipts$$, array[2::bigint], 'failed mixed receipt leaves no header');
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id = 'e1000000-0000-4000-8000-000000000010' and item_id = 'e1000000-0000-4000-8000-000000000030' and warehouse_id = 'e1000000-0000-4000-8000-000000000040'$$,
  array[4::numeric], 'failed mixed receipt rolls back earlier line stock movement'
);
select results_eq($$select next_number from public.purchase_receipt_sequences where organization_id = 'e1000000-0000-4000-8000-000000000010'$$, array[3::bigint], 'failed receipt does not consume receipt number');

select throws_ok(
  $$select public.post_purchase_receipt('e1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000020','e1000000-0000-4000-8000-000000000040','[{"itemId":"e1000000-0000-4000-8000-000000000032","quantity":"1","unitCost":"10"}]'::jsonb,'receipt-service')$$,
  '23503', null, 'non-stock service item cannot be physically received'
);
select throws_ok(
  $$select public.post_purchase_receipt('e1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000020','e1000000-0000-4000-8000-000000000040','[{"itemId":"e1000000-0000-4000-8000-000000000033","quantity":"1","unitCost":"10"}]'::jsonb,'receipt-inactive-item')$$,
  '23503', null, 'inactive inventory item cannot be received'
);
select throws_ok(
  $$select public.post_purchase_receipt('e1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000021','e1000000-0000-4000-8000-000000000040','[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"1","unitCost":"10"}]'::jsonb,'receipt-customer-party')$$,
  '23503', null, 'party without supplier role cannot be used for a purchase receipt'
);
select throws_ok(
  $$select public.post_purchase_receipt('e1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000020','e1000000-0000-4000-8000-000000000041','[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"1","unitCost":"10"}]'::jsonb,'receipt-inactive-wh')$$,
  '23503', null, 'inactive warehouse cannot receive stock'
);
select throws_ok(
  $$select public.post_purchase_receipt('e1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000020','e1000000-0000-4000-8000-000000000040','[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"1","unitCost":"10"}]'::jsonb,'receipt-future',null,null,now() + interval '1 hour')$$,
  '22023', null, 'receipt timestamp cannot be in the future'
);

set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.post_purchase_receipt('e1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000020','e1000000-0000-4000-8000-000000000040','[{"itemId":"e1000000-0000-4000-8000-000000000030","quantity":"1","unitCost":"10"}]'::jsonb,'receipt-cross-tenant')$$,
  '42501', null, 'another tenant cannot post a receipt in this organization'
);
select results_eq($$select count(*) from public.purchase_receipts where organization_id = 'e1000000-0000-4000-8000-000000000010'$$, array[0::bigint], 'another tenant cannot read this organizations receipt history');

reset role;
select throws_ok($$update public.purchase_receipts set notes = 'tampered' where request_key = 'receipt-one'$$, '55000', null, 'purchase receipt headers are immutable even for privileged writes');
select throws_ok($$update public.purchase_receipt_lines set quantity = 999 where receipt_id = (select id from public.purchase_receipts where request_key = 'receipt-one')$$, '55000', null, 'purchase receipt lines are immutable even for privileged writes');

update public.parties set legal_name = 'Supplier Renamed Later' where id = 'e1000000-0000-4000-8000-000000000020';
update public.items set name = 'Item A Renamed Later' where id = 'e1000000-0000-4000-8000-000000000030';

select results_eq(
  $$select supplier_snapshot ->> 'legal_name' from public.purchase_receipts where request_key = 'receipt-one'$$,
  array['Receipt Supplier Private Limited'::text], 'supplier snapshot does not change after supplier master edit'
);
select results_eq(
  $$select item_snapshot ->> 'name' from public.purchase_receipt_lines where receipt_id = (select id from public.purchase_receipts where request_key = 'receipt-one') and line_number = 1$$,
  array['Receipt Item A'::text], 'item snapshot does not change after item master edit'
);

select * from finish();
rollback;
