begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

select has_table('public', 'financial_documents', 'financial documents table exists');
select has_table('public', 'financial_document_lines', 'financial document lines table exists');
select has_table('public', 'financial_document_line_taxes', 'financial document line taxes table exists');
select has_table('public', 'financial_document_sequences', 'financial document sequences table exists');
select has_column('public', 'organizations', 'financial_year_start_month', 'organization has configurable financial year start month');

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
    'CUST-INV-A', 'Invoice Customer A', 'Invoice Customer A',
    '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
  ),
  (
    'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb',
    'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
    'CUST-INV-B', 'Invoice Customer B', 'Invoice Customer B',
    '20202020-2020-4020-8020-202020202020', '20202020-2020-4020-8020-202020202020'
  );

set local role authenticated;
set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';

select throws_ok(
  $$insert into public.financial_documents (
      organization_id, document_type, document_date, series_code, supply_type,
      supplier_snapshot, bill_to_snapshot, created_by, updated_by
    ) values (
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa', 'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      '{"legal_name":"Seller A"}'::jsonb, '{"legal_name":"Buyer A"}'::jsonb,
      '10101010-1010-4010-8010-101010101010', '10101010-1010-4010-8010-101010101010'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert financial documents directly'
);

select lives_ok(
  $$select public.create_financial_document_draft(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      '{"legal_name":"Seller A","gstin":"23ABCDE1234F1Z5"}'::jsonb,
      '{"legal_name":"Invoice Customer A","state_code":"23"}'::jsonb,
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa', null, 'INR', '23', '23', false,
      '{"address":"Bhopal"}'::jsonb, 'first invoice'
    )$$,
  'owner can create a tax invoice draft'
);

select results_eq(
  $$select status::text, document_number is null
    from public.financial_documents where notes = 'first invoice'$$,
  $$values ('draft'::text, true)$$,
  'new financial document starts as an unnumbered draft'
);

set local request.jwt.claim.sub = '30303030-3030-4030-8030-303030303030';

select throws_ok(
  $$select public.create_financial_document_draft(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      '{"legal_name":"Seller A"}'::jsonb, '{"legal_name":"Buyer"}'::jsonb
    )$$,
  '42501',
  null,
  'viewer cannot create financial documents'
);

set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';

select throws_ok(
  $$select public.create_financial_document_draft(
      'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
      'tax_invoice', '2026-10-30', 'INV', 'intra_state',
      '{"legal_name":"Seller B"}'::jsonb, '{"legal_name":"Buyer B"}'::jsonb
    )$$,
  '42501',
  null,
  'Tenant A cannot create a document in Tenant B'
);

select lives_ok(
  $$select public.upsert_financial_document_line(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      1, 'Tractor part', 1, 'EA', 1000, 1000,
      null, '{"sku":"PART-1","name":"Tractor part"}'::jsonb, '8708', 0,
      '[{"component":"CGST","rate":9,"amount":90},{"component":"SGST","rate":9,"amount":90}]'::jsonb
    )$$,
  'owner can add a draft line with CGST and SGST'
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

select public.create_financial_document_draft(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  'tax_invoice', '2026-10-30', 'INV', 'inter_state',
  '{"legal_name":"Seller A"}'::jsonb, '{"legal_name":"Buyer 2"}'::jsonb,
  null, null, 'INR', '23', '27', false, '{}'::jsonb, 'second invoice'
);
select public.upsert_financial_document_line(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  (select id from public.financial_documents where notes = 'second invoice'),
  1, 'Interstate goods', 2, 'EA', 500, 1000,
  null, '{}'::jsonb, '8708', 0,
  '[{"component":"IGST","rate":18,"amount":180}]'::jsonb
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

select public.create_financial_document_draft(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  'tax_invoice', '2026-10-30', 'BAD', 'inter_state',
  '{"legal_name":"Seller A"}'::jsonb, '{"legal_name":"Bad Tax Buyer"}'::jsonb,
  null, null, 'INR', '23', '27', false, '{}'::jsonb, 'bad tax invoice'
);
select public.upsert_financial_document_line(
  'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
  (select id from public.financial_documents where notes = 'bad tax invoice'),
  1, 'Bad interstate line', 1, 'EA', 100, 100,
  null, '{}'::jsonb, '8708', 0,
  '[{"component":"CGST","rate":9,"amount":9}]'::jsonb
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
  $$select public.create_financial_document_draft(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'credit_note', '2026-10-30', 'CN', 'intra_state',
      '{"legal_name":"Seller A"}'::jsonb, '{"legal_name":"Buyer A"}'::jsonb,
      'aaaaaaaa-3030-4030-8030-aaaaaaaaaaaa',
      (select id from public.financial_documents where notes = 'first invoice'),
      'INR', '23', '23', false, '{}'::jsonb, 'credit note linked'
    )$$,
  'credit note can link to an issued tax invoice'
);

select throws_ok(
  $$select public.create_financial_document_draft(
      'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa',
      'credit_note', '2026-10-30', 'CN', 'intra_state',
      '{"legal_name":"Seller A"}'::jsonb, '{"legal_name":"Buyer A"}'::jsonb
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
select public.create_financial_document_draft(
  'bbbbbbbb-2020-4020-8020-bbbbbbbbbbbb',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '{"legal_name":"Seller B"}'::jsonb, '{"legal_name":"Buyer B"}'::jsonb,
  'bbbbbbbb-3030-4030-8030-bbbbbbbbbbbb', null, 'INR', '23', '23', false,
  '{}'::jsonb, 'tenant b invoice'
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
     and entity_type = 'financial_document') >= 8,
  'financial document lifecycle mutations create audit events'
);

select results_eq(
  $$select next_number from public.financial_document_sequences
    where organization_id = 'aaaaaaaa-1010-4010-8010-aaaaaaaaaaaa'
      and document_type = 'tax_invoice'
      and financial_year_start_year = 2026
      and series_code = 'INV'$$,
  array[3::bigint],
  'failed issue does not consume the valid INV series sequence'
);

reset role;
select * from finish();
rollback;
