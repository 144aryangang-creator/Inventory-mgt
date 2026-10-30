-- Make Opening Stock v1 payload validation null-safe.
-- Missing JSON keys make jsonb_typeof(...) return SQL NULL, so key existence and type checks
-- are handled explicitly before numeric casts/sign checks.

create or replace function app_private.validate_data_import_batch_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_quantity numeric(20,6);
  v_unit_cost numeric(20,6);
begin
  if new.import_type = 'opening_stock' then
    for v_entry in select value from jsonb_array_elements(new.request_payload)
    loop
      if jsonb_typeof(v_entry) is distinct from 'object'
         or not (v_entry ? 'itemSku')
         or jsonb_typeof(v_entry->'itemSku') is distinct from 'string'
         or nullif(trim(v_entry->>'itemSku'), '') is null
         or not (v_entry ? 'warehouseCode')
         or jsonb_typeof(v_entry->'warehouseCode') is distinct from 'string'
         or nullif(trim(v_entry->>'warehouseCode'), '') is null
         or not (v_entry ? 'quantity')
         or jsonb_typeof(v_entry->'quantity') is distinct from 'string'
         or (v_entry->>'quantity') !~ '^\d{1,14}(\.\d{1,6})?$'
         or not (v_entry ? 'unitCost')
         or jsonb_typeof(v_entry->'unitCost') is distinct from 'string'
         or (v_entry->>'unitCost') !~ '^\d{1,14}(\.\d{1,6})?$' then
        raise exception 'opening stock v1 rows require itemSku, warehouseCode, positive decimal-string quantity and non-negative decimal-string unitCost'
          using errcode = '22023';
      end if;

      -- Cast only after the strings have passed the strict decimal grammar above.
      v_quantity := (v_entry->>'quantity')::numeric;
      v_unit_cost := (v_entry->>'unitCost')::numeric;

      if v_quantity <= 0 or v_unit_cost < 0 then
        raise exception 'opening stock v1 rows require positive quantity and non-negative unitCost'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  return new;
end;
$$;
