begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

select has_table('public', 'parties', 'parties table exists');
select has_table('public', 'party_roles', 'party roles table exists');
select has_table('public', 'party_addresses', 'party addresses table exists');
select has_table('public', 'party_tax_registrations', 'party tax registrations table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.parties'::regclass),
  'RLS is enabled on parties'
);

insert into auth.users (id, email) values
  ('55555555-5555-4555-8555-555555555555', 'party-a@test.local'),
  ('66666666-6666-4666-8666-666666666666', 'party-b@test.local'),
  ('77777777-7777-4777-8777-777777777777', 'party-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Party Tenant A', 'party-tenant-a'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Party Tenant B', 'party-tenant-b');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '55555555-5555-4555-8555-555555555555', 'owner'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '66666666-6666-4666-8666-666666666666', 'owner'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '77777777-7777-4777-8777-777777777777', 'viewer');

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

select throws_ok(
  $$insert into public.parties (
      organization_id, code, legal_name, display_name, created_by, updated_by
    ) values (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'DIRECT', 'Direct Write', 'Direct Write',
      '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert party rows directly'
);

select lives_ok(
  $$select public.create_party(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cust-001',
      'Acme Private Limited',
      'Acme',
      array['customer']::public.party_role[],
      'SALES@EXAMPLE.COM',
      '+91 99999 99999',
      '{"segment":"retail"}'::jsonb
    )$$,
  'authorized member can create a customer party'
);

select results_eq(
  $$select code, email from public.parties$$,
  $$values ('CUST-001'::text, 'sales@example.com'::text)$$,
  'party code and email are normalized'
);

select results_eq(
  $$select role::text from public.party_roles$$,
  array['customer'::text],
  'customer role is recorded'
);

select throws_ok(
  $$select public.create_party(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'CUST-001',
      'Duplicate',
      'Duplicate',
      array['customer']::public.party_role[],
      null,
      null,
      '{}'::jsonb
    )$$,
  '23505',
  null,
  'party code is unique within an organization'
);

select lives_ok(
  $$select public.update_party(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      (select id from public.parties where code = 'CUST-001'),
      'CUST-001',
      'Acme Private Limited',
      'Acme Updated',
      array['customer','supplier']::public.party_role[],
      'accounts@example.com',
      '+91 99999 99999',
      '{"segment":"enterprise"}'::jsonb
    )$$,
  'authorized member can update a party and its roles'
);

select results_eq(
  $$select display_name from public.parties where code = 'CUST-001'$$,
  array['Acme Updated'::text],
  'party update is persisted'
);

select results_eq(
  $$select count(*) from public.party_roles where party_id = (select id from public.parties where code = 'CUST-001')$$,
  array[2::bigint],
  'party can be both customer and supplier'
);

select throws_ok(
  $$select public.create_party(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'HACK-001',
      'Cross Tenant',
      'Cross Tenant',
      array['customer']::public.party_role[],
      null,
      null,
      '{}'::jsonb
    )$$,
  '42501',
  null,
  'Tenant A cannot create a party in Tenant B'
);

set local request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';

select throws_ok(
  $$select public.create_party(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'VIEW-001',
      'Viewer Write',
      'Viewer Write',
      array['customer']::public.party_role[],
      null,
      null,
      '{}'::jsonb
    )$$,
  '42501',
  null,
  'viewer cannot create parties'
);

set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

select lives_ok(
  $$select public.archive_party(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      (select id from public.parties where code = 'CUST-001')
    )$$,
  'authorized member can archive a party'
);

select results_eq(
  $$select status::text from public.parties where code = 'CUST-001'$$,
  array['archived'::text],
  'party is archived instead of deleted'
);

select throws_ok(
  $$select public.update_party(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      (select id from public.parties where code = 'CUST-001'),
      'CUST-001',
      'Acme Private Limited',
      'Should Fail',
      array['customer']::public.party_role[],
      null,
      null,
      '{}'::jsonb
    )$$,
  'P0002',
  null,
  'archived party cannot be edited by active-party update RPC'
);

reset role;

-- Seed Tenant B through its authenticated owner so isolation can be tested.
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
select public.create_party(
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'SUP-001',
  'Tenant B Supplier',
  'Tenant B Supplier',
  array['supplier']::public.party_role[],
  null,
  null,
  '{}'::jsonb
);

set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

select results_eq(
  $$select count(*) from public.parties$$,
  array[1::bigint],
  'Tenant A sees only Tenant A parties even when archived'
);

select results_eq(
  $$select count(*) from public.party_roles$$,
  array[2::bigint],
  'Tenant A sees only roles belonging to its own parties'
);

select results_eq(
  $$select count(*) from public.audit_events where entity_type = 'party'$$,
  array[3::bigint],
  'owner sees party create update and archive audit events for own tenant'
);

select throws_ok(
  $$delete from public.parties where code = 'CUST-001'$$,
  '42501',
  null,
  'authenticated clients cannot destructively delete parties'
);

reset role;
select * from finish();
rollback;
