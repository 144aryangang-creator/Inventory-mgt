begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_column('public', 'party_addresses', 'status', 'party addresses have lifecycle status');
select has_column('public', 'party_tax_registrations', 'status', 'party tax registrations have lifecycle status');

insert into auth.users (id, email) values
  ('88888888-8888-4888-8888-888888888888', 'profile-owner@test.local'),
  ('99999999-9999-4999-8999-999999999999', 'profile-other@test.local'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'profile-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('11111111-aaaa-4aaa-8aaa-111111111111', 'Profile Tenant A', 'profile-tenant-a'),
  ('22222222-bbbb-4bbb-8bbb-222222222222', 'Profile Tenant B', 'profile-tenant-b');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('11111111-aaaa-4aaa-8aaa-111111111111', '88888888-8888-4888-8888-888888888888', 'owner'),
  ('11111111-aaaa-4aaa-8aaa-111111111111', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'viewer'),
  ('22222222-bbbb-4bbb-8bbb-222222222222', '99999999-9999-4999-8999-999999999999', 'owner');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values
  (
    '33333333-aaaa-4aaa-8aaa-333333333333',
    '11111111-aaaa-4aaa-8aaa-111111111111',
    'CUST-100', 'Profile Customer', 'Profile Customer',
    '88888888-8888-4888-8888-888888888888', '88888888-8888-4888-8888-888888888888'
  ),
  (
    '44444444-bbbb-4bbb-8bbb-444444444444',
    '22222222-bbbb-4bbb-8bbb-222222222222',
    'CUST-200', 'Other Customer', 'Other Customer',
    '99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999999'
  );

set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

select throws_ok(
  $$insert into public.party_addresses (
      organization_id, party_id, label, address_line_1, city, country_code
    ) values (
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'Direct', 'Unsafe write', 'Bhopal', 'IN'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert addresses directly'
);

select lives_ok(
  $$select public.create_party_address(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'Billing', '1 Main Road', 'Bhopal', 'IN',
      'Profile Customer', null, null, 'Madhya Pradesh', '23', '462001',
      true, false, true, '{}'::jsonb
    )$$,
  'owner can create a default billing address'
);

select results_eq(
  $$select count(*) from public.party_addresses where status = 'active' and is_default_billing$$,
  array[1::bigint],
  'one active default billing address exists'
);

select lives_ok(
  $$select public.create_party_address(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'New Billing', '2 New Road', 'Bhopal', 'IN',
      null, null, null, 'Madhya Pradesh', '23', '462002',
      true, true, false, '{}'::jsonb
    )$$,
  'creating a new default address succeeds atomically'
);

select results_eq(
  $$select count(*) from public.party_addresses where status = 'active' and is_default_billing$$,
  array[1::bigint],
  'new default replaces the prior billing default'
);

select lives_ok(
  $$select public.archive_party_address(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      (select id from public.party_addresses where label = 'New Billing')
    )$$,
  'address can be archived instead of deleted'
);

select results_eq(
  $$select status::text, is_default_billing, is_default_shipping
    from public.party_addresses where label = 'New Billing'$$,
  $$values ('archived'::text, false, false)$$,
  'archived address cannot remain a default'
);

select lives_ok(
  $$select public.create_party_tax_registration(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'GSTIN', '23ABCDE1234F1Z5', 'IN', 'Profile Customer', '23', true
    )$$,
  'structurally valid GSTIN can be stored'
);

select results_eq(
  $$select verification_status, verified_at is null
    from public.party_tax_registrations where registration_number = '23ABCDE1234F1Z5'$$,
  $$values ('unverified'::text, true)$$,
  'new tax registration is unverified by default'
);

select throws_ok(
  $$select public.create_party_tax_registration(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'GSTIN', '23BAD', 'IN', 'Bad GST', '23', false
    )$$,
  '23514',
  null,
  'malformed GSTIN is rejected structurally'
);

select throws_ok(
  $$insert into public.party_tax_registrations (
      organization_id, party_id, scheme, registration_number, country_code, state_code
    ) values (
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'GSTIN', '23ABCDE1234F2Z6', 'IN', '23'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert tax registrations directly'
);

select lives_ok(
  $$select public.create_party_tax_registration(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'GSTIN', '23ABCDE1234F2Z6', 'IN', 'Profile Customer Branch', '23', true
    )$$,
  'second GSTIN can become the default for the scheme'
);

select results_eq(
  $$select count(*) from public.party_tax_registrations
    where status = 'active' and scheme = 'GSTIN' and is_default$$,
  array[1::bigint],
  'only one active default registration exists per scheme'
);

set local request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

select throws_ok(
  $$select public.create_party_address(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      'Viewer', '3 Road', 'Bhopal', 'IN',
      null, null, null, null, null, null,
      false, false, false, '{}'::jsonb
    )$$,
  '42501',
  null,
  'viewer cannot create party addresses'
);

set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

select throws_ok(
  $$select public.create_party_address(
      '22222222-bbbb-4bbb-8bbb-222222222222',
      '44444444-bbbb-4bbb-8bbb-444444444444',
      'Cross Tenant', '4 Road', 'Indore', 'IN',
      null, null, null, null, null, null,
      false, false, false, '{}'::jsonb
    )$$,
  '42501',
  null,
  'Tenant A owner cannot create an address in Tenant B'
);

select results_eq(
  $$select count(*) from public.audit_events
    where entity_type in ('party_address', 'party_tax_registration')$$,
  array[5::bigint],
  'profile create/archive actions are audited'
);

select lives_ok(
  $$select public.archive_party_tax_registration(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      (select id from public.party_tax_registrations where registration_number = '23ABCDE1234F2Z6')
    )$$,
  'tax registration can be archived'
);

select results_eq(
  $$select status::text, is_default
    from public.party_tax_registrations where registration_number = '23ABCDE1234F2Z6'$$,
  $$values ('archived'::text, false)$$,
  'archived tax registration cannot remain default'
);

select throws_ok(
  $$select public.update_party_tax_registration(
      '11111111-aaaa-4aaa-8aaa-111111111111',
      '33333333-aaaa-4aaa-8aaa-333333333333',
      (select id from public.party_tax_registrations where registration_number = '23ABCDE1234F2Z6'),
      'GSTIN', '23ABCDE1234F2Z6', 'IN', 'Should Fail', '23', false
    )$$,
  'P0002',
  null,
  'archived tax registration cannot be edited'
);

select results_eq(
  $$select count(*) from public.party_addresses where organization_id = '22222222-bbbb-4bbb-8bbb-222222222222'$$,
  array[0::bigint],
  'Tenant A cannot see Tenant B address data'
);

select results_eq(
  $$select count(*) from public.party_tax_registrations where organization_id = '22222222-bbbb-4bbb-8bbb-222222222222'$$,
  array[0::bigint],
  'Tenant A cannot see Tenant B tax registration data'
);

reset role;
select * from finish();
rollback;
