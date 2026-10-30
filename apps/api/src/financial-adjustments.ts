import {
  financialAdjustmentHistoryQuerySchema,
  issueInvoiceAdjustmentSchema,
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

export const financialAdjustmentRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

financialAdjustmentRoutes.post('/', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = issueInvoiceAdjustmentSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('issue_invoice_adjustment', {
    p_organization_id: input.organizationId,
    p_original_invoice_id: input.originalInvoiceId,
    p_adjustment_type: input.adjustmentType,
    p_lines: input.lines,
    p_document_date: input.documentDate,
    p_series_code: input.seriesCode,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  })

  if (error) {
    console.error('financial_adjustment_issue_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'original_invoice_or_line_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023') return c.json({ error: 'adjustment_idempotency_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514') return c.json({ error: 'adjustment_not_allowed', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ adjustmentDocumentId: data, requestId: c.get('requestId') }, 201)
})

financialAdjustmentRoutes.get('/', async (c) => {
  const parsed = financialAdjustmentHistoryQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    originalInvoiceId: c.req.query('originalInvoiceId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const supabase = c.get('supabase')
  const { data: adjustments, error: adjustmentError } = await supabase
    .from('financial_adjustments')
    .select('id,original_invoice_id,adjustment_document_id,adjustment_type,reason,document_date,series_code,request_key,created_at')
    .eq('organization_id', input.organizationId)
    .eq('original_invoice_id', input.originalInvoiceId)
    .order('created_at', { ascending: true })

  if (adjustmentError) {
    console.error('financial_adjustment_history_failed', { requestId: c.get('requestId'), code: adjustmentError.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  const adjustmentIds = (adjustments ?? []).map((entry) => entry.id as string)
  const documentIds = (adjustments ?? []).map((entry) => entry.adjustment_document_id as string)
  if (adjustmentIds.length === 0) {
    return c.json({ data: [], lines: [], documents: [], requestId: c.get('requestId') })
  }

  const [{ data: lines, error: lineError }, { data: documents, error: documentError }] = await Promise.all([
    supabase
      .from('financial_adjustment_lines')
      .select('adjustment_id,original_invoice_line_id,adjustment_document_id,adjustment_document_line_id,basis_quantity,taxable_adjustment,created_at')
      .eq('organization_id', input.organizationId)
      .in('adjustment_id', adjustmentIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('financial_documents')
      .select('id,document_type,status,document_number,document_date,currency_code,taxable_total,cgst_total,sgst_total,utgst_total,igst_total,cess_total,grand_total,cancelled_at,cancellation_reason')
      .eq('organization_id', input.organizationId)
      .in('id', documentIds),
  ])

  if (lineError || documentError) {
    console.error('financial_adjustment_detail_history_failed', {
      requestId: c.get('requestId'),
      lineCode: lineError?.code,
      documentCode: documentError?.code,
    })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: adjustments, lines: lines ?? [], documents: documents ?? [], requestId: c.get('requestId') })
})
