begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id, email) values
  ('91919191-9191-4191-8191-919191919191', 'atomic-payment-owner@test.local');

insert into public.organizations (id, name, slug) values
  ('92929292-9292-4292-8292-929292929292', 'Atomic Payment Tenant', 'atomic-payment-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('92929292-9292-4292-8292-929292929292', '91919191-9191-4191-8191-919191919191', 'owner');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values (
  '93939393-9393-4393-8393-939393939393',
  '92929292-9292-4292-8292-929292929292',
  'CUST-ATOM', 'Atomic Payment Customer', 'Atomic Payment Customer',
  '91919191-9191-4191-8191-919191919191', '91919191-9191-4191-8191-919191919191'
);

insert into public.party_roles (organization_id, party_id, role) values
  ('92929292-9292-4292-8292-929292929292', '93939393-9393-4393-8393-939393939393', 'customer');

insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping,
  is_registered_address, created_by, updated_by
) values (
  '94949494-9494-4494-8494-949494949494',
  '92929292-9292-4292-8292-929292929292',
  '93939393-9393-4393-8393-939393939393',
  'Billing', '1 Customer Road', 'Bhopal', 'Madhya Pradesh', '23',
  '462001', 'IN', true, true, true,
  '91919191-9191-4191-8191-919191919191', '91919191-9191-4191-8191-919191919191'
);

insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  '95959595-9595-4595-8595-959595959595',
  '92929292-9292-4292-8292-929292929292',
  'SELL-ATOM', 'Atomic Payment Seller', '23ABCDE1234F1Z5',
  '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462002', true,
  '91919191-9191-4191-8191-919191919191', '91919191-9191-4191-8191-919191919191'
);

set local role authenticated;
set local request.jwt.claim.sub = '91919191-9191-4191-8191-919191919191';

select public.create_financial_document_draft_from_profiles(
  '92929292-9292-4292-8292-929292929292',
  '95959595-9595-4595-8595-959595959595',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '93939393-9393-4393-8393-939393939393',
  '94949494-9494-4494-8494-949494949494',
  null, null, null, 'INR', '23', false, 'atomic payment invoice'
);
select public.upsert_financial_document_line_calculated(
  '92929292-9292-4292-8292-929292929292',
  (select id from public.financial_documents where notes = 'atomic payment invoice'),
  1, 'Service', 1, 'EA', 100,
  null, '{}'::jsonb, '9987', 0, '[]'::jsonb
);
select public.issue_financial_document(
  '92929292-9292-4292-8292-929292929292',
  (select id from public.financial_documents where notes = 'atomic payment invoice'),
  'atomic-payment-issue'
);

select lives_ok(
  $$select * from public.record_and_allocate_invoice_payment(
      '92929292-9292-4292-8292-929292929292',
      '93939393-9393-4393-8393-939393939393',
      (select id from public.financial_documents where notes = 'atomic payment invoice'),
      '2026-10-30', 100, 'INR', 'upi',
      'atomic-payment-one', 'atomic-allocation-one', 'UPI-001', null
    )$$,
  'receipt and invoice allocation can be recorded atomically'
);

select results_eq(
  $$select count(*) from public.customer_payments$$,
  array[1::bigint],
  'atomic receipt creates one immutable payment'
);

select results_eq(
  $$select count(*) from public.payment_allocations$$,
  array[1::bigint],
  'atomic receipt creates one immutable allocation'
);

select results_eq(
  $$select balance_due, payment_status from public.invoice_payment_balance(
      '92929292-9292-4292-8292-929292929292',
      (select id from public.financial_documents where notes = 'atomic payment invoice')
    )$$,
  $$values (0::numeric, 'paid'::text)$$,
  'atomic receipt fully settles the invoice'
);

select results_eq(
  $$select payment_id, allocation_id from public.record_and_allocate_invoice_payment(
      '92929292-9292-4292-8292-929292929292',
      '93939393-9393-4393-8393-939393939393',
      (select id from public.financial_documents where notes = 'atomic payment invoice'),
      '2026-10-30', 100, 'INR', 'upi',
      'atomic-payment-one', 'atomic-allocation-one', 'UPI-001', null
    )$$,
  $$select p.id, a.id
    from public.customer_payments p
    join public.payment_allocations a
      on a.organization_id = p.organization_id and a.payment_id = p.id
    where p.request_key = 'atomic-payment-one' and a.request_key = 'atomic-allocation-one'$$,
  'atomic receipt is idempotent with the same payment and allocation keys'
);

select throws_ok(
  $$select * from public.record_and_allocate_invoice_payment(
      '92929292-9292-4292-8292-929292929292',
      '93939393-9393-4393-8393-939393939393',
      (select id from public.financial_documents where notes = 'atomic payment invoice'),
      '2026-10-30', 1, 'INR', 'cash',
      'atomic-payment-over', 'atomic-allocation-over', null, null
    )$$,
  '23514',
  null,
  'over-allocation fails the whole atomic receipt transaction'
);

select results_eq(
  $$select count(*) from public.customer_payments$$,
  array[1::bigint],
  'failed atomic allocation rolls back its payment insert'
);

select results_eq(
  $$select count(*) from public.payment_allocations$$,
  array[1::bigint],
  'failed atomic allocation leaves allocation ledger unchanged'
);

reset role;
select * from finish();
rollback;
