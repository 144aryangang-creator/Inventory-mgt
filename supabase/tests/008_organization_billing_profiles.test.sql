begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_table('public', 'organization_billing_profiles', 'organization billing profiles table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.organization_billing_profiles'::regclass),
  'RLS is enabled on organization billing profiles'
);

insert into auth.users (id, email) values
  ('11110000-0000-4000-8000-000000000001', 'billing-owner@test.local'),
  ('11110000-0000-4000-8000-000000000002', 'billing-admin@test.local'),
  ('11110000-0000-4000-8000-000000000003', 'billing-staff@test.local'),
  ('11110000-0000-4000-8000-000000000004', 'billing-viewer@test.local'),
  ('11110000-0000-4000-8000-000000000005', 'billing-other@test.local');

insert into public.organizations (id, name, slug) values
  ('aaaa0000-0000-4000-8000-000000000001', 'Billing Tenant A', 'billing-tenant-a'),
  ('bbbb0000-0000-4000-8000-000000000002', 'Billing Tenant B', 'billing-tenant-b');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'owner'),
  ('aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000002', 'admin'),
  ('aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000003', 'staff'),
  ('aaaa0000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000004', 'viewer'),
  ('bbbb0000-0000-4000-8000-000000000002', '11110000-0000-4000-8000-000000000005', 'owner');

set local role authenticated;
set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into public.organization_billing_profiles (
      organization_id, code, legal_name, address_line_1, city, state_name, state_code,
      postal_code, created_by, updated_by
    ) values (
      'aaaa0000-0000-4000-8000-000000000001', 'DIRECT', 'Direct Seller', '1 Road',
      'Bhopal', 'Madhya Pradesh', '23', '462001',
      '11110000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert seller profiles directly'
);

select lives_ok(
  $$select public.create_organization_billing_profile(
      'aaaa0000-0000-4000-8000-000000000001',
      'bhopal-main', 'Bhopal Tractors Private Limited', '1 Main Road', 'Bhopal',
      'Madhya Pradesh', '23', '462001', 'IN', 'Bhopal Tractors',
      '23abcde1234f1z5', null, null, false, '{}'::jsonb
    )$$,
  'owner can create a seller profile'
);

select results_eq(
  $$select code, is_default from public.organization_billing_profiles$$,
  $$values ('BHOPAL-MAIN'::text, true)$$,
  'first active seller profile becomes default automatically'
);

select results_eq(
  $$select gstin, gstin_verification_status, gstin_verified_at is null
    from public.organization_billing_profiles where code = 'BHOPAL-MAIN'$$,
  $$values ('23ABCDE1234F1Z5'::text, 'unverified'::text, true)$$,
  'GSTIN is normalized and begins unverified'
);

set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000003';

select throws_ok(
  $$select public.create_organization_billing_profile(
      'aaaa0000-0000-4000-8000-000000000001',
      'STAFF', 'Staff Seller', '2 Road', 'Bhopal', 'Madhya Pradesh', '23', '462002'
    )$$,
  '42501',
  null,
  'staff cannot change seller legal profiles'
);

select results_eq(
  $$select count(*) from public.organization_billing_profiles where status = 'active'$$,
  array[1::bigint],
  'staff can read seller profiles through RLS'
);

set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.create_organization_billing_profile(
      'bbbb0000-0000-4000-8000-000000000002',
      'CROSS', 'Cross Tenant Seller', '3 Road', 'Indore', 'Madhya Pradesh', '23', '452001'
    )$$,
  '42501',
  null,
  'Tenant A owner cannot create seller profile in Tenant B'
);

set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000002';

select lives_ok(
  $$select public.create_organization_billing_profile(
      'aaaa0000-0000-4000-8000-000000000001',
      'indore-branch', 'Bhopal Tractors Private Limited', '10 Branch Road', 'Indore',
      'Madhya Pradesh', '23', '452001', 'IN', 'Bhopal Tractors Indore',
      '23ABCDE1234F2Z6', null, null, true, '{}'::jsonb
    )$$,
  'admin can create a second seller profile and make it default'
);

select results_eq(
  $$select count(*) from public.organization_billing_profiles
    where status = 'active' and is_default$$,
  array[1::bigint],
  'only one active seller profile is default'
);

select results_eq(
  $$select code from public.organization_billing_profiles where status = 'active' and is_default$$,
  array['INDORE-BRANCH'::text],
  'new default replaces the prior default'
);

reset role;
update public.organization_billing_profiles
set gstin_verification_status = 'verified', gstin_verified_at = now()
where organization_id = 'aaaa0000-0000-4000-8000-000000000001'
  and code = 'INDORE-BRANCH';

set local role authenticated;
set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000002';

select lives_ok(
  $$select public.update_organization_billing_profile(
      'aaaa0000-0000-4000-8000-000000000001',
      (select id from public.organization_billing_profiles where code = 'INDORE-BRANCH'),
      'indore-branch', 'Bhopal Tractors Private Limited', '10 Branch Road', 'Indore',
      'Madhya Pradesh', '23', '452001', 'IN', 'Bhopal Tractors Indore',
      '23ABCDE1234F3Z7', null, null, true, '{}'::jsonb
    )$$,
  'admin can update an active seller profile'
);

select results_eq(
  $$select gstin_verification_status, gstin_verified_at is null
    from public.organization_billing_profiles where code = 'INDORE-BRANCH'$$,
  $$values ('unverified'::text, true)$$,
  'changing GSTIN resets verification state'
);

select throws_ok(
  $$select public.update_organization_billing_profile(
      'aaaa0000-0000-4000-8000-000000000001',
      (select id from public.organization_billing_profiles where code = 'INDORE-BRANCH'),
      'indore-branch', 'Bhopal Tractors Private Limited', '10 Branch Road', 'Indore',
      'Madhya Pradesh', '27', '452001', 'IN', 'Bhopal Tractors Indore',
      '23ABCDE1234F3Z7', null, null, true, '{}'::jsonb
    )$$,
  '23514',
  null,
  'GSTIN state code must match the seller profile state code'
);

reset role;
select results_eq(
  $$select (app_private.organization_billing_profile_snapshot(
      'aaaa0000-0000-4000-8000-000000000001',
      (select id from public.organization_billing_profiles where code = 'INDORE-BRANCH')
    ) ->> 'legal_name'),
    (app_private.organization_billing_profile_snapshot(
      'aaaa0000-0000-4000-8000-000000000001',
      (select id from public.organization_billing_profiles where code = 'INDORE-BRANCH')
    ) ->> 'state_code')$$,
  $$values ('Bhopal Tractors Private Limited'::text, '23'::text)$$,
  'internal snapshot helper produces legal seller identity'
);

set local role authenticated;
set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000004';

select throws_ok(
  $$select app_private.organization_billing_profile_snapshot(
      'aaaa0000-0000-4000-8000-000000000001',
      (select id from public.organization_billing_profiles where code = 'INDORE-BRANCH')
    )$$,
  '42501',
  null,
  'internal seller snapshot helper is not client executable'
);

set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000002';

select lives_ok(
  $$select public.archive_organization_billing_profile(
      'aaaa0000-0000-4000-8000-000000000001',
      (select id from public.organization_billing_profiles where code = 'INDORE-BRANCH')
    )$$,
  'admin can archive a seller profile'
);

select results_eq(
  $$select status::text, is_default from public.organization_billing_profiles where code = 'INDORE-BRANCH'$$,
  $$values ('archived'::text, false)$$,
  'archived seller profile cannot remain default'
);

select throws_ok(
  $$delete from public.organization_billing_profiles where code = 'BHOPAL-MAIN'$$,
  '42501',
  null,
  'authenticated clients cannot destructively delete seller profiles'
);

set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000005';
select public.create_organization_billing_profile(
  'bbbb0000-0000-4000-8000-000000000002',
  'OTHER', 'Other Legal Seller', '1 Other Road', 'Mumbai', 'Maharashtra', '27', '400001'
);

set local request.jwt.claim.sub = '11110000-0000-4000-8000-000000000001';
select results_eq(
  $$select count(*) from public.organization_billing_profiles
    where organization_id = 'bbbb0000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Tenant A cannot read Tenant B seller profiles'
);

select ok(
  (select count(*) from public.audit_events
   where organization_id = 'aaaa0000-0000-4000-8000-000000000001'
     and entity_type = 'organization_billing_profile') >= 4,
  'seller profile lifecycle changes are audited'
);

reset role;
select * from finish();
rollback;
