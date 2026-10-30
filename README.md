# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. PostgreSQL is the security and business-invariant boundary; the React/API layers remain tenant-scoped clients of that model.

> **Resume rule:** Read this README first. Update it after major milestones, security/data-model changes, and before ending substantial work.

## Current checkpoint

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work is not merged yet
- Database CI: **GREEN** — run `40978061028`
- Application CI: **GREEN** — run `40978822277`
- Production deployment: **not started**
- Production credentials/customer data: **not configured or committed**

## Implemented and validated

- Supabase/PostgreSQL foundation + tenant RLS
- organization onboarding + active-tenant UX
- immutable inventory movement ledger + transactional balances
- audited item/warehouse lifecycle RPCs
- Inventory web workspace + atomic warehouse transfers
- customer/supplier party master
- party addresses + tax registrations/GSTIN structural validation
- seller/legal billing profiles
- GST financial-document core
- PostgreSQL-derived seller/buyer/address/tax/item snapshots
- PostgreSQL-authoritative invoice line/tax arithmetic
- financial-year/series numbering + idempotent issue
- issued-document immutability + cancellation rules
- atomic one-warehouse sales fulfilment
- immutable customer receipts + allocations
- partial/idempotent allocation reversals and payment refunds
- reversal-aware invoice balances/status
- immutable partial sales returns using `return_in`
- over-return protection + return-aware invoice cancellation
- return-linked issued credit notes derived from original invoice snapshots/rates
- over-credit protection + cancelled-credit eligibility release
- Payments correction UI
- Invoice fulfilment / return / return-credit UI
- authenticated A4 print view for issued/cancelled tax invoices, credit notes and debit notes
- browser **Print / Save PDF** workflow from immutable document snapshots/totals
- linked-original-document reference on correction-document print output
- print-model unit tests and print-safe CSS
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
| Financial documents | Drafts editable; issued documents immutable |
| Legal/item identity | PostgreSQL-built immutable snapshots |
| Tax/money math | PostgreSQL `numeric`; decimal strings across JS boundaries |
| Payments | Immutable receipt/allocation/reversal ledgers |
| Returns | Immutable physical-return ledger + separate immutable financial-credit linkage |
| Document output | Authenticated print route; browser Print / Save PDF first |
| CI/CD | GitHub Actions |
| Node baseline | 24.22.2 LTS |

## Non-negotiable invariants

1. Every tenant-owned record belongs to an organization.
2. PostgreSQL RLS is the tenant authorization boundary.
3. Client-selected organization state is UX only and never grants access.
4. `organization_id` cannot be silently reassigned between tenants.
5. Inventory movements are append-only; corrections use reversing movements.
6. Stock posting is transactional and locks balance rows.
7. Negative inventory is blocked unless the organization explicitly allows it.
8. Dangerous mutations use idempotency keys.
9. Money/tax/quantity source of truth never uses JS floating point.
10. Issued financial documents, lines and taxes are immutable.
11. Issued-document corrections use cancellation/credit/debit workflows, not edits.
12. Critical mutations append audit events.
13. Secrets and real production customer data never enter Git.
14. Schema changes use unique version-controlled migrations.
15. Historical documents never depend on later master-data edits.
16. Clients cannot provide authoritative legal/item snapshots or calculated tax values.
17. Payment receipts, allocations and reversals are immutable ledgers.
18. Payment allocation must match invoice customer/currency and cannot over-allocate.
19. A payment refund cannot consume value still net-allocated to invoices.
20. A payment/allocation cannot be reversed beyond its remaining reversible amount.
21. Direct authenticated item/warehouse mutations are revoked; audited RPCs are required.
22. Items/warehouses with non-zero stock cannot be archived.
23. Sales returns never rewrite fulfilment rows; stock restoration uses `return_in`.
24. Aggregate return quantity cannot exceed original fulfilled quantity.
25. A fulfilled invoice cannot be cancelled while fulfilled stock remains unreturned.
26. Physical returns and financial credits remain separate immutable ledgers with explicit linkage.
27. Return-linked credit notes derive seller/buyer/item snapshots, price, discount and tax rates from the original issued invoice.
28. Active credited quantity cannot exceed returned quantity.
29. Cancelling a return-linked credit note releases financial-credit eligibility only; stock-return history remains unchanged.
30. Printable financial documents render only immutable issued/cancelled document data; draft documents are not printable.

## Database milestones

### Inventory

Core tables: `items`, `warehouses`, `inventory_balances`, `inventory_movements`, `audit_events`.

`post_inventory_movement(...)` remains the stock-ledger write primitive with tenant access, active item/warehouse validation, signed quantities, row locking, negative-stock policy, idempotency and audit logging.

Inventory master workflows include audited item/warehouse create/update/archive plus atomic `transfer_inventory(...)`. Direct authenticated master writes are revoked.

### Parties and legal profiles

- reusable party master with customer/supplier roles
- multiple addresses and tax registrations
- seller/legal billing profiles
- archive lifecycle instead of destructive delete
- GSTIN structure/state validation
- verification remains `unverified` until a trusted external source confirms it

### Financial documents

Supported: tax invoice, credit note, debit note.

Implemented:

- `draft -> issued -> cancelled`
- financial-year/series row-locked numbering
- CGST / SGST / UTGST / IGST / CESS
- place-of-supply validation
- issue-time PostgreSQL totals
- immutable issued header/lines/taxes
- linked credit/debit documents
- PostgreSQL-built legal/address/tax/item snapshots
- browser item snapshot JSON ignored

`20261030002200_sales_return_credit_notes.sql` adds immutable physical-return → financial-credit linkage:

- return-credit links are tenant-scoped and immutable
- credit notes link to the original tax invoice
- lines copy original issued snapshots, price, UOM, HSN/SAC and tax rates
- partial credit derives taxable/discount values proportionally in PostgreSQL
- credit note creation + issue is atomic
- exact credited quantity links back to the immutable return line
- active credited quantity cannot exceed returned quantity
- cancelled credits release eligibility for replacement corrections
- retries are idempotent and accepted credits are audited

### Sales fulfilment and returns

`20261030001400_sales_fulfillment.sql` implements atomic full fulfilment from one warehouse.

`20261030002100_sales_returns.sql` implements immutable partial returns:

- exact fulfilment-line references
- `return_in` to original fulfilment warehouse
- partial/multiple returns
- over-return prevention
- idempotency + audit
- immutable return rows
- invoice cancellation blocked until all fulfilled stock is returned

Not yet implemented: partial/multi-warehouse outbound fulfilment.

### Customer payments

- immutable receipts and allocations
- atomic receipt + invoice allocation
- customer/currency matching
- over-allocation protection
- immutable partial allocation reversals
- immutable partial customer-payment refunds
- net/reversal-aware invoice balance/status
- idempotency + audit

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
20. `20261030002000_payment_reversals.sql`
21. `20261030002100_sales_returns.sql`
22. `20261030002200_sales_return_credit_notes.sql`

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
14. `014_payment_reversals.test.sql` — 20 assertions
15. `015_sales_returns.test.sql` — 16 assertions
16. `016_sales_return_credit_notes.test.sql` — 25 assertions

Database CI rebuilds migrations `001–022`, lints the schema, runs suites `001–016`, and shuts Supabase down cleanly.

## API domains

Normal business requests use verified user JWTs with a user-scoped Supabase client; no service-role key is used.

Implemented:

- organizations
- parties/profiles
- seller billing profiles
- inventory
- financial documents
- sales fulfilment + returns + return credits
- customer payments + reversals

Return-credit API supports atomic issued credit notes from exact returned quantities plus linkage/status history.

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
- `/financial-documents/:documentId/print?organizationId=...` — authenticated print-only view

### Invoice workspace

- seller/customer/address/GST selection
- inventory or service lines
- PostgreSQL-calculated taxes/totals
- issue/cancel
- immutable issued detail
- warehouse fulfilment
- partial sales returns
- return-credit issue/status history
- **Print / Save PDF** for issued and cancelled documents, including service/non-stock documents

Print output includes:

- correct Tax Invoice / Credit Note / Debit Note label
- document number/date/supply/POS/reverse-charge
- original invoice reference for linked correction documents
- supplier, bill-to and ship-to immutable snapshot data
- GSTIN, HSN/SAC, quantities, rates, discounts, taxable values and per-line taxes
- PostgreSQL-authoritative document totals
- cancelled banner/reason when applicable
- A4 print CSS, repeated table header and print-safe page breaks

The print route refuses drafts and never reconstructs legal/tax values from current master data.

### Payments workspace

- issued invoice list
- total / net allocated / balance due
- unpaid / part-paid / paid
- receipt + atomic allocation
- allocation reversal history and controls
- receipt refund/reversal controls

## CI / validation

### Database CI — GREEN

Run `40978061028`:

- Supabase startup: passed
- migration rebuild through `20261030002200`: passed
- schema lint: passed
- pgTAP suites `001–016`: passed
- clean shutdown: passed

### Application CI — GREEN

Run `40978822277`:

- `npm ci`: passed
- lockfile drift check: passed
- strict TypeScript: passed
- contracts/API/web tests, including print-model tests: passed
- Cloudflare Worker production build: passed
- React/Vite production build: passed

## Remaining V1 gaps

High priority:

1. **General credit/debit note workflow** — return-linked credits are complete; add an authoritative UI/RPC for non-return commercial adjustments linked to issued invoices.
2. **Partial and multi-warehouse outbound fulfilment**.
3. **Purchase receipts / supplier-side stock intake workflow** beyond manual stock receipt.
4. Dashboard/reporting, audit-log viewer and CSV/Excel import/export.
5. Browser E2E/Playwright coverage, especially print/return/payment flows.
6. Production deployment, secrets, backups/restore drill, monitoring, MFA and security review.

## Next engineering task

**Implement a general non-return credit/debit-note workflow linked to an issued tax invoice.**

Recommended order:

1. create an authoritative PostgreSQL adjustment-draft RPC from the original issued invoice snapshots rather than current party master data
2. define how adjustment lines reference/copy original invoice lines and how quantity/value limits are enforced
3. preserve original GST treatment while allowing legitimate commercial credit/debit adjustments
4. add idempotency and audit semantics
5. expose API contracts/endpoints
6. add invoice-workspace UI for new credit/debit adjustments
7. reuse the existing immutable issue/cancel and print infrastructure
8. add pgTAP tests for wrong tenant/invoice, over-adjustment, retries, cancellation and immutable snapshots

After that: partial/multi-warehouse fulfilment, purchase workflow, dashboards/import-export, E2E tests and production hardening.

## Customization rule

**Do not fork code per customer.** Use configuration for custom fields, required/optional fields, dropdowns, branding, document templates, numbering schemes, permissions, enabled modules and later workflows/automations.

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

## Security reference

See `docs/SECURITY_MODEL.md`.

Production still requires browser E2E tests, dependency/security review, concurrency/load tests, backup/restore validation, production secret management, privileged-account MFA, monitoring and alerting.
