begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

insert into auth.users (id, email) values
  ('91910000-0000-4000-8000-000000000001', 'inventory-owner@test.local'),
  ('91910000-0000-4000-8000-000000000002', 'inventory-staff@test.local'),
  ('91910000-0000-4000-8000-000000000003', 'inventory-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('91910000-0000-4000-8000-000000000010', 'Inventory Workflow Tenant', 'inventory-workflow-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('91910000-0000-4000-8000-000000000010', '91910000-0000-4000-8000-000000000001', 'owner'),
  ('91910000-0000-4000-8000-000000000010', '91910000-0000-4000-8000-000000000002', 'staff'),
  ('91910000-0000-4000-8000-000000000010', '91910000-0000-4000-8000-000000000003', 'viewer');

set local role authenticated;
set local request.jwt.claim.sub = '91910000-0000-4000-8000-000000000002';

select throws_ok(
  $$insert into public.items (organization_id, sku, name)
    values ('91910000-0000-4000-8000-000000000010', 'DIRECT', 'Direct item')$$,
  '42501',
  null,
  'authenticated clients cannot insert items directly'
);

select lives_ok(
  $$select public.create_item(
      '91910000-0000-4000-8000-000000000010',
      'tr-001', 'Tracked Item', 'Test stock item', 'ea', true, '{"brand":"Test"}'::jsonb
    )$$,
  'staff can create an item through the audited RPC'
);

select results_eq(
  $$select sku, base_uom, track_inventory
    from public.items where organization_id = '91910000-0000-4000-8000-000000000010'$$,
  $$values ('TR-001'::text, 'EA'::text, true)$$,
  'item SKU and UOM are normalized'
);

select throws_ok(
  $$update public.items set name = 'Direct edit' where sku = 'TR-001'$$,
  '42501',
  null,
  'authenticated clients cannot update items directly'
);

set local request.jwt.claim.sub = '91910000-0000-4000-8000-000000000003';
select throws_ok(
  $$select public.create_item(
      '91910000-0000-4000-8000-000000000010',
      'VIEW-1', 'Viewer Item', null, 'EA', true, '{}'::jsonb
    )$$,
  '42501',
  null,
  'viewer cannot create items'
);

set local request.jwt.claim.sub = '91910000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.create_warehouse(
      '91910000-0000-4000-8000-000000000010', 'STAFF', 'Staff Warehouse'
    )$$,
  '42501',
  null,
  'staff cannot create warehouses'
);

set local request.jwt.claim.sub = '91910000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.create_warehouse(
      '91910000-0000-4000-8000-000000000010', 'main', 'Main Warehouse'
    )$$,
  'owner can create the source warehouse'
);

select lives_ok(
  $$select public.create_warehouse(
      '91910000-0000-4000-8000-000000000010', 'second', 'Second Warehouse'
    )$$,
  'owner can create the destination warehouse'
);

select lives_ok(
  $$select public.create_warehouse(
      '91910000-0000-4000-8000-000000000010', 'unused', 'Unused Warehouse'
    )$$,
  'owner can create an unused warehouse'
);

select lives_ok(
  $$select public.post_inventory_movement(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001'),
      (select id from public.warehouses where code = 'MAIN'),
      'receipt', 10, 100, 'manual_receipt', null, 'inventory-seed-10'
    )$$,
  'receipt establishes stock in the source warehouse'
);

select throws_ok(
  $$select public.archive_item(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001')
    )$$,
  '23514',
  null,
  'item with non-zero stock cannot be archived'
);

select throws_ok(
  $$select public.update_item(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001'),
      'TR-001', 'Tracked Item', 'Test stock item', 'EA', false, '{"brand":"Test"}'::jsonb
    )$$,
  '23514',
  null,
  'inventory tracking cannot be disabled while stock remains'
);

select lives_ok(
  $$select public.transfer_inventory(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001'),
      (select id from public.warehouses where code = 'MAIN'),
      (select id from public.warehouses where code = 'SECOND'),
      4, 'transfer-one'
    )$$,
  'stock can be transferred atomically between warehouses'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and item_id = (select id from public.items where sku = 'TR-001')
      and warehouse_id = (select id from public.warehouses where code = 'MAIN')$$,
  array[6::numeric],
  'source balance is reduced by transfer quantity'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and item_id = (select id from public.items where sku = 'TR-001')
      and warehouse_id = (select id from public.warehouses where code = 'SECOND')$$,
  array[4::numeric],
  'destination balance is increased by transfer quantity'
);

select results_eq(
  $$select count(*) from public.inventory_movements
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and reference_type = 'inventory_transfer'$$,
  array[2::bigint],
  'one transfer creates exactly one outbound and one inbound movement'
);

select results_eq(
  $$select public.transfer_inventory(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001'),
      (select id from public.warehouses where code = 'MAIN'),
      (select id from public.warehouses where code = 'SECOND'),
      4, 'transfer-one'
    )$$,
  $$select id from public.inventory_movements
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and request_key = 'transfer-one:out'$$,
  'same transfer request key is idempotent'
);

select results_eq(
  $$select w.code, b.quantity_on_hand
    from public.inventory_balances b
    join public.warehouses w on w.id = b.warehouse_id and w.organization_id = b.organization_id
    where b.organization_id = '91910000-0000-4000-8000-000000000010'
      and b.item_id = (select id from public.items where sku = 'TR-001')
    order by w.code$$,
  $$values ('MAIN'::text, 6::numeric), ('SECOND'::text, 4::numeric)$$,
  'idempotent transfer retry does not change balances again'
);

select results_eq(
  $$select count(*) from public.audit_events
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and action = 'inventory.transferred'
      and metadata ->> 'request_key' = 'transfer-one'$$,
  array[1::bigint],
  'idempotent transfer retry does not duplicate the high-level audit event'
);

select throws_ok(
  $$select public.transfer_inventory(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001'),
      (select id from public.warehouses where code = 'MAIN'),
      (select id from public.warehouses where code = 'SECOND'),
      3, 'transfer-one'
    )$$,
  '22023',
  null,
  'transfer request key cannot be reused with a different quantity'
);

select throws_ok(
  $$select public.transfer_inventory(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.items where sku = 'TR-001'),
      (select id from public.warehouses where code = 'MAIN'),
      (select id from public.warehouses where code = 'SECOND'),
      7, 'transfer-too-much'
    )$$,
  '23514',
  null,
  'insufficient source stock rolls back the transfer'
);

select results_eq(
  $$select w.code, b.quantity_on_hand
    from public.inventory_balances b
    join public.warehouses w on w.id = b.warehouse_id and w.organization_id = b.organization_id
    where b.organization_id = '91910000-0000-4000-8000-000000000010'
      and b.item_id = (select id from public.items where sku = 'TR-001')
    order by w.code$$,
  $$values ('MAIN'::text, 6::numeric), ('SECOND'::text, 4::numeric)$$,
  'failed transfer leaves both balances unchanged'
);

select throws_ok(
  $$select public.archive_warehouse(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.warehouses where code = 'MAIN')
    )$$,
  '23514',
  null,
  'warehouse with non-zero stock cannot be archived'
);

select lives_ok(
  $$select public.archive_warehouse(
      '91910000-0000-4000-8000-000000000010',
      (select id from public.warehouses where code = 'UNUSED')
    )$$,
  'unused zero-stock warehouse can be archived'
);

select results_eq(
  $$select is_active from public.warehouses where code = 'UNUSED'$$,
  array[false],
  'archived warehouse is inactive'
);

select ok(
  exists (
    select 1 from public.audit_events
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and action = 'inventory.item_created'
  ),
  'item creation is audited'
);

select ok(
  exists (
    select 1 from public.audit_events
    where organization_id = '91910000-0000-4000-8000-000000000010'
      and action = 'inventory.warehouse_archived'
  ),
  'warehouse archive is audited'
);

reset role;
select * from finish();
rollback;
