begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

select has_table('public', 'data_import_batches', 'data import batch ledger exists');
select ok((select relrowsecurity from pg_class where oid = 'public.data_import_batches'::regclass), 'RLS is enabled on data import batches');

insert into auth.users (id, email) values
  ('91000000-0000-4000-8000-000000000001', 'import-owner@test.local'),
  ('91000000-0000-4000-8000-000000000002', 'import-viewer@test.local'),
  ('92000000-0000-4000-8000-000000000001', 'import-other@test.local');

insert into public.organizations (id, name, slug) values
  ('91000000-0000-4000-8000-000000000010', 'Import Tenant', 'import-tenant'),
  ('92000000-0000-4000-8000-000000000010', 'Other Import Tenant', 'other-import-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000001', 'owner'),
  ('91000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000002', 'viewer'),
  ('92000000-0000-4000-8000-000000000010', '92000000-0000-4000-8000-000000000001', 'owner');

insert into public.warehouses (id, organization_id, code, name) values
  ('91000000-0000-4000-8000-000000000020', '91000000-0000-4000-8000-000000000010', 'MAIN', 'Main Warehouse');

set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.import_items_v1(
      '91000000-0000-4000-8000-000000000010',
      '[{"sku":"A","name":"A","baseUom":"EA","trackInventory":true}]'::jsonb,
      'viewer-import'
    )$$,
  '42501', null, 'viewer cannot execute item import'
);

set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.import_items_v1(
      '91000000-0000-4000-8000-000000000010',
      '[
        {"sku":"item-a","name":"Imported Item A","description":"first item","baseUom":"ea","trackInventory":true},
        {"sku":"item-b","name":"Imported Item B","baseUom":"box","trackInventory":true}
      ]'::jsonb,
      'items-1'
    )$$,
  'owner can atomically import items'
);
select results_eq(
  $$select count(*) from public.items where organization_id = '91000000-0000-4000-8000-000000000010' and sku in ('ITEM-A','ITEM-B')$$,
  array[2::bigint], 'item import creates both rows'
);
select results_eq(
  $$select sku, base_uom from public.items where organization_id = '91000000-0000-4000-8000-000000000010' and sku in ('ITEM-A','ITEM-B') order by sku$$,
  $$values ('ITEM-A'::text,'EA'::text),('ITEM-B'::text,'BOX'::text)$$,
  'item import normalizes SKU and UOM'
);
select results_eq(
  $$select import_type, schema_version, row_count from public.data_import_batches where request_key = 'items-1'$$,
  $$values ('items'::text,1::smallint,2)$$,
  'item import records versioned immutable batch metadata'
);
select results_eq(
  $$select count(*) from public.audit_events where organization_id = '91000000-0000-4000-8000-000000000010' and action = 'data_import.completed'$$,
  array[1::bigint], 'accepted item import appends one top-level import audit event'
);
select results_eq(
  $$select public.import_items_v1(
      '91000000-0000-4000-8000-000000000010',
      '[
        {"sku":"item-a","name":"Imported Item A","description":"first item","baseUom":"ea","trackInventory":true},
        {"sku":"item-b","name":"Imported Item B","baseUom":"box","trackInventory":true}
      ]'::jsonb,
      'items-1'
    )$$,
  $$select id from public.data_import_batches where request_key = 'items-1'$$,
  'identical item import retry is idempotent'
);
select results_eq($$select count(*) from public.data_import_batches where request_key = 'items-1'$$, array[1::bigint], 'idempotent retry creates no second batch');
select throws_ok(
  $$select public.import_items_v1(
      '91000000-0000-4000-8000-000000000010',
      '[{"sku":"item-c","name":"Changed Payload","baseUom":"EA","trackInventory":true}]'::jsonb,
      'items-1'
    )$$,
  '22023', null, 'request key cannot be reused with another payload'
);
select throws_ok(
  $$select public.import_items_v1(
      '91000000-0000-4000-8000-000000000010',
      '[{"sku":"ITEM-A","name":"Duplicate A","baseUom":"EA","trackInventory":true},{"sku":"ITEM-C","name":"Would Roll Back","baseUom":"EA","trackInventory":true}]'::jsonb,
      'items-duplicate'
    )$$,
  '23505', null, 'existing SKU rejects entire create-only item import'
);
select results_eq($$select count(*) from public.items where organization_id = '91000000-0000-4000-8000-000000000010' and sku = 'ITEM-C'$$, array[0::bigint], 'failed item import rolls back later rows');
select results_eq($$select count(*) from public.data_import_batches where request_key = 'items-duplicate'$$, array[0::bigint], 'failed item import rolls back batch header');

select lives_ok(
  $$select public.import_parties_v1(
      '91000000-0000-4000-8000-000000000010','customer',
      '[{"code":"cust-1","legalName":"Customer One Private Limited","displayName":"Customer One","email":"CUSTOMER@EXAMPLE.COM","phone":"12345"}]'::jsonb,
      'customers-1'
    )$$,
  'owner can import customers'
);
select results_eq(
  $$select r.role::text from public.party_roles r join public.parties p on p.id = r.party_id and p.organization_id = r.organization_id where p.code = 'CUST-1' and p.organization_id = '91000000-0000-4000-8000-000000000010'$$,
  array['customer'::text], 'customer import assigns only customer role'
);
select lives_ok(
  $$select public.import_parties_v1(
      '91000000-0000-4000-8000-000000000010','supplier',
      '[{"code":"sup-1","legalName":"Supplier One Private Limited","displayName":"Supplier One","email":"supplier@example.com"}]'::jsonb,
      'suppliers-1'
    )$$,
  'owner can import suppliers'
);
select results_eq(
  $$select r.role::text from public.party_roles r join public.parties p on p.id = r.party_id and p.organization_id = r.organization_id where p.code = 'SUP-1' and p.organization_id = '91000000-0000-4000-8000-000000000010'$$,
  array['supplier'::text], 'supplier import assigns only supplier role'
);
select results_eq(
  $$select email from public.parties where organization_id = '91000000-0000-4000-8000-000000000010' and code = 'CUST-1'$$,
  array['customer@example.com'::text], 'party import preserves existing email normalization rules'
);

select lives_ok(
  $$select public.import_opening_stock_v1(
      '91000000-0000-4000-8000-000000000010',
      '[
        {"itemSku":"ITEM-A","warehouseCode":"MAIN","quantity":"5","unitCost":"10.50"},
        {"itemSku":"ITEM-B","warehouseCode":"MAIN","quantity":"2.5","unitCost":"20"}
      ]'::jsonb,
      'opening-1'
    )$$,
  'owner can import opening stock for untouched inventory positions'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances b join public.items i on i.id=b.item_id and i.organization_id=b.organization_id where b.organization_id='91000000-0000-4000-8000-000000000010' and i.sku='ITEM-A' and b.warehouse_id='91000000-0000-4000-8000-000000000020'$$,
  array[5::numeric], 'opening stock establishes first item balance'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances b join public.items i on i.id=b.item_id and i.organization_id=b.organization_id where b.organization_id='91000000-0000-4000-8000-000000000010' and i.sku='ITEM-B' and b.warehouse_id='91000000-0000-4000-8000-000000000020'$$,
  array[2.5::numeric], 'opening stock establishes second item balance'
);
select results_eq(
  $$select i.sku, m.movement_type::text, m.quantity, m.unit_cost from public.inventory_movements m join public.items i on i.id=m.item_id and i.organization_id=m.organization_id where m.reference_type='opening_stock_import' and m.reference_id=(select id from public.data_import_batches where request_key='opening-1') order by i.sku$$,
  $$values ('ITEM-A'::text,'adjustment_in'::text,5::numeric,10.50::numeric),('ITEM-B'::text,'adjustment_in'::text,2.5::numeric,20::numeric)$$,
  'opening stock uses exact append-only inventory movements and costs'
);
select results_eq(
  $$select public.import_opening_stock_v1(
      '91000000-0000-4000-8000-000000000010',
      '[
        {"itemSku":"ITEM-A","warehouseCode":"MAIN","quantity":"5","unitCost":"10.50"},
        {"itemSku":"ITEM-B","warehouseCode":"MAIN","quantity":"2.5","unitCost":"20"}
      ]'::jsonb,
      'opening-1'
    )$$,
  $$select id from public.data_import_batches where request_key='opening-1'$$,
  'opening stock retry is idempotent'
);
select throws_ok(
  $$select public.import_opening_stock_v1(
      '91000000-0000-4000-8000-000000000010',
      '[{"itemSku":"ITEM-A","warehouseCode":"MAIN","quantity":"1","unitCost":"11"}]'::jsonb,
      'opening-existing'
    )$$,
  '23514', null, 'opening stock cannot be applied to a position with inventory history'
);
select results_eq($$select count(*) from public.data_import_batches where request_key='opening-existing'$$, array[0::bigint], 'rejected opening stock rolls back batch header');
select results_eq(
  $$select quantity_on_hand from public.inventory_balances b join public.items i on i.id=b.item_id and i.organization_id=b.organization_id where b.organization_id='91000000-0000-4000-8000-000000000010' and i.sku='ITEM-A' and b.warehouse_id='91000000-0000-4000-8000-000000000020'$$,
  array[5::numeric], 'rejected opening stock leaves established balance unchanged'
);

select throws_ok(
  $$insert into public.data_import_batches (organization_id,import_type,request_key,request_payload,row_count,created_by) values ('91000000-0000-4000-8000-000000000010','items','direct-write','[]'::jsonb,1,'91000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated clients cannot insert import batch rows directly'
);

set local request.jwt.claim.sub = '92000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.import_items_v1('91000000-0000-4000-8000-000000000010','[{"sku":"X","name":"Cross Tenant","baseUom":"EA","trackInventory":true}]'::jsonb,'cross-import')$$,
  '42501', null, 'another tenant cannot import into this organization'
);
select results_eq($$select count(*) from public.data_import_batches where organization_id='91000000-0000-4000-8000-000000000010'$$, array[0::bigint], 'another tenant cannot read import batch history');

reset role;
select throws_ok($$update public.data_import_batches set row_count=999 where request_key='items-1'$$,'55000',null,'import batches are immutable even for privileged writes');
select results_eq(
  $$select count(*) from public.audit_events where organization_id='91000000-0000-4000-8000-000000000010' and action='data_import.completed'$$,
  array[4::bigint], 'each accepted non-idempotent import appends one top-level audit event'
);

select * from finish();
rollback;
