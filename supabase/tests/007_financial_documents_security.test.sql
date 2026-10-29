begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

select has_table('public', 'financial_documents', 'financial documents table exists');
select has_table('public', 'financial_document_lines', 'financial document lines table exists');
select has_table('public', 'financial_document_line_taxes', 'financial document line taxes table exists');
select has_table('public', 'financial_document_sequences', 'financial document sequences table exists');
select has_column('public', 'organizations', 'financial_year_start_month', 'organization has configurable financial year start month');
select has_column('public', 'financial_documents', 'supplier_profile_id', 'financial documents bind to a seller profile');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.financial_documents'::regclass),
  'RLS is enabled on financial documents'
);

insert into auth.users (id, email) values
  ('10101010-1010-4010-8010-101010101010', 'invoice-owner-a@test.local'),
  ('20202020-2020-4020-8020-202020202020', 'invoice-owner-b@test.local'),
  ('30303030-3030-4030-8030-303030303030', 'invoice-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa', 'Invoice Tenant A', 'invoice-tenant-a'),
  ('bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb', 'Invoice Tenant B', 'invoice-tenant-b');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa', '10101010-1010-4010-8010-101010101010', 'owner'),
  ('aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa', '30303030-3030-4030-8030-303030303030', 'viewer'),
  ('bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb', '20202020-2020-4020-8020-202020202020', 'owner');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values
  (
    'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
    'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
    'CUST-INV-A', 'Invoice Customer A Private Limited', 'Invoice Customer A',
    '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
  ),
  (
    'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb',
    'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
    'CUST-INV-B', 'Invoice Customer B Private Limited', 'Invoice Customer B',
    '20202020-2020-4020-8020-202020202020', '20202020-2020-4020-8020-202020202020'
  );

insert into public.party_roles (organization_id, party_id, role) values
  ('aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa', 'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa', 'customer'),
  ('bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb', 'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb', 'customer');

insert into public.party_addresses (
  id, organization_id, party_id, label, recipient_name, address_line_1, city,
  state_name, state_code, postal_code, country_code,
  is_default_billing, is_default_shipping, is_registered_address, created_by, updated_by
) values
  (
    'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa',
    'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
    'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
    'Billing', 'Invoice Customer A Private Limited', '10 Buyer Road', 'Bhopal',
    'Madhya Pradesh', '23', '462010', 'IN', true, false, true,
    '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
  ),
  (
    'aaaaaaaa-5051-4051-8051-aaaaaaaaaaaa',
    'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
    'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
    'Shipping', 'Invoice Customer A Warehouse', '20 Delivery Road', 'Indore',
    'Madhya Pradesh', '23', '452010', 'IN', false, true, false,
    '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
  ),
  (
    'bbbbbbbb-5050-4050-8050-bbbbbbbbbbbb',
    'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
    'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb',
    'Billing', 'Invoice Customer B Private Limited', '30 Buyer Road', 'Bhopal',
    'Madhya Pradesh', '23', '462020', 'IN', true, true, true,
    '20202020-2020-4020-8020-202020202020', '20202020-2020-4020-8020-202020202020'
  );

insert into public.party_tax_registrations (
  id, organization_id, party_id, scheme, registration_number, registered_name,
  country_code, state_code, is_default, verification_status, created_by, updated_by
) values (
  'aaaaaaaa-6060-4060-8060-aaaaaaaaaaaa',
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
  'GSTIN', '23AAAAA1234A1Z5', 'Invoice Customer A Private Limited',
  'IN', '23', true, 'unverified',
  '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
);

insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, trade_name, gstin,
  address_line_1, city, state_name, state_code, postal_code,
  is_default, created_by, updated_by
) values
  (
    'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
    'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
    'SELL-A', 'Seller A Private Limited', 'Seller A', '23ABCDE1234F1Z5',
    '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462001',
    true, '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
  ),
  (
    'bbbbbbbb-4040-4040-8040-bbbbbbbbbbbb',
    'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
    'SELL-B', 'Seller B Private Limited', 'Seller B', '23ABCDE1234F2Z6',
    '2 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462002',
    true, '20202020-2020-4020-8020-202020202020', '20202020-2020-4020-8020-202020202020'
  );

set local role authenticated;
set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';

select throws_ok(
  $$insert into public.financial_documents (
      organization_id, document_type, document_date, series_code, supply_type,
      supplier_snapshot, bill_to_snapshot, created_by, updated_by
    ) values (
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa', 'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      '{"legal_name":"Forged Seller"}'::jsonb, '{"legal_name":"Forged Buyer"}'::jsonb,
      '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert financial documents directly'
);

select throws_ok(
  $$select public.create_financial_document_draft(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'tax_invoice', '2026-10-30', 'FORGE', 'intra_state',
      '{"legal_name":"Forged Seller"}'::jsonb,
      '{"legal_name":"Forged Buyer"}'::jsonb
    )$$,
  '42501',
  null,
  'authenticated clients cannot call legacy arbitrary seller and buyer snapshot RPC'
);

select throws_ok(
  $$select public.create_financial_document_draft_from_profile(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
      'tax_invoice', '2026-10-30', 'FORGE2', 'intra_state',
      '{"legal_name":"Forged Buyer"}'::jsonb
    )$$,
  '42501',
  null,
  'authenticated clients cannot call seller-only RPC with free-form buyer snapshot'
);

select lives_ok(
  $$select public.create_financial_document_draft_from_profiles(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
      'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
      'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa',
      'aaaaaaaa-5051-4051-8051-aaaaaaaaaaaa',
      'aaaaaaaa-6060-4060-8060-aaaaaaaaaaaa',
      null, 'INR', '23', false, 'first invoice'
    )$$,
  'owner can create a tax invoice draft from seller and buyer profiles'
);

select results_eq(
  $$select status::text, document_number is null
    from public.financial_documents where notes = 'first invoice'$$,
  $$values ('draft'::text, true)$$,
  'new financial document starts as an unnumbered draft'
);

select results_eq(
  $$select supplier_profile_id,
           supplier_snapshot ->> 'legal_name',
           supplier_snapshot ->> 'gstin',
           supplier_state_code
    from public.financial_documents where notes = 'first invoice'$$,
  $$values (
      'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa'::uuid,
      'Seller A Private Limited'::text,
      '23ABCDE1234F1Z5'::text,
      '23'::text
    )$$,
  'supplier identity and state are derived from the selected seller profile'
);

select results_eq(
  $$select recipient_party_id,
           billing_address_id,
           shipping_address_id,
           recipient_tax_registration_id,
           bill_to_snapshot ->> 'legal_name',
           bill_to_snapshot ->> 'tax_registration_number',
           ship_to_snapshot ->> 'address_line_1'
    from public.financial_documents where notes = 'first invoice'$$,
  $$values (
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa'::uuid,
      'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa'::uuid,
      'aaaaaaaa-5051-4051-8051-aaaaaaaaaaaa'::uuid,
      'aaaaaaaa-6060-4060-8060-aaaaaaaaaaaa'::uuid,
      'Invoice Customer A Private Limited'::text,
      '23AAAAA1234A1Z5'::text,
      '20 Delivery Road'::text
    )$$,
  'buyer legal, address, shipping and tax identity are derived from selected party profiles'
);

select throws_ok(
  $$select public.upsert_financial_document_line(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      1, 'Forged calculation', 1, 'EA', 1000, 1,
      null, '{}'::jsonb, '8708', 0,
      '[{"component":"CGST","rate":9,"amount":0.01}]'::jsonb
    )$$,
  '42501',
  null,
  'authenticated clients cannot call legacy line RPC with client-calculated taxable and tax amounts'
);

select lives_ok(
  $$select public.upsert_financial_document_line_calculated(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      1, 'Tractor part', 1, 'EA', 1000,
      null, '{"sku":"PART-1","name":"Tractor part"}'::jsonb, '8708', 0,
      '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
    )$$,
  'owner can add a draft line using server-side calculation'
);

select results_eq(
  $$select count(*) from public.financial_document_line_taxes t
    join public.financial_document_lines l on l.id = t.line_id and l.organization_id = t.organization_id
    join public.financial_documents d on d.id = l.document_id and d.organization_id = l.organization_id
    where d.notes = 'first invoice'$$,
  array[2::bigint],
  'line stores separate GST tax components'
);

select results_eq(
  $$select l.taxable_value, sum(t.amount)
    from public.financial_document_lines l
    join public.financial_document_line_taxes t
      on t.line_id = l.id and t.organization_id = l.organization_id
    join public.financial_documents d
      on d.id = l.document_id and d.organization_id = l.organization_id
    where d.notes = 'first invoice'
    group by l.taxable_value$$,
  $$values (1000::numeric, 180::numeric)$$,
  'PostgreSQL derives taxable value and tax amounts from quantity price discount and rates'
);

set local request.jwt.claim.sub = '30303030-3030-4030-8030-303030303030';

select throws_ok(
  $$select public.create_financial_document_draft_from_profiles(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
      'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
      'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa'
    )$$,
  '42501',
  null,
  'viewer cannot create financial documents'
);

set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';

select throws_ok(
  $$select public.create_financial_document_draft_from_profiles(
      'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
      'bbbbbbbb-4040-4040-8040-bbbbbbbbbbbb',
      'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb',
      'bbbbbbbb-5050-4050-8050-bbbbbbbbbbbb'
    )$$,
  '42501',
  null,
  'Tenant A cannot create a document in Tenant B'
);

select results_eq(
  $$select public.issue_financial_document(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      'issue-first'
    )$$,
  array['INV/1'::text],
  'issuing allocates the first series number'
);

select results_eq(
  $$select status::text, financial_year_start_year, document_number
    from public.financial_documents where notes = 'first invoice'$$,
  $$values ('issued'::text, 2026::smallint, 'INV/1'::text)$$,
  'issued document records financial year and number'
);

select results_eq(
  $$select subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, grand_total
    from public.financial_documents where notes = 'first invoice'$$,
  $$values (1000::numeric, 0::numeric, 1000::numeric, 90::numeric, 90::numeric, 0::numeric, 1180::numeric)$$,
  'issue computes immutable invoice totals from lines and taxes'
);

select results_eq(
  $$select public.issue_financial_document(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      'issue-first'
    )$$,
  array['INV/1'::text],
  'issuing is idempotent with the same request key'
);

select public.create_financial_document_draft_from_profiles(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
  'tax_invoice', '2026-10-30', 'INV', 'inter_state',
  'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
  'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa',
  null,
  'aaaaaaaa-6060-4060-8060-aaaaaaaaaaaa',
  null, 'INR', '27', false, 'second invoice'
);
select public.upsert_financial_document_line_calculated(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  (select id from public.financial_documents where notes = 'second invoice'),
  1, 'Interstate goods', 2, 'EA', 500,
  null, '{}'::jsonb, '8708', 0,
  '[{"component":"IGST","rate":18}]'::jsonb
);

select results_eq(
  $$select public.issue_financial_document(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'second invoice'),
      'issue-second'
    )$$,
  array['INV/2'::text],
  'series sequence increments under the same financial year'
);

select public.create_financial_document_draft_from_profiles(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
  'tax_invoice', '2026-10-30', 'BAD', 'inter_state',
  'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
  'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa',
  null,
  'aaaaaaaa-6060-4060-8060-aaaaaaaaaaaa',
  null, 'INR', '27', false, 'bad tax invoice'
);
select public.upsert_financial_document_line_calculated(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  (select id from public.financial_documents where notes = 'bad tax invoice'),
  1, 'Bad interstate line', 1, 'EA', 100,
  null, '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9}]'::jsonb
);

select throws_ok(
  $$select public.issue_financial_document(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'bad tax invoice'),
      'issue-bad-tax'
    )$$,
  '23514',
  null,
  'inter-state document cannot be issued with CGST'
);

select lives_ok(
  $$select public.create_financial_document_draft_from_profiles(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
      'credit_note', '2026-10-30', 'CN', 'intra_state',
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
      'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa',
      null,
      'aaaaaaaa-6060-4060-8060-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      'INR', '23', false, 'credit note linked'
    )$$,
  'credit note can link to an issued tax invoice'
);

select throws_ok(
  $$select public.create_financial_document_draft_from_profiles(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'aaaaaaaa-4040-4040-8040-aaaaaaaaaaaa',
      'credit_note', '2026-10-30', 'CN', 'intra_state',
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
      'aaaaaaaa-5050-4050-8050-aaaaaaaaaaaa'
    )$$,
  '23503',
  null,
  'credit note cannot be created without an issued invoice reference'
);

reset role;

select throws_ok(
  $$update public.financial_document_lines
    set description = 'tampered'
    where document_id = (select id from public.financial_documents where notes = 'first invoice')$$,
  '55000',
  null,
  'issued document lines are immutable even for privileged database writes'
);

select throws_ok(
  $$delete from public.financial_document_lines
    where document_id = (select id from public.financial_documents where notes = 'first invoice')$$,
  '55000',
  null,
  'issued document lines cannot be deleted'
);

select throws_ok(
  $$update public.financial_documents
    set document_number = 'INV/999'
    where notes = 'first invoice'$$,
  '55000',
  null,
  'issued financial document header cannot be edited'
);

set local role authenticated;
set local request.jwt.claim.sub = '30303030-3030-4030-8030-303030303030';

select throws_ok(
  $$select public.cancel_financial_document(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      'viewer attempt'
    )$$,
  '42501',
  null,
  'viewer cannot cancel an issued financial document'
);

set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';

select lives_ok(
  $$select public.cancel_financial_document(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      'customer order cancelled'
    )$$,
  'authorized staff can cancel an issued document without deleting it'
);

select results_eq(
  $$select status::text, cancellation_reason
    from public.financial_documents where notes = 'first invoice'$$,
  $$values ('cancelled'::text, 'customer order cancelled'::text)$$,
  'cancelled document retains number and records reason'
);

set local request.jwt.claim.sub = '20202020-2020-4020-8020-202020202020';
select public.create_financial_document_draft_from_profiles(
  'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
  'bbbbbbbb-4040-4040-8040-bbbbbbbbbbbb',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb',
  'bbbbbbbb-5050-4050-8050-bbbbbbbbbbbb',
  null, null, null, 'INR', '23', false, 'tenant b invoice'
);

set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';

select results_eq(
  $$select count(*) from public.financial_documents
    where organization_id = 'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb'$$,
  array[0::bigint],
  'Tenant A cannot read Tenant B financial documents'
);

select ok(
  (select count(*) from public.audit_events
   where organization_id = 'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa'
     and entity_type = 'financial_document') >= 10,
  'financial document lifecycle mutations create audit events'
);

reset role;

select results_eq(
  $$select next_number from public.financial_document_sequences
    where organization_id = 'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa'
      and document_type = 'tax_invoice'
      and financial_year_start_year = 2026
      and series_code = 'INV'$$,
  array[3::bigint],
  'failed issue does not consume the valid INV series sequence'
);

select * from finish();
rollback;
