# Current Engineering Checkpoint — 2026-10-31

## Stable checkpoint

**Secure CSV bulk import/export V1 and the real-stack supplier purchase-receipt browser path are CI-green.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is not merged yet.

### Current validation gates

- Database CI: **GREEN** — run `40987922831`
  - migrations through `20261030003300_bulk_import_payload_null_hardening.sql`
  - DB lint passed
  - pgTAP suites `001–023` passed
  - clean shutdown passed
- Application CI: **GREEN** — run `40987757450`
  - locked install + lockfile drift passed
  - strict TypeScript passed
  - contract/API/web unit tests passed
  - Cloudflare Worker build passed
  - React/Vite production build passed
- Browser E2E: **GREEN** — run `41220607517`
  - Playwright `1.64.1`
  - real local Supabase Auth/PostgREST/Postgres + Worker + React + Chromium
  - sign-in + first-organization onboarding
  - Item CSV dry-run/import
  - inventory verification
  - warehouse creation
  - Supplier CSV dry-run/import
  - Purchase Receipt posting
  - immutable GRN detail verification
  - resulting warehouse stock balance verification

## Latest completed milestone — real-stack Purchase Receipt browser path

Critical path now proves through the browser that:

1. user authentication works against real local Supabase Auth
2. organization onboarding works through the normal API/RLS path
3. item CSV validation/import reaches PostgreSQL
4. imported inventory master data appears in the Inventory workspace
5. an active warehouse can be created
6. supplier CSV validation/import creates a supplier party
7. Purchase Receipt can post accepted supplier goods
8. GRN history/detail remains readable after posting
9. stock balance reflects the immutable receipt movement

Browser regressions found and fixed:

- first-organization onboarding became unreachable when `/` moved to the operational dashboard; onboarding was restored there
- retry-state assertions were made organization-aware
- purchase-receipt wrapped `<label>` markup caused Playwright label ambiguity; the E2E path now scopes the three receipt `<select>` controls by role inside the receipt form

Latest E2E fix commit before the green run:

- `fd08db364ec95a21bab194038697a0c0224a9c07` — `test(e2e): scope purchase receipt selects by role`

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

1. seller billing profile + customer profile prerequisites
2. tax invoice draft + stock-backed line + issue
3. partial fulfillment from one warehouse, then remaining quantity from another warehouse
4. physical return + return-linked credit note
5. customer receipt + allocation reversal/refund
6. immutable document print route
7. dashboard + audit-log verification

After critical E2E flows are green, move to production hardening:

- secret management
- backups + restore drill
- monitoring/error tracking
- privileged-account MFA
- dependency/security scanning
- load/concurrency tests
- deployment

Do not merge `foundation/bootstrap` to `main` without explicit authorization.
