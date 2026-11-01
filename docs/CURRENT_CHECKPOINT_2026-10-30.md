# Current Engineering Checkpoint — 2026-11-02

## Stable checkpoint

**V1 core business workflows, the real-stack browser critical path, security scanning, HTTP hardening, and the first load/concurrency regression gate are green. The next phase is staging deployment.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is **not merged**.

## Validation gates

- Database CI: **GREEN** — run `40987922831`
  - migrations through `20261030003300_bulk_import_payload_null_hardening.sql`
  - DB lint passed
  - pgTAP suites `001–023` passed
- Application CI: **GREEN** — run `41356175796`
  - locked install + lockfile drift
  - strict TypeScript
  - API tests `55/55`
  - web tests `12/12`
  - contract tests `72/72`
  - Worker + React production builds passed
- Browser E2E: **GREEN** — run `41355614560`
  - real Supabase Auth/PostgREST/Postgres
  - real Worker + React app
  - Chromium
  - complete V1 business critical path
- Security CI: **GREEN** — run `41356392873`
  - high/critical npm dependency audit passed
  - CodeQL JavaScript/TypeScript passed
- Performance CI: **GREEN** — run `41356392913`
  - k6 authenticated tenant reads passed
  - concurrent stock-contention invariant passed

## HTTP hardening

All `/v1/*` API responses now explicitly return:

- `Cache-Control: no-store`
- request ID
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`

The outer Worker wrapper preserves the generic JSON `404` boundary.

## Performance regression baseline

Local real-stack k6 gate:

- virtual users: `5`
- duration: `20s`
- requests: `1,338`
- failed requests: `0`
- checks: `4,014 / 4,014` passed
- p95 request duration: `13.61 ms`
- max request duration: `60.53 ms`
- threshold: request failures `<1%`
- threshold: p95 `<1.5s`

This is a **regression baseline**, not a production-capacity claim.

Concurrent stock contention probe:

- seeded exactly `1` unit
- fired two transfers concurrently
- result: exactly one `201` and one `409`
- source ending stock: `0`
- destination aggregate: `1`
- negative stock: `0`

## Real-stack business path proven

1. authentication + organization onboarding
2. Item CSV dry-run/import
3. two warehouses
4. Supplier CSV dry-run/import
5. supplier Purchase Receipts into both warehouses
6. inventory balance verification
7. seller/legal profile
8. customer + billing address
9. stock-backed GST invoice
10. PostgreSQL tax calculation + immutable issue
11. partial fulfillment from warehouse 1
12. remaining fulfillment from warehouse 2
13. multi-warehouse `fulfilled` state
14. return against exact warehouse-2 posting
15. stock restored to warehouse 2
16. return-linked GST credit note
17. customer receipt
18. partial allocation reversal
19. partial receipt refund
20. authenticated issued-document print output
21. operational dashboard
22. immutable invoice-issue audit event

## Security automation

- `.github/workflows/security-ci.yml`
  - pinned CodeQL Action `v4.39.1`
  - `npm audit --audit-level=high`
  - weekly scheduled execution
- `.github/dependabot.yml`
  - weekly npm updates
  - weekly GitHub Actions updates
- `.github/workflows/performance-ci.yml`
  - pinned k6 `2.3.0`
  - authenticated read regression
  - real API stock-contention test

## Stable business modules

- tenant/RLS/auth foundation
- organization onboarding + tenant switching
- inventory ledger + transfers
- customers/suppliers + addresses/tax profiles
- seller billing profiles
- GST invoices / credit notes / debit notes
- commercial adjustments
- partial + multi-warehouse fulfillment
- sales returns + return-linked credits
- customer payments + reversals/refunds
- supplier Purchase Receipts / GRN
- operational dashboard
- audit viewer
- secure CSV import/export
- authenticated print / Save PDF

Purchase Receipt remains a physical logistics event only; supplier AP/payables are intentionally separate and not yet implemented.

## Invariants to preserve

- PostgreSQL RLS is the tenant security boundary
- organization switcher is UX state only
- inventory movements are append-only
- issued financial documents are immutable
- corrections use explicit return/reversal/refund/credit/debit ledgers
- PostgreSQL `numeric` is monetary/quantity truth
- JS boundaries use decimal strings
- legal/item/tax snapshots remain historical
- dangerous writes use idempotency keys
- critical writes append audit events
- normal API traffic never uses a service-role key
- authenticated API responses are non-cacheable
- no production credentials/customer data in Git
- bulk dry-run never replaces execution-time DB validation

## Active phase — staging deployment

Next sequence:

1. choose staging URL strategy with the user
2. use a separate Supabase staging project
3. configure Cloudflare staging Worker/environment and secret separation
4. deploy versioned DB migrations through CI
5. deploy API + web to staging
6. run real staging E2E and OWASP ZAP against the staging URL
7. automated database backups + restore drill
8. monitoring / error tracking / alerts
9. privileged-account MFA policy
10. production domain/TLS + controlled pilot after staging acceptance

## Decision required now

Recommended staging architecture:

- separate Supabase staging project
- separate Cloudflare staging Worker/environment
- no production data or credentials

User choice needed for staging URL:

- **Option A — recommended initially:** Cloudflare `*.workers.dev` staging URL; lowest setup/cost and fastest to validate.
- **Option B:** custom staging subdomain such as `staging.example.com`; cleaner/public-facing but requires a domain/DNS decision now.

Later decisions:

- production domain
- backup retention
- monitoring/alert destination
- pilot-user rollout policy
- paid infrastructure upgrades

Do **not** merge `foundation/bootstrap` into `main` without explicit user authorization.
