# Current Engineering Checkpoint — 2026-11-02

## Stable checkpoint

**V1 core business workflows, real-stack browser critical path, security scanning, HTTP hardening, and the first load/concurrency regression gate are green. The dedicated hosted Supabase staging database now exists and is migrated through `034`; live Cloudflare/GitHub deployment configuration is the remaining external staging blocker.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is **not merged**.

## Validation gates

- Database CI: prior stable run **GREEN** — `40987922831`
- Application CI: **GREEN** — `41356175796`
- Browser E2E: **GREEN** — `41355614560`
- Security CI: **GREEN** — `41356392873`
- Performance CI: **GREEN** — `41356392913`
- New CI wave for migration `034`: triggered; do not call `034` CI-green until it completes successfully
- migrations now through `20261030003400_revoke_anon_rpc_execution.sql`
- pgTAP suites before `034`: `001–023`

## Finalized staging architecture

**Option B is final.**

- root domain: `buildtechsolutions.com`
- staging hostname: `staging.buildtechsolutions.com`
- separate Cloudflare Worker: `inventory-mgt-staging`
- `workers.dev` disabled
- same-origin React/Vite SPA + Hono API
- `/v1/*` and `/health` Worker-first
- Cloudflare Workers Static Assets for SPA assets
- dedicated Supabase staging project/database
- no production credentials or customer data

Implemented deployment files:

- `apps/api/wrangler.staging.jsonc`
- `.github/workflows/staging-deploy.yml`
- `docs/STAGING_DEPLOYMENT.md`

The deploy workflow is manual-only, requires exact `DEPLOY-STAGING` confirmation, and rejects any `STAGING_DOMAIN` other than `staging.buildtechsolutions.com`.

## Hosted Supabase staging — CREATED

Supabase organization: `buildtechsolutions.com`  
Staging project name: `inventorymgt`  
Project ref: `gqmxivopdwmqlxjvyhia`  
Region: `eu-west-2`

The project was empty before staging setup and is now dedicated to staging. Production must use a different future Supabase project.

### Database state

- repository migrations `001–034` applied
- remote migration history reconciled to the exact Git versions/names
- every application table in `public` has RLS enabled
- no production data was copied into staging
- no service-role key is used for ordinary application traffic

### Hosted security finding and fix

Supabase's hosted advisor exposed a role-default issue not visible in the local stack: `anon` had direct `EXECUTE` grants on public `SECURITY DEFINER` RPCs.

Migration `20261030003400_revoke_anon_rpc_execution.sql` now:

- revokes `EXECUTE` on all public-schema functions from `anon`
- revokes default future function execution from `anon`
- preserves the explicit authenticated RPC grants required by the application

Verification after migration `034`:

- anonymous-executable public `SECURITY DEFINER` functions: **0**
- authenticated-executable `SECURITY DEFINER` functions: **45**, intentional application RPC surface guarded by `auth.uid()` plus tenant/role checks
- public application tables with RLS disabled: **0**

Supabase security advisor still reports two informational `RLS enabled but no policy` findings for:

- `financial_document_sequences`
- `purchase_receipt_sequences`

This is intentional: clients receive no direct table privileges; sequence mutation occurs only through controlled RPCs. Do not add permissive policies simply to silence the advisor.

### Hosted performance advisor

The fresh/empty staging database reports many informational unindexed-foreign-key findings and unused indexes. Do **not** add or remove indexes mechanically. Re-evaluate after hosted E2E and representative load/query-plan evidence; premature indexing would add write/storage overhead without workload proof.

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

This is a local real-stack regression baseline, not a production-capacity claim.

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
- anonymous users cannot execute application RPCs
- intended signed-in RPCs perform explicit user + organization/role authorization
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

## Active phase — live staging deployment

Next sequence:

1. wait for/verify the migration `034` GitHub CI wave is green
2. verify/control the `buildtechsolutions.com` Cloudflare zone
3. bind `staging.buildtechsolutions.com` to the staging Worker
4. configure GitHub Actions environment `staging` with staging Supabase/Cloudflare values and secrets
5. configure Supabase Auth Site URL / allowed redirects for `https://staging.buildtechsolutions.com`
6. run `Deploy Staging` from `foundation/bootstrap`
7. confirm live smoke checks
8. run hosted Playwright E2E against `https://staging.buildtechsolutions.com`
9. run OWASP ZAP / HTTP security scan
10. automated DB backup + restore drill
11. monitoring / error tracking / alerts
12. privileged-account MFA policy
13. production rollout only after staging acceptance

## Resume instruction

Read:

- `README.md`
- `docs/STAGING_DEPLOYMENT.md`
- this checkpoint

Then continue from Cloudflare/GitHub environment setup. Do not recreate the Supabase staging project and do not revisit the Option A/Option B or staging-hostname decision unless the user explicitly changes it.

**Do not merge `foundation/bootstrap` into `main` without explicit user authorization.**
