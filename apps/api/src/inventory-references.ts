import {
  archiveInventoryItemSchema,
  archiveWarehouseSchema,
  createInventoryItemSchema,
  createWarehouseSchema,
  inventoryBalanceQuerySchema,
  inventoryMasterListQuerySchema,
  inventoryMovementListQuerySchema,
  transferInventorySchema,
  updateInventoryItemSchema,
  updateWarehouseSchema,
} from '@inventory/contracts/inventory-workspace'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Hono, type Context } from 'hono'

type Env = {
  Bindings: {
    APP_ORIGIN: string
    SUPABASE_URL: string
    SUPABASE_PUBLISHABLE_KEY: string
  }
  Variables: {
    requestId: string
    supabase: SupabaseClient
    userId: string
  }
}

export const inventoryReferenceRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

function mutationError(c: Context<Env>, error: { code?: string }, entity: 'item' | 'warehouse' | 'transfer') {
  if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
  if (error.code === 'P0002') return c.json({ error: `${entity}_not_found`, requestId: c.get('requestId') }, 404)
  if (error.code === '23505') return c.json({ error: `${entity}_code_conflict`, requestId: c.get('requestId') }, 409)
  if (error.code === '22023') return c.json({ error: 'idempotency_conflict', requestId: c.get('requestId') }, 409)
  if (error.code === '23514') return c.json({ error: `${entity}_operation_not_allowed`, requestId: c.get('requestId') }, 409)
  return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
}

inventoryReferenceRoutes.get('/items', async (c) => {
  const parsed = inventoryMasterListQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    status: c.req.query('status') || undefined,
    query: c.req.query('q') || undefined,
    limit: c.req.query('limit') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('items')
    .select('id,sku,name,description,base_uom,track_inventory,is_active,custom_data,created_at,updated_at')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true })
    .limit(input.limit)

  if (input.status !== 'all') query = query.eq('is_active', input.status === 'active')
  if (input.query) {
    const safeQuery = input.query.replace(/[%_]/g, '').trim()
    if (safeQuery) query = query.or(`name.ilike.%${safeQuery}%,sku.ilike.%${safeQuery}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('inventory_items_reference_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.post('/items', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  const parsed = createInventoryItemSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_item', {
    p_organization_id: input.organizationId,
    p_sku: input.sku,
    p_name: input.name,
    p_description: input.description ?? null,
    p_base_uom: input.baseUom,
    p_track_inventory: input.trackInventory,
    p_custom_data: input.customData,
  })
  if (error) {
    console.error('inventory_item_create_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'item')
  }
  return c.json({ itemId: data, requestId: c.get('requestId') }, 201)
})

inventoryReferenceRoutes.patch('/items/:itemId', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)
  const parsed = updateInventoryItemSchema.safeParse({ ...body, itemId: c.req.param('itemId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { error } = await c.get('supabase').rpc('update_item', {
    p_organization_id: input.organizationId,
    p_item_id: input.itemId,
    p_sku: input.sku,
    p_name: input.name,
    p_description: input.description ?? null,
    p_base_uom: input.baseUom,
    p_track_inventory: input.trackInventory,
    p_custom_data: input.customData,
  })
  if (error) {
    console.error('inventory_item_update_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'item')
  }
  return c.json({ ok: true, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.post('/items/:itemId/archive', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)
  const parsed = archiveInventoryItemSchema.safeParse({ ...body, itemId: c.req.param('itemId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { error } = await c.get('supabase').rpc('archive_item', {
    p_organization_id: parsed.data.organizationId,
    p_item_id: parsed.data.itemId,
  })
  if (error) {
    console.error('inventory_item_archive_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'item')
  }
  return c.json({ ok: true, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.get('/warehouses', async (c) => {
  const parsed = inventoryMasterListQuerySchema.pick({ organizationId: true, status: true, query: true, limit: true }).safeParse({
    organizationId: c.req.query('organizationId'),
    status: c.req.query('status') || undefined,
    query: c.req.query('q') || undefined,
    limit: c.req.query('limit') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('warehouses')
    .select('id,code,name,is_active,created_at,updated_at')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true })
    .limit(input.limit)

  if (input.status !== 'all') query = query.eq('is_active', input.status === 'active')
  if (input.query) {
    const safeQuery = input.query.replace(/[%_]/g, '').trim()
    if (safeQuery) query = query.or(`name.ilike.%${safeQuery}%,code.ilike.%${safeQuery}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('inventory_warehouses_reference_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  return c.json({ data, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.post('/warehouses', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  const parsed = createWarehouseSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)
  const { data, error } = await c.get('supabase').rpc('create_warehouse', {
    p_organization_id: parsed.data.organizationId,
    p_code: parsed.data.code,
    p_name: parsed.data.name,
  })
  if (error) {
    console.error('inventory_warehouse_create_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'warehouse')
  }
  return c.json({ warehouseId: data, requestId: c.get('requestId') }, 201)
})

inventoryReferenceRoutes.patch('/warehouses/:warehouseId', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)
  const parsed = updateWarehouseSchema.safeParse({ ...body, warehouseId: c.req.param('warehouseId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)
  const { error } = await c.get('supabase').rpc('update_warehouse', {
    p_organization_id: parsed.data.organizationId,
    p_warehouse_id: parsed.data.warehouseId,
    p_code: parsed.data.code,
    p_name: parsed.data.name,
  })
  if (error) {
    console.error('inventory_warehouse_update_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'warehouse')
  }
  return c.json({ ok: true, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.post('/warehouses/:warehouseId/archive', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)
  const parsed = archiveWarehouseSchema.safeParse({ ...body, warehouseId: c.req.param('warehouseId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)
  const { error } = await c.get('supabase').rpc('archive_warehouse', {
    p_organization_id: parsed.data.organizationId,
    p_warehouse_id: parsed.data.warehouseId,
  })
  if (error) {
    console.error('inventory_warehouse_archive_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'warehouse')
  }
  return c.json({ ok: true, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.get('/balances', async (c) => {
  const parsed = inventoryBalanceQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    itemId: c.req.query('itemId') || undefined,
    warehouseId: c.req.query('warehouseId') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  let query = c.get('supabase')
    .from('inventory_balances')
    .select('item_id,warehouse_id,quantity_on_hand,updated_at')
    .eq('organization_id', parsed.data.organizationId)
    .order('updated_at', { ascending: false })
  if (parsed.data.itemId) query = query.eq('item_id', parsed.data.itemId)
  if (parsed.data.warehouseId) query = query.eq('warehouse_id', parsed.data.warehouseId)
  const { data, error } = await query
  if (error) {
    console.error('inventory_balances_read_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  return c.json({ data, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.get('/movements', async (c) => {
  const parsed = inventoryMovementListQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    itemId: c.req.query('itemId') || undefined,
    warehouseId: c.req.query('warehouseId') || undefined,
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c.get('supabase')
    .from('inventory_movements')
    .select('id,item_id,warehouse_id,movement_type,quantity,unit_cost,reference_type,reference_id,request_key,occurred_at,created_at')
    .eq('organization_id', input.organizationId)
    .order('occurred_at', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1)
  if (input.itemId) query = query.eq('item_id', input.itemId)
  if (input.warehouseId) query = query.eq('warehouse_id', input.warehouseId)
  const { data, error } = await query
  if (error) {
    console.error('inventory_movements_read_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  return c.json({ data, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.post('/transfers', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  const parsed = transferInventorySchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)
  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('transfer_inventory', {
    p_organization_id: input.organizationId,
    p_item_id: input.itemId,
    p_from_warehouse_id: input.fromWarehouseId,
    p_to_warehouse_id: input.toWarehouseId,
    p_quantity: input.quantity,
    p_request_key: input.requestKey,
  })
  if (error) {
    console.error('inventory_transfer_failed', { requestId: c.get('requestId'), code: error.code })
    return mutationError(c, error, 'transfer')
  }
  return c.json({ outboundMovementId: data, requestId: c.get('requestId') }, 201)
})
