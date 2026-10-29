# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. Start on free/low-cost infrastructure, keep security enforced in the database, and scale progressively without rewriting the core.

> **Resume rule:** Read this README first. Update it after major milestones, important design/security changes, and before ending substantial work.

## Current status

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work not merged yet
- Database foundation: **implemented + CI green**
- RLS / tenant isolation: **implemented + adversarially tested**
- Inventory ledger: **implemented + tested**
- API foundation: **implemented + CI green**
- React auth/application shell: **implemented + CI green**
- Organization onboarding/context: **implemented + CI green**
- Reproducible npm lockfile: **committed; CI uses `npm ci`**
- Production deployment: not started
- Real production credentials: not configured or committed

## User requirements

- Complete inventory management + invoicing system
- Customizable per business without separate code forks
- Start as close to free as practical
- Clear path to large scale
- Production-grade security, testing, backups and observability
- Research current best practices before major decisions
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
3. Client-selected organization state is UX only; it never grants access.
4. `organization_id` cannot be silently changed between tenants.
5. Inventory movements are append-only.
6. Stock corrections use reversing/correcting movements.
7. Stock posting is transactional and locks the balance row.
8. Negative inventory is blocked unless explicitly enabled.
9. Dangerous mutations use idempotency protection.
10. Money/tax/quantity logic never relies on binary floating point.
11. Posted financial documents will be immutable.
12. Critical mutations create append-only audit events.
13. Secrets and real production customer data never enter Git.
14. Schema changes are version-controlled migrations.

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
- cross-tenant FK protection
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
  - validates tenant/item/warehouse
  - locks balance
  - prevents oversell
  - handles idempotent retry
  - writes ledger + balance + audit atomically

### Migrations

- `supabase/migrations/20261030000100_foundation.sql`
- `supabase/migrations/20261030000200_tenant_hardening.sql`

### pgTAP suites

- `001_foundation_structure.test.sql`
- `002_tenant_inventory_security.test.sql`
- `003_integrity_and_roles.test.sql`

Tests cover RLS, cross-tenant access, direct ledger bypass, posting, overselling, idempotency, immutability, tenant reassignment, viewer permissions and audit visibility.

## Implemented API

`apps/api`

- `GET /health`
- verified bearer JWT on `/v1/*`
- user-scoped Supabase client; normal requests do **not** use service-role credentials
- `GET /v1/me`
- `GET /v1/organizations`
- `POST /v1/organizations`
- `POST /v1/inventory/movements`
- request IDs + secure headers + restricted CORS
- generic/non-leaking error responses
- database error mapping for permissions/inventory/idempotency/slug conflicts

## Implemented shared contracts

`packages/contracts`

- Zod validation
- inventory movement validation with exact decimal strings
- organization creation validation
- organization slug normalization
- ISO-style country/currency normalization

## Implemented web

`apps/web`

### Auth/application shell

- Supabase browser session handling
- email/password sign-in
- protected routes
- bearer-token API client
- responsive app shell
- browser-safe env template
- branding-ready CSS design tokens

### Organization context

- zero-organization onboarding flow
- secure organization creation through API -> database RPC
- organization slug suggestion + validation
- active-organization provider
- organization switcher for multi-org users
- accessible-org validation before selection
- selected organization ID persisted only as non-secret UX state
- fallback to first accessible organization if saved ID is stale/inaccessible

**Important:** organization selection does not bypass or replace RLS.

### Current routes

- `/login`
- `/`
- `/inventory`
- `/invoices`
- `/settings`

## CI status

### Database CI — GREEN

- local Supabase stack
- rebuild from migrations
- DB lint
- pgTAP tests
- clean shutdown

### Application CI — GREEN

- Node 24.22.2
- `npm ci`
- lockfile drift check
- strict TypeScript
- contracts/API/web tests
- Worker dry-run build
- React/Vite production build

### CI hardening

- normal workflows use `contents: read`
- GitHub Actions pinned to exact commit SHAs
- temporary write-enabled lockfile workflows removed immediately after use
- Supabase CLI pinned to `2.122.0`

## Security reference

See `docs/SECURITY_MODEL.md`.

Production still requires:

- browser E2E tests
- OWASP ZAP/security review
- dependency vulnerability review
- load + concurrency testing
- backup + restore drill
- production secret management
- MFA for privileged accounts
- monitoring + alerting

## V1 scope

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

Later: quotations/orders, returns, credit/debit notes, serial/batch/expiry, barcode, GST e-invoice/e-way bill, messaging automation, approvals, POS, full accounting/GL, bank reconciliation, analytics, offline/PWA, public API/webhooks.

## Customization rule

**Do not fork code per customer.**

Use configuration for:

- custom fields
- required/optional fields
- dropdowns + validation
- branding
- document templates
- numbering schemes
- permissions
- enabled modules
- later workflows/automations

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

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

1. Research current official GST/customer-identification requirements relevant to party master data.
2. Implement **customers + suppliers** schema with tenant RLS and auditability.
3. Treat party master records as archivable, not destructively deletable once referenced.
4. Support billing/shipping addresses and nullable GSTIN without overfitting India-only data into the core.
5. Add shared validation + API endpoints.
6. Add customer/supplier UI inside active organization context.
7. Add adversarial cross-tenant tests and application tests.
8. Keep both CI pipelines green.

### After parties

9. Design invoices + invoice-line snapshots + tax engine + numbering + payments.
10. Add Playwright E2E before production deployment work.
11. Wire React static assets + API into the intended Cloudflare deployment topology.

## README update policy

Update after architecture/security decisions, major module completion, significant failures/fixes, deployment changes, before stopping substantial work, and when conversation context becomes large.

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
