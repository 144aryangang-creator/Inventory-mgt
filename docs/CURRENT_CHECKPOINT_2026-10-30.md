# Current Engineering Checkpoint — 2026-11-02

## Stable checkpoint

**V1 core business workflows, real-stack browser critical path, security scanning, HTTP hardening, and the first load/concurrency regression gate are green. Staging architecture is now finalized and scaffolded; live deployment is blocked only on external domain/account setup.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is **not merged**.

## Validation gates

- Database CI: **GREEN** — run `40987922831`
  - migrations through `20261030003300_bulk_import_payload_null_hardening.sql`
  - DB lint passed
  - pgTAP suites `001–023` passed
- Application CI: **GREEN** — run `41356175796`
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

## Finalized staging architecture

**User selected Option B. Option A (`*.workers.dev` as the planned staging URL) is rejected.**

Staging topology:

- custom hostname such as `staging.example.com`
- separate Cloudflare Worker: `inventory-mgt-staging`
- `workers.dev` disabled for this staging Worker
- React/Vite SPA + Hono API served from the same staging origin
- `/v1/*` and `/health` route Worker-first
- SPA/static assets served by Cloudflare Workers Static Assets
- completely separate Supabase staging project/database
- no production credentials or customer data

Implemented files:

- `apps/api/wrangler.staging.jsonc`
- `.github/workflows/staging-deploy.yml`
- `docs/STAGING_DEPLOYMENT.md`

The staging workflow is manual-only, environment-scoped, requires exact `DEPLOY-STAGING` confirmation, runs tests/build validation, dry-runs migrations, applies versioned migrations, deploys Worker + SPA, and executes HTTP/security smoke checks.

## External inputs required before first staging deployment

1. actual owned domain / Cloudflare zone
2. chosen staging hostname
3. dedicated Supabase staging project
4. GitHub Actions environment named `staging`
5. staging variables/secrets documented in `docs/STAGING_DEPLOYMENT.md`

No live staging resources have been created from this repository yet.

## HTTP hardening already present

All `/v1/*` API responses return:

- `Cache-Control: no-store`
- request ID
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`

## Performance regression baseline

Local real-stack k6 gate:

- virtual users: `5`
- duration: `20s`
- requests: `1,338`
- failed requests: `0`
- checks: `4,014 / 4,014` passed
- p95 request duration: `13.61 ms`
- max request duration: `60.53 ms`

Concurrent stock contention probe:

- seeded exactly `1` unit
- fired two transfers concurrently
- exactly one `201` and one `409`
- source ending stock `0`
- aggregate destination stock `1`
- negative stock `0`

This is a regression baseline, not a production-capacity claim.

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
- staging and production never share a Supabase database or deployment secrets

## Active phase — staging deployment

Next sequence:

1. obtain/confirm the real domain and Cloudflare zone
2. create the separate Supabase staging project
3. configure the GitHub `staging` environment values/secrets
4. run `Deploy Staging` from `foundation/bootstrap`
5. confirm live smoke checks
6. run real hosted Playwright E2E against staging
7. run OWASP ZAP / HTTP security scan
8. automated database backup + restore drill
9. monitoring / error tracking / alerts
10. privileged-account MFA policy
11. production domain/TLS + controlled pilot only after staging acceptance

## Resume instruction

Read:

- `README.md`
- `docs/STAGING_DEPLOYMENT.md`
- this checkpoint

Then continue from external staging setup. Do not revisit the Option A/Option B decision unless the user explicitly changes it.

**Do not merge `foundation/bootstrap` into `main` without explicit user authorization.**
