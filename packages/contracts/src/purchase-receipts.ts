import { z } from 'zod'

const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const nonNegativeDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/

const positiveDecimalSchema = z
  .string()
  .regex(positiveDecimalPattern, 'Use a decimal string with at most 14 integer and 6 decimal digits')
  .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'Quantity must be greater than zero')

const nonNegativeDecimalSchema = z
  .string()
  .regex(nonNegativeDecimalPattern, 'Use a non-negative decimal string with at most 14 integer and 6 decimal digits')

function optionalTrimmedText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

const optionalIsoTimestampSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Received time must be a valid ISO timestamp')
  .optional()

export const purchaseReceiptLineSchema = z.object({
  itemId: z.uuid(),
  quantity: positiveDecimalSchema,
  unitCost: nonNegativeDecimalSchema,
})
export type PurchaseReceiptLineInput = z.infer<typeof purchaseReceiptLineSchema>

export const postPurchaseReceiptSchema = z.object({
  organizationId: z.uuid(),
  supplierPartyId: z.uuid(),
  warehouseId: z.uuid(),
  lines: z.array(purchaseReceiptLineSchema).min(1, 'At least one receipt line is required').max(200),
  supplierReference: optionalTrimmedText(120),
  notes: optionalTrimmedText(2000),
  receivedAt: optionalIsoTimestampSchema,
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type PostPurchaseReceiptInput = z.infer<typeof postPurchaseReceiptSchema>

export const listPurchaseReceiptsQuerySchema = z.object({
  organizationId: z.uuid(),
  supplierPartyId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListPurchaseReceiptsQuery = z.infer<typeof listPurchaseReceiptsQuerySchema>

export const purchaseReceiptDetailQuerySchema = z.object({
  organizationId: z.uuid(),
  receiptId: z.uuid(),
})
export type PurchaseReceiptDetailQuery = z.infer<typeof purchaseReceiptDetailQuerySchema>
