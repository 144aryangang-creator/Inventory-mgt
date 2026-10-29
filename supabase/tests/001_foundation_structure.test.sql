begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'organization_memberships', 'organization memberships table exists');
select has_table('public', 'items', 'items table exists');
select has_table('public', 'warehouses', 'warehouses table exists');
select has_table('public', 'inventory_balances', 'inventory balances table exists');
select has_table('public', 'inventory_movements', 'inventory movements table exists');
select has_table('public', 'audit_events', 'audit events table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.organizations'::regclass),
  'RLS is enabled on organizations'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.items'::regclass),
  'RLS is enabled on items'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.inventory_movements'::regclass),
  'RLS is enabled on inventory movements'
);

select has_index(
  'public',
  'organization_memberships',
  'organization_memberships_user_id_idx',
  'membership user lookup is indexed for RLS'
);

select has_index(
  'public',
  'inventory_movements',
  'inventory_movements_org_request_key_uq',
  'inventory idempotency key has a unique index'
);

select * from finish();
rollback;
