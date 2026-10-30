# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS. PostgreSQL is the security and business-invariant boundary; React/API layers remain tenant-scoped clients of that model.

> **Resume rule:** Read this README and `docs/CURRENT_CHECKPOINT_2026-10-30.md` first. Update them after major milestones, security/data-model changes, and before ending substantial work.

## Current checkpoint

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Main branch: foundation work is **not merged yet**
- Database CI: **GREEN** — run `40985726873`
- Application CI: **GREEN** — run `40985559971`
- Database migrations: through `20261030002900_operational_dashboard.sql`
- pgTAP suites: `001–020`
- Production deployment: **not started**
- Production credentials/customer data: **not configured or committed**

## Implemented and validated

### Platform + tenancy

- Supabase/PostgreSQL foundation
- Supabase Auth
- organization onboarding + tenant switcher
- PostgreSQL RLS tenant isolation
- roles: owner/admin/staff/viewer
- immutable audit events
- idempotent mutation patterns

### Inventory

- item + warehouse masters
- append-only inventory movement ledger
- transactional inventory balances
- negative-stock protection
- audited item/warehouse lifecycle workflows
- atomic warehouse transfers
- Inventory web workspace

### Parties + legal/tax profiles

- reusable customer/supplier party master
- customer/supplier roles
- multiple addresses
- multiple tax registrations
- GSTIN structural/state validation
- seller/legal billing profiles
- archive lifecycle instead of destructive deletes

### GST financial documents

- tax invoices
- credit notes
- debit notes
- financial-year/series numbering
- PostgreSQL-authoritative line/tax arithmetic
- CGST / SGST / UTGST / IGST / CESS
- immutable issued/cancelled documents
- PostgreSQL-generated seller/buyer/address/item/tax snapshots
- general commercial credit/debit adjustments
- return-linked credit notes
- one shared active credit ceiling per original invoice line
- cancellation rules for linked corrections
- authenticated A4 print view + browser **Print / Save PDF**

### Sales fulfillment + returns

- multiple immutable fulfillment postings per invoice
- exact partial fulfillment quantities
- one warehouse per fulfillment posting
- aggregate multi-warehouse completion
- row-lock serialization against over-fulfillment
- derived status: `not_applicable`, `unfulfilled`, `partial`, `fulfilled`
- immutable partial sales returns
- returns restore stock to the exact original shipping warehouse
- physical return and financial credit remain separate ledgers

### Customer payments

- immutable receipts + allocations
- atomic receipt + invoice allocation
- over-allocation protection
- customer/currency matching
- partial allocation reversals
- partial payment refunds
- reversal-aware invoice balance/status
- Payments correction UI

### Supplier purchase receiving

- immutable `purchase_receipts` + `purchase_receipt_lines`
- one receiving warehouse per receipt
- multiple receipt lines
- exact decimal received quantity + unit cost
- immutable supplier/item snapshots
- tenant-scoped receipt-line → inventory-movement linkage
- atomic multi-line stock posting
- transactional per-organization receipt/GRN numbering
- idempotency + audit
- full rollback if any line fails
- `/purchases` workspace
- **no supplier invoice/AP side effect**

### Operational visibility

- PostgreSQL operational dashboard summary
- currency-separated financial KPIs
- inventory position/count KPIs without cross-UOM quantity sums
- purchase receiving counts
- fulfillment status counts
- activity/audit counts
- read-only audit-log API + `/audit` workspace
- `/` operational dashboard
- `/v1/operations` API routes
- Purchase Receipts + Audit Log sidebar navigation

## Architecture

| Layer | Decision |
|---|---|
| Product | Multi-tenant SaaS |
| Architecture | Modular monolith first |
| Web | React 19 + TypeScript + Vite + React Router |
| API | Hono + TypeScript on Cloudflare Workers |
| Database/Auth | Supabase PostgreSQL + Supabase Auth |
| Tenant isolation | PostgreSQL RLS |
| Inventory truth | Append-only inventory movements |
| Financial documents | Draft tax invoices editable; issued docs immutable |
| Money/tax/quantity | PostgreSQL `numeric`; decimal strings across JS boundaries |
| Payments | Immutable receipt/allocation/reversal ledgers |
| Fulfillment | Multiple immutable one-warehouse postings per invoice |
| Returns | Immutable physical return ledger tied to exact fulfillment |
| Purchase receiving | Immutable physical receipt ledger; AP remains separate |
| Reporting | Server/database-derived, currency/UOM safe |
| Document output | Authenticated print route; browser Print / Save PDF first |
| CI/CD | GitHub Actions |
| Node baseline | 24.22.2 LTS |

## Non-negotiable invariants

1. Every tenant-owned record belongs to an organization.
2. PostgreSQL RLS is the tenant authorization boundary.
3. Client-selected organization state is UX only and never grants access.
4. `organization_id` cannot be silently reassigned.
5. Inventory movements are append-only; corrections use reversing movements.
6. Stock posting is transactional and locks balance/capacity rows as required.
7. Negative inventory is blocked unless explicitly allowed by organization policy.
8. Dangerous mutations use idempotency keys.
9. Money/tax/quantity truth never uses JS floating point.
10. Issued financial documents/lines/taxes are immutable.
11. Corrections use cancellation/credit/debit/return/reversal workflows, not edits.
12. Critical mutations append audit events.
13. Secrets and real production customer data never enter Git.
14. Schema changes use unique version-controlled migrations.
15. Historical documents never depend on later master-data changes.
16. Clients cannot provide authoritative legal/item snapshots or calculated tax values.
17. Payment receipts, allocations and reversals are immutable ledgers.
18. Payment allocations must match invoice customer/currency and cannot over-allocate.
19. Refund/reversal amounts cannot exceed remaining reversible value.
20. Items/warehouses with non-zero stock cannot be archived.
21. Aggregate fulfillment cannot exceed original invoice-line quantity.
22. Returns always reference an exact fulfillment and restore that warehouse.
23. Aggregate return quantity cannot exceed that fulfillment-line quantity.
24. Physical returns and financial credits are separate immutable ledgers.
25. Active commercial + return-linked credits share one taxable-value ceiling per original invoice line.
26. Purchase receipts are physical logistics only; they do not create AP/payables.
27. Purchase receipt rows and their inventory movement links are immutable.
28. Dashboard financial totals are never summed across currencies.
29. Inventory reporting never sums unrelated item/UOM quantities into one stock total.
30. Audit viewer is read-only and remains governed by tenant/RBAC database security.

## Database milestones

### Core migrations

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
25. `20261030002500_partial_multiwarehouse_fulfillment.sql`
26. `20261030002600_partial_fulfillment_wrapper_hardening.sql`
27. `20261030002700_purchase_receipts.sql`
28. `20261030002800_purchase_receipt_error_hardening.sql`
29. `20261030002900_operational_dashboard.sql`

Do not reuse an existing migration version.

### pgTAP

- suites `001–020` are green
- `018_partial_multiwarehouse_fulfillment.test.sql` — 36 assertions
- `019_purchase_receipts.test.sql` — 40 assertions
- `020_operational_dashboard.test.sql` — 18 assertions

## API domains

Normal business requests use verified user JWTs with a user-scoped Supabase client. No service-role key is used for ordinary business operations.

Implemented:

- organizations
- parties/profiles
- seller billing profiles
- inventory
- financial documents
- financial adjustments
- sales fulfillment + returns + return credits
- customer payments + reversals/refunds
- purchase receipts
- operational dashboard + audit history

## Web routes

- `/login`
- `/` — Operational Dashboard
- `/customers`
- `/suppliers`
- `/inventory`
- `/purchases`
- `/invoices`
- `/payments`
- `/audit`
- `/settings`
- `/financial-documents/:documentId/print?organizationId=...`

## CI / validation

### Database CI — GREEN

Run `40985726873`:

- reduced Postgres-only Supabase startup: passed
- migration rebuild through `20261030002900`: passed
- schema lint: passed
- pgTAP suites `001–020`: passed
- clean shutdown: passed

### Application CI — GREEN

Run `40985559971`:

- `npm ci`: passed
- lockfile drift check: passed
- strict TypeScript: passed
- contracts/API/web tests: passed
- Cloudflare Worker production build: passed
- React/Vite production build: passed

## Remaining V1 gaps

High priority:

1. **Secure CSV/Excel import/export.**
2. **Browser E2E / Playwright coverage** for the critical business paths.
3. Production deployment + secret management.
4. Backups + tested restore drill.
5. Monitoring/alerting + error tracking.
6. Privileged-account MFA + production security review.
7. Dependency/security scanning + load/concurrency tests.
8. Trusted GST registration verification integration.
9. Supplier invoice / Accounts Payable workflow remains a later accounting module and must link to—not rewrite—purchase receipts.

## Next engineering task — resume here

**Build secure bulk import/export, then browser E2E coverage.**

Recommended import/export order:

1. versioned CSV schema for Items, Customers, Suppliers and Opening Stock
2. dry-run validation endpoint before mutation
3. explicit row-level errors with row number + field + error code
4. server-authoritative tenant IDs, snapshots, roles, taxes and calculations
5. idempotent import batch IDs + audit events
6. atomic batch semantics unless a workflow explicitly supports partial acceptance
7. stable export column order + explicit currency/UOM semantics
8. CSV/formula-injection protection for spreadsheet-compatible exports
9. `.xlsx` support only after CSV contracts are stable and parser/license review is complete
10. Playwright E2E after import/export contracts stabilize

## Customization rule

**Do not fork code per customer.** Use configuration for custom fields, required/optional fields, dropdowns, branding, document templates, numbering schemes, permissions, enabled modules and later workflows/automations.

Use relational columns for core/query-critical data; controlled JSON/metadata only for tenant-specific extensions.

## Security reference

See `docs/SECURITY_MODEL.md` and `docs/OPERATIONAL_VISIBILITY.md`.

Production still requires browser E2E tests, dependency/security review, concurrency/load tests, backup/restore validation, production secret management, privileged-account MFA, monitoring and alerting.
