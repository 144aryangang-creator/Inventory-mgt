# Current Engineering Checkpoint — 2026-10-30

## Last stable business workflow

**Supplier Purchase Receipts / Physical Receiving**

Implemented:

- `20261030002700_purchase_receipts.sql`
- immutable `purchase_receipts` and `purchase_receipt_lines`
- tenant-scoped receipt → inventory-movement linkage
- per-organization transactional GRN/receipt numbering
- active supplier-role validation
- active tracked-item validation
- active receiving warehouse validation
- exact decimal quantity and unit cost
- zero-cost physical receipts allowed
- supplier and item snapshots
- atomic multi-line stock posting via `inventory_movements`
- request-key idempotency
- immutable history + audit event
- rollback of header, movements and receipt number if any line fails
- no Accounts Payable / supplier invoice side effect
- contracts + API + `/purchases` receiving page
- pgTAP `019_purchase_receipts.test.sql` — 40 assertions

Validation observed during this work block:

- Database branch workflow green after purchase-receipt changes; run `40983075705` was the purchase-receipt DB gate.
- Application branch workflow and local locked install/typecheck/tests were green after purchase-receipt API/web changes.
- Do not invent an exact purchase-receipt Application CI run ID; retrieve/pin the latest successful branch run before updating README.

## Operational visibility — in progress

Committed but **do not yet describe as a stable/mounted milestone** until final route mounting + CI are verified:

- `20261030002900_operational_dashboard.sql`
- `020_operational_dashboard.test.sql` — 18 assertions
- `packages/contracts/src/operations.ts`
- `packages/contracts/src/operations.test.ts`
- `apps/api/src/operations.ts`
- `apps/api/src/operations.test.ts`
- `apps/web/src/pages/OperationalDashboardPage.tsx`
- `apps/web/src/pages/AuditLogPage.tsx`
- `apps/web/src/operations.css`
- `docs/OPERATIONAL_VISIBILITY.md`

Operational invariants:

- financial KPIs grouped by currency; no cross-currency totals
- no cross-item/UOM inventory quantity sum
- purchase receiving counts are physical logistics, not AP/payable value
- fulfillment status derived from immutable fulfillment postings
- audit viewer read-only + tenant scoped

### Remaining integration work for operational visibility

1. Mount `operationsRoutes` in `apps/api/src/worker.ts` at `/v1/operations`.
2. Replace the old dashboard route with `OperationalDashboardPage`.
3. Add `/audit` route to `AuditLogPage`.
4. Add sidebar navigation for Purchase Receipts and Audit Log if not already present.
5. Run/inspect DB CI for migration 029 + suite 020; fix any real schema/test failure.
6. Run Application CI for operations contracts/API/pages.
7. Only after both gates are green, update `README.md` with exact run IDs and advance the next task to import/export + browser E2E/production hardening.

## Last fully pinned pre-purchase checkpoint

Partial + multi-warehouse fulfillment:

- DB CI `40982193283` — green
- App CI `40982649571` — green
- migrations through `20261030002600`
- pgTAP suites through `018`

## Important boundary

Purchase Receipt remains separate from supplier invoice / accounts payable. Future supplier accounting must link to physical receipt history rather than retroactively changing receipt or stock movement rows.
