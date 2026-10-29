begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email) values
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'cascade-owner@test.local');

insert into public.organizations (id, name, slug) values
  ('cccccccc-1111-4111-8111-cccccccccccc', 'Cascade Tenant', 'cascade-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('cccccccc-1111-4111-8111-cccccccccccc', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'owner');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values (
  'dddddddd-1111-4111-8111-dddddddddddd',
  'cccccccc-1111-4111-8111-cccccccccccc',
  'CUST-ARCHIVE', 'Archive Customer', 'Archive Customer',
  'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
);

insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, country_code,
  is_default_billing, is_default_shipping, created_by, updated_by
) values (
  'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
  'cccccccc-1111-4111-8111-cccccccccccc',
  'dddddddd-1111-4111-8111-dddddddddddd',
  'Main', '1 Archive Road', 'Bhopal', 'IN', true, true,
  'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
);

insert into public.party_tax_registrations (
  id, organization_id, party_id, scheme, registration_number, registered_name,
  country_code, state_code, is_default, created_by, updated_by
) values (
  'ffffffff-1111-4111-8111-ffffffffffff',
  'cccccccc-1111-4111-8111-cccccccccccc',
  'dddddddd-1111-4111-8111-dddddddddddd',
  'GSTIN', '23ABCDE1234F1Z5', 'Archive Customer',
  'IN', '23', true,
  'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

select lives_ok(
  $$select public.archive_party(
      'cccccccc-1111-4111-8111-cccccccccccc',
      'dddddddd-1111-4111-8111-dddddddddddd'
    )$$,
  'archiving a party succeeds with active profile records'
);

select results_eq(
  $$select status::text, is_default_billing, is_default_shipping
    from public.party_addresses
    where id = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee'$$,
  $$values ('archived'::text, false, false)$$,
  'party archive also archives address and clears defaults'
);

select results_eq(
  $$select status::text, is_default
    from public.party_tax_registrations
    where id = 'ffffffff-1111-4111-8111-ffffffffffff'$$,
  $$values ('archived'::text, false)$$,
  'party archive also archives tax registration and clears default'
);

select results_eq(
  $$select
      (metadata ->> 'archived_addresses')::integer,
      (metadata ->> 'archived_tax_registrations')::integer
    from public.audit_events
    where action = 'party.archived'
      and entity_id = 'dddddddd-1111-4111-8111-dddddddddddd'$$,
  $$values (1, 1)$$,
  'party archive audit records child archival counts'
);

reset role;
select * from finish();
rollback;
