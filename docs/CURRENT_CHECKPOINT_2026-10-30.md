# Current Engineering Checkpoint — 2026-11-02

## Stable checkpoint

**V1 core business workflows are implemented and the complete real-stack browser critical path is green. Production hardening is now the active phase.**

Repository: `144aryangang-creator/Inventory-mgt`  
Working branch: `foundation/bootstrap`  
Main branch: foundation work is **not merged**.

## Validation gates

- Database CI: **GREEN** — run `40987922831`
  - migrations through `20261030003300_bulk_import_payload_null_hardening.sql`
  - DB lint passed
  - pgTAP suites `001–023` passed
- Application CI: **GREEN** — run `41221818608`
  - locked install + lockfile drift
  - strict TypeScript
  - contracts/API/web tests
  - Worker build
  - React/Vite production build
- Browser E2E: **GREEN** — run `41355614560`
  - real Supabase Auth/PostgREST/Postgres
  - real Worker + React app
  - Chromium
  - full V1 business critical path
- Security CI: **GREEN** — run `41355752128`
  - high/critical npm dependency audit passed
  - CodeQL JavaScript/TypeScript passed
  - production build under CodeQL passed

## Real-stack business path now proven

1. authentication + organization onboarding
2. Item CSV dry-run/import
3. two warehouses
4. Supplier CSV dry-run/import
5. supplier Purchase Receipts into both warehouses
6. inventory balance verification
7. seller/legal profile
8. customer + billing address
9. stock-backed GST invoice
10. PostgreSQL tax calculation + immutable issue
11. partial fulfillment from warehouse 1
12. remaining fulfillment from warehouse 2
13. multi-warehouse `fulfilled` state
14. return against exact warehouse-2 posting
15. stock restored to warehouse 2
16. return-linked GST credit note
17. customer receipt
18. partial allocation reversal
19. partial receipt refund
20. authenticated issued-document print output
21. operational dashboard
22. immutable invoice-issue audit event

## Security automation added

- `.github/workflows/security-ci.yml`
  - pinned CodeQL Action `v4.39.1`
  - `npm audit --audit-level=high`
  - weekly scheduled execution
- `.github/dependabot.yml`
  - weekly npm version updates
  - weekly GitHub Actions updates
  - grouped npm minor/patch updates

## Stable business modules

- tenant/RLS/auth foundation
- organization onboarding + tenant switching
- inventory ledger + transfers
- customers/suppliers + addresses/tax profiles
- seller billing profiles
- GST invoices / credit notes / debit notes
- commercial adjustments
- partial + multi-warehouse fulfillment
- sales returns + return-linked credits
- customer payments + reversals/refunds
- supplier Purchase Receipts / GRN
- operational dashboard
- audit viewer
- secure CSV import/export
- authenticated print / Save PDF

Purchase Receipt remains a physical logistics event only; supplier AP/payables are intentionally separate and not yet implemented.

## Invariants to preserve

- PostgreSQL RLS is the tenant security boundary
- organization switcher is UX state only
- inventory movements are append-only
- issued financial documents are immutable
- corrections use explicit return/reversal/refund/credit/debit ledgers
- PostgreSQL `numeric` is monetary/quantity truth
- JS boundaries use decimal strings
- legal/item/tax snapshots remain historical
- dangerous writes use idempotency keys
- critical writes append audit events
- normal API traffic never uses a service-role key
- no production credentials/customer data in Git
- bulk dry-run never replaces execution-time DB validation

## Active phase — production hardening

Next sequence:

1. dynamic HTTP/security testing and header/session review
2. representative load + concurrency tests
3. staging environment plan + secret separation
4. automated database backups + restore drill
5. monitoring / error tracking / alerts
6. privileged-account MFA policy
7. controlled staging deployment
8. production domain/TLS + pilot rollout after staging acceptance

## Decisions requiring user opinion

Ask before locking any of these:

- staging/production domain choice
- production rollout timing
- backup retention period
- monitoring/alert destination
- pilot-user rollout policy
- paid infrastructure upgrades

No decision is currently blocking dynamic security/load testing.

Do **not** merge `foundation/bootstrap` into `main` without explicit user authorization.
