begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_table('public', 'payment_allocation_reversals', 'allocation reversal table exists');
select has_table('public', 'customer_payment_reversals', 'payment reversal table exists');

insert into auth.users (id, email) values
  ('92920000-0000-4000-8000-000000000001', 'reversal-owner@test.local'),
  ('92920000-0000-4000-8000-000000000002', 'reversal-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('92920000-0000-4000-8000-000000000010', 'Payment Reversal Tenant', 'payment-reversal-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('92920000-0000-4000-8000-000000000010', '92920000-0000-4000-8000-000000000001', 'owner'),
  ('92920000-0000-4000-8000-000000000010', '92920000-0000-4000-8000-000000000002', 'viewer');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values (
  '92920000-0000-4000-8000-000000000020',
  '92920000-0000-4000-8000-000000000010',
  'CUST-REV', 'Reversal Customer Private Limited', 'Reversal Customer',
  '92920000-0000-4000-8000-000000000001', '92920000-0000-4000-8000-000000000001'
);
insert into public.party_roles (organization_id, party_id, role) values
  ('92920000-0000-4000-8000-000000000010', '92920000-0000-4000-8000-000000000020', 'customer');
insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping, is_registered_address,
  created_by, updated_by
) values (
  '92920000-0000-4000-8000-000000000030',
  '92920000-0000-4000-8000-000000000010',
  '92920000-0000-4000-8000-000000000020',
  'Billing', '10 Reversal Road', 'Bhopal', 'Madhya Pradesh', '23', '462001', 'IN',
  true, true, true,
  '92920000-0000-4000-8000-000000000001', '92920000-0000-4000-8000-000000000001'
);
insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  '92920000-0000-4000-8000-000000000040',
  '92920000-0000-4000-8000-000000000010',
  'SELL-REV', 'Reversal Seller Private Limited', '23ABCDE1234F1Z5',
  '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462002', true,
  '92920000-0000-4000-8000-000000000001', '92920000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = '92920000-0000-4000-8000-000000000001';

select public.create_financial_document_draft_from_profiles(
  '92920000-0000-4000-8000-000000000010',
  '92920000-0000-4000-8000-000000000040',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '92920000-0000-4000-8000-000000000020',
  '92920000-0000-4000-8000-000000000030',
  null, null, null, 'INR', '23', false, 'reversal invoice'
);
select public.upsert_financial_document_line_calculated(
  '92920000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'reversal invoice'),
  1, 'Service', 1, 'EA', 1000, null, '{}'::jsonb, '9987', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  '92920000-0000-4000-8000-000000000010',
  (select id from public.financial_documents where notes = 'reversal invoice'),
  'reversal-issue'
);
select public.create_customer_payment(
  '92920000-0000-4000-8000-000000000010',
  '92920000-0000-4000-8000-000000000020',
  '2026-10-30', 1180, 'INR', 'bank_transfer', 'reversal-payment', 'UTR-REV', null
);
select public.allocate_customer_payment(
  '92920000-0000-4000-8000-000000000010',
  (select id from public.customer_payments where request_key = 'reversal-payment'),
  (select id from public.financial_documents where notes = 'reversal invoice'),
  800, 'reversal-allocation'
);

select results_eq(
  $$select allocated_total, balance_due, payment_status from public.invoice_payment_balance(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'reversal invoice'))$$,
  $$values (800::numeric, 380::numeric, 'part_paid'::text)$$,
  'initial allocation is reflected in invoice balance'
);

set local request.jwt.claim.sub = '92920000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.reverse_payment_allocation(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.payment_allocations where request_key = 'reversal-allocation'),
      100, 'viewer reversal', 'viewer-reversal')$$,
  '42501', null, 'viewer cannot reverse an allocation'
);

set local request.jwt.claim.sub = '92920000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.reverse_payment_allocation(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.payment_allocations where request_key = 'reversal-allocation'),
      300, 'allocation correction', 'allocation-reversal-1')$$,
  'owner can partially reverse an allocation'
);

select results_eq(
  $$select allocated_total, balance_due, payment_status from public.invoice_payment_balance(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'reversal invoice'))$$,
  $$values (500::numeric, 680::numeric, 'part_paid'::text)$$,
  'invoice balance uses net allocation after reversal'
);

select results_eq(
  $$select public.reverse_payment_allocation(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.payment_allocations where request_key = 'reversal-allocation'),
      300, 'allocation correction', 'allocation-reversal-1')$$,
  $$select id from public.payment_allocation_reversals where request_key = 'allocation-reversal-1'$$,
  'same allocation reversal request is idempotent'
);

select throws_ok(
  $$select public.reverse_payment_allocation(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.payment_allocations where request_key = 'reversal-allocation'),
      501, 'too much', 'allocation-reversal-over')$$,
  '23514', null, 'allocation cannot be over-reversed'
);

select throws_ok(
  $$select public.reverse_customer_payment(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.customer_payments where request_key = 'reversal-payment'),
      681, 'refund too much allocated cash', 'payment-reversal-blocked')$$,
  '23514', null, 'payment refund cannot consume money still net-allocated'
);

select lives_ok(
  $$select public.reverse_customer_payment(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.customer_payments where request_key = 'reversal-payment'),
      600, 'customer refund', 'payment-reversal-1')$$,
  'unallocated receipt amount can be refunded'
);

select results_eq(
  $$select public.reverse_customer_payment(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.customer_payments where request_key = 'reversal-payment'),
      600, 'customer refund', 'payment-reversal-1')$$,
  $$select id from public.customer_payment_reversals where request_key = 'payment-reversal-1'$$,
  'same payment reversal request is idempotent'
);

select throws_ok(
  $$select public.allocate_customer_payment(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.customer_payments where request_key = 'reversal-payment'),
      (select id from public.financial_documents where notes = 'reversal invoice'),
      81, 'post-refund-allocation-too-high')$$,
  '23514', null, 'new allocation cannot exceed receipt amount remaining after refund'
);

select lives_ok(
  $$select public.allocate_customer_payment(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.customer_payments where request_key = 'reversal-payment'),
      (select id from public.financial_documents where notes = 'reversal invoice'),
      80, 'post-refund-allocation')$$,
  'remaining available receipt amount can still be allocated'
);

select results_eq(
  $$select allocated_total, balance_due from public.invoice_payment_balance(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'reversal invoice'))$$,
  $$values (580::numeric, 600::numeric)$$,
  'new allocation combines with net historical allocation'
);

select lives_ok(
  $$select public.reverse_payment_allocation(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.payment_allocations where request_key = 'reversal-allocation'),
      500, 'remove remaining original allocation', 'allocation-reversal-2')$$,
  'remaining original allocation can be reversed'
);
select lives_ok(
  $$select public.reverse_payment_allocation(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.payment_allocations where request_key = 'post-refund-allocation'),
      80, 'remove reallocation', 'allocation-reversal-3')$$,
  'later allocation can also be reversed'
);

select results_eq(
  $$select allocated_total, balance_due, payment_status from public.invoice_payment_balance(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'reversal invoice'))$$,
  $$values (0::numeric, 1180::numeric, 'unpaid'::text)$$,
  'fully reversed allocations return invoice to unpaid'
);

select lives_ok(
  $$select public.reverse_customer_payment(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.customer_payments where request_key = 'reversal-payment'),
      580, 'refund remainder', 'payment-reversal-2')$$,
  'receipt can be fully refunded after all allocations are reversed'
);

select results_eq(
  $$select sum(amount) from public.customer_payment_reversals
    where payment_id = (select id from public.customer_payments where request_key = 'reversal-payment')$$,
  array[1180::numeric],
  'payment reversal ledger totals the original receipt amount exactly'
);

select lives_ok(
  $$select public.cancel_financial_document(
      '92920000-0000-4000-8000-000000000010',
      (select id from public.financial_documents where notes = 'reversal invoice'),
      'payments fully reversed')$$,
  'invoice can be cancelled after net allocation reaches zero'
);

reset role;
select throws_ok(
  $$update public.customer_payment_reversals set amount = 1 where request_key = 'payment-reversal-1'$$,
  '55000', null, 'payment reversal ledger is immutable'
);
select throws_ok(
  $$delete from public.payment_allocation_reversals where request_key = 'allocation-reversal-1'$$,
  '55000', null, 'allocation reversal ledger is immutable'
);

set local role authenticated;
set local request.jwt.claim.sub = '92920000-0000-4000-8000-000000000001';
select ok(
  (select count(*) from public.audit_events
   where organization_id = '92920000-0000-4000-8000-000000000010'
     and action in ('customer_payment.reversed', 'customer_payment.allocation_reversed')) >= 5,
  'reversal actions are audited'
);

reset role;
select * from finish();
rollback;
