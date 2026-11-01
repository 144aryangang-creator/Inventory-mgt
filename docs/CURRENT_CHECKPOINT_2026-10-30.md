# Current Engineering Checkpoint — 2026-11-02

## Stable checkpoint

**V1 core business workflows, real-stack browser critical path, security scanning, HTTP hardening, and the first load/concurrency regression gate are green. Staging architecture is finalized and scaffolded. The exact staging hostname is now fixed as `staging.buildtechsolutions.com`.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is **not merged**.

## Validation gates

- Database CI: **GREEN** — run `40987922831`
- Application CI: **GREEN** — run `41356175796`
- Browser E2E: **GREEN** — run `41355614560`
- Security CI: **GREEN** — run `41356392873`
- Performance CI: **GREEN** — run `41356392913`
- migrations through `20261030003300_bulk_import_payload_null_hardening.sql`
- pgTAP suites `001–023`

## Finalized staging architecture

**Option B is final.**

- root domain: `buildtechsolutions.com`
- staging hostname: `staging.buildtechsolutions.com`
- separate Cloudflare Worker: `inventory-mgt-staging`
- `workers.dev` disabled
- same-origin React/Vite SPA + Hono API
- `/v1/*` and `/health` Worker-first
- Cloudflare Workers Static Assets for SPA assets
- completely separate Supabase staging project/database
- no production credentials or customer data

Implemented files:

- `apps/api/wrangler.staging.jsonc`
- `.github/workflows/staging-deploy.yml`
- `docs/STAGING_DEPLOYMENT.md`

The deploy workflow is manual-only and requires exact `DEPLOY-STAGING` confirmation. It also rejects any `STAGING_DOMAIN` other than `staging.buildtechsolutions.com`.

## External inputs required before first live staging deployment

1. verify `buildtechsolutions.com` is in the intended Cloudflare account/zone
2. ensure `staging.buildtechsolutions.com` is available for the Worker custom domain
3. create the dedicated Supabase staging project
4. create/configure GitHub Actions environment `staging`
5. provide the staging variables/secrets from `docs/STAGING_DEPLOYMENT.md`

No production credentials/customer data are committed.

## HTTP hardening already present

All `/v1/*` API responses return:

- `Cache-Control: no-store`
- request ID
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`

## Performance regression baseline

- 5 VUs / 20 s
- 1,338 requests
- 0 failures
- 4,014 / 4,014 checks passed
- p95 13.61 ms
- concurrent 1-unit stock contention produced exactly one success and one conflict

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

## Invariants to preserve

- PostgreSQL RLS is the tenant security boundary
- inventory movements are append-only
- issued financial documents are immutable
- corrections use explicit ledgers
- PostgreSQL `numeric` is monetary/quantity truth
- dangerous writes use idempotency keys
- critical writes append audit events
- normal API traffic never uses a service-role key
- no production credentials/customer data in Git
- staging and production never share Supabase databases or deployment secrets
- staging deployment targets exactly `staging.buildtechsolutions.com` unless the user explicitly changes the domain decision

## Active phase — staging deployment

Next sequence:

1. verify/control the `buildtechsolutions.com` Cloudflare zone
2. create separate Supabase staging project
3. configure GitHub `staging` environment values/secrets
4. run `Deploy Staging` from `foundation/bootstrap`
5. confirm smoke checks
6. run hosted Playwright E2E against `https://staging.buildtechsolutions.com`
7. run OWASP ZAP / HTTP security scan
8. automated DB backup + restore drill
9. monitoring / error tracking / alerts
10. privileged-account MFA policy
11. production rollout only after staging acceptance

## Resume instruction

Read:

- `README.md`
- `docs/STAGING_DEPLOYMENT.md`
- this checkpoint

Then continue from external staging infrastructure. Do not revisit the Option A/Option B or staging-hostname decision unless the user explicitly changes it.

**Do not merge `foundation/bootstrap` into `main` without explicit user authorization.**
