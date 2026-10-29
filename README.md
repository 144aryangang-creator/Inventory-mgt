# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. Start on free/low-cost infrastructure, preserve a path to production scale, and keep tenant/security rules enforced in the database.

> **Resume rule:** Read this README first. Update it after major milestones, important failures/decisions, and before ending substantial work.

## Current status

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work not merged yet
- Database foundation: **implemented + CI green**
- RLS / tenant isolation: **implemented + adversarially tested**
- Inventory ledger: **implemented + tested**
- API foundation: **implemented + CI green**
- React web/auth shell: **implemented + CI green**
- Reproducible npm lockfile: **committed; CI uses `npm ci`**
- Production deployment: not started
- Real Supabase/Cloudflare production credentials: not configured or committed

## User requirements

- Complete inventory management + invoicing system
- Customizable per business without maintaining separate code forks
- Start as close to free as practical
- Scale progressively based on measurements
- Production-grade security, backups, testing, observability
- Research current practices before major technology decisions
- Prefer concise pointers/checklists in discussion
- Keep this README as persistent handoff memory

## Architecture

| Layer | Decision |
|---|---|
| Product | Multi-tenant SaaS |
| Architecture | Modular monolith first |
| Web | React 19 + TypeScript + Vite + React Router |
| API | Hono + TypeScript on Cloudflare Workers |
| Database/Auth | Supabase PostgreSQL + Supabase Auth |
| Tenant isolation | PostgreSQL RLS |
| Inventory truth | Immutable stock movement ledger |
| Stock balance | Transactional cache with row locking |
| Numeric values | PostgreSQL `numeric`; decimal strings across JS boundaries |
| Storage | Supabase Storage initially; Cloudflare R2 where useful |
| CI/CD | GitHub Actions |
| Node baseline | 24.22.2 LTS |
| Scale strategy | indexes/pooling/queues first; split services only when justified |

## Non-negotiable invariants

1. Every tenant-owned record has an organization relationship.
2. PostgreSQL RLS is the tenant authorization boundary.
3. `organization_id` cannot be silently changed to move data between tenants.
4. Inventory movements are append-only.
5. Stock corrections use reversing/correcting movements.
6. Stock posting locks the balance row and is transactional.
7. Negative inventory is blocked unless explicitly enabled.
8. Dangerous mutations use idempotency protection.
9. Money/tax/quantity logic never relies on binary floating-point arithmetic.
10. Posted financial documents will be immutable.
11. Critical mutations create append-only audit events.
12. Secrets and real production customer data never enter Git.
13. Schema changes are version-controlled migrations.

## Implemented database

### Tables

- `organizations`
- `organization_memberships`
- `items`
- `warehouses`
- `inventory_balances`
- `inventory_movements`
- `audit_events`

### Security / integrity

- roles: `owner`, `admin`, `staff`, `viewer`
- active/suspended memberships
- RLS on client-facing foundation tables
- `SECURITY DEFINER` helpers with fixed `search_path`
- cross-tenant foreign-key protection
- tenant reassignment protection
- direct client ledger writes denied
- movement/audit update and delete denied
- per-organization idempotency key
- locked inventory balance updates
- negative-stock protection

### Secure RPCs

- `create_organization(...)`
  - creates tenant + first owner atomically
  - writes audit event
- `post_inventory_movement(...)`
  - owner/admin/staff only
  - validates item + warehouse + tenant
  - locks balance
  - prevents oversell
  - handles retry/idempotency
  - writes ledger + balance + audit atomically

### Migrations

- `supabase/migrations/20261030000100_foundation.sql`
- `supabase/migrations/20261030000200_tenant_hardening.sql`

### pgTAP suites

- `001_foundation_structure.test.sql`
- `002_tenant_inventory_security.test.sql`
- `003_integrity_and_roles.test.sql`

Tests cover RLS, cross-tenant access, direct ledger bypass, stock posting, overselling, idempotency, immutability, multi-org row reassignment, viewer permissions and audit visibility.

## Implemented API

`apps/api`

- `GET /health`
- verified bearer JWT for `/v1/*`
- user-scoped Supabase client; normal requests do **not** use service-role credentials
- `GET /v1/me`
- `GET /v1/organizations`
- `POST /v1/inventory/movements`
- request IDs
- security headers
- restricted CORS
- non-leaking error responses
- DB error mapping for permission, inventory and idempotency conflicts

## Implemented shared contracts

`packages/contracts`

- Zod validation
- inventory movement enum aligned with DB
- decimal-string quantities/costs
- max 6 decimal places
- inbound positive / outbound negative
- zero rejected
- UUID and request-key validation

## Implemented web shell

`apps/web`

- React + Vite + TypeScript
- React Router protected routes
- Supabase browser session handling
- email/password sign-in
- bearer-token API client
- dashboard calling RLS-scoped `/v1/organizations`
- responsive navigation shell
- placeholders for Inventory / Invoices / Settings
- CSS design tokens reserved for future organization branding
- browser-safe `.env.example`
- web setup/security notes in `apps/web/README.md`

Current routes:

- `/login`
- `/`
- `/inventory`
- `/invoices`
- `/settings`

## CI status

### Database CI — GREEN

- Supabase local stack
- rebuild from migrations
- `supabase db lint`
- pgTAP tests
- clean shutdown

### Application CI — GREEN

- Node 24.22.2
- `npm ci`
- lockfile drift check
- strict TypeScript
- contracts tests
- API boundary tests
- web helper tests
- Worker dry-run build
- React/Vite production build

### CI hardening

- normal workflows use `contents: read`
- GitHub Actions are pinned to exact commit SHAs
- one-time write-enabled lockfile bootstrap workflow was removed after use
- Supabase CLI pinned to `2.122.0`

## Security reference

See `docs/SECURITY_MODEL.md`.

Production release still requires:

- browser E2E tests
- OWASP ZAP / security review
- dependency vulnerability review
- load + concurrency tests
- backup + restore drill
- production secret management
- MFA for privileged accounts
- monitoring + alerting

## V1 product scope

- Authentication
- Organizations + memberships
- Roles/permissions
- Products/items + categories/units
- Custom item fields
- Warehouses
- Stock ledger / adjustments / transfers
- Customers
- Suppliers
- Purchase receipts
- Sales invoices
- Payments
- GST/tax configuration
- PDF/print invoices
- Dashboard/reports
- Audit log
- CSV/Excel import/export

Later: quotations, orders, returns, credit/debit notes, serial/batch/expiry, barcode, GST e-invoicing/e-way bill, messaging automation, approvals, POS, accounting/GL, bank reconciliation, advanced analytics, offline/PWA, public API/webhooks.

## Customization rule

**Do not fork code per customer.**

Configuration should cover:

- custom fields
- required/optional fields
- dropdowns and validation
- branding/design tokens
- document templates
- numbering schemes
- role permissions
- enabled modules
- later workflows/automations

Use relational columns for core/query-critical data; controlled metadata/JSON only for tenant-specific extensions.

## India / GST direction

Support:

- GSTIN
- HSN/SAC
- CGST / SGST / IGST / Cess
- Place of Supply
- Reverse Charge
- B2B/B2C
- tax-inclusive/exclusive pricing
- financial-year numbering
- credit/debit notes
- future IRN / acknowledgement / QR / e-invoice integration

Re-verify official regulatory rules immediately before implementing/releasing regulatory integrations.

## Deployment direction

### Development / pilot

- Supabase free tier
- Cloudflare Workers / Static Assets free allowances where suitable
- Supabase Storage / R2 within free allowances

### Before business-critical production

- managed paid database/backups
- production domain/email
- secret manager
- monitoring + alerting
- restore drill
- load/capacity validation

## NEXT TASK — RESUME HERE

### Immediate

1. Implement **organization onboarding + active-organization context**.
2. Add API endpoint for organization creation using existing secure DB RPC.
3. If user has zero organizations, show onboarding instead of an empty dashboard.
4. Add organization switcher for users belonging to multiple organizations.
5. Keep organization ID explicit in UI state, but never rely on client-side tenant filtering for security.
6. Add tests for onboarding and tenant switching behavior.

### After organization context

7. Implement customers + suppliers schema/RLS/API/UI.
8. Then design invoices, tax snapshots, numbering and payments.
9. Add Playwright E2E before production deployment work.
10. Wire React static assets + API into the intended Cloudflare deployment topology.

## README update policy

Update after:

- architecture/security decisions
- major schema/module completion
- significant test failures and their fix
- deployment changes
- before ending substantial work
- when conversation context becomes large

Always update:

- Current status
- unresolved risks
- important decisions
- `NEXT TASK — RESUME HERE`

## Never commit

- Supabase service-role keys
- passwords/tokens
- credential-bearing DB URLs
- OAuth/SMTP/GST provider secrets
- private signing keys
- real production customer data
- real `.env` / `.dev.vars` files

Only commit safe templates such as `.env.example` / `.dev.vars.example`.
