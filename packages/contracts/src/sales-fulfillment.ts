import { z } from 'zod'

const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const positiveDecimalSchema = z
  .string()
  .regex(positiveDecimalPattern, 'Use a positive decimal string with at most 14 integer and 6 decimal digits')
  .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'Quantity must be greater than zero')

const uniqueLines = (lines: { fulfillmentLineId: string }[], ctx: z.RefinementCtx) => {
  const ids = new Set<string>()
  lines.forEach((line, index) => {
    if (ids.has(line.fulfillmentLineId)) {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'fulfillmentLineId'], message: 'Lines must be unique' })
    }
    ids.add(line.fulfillmentLineId)
  })
}

export const fulfillSalesInvoiceSchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
  warehouseId: z.uuid(),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type FulfillSalesInvoiceInput = z.infer<typeof fulfillSalesInvoiceSchema>

export const salesReturnLineSchema = z.object({
  fulfillmentLineId: z.uuid(),
  quantity: positiveDecimalSchema,
})

export const returnSalesFulfillmentSchema = z.object({
  organizationId: z.uuid(),
  fulfillmentId: z.uuid(),
  lines: z.array(salesReturnLineSchema).min(1, 'At least one return line is required').max(200),
  reason: z.string().trim().min(1, 'Return reason is required').max(240),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
}).superRefine((value, ctx) => uniqueLines(value.lines, ctx))
export type ReturnSalesFulfillmentInput = z.infer<typeof returnSalesFulfillmentSchema>

export const salesReturnHistoryQuerySchema = z.object({
  organizationId: z.uuid(),
  fulfillmentId: z.uuid(),
})

export const issueSalesReturnCreditNoteSchema = z.object({
  organizationId: z.uuid(),
  salesReturnId: z.uuid(),
  lines: z.array(salesReturnLineSchema).min(1, 'At least one credit line is required').max(200),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Document date must use YYYY-MM-DD'),
  seriesCode: z
    .string()
    .trim()
    .min(1, 'Series code is required')
    .max(8)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,7}$/, 'Series can contain letters, numbers and hyphens')
    .transform((value) => value.toUpperCase()),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
}).superRefine((value, ctx) => uniqueLines(value.lines, ctx))
export type IssueSalesReturnCreditNoteInput = z.infer<typeof issueSalesReturnCreditNoteSchema>

export const salesReturnCreditHistoryQuerySchema = z.object({
  organizationId: z.uuid(),
  salesReturnId: z.uuid(),
})

export const inventoryReferenceQuerySchema = z.object({
  organizationId: z.uuid(),
  query: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})
export type InventoryReferenceQuery = z.infer<typeof inventoryReferenceQuerySchema>
