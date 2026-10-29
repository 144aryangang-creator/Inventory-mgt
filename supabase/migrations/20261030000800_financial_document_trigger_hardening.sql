-- Harden trigger edge cases introduced with the financial document core.

create or replace function app_private.ensure_document_is_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_organization_id uuid;
  v_status public.financial_document_status;
begin
  if tg_table_name = 'financial_document_lines' then
    if tg_op = 'DELETE' then
      v_document_id := old.document_id;
      v_organization_id := old.organization_id;
    else
      v_document_id := new.document_id;
      v_organization_id := new.organization_id;
    end if;
  else
    select l.document_id, l.organization_id
      into v_document_id, v_organization_id
    from public.financial_document_lines l
    where l.id = case when tg_op = 'DELETE' then old.line_id else new.line_id end
      and l.organization_id = case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  end if;

  select d.status into v_status
  from public.financial_documents d
  where d.id = v_document_id
    and d.organization_id = v_organization_id;

  if v_status is distinct from 'draft'::public.financial_document_status then
    raise exception 'issued financial document detail is immutable' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_financial_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then
      return old;
    end if;
    raise exception 'issued financial document is immutable; use credit/debit note or cancellation'
      using errcode = '55000';
  end if;

  if old.status = 'draft' then
    return new;
  end if;

  if old.status = 'issued'
     and new.status = 'cancelled'
     and (to_jsonb(new) - array['status','cancelled_at','cancelled_by','cancellation_reason','updated_by','updated_at'])
       = (to_jsonb(old) - array['status','cancelled_at','cancelled_by','cancellation_reason','updated_by','updated_at']) then
    return new;
  end if;

  raise exception 'issued financial document is immutable; use credit/debit note or cancellation'
    using errcode = '55000';
end;
$$;
