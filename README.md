# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. PostgreSQL is the tenant-security and business-invariant boundary; React and the Cloudflare Worker API remain tenant-scoped clients of that model.

> **Resume rule:** Read this README, `docs/CURRENT_CHECKPOINT_2026-10-30.md`, and `docs/STAGING_DEPLOYMENT.md` before continuing. Update the checkpoint/README after major milestones or security/architecture changes and before ending substantial work.

## Current checkpoint — 2026-11-02

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- `main`: foundation work is **not merged**
- V1 core business workflows: implemented
- Database CI: **GREEN** — run `40987922831`
- Application CI: **GREEN** — run `41356175796`
- Browser E2E: **GREEN** — run `41355614560`
- Security CI: **GREEN** — run `41356392873`
- Performance CI: **GREEN** — run `41356392913`
- Database migrations: through `20261030003300_bulk_import_payload_null_hardening.sql`
- pgTAP suites: `001–023`
- Production deployment: **not started**
- Production credentials/customer data: **not configured or committed**

## Staging decision — FINAL

**Option B is selected.**

Staging will use:

- a custom hostname such as `staging.example.com`
- a separate Cloudflare Worker: `inventory-mgt-staging`
- a completely separate Supabase staging project/database
- same-origin React SPA + Hono API on the staging hostname
- Cloudflare `workers.dev` disabled for the staging Worker
- strict separation from all future production credentials/data

Implemented staging scaffold:

- `apps/api/wrangler.staging.jsonc`
- `.github/workflows/staging-deploy.yml`
- `docs/STAGING_DEPLOYMENT.md`

The deploy workflow is manual-only and requires the exact confirmation `DEPLOY-STAGING`. It runs typecheck/tests, builds the staging SPA, dry-runs the Worker, dry-runs and applies versioned database migrations, deploys to the custom domain, then performs HTTP/security smoke checks.

**External setup still required before the first live staging deploy:**

1. choose/own the real domain and place its DNS in the intended Cloudflare account
2. create the dedicated Supabase staging project
3. create GitHub environment `staging`
4. add the staging domain/Supabase variables and Cloudflare/Supabase deployment secrets documented in `docs/STAGING_DEPLOYMENT.md`

## V1 implemented capabilities

### Platform + security

- Supabase Auth
- organization onboarding + active-tenant switcher
- PostgreSQL RLS tenant isolation
- owner/admin/staff/viewer roles
- immutable audit events
- idempotent dangerous mutations
- no service-role key for normal business routes
- exact decimal strings across JS boundaries
- PostgreSQL `numeric` for money/tax/quantity truth
- authenticated `/v1/*` responses use `Cache-Control: no-store`
- request IDs + secure HTTP headers

### Inventory

- item + warehouse masters
- append-only inventory movement ledger
- transactional balances
- negative-stock protection
- archive safeguards
- atomic warehouse transfers
- Inventory web workspace

### Parties / tax / billing profiles

- reusable customer/supplier master
- multiple addresses and tax registrations
- GSTIN structural + state-code validation
- seller/legal billing profiles
- archive lifecycle instead of destructive deletes

### GST financial documents

- tax invoices, credit notes, debit notes
- financial-year/series numbering
- PostgreSQL-authoritative line/tax arithmetic
- CGST / SGST / UTGST / IGST / CESS
- immutable issued/cancelled documents
- immutable seller/buyer/address/item/tax snapshots
- commercial adjustments + return-linked credits
- authenticated A4 print route + browser Print / Save PDF

### Fulfillment / returns

- partial and multi-warehouse fulfillment
- immutable fulfillment postings
- row-lock over-fulfillment protection
- exact fulfillment-linked physical returns
- stock restored to the exact shipping warehouse
- physical return and financial credit kept as separate ledgers

### Customer payments

- immutable receipts + allocations
- partial reversals and refunds
- over-allocation/customer/currency protection
- reversal-aware invoice balances/status

### Supplier receiving

- immutable Purchase Receipt / GRN ledger
- atomic multi-line stock posting
- exact quantity + unit cost
- immutable supplier/item snapshots
- transactional numbering + idempotency + audit
- intentionally no supplier AP/payable side effect yet

### Operations + bulk data

- PostgreSQL operational dashboard
- currency-safe and UOM-safe KPIs
- read-only audit viewer
- secure CSV Items / Customers / Suppliers / Opening Stock import-export
- mandatory dry-run + execution-time DB revalidation
- atomic create-only V1 import batches
- formula-injection and malformed-file defenses

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
| Receiving | Immutable Purchase Receipt; AP separate |
| Bulk data | Versioned, dry-run-first, server-authoritative CSV |
| Reporting | DB-derived, currency/UOM safe |
| Document output | Authenticated print route |
| CI/CD | GitHub Actions |
| Node baseline | 24.22.2 LTS |
| Staging | Custom Cloudflare domain + isolated Supabase project |

## Non-negotiable invariants

1. Every tenant-owned row belongs to an organization.
2. PostgreSQL RLS is the tenant authorization boundary.
3. Browser-selected organization is UX state only.
4. Inventory movements are append-only; corrections use reversing movements.
5. Stock posting is transactional and negative stock is blocked by default.
6. Dangerous mutations use idempotency keys.
7. Money/tax/quantity truth never uses JS floating point.
8. Issued financial documents/lines/taxes are immutable.
9. Corrections use explicit credit/debit/cancel/return/reversal/refund workflows.
10. Critical mutations append audit events.
11. Secrets and production customer data never enter Git.
12. Schema changes use unique version-controlled migrations.
13. Historical documents never depend on later master-data changes.
14. Clients cannot supply authoritative legal/item snapshots or tax totals.
15. Payment allocation must match invoice customer/currency and cannot over-allocate.
16. Items/warehouses with non-zero stock cannot be archived.
17. Aggregate fulfillment cannot exceed original line quantity.
18. Returns reference exact fulfillments and cannot exceed fulfilled quantity.
19. Physical returns and financial credits remain separate ledgers.
20. Purchase Receipts are physical logistics only; they do not create AP.
21. Dashboard totals are never summed across currencies or unrelated UOMs.
22. Bulk dry-run is advisory; execution re-validates DB state.
23. Authenticated `/v1/*` responses are non-cacheable.
24. Concurrent stock contention must never permit double spending of the same stock.
25. Staging and production must never share a Supabase database or secrets.

## Real-stack validation already proven

The browser critical path runs through:

`Chromium → React/Vite → Cloudflare Worker/Wrangler → Supabase Auth/PostgREST → PostgreSQL/RLS`

It covers onboarding, CSV import, receiving, inventory, billing profile, GST invoicing, multi-warehouse fulfillment, return + credit, receipt + reversal/refund, print output, dashboard and audit visibility.

Performance baseline (`41356392913`):

- 5 VUs / 20 s
- 1,338 HTTP requests
- 0 failures
- 4,014 / 4,014 checks passed
- p95 13.61 ms
- concurrent 1-unit stock contention produced exactly one success and one conflict

These are regression results, **not production capacity claims**.

## Remaining production-readiness sequence

1. complete external setup for the custom staging domain and isolated Supabase project
2. run the guarded `Deploy Staging` workflow
3. run real hosted Playwright E2E against staging
4. run OWASP ZAP / HTTP security scan against staging
5. perform automated-backup + restore drill
6. configure monitoring, error tracking and alerts
7. define privileged-account MFA policy and run production security review
8. only then plan production domain/TLS + controlled pilot
9. later: trusted GST registration verification integration
10. later: `.xlsx` import/export after CSV/parser-license stability review
11. later accounting module: Supplier Invoice / Accounts Payable linked to Purchase Receipts

## Resume here

**Next blocker is external staging infrastructure:** the actual domain/Cloudflare zone plus a dedicated Supabase staging project and GitHub `staging` environment values. Once those exist, execute `.github/workflows/staging-deploy.yml`, then move immediately to hosted E2E + OWASP ZAP.

**Do not merge `foundation/bootstrap` into `main` without explicit user authorization.**
