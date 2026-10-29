begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email) values
  ('81818181-8181-4181-8181-818181818181', 'snapshot-owner@test.local');

insert into public.organizations (id, name, slug) values
  ('82828282-8282-4282-8282-828282828282', 'Snapshot Tenant', 'snapshot-tenant'),
  ('83838383-8383-4383-8383-838383838383', 'Other Snapshot Tenant', 'other-snapshot-tenant');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('82828282-8282-4282-8282-828282828282', '81818181-8181-4181-8181-818181818181', 'owner');

insert into public.items (
  id, organization_id, sku, name, description, base_uom, track_inventory
) values
  (
    '84848484-8484-4484-8484-848484848484',
    '82828282-8282-4282-8282-828282828282',
    'REAL-SKU', 'Real Inventory Item', 'Authoritative description', 'EA', true
  ),
  (
    '85858585-8585-4585-8585-858585858585',
    '83838383-8383-4383-8383-838383838383',
    'OTHER-SKU', 'Other Tenant Item', null, 'EA', true
  );

insert into public.financial_documents (
  id, organization_id, document_type, document_date, series_code, supply_type,
  supplier_snapshot, bill_to_snapshot, created_by, updated_by
) values (
  '86868686-8686-4686-8686-868686868686',
  '82828282-8282-4282-8282-828282828282',
  'tax_invoice', '2026-10-30', 'INV', 'intra_state',
  '{"legal_name":"Snapshot Seller"}'::jsonb,
  '{"legal_name":"Snapshot Buyer"}'::jsonb,
  '81818181-8181-4181-8181-818181818181',
  '81818181-8181-4181-8181-818181818181'
);

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4181-8181-818181818181';

select lives_ok(
  $$select public.upsert_financial_document_line_calculated(
      '82828282-8282-4282-8282-828282828282',
      '86868686-8686-4686-8686-868686868686',
      1, 'User-facing description', 2, 'EA', 100,
      '84848484-8484-4484-8484-848484848484',
      '{"sku":"FORGED-SKU","name":"Forged Name","track_inventory":false}'::jsonb,
      '8708', 0, '[]'::jsonb
    )$$,
  'item-backed invoice line accepts the selected item'
);

select results_eq(
  $$select
      item_snapshot ->> 'sku',
      item_snapshot ->> 'name',
      item_snapshot ->> 'base_uom',
      item_snapshot ->> 'track_inventory'
    from public.financial_document_lines
    where document_id = '86868686-8686-4686-8686-868686868686'
      and line_number = 1$$,
  $$values ('REAL-SKU'::text, 'Real Inventory Item'::text, 'EA'::text, 'true'::text)$$,
  'database ignores forged item snapshot fields and stores authoritative item identity'
);

select lives_ok(
  $$select public.upsert_financial_document_line_calculated(
      '82828282-8282-4282-8282-828282828282',
      '86868686-8686-4686-8686-868686868686',
      2, 'Service line', 1, 'JOB', 50,
      null,
      '{"sku":"SHOULD-NOT-PERSIST"}'::jsonb,
      null, 0, '[]'::jsonb
    )$$,
  'free-form invoice line remains supported'
);

select results_eq(
  $$select item_snapshot
    from public.financial_document_lines
    where document_id = '86868686-8686-4686-8686-868686868686'
      and line_number = 2$$,
  $$values ('{}'::jsonb)$$,
  'free-form line cannot smuggle an item snapshot without an item id'
);

reset role;
select * from finish();
rollback;
