begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('93000000-0000-4000-8000-000000000001', 'validate-owner@test.local'),
  ('93000000-0000-4000-8000-000000000002', 'validate-viewer@test.local'),
  ('94000000-0000-4000-8000-000000000001', 'validate-other@test.local');

insert into public.organizations (id, name, slug) values
  ('93000000-0000-4000-8000-000000000010', 'Validation Tenant', 'validation-tenant'),
  ('94000000-0000-4000-8000-000000000010', 'Validation Other', 'validation-other');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('93000000-0000-4000-8000-000000000010', '93000000-0000-4000-8000-000000000001', 'owner'),
  ('93000000-0000-4000-8000-000000000010', '93000000-0000-4000-8000-000000000002', 'viewer'),
  ('94000000-0000-4000-8000-000000000010', '94000000-0000-4000-8000-000000000001', 'owner');

insert into public.items (id, organization_id, sku, name, track_inventory) values
  ('93000000-0000-4000-8000-000000000020','93000000-0000-4000-8000-000000000010','EXISTING','Existing Item',true),
  ('93000000-0000-4000-8000-000000000021','93000000-0000-4000-8000-000000000010','HISTORY','History Item',true),
  ('93000000-0000-4000-8000-000000000022','93000000-0000-4000-8000-000000000010','CLEAN','Clean Item',true);

insert into public.warehouses (id, organization_id, code, name) values
  ('93000000-0000-4000-8000-000000000030','93000000-0000-4000-8000-000000000010','MAIN','Main Warehouse');

insert into public.parties (id, organization_id, code, legal_name, display_name, created_by, updated_by) values
  ('93000000-0000-4000-8000-000000000040','93000000-0000-4000-8000-000000000010','PARTY-1','Existing Party Private Limited','Existing Party','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001');
insert into public.party_roles (organization_id, party_id, role) values
  ('93000000-0000-4000-8000-000000000010','93000000-0000-4000-8000-000000000040','customer');

set local role authenticated;
set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000001';
select public.post_inventory_movement(
  '93000000-0000-4000-8000-000000000010','93000000-0000-4000-8000-000000000021','93000000-0000-4000-8000-000000000030',
  'adjustment_in',1,10,'test_history',null,'validate-history'
);

set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','items','[{"sku":"NEW"}]'::jsonb)$$,
  '42501', null, 'viewer cannot run import dry-run validation'
);

set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000001';
select results_eq(
  $$select jsonb_array_length(public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','items','[{"sku":"EXISTING"}]'::jsonb))$$,
  array[1], 'item dry-run detects an existing SKU'
);
select results_eq(
  $$select jsonb_array_length(public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','items','[{"sku":"NEW"}]'::jsonb))$$,
  array[0], 'item dry-run accepts a new SKU'
);
select results_eq(
  $$select (public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','customers','[{"code":"PARTY-1"}]'::jsonb)->0->>'code')$$,
  array['already_exists'::text], 'customer dry-run detects an existing party code'
);
select results_eq(
  $$select (public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','suppliers','[{"code":"PARTY-1"}]'::jsonb)->0->>'code')$$,
  array['already_exists'::text], 'supplier dry-run also protects the shared party code namespace'
);
select results_eq(
  $$select (public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','opening_stock','[{"itemSku":"MISSING","warehouseCode":"MAIN"}]'::jsonb)->0->>'code')$$,
  array['item_not_found'::text], 'opening-stock dry-run reports missing item'
);
select results_eq(
  $$select (public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','opening_stock','[{"itemSku":"CLEAN","warehouseCode":"MISSING"}]'::jsonb)->0->>'code')$$,
  array['warehouse_not_found'::text], 'opening-stock dry-run reports missing warehouse'
);
select results_eq(
  $$select (public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','opening_stock','[{"itemSku":"HISTORY","warehouseCode":"MAIN"}]'::jsonb)->0->>'code')$$,
  array['position_has_history'::text], 'opening-stock dry-run rejects positions with inventory history'
);
select results_eq(
  $$select jsonb_array_length(public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','opening_stock','[{"itemSku":"CLEAN","warehouseCode":"MAIN"}]'::jsonb))$$,
  array[0], 'opening-stock dry-run accepts an untouched inventory position'
);

set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','items','[{"sku":"NEW"}]'::jsonb)$$,
  '42501', null, 'another tenant cannot validate imports for this organization'
);

set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.validate_data_import_v1('93000000-0000-4000-8000-000000000010','unknown','[{"sku":"NEW"}]'::jsonb)$$,
  '22023', null, 'unsupported import type is rejected'
);
select results_eq($$select count(*) from public.data_import_batches$$, array[0::bigint], 'dry-run validation never creates import batch rows');

select * from finish();
rollback;
