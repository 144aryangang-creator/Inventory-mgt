# Bulk Data — CSV v1

## Scope

Supported import types:

- Items
- Customers
- Suppliers
- Opening Stock

Supported spreadsheet-safe exports:

- Items
- Customers
- Suppliers

Opening Stock intentionally has **template + import only**. Current balances are not exported as opening stock because opening stock is initialization history, not a live balance report.

## Transport limits

- UTF-8 CSV
- comma delimiter
- schema version: `1`
- exact header names and order
- maximum file size: 2 MiB
- maximum data rows: 1,000
- quoted fields and escaped `""` supported
- embedded newlines supported inside quoted fields
- NUL bytes rejected
- no automatic number/date coercion

## Workflow

1. Download the v1 template.
2. Populate rows without changing the header order.
3. Upload the CSV.
4. Run **Validate / Dry Run**.
5. CSV grammar/row schemas are checked at the API boundary.
6. Existing organization state is checked by PostgreSQL without mutation.
7. Import remains disabled until dry-run succeeds.
8. Import repeats validation and executes one atomic PostgreSQL transaction.
9. Successful batches become immutable `data_import_batches` records and append a high-level audit event.

A dry-run never grants permission or reserves capacity. The execution RPC remains authoritative if data changes after validation.

## V1 mutation semantics

Imports are **create-only**.

- Items: existing SKU rejects the batch.
- Customers/Suppliers: existing shared party code rejects the batch.
- Opening Stock: item and warehouse must already exist and be active.
- Opening Stock: the exact item/warehouse position must have no prior inventory movement history.
- Opening Stock uses append-only `adjustment_in` movements.
- Any invalid row rolls back the entire batch, including batch metadata and stock movements.
- Request keys make accepted retries idempotent.

## Authoritative fields

Import files never provide:

- `organization_id`
- user/role authorization
- database IDs
- legal/tax snapshots
- calculated tax values
- financial document totals
- audit actor identity

Those remain server/database derived.

## Exact numeric handling

Opening Stock v1 requires:

- `quantity`: positive decimal **string**, maximum 14 integer and 6 fractional digits
- `unit_cost`: non-negative decimal **string**, same precision envelope

PostgreSQL re-validates this payload shape even for direct RPC callers.

## Spreadsheet export safety

Exports are optimized for safe viewing in spreadsheet applications.

Every cell is quoted. Values beginning with spreadsheet-formula trigger characters are neutralized before export, including common ASCII and full-width variants such as:

- `=`
- `+`
- `-`
- `@`
- tab / CR / LF
- full-width equivalents

Because defensive neutralization can alter the leading representation of dangerous text, exported spreadsheet-safe files are **not guaranteed round-trip import files**. Use the versioned template for imports.

## Future `.xlsx`

Do not add `.xlsx` until the CSV contract is stable and retained as the canonical import model.

Any future Excel parser must:

- have a reviewed commercial-compatible license
- run under the same row/file limits
- produce the same normalized v1 row structures
- preserve exact decimal strings rather than JS floating-point authority
- go through the same PostgreSQL dry-run and atomic import RPCs
- receive parser/security regression tests before production use
