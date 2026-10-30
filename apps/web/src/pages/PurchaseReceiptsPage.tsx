import { postPurchaseReceiptSchema } from '@inventory/contracts/purchase-receipts'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import { buildPartySearchPath, type Party } from '../parties/party'
import '../purchase-receipts.css'

type InventoryItem = {
  id: string
  sku: string
  name: string
  base_uom: string
  track_inventory: boolean
  is_active: boolean
}

type Warehouse = {
  id: string
  code: string
  name: string
  is_active: boolean
}

type PurchaseReceipt = {
  id: string
  receipt_number: number
  supplier_party_id: string
  supplier_snapshot: Record<string, unknown>
  warehouse_id: string
  supplier_reference: string | null
  notes: string | null
  received_at: string
  created_at: string
  created_by: string
}

type PurchaseReceiptLine = {
  line_number: number
  item_id: string
  item_snapshot: Record<string, unknown>
  uom: string
  quantity: string | number
  unit_cost: string | number
  inventory_movement_id: string
  created_at: string
}

type PurchaseReceiptDetail = {
  receipt: PurchaseReceipt
  lines: PurchaseReceiptLine[]
}

type FormLine = {
  key: string
  itemId: string
  quantity: string
  unitCost: string
}

type ListResponse<T> = { data: T[]; requestId: string }
type DetailResponse = { data: PurchaseReceiptDetail; requestId: string }

function localDateTimeInput(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

function emptyLine(): FormLine {
  return { key: crypto.randomUUID(), itemId: '', quantity: '1', unitCost: '' }
}

function snapshotText(snapshot: Record<string, unknown>, key: string, fallback = '—'): string {
  const value = snapshot[key]
  return typeof value === 'string' && value ? value : fallback
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow purchase receiving.',
      purchase_receipt_idempotency_conflict: 'This receipt request conflicts with an earlier submission.',
      invalid_supplier_item_or_warehouse: 'The supplier, item, or warehouse is inactive or not valid for this organization.',
      invalid_purchase_receipt: 'Check the receipt quantities, costs, reference, and received time.',
      purchase_receipt_not_found: 'Purchase receipt not found.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

export function PurchaseReceiptsPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([])
  const [detail, setDetail] = useState<PurchaseReceiptDetail | null>(null)
  const [supplierPartyId, setSupplierPartyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [supplierReference, setSupplierReference] = useState('')
  const [notes, setNotes] = useState('')
  const [receivedAt, setReceivedAt] = useState(localDateTimeInput())
  const [lines, setLines] = useState<FormLine[]>([emptyLine()])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReferences = useCallback(async () => {
    if (!activeOrganization) return
    const [supplierResponse, itemResponse, warehouseResponse] = await Promise.all([
      apiFetch<ListResponse<Party>>(buildPartySearchPath(activeOrganization.id, 'supplier', '')),
      apiFetch<ListResponse<InventoryItem>>(`/v1/inventory/items?organizationId=${encodeURIComponent(activeOrganization.id)}&limit=100`),
      apiFetch<ListResponse<Warehouse>>(`/v1/inventory/warehouses?organizationId=${encodeURIComponent(activeOrganization.id)}`),
    ])

    const trackedItems = itemResponse.data.filter((item) => item.is_active && item.track_inventory)
    const activeWarehouses = warehouseResponse.data.filter((warehouse) => warehouse.is_active)
    setSuppliers(supplierResponse.data)
    setItems(trackedItems)
    setWarehouses(activeWarehouses)
    setSupplierPartyId((current) => current || supplierResponse.data[0]?.id || '')
    setWarehouseId((current) => current || activeWarehouses[0]?.id || '')
  }, [activeOrganization])

  const loadReceipts = useCallback(async () => {
    if (!activeOrganization) { setReceipts([]); return }
    const response = await apiFetch<ListResponse<PurchaseReceipt>>(
      `/v1/purchase-receipts?organizationId=${encodeURIComponent(activeOrganization.id)}&limit=100`,
    )
    setReceipts(response.data)
  }, [activeOrganization])

  const loadDetail = useCallback(async (receiptId: string) => {
    if (!activeOrganization) return
    const response = await apiFetch<DetailResponse>(
      `/v1/purchase-receipts/${encodeURIComponent(receiptId)}?organizationId=${encodeURIComponent(activeOrganization.id)}`,
    )
    setDetail(response.data)
  }, [activeOrganization])

  useEffect(() => {
    if (!activeOrganization) return
    setLoading(true)
    setError(null)
    Promise.all([loadReferences(), loadReceipts()])
      .catch((caught) => setError(friendlyError(caught)))
      .finally(() => setLoading(false))
  }, [activeOrganization, loadReceipts, loadReferences])

  function resetForm() {
    setSupplierPartyId(suppliers[0]?.id ?? '')
    setWarehouseId(warehouses[0]?.id ?? '')
    setSupplierReference('')
    setNotes('')
    setReceivedAt(localDateTimeInput())
    setLines([emptyLine()])
  }

  async function postReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization || posting) return

    const receivedDate = receivedAt ? new Date(receivedAt) : null
    const receivedIso = receivedDate && !Number.isNaN(receivedDate.getTime()) ? receivedDate.toISOString() : undefined
    const parsed = postPurchaseReceiptSchema.safeParse({
      organizationId: activeOrganization.id,
      supplierPartyId,
      warehouseId,
      lines: lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity.trim(), unitCost: line.unitCost.trim() })),
      supplierReference,
      notes,
      receivedAt: receivedIso,
      requestKey: `web-purchase-receipt-${crypto.randomUUID()}`,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the purchase receipt details.')
      return
    }
    if (!window.confirm('Post this purchase receipt? Stock will be added to the selected warehouse and the receipt becomes immutable.')) return

    setPosting(true)
    setError(null)
    try {
      const response = await apiFetch<{ receiptId: string }>('/v1/purchase-receipts', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      resetForm()
      setShowForm(false)
      await Promise.all([loadReceipts(), loadDetail(response.receiptId)])
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setPosting(false)
    }
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Purchase Receipts</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading purchase-receipt-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>Purchase Receipts</h1>
          <p className="muted">Receive accepted supplier goods into inventory. This is a physical stock workflow, not a supplier invoice or payable.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowForm((current) => !current)}>{showForm ? 'Close' : 'Receive goods'}</button>
      </div>

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      {showForm ? (
        <section className="panel purchase-receipt-form-panel">
          <div className="panel-heading"><h2>New purchase receipt</h2></div>
          {suppliers.length === 0 || warehouses.length === 0 || items.length === 0 ? (
            <p className="empty-state">You need at least one active supplier, active warehouse, and active tracked inventory item before receiving goods.</p>
          ) : (
            <form className="purchase-receipt-form" onSubmit={postReceipt}>
              <label>Supplier<select required value={supplierPartyId} onChange={(event) => setSupplierPartyId(event.target.value)}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.display_name}</option>)}</select></label>
              <label>Receiving warehouse<select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
              <label>Received at<input type="datetime-local" required value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label>
              <label>Supplier delivery / reference<input maxLength={120} value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} /></label>
              <label className="purchase-receipt-full">Notes<textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>

              <div className="purchase-receipt-lines purchase-receipt-full">
                <div className="purchase-receipt-line-heading"><strong>Received items</strong><button className="text-button" type="button" onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</button></div>
                {lines.map((line, index) => {
                  const item = items.find((candidate) => candidate.id === line.itemId)
                  return (
                    <div className="purchase-receipt-line" key={line.key}>
                      <label>Item<select required value={line.itemId} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, itemId: event.target.value } : entry))}><option value="">Select item</option>{items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.sku} · {candidate.name}</option>)}</select></label>
                      <label>Quantity ({item?.base_uom ?? 'unit'})<input inputMode="decimal" required value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} /></label>
                      <label>Unit cost<input inputMode="decimal" required value={line.unitCost} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, unitCost: event.target.value } : entry))} /></label>
                      <button className="text-button danger-text" type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>Remove</button>
                      <small>Line {index + 1}. Cost is stored on the immutable inventory receipt movement; no payable is created.</small>
                    </div>
                  )
                })}
              </div>

              <p className="invoice-note purchase-receipt-full">All lines post in one PostgreSQL transaction. If any supplier, warehouse, item, quantity, or cost is invalid, no stock or receipt number is committed.</p>
              <div className="purchase-receipt-actions purchase-receipt-full"><button className="primary-button" type="submit" disabled={posting}>{posting ? 'Receiving…' : 'Post purchase receipt'}</button></div>
            </form>
          )}
        </section>
      ) : null}

      <div className="purchase-receipt-layout">
        <section className="panel purchase-receipt-list-panel">
          <div className="panel-heading"><h2>Receipt history</h2><span className="record-count">{loading ? 'Loading…' : `${receipts.length} shown`}</span></div>
          {!loading && receipts.length === 0 ? <p className="empty-state">No purchase receipts posted yet.</p> : null}
          <div className="purchase-receipt-list">
            {receipts.map((receipt) => {
              const warehouse = warehouses.find((candidate) => candidate.id === receipt.warehouse_id)
              return (
                <button className={`purchase-receipt-list-row ${detail?.receipt.id === receipt.id ? 'selected' : ''}`} type="button" key={receipt.id} onClick={() => void loadDetail(receipt.id)}>
                  <span><strong>GRN #{receipt.receipt_number}</strong><small>{snapshotText(receipt.supplier_snapshot, 'display_name', snapshotText(receipt.supplier_snapshot, 'legal_name'))}</small></span>
                  <span><strong>{warehouse?.code ?? 'Warehouse'}</strong><small>{new Date(receipt.received_at).toLocaleString()}</small></span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel purchase-receipt-detail-panel">
          {!detail ? <p className="empty-state">Select a receipt to inspect its immutable stock lines.</p> : (
            <>
              <div className="purchase-receipt-detail-header">
                <div><p className="eyebrow">GRN #{detail.receipt.receipt_number}</p><h2>{snapshotText(detail.receipt.supplier_snapshot, 'legal_name')}</h2><p className="muted">Received {new Date(detail.receipt.received_at).toLocaleString()}</p></div>
                <span className="status-pill neutral">posted</span>
              </div>
              <div className="invoice-snapshot-grid">
                <div><span>Supplier code</span><strong>{snapshotText(detail.receipt.supplier_snapshot, 'code')}</strong></div>
                <div><span>Warehouse</span><strong>{warehouses.find((warehouse) => warehouse.id === detail.receipt.warehouse_id)?.name ?? detail.receipt.warehouse_id.slice(0, 8)}</strong></div>
                <div><span>Supplier reference</span><strong>{detail.receipt.supplier_reference ?? '—'}</strong></div>
                <div><span>Lines</span><strong>{detail.lines.length}</strong></div>
              </div>
              <div className="purchase-receipt-detail-lines">
                {detail.lines.map((line) => (
                  <article key={line.line_number}>
                    <span><strong>{line.line_number}. {snapshotText(line.item_snapshot, 'name')}</strong><small>{snapshotText(line.item_snapshot, 'sku')} · {String(line.quantity)} {line.uom}</small></span>
                    <span><strong>Unit cost {String(line.unit_cost)}</strong><small>Movement {line.inventory_movement_id.slice(0, 8)}</small></span>
                  </article>
                ))}
              </div>
              {detail.receipt.notes ? <p className="invoice-note">{detail.receipt.notes}</p> : null}
            </>
          )}
        </section>
      </div>
    </section>
  )
}
