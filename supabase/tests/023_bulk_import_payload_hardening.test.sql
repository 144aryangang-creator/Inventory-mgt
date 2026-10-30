begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (id, email) values
  ('95000000-0000-4000-8000-000000000001', 'payload-owner@test.local');
insert into public.organizations (id, name, slug) values
  ('95000000-0000-4000-8000-000000000010', 'Payload Tenant', 'payload-tenant');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('95000000-0000-4000-8000-000000000010', '95000000-0000-4000-8000-000000000001', 'owner');
insert into public.items (id, organization_id, sku, name, track_inventory) values
  ('95000000-0000-4000-8000-000000000020', '95000000-0000-4000-8000-000000000010', 'OPEN-A', 'Opening Item A', true),
  ('95000000-0000-4000-8000-000000000021', '95000000-0000-4000-8000-000000000010', 'OPEN-B', 'Opening Item B', true);
insert into public.warehouses (id, organization_id, code, name) values
  ('95000000-0000-4000-8000-000000000030', '95000000-0000-4000-8000-000000000010', 'MAIN', 'Main Warehouse');

set local role authenticated;
set local request.jwt.claim.sub = '95000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.import_opening_stock_v1(
      '95000000-0000-4000-8000-000000000010',
      '[{"itemSku":"OPEN-A","warehouseCode":"MAIN","quantity":"1"}]'::jsonb,
      'missing-cost'
    )$$,
  '22023', null, 'opening stock v1 requires unitCost'
);
select throws_ok(
  $$select public.import_opening_stock_v1(
      '95000000-0000-4000-8000-000000000010',
      '[{"itemSku":"OPEN-A","warehouseCode":"MAIN","quantity":1,"unitCost":"10"}]'::jsonb,
      'numeric-quantity'
    )$$,
  '22023', null, 'opening stock v1 requires quantity as an exact decimal string'
);
select throws_ok(
  $$select public.import_opening_stock_v1(
      '95000000-0000-4000-8000-000000000010',
      '[{"itemSku":"OPEN-A","warehouseCode":"MAIN","quantity":"1","unitCost":10}]'::jsonb,
      'numeric-cost'
    )$$,
  '22023', null, 'opening stock v1 requires unitCost as an exact decimal string'
);
select throws_ok(
  $$select public.import_opening_stock_v1(
      '95000000-0000-4000-8000-000000000010',
      '[{"itemSku":"OPEN-A","warehouseCode":"MAIN","quantity":"1.1234567","unitCost":"10"}]'::jsonb,
      'too-precise'
    )$$,
  '22023', null, 'opening stock v1 rejects precision beyond six decimal places'
);
select lives_ok(
  $$select public.import_opening_stock_v1(
      '95000000-0000-4000-8000-000000000010',
      '[{"itemSku":"OPEN-A","warehouseCode":"MAIN","quantity":"1.250000","unitCost":"0"}]'::jsonb,
      'valid-zero-cost'
    )$$,
  'valid exact-decimal opening stock payload remains accepted'
);
select results_eq(
  $$select quantity_on_hand from public.inventory_balances where organization_id='95000000-0000-4000-8000-000000000010' and item_id='95000000-0000-4000-8000-000000000020' and warehouse_id='95000000-0000-4000-8000-000000000030'$$,
  array[1.25::numeric], 'valid hardened import posts exact opening balance'
);

select * from finish();
rollback;
