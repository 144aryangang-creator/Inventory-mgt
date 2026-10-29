# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. Security and business invariants are enforced in PostgreSQL; the web/API layers remain tenant-scoped clients of that model.

> **Resume rule:** Read this README first. Update it after major milestones, security/data-model changes, and before ending substantial work.

## Current checkpoint

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work is not merged yet
- Database CI: **GREEN** — run `40975060189`
- Application CI: **GREEN** — run `40975283477`
- Production deployment: **not started**
- Production credentials/customer data: **not configured or committed**

### Implemented and validated

- Supabase/PostgreSQL foundation + tenant RLS
- organization onboarding + active-tenant UX
- immutable inventory movement ledger + transactional balances
- customer/supplier party master
- party addresses + tax registrations/GSTIN structure validation
- seller/legal billing profiles
- GST financial-document core
- PostgreSQL-derived seller/buyer/address/tax snapshots
- PostgreSQL-authoritative invoice line/tax arithmetic
- inventory-item selection on invoice lines
- PostgreSQL-authoritative item snapshots; browser snapshot JSON is ignored
- financial-year/series invoice numbering + idempotent issue
- issued-document immutability + cancellation rules
- atomic full sales-invoice fulfilment from one warehouse
- immutable/idempotent customer payment receipts
- immutable payment allocations
- derived invoice payment balance/status
- atomic “record receipt + allocate to invoice” database/API path
- customer Payments web workspace
- React auth shell + tenant switcher
- customer/supplier/profile/settings/invoice/payment application surfaces
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
| Scale path | indexes/pooling/queues first; split services only when justified |

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
14. Schema changes are version-controlled migrations with unique versions.
15. Historical invoice snapshots never depend on later master-data edits.
16. Authenticated clients cannot provide authoritative seller/buyer snapshots.
17. Authenticated clients cannot provide authoritative item snapshots.
18. Authenticated clients cannot provide authoritative taxable values/tax amounts.
19. Payment receipts and allocations are immutable ledger records.
20. Payment allocation must match invoice customer/currency and cannot over-allocate.

## Database

### Foundation / inventory

- `organizations`
- `organization_memberships`
- `items`
- `warehouses`
- `inventory_balances`
- `inventory_movements`
- `audit_events`

Inventory writes use `post_inventory_movement(...)` with row locking, deterministic/idempotent request keys, exact decimal quantities and negative-stock protection.

### Parties / tax profiles

- reusable `parties` master
- `party_roles` (`customer`, `supplier`)
- multiple `party_addresses`
- multiple `party_tax_registrations`
- `organization_billing_profiles`
- archive lifecycle rather than destructive client delete
- one active default billing/shipping/tax/seller profile where applicable
- GSTIN structural/state-code validation
- verification remains `unverified` until a trusted external verification source confirms it
- party archive cascades active profile records to archived state

### Financial documents

Core tables:

- `financial_documents`
- `financial_document_lines`
- `financial_document_line_taxes`
- internal `financial_document_sequences`

Supported document types: tax invoice, credit note, debit note.

Implemented rules:

- lifecycle `draft -> issued -> cancelled`
- financial-year-aware row-locked number allocation
- generated serial capped at 16 characters
- separate CGST / SGST / UTGST / IGST / CESS components
- place-of-supply and supply-type validation
- issue-time PostgreSQL totals
- idempotent issue request key
- immutable issued header/lines/taxes
- credit/debit note linkage to original tax invoice
- cancellation preserves the issued number and records actor/reason
- seller/customer/address/GST records referenced by tenant-owned IDs
- PostgreSQL constructs immutable seller/bill-to/ship-to snapshots
- PostgreSQL calculates gross/taxable/tax values
- selected item IDs are resolved by PostgreSQL into immutable item snapshots
- browser-supplied `item_snapshot` is accepted only for backward signature compatibility and is ignored

### Sales fulfilment

`20261030001400_sales_fulfillment.sql` adds immutable sales fulfilment records.

Current V1 behavior:

- fulfilment is separate from invoice issue
- only an issued invoice can be fulfilled
- one active warehouse is selected for the fulfilment
- all stock-backed invoice lines are posted atomically
- inventory movement type is `sale`
- deterministic/idempotent movement keys prevent duplicate stock posting
- insufficient stock rolls back the whole fulfilment
- a second fulfilment with another key is rejected
- fulfilled invoice cancellation is blocked until an explicit stock-reversal workflow exists

**Not yet implemented:** partial/multi-warehouse fulfilment and returns/reversal workflow.

### Customer payments

`20261030001500_customer_payments.sql` adds:

- `customer_payments`
- `payment_allocations`
- immutable ledger triggers
- RLS read access; writes only through audited RPCs
- idempotent payment and allocation request keys
- customer/currency matching
- payment/invoice row locking
- payment remaining-balance validation
- invoice remaining-balance validation
- cancellation blocking when allocations exist
- `invoice_payment_balance(...)` returning `grand_total`, `allocated_total`, `balance_due`, `payment_status`

`20261030001600_atomic_invoice_receipt.sql` adds `record_and_allocate_invoice_payment(...)`, so the normal “receive money against this invoice” path creates the receipt and allocation in one PostgreSQL transaction. If allocation fails, no orphan receipt remains.

**Not yet implemented:** payment reversal/refund/correction workflow.

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

Migration versions are currently unique; do not reuse an existing timestamp/version.

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

Current database CI rebuilds the complete migration chain, lints the schema, runs suites `001–012`, and shuts Supabase down cleanly.

## API

`apps/api` uses verified bearer JWTs and a user-scoped Supabase client. Normal business requests do **not** use service-role credentials.

Implemented areas:

- organizations
- customer/supplier parties + profiles
- seller billing profiles
- inventory references/movements
- financial documents
- sales fulfilment
- customer payments

### Financial-document API

- `GET /v1/financial-documents`
- `GET /v1/financial-documents/:documentId`
- `POST /v1/financial-documents`
- `POST /v1/financial-documents/:documentId/lines`
- `POST /v1/financial-documents/:documentId/lines/:lineNumber/remove`
- `POST /v1/financial-documents/:documentId/issue`
- `POST /v1/financial-documents/:documentId/cancel`

### Sales fulfilment API

- fulfilment route calls the audited/idempotent database fulfilment RPC
- inventory item references expose `base_uom`, `track_inventory` and active item identity
- warehouse references remain tenant-scoped through RLS

### Customer-payment API

Mounted at `/v1/customer-payments`:

- `GET /v1/customer-payments` — tenant/customer-scoped receipt list
- `POST /v1/customer-payments` — record an immutable receipt
- `POST /v1/customer-payments/:paymentId/allocations` — allocate an existing receipt
- `GET /v1/customer-payments/invoice/:documentId/balance` — derived invoice payment balance/status
- `POST /v1/customer-payments/invoice/:documentId/receipt` — atomically record and allocate a receipt to the invoice

The atomic receipt endpoint is covered by API boundary validation and delegates transactionality to PostgreSQL.

## Shared contracts

`packages/contracts` provides Zod validation for:

- exact decimal strings
- organizations
- parties/profiles
- GSTIN structure/state matching
- seller billing profiles
- financial documents
- invoice lines/taxes
- sales fulfilment
- customer receipts/allocations
- atomic invoice receipt input

The public invoice-line contract does not accept authoritative legal/tax/item snapshots or calculated taxable/tax values.

## Web application

### Routes

- `/login`
- `/` — dashboard/onboarding
- `/customers`
- `/suppliers`
- `/inventory` — still a placeholder UI
- `/invoices`
- `/payments`
- `/settings`

### Invoice workspace

`/invoices` provides:

- seller profile selection
- customer + billing/shipping/GST selection
- invoice date/series/supply/place-of-supply/reverse-charge/notes
- draft creation from master-data IDs
- inventory-item or service line entry
- item UOM prefill from `base_uom`
- HSN/SAC, quantity, unit price, discount and GST rate entry
- PostgreSQL-calculated taxable/tax amounts
- issue with idempotency key
- cancellation with reason
- immutable issued detail
- warehouse fulfilment for stock-backed issued invoices

### Payments workspace

`/payments` provides:

- issued tax-invoice list
- selected invoice/customer detail
- live invoice total / allocated / balance-due values
- `unpaid` / `part_paid` / `paid` status
- receipt date, amount, method, reference and notes
- atomic “record and apply receipt” action
- recent customer receipt list

Receipt/allocation transactionality remains in PostgreSQL, not the browser.

### Other implemented web areas

- Supabase auth/session handling
- protected routes
- tenant switcher
- customer/supplier create/search/archive
- party address/GST profile management
- seller/legal profile settings
- responsive shell and branding design tokens

## CI / validation

### Database CI — GREEN

Run `40975060189`:

- Supabase startup: passed
- complete migration rebuild through `20261030001700`: passed
- schema lint: passed
- pgTAP suites `001–012`: passed
- clean shutdown: passed

### Application CI — GREEN

Run `40975283477`:

- Node 24 locked install (`npm ci`): passed
- lockfile drift check: passed
- strict TypeScript: passed
- contracts/API/web unit tests: passed
- Cloudflare Worker production build: passed
- React/Vite production build: passed

### CI hardening

- normal workflows use `contents: read`
- GitHub Actions pinned to commit SHAs
- Supabase CLI pinned to `2.122.0`
- temporary write-enabled maintenance workflows are removed after use

## GST / India design notes

- invoice numbers are consecutive per configured financial year/series and capped to the required serial length in the model
- place of supply is persisted because it determines intra-State vs inter-State tax treatment
- issued legal/tax/address/item identity is snapshotted and must not change with later master edits
- credit/debit notes reference the original invoice rather than rewriting it
- IRP/e-invoice/e-way-bill is a later integration layer, not embedded into the core ledger

Re-verify current GST/IRP rules against official sources immediately before production release; reporting/cancellation eligibility and time windows can change.

## Remaining V1 gaps

High priority:

1. **Inventory web workspace** — item/warehouse/balance/movement UX; database foundation already exists.
2. **Payment corrections** — explicit reversal/refund workflow; never edit/delete receipts or allocations.
3. **Sales returns / stock reversals** — return inventory movements and financial correction linkage.
4. **Partial and multi-warehouse fulfilment** — current fulfilment is one full atomic posting.
5. **PDF/print invoice generation** — render from immutable issued snapshots/totals.
6. **Credit/debit note web workflow** — backend linkage exists; complete user-facing flow.
7. **Purchase receipts / supplier-side stock intake UX**.
8. Dashboard/reporting, audit-log viewer and CSV/Excel import/export.
9. Browser E2E/Playwright coverage for critical flows.
10. Production deployment, secrets, backups/restore drill, monitoring, MFA and security review.

## Next engineering task

**Build the real Inventory workspace before adding more accounting surface.**

Recommended next sequence:

1. item master list/create/edit/archive
2. warehouse list/create/edit/archive
3. stock balance view by item/warehouse
4. manual receipt/adjustment/transfer UI using existing secure ledger RPC
5. inventory movement history with reference links
6. tests for tenant isolation, invalid quantities, duplicate request keys and negative-stock UX

After that: payment reversal + sales return workflow, PDF/print invoice output, then partial/multi-warehouse fulfilment.

## V1 scope

- Authentication
- Organizations + memberships
- Roles/permissions
- Products/items + categories/units
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

Later: quotations/orders, advanced returns, serial/batch/expiry, barcode, GST e-invoice/e-way bill, messaging automation, approvals, POS, accounting/GL, bank reconciliation, analytics, offline/PWA and public API/webhooks.

## Customization rule

**Do not fork code per customer.** Use configuration for custom fields, required/optional fields, dropdowns, branding, document templates, numbering schemes, permissions, enabled modules and later workflows/automations.

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

## Security reference

See `docs/SECURITY_MODEL.md`.

Production still requires browser E2E tests, dependency/security review, concurrency/load tests, backup/restore validation, production secret management, privileged-account MFA, monitoring and alerting.
