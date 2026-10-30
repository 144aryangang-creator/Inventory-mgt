-- Serialize all controlled credits against the same original invoice line.
-- Both commercial credits and return-linked credits lock the original immutable line before
-- evaluating the shared remaining taxable-value ceiling.

create or replace function app_private.validate_financial_adjustment_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_adjustment public.financial_adjustments%rowtype;
  v_original_line public.financial_document_lines%rowtype;
  v_adjustment_line public.financial_document_lines%rowtype;
  v_document public.financial_documents%rowtype;
  v_existing_credit numeric(20,6);
begin
  select * into v_adjustment
  from public.financial_adjustments
  where id = new.adjustment_id
    and organization_id = new.organization_id;

  if not found
     or v_adjustment.adjustment_document_id is distinct from new.adjustment_document_id then
    raise exception 'financial adjustment header mismatch' using errcode = '23514';
  end if;

  select * into v_document
  from public.financial_documents
  where id = new.adjustment_document_id
    and organization_id = new.organization_id;

  if not found
     or v_document.document_type is distinct from v_adjustment.adjustment_type
     or v_document.linked_document_id is distinct from v_adjustment.original_invoice_id then
    raise exception 'adjustment document must link to its original tax invoice' using errcode = '23514';
  end if;

  select * into v_original_line
  from public.financial_document_lines
  where id = new.original_invoice_line_id
    and organization_id = new.organization_id
    and document_id = v_adjustment.original_invoice_id
  for update;

  if not found then
    raise exception 'original invoice line does not belong to adjustment invoice' using errcode = '23514';
  end if;

  if new.basis_quantity > v_original_line.quantity then
    raise exception 'adjustment basis quantity exceeds original invoice quantity' using errcode = '23514';
  end if;

  select * into v_adjustment_line
  from public.financial_document_lines
  where id = new.adjustment_document_line_id
    and organization_id = new.organization_id
    and document_id = new.adjustment_document_id;

  if not found
     or v_adjustment_line.taxable_value is distinct from new.taxable_adjustment then
    raise exception 'adjustment line taxable value mismatch' using errcode = '23514';
  end if;

  if v_adjustment.adjustment_type = 'credit_note'::public.financial_document_type then
    v_existing_credit := app_private.active_credited_taxable_for_invoice_line(
      new.organization_id,
      new.original_invoice_line_id
    );

    if v_existing_credit + new.taxable_adjustment > v_original_line.taxable_value then
      raise exception 'credit adjustment exceeds remaining original taxable value' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_sales_return_credit_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original_invoice_id uuid;
  v_credit_linked_document_id uuid;
  v_credit_document_type public.financial_document_type;
  v_credit_line public.financial_document_lines%rowtype;
  v_original_line public.financial_document_lines%rowtype;
  v_existing_credit numeric(20,6);
begin
  select f.financial_document_id
  into v_original_invoice_id
  from public.sales_returns r
  join public.sales_fulfillments f
    on f.id = r.fulfillment_id
   and f.organization_id = r.organization_id
  where r.id = new.sales_return_id
    and r.organization_id = new.organization_id;

  if not found then
    raise exception 'sales return does not resolve to an original invoice' using errcode = '23503';
  end if;

  select d.document_type, d.linked_document_id
  into v_credit_document_type, v_credit_linked_document_id
  from public.financial_documents d
  where d.id = new.credit_note_id
    and d.organization_id = new.organization_id;

  if not found
     or v_credit_document_type <> 'credit_note'::public.financial_document_type
     or v_credit_linked_document_id is distinct from v_original_invoice_id then
    raise exception 'credit note must link to the sales return original invoice' using errcode = '23514';
  end if;

  select * into v_credit_line
  from public.financial_document_lines l
  where l.id = new.credit_note_line_id
    and l.organization_id = new.organization_id
    and l.document_id = new.credit_note_id;

  if not found then
    raise exception 'credit note line must belong to linked credit note' using errcode = '23514';
  end if;

  select * into v_original_line
  from public.financial_document_lines l
  where l.id = new.fulfillment_line_id
    and l.organization_id = new.organization_id
    and l.document_id = v_original_invoice_id
  for update;

  if not found then
    raise exception 'sales return line must resolve to original invoice line' using errcode = '23514';
  end if;

  v_existing_credit := app_private.active_credited_taxable_for_invoice_line(
    new.organization_id,
    new.fulfillment_line_id
  );

  if v_existing_credit + v_credit_line.taxable_value > v_original_line.taxable_value then
    raise exception 'combined credit exceeds original invoice line taxable value' using errcode = '23514';
  end if;

  return new;
end;
$$;
