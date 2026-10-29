# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. Security and business invariants are enforced in PostgreSQL; the web/API layers remain tenant-scoped clients of that model.

> **Resume rule:** Read this README first. Update it after major milestones, security/data-model changes, and before ending substantial work.

## Current checkpoint

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work is not merged yet
- Database CI: **GREEN** — run `40976131112`
- Application CI: **GREEN** — run `40976059248`
- Production deployment: **not started**
- Production credentials/customer data: **not configured or committed**

## Implemented and validated

- Supabase/PostgreSQL foundation + tenant RLS
- organization onboarding + active-tenant UX
- immutable inventory movement ledger + transactional balances
- audited item and warehouse lifecycle RPCs
- operational Inventory web workspace
- atomic/idempotent warehouse transfers
- customer/supplier party master
- party addresses + tax registrations/GSTIN structure validation
- seller/legal billing profiles
- GST financial-document core
- PostgreSQL-derived seller/buyer/address/tax snapshots
- PostgreSQL-authoritative invoice line/tax arithmetic
- PostgreSQL-authoritative item snapshots
- financial-year/series invoice numbering + idempotent issue
- issued-document immutability + cancellation rules
- atomic full sales-invoice fulfilment from one warehouse
- immutable/idempotent customer payment receipts
- immutable payment allocations
- derived invoice payment balance/status
- atomic receipt + invoice-allocation flow
- Payments web workspace
- React auth shell + tenant switcher
- reproducible npm lockfile + read-only CI

## Architecture

| Layer | Decision |
|---|---|
| Product | Multi-tenant SaaS |
| Architecture | Modular monolith first |
| Web | React 19 + TypeScript + Vite + React Router |
| API | Hono + TypeScript on Cloudflare Workers |
| Database/Auth | Supabase PostgreSQL + Supabase Auth |
| Tenant isolation | PostgreSQL RLS |
| Inventory truth | Append-only stock movement ledger |
| Stock balance | Transactional cache with row locking |
| Financial documents | Drafts editable; issued documents immutable |
| Legal/tax identity | PostgreSQL-built immutable snapshots |
| Invoice item identity | PostgreSQL-built immutable item snapshots |
| Tax/money math | PostgreSQL `numeric`; decimal strings across JS boundaries |
| Payments | Immutable receipt + allocation ledgers |
| CI/CD | GitHub Actions |
| Node baseline | 24.22.2 LTS |

## Non-negotiable invariants

1. Every tenant-owned record is related to an organization.
2. PostgreSQL RLS is the tenant authorization boundary.
3. Client-selected organization state is UX only and never grants access.
4. `organization_id` cannot be silently reassigned between tenants.
5. Inventory movements are append-only; corrections use reversing movements.
6. Stock posting is transactional and locks the balance row.
7. Negative inventory is blocked unless the organization explicitly allows it.
8. Dangerous mutations use idempotency keys.
9. Money/tax/quantity logic does not use JS floating point as source of truth.
10. Issued financial documents, lines and taxes are immutable.
11. Issued-document corrections use cancellation/credit/debit workflows, not edits.
12. Critical mutations append audit events.
13. Secrets and real production customer data never enter Git.
14. Schema changes use unique version-controlled migrations.
15. Historical invoice snapshots never depend on later master-data edits.
16. Clients cannot provide authoritative seller/buyer/item snapshots or calculated tax values.
17. Payment receipts and allocations are immutable ledger records.
18. Payment allocation must match invoice customer/currency and cannot over-allocate.
19. Direct authenticated item/warehouse mutations are revoked; audited RPCs are required.
20. Items/warehouses with non-zero stock cannot be archived.

## Database

### Inventory

Core tables:

- `items`
- `warehouses`
- `inventory_balances`
- `inventory_movements`
- `audit_events`

`post_inventory_movement(...)` remains the stock-ledger write primitive. It enforces tenant access, active tracked items/warehouses, signed quantity rules, balance-row locking, negative-stock policy, idempotency and audit logging.

`20261030001800_inventory_master_workflows.sql` adds audited master-data RPCs:

- `create_item(...)`
- `update_item(...)`
- `archive_item(...)`
- `create_warehouse(...)`
- `update_warehouse(...)`
- `archive_warehouse(...)`
- `transfer_inventory(...)`

Rules:

- direct authenticated item/warehouse insert/update is revoked
- owner/admin/staff may manage items
- only owner/admin may manage warehouses
- viewers remain read-only
- inventory tracking cannot be disabled while stock remains
- item archive is blocked while any balance is non-zero
- warehouse archive is blocked while any balance is non-zero
- transfer posts `transfer_out` + `transfer_in` in one PostgreSQL transaction
- transfer movement keys are deterministic (`:out`, `:in`)
- insufficient source stock rolls back both sides

`20261030001900_inventory_transfer_audit_idempotency.sql` prevents duplicate high-level transfer audit events on retry.

### Parties / seller profiles

- reusable `parties` master with customer/supplier roles
- multiple addresses and tax registrations
- seller/legal billing profiles
- archive lifecycle rather than destructive delete
- GSTIN structural/state validation
- verification remains `unverified` until a trusted external source confirms it

### Financial documents

Supported: tax invoice, credit note, debit note.

Implemented:

- `draft -> issued -> cancelled`
- financial-year/series row-locked numbering
- CGST / SGST / UTGST / IGST / CESS components
- place-of-supply validation
- issue-time PostgreSQL totals
- immutable issued header/lines/taxes
- credit/debit linkage to original invoice
- PostgreSQL-built legal/address/tax/item snapshots
- browser item snapshot JSON is ignored

### Sales fulfilment

`20261030001400_sales_fulfillment.sql` implements full, one-warehouse sales fulfilment after invoice issue.

- stock-backed lines post atomically as `sale`
- deterministic movement keys prevent duplicates
- insufficient stock rolls back the entire fulfilment
- second fulfilment is rejected
- fulfilled invoice cancellation is blocked until a reversal workflow exists

Not yet implemented: partial/multi-warehouse fulfilment and returns/reversal.

### Customer payments

`20261030001500_customer_payments.sql` adds immutable receipts and allocations, idempotency, row locking, customer/currency matching, over-allocation protection and derived invoice balances.

`20261030001600_atomic_invoice_receipt.sql` adds atomic `record_and_allocate_invoice_payment(...)` so failed allocation cannot leave an orphan receipt.

Not yet implemented: payment reversal/refund/correction workflow.

## Migrations

1. `20261030000100_foundation.sql`
2. `20261030000200_tenant_hardening.sql`
3. `20261030000300_parties.sql`
4. `20261030000400_party_search.sql`
5. `20261030000500_party_profiles.sql`
6. `20261030000600_party_archive_cascade.sql`
7. `20261030000700_financial_documents.sql`
8. `20261030000800_financial_document_trigger_hardening.sql`
9. `20261030000900_organization_billing_profiles.sql`
10. `20261030001000_billing_profile_hardening.sql`
11. `20261030001100_financial_document_supplier_profiles.sql`
12. `20261030001200_financial_document_recipient_profiles.sql`
13. `20261030001300_financial_line_calculation.sql`
14. `20261030001400_sales_fulfillment.sql`
15. `20261030001500_customer_payments.sql`
16. `20261030001600_atomic_invoice_receipt.sql`
17. `20261030001700_financial_line_item_snapshot_hardening.sql`
18. `20261030001800_inventory_master_workflows.sql`
19. `20261030001900_inventory_transfer_audit_idempotency.sql`

Do not reuse an existing migration version.

## pgTAP regression suites

1. `001_foundation_structure.test.sql`
2. `002_tenant_inventory_security.test.sql`
3. `003_integrity_and_roles.test.sql`
4. `004_parties_security.test.sql`
5. `005_party_profiles_security.test.sql`
6. `006_party_archive_cascade.test.sql`
7. `007_financial_documents_security.test.sql`
8. `008_organization_billing_profiles.test.sql`
9. `009_sales_fulfillment.test.sql` — 19 assertions
10. `010_customer_payments.test.sql` — 22 assertions
11. `011_atomic_invoice_receipt.test.sql` — 8 assertions
12. `012_item_snapshot_hardening.test.sql` — 4 assertions
13. `013_inventory_master_workflows.test.sql` — 27 assertions

Database CI rebuilds the complete migration chain, lints the schema, runs suites `001–013`, and shuts Supabase down cleanly.

## API

Normal business requests use verified user JWTs with a user-scoped Supabase client; no service-role key is used.

Implemented domains:

- organizations
- parties/profiles
- seller billing profiles
- inventory
- financial documents
- sales fulfilment
- customer payments

### Inventory API

Mounted under `/v1/inventory`:

- `GET /items`
- `POST /items`
- `PATCH /items/:itemId`
- `POST /items/:itemId/archive`
- `GET /warehouses`
- `POST /warehouses`
- `PATCH /warehouses/:warehouseId`
- `POST /warehouses/:warehouseId/archive`
- `GET /balances`
- `GET /movements`
- `POST /transfers`
- existing `POST /v1/inventory/movements` remains the manual ledger-posting endpoint

Boundary validation rejects malformed IDs, numeric transfer quantities and same-warehouse transfers before database access.

### Customer-payment API

Mounted at `/v1/customer-payments`:

- list/create receipts
- allocate an existing receipt
- read invoice payment balance/status
- atomically record + allocate an invoice receipt

## Shared contracts

`packages/contracts` validates exact decimal strings, organizations, parties, GST/seller profiles, invoices/taxes, fulfilment, customer payments and Inventory workspace mutations/queries.

## Web application

Routes:

- `/login`
- `/`
- `/customers`
- `/suppliers`
- `/inventory`
- `/invoices`
- `/payments`
- `/settings`

### Inventory workspace

`/inventory` now provides:

- item list/create/edit/archive
- warehouse list/create/edit/archive
- tracked vs service/non-stock items
- stock balance view by item/warehouse
- manual receipt / adjustment-in / adjustment-out posting
- atomic warehouse transfer form
- recent inventory movement history
- UOM-aware balance/movement display

Database rules, not UI state, determine whether actions are permitted.

### Invoice workspace

- seller/customer/address/GST selection
- inventory or service lines
- UOM prefill from item master
- PostgreSQL-calculated taxes/totals
- issue/cancel
- immutable issued detail
- warehouse fulfilment for stock-backed invoices

### Payments workspace

- issued invoice list
- total / allocated / balance due
- unpaid / part-paid / paid status
- receipt entry and atomic allocation
- recent customer receipts

## CI / validation

### Database CI — GREEN

Run `40976131112`:

- Supabase startup: passed
- migration rebuild through `20261030001900`: passed
- schema lint: passed
- pgTAP suites `001–013`: passed
- clean shutdown: passed

### Application CI — GREEN

Run `40976059248`:

- `npm ci`: passed
- lockfile drift check: passed
- strict TypeScript: passed
- contracts/API/web tests: passed
- Cloudflare Worker production build: passed
- React/Vite production build: passed

## Remaining V1 gaps

High priority:

1. **Payment corrections** — explicit immutable reversal/refund workflow.
2. **Sales returns / stock reversals** — return inventory movements + financial correction linkage.
3. **PDF/print invoice generation** from immutable issued snapshots/totals.
4. **Credit/debit note web workflow** — backend linkage exists; complete user-facing flow.
5. **Partial and multi-warehouse fulfilment**.
6. **Purchase receipts / supplier-side stock intake workflow** beyond manual stock receipt.
7. Dashboard/reporting, audit-log viewer and CSV/Excel import/export.
8. Browser E2E/Playwright coverage.
9. Production deployment, secrets, backups/restore drill, monitoring, MFA and security review.

## Next engineering task

**Implement immutable payment reversal/refund and sales-return workflows.**

Recommended order:

1. reversal ledger model for customer payments/allocations
2. idempotent audited reversal RPCs; never update/delete original receipt/allocation rows
3. invoice balance calculation including reversals
4. sales-return inventory flow using reversing/`return_in` movements
5. link financial credit-note workflow to returned quantities without rewriting the original invoice
6. API + Payments/Invoices UI for corrections
7. pgTAP adversarial tests for double reversal, over-reversal, wrong customer/currency and concurrent retries

After that: PDF/print invoice output, partial/multi-warehouse fulfilment, purchase workflow, E2E tests and production hardening.

## Customization rule

**Do not fork code per customer.** Use configuration for custom fields, required/optional fields, dropdowns, branding, document templates, numbering schemes, permissions, enabled modules and later workflows/automations.

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

## Security reference

See `docs/SECURITY_MODEL.md`.

Production still requires browser E2E tests, dependency/security review, concurrency/load tests, backup/restore validation, production secret management, privileged-account MFA, monitoring and alerting.
