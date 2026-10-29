# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. Start on free/low-cost infrastructure, keep security enforced in the database, and scale progressively without rewriting the core.

> **Resume rule:** Read this README first. Update it after major milestones, important design/security changes, and before ending substantial work.

## Current status

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work not merged yet
- Database foundation + tenant RLS: **implemented + CI green**
- Inventory ledger: **implemented + tested**
- API foundation: **implemented + CI green**
- React auth/application shell: **implemented + CI green**
- Organization onboarding/context: **implemented + CI green**
- Customer/supplier party master + addresses + tax registrations: **implemented + CI green**
- GST financial document core: **implemented + DB CI green**
- Financial document contracts + authenticated API mutations + list/detail reads: **implemented + application CI green**
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
| Financial documents | Drafts editable; issued documents immutable snapshots |
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
11. Issued financial documents and their lines/taxes are immutable.
12. Corrections to issued documents use cancellation or linked credit/debit notes rather than destructive edits.
13. Critical mutations create append-only audit events.
14. Secrets and real production customer data never enter Git.
15. Schema changes are version-controlled migrations.
16. Legal/tax snapshots on issued documents must not depend on mutable master data later.

## Implemented database

### Foundation / inventory

- `organizations`
- `organization_memberships`
- `items`
- `warehouses`
- `inventory_balances`
- `inventory_movements`
- `audit_events`

### Parties

- one reusable `parties` master
- `party_roles` for customer/supplier roles
- multiple `party_addresses`
- multiple `party_tax_registrations`
- archive lifecycle instead of destructive delete
- GSTIN structural validation; verification remains `unverified` until a trusted source confirms it
- party archive atomically archives active child addresses/tax registrations and clears default flags
- tenant-checked party search RPC

### Financial documents

- `financial_documents`
- `financial_document_lines`
- `financial_document_line_taxes`
- internal `financial_document_sequences`
- types: tax invoice, credit note, debit note
- lifecycle: draft -> issued -> cancelled
- financial-year-aware, row-locked sequence allocation
- serial number capped at 16 characters
- separate CGST / SGST / UTGST / IGST / CESS line tax components
- place-of-supply/supply-type fields
- issue-time validation prevents IGST on intra-State documents and CGST/SGST/UTGST on inter-State/export/SEZ documents
- issue-time totals calculated by PostgreSQL
- idempotent issue request key
- issued header/lines/taxes immutable
- credit/debit notes require a linked issued/cancelled tax invoice in the same tenant
- cancellation preserves issued number and records actor/reason
- internal sequence table is not readable by authenticated clients

### Security / integrity

- roles: `owner`, `admin`, `staff`, `viewer`
- active/suspended memberships
- RLS on client-facing tables
- `SECURITY DEFINER` helpers/RPCs use fixed `search_path`
- cross-tenant FK protection
- tenant reassignment protection
- direct client ledger/financial mutation denied
- movement/audit and issued-document immutability
- transactional row locking for stock and invoice number allocation
- append-only audit trail for critical mutations

### Secure RPCs

- `create_organization(...)`
- `post_inventory_movement(...)`
- party create/update/archive + address/tax-registration lifecycle RPCs
- `search_parties(...)`
- `create_financial_document_draft(...)`
- `upsert_financial_document_line(...)`
- `remove_financial_document_line(...)`
- `issue_financial_document(...)`
- `cancel_financial_document(...)`

### Migrations

- `20261030000100_foundation.sql`
- `20261030000200_tenant_hardening.sql`
- `20261030000300_parties.sql`
- `20261030000400_party_search.sql`
- `20261030000500_party_profiles.sql`
- `20261030000600_party_archive_cascade.sql`
- `20261030000700_financial_documents.sql`
- `20261030000800_financial_document_trigger_hardening.sql`

### pgTAP suites

- `001_foundation_structure.test.sql`
- `002_tenant_inventory_security.test.sql`
- `003_integrity_and_roles.test.sql`
- `004_parties_security.test.sql`
- `005_party_profiles_security.test.sql`
- `006_party_archive_cascade.test.sql`
- `007_financial_documents_security.test.sql`

The invoice suite contains 30 assertions covering RLS, direct-write denial, permissions, cross-tenant isolation, numbering, financial year, tax components/jurisdiction, totals, idempotent issue, immutable posting, cancellation, credit-note linkage and auditability.

## Implemented API

`apps/api`

- `GET /health`
- verified bearer JWT on `/v1/*`
- user-scoped Supabase client; normal requests do **not** use service-role credentials
- request IDs + secure headers + restricted CORS
- generic/non-leaking error responses

### Organizations / parties / inventory

- organization list/create
- party search/create/update/archive
- party profile address/tax-registration management
- inventory movement posting

### Financial documents

Mounted under `/v1/financial-documents` through `src/worker.ts` so it inherits the existing global JWT middleware.

- `GET /v1/financial-documents` — bounded tenant-scoped list with type/status filters
- `GET /v1/financial-documents/:documentId` — header + lines + line taxes
- `POST /v1/financial-documents` — create draft
- `POST /v1/financial-documents/:documentId/lines` — add/update draft line
- `POST /v1/financial-documents/:documentId/lines/:lineNumber/remove`
- `POST /v1/financial-documents/:documentId/issue`
- `POST /v1/financial-documents/:documentId/cancel`

Writes use audited database RPCs. Reads use the user-scoped client and normal RLS. User input cannot provide arbitrary PostgREST filter expressions.

## Implemented shared contracts

`packages/contracts`

- Zod validation
- exact decimal-string validation for money/quantity/tax values
- organization + party/profile validation
- GSTIN structural/state-code validation
- financial document create/line/issue/cancel validation
- bounded financial-document list/detail queries
- enum validation for document status/type, supply type and tax components

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
- secure organization creation
- active-organization provider/switcher
- accessible-org validation
- selected organization ID persisted only as non-secret UX state

**Important:** organization selection does not bypass or replace RLS.

### Party management

- customer/supplier list/search/create/archive
- party can hold both customer and supplier roles
- address create/edit/archive with billing/shipping/registered flags
- tax-registration create/edit/archive
- GSTIN normalization + structural validation
- visible verification state; no manual client-side “verify” control

### Current routes

- `/login`
- `/`
- `/customers`
- `/suppliers`
- `/inventory`
- `/invoices` — still placeholder; backend core is now ready
- `/settings`

## CI status

### Database CI — GREEN

- local Supabase stack
- rebuild from all migrations
- DB lint
- pgTAP tests 001–007
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
- temporary write-enabled workflows removed immediately after use
- Supabase CLI pinned to `2.122.0`

## GST / India decisions verified during invoice-core work

- invoice serials are modeled as consecutive per financial year/series, with the generated serial capped at 16 characters
- place of supply is retained because it determines intra-State versus inter-State tax treatment
- issued documents snapshot legal/tax/address information; master-data edits must not rewrite historical invoices
- credit/debit notes link to the original invoice rather than editing the issued invoice
- e-invoice/IRP is intentionally a later integration layer, not embedded into the core financial-document tables

Regulatory integrations must be re-verified against official GST/IRP rules immediately before release. Current research also identified time-bound IRP reporting/cancellation rules for applicable taxpayers, so provider integration must enforce the then-current official limits rather than hard-code assumptions prematurely.

## Security reference

See `docs/SECURITY_MODEL.md`.

Production still requires browser E2E tests, security review, dependency review, concurrency/load tests, backup/restore drill, production secret management, MFA for privileged accounts, monitoring and alerting.

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

Later: quotations/orders, returns, richer credit/debit-note workflows, serial/batch/expiry, barcode, GST e-invoice/e-way bill, messaging automation, approvals, POS, full accounting/GL, bank reconciliation, analytics, offline/PWA, public API/webhooks.

## Customization rule

**Do not fork code per customer.** Use configuration for custom fields, required/optional fields, dropdowns, branding, document templates, numbering schemes, permissions, enabled modules and later workflows/automations.

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

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

1. Add **organization seller/billing profiles** for legal name, GSTIN, registered address and state/registration context.
2. Restrict seller-profile mutation to owner/admin; staff may read/use profiles for invoicing.
3. Harden invoice draft creation so the database derives `supplier_snapshot` from a selected seller profile instead of trusting arbitrary client-supplied seller identity.
4. Add pgTAP adversarial tests for seller-profile permissions, GSTIN structure, defaults and invoice snapshot derivation.
5. Add seller-profile contracts/API/settings UI.
6. Replace `/invoices` placeholder with invoice list + draft editor using the selected seller profile and customer party profile.
7. Keep tax math authoritative in PostgreSQL at issue time; browser calculations are previews only.
8. Keep both CI pipelines green.

### After first invoice editor

9. Connect issued sales invoices to inventory posting with explicit transactional/idempotent rules.
10. Add payments/allocations.
11. Add PDF/print snapshot rendering.
12. Add Playwright E2E before production deployment work.
13. Wire React static assets + API into the intended Cloudflare production topology.
14. Add GST e-invoice/IRP adapter only after current applicability and reporting/cancellation windows are re-verified.

## README update policy

Update after architecture/security decisions, major module completion, significant failures/fixes, deployment changes, before stopping substantial work, and when conversation context becomes large.

Always update Current status, unresolved risks, important decisions and `NEXT TASK — RESUME HERE`.

## Never commit

- Supabase service-role keys
- passwords/tokens
- credential-bearing DB URLs
- OAuth/SMTP/GST provider secrets
- private signing keys
- real production customer data
- real `.env` / `.dev.vars` files

Only commit safe templates such as `.env.example` / `.dev.vars.example`.
