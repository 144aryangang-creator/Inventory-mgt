-- Mirror the versioned Opening Stock v1 transport contract at the database boundary.
-- Normal business clients use the CSV API, but direct RPC callers must not be able to weaken
-- the required exact-decimal string semantics for quantity/unitCost.

create or replace function app_private.validate_data_import_batch_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry jsonb;
begin
  if new.import_type = 'opening_stock' then
    for v_entry in select value from jsonb_array_elements(new.request_payload)
    loop
      if jsonb_typeof(v_entry) <> 'object'
         or jsonb_typeof(v_entry->'itemSku') <> 'string'
         or nullif(trim(v_entry->>'itemSku'), '') is null
         or jsonb_typeof(v_entry->'warehouseCode') <> 'string'
         or nullif(trim(v_entry->>'warehouseCode'), '') is null
         or jsonb_typeof(v_entry->'quantity') <> 'string'
         or (v_entry->>'quantity') !~ '^\d{1,14}(\.\d{1,6})?$'
         or (v_entry->>'quantity')::numeric <= 0
         or jsonb_typeof(v_entry->'unitCost') <> 'string'
         or (v_entry->>'unitCost') !~ '^\d{1,14}(\.\d{1,6})?$'
         or (v_entry->>'unitCost')::numeric < 0 then
        raise exception 'opening stock v1 rows require itemSku, warehouseCode, positive decimal-string quantity and non-negative decimal-string unitCost'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger data_import_batches_validate_payload
before insert on public.data_import_batches
for each row execute function app_private.validate_data_import_batch_payload();
