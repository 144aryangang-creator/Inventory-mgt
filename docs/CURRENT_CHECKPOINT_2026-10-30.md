# Current Engineering Checkpoint — 2026-10-31

## Stable checkpoint

**Secure CSV bulk import/export V1 plus the real-stack stock-sales path through partial fulfillment are CI-green.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is not merged yet.

### Current validation gates

- Database CI: **GREEN** — run `40987922831`
  - migrations through `20261030003300_bulk_import_payload_null_hardening.sql`
  - DB lint passed
  - pgTAP suites `001–023` passed
  - clean shutdown passed
- Application CI: **GREEN** — run `41221818608`
  - locked install + lockfile drift passed
  - strict TypeScript passed
  - contract/API/web unit tests passed
  - fulfillment-route mount regression passed
  - Cloudflare Worker build passed
  - React/Vite production build passed
- Browser E2E: **GREEN** — run `41221818553`
  - real local Supabase Auth/PostgREST/Postgres + Worker + React + Chromium
  - sign-in + first-organization onboarding
  - Item CSV dry-run/import
  - warehouse creation
  - Supplier CSV dry-run/import
  - Purchase Receipt posting + immutable GRN detail
  - inventory balance verification
  - seller billing-profile creation
  - customer + billing-address creation
  - stock-backed tax-invoice draft + line + issue
  - PostgreSQL-authoritative tax total verification
  - partial stock fulfillment
  - resulting inventory decrement verification

## Latest completed milestone — real-stack stock sale through partial fulfillment

Critical path now proves through the browser that:

1. supplier stock can enter through an immutable Purchase Receipt
2. seller/customer legal snapshots can be configured
3. a stock-backed tax invoice can be drafted and issued
4. issue-time totals are produced by PostgreSQL
5. the issued invoice exposes its fulfillment summary
6. a partial quantity can leave the selected warehouse
7. fulfillment status becomes `partial`
8. warehouse on-hand stock decreases through an immutable `sale` movement

### Integration defect found and fixed

Browser E2E exposed that `salesFulfillmentRoutes` existed but was not mounted in the Worker, causing:

- `GET /v1/financial-documents/:documentId/fulfillments` → `404`
- the fulfillment UI to show `Request failed (404)` after invoice issue

Fix:

- mounted `salesFulfillmentRoutes` under `/v1/financial-documents`
- added worker-level auth/reachability regression so the fulfillment route must return the protected-route boundary rather than disappear as a 404

Fix commits:

- `15ab0269b41e32e390879a9b305e376560b57df4` — `fix(api): mount sales fulfillment routes`
- `e9bc87e914fd8c4cc77941f0f683a3b367f6dd7f` — `test(api): guard fulfillment route mounting`

Validated by Application CI `41221818608` and Browser E2E `41221818553`.

## Secure CSV bulk data V1

Implemented:

- `/data` Import / Export workspace
- CSV schema version `1`
- Items import + export
- Customers import + export
- Suppliers import + export
- Opening Stock template + import only
- mandatory dry-run before UI enables import
- API CSV grammar + row-schema validation
- PostgreSQL authoritative existing-data validation
- atomic import transaction per batch
- create-only V1 semantics
- immutable `data_import_batches`
- request-key idempotency
- `data_import.completed` audit event
- spreadsheet/formula-injection defense on exports
- exact decimal-string Opening Stock quantity/cost semantics
- Opening Stock position must have no prior inventory history
- 1,000 data rows / 2 MiB limits
- strict versioned header order
- quoted commas/quotes/newlines supported
- NUL and malformed quote grammar rejected
- no automatic date/number coercion

Migrations:

- `20261030003000_bulk_imports.sql`
- `20261030003100_bulk_import_validation.sql`
- `20261030003200_bulk_import_payload_hardening.sql`
- `20261030003300_bulk_import_payload_null_hardening.sql`

Regression suites:

- `021_bulk_imports.test.sql` — 32 assertions
- `022_bulk_import_validation.test.sql` — 12 assertions
- `023_bulk_import_payload_hardening.test.sql` — 6 assertions

See `docs/BULK_DATA.md` for the canonical CSV contract.

## Stable business workflows

- tenant/RLS/auth foundation
- organization onboarding + tenant switcher
- inventory ledger + master workflows + transfers
- parties / addresses / GST registrations
- seller billing profiles
- GST tax invoices
- general credit/debit corrections
- return-linked credits
- customer payments + reversals/refunds
- partial + multi-warehouse fulfillment
- immutable sales returns
- Purchase Receipts / physical supplier receiving
- operational dashboard + read-only audit viewer
- CSV bulk import/export V1
- Print / Save PDF for immutable financial documents

Purchase Receipt remains physical logistics only. It does not create supplier AP/payables.

## Architecture invariants to preserve

- PostgreSQL RLS is the tenant security boundary
- selected organization is UX state only
- inventory movements are append-only
- issued financial documents are immutable
- corrections use explicit return/reversal/credit/debit ledgers
- exact PostgreSQL `numeric`; decimal strings across JS boundaries
- historical legal/item/tax snapshots never depend on later master edits
- dangerous mutations use idempotency keys
- critical mutations append audit events
- no service-role key in normal business API requests
- no production credentials or real customer data in Git
- bulk dry-run is advisory only; execution always re-validates authoritative state
- CSV financial values never become authoritative accounting calculations

## Next task — resume here

Extend real-stack Browser E2E in this order:

1. complete remaining fulfillment quantity from a second warehouse to prove multi-warehouse completion
2. physical return against the exact fulfillment posting
3. return-linked credit note
4. customer receipt + allocation reversal/refund
5. immutable document print route
6. dashboard + audit-log verification

After critical E2E flows are green, move to production hardening:

- secret management
- backups + restore drill
- monitoring/error tracking
- privileged-account MFA
- dependency/security scanning
- load/concurrency tests
- deployment

Do not merge `foundation/bootstrap` to `main` without explicit authorization.
