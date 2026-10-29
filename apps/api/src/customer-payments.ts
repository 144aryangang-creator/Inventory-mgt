import {
  allocateCustomerPaymentSchema,
  createCustomerPaymentSchema,
  invoicePaymentBalanceQuerySchema,
  listCustomerPaymentsQuerySchema,
  recordAndAllocateInvoicePaymentSchema,
} from '@inventory/contracts/customer-payments'
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

export const customerPaymentRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

customerPaymentRoutes.get('/', async (c) => {
  const parsed = listCustomerPaymentsQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    customerPartyId: c.req.query('customerPartyId') || undefined,
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('customer_payments')
    .select('id,customer_party_id,payment_date,amount,currency_code,method,reference,notes,request_key,created_at')
    .eq('organization_id', input.organizationId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1)

  if (input.customerPartyId) query = query.eq('customer_party_id', input.customerPartyId)

  const { data, error } = await query
  if (error) {
    console.error('customer_payments_list_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

customerPaymentRoutes.post('/', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = createCustomerPaymentSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_customer_payment', {
    p_organization_id: input.organizationId,
    p_customer_party_id: input.customerPartyId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_currency_code: input.currencyCode,
    p_method: input.method,
    p_request_key: input.requestKey,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
  })

  if (error) {
    console.error('customer_payment_create_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '23503') return c.json({ error: 'customer_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'payment_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'invalid_payment', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ paymentId: data, requestId: c.get('requestId') }, 201)
})

customerPaymentRoutes.post('/:paymentId/allocations', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = allocateCustomerPaymentSchema.safeParse({ ...body, paymentId: c.req.param('paymentId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('allocate_customer_payment', {
    p_organization_id: input.organizationId,
    p_payment_id: input.paymentId,
    p_financial_document_id: input.documentId,
    p_amount: input.amount,
    p_request_key: input.requestKey,
  })

  if (error) {
    console.error('customer_payment_allocation_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'payment_or_invoice_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'allocation_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'allocation_not_allowed', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ allocationId: data, requestId: c.get('requestId') }, 201)
})

customerPaymentRoutes.post('/invoice/:documentId/receipt', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = recordAndAllocateInvoicePaymentSchema.safeParse({
    ...body,
    documentId: c.req.param('documentId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('record_and_allocate_invoice_payment', {
    p_organization_id: input.organizationId,
    p_customer_party_id: input.customerPartyId,
    p_financial_document_id: input.documentId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_currency_code: input.currencyCode,
    p_method: input.method,
    p_payment_request_key: input.paymentRequestKey,
    p_allocation_request_key: input.allocationRequestKey,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
  })

  if (error) {
    console.error('invoice_payment_receipt_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '23503' || error.code === 'P0002') return c.json({ error: 'payment_or_invoice_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'payment_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'allocation_not_allowed', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  const row = Array.isArray(data) ? data[0] ?? null : data
  return c.json({
    paymentId: row?.payment_id ?? null,
    allocationId: row?.allocation_id ?? null,
    requestId: c.get('requestId'),
  }, 201)
})

customerPaymentRoutes.get('/invoice/:documentId/balance', async (c) => {
  const parsed = invoicePaymentBalanceQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    documentId: c.req.param('documentId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data, error } = await c.get('supabase').rpc('invoice_payment_balance', {
    p_organization_id: parsed.data.organizationId,
    p_financial_document_id: parsed.data.documentId,
  })

  if (error) {
    console.error('invoice_payment_balance_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  const balance = Array.isArray(data) ? data[0] ?? null : data
  return c.json({ data: balance, requestId: c.get('requestId') })
})
