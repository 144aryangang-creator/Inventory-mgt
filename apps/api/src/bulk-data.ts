import {
  BULK_CSV_MAX_BYTES,
  BULK_SCHEMA_VERSION,
  CsvContractError,
  bulkCsvHeaders,
  bulkEntitySchema,
  bulkImportQuerySchema,
  bulkOrganizationQuerySchema,
  encodeSpreadsheetCsv,
  normalizeBulkCsv,
  type BulkEntity,
  type BulkValidationIssue,
  type NormalizedBulkRows,
} from '@inventory/contracts/bulk-data'
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

const EXPORT_MAX_ROWS = 5000
const EXPORT_PAGE_SIZE = 1000

export const bulkDataRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

function entityFromContext(c: Context<Env>): BulkEntity | null {
  const parsed = bulkEntitySchema.safeParse(c.req.param('entity'))
  return parsed.success ? parsed.data : null
}

async function readCsv(c: Context<Env>): Promise<string | Response> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > BULK_CSV_MAX_BYTES) {
    return c.json({ error: 'csv_too_large', requestId: c.get('requestId') }, 413)
  }
  const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('text/csv') && !contentType.startsWith('text/plain')) {
    return c.json({ error: 'content_type_must_be_csv', requestId: c.get('requestId') }, 415)
  }
  return c.req.text()
}

function parseCsv(c: Context<Env>, source: string, entity: BulkEntity) {
  try {
    return normalizeBulkCsv(source, entity)
  } catch (error) {
    if (error instanceof CsvContractError) {
      return c.json({
        error: 'csv_contract_error',
        code: error.code,
        message: error.message,
        ...(error.row ? { row: error.row } : {}),
        requestId: c.get('requestId'),
      }, 400)
    }
    throw error
  }
}

function importType(entity: BulkEntity): string {
  return entity === 'opening-stock' ? 'opening_stock' : entity
}

function normalizeDbIssues(data: unknown): BulkValidationIssue[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const value = entry as Record<string, unknown>
    if (typeof value.row !== 'number' || typeof value.field !== 'string' || typeof value.code !== 'string' || typeof value.message !== 'string') return []
    return [{ row: value.row, field: value.field, code: value.code, message: value.message }]
  })
}

async function authoritativeIssues(
  supabase: SupabaseClient,
  organizationId: string,
  entity: BulkEntity,
  data: NormalizedBulkRows,
): Promise<{ issues: BulkValidationIssue[]; errorCode?: string }> {
  const { data: result, error } = await supabase.rpc('validate_data_import_v1', {
    p_organization_id: organizationId,
    p_import_type: importType(entity),
    p_rows: data.rows,
  })
  if (error) return { issues: [], errorCode: error.code }
  return { issues: normalizeDbIssues(result) }
}

function csvResponse(c: Context<Env>, filename: string, csv: string) {
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-csv-profile': 'spreadsheet-safe',
      'x-schema-version': String(BULK_SCHEMA_VERSION),
      'x-request-id': c.get('requestId'),
    },
  })
}

bulkDataRoutes.get('/:entity/template', (c) => {
  const entity = entityFromContext(c)
  if (!entity) return validationResponse(c)
  const csv = encodeSpreadsheetCsv(bulkCsvHeaders[entity], [])
  return csvResponse(c, `${entity}-v${BULK_SCHEMA_VERSION}-template.csv`, csv)
})

bulkDataRoutes.post('/:entity/validate', async (c) => {
  const entity = entityFromContext(c)
  if (!entity) return validationResponse(c)
  const query = bulkOrganizationQuerySchema.safeParse({ organizationId: c.req.query('organizationId') })
  if (!query.success) return validationResponse(c, query.error.issues)

  const source = await readCsv(c)
  if (source instanceof Response) return source
  const parsed = parseCsv(c, source, entity)
  if (parsed instanceof Response) return parsed
  if (parsed.issues.length > 0 || !parsed.data) {
    return c.json({ valid: false, issues: parsed.issues, requestId: c.get('requestId') }, 422)
  }

  const db = await authoritativeIssues(c.get('supabase'), query.data.organizationId, entity, parsed.data)
  if (db.errorCode) {
    if (db.errorCode === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  if (db.issues.length > 0) {
    return c.json({ valid: false, issues: db.issues, requestId: c.get('requestId') }, 422)
  }

  return c.json({ valid: true, schemaVersion: BULK_SCHEMA_VERSION, rowCount: parsed.data.rows.length, issues: [], requestId: c.get('requestId') })
})

bulkDataRoutes.post('/:entity/import', async (c) => {
  const entity = entityFromContext(c)
  if (!entity) return validationResponse(c)
  const query = bulkImportQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    requestKey: c.req.query('requestKey'),
  })
  if (!query.success) return validationResponse(c, query.error.issues)

  const source = await readCsv(c)
  if (source instanceof Response) return source
  const parsed = parseCsv(c, source, entity)
  if (parsed instanceof Response) return parsed
  if (parsed.issues.length > 0 || !parsed.data) {
    return c.json({ error: 'import_validation_failed', issues: parsed.issues, requestId: c.get('requestId') }, 422)
  }

  const db = await authoritativeIssues(c.get('supabase'), query.data.organizationId, entity, parsed.data)
  if (db.errorCode) {
    if (db.errorCode === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }
  if (db.issues.length > 0) {
    return c.json({ error: 'import_validation_failed', issues: db.issues, requestId: c.get('requestId') }, 422)
  }

  const supabase = c.get('supabase')
  let result: { data: unknown; error: { code: string } | null }
  if (entity === 'items') {
    result = await supabase.rpc('import_items_v1', {
      p_organization_id: query.data.organizationId,
      p_rows: parsed.data.rows,
      p_request_key: query.data.requestKey,
    })
  } else if (entity === 'customers' || entity === 'suppliers') {
    result = await supabase.rpc('import_parties_v1', {
      p_organization_id: query.data.organizationId,
      p_role: entity === 'customers' ? 'customer' : 'supplier',
      p_rows: parsed.data.rows,
      p_request_key: query.data.requestKey,
    })
  } else {
    result = await supabase.rpc('import_opening_stock_v1', {
      p_organization_id: query.data.organizationId,
      p_rows: parsed.data.rows,
      p_request_key: query.data.requestKey,
    })
  }

  if (result.error) {
    console.error('bulk_import_failed', { requestId: c.get('requestId'), entity, code: result.error.code })
    if (result.error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (result.error.code === '22023' || result.error.code === '23505') return c.json({ error: 'import_conflict', requestId: c.get('requestId') }, 409)
    if (result.error.code === '23503' || result.error.code === '23514') return c.json({ error: 'import_validation_failed', requestId: c.get('requestId') }, 422)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ batchId: result.data, schemaVersion: BULK_SCHEMA_VERSION, rowCount: parsed.data.rows.length, requestId: c.get('requestId') }, 201)
})

async function fetchItemExport(supabase: SupabaseClient, organizationId: string) {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; offset <= EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('items')
      .select('sku,name,description,base_uom,track_inventory')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('sku', { ascending: true })
      .range(offset, offset + EXPORT_PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.code }
    const page = (data ?? []) as Record<string, unknown>[]
    rows.push(...page)
    if (rows.length > EXPORT_MAX_ROWS) return { rows, tooLarge: true }
    if (page.length < EXPORT_PAGE_SIZE) break
  }
  return { rows }
}

async function fetchPartyExport(supabase: SupabaseClient, organizationId: string, role: 'customer' | 'supplier') {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; offset <= EXPORT_MAX_ROWS; offset += 100) {
    const { data, error } = await supabase.rpc('search_parties', {
      p_organization_id: organizationId,
      p_role: role,
      p_status: 'active',
      p_query: null,
      p_limit: 100,
      p_offset: offset,
    })
    if (error) return { rows: [], error: error.code }
    const page = (data ?? []) as Record<string, unknown>[]
    rows.push(...page)
    if (rows.length > EXPORT_MAX_ROWS) return { rows, tooLarge: true }
    if (page.length < 100) break
  }
  return { rows }
}

bulkDataRoutes.get('/:entity/export', async (c) => {
  const entity = entityFromContext(c)
  if (!entity) return validationResponse(c)
  const query = bulkOrganizationQuerySchema.safeParse({ organizationId: c.req.query('organizationId') })
  if (!query.success) return validationResponse(c, query.error.issues)

  if (entity === 'opening-stock') {
    return c.json({
      error: 'opening_stock_export_not_supported',
      message: 'Opening stock is initialization data, not a current-stock export. Use the template for imports.',
      requestId: c.get('requestId'),
    }, 400)
  }

  if (entity === 'items') {
    const result = await fetchItemExport(c.get('supabase'), query.data.organizationId)
    if (result.error) return c.json({ error: result.error === '42501' ? 'forbidden' : 'request_failed', requestId: c.get('requestId') }, result.error === '42501' ? 403 : 500)
    if (result.tooLarge) return c.json({ error: 'export_too_large', maxRows: EXPORT_MAX_ROWS, requestId: c.get('requestId') }, 413)
    const csv = encodeSpreadsheetCsv(bulkCsvHeaders.items, result.rows.map((row) => [row.sku, row.name, row.description ?? '', row.base_uom, row.track_inventory]))
    return csvResponse(c, `items-v${BULK_SCHEMA_VERSION}.csv`, csv)
  }

  const role = entity === 'customers' ? 'customer' : 'supplier'
  const result = await fetchPartyExport(c.get('supabase'), query.data.organizationId, role)
  if (result.error) return c.json({ error: result.error === '42501' ? 'forbidden' : 'request_failed', requestId: c.get('requestId') }, result.error === '42501' ? 403 : 500)
  if (result.tooLarge) return c.json({ error: 'export_too_large', maxRows: EXPORT_MAX_ROWS, requestId: c.get('requestId') }, 413)
  const headers = bulkCsvHeaders[entity]
  const csv = encodeSpreadsheetCsv(headers, result.rows.map((row) => [row.code, row.legal_name, row.display_name, row.email ?? '', row.phone ?? '']))
  return csvResponse(c, `${entity}-v${BULK_SCHEMA_VERSION}.csv`, csv)
})
