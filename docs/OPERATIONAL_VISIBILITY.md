# Operational Visibility

## Purpose

The operational dashboard and audit viewer are read-only surfaces over authoritative PostgreSQL data. They must never become alternate mutation paths or introduce browser-side financial source-of-truth calculations.

## Dashboard invariants

1. **Money is grouped by currency.** Never add INR, USD, THB, or any other currency into one number without an explicit FX conversion workflow and stored conversion basis.
2. **Inventory quantities are not summed across unrelated items/UOMs.** The dashboard reports item/warehouse/stock-position counts instead of a meaningless cross-item quantity total.
3. **Issued documents only drive financial-document KPIs.** Cancelled documents do not contribute to current issued totals.
4. **Credit notes reduce and debit notes increase net document value.** PostgreSQL computes the grouped totals.
5. **Purchase receipts are physical receiving events, not accounts-payable values.** The dashboard reports receipt/supplier/line counts only until supplier invoicing/AP exists.
6. **Fulfillment status is derived from immutable fulfillment postings.** UI state does not decide whether an invoice is unfulfilled, partial, or fulfilled.
7. **All dashboard reads are tenant-scoped and require organization membership.**

## Audit viewer invariants

1. Audit events are append-only business history.
2. The viewer is read-only and tenant-scoped through PostgreSQL RLS.
3. Filters are exact action/entity/actor filters with bounded pagination.
4. Metadata may contain operational identifiers and must not be sent to third-party analytics by default.
5. Application audit events are not a substitute for Cloudflare, Supabase, authentication, access, infrastructure, or security logs.
6. Retention/export policy must be defined before production launch.

## Current implementation

- Migration `20261030002900_operational_dashboard.sql`
  - audit/dashboard indexes
  - `get_operational_dashboard_summary(organization_id, days)`
  - currency-separated issued invoice/credit/debit totals
  - inventory master/stock-position counts
  - purchase-receipt activity counts
  - derived fulfillment status counts
  - recent audit activity counts
- pgTAP `020_operational_dashboard.test.sql`
- shared contracts `packages/contracts/src/operations.ts`
- API module `apps/api/src/operations.ts`
- web pages:
  - `OperationalDashboardPage.tsx`
  - `AuditLogPage.tsx`
- shared styles `operations.css`

## Follow-on reporting work

- customer/supplier aging after AP/accounting exists
- sales by customer/item/period with currency separation
- stock aging/valuation once an explicit valuation method is chosen
- low-stock/reorder reporting after reorder policies are modeled
- export jobs with tenant-scoped authorization and audit events
