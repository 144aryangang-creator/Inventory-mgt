import { z } from 'zod'

export const BULK_CSV_MAX_BYTES = 2 * 1024 * 1024
export const BULK_CSV_MAX_ROWS = 1000
export const BULK_SCHEMA_VERSION = 1 as const

export const bulkEntitySchema = z.enum(['items', 'customers', 'suppliers', 'opening-stock'])
export type BulkEntity = z.infer<typeof bulkEntitySchema>

export const bulkOrganizationQuerySchema = z.object({ organizationId: z.uuid() })
export const bulkImportQuerySchema = z.object({
  organizationId: z.uuid(),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})

const itemCodePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/
const partyCodePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
const warehouseCodePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
const nonNegativeDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const basicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const optionalCsvText = (max: number) => z.string().trim().max(max)

export const itemImportRowSchema = z.object({
  sku: z.string().trim().min(1).max(80).regex(itemCodePattern).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(200),
  description: optionalCsvText(2000),
  base_uom: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  track_inventory: z.enum(['true', 'false', 'TRUE', 'FALSE', '1', '0', 'yes', 'no', 'YES', 'NO']),
})

export const partyImportRowSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(partyCodePattern).transform((v) => v.toUpperCase()),
  legal_name: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(254).refine((v) => v === '' || basicEmailPattern.test(v), 'Invalid email'),
  phone: z.string().trim().max(40),
})

export const openingStockImportRowSchema = z.object({
  item_sku: z.string().trim().min(1).max(80).regex(itemCodePattern).transform((v) => v.toUpperCase()),
  warehouse_code: z.string().trim().min(1).max(40).regex(warehouseCodePattern).transform((v) => v.toUpperCase()),
  quantity: z.string().regex(positiveDecimalPattern).refine((v) => !/^0+(?:\.0+)?$/.test(v), 'Quantity must be positive'),
  unit_cost: z.string().regex(nonNegativeDecimalPattern),
})

export const bulkCsvHeaders: Record<BulkEntity, readonly string[]> = {
  items: ['sku', 'name', 'description', 'base_uom', 'track_inventory'],
  customers: ['code', 'legal_name', 'display_name', 'email', 'phone'],
  suppliers: ['code', 'legal_name', 'display_name', 'email', 'phone'],
  'opening-stock': ['item_sku', 'warehouse_code', 'quantity', 'unit_cost'],
}

export class CsvContractError extends Error {
  readonly code: string
  readonly row?: number

  constructor(code: string, message: string, row?: number) {
    super(message)
    this.name = 'CsvContractError'
    this.code = code
    this.row = row
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

function parseCsvMatrix(source: string): string[][] {
  const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  if (input.includes('\0')) throw new CsvContractError('nul_byte', 'CSV must not contain NUL bytes')
  if (utf8Length(input) > BULK_CSV_MAX_BYTES) throw new CsvContractError('file_too_large', 'CSV exceeds 2 MB limit')

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let atFieldStart = true

  const pushField = () => {
    row.push(field)
    field = ''
    atFieldStart = true
  }
  const pushRow = () => {
    pushField()
    if (!row.every((cell) => cell === '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
          atFieldStart = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      if (!atFieldStart) throw new CsvContractError('invalid_quote', 'Quote must begin a quoted field')
      inQuotes = true
      continue
    }
    if (ch === ',') {
      pushField()
      continue
    }
    if (ch === '\n') {
      pushRow()
      continue
    }
    if (ch === '\r') {
      if (input[i + 1] === '\n') i += 1
      pushRow()
      continue
    }

    field += ch
    atFieldStart = false
  }

  if (inQuotes) throw new CsvContractError('unclosed_quote', 'CSV contains an unclosed quoted field')
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

export type ParsedCsvDocument = { headers: string[]; rows: Record<string, string>[] }

export function parseVersionedCsv(source: string, entity: BulkEntity): ParsedCsvDocument {
  const matrix = parseCsvMatrix(source)
  if (matrix.length === 0) throw new CsvContractError('missing_header', 'CSV requires a header row')

  const expected = [...bulkCsvHeaders[entity]]
  const headers = matrix[0].map((value) => value.trim())
  if (headers.length !== expected.length || headers.some((header, index) => header !== expected[index])) {
    throw new CsvContractError('header_mismatch', `Expected headers: ${expected.join(',')}`)
  }
  if (new Set(headers).size !== headers.length) throw new CsvContractError('duplicate_header', 'CSV headers must be unique')

  const data = matrix.slice(1)
  if (data.length === 0) throw new CsvContractError('no_rows', 'CSV requires at least one data row')
  if (data.length > BULK_CSV_MAX_ROWS) throw new CsvContractError('too_many_rows', `CSV exceeds ${BULK_CSV_MAX_ROWS} row limit`)

  return {
    headers,
    rows: data.map((cells, index) => {
      if (cells.length !== headers.length) {
        throw new CsvContractError('column_count', `Row ${index + 2} has ${cells.length} columns; expected ${headers.length}`, index + 2)
      }
      return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]))
    }),
  }
}

export type BulkValidationIssue = { row: number; field: string; code: string; message: string }

export type NormalizedBulkRows =
  | { entity: 'items'; rows: { sku: string; name: string; description?: string; baseUom: string; trackInventory: boolean }[] }
  | { entity: 'customers' | 'suppliers'; rows: { code: string; legalName: string; displayName: string; email?: string; phone?: string }[] }
  | { entity: 'opening-stock'; rows: { itemSku: string; warehouseCode: string; quantity: string; unitCost: string }[] }

function issuesFromZod(rowIndex: number, error: z.ZodError): BulkValidationIssue[] {
  return error.issues.map((issue) => ({
    row: rowIndex,
    field: String(issue.path[0] ?? ''),
    code: 'invalid_value',
    message: issue.message,
  }))
}

function duplicateIssues(values: { key: string; row: number; field: string }[]): BulkValidationIssue[] {
  const first = new Map<string, number>()
  const issues: BulkValidationIssue[] = []
  values.forEach(({ key, row, field }) => {
    const existing = first.get(key)
    if (existing !== undefined) {
      issues.push({ row, field, code: 'duplicate_in_file', message: `Duplicate value also appears on row ${existing}` })
    } else {
      first.set(key, row)
    }
  })
  return issues
}

export function normalizeBulkCsv(source: string, entity: BulkEntity): { data?: NormalizedBulkRows; issues: BulkValidationIssue[] } {
  const parsed = parseVersionedCsv(source, entity)
  const issues: BulkValidationIssue[] = []

  if (entity === 'items') {
    const rows: Extract<NormalizedBulkRows, { entity: 'items' }>['rows'] = []
    const keys: { key: string; row: number; field: string }[] = []
    parsed.rows.forEach((raw, index) => {
      const rowNumber = index + 2
      const result = itemImportRowSchema.safeParse(raw)
      if (!result.success) { issues.push(...issuesFromZod(rowNumber, result.error)); return }
      const track = ['true', 'TRUE', '1', 'yes', 'YES'].includes(result.data.track_inventory)
      rows.push({ sku: result.data.sku, name: result.data.name, ...(result.data.description ? { description: result.data.description } : {}), baseUom: result.data.base_uom, trackInventory: track })
      keys.push({ key: result.data.sku, row: rowNumber, field: 'sku' })
    })
    issues.push(...duplicateIssues(keys))
    return { ...(issues.length === 0 ? { data: { entity, rows } } : {}), issues }
  }

  if (entity === 'customers' || entity === 'suppliers') {
    const rows: Extract<NormalizedBulkRows, { entity: 'customers' | 'suppliers' }>['rows'] = []
    const keys: { key: string; row: number; field: string }[] = []
    parsed.rows.forEach((raw, index) => {
      const rowNumber = index + 2
      const result = partyImportRowSchema.safeParse(raw)
      if (!result.success) { issues.push(...issuesFromZod(rowNumber, result.error)); return }
      rows.push({ code: result.data.code, legalName: result.data.legal_name, displayName: result.data.display_name, ...(result.data.email ? { email: result.data.email.toLowerCase() } : {}), ...(result.data.phone ? { phone: result.data.phone } : {}) })
      keys.push({ key: result.data.code, row: rowNumber, field: 'code' })
    })
    issues.push(...duplicateIssues(keys))
    return { ...(issues.length === 0 ? { data: { entity, rows } } : {}), issues }
  }

  const rows: Extract<NormalizedBulkRows, { entity: 'opening-stock' }>['rows'] = []
  const keys: { key: string; row: number; field: string }[] = []
  parsed.rows.forEach((raw, index) => {
    const rowNumber = index + 2
    const result = openingStockImportRowSchema.safeParse(raw)
    if (!result.success) { issues.push(...issuesFromZod(rowNumber, result.error)); return }
    rows.push({ itemSku: result.data.item_sku, warehouseCode: result.data.warehouse_code, quantity: result.data.quantity, unitCost: result.data.unit_cost })
    keys.push({ key: `${result.data.item_sku}\0${result.data.warehouse_code}`, row: rowNumber, field: 'item_sku' })
  })
  issues.push(...duplicateIssues(keys))
  return { ...(issues.length === 0 ? { data: { entity, rows } } : {}), issues }
}

const spreadsheetDangerousPrefix = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/

export function spreadsheetSafeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = spreadsheetDangerousPrefix.test(text) ? `\t${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function encodeSpreadsheetCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [
    headers.map(spreadsheetSafeCsvCell).join(','),
    ...rows.map((row) => row.map(spreadsheetSafeCsvCell).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
