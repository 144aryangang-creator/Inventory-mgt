# Current Engineering Checkpoint — 2026-10-30

## Stable checkpoint

**Purchase receiving + operational dashboard/audit integration are complete and CI-green.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is not merged yet.

### Validation gates

- Database CI: **GREEN** — run `40985726873`
  - Postgres-only Supabase startup passed
  - migration rebuild through `20261030002900_operational_dashboard.sql` passed
  - DB lint passed
  - pgTAP suites `001–020` passed
  - clean shutdown passed
- Application CI: **GREEN** — run `40985559971`
  - locked install passed
  - lockfile drift check passed
  - strict TypeScript passed
  - contract/API/web unit tests passed
  - Cloudflare Worker build passed
  - React/Vite production build passed

## Latest completed business workflow — Purchase Receipts

Implemented:

- `20261030002700_purchase_receipts.sql`
- `20261030002800_purchase_receipt_error_hardening.sql`
- immutable `purchase_receipts` + `purchase_receipt_lines`
- tenant-scoped receipt → exact inventory movement linkage
- per-organization transactional receipt/GRN numbering
- active supplier-role, item and warehouse validation
- exact decimal quantity + unit cost
- zero-cost physical receipts allowed
- immutable supplier/item snapshots
- atomic multi-line `receipt` inventory movements
- request-key idempotency
- rollback of header, stock movements and sequence if any line fails
- audit event
- contracts + API + `/purchases` web workspace
- `019_purchase_receipts.test.sql` — 40 assertions

Important boundary: **Purchase Receipt is physical logistics only. It does not create Accounts Payable or a supplier invoice.** Future supplier accounting must link to receipt history rather than rewrite it.

## Latest completed operational visibility milestone

Implemented:

- `20261030002900_operational_dashboard.sql`
- `020_operational_dashboard.test.sql` — 18 assertions
- operations contracts/API
- `/v1/operations/dashboard`
- `/v1/operations/audit`
- `/` uses `OperationalDashboardPage`
- `/audit` uses `AuditLogPage`
- Purchase Receipts + Audit Log sidebar navigation
- read-only tenant-scoped audit viewer
- operational dashboard styling/documentation

Operational invariants:

- financial KPIs are grouped by currency; never sum unlike currencies
- inventory KPI totals are counts/statuses; never sum unrelated item/UOM quantities
- purchase receipt metrics describe physical receiving, not AP/payables
- fulfillment status is derived from immutable fulfillment postings
- audit events remain immutable; viewer access remains governed by database RLS

## Important fixes in this milestone

- mounted previously unmounted purchase-receipt and operations API routes
- exported `@inventory/contracts/operations` and `@inventory/contracts/purchase-receipts`
- fixed purchase-receipt regression tests without widening sequence-table permissions
- hardened DB CI to start only required Supabase/Postgres services, reducing external image pulls

## Architecture invariants to preserve

- PostgreSQL RLS is the tenant security boundary
- user-selected active organization is UX state only
- inventory movements are append-only
- issued financial documents are immutable
- corrections use return/reversal/credit/debit ledgers
- exact `numeric` values in PostgreSQL; decimal strings across JS boundaries
- historical legal/item/tax snapshots never depend on later master-data edits
- dangerous mutations use idempotency keys
- critical mutations append audit events
- no service-role key in normal business API requests
- no production credentials or real customer data in Git

## Next task — resume here

**Build secure bulk import/export, then browser E2E coverage.**

Recommended order:

1. define versioned import/export schemas for item, customer, supplier and opening-stock data
2. start with CSV; add `.xlsx` only through a vetted parser after the CSV contract is stable
3. implement dry-run validation before any mutation
4. return row-level validation errors; never partially import a failed atomic batch unless the workflow explicitly supports partial acceptance
5. protect spreadsheet exports against CSV/formula injection
6. keep all tenant IDs/server-generated snapshots/tax calculations authoritative on the server; never accept them from import files
7. add idempotency + import audit events
8. add export endpoints with stable column order and explicit currency/UOM semantics
9. add Playwright E2E for auth/tenant switching, purchase receipt, invoice issue, partial fulfillment, return/credit, payment/reversal, print and audit/dashboard paths
10. after E2E is green, move to production hardening: secrets, backups/restore drill, monitoring, MFA, dependency/security scan and deployment

Security note for exports: OWASP CSV/formula injection must be treated as a release blocker for spreadsheet-compatible exports.
