import {
  fulfillSalesInvoiceSchema,
  issueSalesReturnCreditNoteSchema,
  returnSalesFulfillmentSchema,
  salesReturnCreditHistoryQuerySchema,
  salesReturnHistoryQuerySchema,
} from '@inventory/contracts/sales-fulfillment'
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

  if (!fulfillment) return c.json({ data: null, lines: [], requestId: c.get('requestId') })

  const { data: lines, error: lineError } = await c
    .get('supabase')
    .from('sales_fulfillment_lines')
    .select('financial_document_line_id,item_id,inventory_movement_id,quantity,created_at')
    .eq('organization_id', parsed.data.organizationId)
    .eq('fulfillment_id', fulfillment.id)
    .order('created_at', { ascending: true })

  if (lineError) {
    console.error('sales_fulfillment_lines_read_failed', { requestId: c.get('requestId'), code: lineError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: fulfillment, lines: lines ?? [], requestId: c.get('requestId') })
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

salesFulfillmentRoutes.post('/fulfillments/:fulfillmentId/returns', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = returnSalesFulfillmentSchema.safeParse({ ...body, fulfillmentId: c.req.param('fulfillmentId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('return_sales_fulfillment', {
    p_organization_id: input.organizationId,
    p_fulfillment_id: input.fulfillmentId,
    p_lines: input.lines,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  })

  if (error) {
    console.error('sales_return_post_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'fulfillment_or_line_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'return_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'return_quantity_not_allowed', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ returnId: data, requestId: c.get('requestId') }, 201)
})

salesFulfillmentRoutes.get('/fulfillments/:fulfillmentId/returns', async (c) => {
  const parsed = salesReturnHistoryQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    fulfillmentId: c.req.param('fulfillmentId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data: returns, error: returnError } = await c
    .get('supabase')
    .from('sales_returns')
    .select('id,fulfillment_id,reason,request_key,posted_at')
    .eq('organization_id', input.organizationId)
    .eq('fulfillment_id', input.fulfillmentId)
    .order('posted_at', { ascending: true })

  if (returnError) {
    console.error('sales_returns_read_failed', { requestId: c.get('requestId'), code: returnError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  const returnIds = (returns ?? []).map((entry) => entry.id)
  if (returnIds.length === 0) return c.json({ data: [], lines: [], requestId: c.get('requestId') })

  const { data: lines, error: lineError } = await c
    .get('supabase')
    .from('sales_return_lines')
    .select('return_id,fulfillment_id,fulfillment_line_id,item_id,inventory_movement_id,quantity,created_at')
    .eq('organization_id', input.organizationId)
    .in('return_id', returnIds)
    .order('created_at', { ascending: true })

  if (lineError) {
    console.error('sales_return_lines_read_failed', { requestId: c.get('requestId'), code: lineError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: returns, lines: lines ?? [], requestId: c.get('requestId') })
})

salesFulfillmentRoutes.post('/returns/:salesReturnId/credit-note', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = issueSalesReturnCreditNoteSchema.safeParse({ ...body, salesReturnId: c.req.param('salesReturnId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('issue_sales_return_credit_note', {
    p_organization_id: input.organizationId,
    p_sales_return_id: input.salesReturnId,
    p_lines: input.lines,
    p_document_date: input.documentDate,
    p_series_code: input.seriesCode,
    p_request_key: input.requestKey,
  })

  if (error) {
    console.error('sales_return_credit_note_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'return_or_source_line_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'credit_note_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'credit_quantity_not_allowed', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ creditNoteId: data, requestId: c.get('requestId') }, 201)
})

salesFulfillmentRoutes.get('/returns/:salesReturnId/credits', async (c) => {
  const parsed = salesReturnCreditHistoryQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    salesReturnId: c.req.param('salesReturnId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data: links, error: linkError } = await c
    .get('supabase')
    .from('sales_return_credit_notes')
    .select('id,sales_return_id,credit_note_id,document_date,series_code,request_key,created_at')
    .eq('organization_id', input.organizationId)
    .eq('sales_return_id', input.salesReturnId)
    .order('created_at', { ascending: true })

  if (linkError) {
    console.error('sales_return_credit_links_read_failed', { requestId: c.get('requestId'), code: linkError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  const creditNoteIds = (links ?? []).map((link) => link.credit_note_id)
  if (creditNoteIds.length === 0) return c.json({ data: [], allocations: [], documents: [], requestId: c.get('requestId') })

  const [{ data: allocations, error: allocationError }, { data: documents, error: documentError }] = await Promise.all([
    c.get('supabase')
      .from('sales_return_credit_allocations')
      .select('sales_return_credit_note_id,sales_return_id,fulfillment_line_id,credit_note_id,credit_note_line_id,quantity,created_at')
      .eq('organization_id', input.organizationId)
      .in('credit_note_id', creditNoteIds),
    c.get('supabase')
      .from('financial_documents')
      .select('id,status,document_number,document_date,grand_total,currency_code,cancelled_at,cancellation_reason')
      .eq('organization_id', input.organizationId)
      .in('id', creditNoteIds),
  ])

  if (allocationError || documentError) {
    console.error('sales_return_credit_history_failed', {
      requestId: c.get('requestId'),
      allocationCode: allocationError?.code,
      documentCode: documentError?.code,
    })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: links, allocations: allocations ?? [], documents: documents ?? [], requestId: c.get('requestId') })
})
