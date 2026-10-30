import { z } from 'zod'

const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const positiveDecimalSchema = z
  .string()
  .regex(positiveDecimalPattern, 'Use a positive decimal string with at most 14 integer and 6 decimal digits')
  .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'Quantity must be greater than zero')

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
}).superRefine((value, ctx) => {
  const ids = new Set<string>()
  value.lines.forEach((line, index) => {
    if (ids.has(line.fulfillmentLineId)) {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'fulfillmentLineId'], message: 'Return lines must be unique' })
    }
    ids.add(line.fulfillmentLineId)
  })
})
export type ReturnSalesFulfillmentInput = z.infer<typeof returnSalesFulfillmentSchema>

export const salesReturnHistoryQuerySchema = z.object({
  organizationId: z.uuid(),
  fulfillmentId: z.uuid(),
})

export const inventoryReferenceQuerySchema = z.object({
  organizationId: z.uuid(),
  query: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})
export type InventoryReferenceQuery = z.infer<typeof inventoryReferenceQuerySchema>
