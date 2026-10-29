# Inventory Management + Invoicing SaaS

A configurable, multi-tenant inventory and invoicing platform designed to start small and scale safely.

## Core principles

- Multi-tenant from day one
- PostgreSQL Row Level Security for tenant isolation
- Immutable inventory ledger
- Exact decimal money/tax handling
- Audit trail for critical actions
- Configurable fields and modules per organization
- GST-ready architecture for India
- Modular monolith first; split services only when scale requires it

## Planned stack

- Frontend: React + TypeScript
- API: TypeScript on Cloudflare Workers
- Database/Auth: Supabase PostgreSQL + Auth
- Storage: Supabase Storage / Cloudflare R2
- CI/CD: GitHub Actions
- Tests: pgTAP + Vitest + Playwright + k6 + OWASP ZAP

## Repository layout

```text
supabase/
  migrations/
  tests/
docs/
.github/workflows/
```

## Development order

1. Tenant model + RLS
2. Roles and permissions
3. Products and warehouses
4. Inventory ledger
5. Customers and suppliers
6. Invoicing and payments
7. GST/tax rules
8. Reporting
9. Customization engine
10. Production hardening

## Security rule

Never place secrets, service-role keys, production credentials, or private customer data in Git.
