# Inventory Management + Invoicing SaaS

Configurable multi-tenant inventory + invoicing SaaS designed to start on free/low-cost infrastructure and scale without rewriting the core.

## PROJECT HANDOFF — READ THIS FIRST

Use this README as the persistent project memory / resume point.

### Current status

- Repository: `144aryangang-creator/Inventory-mgt`
- Working branch: `foundation/bootstrap`
- Project stage: architecture + production foundation
- UI implementation: not started
- Database implementation: next
- Production deployment: not started

### User requirements

- Complete inventory management + invoicing solution
- Must be customizable to different businesses/users
- Start as close to free as practical
- Architecture must have a clear path to large scale
- Production-grade security and testing required
- Research current best practices before important architecture decisions
- Prefer concise pointers/checklists rather than long explanations
- Keep this README updated as the project evolves so work can resume from here

### Architecture decisions already made

- Product model: multi-tenant SaaS
- Initial architecture: modular monolith
- Frontend: React + TypeScript
- API/application layer: TypeScript + Cloudflare Workers
- Database/Auth: Supabase PostgreSQL + Supabase Auth
- Tenant isolation: PostgreSQL Row Level Security (RLS)
- File/archive storage: Supabase Storage initially; Cloudflare R2 where useful
- CI/CD: GitHub Actions
- Database/source-of-truth approach: PostgreSQL
- Inventory source of truth: immutable stock movement ledger
- Money/taxes: exact decimal database types; never floating point
- Posted financial/inventory documents: immutable; corrections through reversal/credit/return flows
- Historical invoices: store customer/item/tax snapshots so old invoices never change when master data changes
- Scaling strategy: keep modular monolith until measured scale justifies service extraction

### Critical invariants

1. Every tenant-owned business record carries an `organization_id` or equivalent tenant relationship.
2. Tenant isolation must be enforced in PostgreSQL RLS, not only application filters.
3. Inventory balances must be derived from / reconcilable to an immutable movement ledger.
4. Inventory posting must use database transactions and concurrency protection.
5. Financial values use exact decimal/numeric types.
6. Posted invoices and stock documents are never silently edited.
7. Critical mutations create audit events.
8. Mutating APIs should support idempotency to prevent duplicate invoices/payments/stock movements.
9. Secrets and production credentials must never be committed to Git.
10. Schema changes must be version-controlled migrations.

## Product scope

### V1

- Authentication
- Organizations / tenants
- Users
- Roles + permissions
- Products/items
- Categories / units
- Custom item fields
- Warehouses
- Inventory ledger
- Stock adjustments
- Stock transfers
- Customers
- Suppliers
- Purchase receipts
- Sales invoices
- Payments
- GST/tax configuration
- PDF/print invoices
- Basic dashboard
- Reports
- Audit log
- CSV/Excel import/export

### Later modules

- Quotations
- Sales orders
- Purchase orders
- Returns
- Credit/debit notes
- Serial number tracking
- Batch/expiry tracking
- Barcode workflows
- GST e-invoicing / IRP integration
- E-way bill integration
- Email/WhatsApp/SMS automation
- Approval workflows
- POS
- General ledger/accounting
- Bank reconciliation
- Advanced analytics
- Offline/PWA workflows
- Public API + webhooks

## Customization model

Do NOT fork code per customer.

Use configuration for:

- custom fields
- required/optional fields
- field types
- dropdown options
- validation rules
- invoice templates
- branding
- numbering schemes
- role permissions
- enabled modules
- workflows/automations later

Prefer normal relational columns for core/query-critical fields and controlled JSON/metadata only for tenant-specific extensions.

## Planned stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript |
| API | TypeScript on Cloudflare Workers |
| Database | PostgreSQL / Supabase |
| Authentication | Supabase Auth |
| Authorization | RBAC + PostgreSQL RLS |
| Storage | Supabase Storage / Cloudflare R2 |
| CI/CD | GitHub Actions |
| DB tests | pgTAP |
| Unit tests | Vitest |
| Browser E2E | Playwright |
| Load tests | k6 |
| Security testing | OWASP ZAP + OWASP ASVS checklist |

## Target repository layout

```text
app/
modules/
supabase/
  migrations/
  seed.sql
  tests/
tests/
  unit/
  integration/
  security/
  e2e/
docs/
.github/
  workflows/
```

## Database domains planned

- `organizations`
- `organization_members`
- `roles`
- `permissions`
- `branches`
- `customers`
- `suppliers`
- `items`
- `item_variants`
- `item_units`
- `price_lists`
- `tax_codes`
- `warehouses`
- `warehouse_locations`
- `inventory_movements`
- `inventory_balances`
- `inventory_reservations`
- `serial_numbers`
- `batches`
- `quotations`
- `quotation_lines`
- `sales_orders`
- `sales_order_lines`
- `invoices`
- `invoice_lines`
- `credit_notes`
- `credit_note_lines`
- `payments`
- `payment_allocations`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`
- `custom_field_definitions`
- `custom_views`
- `document_templates`
- `number_sequences`
- `audit_events`
- `outbox_events`
- `idempotency_keys`

## Security baseline

- PostgreSQL RLS on tenant-owned tables
- RBAC for business permissions
- Server-side validation for all writes
- Least-privilege database/API access
- MFA support for privileged accounts
- Secure session handling
- Rate limiting
- Input validation + output encoding
- CSP/XSS/CSRF protections where applicable
- File type/size/access validation
- Immutable audit trail for sensitive operations
- Dependency/security scanning in CI
- Explicit adversarial tenant-isolation tests
- Backup + restore testing before production

## Mandatory security tests

Examples that must fail:

- Organization A reads Organization B customer
- Organization A updates Organization B invoice
- Organization A downloads Organization B attachment
- guessed UUID bypasses tenant isolation
- non-admin performs admin-only action

Inventory concurrency test:

- If only 1 item is available and two users simultaneously post sales, only one may succeed when negative stock is disabled.

## Deployment strategy

### Pilot / development

- Cloudflare Workers free tier where suitable
- Supabase free tier for development/pilot
- R2/Supabase Storage within free allowances

### Production business use

Move to paid managed infrastructure before relying on the app for critical business operations.

Expected progression:

1. Free development/pilot
2. Supabase Pro / suitable managed PostgreSQL
3. Paid Cloudflare Workers as traffic grows
4. Monitoring + automated backups
5. Connection pooling / indexing / queues
6. Replicas/partitioning only when measurements justify them
7. Service extraction only when a module genuinely needs independent scaling

## India / GST direction

Architecture should support:

- GSTIN
- HSN/SAC
- CGST
- SGST
- IGST
- Cess
- Place of Supply
- Reverse Charge
- B2B/B2C
- tax-inclusive/exclusive pricing
- credit/debit notes
- financial-year invoice numbering
- future IRN/acknowledgement/QR/e-invoice integration

Actual regulatory integrations and compliance assumptions must be re-verified against current official sources before production releases.

## Development order

1. Tenant/organization schema
2. RLS policies + tenant-isolation tests
3. Roles/permissions
4. Products + units/categories
5. Warehouses
6. Immutable inventory ledger
7. Customers + suppliers
8. Invoicing
9. Payments
10. GST/tax engine
11. Reporting
12. Customization engine
13. Production hardening

## NEXT TASK — RESUME HERE

Build the database foundation on branch `foundation/bootstrap`:

- create initial Supabase/PostgreSQL migration
- organizations
- organization membership
- roles/permissions baseline
- warehouses
- items
- immutable inventory movements
- audit events
- idempotency keys
- helper functions for tenant membership
- enable RLS
- write initial pgTAP/adversarial tenant-isolation tests
- add CI workflow to run database/security checks

Do not start broad UI development until tenant isolation and ledger invariants are tested.

## Handoff/update policy

Update this README whenever any of these occurs:

- an architecture decision changes
- a major feature is completed
- database schema changes materially
- deployment approach changes
- security assumptions change
- a significant bug/constraint is discovered
- work is about to stop after substantial progress
- conversation/context is becoming very large

Before ending a substantial build session, update at minimum:

- `Current status`
- completed work
- unresolved issues
- important decisions
- `NEXT TASK — RESUME HERE`

## Security rule

**Never commit:**

- service-role keys
- API secrets
- passwords
- production database URLs containing credentials
- private signing keys
- customer production data
- `.env` files containing secrets

Use environment variables / secret stores and commit only safe examples such as `.env.example`.
