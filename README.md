# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. PostgreSQL is the tenant-security and business-invariant boundary; React and the Cloudflare Worker API remain tenant-scoped clients of that model.

> **Resume rule:** Read this README, `docs/CURRENT_CHECKPOINT_2026-10-30.md`, and `docs/STAGING_DEPLOYMENT.md` before continuing. Update the checkpoint/README after major milestones or security/architecture changes and before ending substantial work.

## Current checkpoint — 2026-11-02

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- `main`: foundation work is **not merged**
- V1 core business workflows: implemented
- prior stable CI gates: database/application/browser E2E/security/performance **GREEN**
- migrations: through `20261030003400_revoke_anon_rpc_execution.sql`
- hosted Supabase staging project: **created and migrated**
- live Cloudflare staging deployment: **not yet completed**
- production deployment: **not started**
- production credentials/customer data: **not configured or committed**

## Staging decision — FINAL

**Option B is selected.**

- root domain: `buildtechsolutions.com`
- staging hostname: `staging.buildtechsolutions.com`
- Cloudflare Worker: `inventory-mgt-staging`
- Supabase staging project: `inventorymgt`
- Supabase staging project ref: `gqmxivopdwmqlxjvyhia`
- Supabase region: `eu-west-2`
- same-origin React SPA + Hono API
- `workers.dev` disabled for staging
- staging and production must use separate Supabase projects and secrets

Implemented staging files:

- `apps/api/wrangler.staging.jsonc`
- `.github/workflows/staging-deploy.yml`
- `docs/STAGING_DEPLOYMENT.md`

The deploy workflow is manual-only, requires exact `DEPLOY-STAGING` confirmation, and refuses any hostname other than `staging.buildtechsolutions.com`.

## Hosted Supabase staging status

The existing `inventorymgt` project in the `buildtechsolutions.com` Supabase organization was empty and has been adopted as the dedicated staging project to avoid unnecessary additional cost.

Completed:

- repository migrations `001–034` applied
- remote migration history reconciled to the exact Git versions/names
- all application `public` tables have RLS enabled
- no production data copied to staging
- normal app traffic still uses user JWTs, not a service-role key

### Hosted security hardening discovered during staging

Supabase's hosted advisor exposed direct `anon` `EXECUTE` grants on public `SECURITY DEFINER` RPCs. Local CI did not expose this hosted-role default.

Migration `20261030003400_revoke_anon_rpc_execution.sql` fixes it by:

- revoking public-schema function execution from `anon`
- revoking future default function execution from `anon`
- preserving explicitly granted authenticated RPCs

Verified after migration `034`:

- anonymous-executable public `SECURITY DEFINER` RPCs: **0**
- public application tables with RLS disabled: **0**
- authenticated `SECURITY DEFINER` RPCs remain intentionally exposed only where the application requires them; those functions enforce `auth.uid()` and organization/role authorization

Two sequence tables intentionally have RLS enabled with no policies because clients have no direct table privileges and controlled RPCs own sequence mutation.

The fresh staging database also reports informational unindexed-FK and unused-index findings. Do not mechanically add/remove indexes; reassess using hosted E2E, realistic load, and query plans.

## V1 implemented capabilities

### Platform + security

- Supabase Auth
- organization onboarding + tenant switching
- PostgreSQL RLS tenant isolation
- owner/admin/staff/viewer roles
- immutable audit events
- idempotent dangerous mutations
- no service-role key for normal routes
- exact decimal strings across JS boundaries
- PostgreSQL `numeric` for money/tax/quantity truth
- non-cacheable authenticated `/v1/*` responses
- request IDs + secure HTTP headers

### Inventory

- item + warehouse masters
- append-only inventory movement ledger
- transactional balances
- negative-stock protection
- archive safeguards
- atomic warehouse transfers

### Parties / tax / billing

- reusable customer/supplier master
- multiple addresses and tax registrations
- GSTIN structural/state validation
- seller/legal billing profiles
- archive lifecycle instead of destructive deletes

### GST financial documents

- tax invoices, credit notes, debit notes
- financial-year/series numbering
- PostgreSQL-authoritative arithmetic
- CGST / SGST / UTGST / IGST / CESS
- immutable issued/cancelled documents
- immutable legal/item/tax snapshots
- commercial adjustments + return-linked credits
- authenticated print / Save PDF

### Fulfillment / returns / payments

- partial + multi-warehouse fulfillment
- immutable fulfillment postings
- exact fulfillment-linked returns
- receipt/allocation/reversal/refund ledgers
- reversal-aware invoice balances

### Supplier receiving / operations / bulk data

- immutable Purchase Receipt / GRN
- atomic stock posting
- operational dashboard
- read-only audit viewer
- secure CSV Items / Customers / Suppliers / Opening Stock import-export
- mandatory dry-run + execution-time DB validation
- atomic create-only V1 import batches

Supplier AP/payables remain a separate later accounting module.

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
| CI/CD | GitHub Actions |
| Node baseline | 24.22.2 LTS |
| Staging | `staging.buildtechsolutions.com` + dedicated Supabase project |

## Non-negotiable invariants

1. Every tenant-owned row belongs to an organization.
2. PostgreSQL RLS is the tenant authorization boundary.
3. Anonymous users cannot execute application RPCs.
4. Signed-in privileged RPCs must explicitly authorize user + organization/role.
5. Inventory movements are append-only; corrections use reversing movements.
6. Stock posting is transactional and negative stock is blocked by default.
7. Dangerous mutations use idempotency keys.
8. Money/tax/quantity truth never uses JS floating point.
9. Issued financial documents/lines/taxes are immutable.
10. Corrections use explicit credit/debit/cancel/return/reversal/refund workflows.
11. Critical mutations append audit events.
12. Secrets and production customer data never enter Git.
13. Schema changes use unique version-controlled migrations.
14. Historical documents never depend on later master-data changes.
15. Staging and production never share a Supabase database or deployment secrets.
16. Staging deployment must target exactly `staging.buildtechsolutions.com` unless the user explicitly changes the decision.

## Validation baseline

Prior stable gates:

- Database CI: `40987922831` — GREEN
- Application CI: `41356175796` — GREEN
- Browser E2E: `41355614560` — GREEN
- Security CI: `41356392873` — GREEN
- Performance CI: `41356392913` — GREEN

Performance regression baseline:

- 5 VUs / 20 s
- 1,338 requests
- 0 failures
- 4,014 / 4,014 checks passed
- p95 13.61 ms
- concurrent 1-unit stock contention produced exactly one success and one conflict

These are regression results, not production-capacity claims.

Migration `034` triggered a new CI wave; verify that wave is green before treating the latest database state as a fully validated release candidate.

## Remaining production-readiness sequence

1. verify the migration `034` CI wave is green
2. verify/control the `buildtechsolutions.com` Cloudflare zone
3. bind `staging.buildtechsolutions.com` to `inventory-mgt-staging`
4. configure GitHub Actions environment `staging` with the staging Supabase and Cloudflare values/secrets
5. configure Supabase Auth Site URL / redirect allow-list for `https://staging.buildtechsolutions.com`
6. run guarded `Deploy Staging`
7. run hosted Playwright E2E
8. run OWASP ZAP / HTTP security scan
9. perform database backup + restore drill
10. configure monitoring/error tracking/alerts
11. define privileged-account MFA policy and run production security review
12. only then plan production domain/TLS + controlled pilot

## Resume here

**Supabase staging already exists and is migrated through `034`. Do not recreate it. Next work is Cloudflare + GitHub staging environment configuration, then live deployment and hosted validation.**

**Do not merge `foundation/bootstrap` into `main` without explicit user authorization.**
