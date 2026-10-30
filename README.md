# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. PostgreSQL is the security and business-invariant boundary; React/API layers remain tenant-scoped clients of that model.

> **Resume rule:** Read this README first. Update it after major milestones, security/data-model changes, and before ending substantial work.

## Current checkpoint

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work is not merged yet
- Database CI: **GREEN** — run `40981550173`
- Application CI: **GREEN** — run `40981215073`
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
- GST tax invoices, credit notes and debit notes
- PostgreSQL-derived seller/buyer/address/tax/item snapshots
- PostgreSQL-authoritative invoice line/tax arithmetic
- financial-year/series numbering + idempotent issue
- immutable issued/cancelled financial documents
- atomic one-warehouse full sales fulfilment
- immutable customer receipts + allocations
- partial/idempotent allocation reversals + payment refunds
- reversal-aware invoice balances/status
- immutable partial sales returns with `return_in`
- return-linked issued credit notes
- general non-return commercial credit/debit notes linked to issued invoices
- one shared active credit ceiling across return credits + commercial credits
- row-lock serialization of competing credits on the same original invoice line
- generic authenticated financial-document draft path restricted to tax invoices only
- original invoice cancellation blocked while active linked credit/debit notes exist
- Payments correction UI
- Invoice fulfilment / return / return-credit UI
- Invoice commercial credit/debit adjustment UI
- authenticated A4 print view for issued/cancelled tax invoices, credit notes and debit notes
- browser **Print / Save PDF** from immutable document snapshots/totals
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
| Financial documents | Draft tax invoices editable; issued docs immutable |
| Legal/item identity | PostgreSQL-built immutable snapshots |
| Tax/money math | PostgreSQL `numeric`; decimal strings across JS boundaries |
| Payments | Immutable receipt/allocation/reversal ledgers |
| Returns | Immutable physical-return ledger + separate financial-credit linkage |
| Commercial corrections | Controlled issued credit/debit-note workflow from original invoice |
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
27. Return-linked credit notes derive snapshots/prices/GST from the original issued invoice.
28. Commercial credit/debit notes also derive snapshots/item identity/GST from the original invoice.
29. Generic tenant-facing draft creation cannot create arbitrary credit/debit notes.
30. Active commercial + return-linked credits share one taxable-value ceiling per original invoice line.
31. Competing credits serialize by locking the original invoice line before consuming credit capacity.
32. Cancelling an issued credit note releases only financial-credit capacity; original invoice/stock history remains unchanged.
33. An original tax invoice cannot be cancelled while any active linked credit/debit note exists.
34. Printable financial documents use immutable issued/cancelled document data; drafts are not printable.

## Database milestones

### Inventory

Core tables: `items`, `warehouses`, `inventory_balances`, `inventory_movements`, `audit_events`.

`post_inventory_movement(...)` remains the stock-ledger primitive with tenant validation, row locking, negative-stock policy, idempotency and audit logging. Audited master workflows cover item/warehouse create/update/archive and atomic warehouse transfers.

### Parties and legal profiles

- reusable customer/supplier party master
- multiple addresses and tax registrations
- seller/legal billing profiles
- archive lifecycle instead of destructive delete
- GSTIN structure/state validation
- trusted GST verification integration still pending

### Financial documents

Supported: `tax_invoice`, `credit_note`, `debit_note`.

Implemented:

- draft tax invoice → issued → cancelled
- financial-year/series row-locked numbering
- CGST / SGST / UTGST / IGST / CESS
- place-of-supply validation
- issue-time PostgreSQL totals
- immutable issued headers/lines/taxes
- linked correction documents
- PostgreSQL-built immutable legal/address/tax/item snapshots

`20261030002200_sales_return_credit_notes.sql` implements physical-return → issued credit-note linkage.

`20261030002300_financial_adjustments.sql` implements general commercial adjustments:

- immutable `financial_adjustments` + `financial_adjustment_lines`
- atomic `issue_invoice_adjustment(...)`
- original issued invoice + exact original-line references required
- exact decimal `basisQuantity` + `taxableAdjustment` at JS boundaries
- seller/buyer/item/HSN/UOM/GST copied from immutable original invoice
- credit notes reduce taxable value; debit notes increase it
- active credit cannot exceed original taxable value
- commercial credits and return-linked credits share the same ceiling
- generic profile-based draft RPC is tax-invoice-only
- original invoice cancellation is blocked while active correction docs exist
- accepted adjustments are idempotent and audited

`20261030002400_financial_adjustment_concurrency.sql` locks the original invoice line before shared credit-capacity checks, preventing concurrent over-credit across commercial and return-credit workflows.

### Sales fulfilment and returns

`20261030001400_sales_fulfillment.sql` currently implements one immutable, full, one-warehouse fulfilment per invoice.

`20261030002100_sales_returns.sql` implements immutable partial returns:

- exact fulfilment-line references
- `return_in` to the original fulfilment warehouse
- multiple returns per fulfilment
- over-return prevention
- idempotency + audit
- invoice cancellation blocked until all fulfilled stock is returned

**Next:** evolve fulfilment to multiple immutable fulfilments per invoice, one warehouse per fulfilment, with partial line quantities and aggregate over-fulfilment protection.

### Customer payments

- immutable receipts + allocations
- atomic receipt + invoice allocation
- customer/currency matching
- over-allocation protection
- immutable partial allocation reversals
- immutable partial payment refunds
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
23. `20261030002300_financial_adjustments.sql`
24. `20261030002400_financial_adjustment_concurrency.sql`

Do not reuse migration versions.

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
17. `017_financial_adjustments.test.sql` — 37 assertions

Database CI rebuilds migrations `001–024`, lints the schema, runs suites `001–017`, and shuts Supabase down cleanly.

## API domains

Normal business requests use verified user JWTs with a user-scoped Supabase client; no service-role key is used.

Implemented:

- organizations
- parties/profiles
- seller billing profiles
- inventory
- financial documents
- `/v1/financial-adjustments`
- sales fulfilment + returns + return credits
- customer payments + reversals

`/v1/financial-adjustments` supports:

- atomic issue of a controlled commercial credit/debit note
- exact-decimal original-line adjustment inputs
- tenant/role/idempotency/credit-limit errors mapped at the API boundary
- correction history including line linkage and document totals/status

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
- `/financial-documents/:documentId/print?organizationId=...`

### Invoice workspace

- tax-invoice draft creation
- seller/customer/address/GST selection
- inventory/service lines
- PostgreSQL-calculated taxes/totals
- issue/cancel
- immutable issued detail
- warehouse fulfilment
- partial sales returns
- return-credit issue/status history
- general commercial credit/debit issue/history
- commercial adjustment per original invoice line using basis quantity + taxable adjustment
- Print / Save PDF for issued/cancelled tax invoices, credit notes and debit notes

The browser never supplies correction GST rates, tax amounts, legal snapshots or item snapshots.

### Payments workspace

- issued invoice list
- total / net allocated / balance due
- unpaid / part-paid / paid
- receipt + atomic allocation
- allocation reversal history and controls
- receipt refund/reversal controls

## CI / validation

### Database CI — GREEN

Run `40981550173`:

- Supabase startup: passed
- migration rebuild through `20261030002400`: passed
- schema lint: passed
- pgTAP suites `001–017`: passed
- clean shutdown: passed

### Application CI — GREEN

Run `40981215073`:

- `npm ci`: passed
- lockfile drift check: passed
- strict TypeScript: passed
- contracts/API/web tests: passed
- Cloudflare Worker production build: passed
- React/Vite production build: passed

## Remaining V1 gaps

High priority:

1. **Partial and multi-warehouse outbound fulfilment**.
2. **Purchase receipts / supplier-side stock intake workflow** beyond manual stock receipt.
3. Dashboard/reporting, audit-log viewer and CSV/Excel import/export.
4. Browser E2E/Playwright coverage for invoice, correction, print, return and payment flows.
5. Production deployment, secrets, backups/restore drill, monitoring, MFA and security review.

## Next engineering task

**Implement partial and multi-warehouse outbound fulfilment without rewriting existing fulfilment/return history.**

Recommended design:

1. remove the one-fulfilment-per-invoice uniqueness restriction for new postings
2. keep each fulfilment immutable and tied to exactly one warehouse
3. allow exact partial quantities per original stock-backed invoice line
4. lock original invoice lines before checking aggregate fulfilled quantity
5. prevent aggregate fulfilment across all warehouses from exceeding invoiced quantity
6. retain returns against a specific fulfilment so stock always returns to that fulfilment's warehouse
7. make invoice fulfilment status derived: unfulfilled / partial / fulfilled
8. keep legacy full-one-warehouse RPC as a compatibility wrapper over remaining quantities where practical
9. update API/contracts/UI and add adversarial pgTAP tests for concurrency, cross-warehouse partials, over-fulfilment and returns

After that: purchase workflow, dashboards/import-export, E2E tests and production hardening.

## Customization rule

**Do not fork code per customer.** Use configuration for custom fields, required/optional fields, dropdowns, branding, document templates, numbering schemes, permissions, enabled modules and later workflows/automations.

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

## Security reference

See `docs/SECURITY_MODEL.md`.

Production still requires browser E2E tests, dependency/security review, concurrency/load tests, backup/restore validation, production secret management, privileged-account MFA, monitoring and alerting.
