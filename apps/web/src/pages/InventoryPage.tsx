import { postInventoryMovementSchema } from '@inventory/contracts'
import {
  createInventoryItemSchema,
  createWarehouseSchema,
  transferInventorySchema,
  updateInventoryItemSchema,
  updateWarehouseSchema,
} from '@inventory/contracts/inventory-workspace'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import '../inventory.css'

type InventoryItem = {
  id: string
  sku: string
  name: string
  description: string | null
  base_uom: string
  track_inventory: boolean
  is_active: boolean
  custom_data: Record<string, unknown>
}

type Warehouse = {
  id: string
  code: string
  name: string
  is_active: boolean
}

type Balance = {
  item_id: string
  warehouse_id: string
  quantity_on_hand: string | number
  updated_at: string
}

type Movement = {
  id: string
  item_id: string
  warehouse_id: string
  movement_type: string
  quantity: string | number
  unit_cost: string | number | null
  reference_type: string | null
  reference_id: string | null
  request_key: string | null
  occurred_at: string
}

type ListResponse<T> = { data: T[]; requestId: string }

type ItemForm = {
  id: string
  sku: string
  name: string
  description: string
  baseUom: string
  trackInventory: boolean
}

type WarehouseForm = { id: string; code: string; name: string }

type StockForm = {
  itemId: string
  warehouseId: string
  operation: 'receipt' | 'adjustment_in' | 'adjustment_out'
  quantity: string
  unitCost: string
}

type TransferForm = {
  itemId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: string
}

const emptyItem: ItemForm = { id: '', sku: '', name: '', description: '', baseUom: 'EA', trackInventory: true }
const emptyWarehouse: WarehouseForm = { id: '', code: '', name: '' }
const emptyStock: StockForm = { itemId: '', warehouseId: '', operation: 'receipt', quantity: '', unitCost: '' }
const emptyTransfer: TransferForm = { itemId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '' }

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow this inventory action.',
      item_code_conflict: 'That item SKU already exists.',
      warehouse_code_conflict: 'That warehouse code already exists.',
      item_operation_not_allowed: 'This item cannot be changed while stock remains.',
      warehouse_operation_not_allowed: 'This warehouse cannot be archived while stock remains.',
      transfer_operation_not_allowed: 'The transfer cannot be completed. Check source stock and warehouse status.',
      insufficient_stock_or_invalid_quantity: 'Insufficient stock or invalid movement quantity.',
      idempotency_conflict: 'This request key was already used for a different stock operation.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function signedQuantity(operation: StockForm['operation'], quantity: string): string {
  return operation === 'adjustment_out' ? `-${quantity.replace(/^-/, '')}` : quantity.replace(/^-/, '')
}

export function InventoryPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem)
  const [warehouseForm, setWarehouseForm] = useState<WarehouseForm>(emptyWarehouse)
  const [stockForm, setStockForm] = useState<StockForm>(emptyStock)
  const [transferForm, setTransferForm] = useState<TransferForm>(emptyTransfer)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses])
  const trackedItems = useMemo(() => items.filter((item) => item.is_active && item.track_inventory), [items])
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses])

  const loadAll = useCallback(async () => {
    if (!activeOrganization) return
    const org = encodeURIComponent(activeOrganization.id)
    const [itemResponse, warehouseResponse, balanceResponse, movementResponse] = await Promise.all([
      apiFetch<ListResponse<InventoryItem>>(`/v1/inventory/items?organizationId=${org}&status=all&limit=100`),
      apiFetch<ListResponse<Warehouse>>(`/v1/inventory/warehouses?organizationId=${org}&status=all&limit=100`),
      apiFetch<ListResponse<Balance>>(`/v1/inventory/balances?organizationId=${org}`),
      apiFetch<ListResponse<Movement>>(`/v1/inventory/movements?organizationId=${org}&limit=100`),
    ])
    setItems(itemResponse.data)
    setWarehouses(warehouseResponse.data)
    setBalances(balanceResponse.data)
    setMovements(movementResponse.data)

    const firstItem = itemResponse.data.find((item) => item.is_active && item.track_inventory)?.id ?? ''
    const firstWarehouse = warehouseResponse.data.find((warehouse) => warehouse.is_active)?.id ?? ''
    setStockForm((current) => ({ ...current, itemId: current.itemId || firstItem, warehouseId: current.warehouseId || firstWarehouse }))
    setTransferForm((current) => ({
      ...current,
      itemId: current.itemId || firstItem,
      fromWarehouseId: current.fromWarehouseId || firstWarehouse,
      toWarehouseId: current.toWarehouseId || warehouseResponse.data.find((warehouse) => warehouse.is_active && warehouse.id !== firstWarehouse)?.id || '',
    }))
  }, [activeOrganization])

  useEffect(() => {
    if (!activeOrganization) return
    setLoading(true)
    setError(null)
    loadAll().catch((caught) => setError(friendlyError(caught))).finally(() => setLoading(false))
  }, [activeOrganization, loadAll])

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return
    const input = {
      organizationId: activeOrganization.id,
      ...(itemForm.id ? { itemId: itemForm.id } : {}),
      sku: itemForm.sku,
      name: itemForm.name,
      description: itemForm.description,
      baseUom: itemForm.baseUom,
      trackInventory: itemForm.trackInventory,
    }
    const parsed = itemForm.id ? updateInventoryItemSchema.safeParse(input) : createInventoryItemSchema.safeParse(input)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the item details.'); return }

    setSaving(true); setError(null)
    try {
      await apiFetch(itemForm.id ? `/v1/inventory/items/${itemForm.id}` : '/v1/inventory/items', {
        method: itemForm.id ? 'PATCH' : 'POST', body: JSON.stringify(parsed.data),
      })
      setItemForm(emptyItem)
      await loadAll()
    } catch (caught) { setError(friendlyError(caught)) } finally { setSaving(false) }
  }

  async function archiveItem(item: InventoryItem) {
    if (!activeOrganization || !window.confirm(`Archive ${item.name}? This is blocked while stock remains.`)) return
    try {
      await apiFetch(`/v1/inventory/items/${item.id}/archive`, { method: 'POST', body: JSON.stringify({ organizationId: activeOrganization.id }) })
      await loadAll()
    } catch (caught) { setError(friendlyError(caught)) }
  }

  async function saveWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return
    const input = { organizationId: activeOrganization.id, ...(warehouseForm.id ? { warehouseId: warehouseForm.id } : {}), code: warehouseForm.code, name: warehouseForm.name }
    const parsed = warehouseForm.id ? updateWarehouseSchema.safeParse(input) : createWarehouseSchema.safeParse(input)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the warehouse details.'); return }

    setSaving(true); setError(null)
    try {
      await apiFetch(warehouseForm.id ? `/v1/inventory/warehouses/${warehouseForm.id}` : '/v1/inventory/warehouses', {
        method: warehouseForm.id ? 'PATCH' : 'POST', body: JSON.stringify(parsed.data),
      })
      setWarehouseForm(emptyWarehouse)
      await loadAll()
    } catch (caught) { setError(friendlyError(caught)) } finally { setSaving(false) }
  }

  async function archiveWarehouse(warehouse: Warehouse) {
    if (!activeOrganization || !window.confirm(`Archive ${warehouse.name}? This is blocked while stock remains.`)) return
    try {
      await apiFetch(`/v1/inventory/warehouses/${warehouse.id}/archive`, { method: 'POST', body: JSON.stringify({ organizationId: activeOrganization.id }) })
      await loadAll()
    } catch (caught) { setError(friendlyError(caught)) }
  }

  async function postStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return
    const parsed = postInventoryMovementSchema.safeParse({
      organizationId: activeOrganization.id,
      itemId: stockForm.itemId,
      warehouseId: stockForm.warehouseId,
      movementType: stockForm.operation,
      quantity: signedQuantity(stockForm.operation, stockForm.quantity),
      unitCost: stockForm.unitCost || undefined,
      referenceType: 'manual_inventory',
      requestKey: `web-inventory-${crypto.randomUUID()}`,
    })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the movement details.'); return }

    setSaving(true); setError(null)
    try {
      await apiFetch('/v1/inventory/movements', { method: 'POST', body: JSON.stringify(parsed.data) })
      setStockForm((current) => ({ ...current, quantity: '', unitCost: '' }))
      await loadAll()
    } catch (caught) { setError(friendlyError(caught)) } finally { setSaving(false) }
  }

  async function transferStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return
    const parsed = transferInventorySchema.safeParse({
      organizationId: activeOrganization.id,
      ...transferForm,
      requestKey: `web-transfer-${crypto.randomUUID()}`,
    })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the transfer details.'); return }

    setSaving(true); setError(null)
    try {
      await apiFetch('/v1/inventory/transfers', { method: 'POST', body: JSON.stringify(parsed.data) })
      setTransferForm((current) => ({ ...current, quantity: '' }))
      await loadAll()
    } catch (caught) { setError(friendlyError(caught)) } finally { setSaving(false) }
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Inventory</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading inventory-heading"><div><p className="eyebrow">{activeOrganization.name}</p><h1>Inventory</h1><p className="muted">Items, warehouses, balances, movements and atomic warehouse transfers.</p></div></div>
      {error ? <p className="error-message inventory-error" role="alert">{error}</p> : null}

      <div className="inventory-master-grid">
        <section className="panel">
          <div className="panel-heading"><h2>Items</h2><span className="record-count">{items.filter((item) => item.is_active).length} active</span></div>
          <form className="inventory-form" onSubmit={saveItem}>
            <label>SKU<input required maxLength={80} value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} /></label>
            <label>Name<input required maxLength={200} value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></label>
            <label>Base unit<input required maxLength={20} value={itemForm.baseUom} onChange={(e) => setItemForm({ ...itemForm, baseUom: e.target.value })} /></label>
            <label className="inventory-check"><input type="checkbox" checked={itemForm.trackInventory} onChange={(e) => setItemForm({ ...itemForm, trackInventory: e.target.checked })} />Track stock</label>
            <label className="inventory-full-field">Description<input maxLength={2000} value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></label>
            <div className="inventory-actions inventory-full-field"><button className="primary-button" disabled={saving} type="submit">{itemForm.id ? 'Update item' : 'Add item'}</button>{itemForm.id ? <button className="text-button" type="button" onClick={() => setItemForm(emptyItem)}>Cancel</button> : null}</div>
          </form>
          <div className="inventory-master-list">{items.map((item) => <article key={item.id} className={!item.is_active ? 'archived' : ''}><span><strong>{item.sku} · {item.name}</strong><small>{item.base_uom} · {item.track_inventory ? 'Tracked' : 'Service/non-stock'}{!item.is_active ? ' · Archived' : ''}</small></span>{item.is_active ? <span className="inventory-actions"><button className="text-button" type="button" onClick={() => setItemForm({ id: item.id, sku: item.sku, name: item.name, description: item.description ?? '', baseUom: item.base_uom, trackInventory: item.track_inventory })}>Edit</button><button className="text-button danger-text" type="button" onClick={() => void archiveItem(item)}>Archive</button></span> : null}</article>)}</div>
        </section>

        <section className="panel">
          <div className="panel-heading"><h2>Warehouses</h2><span className="record-count">{activeWarehouses.length} active</span></div>
          <form className="inventory-form" onSubmit={saveWarehouse}>
            <label>Code<input required maxLength={40} value={warehouseForm.code} onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })} /></label>
            <label>Name<input required maxLength={120} value={warehouseForm.name} onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })} /></label>
            <div className="inventory-actions inventory-full-field"><button className="primary-button" disabled={saving} type="submit">{warehouseForm.id ? 'Update warehouse' : 'Add warehouse'}</button>{warehouseForm.id ? <button className="text-button" type="button" onClick={() => setWarehouseForm(emptyWarehouse)}>Cancel</button> : null}</div>
          </form>
          <div className="inventory-master-list">{warehouses.map((warehouse) => <article key={warehouse.id} className={!warehouse.is_active ? 'archived' : ''}><span><strong>{warehouse.code} · {warehouse.name}</strong><small>{warehouse.is_active ? 'Active' : 'Archived'}</small></span>{warehouse.is_active ? <span className="inventory-actions"><button className="text-button" type="button" onClick={() => setWarehouseForm({ id: warehouse.id, code: warehouse.code, name: warehouse.name })}>Edit</button><button className="text-button danger-text" type="button" onClick={() => void archiveWarehouse(warehouse)}>Archive</button></span> : null}</article>)}</div>
        </section>
      </div>

      <div className="inventory-operation-grid">
        <section className="panel">
          <div className="panel-heading"><h2>Post stock movement</h2></div>
          <form className="inventory-form" onSubmit={postStock}>
            <label>Item<select required value={stockForm.itemId} onChange={(e) => setStockForm({ ...stockForm, itemId: e.target.value })}><option value="">Select item</option>{trackedItems.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
            <label>Warehouse<select required value={stockForm.warehouseId} onChange={(e) => setStockForm({ ...stockForm, warehouseId: e.target.value })}><option value="">Select warehouse</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>Operation<select value={stockForm.operation} onChange={(e) => setStockForm({ ...stockForm, operation: e.target.value as StockForm['operation'] })}><option value="receipt">Receipt</option><option value="adjustment_in">Adjustment in</option><option value="adjustment_out">Adjustment out</option></select></label>
            <label>Quantity<input required inputMode="decimal" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} /></label>
            <label>Unit cost (optional)<input inputMode="decimal" value={stockForm.unitCost} onChange={(e) => setStockForm({ ...stockForm, unitCost: e.target.value })} /></label>
            <div className="inventory-actions inventory-full-field"><button className="primary-button" disabled={saving} type="submit">Post movement</button></div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading"><h2>Transfer stock</h2></div>
          <form className="inventory-form" onSubmit={transferStock}>
            <label>Item<select required value={transferForm.itemId} onChange={(e) => setTransferForm({ ...transferForm, itemId: e.target.value })}><option value="">Select item</option>{trackedItems.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
            <label>From<select required value={transferForm.fromWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, fromWarehouseId: e.target.value })}><option value="">Select source</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>To<select required value={transferForm.toWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, toWarehouseId: e.target.value })}><option value="">Select destination</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label>Quantity<input required inputMode="decimal" value={transferForm.quantity} onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })} /></label>
            <p className="inventory-note inventory-full-field">Transfer out and transfer in are committed in one database transaction. If either side fails, neither stock balance changes.</p>
            <div className="inventory-actions inventory-full-field"><button className="primary-button" disabled={saving} type="submit">Transfer</button></div>
          </form>
        </section>
      </div>

      <section className="panel inventory-balance-panel">
        <div className="panel-heading"><h2>Stock balances</h2><span className="record-count">{loading ? 'Loading…' : `${balances.length} positions`}</span></div>
        {balances.length === 0 ? <p className="empty-state">No stock balances yet.</p> : <div className="inventory-table"><div className="inventory-table-head"><span>Item</span><span>Warehouse</span><span>On hand</span></div>{balances.map((balance) => <div className="inventory-table-row" key={`${balance.item_id}-${balance.warehouse_id}`}><span>{itemById.get(balance.item_id)?.sku ?? balance.item_id}<small>{itemById.get(balance.item_id)?.name}</small></span><span>{warehouseById.get(balance.warehouse_id)?.code ?? balance.warehouse_id}<small>{warehouseById.get(balance.warehouse_id)?.name}</small></span><strong>{String(balance.quantity_on_hand)} {itemById.get(balance.item_id)?.base_uom ?? ''}</strong></div>)}</div>}
      </section>

      <section className="panel inventory-movement-panel">
        <div className="panel-heading"><h2>Recent movements</h2><span className="record-count">{movements.length} shown</span></div>
        {movements.length === 0 ? <p className="empty-state">No stock movements yet.</p> : <div className="inventory-table movements"><div className="inventory-table-head"><span>When / type</span><span>Item / warehouse</span><span>Quantity</span></div>{movements.map((movement) => <div className="inventory-table-row" key={movement.id}><span>{new Date(movement.occurred_at).toLocaleString()}<small>{movement.movement_type.replace('_', ' ')}</small></span><span>{itemById.get(movement.item_id)?.sku ?? movement.item_id}<small>{warehouseById.get(movement.warehouse_id)?.code ?? movement.warehouse_id}{movement.reference_type ? ` · ${movement.reference_type}` : ''}</small></span><strong>{String(movement.quantity)} {itemById.get(movement.item_id)?.base_uom ?? ''}</strong></div>)}</div>}
      </section>
    </section>
  )
}
