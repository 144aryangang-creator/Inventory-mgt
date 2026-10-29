import {
  cancelFinancialDocumentSchema,
  createFinancialDocumentDraftSchema,
  issueFinancialDocumentSchema,
  removeFinancialDocumentLineSchema,
  upsertFinancialDocumentLineSchema,
} from '@inventory/contracts/financial-documents'
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

export const financialDocumentRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

financialDocumentRoutes.post('/', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = createFinancialDocumentDraftSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_financial_document_draft', {
    p_organization_id: input.organizationId,
    p_document_type: input.documentType,
    p_document_date: input.documentDate,
    p_series_code: input.seriesCode,
    p_supply_type: input.supplyType,
    p_supplier_snapshot: input.supplierSnapshot,
    p_bill_to_snapshot: input.billToSnapshot,
    p_recipient_party_id: input.recipientPartyId ?? null,
    p_linked_document_id: input.linkedDocumentId ?? null,
    p_currency_code: input.currencyCode,
    p_supplier_state_code: input.supplierStateCode ?? null,
    p_place_of_supply_state_code: input.placeOfSupplyStateCode ?? null,
    p_reverse_charge: input.reverseCharge,
    p_ship_to_snapshot: input.shipToSnapshot,
    p_notes: input.notes ?? null,
  })

  if (error) {
    console.error('financial_document_create_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '23503') return c.json({ error: 'invalid_document_reference', requestId: c.get('requestId') }, 400)
    if (error.code === '22023' || error.code === '23514') return c.json({ error: 'invalid_financial_document', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ documentId: data, requestId: c.get('requestId') }, 201)
})

financialDocumentRoutes.post('/:documentId/lines', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = upsertFinancialDocumentLineSchema.safeParse({ ...body, documentId: c.req.param('documentId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('upsert_financial_document_line', {
    p_organization_id: input.organizationId,
    p_document_id: input.documentId,
    p_line_number: input.lineNumber,
    p_description: input.description,
    p_quantity: input.quantity,
    p_uom: input.uom,
    p_unit_price: input.unitPrice,
    p_taxable_value: input.taxableValue,
    p_item_id: input.itemId ?? null,
    p_item_snapshot: input.itemSnapshot,
    p_hsn_sac: input.hsnSac ?? null,
    p_discount_amount: input.discountAmount,
    p_taxes: input.taxes,
  })

  if (error) {
    console.error('financial_document_line_upsert_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'draft_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '23503') return c.json({ error: 'invalid_item_reference', requestId: c.get('requestId') }, 400)
    if (error.code === '22023' || error.code === '23514' || error.code === '22P02') return c.json({ error: 'invalid_document_line', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ lineId: data, requestId: c.get('requestId') })
})

financialDocumentRoutes.post('/:documentId/lines/:lineNumber/remove', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = removeFinancialDocumentLineSchema.safeParse({
    ...body,
    documentId: c.req.param('documentId'),
    lineNumber: Number(c.req.param('lineNumber')),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { error } = await c.get('supabase').rpc('remove_financial_document_line', {
    p_organization_id: parsed.data.organizationId,
    p_document_id: parsed.data.documentId,
    p_line_number: parsed.data.lineNumber,
  })

  if (error) {
    console.error('financial_document_line_remove_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'line_not_found', requestId: c.get('requestId') }, 404)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})

financialDocumentRoutes.post('/:documentId/issue', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = issueFinancialDocumentSchema.safeParse({ ...body, documentId: c.req.param('documentId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data, error } = await c.get('supabase').rpc('issue_financial_document', {
    p_organization_id: parsed.data.organizationId,
    p_document_id: parsed.data.documentId,
    p_request_key: parsed.data.requestKey,
  })

  if (error) {
    console.error('financial_document_issue_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'document_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'issue_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'document_not_issuable', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ documentNumber: data, requestId: c.get('requestId') })
})

financialDocumentRoutes.post('/:documentId/cancel', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = cancelFinancialDocumentSchema.safeParse({ ...body, documentId: c.req.param('documentId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { error } = await c.get('supabase').rpc('cancel_financial_document', {
    p_organization_id: parsed.data.organizationId,
    p_document_id: parsed.data.documentId,
    p_reason: parsed.data.reason,
  })

  if (error) {
    console.error('financial_document_cancel_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'issued_document_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'invalid_cancellation', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})
