# Security Model

## Trust boundaries

- Browser/client is untrusted.
- Every authenticated request must still be authorized.
- `organization_id` supplied by a client is never trusted by itself.
- PostgreSQL RLS is the tenant-isolation boundary.
- `service_role` credentials must never reach browser/client code.
- Database SECURITY DEFINER functions must use a fixed `search_path` and explicit authorization checks.

## Tenant isolation

- Every tenant-owned business table carries `organization_id`.
- RLS is enabled on every client-accessible tenant table.
- RLS policies are operation-specific.
- `organization_id` is immutable after creation for tenant-owned records.
- RLS filter columns must be indexed.
- Cross-tenant negative tests are mandatory for every new module.

## Inventory integrity

- `inventory_movements` is the source-of-truth ledger.
- Ledger rows are append-only.
- Corrections are new reversing/correcting movements.
- Clients cannot insert ledger movements directly.
- Posting goes through an authorized database RPC/service operation.
- `inventory_balances` is a transactional balance cache.
- Balance rows are locked during posting to prevent overselling races.
- Negative stock is blocked unless explicitly enabled per organization.
- Posting supports idempotency keys to prevent duplicate movements on retries.

## Financial integrity

- Never use binary floating point for money, tax, price, or quantity calculations.
- Use PostgreSQL `numeric` and decimal-safe application types.
- Posted invoices will be immutable.
- Corrections will use credit/debit/cancellation documents.
- Historical documents will store customer/item/tax snapshots.

## Audit

- Critical business mutations create audit events.
- Audit records are append-only.
- Audit log visibility is restricted to owner/admin roles.
- Avoid unnecessary personal/sensitive data in audit metadata.

## Secrets

Never commit:

- Supabase service-role key
- database passwords
- OAuth client secrets
- SMTP credentials
- Cloudflare/API tokens
- GST/GSP credentials
- production customer data
- private signing keys

Use environment/secret stores for all credentials.

## Required automated tests

- Tenant A cannot read Tenant B data.
- Tenant A cannot create/update Tenant B data.
- Multi-org users cannot move records between organizations.
- Viewer cannot perform stock posting.
- Direct ledger inserts are denied.
- Ledger update/delete is denied.
- Duplicate idempotency-key retries do not duplicate stock.
- Overselling is rejected when negative stock is disabled.
- Balance and ledger remain transactionally consistent.
- Audit visibility follows roles.

## Release gates

Before production:

- Database CI green.
- RLS adversarial tests green.
- Type checks and unit tests green.
- API integration tests green.
- Playwright E2E green.
- OWASP ZAP baseline scan reviewed.
- Dependency/security scan reviewed.
- Load/concurrency tests green.
- Backup + restore drill completed.
- Production secrets stored outside Git.
- MFA required for privileged administrative access.
- Logging/monitoring/alerting configured.

## Standards

- OWASP ASVS is the primary application-security checklist.
- Least privilege by default.
- Deny by default when a permission is not explicitly granted.
