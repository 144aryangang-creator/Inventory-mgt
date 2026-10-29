begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

-- Two independent users and tenants.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'tenant-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'tenant-b@test.local');

insert into public.organizations (id, name, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A', 'tenant-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B', 'tenant-b');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.items (id, organization_id, sku, name) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A-001', 'Tenant A Item'),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B-001', 'Tenant B Item');

insert into public.warehouses (id, organization_id, code, name) values
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'MAIN', 'Tenant A Main'),
  ('b2000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'MAIN', 'Tenant B Main');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*) from public.organizations$$,
  array[1::bigint],
  'Tenant A user sees only Tenant A organization'
);

select results_eq(
  $$select count(*) from public.items$$,
  array[1::bigint],
  'Tenant A user sees only Tenant A items'
);

select results_eq(
  $$select count(*) from public.warehouses$$,
  array[1::bigint],
  'Tenant A user sees only Tenant A warehouses'
);

select throws_ok(
  $$insert into public.items (organization_id, sku, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'HACK', 'Cross Tenant Item')$$,
  '42501',
  null,
  'Tenant A cannot insert an item into Tenant B'
);

select throws_ok(
  $$insert into public.inventory_movements (
      organization_id, item_id, warehouse_id, movement_type, quantity, created_by
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1000000-0000-0000-0000-000000000001',
      'a2000000-0000-0000-0000-000000000001',
      'receipt', 1,
      '11111111-1111-1111-1111-111111111111'
    )$$,
  '42501',
  null,
  'Authenticated users cannot bypass posting RPC with direct ledger inserts'
);

select lives_ok(
  $$select public.post_inventory_movement(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1000000-0000-0000-0000-000000000001',
      'a2000000-0000-0000-0000-000000000001',
      'receipt', 10, 100, 'test', null, 'receipt-1', now()
    )$$,
  'Authorized user can post an inventory receipt'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[10::numeric],
  'Receipt updates locked stock balance'
);

select lives_ok(
  $$select public.post_inventory_movement(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1000000-0000-0000-0000-000000000001',
      'a2000000-0000-0000-0000-000000000001',
      'sale', -3, 100, 'test', null, 'sale-1', now()
    )$$,
  'Authorized user can post a sale within available stock'
);

select results_eq(
  $$select quantity_on_hand from public.inventory_balances
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[7::numeric],
  'Sale reduces stock balance'
);

select throws_ok(
  $$select public.post_inventory_movement(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1000000-0000-0000-0000-000000000001',
      'a2000000-0000-0000-0000-000000000001',
      'sale', -8, 100, 'test', null, 'oversell-1', now()
    )$$,
  '23514',
  null,
  'Negative inventory is blocked when organization disallows it'
);

select results_eq(
  $$select count(*) from public.inventory_movements
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[2::bigint],
  'Rejected oversell does not create a ledger movement'
);

select lives_ok(
  $$select public.post_inventory_movement(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1000000-0000-0000-0000-000000000001',
      'a2000000-0000-0000-0000-000000000001',
      'sale', -3, 100, 'test', null, 'sale-1', now()
    )$$,
  'Retry with same idempotency key and same payload returns safely'
);

select results_eq(
  $$select count(*) from public.inventory_movements
    where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  array[2::bigint],
  'Idempotent retry does not duplicate the stock movement'
);

reset role;
select * from finish();
rollback;
