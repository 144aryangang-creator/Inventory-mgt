import {
  listPurchaseReceiptsQuerySchema,
  postPurchaseReceiptSchema,
  purchaseReceiptDetailQuerySchema,
} from '@inventory/contracts/purchase-receipts'
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

export const purchaseReceiptRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

purchaseReceiptRoutes.post('/', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = postPurchaseReceiptSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('post_purchase_receipt', {
    p_organization_id: input.organizationId,
    p_supplier_party_id: input.supplierPartyId,
    p_warehouse_id: input.warehouseId,
    p_lines: input.lines,
    p_request_key: input.requestKey,
    p_supplier_reference: input.supplierReference ?? null,
    p_notes: input.notes ?? null,
    p_received_at: input.receivedAt ?? null,
  })

  if (error) {
    console.error('purchase_receipt_post_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '23505') return c.json({ error: 'purchase_receipt_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23503') return c.json({ error: 'invalid_supplier_item_or_warehouse', requestId: c.get('requestId') }, 400)
    if (error.code === '22023' || error.code === '23514') return c.json({ error: 'invalid_purchase_receipt', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ receiptId: data, requestId: c.get('requestId') }, 201)
})

purchaseReceiptRoutes.get('/', async (c) => {
  const parsed = listPurchaseReceiptsQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    supplierPartyId: c.req.query('supplierPartyId') || undefined,
    warehouseId: c.req.query('warehouseId') || undefined,
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('purchase_receipts')
    .select('id,receipt_number,supplier_party_id,supplier_snapshot,warehouse_id,supplier_reference,notes,received_at,created_at,created_by')
    .eq('organization_id', input.organizationId)
    .order('received_at', { ascending: false })
    .order('receipt_number', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1)

  if (input.supplierPartyId) query = query.eq('supplier_party_id', input.supplierPartyId)
  if (input.warehouseId) query = query.eq('warehouse_id', input.warehouseId)

  const { data, error } = await query
  if (error) {
    console.error('purchase_receipt_list_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: data ?? [], requestId: c.get('requestId') })
})

purchaseReceiptRoutes.get('/:receiptId', async (c) => {
  const parsed = purchaseReceiptDetailQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    receiptId: c.req.param('receiptId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const supabase = c.get('supabase')
  const { data: receipt, error: receiptError } = await supabase
    .from('purchase_receipts')
    .select('id,receipt_number,supplier_party_id,supplier_snapshot,warehouse_id,supplier_reference,notes,received_at,created_at,created_by')
    .eq('organization_id', input.organizationId)
    .eq('id', input.receiptId)
    .maybeSingle()

  if (receiptError) {
    console.error('purchase_receipt_detail_failed', { requestId: c.get('requestId'), code: receiptError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  if (!receipt) return c.json({ error: 'purchase_receipt_not_found', requestId: c.get('requestId') }, 404)

  const { data: lines, error: lineError } = await supabase
    .from('purchase_receipt_lines')
    .select('line_number,item_id,item_snapshot,uom,quantity,unit_cost,inventory_movement_id,created_at')
    .eq('organization_id', input.organizationId)
    .eq('receipt_id', input.receiptId)
    .order('line_number', { ascending: true })

  if (lineError) {
    console.error('purchase_receipt_lines_read_failed', { requestId: c.get('requestId'), code: lineError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: { receipt, lines: lines ?? [] }, requestId: c.get('requestId') })
})
