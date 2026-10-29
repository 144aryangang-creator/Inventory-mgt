import {
  cancelFinancialDocumentSchema,
  createFinancialDocumentDraftSchema,
  financialDocumentDetailQuerySchema,
  issueFinancialDocumentSchema,
  listFinancialDocumentsQuerySchema,
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

financialDocumentRoutes.get('/', async (c) => {
  const parsed = listFinancialDocumentsQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    documentType: c.req.query('documentType') || undefined,
    status: c.req.query('status') || undefined,
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('financial_documents')
    .select('id,document_type,status,document_date,financial_year_start_year,series_code,document_number,supplier_profile_id,recipient_party_id,billing_address_id,shipping_address_id,recipient_tax_registration_id,linked_document_id,currency_code,supply_type,place_of_supply_state_code,reverse_charge,grand_total,issued_at,cancelled_at,created_at,updated_at')
    .eq('organization_id', input.organizationId)
    .order('document_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1)

  if (input.documentType) query = query.eq('document_type', input.documentType)
  if (input.status) query = query.eq('status', input.status)

  const { data, error } = await query
  if (error) {
    console.error('financial_document_list_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

financialDocumentRoutes.get('/:documentId', async (c) => {
  const parsed = financialDocumentDetailQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    documentId: c.req.param('documentId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const supabase = c.get('supabase')
  const { data: document, error: documentError } = await supabase
    .from('financial_documents')
    .select('id,organization_id,document_type,status,document_date,financial_year_start_year,series_code,document_number,supplier_profile_id,recipient_party_id,billing_address_id,shipping_address_id,recipient_tax_registration_id,linked_document_id,currency_code,supply_type,supplier_state_code,place_of_supply_state_code,reverse_charge,supplier_snapshot,bill_to_snapshot,ship_to_snapshot,subtotal,discount_total,taxable_total,cgst_total,sgst_total,utgst_total,igst_total,cess_total,round_off,grand_total,notes,issued_at,cancelled_at,cancellation_reason,created_at,updated_at')
    .eq('organization_id', input.organizationId)
    .eq('id', input.documentId)
    .maybeSingle()

  if (documentError) {
    console.error('financial_document_detail_failed', { requestId: c.get('requestId'), code: documentError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  if (!document) return c.json({ error: 'document_not_found', requestId: c.get('requestId') }, 404)

  const { data: lines, error: lineError } = await supabase
    .from('financial_document_lines')
    .select('id,line_number,item_id,item_snapshot,description,hsn_sac,quantity,uom,unit_price,discount_amount,taxable_value')
    .eq('organization_id', input.organizationId)
    .eq('document_id', input.documentId)
    .order('line_number', { ascending: true })

  if (lineError) {
    console.error('financial_document_lines_read_failed', { requestId: c.get('requestId'), code: lineError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  const lineIds = (lines ?? []).map((line) => line.id as string)
  let taxes: unknown[] = []
  if (lineIds.length > 0) {
    const { data: taxRows, error: taxError } = await supabase
      .from('financial_document_line_taxes')
      .select('line_id,component,rate,amount')
      .eq('organization_id', input.organizationId)
      .in('line_id', lineIds)
      .order('component', { ascending: true })

    if (taxError) {
      console.error('financial_document_taxes_read_failed', { requestId: c.get('requestId'), code: taxError.code })
      return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
    }
    taxes = taxRows ?? []
  }

  return c.json({ data: { document, lines: lines ?? [], taxes }, requestId: c.get('requestId') })
})

financialDocumentRoutes.post('/', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = createFinancialDocumentDraftSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_financial_document_draft_from_profiles', {
    p_organization_id: input.organizationId,
    p_supplier_profile_id: input.supplierProfileId,
    p_document_type: input.documentType,
    p_document_date: input.documentDate,
    p_series_code: input.seriesCode,
    p_supply_type: input.supplyType,
    p_recipient_party_id: input.recipientPartyId,
    p_billing_address_id: input.billingAddressId,
    p_shipping_address_id: input.shippingAddressId ?? null,
    p_recipient_tax_registration_id: input.recipientTaxRegistrationId ?? null,
    p_linked_document_id: input.linkedDocumentId ?? null,
    p_currency_code: input.currencyCode,
    p_place_of_supply_state_code: input.placeOfSupplyStateCode ?? null,
    p_reverse_charge: input.reverseCharge,
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
  const { data, error } = await c.get('supabase').rpc('upsert_financial_document_line_calculated', {
    p_organization_id: input.organizationId,
    p_document_id: input.documentId,
    p_line_number: input.lineNumber,
    p_description: input.description,
    p_quantity: input.quantity,
    p_uom: input.uom,
    p_unit_price: input.unitPrice,
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
    if (error.code === '23514') return c.json({ error: 'fulfilled_invoice_requires_stock_reversal', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})
