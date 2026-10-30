import { returnSalesFulfillmentSchema } from '@inventory/contracts/sales-fulfillment'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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

type FulfillmentLine = {
  financial_document_line_id: string
  item_id: string
  inventory_movement_id: string
  quantity: string | number
  created_at: string
}

type SalesReturn = {
  id: string
  fulfillment_id: string
  reason: string
  request_key: string
  posted_at: string
}

type SalesReturnLine = {
  return_id: string
  fulfillment_id: string
  fulfillment_line_id: string
  item_id: string
  inventory_movement_id: string
  quantity: string | number
  created_at: string
}

type InvoiceFulfillmentPanelProps = {
  organizationId: string
  documentId: string
  documentStatus: 'draft' | 'issued' | 'cancelled'
  hasStockLines: boolean
  onChanged: () => Promise<void> | void
}

type ListResponse<T> = { data: T[]; requestId: string }
type FulfillmentResponse = { data: Fulfillment | null; lines: FulfillmentLine[]; requestId: string }
type ReturnHistoryResponse = { data: SalesReturn[]; lines: SalesReturnLine[]; requestId: string }

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow this stock action.',
      issued_invoice_not_found: 'Only an issued tax invoice can be fulfilled.',
      invalid_warehouse_or_reference: 'The selected warehouse is no longer available.',
      fulfillment_conflict: 'This invoice has already been fulfilled.',
      insufficient_stock_or_not_fulfillable: 'Fulfilment failed. Check stock availability and stock-backed invoice lines.',
      fulfillment_or_line_not_found: 'The selected fulfilment line is no longer available.',
      return_idempotency_conflict: 'This return request conflicts with an earlier request.',
      return_quantity_not_allowed: 'A return quantity exceeds the quantity still eligible to be returned.',
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
  const [fulfillmentLines, setFulfillmentLines] = useState<FulfillmentLine[]>([])
  const [returns, setReturns] = useState<SalesReturn[]>([])
  const [returnLines, setReturnLines] = useState<SalesReturnLine[]>([])
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [returnReason, setReturnReason] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)
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
      setFulfillmentLines(fulfillmentResponse.lines ?? [])
      setWarehouseId((current) => current || warehouseResponse.data[0]?.id || '')

      if (fulfillmentResponse.data) {
        const returnResponse = await apiFetch<ReturnHistoryResponse>(
          `/v1/financial-documents/fulfillments/${encodeURIComponent(fulfillmentResponse.data.id)}/returns?organizationId=${encodeURIComponent(organizationId)}`,
        )
        setReturns(returnResponse.data)
        setReturnLines(returnResponse.lines)
      } else {
        setReturns([])
        setReturnLines([])
      }
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

  async function postReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fulfillment || posting) return

    const lines = fulfillmentLines
      .map((line) => ({
        fulfillmentLineId: line.financial_document_line_id,
        quantity: returnQuantities[line.financial_document_line_id]?.trim() ?? '',
      }))
      .filter((line) => line.quantity !== '')

    const parsed = returnSalesFulfillmentSchema.safeParse({
      organizationId,
      fulfillmentId: fulfillment.id,
      lines,
      reason: returnReason,
      requestKey: `web-return-${fulfillment.id}-${crypto.randomUUID()}`,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the return quantities and reason.')
      return
    }

    if (!window.confirm('Post this sales return? Returned stock will be added back through an immutable return movement.')) return

    setPosting(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/fulfillments/${encodeURIComponent(fulfillment.id)}/returns`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setReturnQuantities({})
      setReturnReason('')
      setShowReturnForm(false)
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
        <div className="invoice-fulfillment-return-stack">
          <div className="invoice-fulfillment-return-header">
            <div>
              <span className="eyebrow">Stock fulfilment</span>
              <strong>Fulfilled</strong>
              <small>{fulfillmentWarehouse ? `${fulfillmentWarehouse.code} · ${fulfillmentWarehouse.name}` : 'Warehouse'} · {new Date(fulfillment.posted_at).toLocaleString()}</small>
            </div>
            <span className="status-pill neutral">stock posted</span>
          </div>

          <div className="invoice-return-history">
            <div className="invoice-fulfillment-return-header">
              <div>
                <strong>Sales returns</strong>
                <small>{returns.length === 0 ? 'No stock has been returned.' : `${returns.length} immutable return record${returns.length === 1 ? '' : 's'}.`}</small>
              </div>
              {documentStatus === 'issued' && fulfillmentLines.length > 0 ? (
                <button className="secondary-button" type="button" onClick={() => setShowReturnForm((current) => !current)} disabled={posting}>
                  {showReturnForm ? 'Close return' : 'Record return'}
                </button>
              ) : null}
            </div>

            {returns.map((salesReturn) => (
              <div className="invoice-return-record" key={salesReturn.id}>
                <span><strong>{salesReturn.reason}</strong><small>{new Date(salesReturn.posted_at).toLocaleString()}</small></span>
                <span>
                  {returnLines.filter((line) => line.return_id === salesReturn.id).map((line) => (
                    <small key={`${salesReturn.id}-${line.fulfillment_line_id}`}>Returned {String(line.quantity)} · line {line.fulfillment_line_id.slice(0, 8)}</small>
                  ))}
                </span>
              </div>
            ))}
          </div>

          {showReturnForm ? (
            <form className="invoice-return-form" onSubmit={postReturn}>
              <p className="muted">Enter only the quantities being returned now. The database rejects any amount above the still-returnable fulfilled quantity.</p>
              {fulfillmentLines.map((line) => (
                <label key={line.financial_document_line_id}>
                  Invoice line {line.financial_document_line_id.slice(0, 8)} · fulfilled {String(line.quantity)}
                  <input
                    inputMode="decimal"
                    placeholder="Return quantity"
                    value={returnQuantities[line.financial_document_line_id] ?? ''}
                    onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.financial_document_line_id]: event.target.value }))}
                  />
                </label>
              ))}
              <label>
                Return reason
                <textarea required maxLength={240} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
              </label>
              <button className="primary-button" type="submit" disabled={posting}>{posting ? 'Posting return…' : 'Post sales return'}</button>
            </form>
          ) : null}
        </div>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
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
