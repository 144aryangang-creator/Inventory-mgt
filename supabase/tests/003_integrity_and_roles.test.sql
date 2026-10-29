begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'multi-org@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Tenant C', 'tenant-c'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Tenant D', 'tenant-d');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'owner'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333', 'admin'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'viewer');

insert into public.items (id, organization_id, sku, name) values
  ('c1000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'C-001', 'Tenant C Item'),
  ('d1000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'D-001', 'Tenant D Item');

insert into public.warehouses (id, organization_id, code, name) values
  ('c2000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'MAIN', 'Tenant C Main'),
  ('d2000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'MAIN', 'Tenant D Main');

insert into public.inventory_movements (
  id, organization_id, item_id, warehouse_id, movement_type, quantity, created_by
) values (
  'c3000000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'c1000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000001',
  'receipt',
  1,
  '33333333-3333-3333-3333-333333333333'
);

insert into public.audit_events (
  organization_id, actor_user_id, action, entity_type
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '33333333-3333-3333-3333-333333333333',
  'test.admin_event',
  'test'
);

select throws_ok(
  $$update public.inventory_movements
    set quantity = 2
    where id = 'c3000000-0000-0000-0000-000000000001'$$,
  '55000',
  null,
  'Inventory ledger is append-only even for privileged database writes'
);

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select throws_ok(
  $$update public.items
    set organization_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '55000',
  null,
  'A user with access to both tenants still cannot move a row across tenants'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select throws_ok(
  $$select public.post_inventory_movement(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'd1000000-0000-0000-0000-000000000001',
      'd2000000-0000-0000-0000-000000000001',
      'receipt', 1, null, 'test', null, 'viewer-post', now()
    )$$,
  '42501',
  null,
  'Viewer role cannot post inventory movements'
);

select results_eq(
  $$select count(*) from public.audit_events
    where organization_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  array[0::bigint],
  'Viewer role cannot read administrative audit events'
);

reset role;
select * from finish();
rollback;
