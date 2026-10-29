# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS designed to start on free/low-cost infrastructure and scale without rewriting the core.

> **Project handoff:** Read this file first when resuming work. Keep it updated after major milestones, architecture/security changes, failures that affect design, and before ending substantial sessions.

## Current status

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Project stage: **database + API foundation**
- Database foundation: **implemented and CI-green**
- Tenant/RLS security: **implemented and adversarially tested**
- Inventory ledger: **implemented and tested**
- Shared TypeScript validation: **implemented**
- Cloudflare Worker API foundation: **implemented**
- Application CI: **second verification run in progress after adding API tests**
- Web UI: not started
- Production deployment: not started
- Secrets/production credentials: not committed

## User requirements

- Complete inventory management + invoicing solution
- Customizable for different businesses without forking the codebase per customer
- Start as close to free as practical
- Clear path to large scale
- Production-grade security and testing
- Research current best practices before important architecture decisions
- Use concise pointers/checklists instead of long prose
- Keep this README as persistent project memory / resume point

## Architecture decisions locked in

| Area | Decision |
|---|---|
| Product | Multi-tenant SaaS |
| Initial architecture | Modular monolith |
| Frontend | React + TypeScript (not yet scaffolded) |
| API | Hono + TypeScript on Cloudflare Workers |
| Database/Auth | Supabase PostgreSQL + Supabase Auth |
| Tenant isolation | PostgreSQL Row Level Security |
| Authorization | RLS + organization roles |
| Inventory source of truth | Immutable stock movement ledger |
| Stock balance | Transactional cache protected by row locking |
| Money/quantities | PostgreSQL `numeric`; decimal strings in JS/TS boundaries |
| Storage | Supabase Storage initially; Cloudflare R2 where useful |
| CI/CD | GitHub Actions |
| Runtime baseline | Node 24.22.2 LTS |
| Scaling | Modular monolith first; split services only when metrics justify it |

## Critical invariants

1. Every tenant-owned business record has an `organization_id` or equivalent tenant relationship.
2. Tenant isolation is enforced in PostgreSQL RLS, not only application code.
3. `organization_id` cannot be silently changed to move records across tenants.
4. Inventory movements are append-only.
5. Stock corrections use new reversing/correcting movements.
6. Stock posting uses a database transaction and row lock.
7. Negative inventory is rejected unless the organization explicitly allows it.
8. Mutating operations support idempotency where duplicate requests are dangerous.
9. Money/tax/quantity calculations never rely on binary floating-point arithmetic.
10. Posted financial documents will be immutable; corrections use credit/debit/cancellation flows.
11. Critical mutations create append-only audit events.
12. Secrets and production customer data never enter Git.
13. Schema changes use version-controlled migrations.

## Implemented database foundation

### Tables

- `organizations`
- `organization_memberships`
- `items`
- `warehouses`
- `inventory_balances`
- `inventory_movements`
- `audit_events`

### Database security / behavior

- RLS enabled on all client-facing foundation tables
- Role baseline: `owner`, `admin`, `staff`, `viewer`
- Membership status: active/suspended
- RLS helper functions use `SECURITY DEFINER` with fixed `search_path`
- `organization_id` reassignment blocked on items/warehouses
- Direct client writes to inventory ledger blocked
- Inventory ledger update/delete blocked by trigger
- Audit update/delete blocked by trigger
- Composite foreign keys prevent item/warehouse cross-tenant mismatches
- Idempotency key unique per organization
- Stock balance row locked during posting
- Overselling blocked by default

### Secure database RPCs

- `create_organization(...)`
  - authenticated user creates tenant + owner membership atomically
  - audit event written
- `post_inventory_movement(...)`
  - owner/admin/staff only
  - validates tenant/item/warehouse
  - handles idempotent retries
  - locks stock balance
  - prevents invalid negative stock
  - writes ledger + balance + audit atomically

### Migrations

- `supabase/migrations/20261030000100_foundation.sql`
- `supabase/migrations/20261030000200_tenant_hardening.sql`

## Database tests

- `001_foundation_structure.test.sql`
- `002_tenant_inventory_security.test.sql`
- `003_integrity_and_roles.test.sql`

Coverage includes:

- RLS enabled
- required indexes
- Tenant A cannot see Tenant B
- cross-tenant insert blocked
- direct ledger insert blocked
- authorized receipt/sale works
- balance updates correctly
- overselling rejected
- failed oversell creates no ledger row
- idempotent retry creates no duplicate
- ledger is immutable
- multi-org user cannot move rows between tenants
- viewer cannot post inventory
- viewer cannot read admin audit events

### Database CI result

**GREEN** on GitHub Actions:

- local Supabase startup
- database rebuild from migrations
- `supabase db lint`
- pgTAP suites
- shutdown/cleanup

Supabase CLI is pinned to `2.122.0` in CI.

## Application foundation

### Workspace

```text
apps/
  api/
packages/
  contracts/
supabase/
  migrations/
  tests/
docs/
.github/workflows/
```

### Shared contracts

`packages/contracts` uses Zod for boundary validation.

Inventory quantities/costs cross the JS boundary as decimal strings:

- max 6 decimal places
- inbound quantities must be positive
- outbound quantities must be negative
- zero rejected
- unit cost non-negative
- UUID/request-key validation

This avoids silently converting exact PostgreSQL numerics through JavaScript floating-point arithmetic.

### Worker API

`apps/api` currently provides:

- `GET /health`
- protected `/v1/*` middleware
- verified Supabase JWT via `getClaims`
- user-scoped Supabase client so RLS remains authoritative
- `GET /v1/me`
- `GET /v1/organizations`
- `POST /v1/inventory/movements`
- request IDs
- secure headers
- restricted CORS
- generic/non-leaking client errors
- database error mapping for stock/permission/idempotency conflicts

**Important:** Normal business requests do **not** use a Supabase service-role key.

## Application testing status

### First Application CI run

- dependency install: passed
- TypeScript: passed
- contracts tests: **5/5 passed**
- API workspace: failed because it had no test files
- build skipped because CI correctly stopped on test failure

### Fix applied

Added API tests for:

- public health endpoint
- missing bearer token rejection
- empty bearer token rejection
- generic 404 response

Second Application CI run is currently validating the fix.

## CI workflows

- `.github/workflows/database-ci.yml`
- `.github/workflows/app-ci.yml`

Current app CI sequence:

1. Node 24.22.2
2. install dependencies
3. typecheck
4. unit tests
5. Worker dry-run build
6. temporarily upload generated `package-lock.json`

After the first fully-green app run:

- download generated lockfile
- commit `package-lock.json`
- replace `npm install` with `npm ci`
- rerun CI to verify reproducible installs

## Security model

See `docs/SECURITY_MODEL.md`.

Release gates include:

- DB CI green
- RLS/adversarial tests green
- TypeScript/unit/API tests green
- browser E2E green
- OWASP ZAP scan reviewed
- dependency/security scan reviewed
- load/concurrency tests green
- backup + restore drill completed
- production secrets outside Git
- MFA for privileged production access
- monitoring/alerting configured

## Product scope

### V1

- Authentication
- Organizations / tenants
- Users + roles/permissions
- Products/items
- Categories / units
- Custom item fields
- Warehouses
- Inventory ledger
- Stock adjustments/transfers
- Customers
- Suppliers
- Purchase receipts
- Sales invoices
- Payments
- GST/tax configuration
- PDF/print invoices
- Dashboard + reports
- Audit log
- CSV/Excel import/export

### Later

- Quotations / sales orders / purchase orders
- Returns / credit notes / debit notes
- Serial number tracking
- Batch/expiry tracking
- Barcode workflows
- GST e-invoicing / IRP
- E-way bill
- Email/WhatsApp/SMS automation
- Approval workflows
- POS
- Full accounting / general ledger
- Bank reconciliation
- Advanced analytics
- Offline/PWA
- Public API + webhooks

## Customization rule

**Do not fork code per customer.**

Use configuration for:

- custom fields
- required/optional fields
- field types and dropdowns
- validation rules
- branding
- invoice/document templates
- numbering schemes
- role permissions
- enabled modules
- workflows/automations later

Use normal relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

## India / GST direction

Architecture must support:

- GSTIN
- HSN/SAC
- CGST / SGST / IGST / Cess
- Place of Supply
- Reverse Charge
- B2B/B2C
- tax-inclusive/exclusive pricing
- credit/debit notes
- financial-year invoice numbering
- future IRN/acknowledgement/QR/e-invoice integration

Re-verify current official regulatory requirements immediately before implementing/releasing regulatory integrations.

## Deployment strategy

### Development / pilot

- Supabase free tier
- Cloudflare Workers free tier where suitable
- Supabase Storage / R2 within free allowances

### Before business-critical production

Move to paid managed infrastructure with:

- managed database/backups
- monitoring + alerting
- production email/domain configuration
- restore drills
- production secret management
- capacity/load validation

Scale progressively with indexes, pooling, queues, caching, replicas/partitioning only when measurements require them.

## NEXT TASK — RESUME HERE

1. Wait for / inspect the second Application CI run.
2. If it fails, fix the exact failing type/test/build step; do not bypass the check.
3. If green, download and commit the generated `package-lock.json`.
4. Change Application CI from `npm install` to `npm ci` and rerun until green.
5. Then scaffold the React web app + Supabase authentication shell.
6. After auth shell is stable, implement the next DB domain: customers/suppliers, followed by invoicing/tax design.

Do not start broad UI feature work until the application CI is green and the lockfile is committed.

## README update policy

Update this file when:

- architecture/security decisions change
- a major module is completed
- schema changes materially
- a significant test failure reveals a design issue
- deployment approach changes
- work is about to stop
- conversation context is becoming large

Before ending a substantial session, update at minimum:

- Current status
- completed work
- unresolved issues
- important decisions
- `NEXT TASK — RESUME HERE`

## Never commit

- Supabase service-role keys
- API secrets/tokens
- passwords
- credential-bearing production DB URLs
- OAuth/SMTP/GST provider secrets
- private signing keys
- production customer data
- real `.env` / `.dev.vars` files

Commit only safe templates such as `.env.example` / `.dev.vars.example`.
