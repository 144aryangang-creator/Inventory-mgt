import { operationalDashboardQuerySchema } from '@inventory/contracts/operations'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import '../operations.css'

type CurrencySummary = {
  currencyCode: string
  invoiceCount: number
  invoiceTotal: string | number
  creditNoteCount: number
  creditNoteTotal: string | number
  debitNoteCount: number
  debitNoteTotal: string | number
  netDocumentValue: string | number
}

type OperationalDashboard = {
  organizationId: string
  generatedAt: string
  windowDays: number
  salesByCurrency: CurrencySummary[]
  inventory: {
    activeTrackedItems: number
    activeServiceItems: number
    activeWarehouses: number
    positiveStockPositions: number
    negativeStockPositions: number
  }
  receiving: {
    receiptCount: number
    receiptLineCount: number
    supplierCount: number
  }
  fulfillment: {
    unfulfilledInvoices: number
    partialInvoices: number
    fulfilledInvoices: number
  }
  activity: {
    auditEventCount: number
    activeUsers: number
  }
}

type DashboardResponse = { data: OperationalDashboard; requestId: string }

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') return 'Your organization membership does not allow this dashboard.'
    if (error.code === 'invalid_dashboard_window') return 'Choose a dashboard window between 1 and 365 days.'
    return `Dashboard request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Dashboard request failed'
}

export function OperationalDashboardPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [days, setDays] = useState(30)
  const [dashboard, setDashboard] = useState<OperationalDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!activeOrganization) { setDashboard(null); return }
    const parsed = operationalDashboardQuerySchema.safeParse({ organizationId: activeOrganization.id, days })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid dashboard window.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch<DashboardResponse>(
        `/v1/operations/dashboard?organizationId=${encodeURIComponent(parsed.data.organizationId)}&days=${parsed.data.days}`,
      )
      setDashboard(response.data)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [activeOrganization, days])

  useEffect(() => { void loadDashboard() }, [loadDashboard])

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Dashboard</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading operations-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>Operational Dashboard</h1>
          <p className="muted">PostgreSQL-authoritative operational KPIs. Money stays separated by currency; inventory quantities are never summed across unrelated items/UOMs.</p>
        </div>
        <label className="operations-window">Window<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option></select></label>
      </div>

      {error ? <p className="error-message" role="alert">{error}</p> : null}
      {loading && !dashboard ? <div className="centered-panel-state">Loading dashboard…</div> : null}

      {dashboard ? (
        <>
          <div className="operations-shortcuts">
            <Link to="/invoices">Invoices</Link>
            <Link to="/purchases">Purchase receipts</Link>
            <Link to="/inventory">Inventory</Link>
            <Link to="/payments">Payments</Link>
            <Link to="/audit">Audit log</Link>
          </div>

          <section className="panel operations-section">
            <div className="panel-heading"><h2>Issued financial documents</h2><span className="record-count">Last {dashboard.windowDays} days</span></div>
            {dashboard.salesByCurrency.length === 0 ? <p className="empty-state">No issued financial documents in this window.</p> : (
              <div className="operations-currency-grid">
                {dashboard.salesByCurrency.map((currency) => (
                  <article key={currency.currencyCode}>
                    <span className="eyebrow">{currency.currencyCode}</span>
                    <strong className="operations-money">{currency.currencyCode} {String(currency.netDocumentValue)}</strong>
                    <small>Net document value</small>
                    <dl>
                      <div><dt>Invoices</dt><dd>{currency.invoiceCount} · {String(currency.invoiceTotal)}</dd></div>
                      <div><dt>Credits</dt><dd>{currency.creditNoteCount} · −{String(currency.creditNoteTotal)}</dd></div>
                      <div><dt>Debits</dt><dd>{currency.debitNoteCount} · +{String(currency.debitNoteTotal)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="operations-grid">
            <section className="panel operations-section">
              <div className="panel-heading"><h2>Inventory</h2><Link className="text-button" to="/inventory">Open inventory</Link></div>
              <div className="operations-metric-grid">
                <article><strong>{dashboard.inventory.activeTrackedItems}</strong><span>Tracked items</span></article>
                <article><strong>{dashboard.inventory.activeServiceItems}</strong><span>Service items</span></article>
                <article><strong>{dashboard.inventory.activeWarehouses}</strong><span>Warehouses</span></article>
                <article><strong>{dashboard.inventory.positiveStockPositions}</strong><span>Positive stock positions</span></article>
                <article><strong>{dashboard.inventory.negativeStockPositions}</strong><span>Negative stock positions</span></article>
              </div>
            </section>

            <section className="panel operations-section">
              <div className="panel-heading"><h2>Purchase receiving</h2><Link className="text-button" to="/purchases">Open receiving</Link></div>
              <div className="operations-metric-grid">
                <article><strong>{dashboard.receiving.receiptCount}</strong><span>Receipts</span></article>
                <article><strong>{dashboard.receiving.receiptLineCount}</strong><span>Received lines</span></article>
                <article><strong>{dashboard.receiving.supplierCount}</strong><span>Suppliers received from</span></article>
              </div>
              <p className="operations-note">Receiving counts represent physical stock events only; they are not supplier payable values.</p>
            </section>

            <section className="panel operations-section">
              <div className="panel-heading"><h2>Sales fulfillment</h2><Link className="text-button" to="/invoices">Open invoices</Link></div>
              <div className="operations-metric-grid">
                <article><strong>{dashboard.fulfillment.unfulfilledInvoices}</strong><span>Unfulfilled invoices</span></article>
                <article><strong>{dashboard.fulfillment.partialInvoices}</strong><span>Partially fulfilled</span></article>
                <article><strong>{dashboard.fulfillment.fulfilledInvoices}</strong><span>Fully fulfilled</span></article>
              </div>
            </section>

            <section className="panel operations-section">
              <div className="panel-heading"><h2>Audit activity</h2><Link className="text-button" to="/audit">Open audit log</Link></div>
              <div className="operations-metric-grid">
                <article><strong>{dashboard.activity.auditEventCount}</strong><span>Audit events</span></article>
                <article><strong>{dashboard.activity.activeUsers}</strong><span>Distinct actors</span></article>
              </div>
            </section>
          </div>
          <p className="operations-generated muted">Generated {new Date(dashboard.generatedAt).toLocaleString()}</p>
        </>
      ) : null}
    </section>
  )
}
