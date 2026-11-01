# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. PostgreSQL is the tenant-security and business-invariant boundary; React and the Worker API remain tenant-scoped clients of that model.

> **Resume rule:** Read this README and `docs/CURRENT_CHECKPOINT_2026-10-30.md` before continuing. Update them after major milestones/security changes and before ending substantial work.

## Current checkpoint

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- `main`: foundation work is **not merged**
- Database CI: **GREEN** — run `40987922831`
- Application CI: **GREEN** — run `41221818608`
- Browser E2E: **GREEN** — run `41355614560`
- Security CI: **GREEN** — run `41355752128`
- Database migrations: through `20261030003300_bulk_import_payload_null_hardening.sql`
- pgTAP suites: `001–023`
- Production deployment: **not started**
- Production credentials/customer data: **not configured or committed**

## V1 business capabilities implemented

### Platform + security

- Supabase Auth
- organization onboarding + active-tenant switcher
- PostgreSQL RLS tenant isolation
- owner/admin/staff/viewer roles
- immutable audit events
- idempotent mutation patterns
- no service-role key for normal business routes
- exact decimal strings across JS boundaries
- PostgreSQL `numeric` for money/tax/quantity truth

### Inventory

- item + warehouse masters
- append-only inventory movement ledger
- transactional balances
- negative-stock protection
- item/warehouse archive safeguards
- atomic warehouse transfers
- Inventory web workspace

### Customers / suppliers / tax profiles

- reusable party master
- customer/supplier roles
- multiple addresses
- multiple tax registrations
- GSTIN structural + state-code validation
- seller/legal billing profiles
- archive lifecycle instead of destructive deletes

### GST financial documents

- tax invoices
- credit notes
- debit notes
- financial-year/series numbering
- PostgreSQL-authoritative line/tax arithmetic
- CGST / SGST / UTGST / IGST / CESS
- immutable issued/cancelled documents
- immutable seller/buyer/address/item/tax snapshots
- commercial credit/debit adjustments
- return-linked credit notes
- shared credit ceiling per original invoice line
- authenticated A4 print route + browser Print / Save PDF

### Fulfillment + returns

- partial fulfillment
- multiple immutable fulfillment postings per invoice
- one warehouse per posting
- multi-warehouse completion
- row-lock protection against over-fulfillment
- derived status: `not_applicable`, `unfulfilled`, `partial`, `fulfilled`
- physical sales returns tied to exact fulfillment
- returns restore the exact shipping warehouse
- physical-return and financial-credit ledgers remain separate

### Customer payments

- immutable receipts + allocations
- atomic receipt + invoice allocation
- over-allocation/customer/currency protection
- partial allocation reversals
- partial receipt refunds
- reversal-aware invoice balance/status
- correction UI

### Supplier receiving

- immutable Purchase Receipt / GRN ledger
- one receiving warehouse per receipt
- multiple receipt lines
- exact quantity + unit cost
- immutable supplier/item snapshots
- tenant-scoped receipt → inventory-movement linkage
- atomic multi-line stock posting
- transactional per-org GRN numbering
- idempotency + audit + full rollback
- `/purchases` workspace
- deliberately **no supplier AP/payable side effect**

### Operational visibility

- PostgreSQL operational dashboard
- currency-separated financial KPIs
- inventory KPIs without invalid cross-UOM totals
- purchase-receiving counts
- fulfillment status counts
- audit/activity counts
- read-only audit-log API + `/audit`

### Secure CSV bulk data V1

- `/data` Import / Export workspace
- versioned CSV schema (`1`)
- Items / Customers / Suppliers import-export
- Opening Stock import
- mandatory UI dry-run
- execution-time PostgreSQL re-validation
- atomic import batch
- create-only V1 semantics
- immutable import batches
- request-key idempotency + audit
- spreadsheet/formula-injection defense
- strict headers + quoted comma/quote/newline support
- malformed/NUL rejection
- 1,000 data rows / 2 MiB limits

See `docs/BULK_DATA.md`.

## Real-stack Browser E2E — V1 critical path closed

Playwright runs against:

`Chromium → React/Vite → Cloudflare Worker/Wrangler → Supabase Auth/PostgREST → PostgreSQL/RLS`

Run `41355614560` is **GREEN** and proves through the real browser:

1. login + first-organization onboarding
2. Item CSV dry-run/import
3. two warehouses
4. Supplier CSV dry-run/import
5. supplier Purchase Receipts into both warehouses
6. inventory balance verification
7. seller/legal profile
8. customer + billing address
9. stock-backed GST invoice draft + PostgreSQL tax calculation
10. immutable invoice issue
11. partial fulfillment from warehouse 1
12. remaining fulfillment from warehouse 2
13. two immutable fulfillment postings + `fulfilled` status
14. physical return against exact warehouse-2 posting
15. warehouse-2 stock restoration
16. return-linked GST credit note
17. partial customer receipt
18. partial allocation reversal
19. partial receipt refund
20. authenticated issued-document print output
21. operational dashboard rendering
22. immutable `financial_document.issued` audit-event visibility

## Security automation

Security CI was added on 2026-11-02.

Run `41355752128` is **GREEN**:

- `npm audit --audit-level=high`: passed
- CodeQL JavaScript/TypeScript initialization: passed
- production build under CodeQL: passed
- CodeQL analysis/upload: passed

Repository automation:

- `.github/workflows/security-ci.yml`
  - pinned CodeQL Action `v4.39.1`
  - dependency audit
  - weekly scheduled scan
- `.github/dependabot.yml`
  - weekly npm updates
  - weekly GitHub Actions updates
  - grouped npm minor/patch updates

## Architecture

| Layer | Decision |
|---|---|
| Product | Multi-tenant SaaS |
| Architecture | Modular monolith first |
| Web | React + TypeScript + Vite + React Router |
| API | Hono + TypeScript on Cloudflare Workers |
| Database/Auth | Supabase PostgreSQL + Supabase Auth |
| Tenant isolation | PostgreSQL RLS |
| Inventory truth | Append-only inventory movements |
| Financial docs | Draft editable; issued docs immutable |
| Money/tax/quantity | PostgreSQL `numeric`; decimal strings in JS |
| Payments | Immutable receipt/allocation/reversal/refund ledgers |
| Fulfillment | Multiple immutable one-warehouse postings |
| Returns | Exact fulfillment-linked physical return ledger |
| Receiving | Immutable physical Purchase Receipt; AP separate |
| Bulk data | Versioned, dry-run-first, server-authoritative CSV |
| Reporting | DB-derived, currency/UOM safe |
| Document output | Authenticated print route |
| CI | GitHub Actions |
| Node baseline | 24.22.2 LTS |

## Non-negotiable invariants

1. Every tenant-owned row belongs to an organization.
2. PostgreSQL RLS is the tenant authorization boundary.
3. Browser-selected organization is UX state only.
4. `organization_id` cannot be silently reassigned.
5. Inventory movements are append-only; corrections use reversing movements.
6. Stock posting is transactional and locks capacity/balance rows where required.
7. Negative stock is blocked unless explicit future org policy allows it.
8. Dangerous mutations use idempotency keys.
9. Money/tax/quantity truth never uses JS floating point.
10. Issued financial documents/lines/taxes are immutable.
11. Corrections use explicit credit/debit/cancel/return/reversal/refund workflows.
12. Critical mutations append audit events.
13. Secrets and production customer data never enter Git.
14. Schema changes use unique version-controlled migrations.
15. Historical docs never depend on later master-data changes.
16. Clients cannot supply authoritative legal/item snapshots or tax totals.
17. Receipt/allocation/reversal/refund rows are immutable.
18. Payment allocation must match invoice customer/currency and cannot over-allocate.
19. Refund/reversal cannot exceed remaining reversible value.
20. Items/warehouses with non-zero stock cannot be archived.
21. Aggregate fulfillment cannot exceed original line quantity.
22. Returns reference exact fulfillments and restore that warehouse.
23. Aggregate returns cannot exceed fulfillment quantity.
24. Physical returns and financial credits are separate ledgers.
25. Commercial + return-linked credits share one active taxable-value ceiling.
26. Purchase Receipts are physical logistics only; they do not create AP.
27. Purchase Receipt rows and inventory links are immutable.
28. Dashboard totals are never summed across currencies.
29. Inventory reporting never sums unrelated UOM/item quantities.
30. Audit viewer is read-only and governed by database RBAC/RLS.
31. Bulk dry-run is advisory; execution re-validates DB state.
32. CSV values never become authoritative accounting calculations.

## Database state

- migrations: `001` foundation through `033` bulk import payload null hardening
- pgTAP: suites `001–023` green
- latest DB gate: run `40987922831`
- migration versions must never be reused

## API domains

Normal requests use verified user JWTs with a user-scoped Supabase client.

Implemented:

- organizations
- parties/profiles
- seller billing profiles
- inventory
- financial documents
- financial adjustments
- fulfillment / returns / return credits
- customer payments / reversals / refunds
- purchase receipts
- dashboard + audit
- bulk import/export

## Web routes

- `/login`
- `/` — dashboard
- `/customers`
- `/suppliers`
- `/inventory`
- `/purchases`
- `/invoices`
- `/payments`
- `/audit`
- `/data`
- `/settings`
- `/financial-documents/:documentId/print?organizationId=...`

## CI gates

| Gate | Latest verified run | Status |
|---|---:|---|
| Database CI | `40987922831` | GREEN |
| Application CI | `41221818608` | GREEN |
| Browser E2E | `41355614560` | GREEN |
| Security CI | `41355752128` | GREEN |

## Remaining production-readiness work

High priority:

1. Dynamic security testing / HTTP hardening review.
2. Load + concurrency testing against representative business operations.
3. Staging deployment + environment/secret separation.
4. Automated backups + restore drill.
5. Monitoring, error tracking and operational alerts.
6. Privileged-account MFA policy + production security review.
7. Production deployment/domain/TLS rollout.
8. Trusted GST registration verification integration.
9. `.xlsx` import/export only after CSV stability/parser-license review.
10. Supplier Invoice / Accounts Payable remains a later accounting module linked to Purchase Receipts.

## Next engineering task — resume here

**Production hardening. Start with dynamic HTTP/security checks and load/concurrency tests. Then prepare staging deployment. Ask the user for an opinion when a real deployment/policy choice is required (domain, environment plan, backup retention, alert destination, pilot rollout).**
