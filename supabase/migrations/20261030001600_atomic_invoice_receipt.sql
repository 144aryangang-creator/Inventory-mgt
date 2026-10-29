-- Convenience transaction for the common UI flow: record a receipt and allocate all of it to one invoice.
-- The underlying immutable payment/allocation ledgers remain authoritative.

create or replace function public.record_and_allocate_invoice_payment(
  p_organization_id uuid,
  p_customer_party_id uuid,
  p_financial_document_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency_code text,
  p_method public.payment_method,
  p_payment_request_key text,
  p_allocation_request_key text,
  p_reference text default null,
  p_notes text default null
)
returns table (payment_id uuid, allocation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_allocation_id uuid;
begin
  -- Security, tenant, customer, currency, invoice-state, balance and idempotency
  -- invariants are enforced by the two ledger RPCs below. If allocation fails,
  -- the payment insert is rolled back in this same transaction.
  select public.create_customer_payment(
    p_organization_id,
    p_customer_party_id,
    p_payment_date,
    p_amount,
    p_currency_code,
    p_method,
    p_payment_request_key,
    p_reference,
    p_notes
  ) into v_payment_id;

  select public.allocate_customer_payment(
    p_organization_id,
    v_payment_id,
    p_financial_document_id,
    p_amount,
    p_allocation_request_key
  ) into v_allocation_id;

  return query select v_payment_id, v_allocation_id;
end;
$$;

revoke all on function public.record_and_allocate_invoice_payment(
  uuid, uuid, uuid, date, numeric, text, public.payment_method, text, text, text, text
) from public;

grant execute on function public.record_and_allocate_invoice_payment(
  uuid, uuid, uuid, date, numeric, text, public.payment_method, text, text, text, text
) to authenticated;
