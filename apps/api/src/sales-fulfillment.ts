import { fulfillSalesInvoiceSchema } from '@inventory/contracts/sales-fulfillment'
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

export const salesFulfillmentRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

salesFulfillmentRoutes.get('/:documentId/fulfillment', async (c) => {
  const parsed = fulfillSalesInvoiceSchema.pick({ organizationId: true, documentId: true }).safeParse({
    organizationId: c.req.query('organizationId'),
    documentId: c.req.param('documentId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data: fulfillment, error } = await c
    .get('supabase')
    .from('sales_fulfillments')
    .select('id,financial_document_id,warehouse_id,request_key,posted_at,created_by')
    .eq('organization_id', parsed.data.organizationId)
    .eq('financial_document_id', parsed.data.documentId)
    .maybeSingle()

  if (error) {
    console.error('sales_fulfillment_read_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: fulfillment, requestId: c.get('requestId') })
})

salesFulfillmentRoutes.post('/:documentId/fulfill', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = fulfillSalesInvoiceSchema.safeParse({ ...body, documentId: c.req.param('documentId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data, error } = await c.get('supabase').rpc('fulfill_sales_invoice', {
    p_organization_id: parsed.data.organizationId,
    p_financial_document_id: parsed.data.documentId,
    p_warehouse_id: parsed.data.warehouseId,
    p_request_key: parsed.data.requestKey,
  })

  if (error) {
    console.error('sales_fulfillment_post_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'issued_invoice_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '23503') return c.json({ error: 'invalid_warehouse_or_reference', requestId: c.get('requestId') }, 400)
    if (error.code === '22023') return c.json({ error: 'fulfillment_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'insufficient_stock_or_not_fulfillable', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ fulfillmentId: data, requestId: c.get('requestId') }, 201)
})
