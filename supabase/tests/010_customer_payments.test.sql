begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_table('public', 'customer_payments', 'customer payments table exists');
select has_table('public', 'payment_allocations', 'payment allocations table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.customer_payments'::regclass),
  'RLS is enabled on customer payments'
);

insert into auth.users (id, email) values
  ('81818181-8181-4181-8181-818181818181', 'payment-owner@test.local'),
  ('82828282-8282-4282-8282-828282828282', 'payment-viewer@test.local');

insert into public.organizations (id, name, slug) values
  ('83838383-8383-4383-8383-838383838383', 'Payment Tenant', 'payment-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('83838383-8383-4383-8383-838383838383', '81818181-8181-4181-8181-818181818181', 'owner'),
  ('83838383-8383-4383-8383-838383838383', '82828282-8282-4282-8282-828282828282', 'viewer');

insert into public.parties (
  id, organization_id, code, legal_name, display_name, created_by, updated_by
) values
  (
    '84848484-8484-4484-8484-848484848484',
    '83838383-8383-4383-8383-838383838383',
    'CUST-PAY', 'Payment Customer Private Limited', 'Payment Customer',
    '81818181-8181-4181-8181-818181818181', '81818181-8181-4181-8181-818181818181'
  ),
  (
    '85858585-8585-4585-8585-858585858585',
    '83838383-8383-4383-8383-838383838383',
    'CUST-OTHER', 'Other Customer Private Limited', 'Other Customer',
    '81818181-8181-4181-8181-818181818181', '81818181-8181-4181-8181-818181818181'
  );

insert into public.party_roles (organization_id, party_id, role) values
  ('83838383-8383-4383-8383-838383838383', '84848484-8484-4484-8484-848484848484', 'customer'),
  ('83838383-8383-4383-8383-838383838383', '85858585-8585-4585-8585-858585858585', 'customer');

insert into public.party_addresses (
  id, organization_id, party_id, label, address_line_1, city, state_name, state_code,
  postal_code, country_code, is_default_billing, is_default_shipping,
  is_registered_address, created_by, updated_by
) values
  (
    '86868686-8686-4686-8686-868686868686',
    '83838383-8383-4383-8383-838383838383',
    '84848484-8484-4484-8484-848484848484',
    'Billing', '10 Customer Road', 'Bhopal', 'Madhya Pradesh', '23',
    '462001', 'IN', true, true, true,
    '81818181-8181-4181-8181-818181818181', '81818181-8181-4181-8181-818181818181'
  ),
  (
    '87878787-8787-4787-8787-878787878787',
    '83838383-8383-4383-8383-838383838383',
    '85858585-8585-4585-8585-858585858585',
    'Billing', '20 Other Road', 'Bhopal', 'Madhya Pradesh', '23',
    '462002', 'IN', true, true, true,
    '81818181-8181-4181-8181-818181818181', '81818181-8181-4181-8181-818181818181'
  );

insert into public.organization_billing_profiles (
  id, organization_id, code, legal_name, gstin, address_line_1, city,
  state_name, state_code, postal_code, is_default, created_by, updated_by
) values (
  '88888888-8888-4888-8888-888888888888',
  '83838383-8383-4383-8383-838383838383',
  'SELL-PAY', 'Payment Seller Private Limited', '23ABCDE1234F1Z5',
  '1 Seller Road', 'Bhopal', 'Madhya Pradesh', '23', '462003', true,
  '81818181-8181-4181-8181-818181818181', '81818181-8181-4181-8181-818181818181'
);

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4181-8181-818181818181';

select throws_ok(
  $$insert into public.customer_payments (
      organization_id, customer_party_id, payment_date, amount, currency_code,
      method, request_key, created_by
    ) values (
      '83838383-8383-4383-8383-838383838383',
      '84848484-8484-4484-8484-848484848484',
      '2026-10-30', 100, 'INR', 'cash', 'direct-payment',
      '81818181-8181-4181-8181-818181818181'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert payments directly'
);

set local request.jwt.claim.sub = '82828282-8282-4282-8282-828282828282';
select throws_ok(
  $$select public.create_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      '84848484-8484-4484-8484-848484848484',
      '2026-10-30', 1180, 'INR', 'bank_transfer', 'payment-one'
    )$$,
  '42501',
  null,
  'viewer cannot record a customer payment'
);

set local request.jwt.claim.sub = '81818181-8181-4181-8181-818181818181';
select lives_ok(
  $$select public.create_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      '84848484-8484-4484-8484-848484848484',
      '2026-10-30', 1180, 'inr', 'bank_transfer', 'payment-one', 'UTR-001', 'advance received'
    )$$,
  'owner can record an immutable customer payment'
);

select results_eq(
  $$select amount, currency_code, method::text, reference from public.customer_payments where request_key = 'payment-one'$$,
  $$values (1180::numeric, 'INR'::text, 'bank_transfer'::text, 'UTR-001'::text)$$,
  'payment values are normalized and stored exactly'
);

select results_eq(
  $$select public.create_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      '84848484-8484-4484-8484-848484848484',
      '2026-10-30', 1180, 'INR', 'bank_transfer', 'payment-one', 'UTR-001', 'advance received'
    )$$,
  $$select id from public.customer_payments where request_key = 'payment-one'$$,
  'same payment request is idempotent'
);

select throws_ok(
  $$select public.create_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      '84848484-8484-4484-8484-848484848484',
      '2026-10-30', 1179, 'INR', 'bank_transfer', 'payment-one', 'UTR-001', 'advance received'
    )$$,
  '22023',
  null,
  'reusing a payment request key with different values is rejected'
);

select public.create_financial_document_draft_from_profiles(
  '83838383-8383-4383-8383-838383838383',
  '88888888-8888-4888-8888-888888888888',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '84848484-8484-4484-8484-848484848484',
  '86868686-8686-4686-8686-868686868686',
  null, null, null, 'INR', '23', false, 'payment invoice one'
);
select public.upsert_financial_document_line_calculated(
  '83838383-8383-4383-8383-838383838383',
  (select id from public.financial_documents where notes = 'payment invoice one'),
  1, 'Service', 1, 'EA', 1000, null, '{}'::jsonb, '9987', 0,
  '[{"component":"CGST","rate":9},{"component":"SGST","rate":9}]'::jsonb
);
select public.issue_financial_document(
  '83838383-8383-4383-8383-838383838383',
  (select id from public.financial_documents where notes = 'payment invoice one'),
  'payment-issue-one'
);

select lives_ok(
  $$select public.allocate_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.customer_payments where request_key = 'payment-one'),
      (select id from public.financial_documents where notes = 'payment invoice one'),
      400, 'allocation-one'
    )$$,
  'payment can be partially allocated to its customer invoice'
);

select results_eq(
  $$select allocated_total, balance_due, payment_status
    from public.invoice_payment_balance(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.financial_documents where notes = 'payment invoice one')
    )$$,
  $$values (400::numeric, 780::numeric, 'part_paid'::text)$$,
  'invoice payment status is derived as part-paid'
);

select results_eq(
  $$select public.allocate_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.customer_payments where request_key = 'payment-one'),
      (select id from public.financial_documents where notes = 'payment invoice one'),
      400, 'allocation-one'
    )$$,
  $$select id from public.payment_allocations where request_key = 'allocation-one'$$,
  'same allocation request is idempotent'
);

select lives_ok(
  $$select public.allocate_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.customer_payments where request_key = 'payment-one'),
      (select id from public.financial_documents where notes = 'payment invoice one'),
      780, 'allocation-two'
    )$$,
  'remaining payment can settle the invoice exactly'
);

select results_eq(
  $$select allocated_total, balance_due, payment_status
    from public.invoice_payment_balance(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.financial_documents where notes = 'payment invoice one')
    )$$,
  $$values (1180::numeric, 0::numeric, 'paid'::text)$$,
  'invoice payment status becomes paid when fully allocated'
);

select throws_ok(
  $$select public.allocate_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.customer_payments where request_key = 'payment-one'),
      (select id from public.financial_documents where notes = 'payment invoice one'),
      1, 'allocation-over'
    )$$,
  '23514',
  null,
  'allocation cannot exceed payment or invoice balance'
);

select throws_ok(
  $$insert into public.payment_allocations (
      organization_id, payment_id, financial_document_id, amount, request_key, created_by
    ) values (
      '83838383-8383-4383-8383-838383838383',
      (select id from public.customer_payments where request_key = 'payment-one'),
      (select id from public.financial_documents where notes = 'payment invoice one'),
      1, 'direct-allocation', '81818181-8181-4181-8181-818181818181'
    )$$,
  '42501',
  null,
  'authenticated clients cannot insert allocations directly'
);

select throws_ok(
  $$select public.cancel_financial_document(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.financial_documents where notes = 'payment invoice one'),
      'cancel paid invoice'
    )$$,
  '23514',
  null,
  'invoice with payment allocations cannot be cancelled without reversal'
);

reset role;
select throws_ok(
  $$update public.customer_payments set amount = 1 where request_key = 'payment-one'$$,
  '55000',
  null,
  'payment ledger is immutable even for privileged writes'
);

select throws_ok(
  $$delete from public.payment_allocations where request_key = 'allocation-one'$$,
  '55000',
  null,
  'payment allocations are immutable even for privileged writes'
);

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4181-8181-818181818181';

select public.create_financial_document_draft_from_profiles(
  '83838383-8383-4383-8383-838383838383',
  '88888888-8888-4888-8888-888888888888',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '85858585-8585-4585-8585-858585858585',
  '87878787-8787-4787-8787-878787878787',
  null, null, null, 'INR', '23', false, 'other customer invoice'
);
select public.upsert_financial_document_line_calculated(
  '83838383-8383-4383-8383-838383838383',
  (select id from public.financial_documents where notes = 'other customer invoice'),
  1, 'Service', 1, 'EA', 100, null, '{}'::jsonb, '9987', 0, '[]'::jsonb
);
select public.issue_financial_document(
  '83838383-8383-4383-8383-838383838383',
  (select id from public.financial_documents where notes = 'other customer invoice'),
  'payment-issue-other'
);

select throws_ok(
  $$select public.allocate_customer_payment(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.customer_payments where request_key = 'payment-one'),
      (select id from public.financial_documents where notes = 'other customer invoice'),
      1, 'wrong-customer-allocation'
    )$$,
  '23514',
  null,
  'payment cannot be allocated to another customer invoice'
);

set local request.jwt.claim.sub = '82828282-8282-4282-8282-828282828282';
select results_eq(
  $$select payment_status from public.invoice_payment_balance(
      '83838383-8383-4383-8383-838383838383',
      (select id from public.financial_documents where notes = 'payment invoice one')
    )$$,
  array['paid'::text],
  'viewer can read derived payment status for its organization'
);

set local request.jwt.claim.sub = '81818181-8181-4181-8181-818181818181';
select ok(
  (select count(*) from public.audit_events
   where organization_id = '83838383-8383-4383-8383-838383838383'
     and action in ('customer_payment.created', 'customer_payment.allocated')) >= 3,
  'payment creation and allocations are audited'
);

reset role;
select * from finish();
rollback;
