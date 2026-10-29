import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, apiFetch } from '../lib/api'

type Warehouse = {
  id: string
  code: string
  name: string
  is_active: boolean
}

type Fulfillment = {
  id: string
  financial_document_id: string
  warehouse_id: string
  request_key: string
  posted_at: string
  created_by: string
}

type InvoiceFulfillmentPanelProps = {
  organizationId: string
  documentId: string
  documentStatus: 'draft' | 'issued' | 'cancelled'
  hasStockLines: boolean
  onChanged: () => Promise<void> | void
}

type ListResponse<T> = { data: T[]; requestId: string }
type FulfillmentResponse = { data: Fulfillment | null; requestId: string }

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow stock fulfilment.',
      issued_invoice_not_found: 'Only an issued tax invoice can be fulfilled.',
      invalid_warehouse_or_reference: 'The selected warehouse is no longer available.',
      fulfillment_conflict: 'This invoice has already been fulfilled.',
      insufficient_stock_or_not_fulfillable: 'Fulfilment failed. Check stock availability and stock-backed invoice lines.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

export function InvoiceFulfillmentPanel({
  organizationId,
  documentId,
  documentStatus,
  hasStockLines,
  onChanged,
}: InvoiceFulfillmentPanelProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [warehouseResponse, fulfillmentResponse] = await Promise.all([
        apiFetch<ListResponse<Warehouse>>(
          `/v1/inventory/warehouses?organizationId=${encodeURIComponent(organizationId)}`,
        ),
        apiFetch<FulfillmentResponse>(
          `/v1/financial-documents/${encodeURIComponent(documentId)}/fulfillment?organizationId=${encodeURIComponent(organizationId)}`,
        ),
      ])
      setWarehouses(warehouseResponse.data)
      setFulfillment(fulfillmentResponse.data)
      setWarehouseId((current) => current || warehouseResponse.data[0]?.id || '')
      setError(null)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [documentId, organizationId])

  useEffect(() => { void load() }, [load])

  const fulfillmentWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === fulfillment?.warehouse_id),
    [fulfillment, warehouses],
  )

  async function fulfill() {
    if (!warehouseId || posting) return
    if (!window.confirm('Fulfil this invoice from the selected warehouse? All stock-backed lines post atomically.')) return

    setPosting(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/${documentId}/fulfill`, {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          warehouseId,
          requestKey: `web-fulfill-${documentId}-${crypto.randomUUID()}`,
        }),
      })
      await load()
      await onChanged()
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setPosting(false)
    }
  }

  if (loading) return <div className="invoice-fulfillment"><span className="muted">Loading fulfilment…</span></div>

  if (fulfillment) {
    return (
      <div className="invoice-fulfillment fulfilled">
        <div>
          <span className="eyebrow">Stock fulfilment</span>
          <strong>Fulfilled</strong>
          <small>{fulfillmentWarehouse ? `${fulfillmentWarehouse.code} · ${fulfillmentWarehouse.name}` : 'Warehouse'} · {new Date(fulfillment.posted_at).toLocaleString()}</small>
        </div>
        <span className="status-pill neutral">stock posted</span>
      </div>
    )
  }

  if (documentStatus !== 'issued') return null

  return (
    <div className="invoice-fulfillment">
      <div>
        <span className="eyebrow">Stock fulfilment</span>
        <strong>{hasStockLines ? 'Ready to fulfil' : 'No stock-backed lines'}</strong>
        <small>{hasStockLines ? 'All stock-backed lines post in one database transaction.' : 'Link invoice lines to inventory items before issue if stock should move.'}</small>
      </div>
      {hasStockLines ? (
        <div className="invoice-fulfillment-actions">
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={posting || warehouses.length === 0}>
            {warehouses.length === 0 ? <option value="">No active warehouse</option> : null}
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
          <button className="primary-button" type="button" disabled={posting || !warehouseId} onClick={() => void fulfill()}>
            {posting ? 'Fulfilling…' : 'Fulfil stock'}
          </button>
        </div>
      ) : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </div>
  )
}
