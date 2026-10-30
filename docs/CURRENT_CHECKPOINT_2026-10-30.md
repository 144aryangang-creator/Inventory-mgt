# Current Engineering Checkpoint — 2026-10-30

## Stable checkpoint

**Secure CSV bulk import/export V1 is complete and CI-green. Real-stack Playwright coverage is in progress.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is not merged yet.

### Current validation gates

- Database CI: **GREEN** — run `40987922831`
  - migration rebuild through `20261030003300_bulk_import_payload_null_hardening.sql` passed
  - DB lint passed
  - pgTAP suites `001–023` passed
  - clean shutdown passed
- Application CI: **GREEN** — run `40987757450`
  - locked install passed
  - lockfile drift check passed
  - strict TypeScript passed
  - contract/API/web unit tests passed
  - Cloudflare Worker build passed
  - React/Vite production build passed
- Browser E2E: **IN PROGRESS**
  - Playwright `1.64.1`
  - real local Supabase Auth/PostgREST/Postgres + Worker + React + Chromium
  - current retry-safe critical-path run: `40988630175`
  - first browser run proved infrastructure healthy and exposed a selector/retry-state test defect; the test has been corrected

## Latest completed milestone — Secure CSV bulk data V1

Implemented:

- `/data` Import / Export workspace
- CSV schema version `1`
- Items import + export
- Customers import + export
- Suppliers import + export
- Opening Stock template + import only
- mandatory dry-run before UI enables import
- API CSV grammar + row-schema validation
- PostgreSQL authoritative existing-data dry-run validation
- atomic import transaction per batch
- create-only V1 semantics
- immutable `data_import_batches`
- request-key idempotency
- high-level `data_import.completed` audit event
- spreadsheet/formula-injection defense on exports
- exact decimal-string Opening Stock quantity/cost semantics
- Opening Stock position must have no prior inventory history
- explicit row/file limits: 1,000 data rows / 2 MiB
- strict versioned header order
- quoted commas/quotes/newlines supported
- NUL and malformed quote grammar rejected
- no automatic date/number coercion

Database migrations:

- `20261030003000_bulk_imports.sql`
- `20261030003100_bulk_import_validation.sql`
- `20261030003200_bulk_import_payload_hardening.sql`
- `20261030003300_bulk_import_payload_null_hardening.sql`

Regression coverage:

- `021_bulk_imports.test.sql` — 32 assertions
- `022_bulk_import_validation.test.sql` — 12 assertions
- `023_bulk_import_payload_hardening.test.sql` — 6 assertions
- shared CSV parser/export unit tests
- API boundary tests

See `docs/BULK_DATA.md` for the canonical CSV contract.

### Important CSV boundaries

- CSV is transport; PostgreSQL remains authoritative.
- Imports do not accept tenant IDs, database IDs, audit actor identity, tax calculations or immutable snapshots.
- Items/Customers/Suppliers are create-only in V1.
- Opening Stock is initialization, not a current-balance report.
- Current balances are deliberately **not** exported as “opening stock.”
- Spreadsheet-safe exports are not guaranteed round-trip import files because defensive formula neutralization may alter dangerous leading characters.
- Future `.xlsx` support must normalize into the exact same server-side v1 row model and dry-run/import RPCs.

## Browser E2E — current state

Implemented:

- pinned `@playwright/test` `1.64.1`
- CI uses one Chromium worker + retries
- traces/screenshots/videos retained on failure
- real local Supabase application stack
- real password authentication
- real Worker JWT verification
- real PostgreSQL RLS path
- real React application
- ephemeral local E2E user
- current critical path:
  1. sign in
  2. create first organization when required
  3. verify selected tenant/dashboard
  4. upload Item CSV
  5. dry-run validation
  6. atomic import
  7. verify imported item in Inventory

Important regression already found by E2E design review:

- first-organization onboarding became unreachable when `/` was switched to the operational dashboard
- fixed by reusing `OrganizationOnboarding` from `OperationalDashboardPage`

First browser execution also proved the organization was actually created, but the test used an invisible selected `<option>` as a visibility assertion and retries reused DB state. The test is now retry-safe and asserts the selected organization semantically.

## Previously stable workflows

- tenant/RLS/auth foundation
- inventory ledger + master workflows + transfers
- parties / addresses / GST registrations
- seller billing profiles
- GST invoice core
- general credit/debit corrections
- return-linked credits
- customer payments + reversals/refunds
- partial + multi-warehouse fulfillment
- immutable sales returns
- Purchase Receipts / physical supplier receiving
- operational dashboard + read-only audit viewer
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

## Next task — resume here

1. Finish Browser E2E run `40988630175` and fix any real browser/app defect.
2. Once green, extend E2E to Purchase Receipt:
   - create warehouse
   - import supplier
   - post receipt
   - verify immutable GRN history
   - verify stock balance
3. Then add browser coverage for:
   - tax invoice issue
   - partial/multi-warehouse fulfillment
   - return + return-linked credit
   - customer payment + reversal/refund
   - print route
   - audit/dashboard
4. After critical E2E flows are green, move to production hardening:
   - secret management
   - backups + restore drill
   - monitoring/error tracking
   - privileged-account MFA
   - dependency/security scanning
   - load/concurrency tests
   - deployment

Do not merge `foundation/bootstrap` to `main` without explicit authorization.
