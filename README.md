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
- Seller/legal billing profiles: **implemented + tested**
- GST financial document core: **implemented + DB CI green**
- Profile-derived seller/buyer invoice snapshots: **implemented + tested**
- PostgreSQL-authoritative invoice line/tax arithmetic: **implemented + tested**
- Financial document API list/detail/create/line/issue/cancel: **implemented + application validation green**
- Seller settings page: **implemented**
- First tax-invoice web workspace: **implemented**
- Atomic full sales-invoice stock fulfilment: **implemented + CI green**
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
| Legal identities | Seller + buyer snapshots derived from tenant-owned profile IDs in PostgreSQL |
| Tax math | PostgreSQL `numeric`; browser calculations are preview-only |
| Numeric transport | Decimal strings across JS boundaries |
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
10. Money/tax/quantity logic never relies on binary floating point as the source of truth.
11. Issued financial documents and their lines/taxes are immutable.
12. Corrections to issued documents use cancellation or linked credit/debit notes rather than destructive edits.
13. Critical mutations create append-only audit events.
14. Secrets and real production customer data never enter Git.
15. Schema changes are version-controlled migrations.
16. Issued legal/tax snapshots must not depend on later master-data edits.
17. Authenticated clients cannot supply free-form seller/buyer legal snapshots for invoice creation.
18. Authenticated clients cannot supply authoritative taxable values or tax amounts.

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

### Seller / organization billing profiles

- `organization_billing_profiles`
- legal name, trade name, GSTIN, registered address/state/postcode
- one active default seller profile per organization
- owner/admin-only mutation; staff/viewer may read via normal membership RLS
- first active profile becomes default automatically
- changing GSTIN resets verification status to `unverified`
- GSTIN structure/state-code consistency enforced in both contracts and PostgreSQL
- seller snapshot helper is internal and not client executable
- archive lifecycle; no destructive client delete

### Financial documents

- `financial_documents`
- `financial_document_lines`
- `financial_document_line_taxes`
- internal `financial_document_sequences`
- types: tax invoice, credit note, debit note
- lifecycle: draft -> issued -> cancelled
- financial-year-aware, row-locked sequence allocation
- serial number capped at 16 characters
- separate CGST / SGST / UTGST / IGST / CESS components
- place-of-supply/supply-type fields
- issue-time validation prevents IGST on intra-State documents and CGST/SGST/UTGST on inter-State/export/SEZ documents
- issue-time totals calculated by PostgreSQL
- idempotent issue request key
- issued header/lines/taxes immutable
- credit/debit notes require a linked issued/cancelled tax invoice in the same tenant
- cancellation preserves issued number and records actor/reason
- internal sequence table is not readable by authenticated clients

### Invoice identity hardening

Financial-document drafts bind to exact master-data IDs:

- seller profile: `supplier_profile_id`
- customer party: `recipient_party_id`
- billing address: `billing_address_id`
- shipping address: `shipping_address_id`
- optional customer tax registration: `recipient_tax_registration_id`

PostgreSQL constructs immutable `supplier_snapshot`, `bill_to_snapshot`, and `ship_to_snapshot` JSON from those tenant-owned active records. Composite foreign keys prevent cross-party/cross-tenant address or tax-registration substitution.

Legacy authenticated draft functions that accepted arbitrary legal snapshot JSON are revoked.

### Invoice arithmetic hardening

Authenticated clients submit only:

- quantity
- unit price
- discount
- tax component + tax rate

PostgreSQL derives:

- gross line value
- taxable line value
- each tax amount
- document subtotal/tax totals/grand total at issue

The older line RPC that accepted client-supplied taxable value/tax amount is revoked for authenticated users.

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

### Current secure RPCs

- `create_organization(...)`
- `post_inventory_movement(...)`
- party create/update/archive + address/tax-registration lifecycle RPCs
- `search_parties(...)`
- seller-profile create/update/archive RPCs
- `create_financial_document_draft_from_profiles(...)`
- `upsert_financial_document_line_calculated(...)`
- `remove_financial_document_line(...)`
- `issue_financial_document(...)`
- `cancel_financial_document(...)`

Deprecated authenticated paths intentionally revoked:

- `create_financial_document_draft(...)`
- `create_financial_document_draft_from_profile(...)`
- `upsert_financial_document_line(...)`

### Migrations

- `20261030000100_foundation.sql`
- `20261030000200_tenant_hardening.sql`
- `20261030000300_parties.sql`
- `20261030000400_party_search.sql`
- `20261030000500_party_profiles.sql`
- `20261030000600_party_archive_cascade.sql`
- `20261030000700_financial_documents.sql`
- `20261030000800_financial_document_trigger_hardening.sql`
- `20261030000900_organization_billing_profiles.sql`
- `20261030001000_billing_profile_hardening.sql`
- `20261030001100_financial_document_supplier_profiles.sql`
- `20261030001200_financial_document_recipient_profiles.sql`
- `20261030001300_financial_line_calculation.sql`
- `20261030001400_sales_fulfillment.sql`

### pgTAP suites

- `001_foundation_structure.test.sql`
- `002_tenant_inventory_security.test.sql`
- `003_integrity_and_roles.test.sql`
- `004_parties_security.test.sql`
- `005_party_profiles_security.test.sql`
- `006_party_archive_cascade.test.sql`
- `007_financial_documents_security.test.sql` — 37 assertions
- `008_organization_billing_profiles.test.sql` — 22 assertions
- `009_sales_fulfillment.test.sql` — 19 assertions

The financial-document regression covers RLS, direct-write denial, legacy-RPC denial, seller/buyer profile snapshot derivation, PostgreSQL-calculated line/tax values, numbering, financial year, tax jurisdiction, totals, idempotent issue, immutable posting, cancellation, credit-note linkage, tenant isolation and auditability.

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

### Seller billing profiles

Mounted at `/v1/organization-billing-profiles`:

- list active/archived seller profiles
- create
- update
- archive

Reads use RLS. Mutation permission is enforced in PostgreSQL as owner/admin only.

### Financial documents

Mounted under `/v1/financial-documents` through `src/worker.ts` so it inherits the existing global JWT middleware.

- `GET /v1/financial-documents` — bounded tenant-scoped list with type/status filters
- `GET /v1/financial-documents/:documentId` — header + lines + line taxes
- `POST /v1/financial-documents` — creates draft from seller/customer/address/tax-registration IDs
- `POST /v1/financial-documents/:documentId/lines` — adds/updates a draft line; server calculates taxable/tax values
- `POST /v1/financial-documents/:documentId/lines/:lineNumber/remove`
- `POST /v1/financial-documents/:documentId/issue`
- `POST /v1/financial-documents/:documentId/cancel`

Writes use audited database RPCs. Reads use the user-scoped client and normal RLS. User input cannot provide arbitrary PostgREST filters or authoritative legal/tax snapshots.

## Implemented shared contracts

`packages/contracts`

- Zod validation
- exact decimal-string validation for money/quantity/tax values
- organization + party/profile validation
- GSTIN structural/state-code validation
- seller billing-profile validation without client verification controls
- financial document profile-ID validation
- invoice line contracts exclude authoritative taxable values/tax amounts
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

### Seller settings

`/settings` now provides:

- active seller profile list
- create/edit/archive
- default seller profile selection
- GSTIN/state-code validation
- verification-state display
- explicit note that GSTIN editing resets verification

Server/database permissions remain authoritative; UI visibility does not grant owner/admin rights.

### Invoice workspace

`/invoices` now provides the first tax-invoice workflow:

- financial-document list
- seller profile selection
- customer selection
- billing/shipping-address selection
- optional customer GST registration selection
- document date, series, supply type, place of supply, reverse charge and notes
- draft creation using profile IDs only
- draft detail with immutable snapshots returned by API
- line entry: description, HSN/SAC, quantity, UOM, unit price, discount and GST rates
- intra-State CGST/SGST or inter-State IGST inputs
- server-calculated taxable/tax values returned after save
- issue with an idempotency key
- cancellation with a reason
- no line editing after issue

The browser never sends authoritative taxable values or tax amounts. Invoice lines can now bind to active inventory items, preserving an item snapshot. Issued stock-backed invoices can be fulfilled from an active warehouse; the fulfilment posts all stock-backed lines atomically and is idempotent.

### Current routes

- `/login`
- `/`
- `/customers`
- `/suppliers`
- `/inventory` — placeholder
- `/invoices` — working first tax-invoice workspace
- `/settings` — seller/legal billing profiles

## Validation status

### Database CI — GREEN

- local Supabase stack
- rebuild from migrations through `20261030001300`
- DB lint
- pgTAP tests 001–008
- financial-document regression includes 37 assertions
- seller billing-profile regression includes 22 assertions
- clean shutdown

### Application validation — GREEN

- Node 24.22.2 baseline
- `npm ci`
- lockfile drift protection in GitHub CI
- strict TypeScript
- contracts/API/web unit tests
- Worker production build
- React/Vite production build
- current branch independently validated with locked install + typecheck + tests + builds after invoice-workspace integration

### CI hardening

- normal workflows use `contents: read`
- GitHub Actions pinned to exact commit SHAs
- temporary write-enabled maintenance workflows are removed immediately after use
- Supabase CLI pinned to `2.122.0`

## GST / India decisions verified during invoice work

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

## Known remaining gaps

- Financial invoice issue and physical stock fulfilment are intentionally separate business events. V1 supports one full atomic fulfilment per issued tax invoice; partial fulfilment and returns/reversals are pending.
- Invoice UI currently focuses on tax invoices; credit/debit-note backend exists but richer UI is pending.
- Line entry is currently free-form item description/HSN rather than a full stock-item picker.
- Draft header/profile selections are not yet editable after draft creation; create a new draft if the header is wrong.
- GSTIN verification is structural only until a trusted verifier is integrated.
- Place of supply remains explicit user input because GST place-of-supply rules can be transaction-specific.
- Payments, PDF/print rendering, returns, purchase receipts, E2E tests and deployment are pending.
- IRP/e-invoice integration is pending and must use then-current official applicability/reporting/cancellation rules.

## NEXT TASK — RESUME HERE

### Immediate

1. Add **payments + allocations** against issued invoices with exact decimal arithmetic, tenant isolation, immutable payment history and over-allocation protection.
2. Add invoice balance/status reads (unpaid/part-paid/paid) derived from allocations.
3. Add payment API + invoice UI for recording and allocating receipts.
4. Add PDF/print rendering from immutable issued snapshots.
5. Add returns/stock-reversal workflow before allowing fulfilled invoices to be financially cancelled.
6. Add partial fulfilment only after the full-fulfilment invariant is stable.
7. Add Playwright E2E for organization -> customer -> seller profile -> draft -> stock line -> issue -> fulfil -> payment.
8. Keep database and application gates green after every milestone.

### After that

9. Purchase receipts / supplier flow into stock.
10. Returns and richer credit/debit-note workflows.
11. Dashboard/reporting and CSV/Excel import/export.
12. Wire React Static Assets + API into the intended Cloudflare production topology.
13. Add production secrets, monitoring, backup/restore drills and load testing.
14. Add GST e-invoice/IRP adapter only after current rules are re-verified.

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
