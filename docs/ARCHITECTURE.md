# Architecture

## Goals

- Configurable multi-tenant SaaS
- Inventory + invoicing as the initial core
- Free/low-cost pilot infrastructure
- Production-grade data model and security from day one
- Horizontal growth without rewriting the business domain

## Initial architecture

- Frontend: React + TypeScript
- API: TypeScript modular monolith on Cloudflare Workers
- Database: PostgreSQL via Supabase
- Auth: Supabase Auth
- Authorization: database RLS + application RBAC
- Object storage: Cloudflare R2 / Supabase Storage
- CI/CD: GitHub Actions

## Core invariants

- Every business-owned record has `organization_id`
- Tenant access is enforced in PostgreSQL using RLS
- Stock quantity is derived from immutable inventory movements
- Posted invoices are not silently rewritten
- Money uses exact numeric/decimal values, never floating point
- Critical state changes generate audit events
- External side effects use an outbox/event pattern
- Retriable write APIs use idempotency keys

## Scale strategy

### Phase 1
- Modular monolith
- One PostgreSQL cluster
- Shared-schema multi-tenancy

### Phase 2
- Connection pooling
- Caching
- Async jobs
- Read replicas
- Table partitioning where evidence justifies it

### Phase 3
- Extract high-load modules only when metrics justify it
- Optional dedicated databases for very large tenants
- Regional deployments if required

## Modules

- Organizations
- Users/Roles/Permissions
- Products
- Warehouses
- Inventory Ledger
- Customers
- Suppliers
- Sales
- Purchases
- Invoices
- Payments
- Tax/GST
- Reporting
- Custom Fields
- Audit
- Integrations

## Non-goals for V1

- Full general ledger/accounting engine
- Offline-first synchronization
- Native mobile apps
- Microservices
- Marketplace/plugin ecosystem
