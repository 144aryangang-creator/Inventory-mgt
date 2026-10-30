import { z } from 'zod'

const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const nonNegativeDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const ratePattern = /^\d{1,3}(?:\.\d{1,4})?$/
const seriesPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,7}$/
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

function optionalTrimmedText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

const positiveDecimalSchema = z
  .string()
  .regex(positiveDecimalPattern, 'Use a decimal string with at most 14 integer and 6 decimal digits')
  .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'Value must be greater than zero')

const nonNegativeDecimalSchema = z
  .string()
  .regex(nonNegativeDecimalPattern, 'Use a non-negative decimal string with at most 14 integer and 6 decimal digits')

export const financialDocumentTypeSchema = z.enum(['tax_invoice', 'credit_note', 'debit_note'])
export type FinancialDocumentType = z.infer<typeof financialDocumentTypeSchema>

export const financialDocumentStatusSchema = z.enum(['draft', 'issued', 'cancelled'])
export type FinancialDocumentStatus = z.infer<typeof financialDocumentStatusSchema>

export const supplyTypeSchema = z.enum(['intra_state', 'inter_state', 'export', 'sez'])
export type SupplyType = z.infer<typeof supplyTypeSchema>

export const taxComponentSchema = z.enum(['CGST', 'SGST', 'UTGST', 'IGST', 'CESS'])
export type TaxComponent = z.infer<typeof taxComponentSchema>

export const financialDocumentTaxSchema = z.object({
  component: taxComponentSchema,
  rate: z
    .string()
    .regex(ratePattern, 'Tax rate must be a decimal percentage with at most 4 decimal places')
    .refine((value) => Number(value) <= 100, 'Tax rate cannot exceed 100%'),
})
export type FinancialDocumentTaxInput = z.infer<typeof financialDocumentTaxSchema>

// The normal draft route is tax-invoice only. Credit/debit notes are created exclusively through
// controlled adjustment workflows that derive immutable identity/tax data from the original invoice.
export const createFinancialDocumentDraftSchema = z.object({
  organizationId: z.uuid(),
  supplierProfileId: z.uuid(),
  documentType: z.literal('tax_invoice'),
  documentDate: z.string().regex(isoDatePattern, 'Document date must use YYYY-MM-DD'),
  seriesCode: z
    .string()
    .trim()
    .min(1, 'Series code is required')
    .max(8)
    .regex(seriesPattern, 'Series can contain letters, numbers and hyphens')
    .transform((value) => value.toUpperCase()),
  supplyType: supplyTypeSchema,
  recipientPartyId: z.uuid(),
  billingAddressId: z.uuid(),
  shippingAddressId: z.uuid().nullable().optional(),
  recipientTaxRegistrationId: z.uuid().nullable().optional(),
  linkedDocumentId: z.null().optional(),
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency must contain 3 letters')
    .transform((value) => value.toUpperCase())
    .default('INR'),
  placeOfSupplyStateCode: optionalTrimmedText(20),
  reverseCharge: z.boolean().default(false),
  notes: optionalTrimmedText(2000),
})
export type CreateFinancialDocumentDraftInput = z.infer<typeof createFinancialDocumentDraftSchema>

export const upsertFinancialDocumentLineSchema = z
  .object({
    organizationId: z.uuid(),
    documentId: z.uuid(),
    lineNumber: z.number().int().min(1).max(9999),
    description: z.string().trim().min(1, 'Description is required').max(500),
    quantity: positiveDecimalSchema,
    uom: z.string().trim().min(1, 'Unit is required').max(20),
    unitPrice: nonNegativeDecimalSchema,
    itemId: z.uuid().nullable().optional(),
    hsnSac: optionalTrimmedText(16),
    discountAmount: nonNegativeDecimalSchema.default('0'),
    taxes: z.array(financialDocumentTaxSchema).max(5).default([]),
  })
  .superRefine((value, ctx) => {
    const components = value.taxes.map((tax) => tax.component)
    if (new Set(components).size !== components.length) {
      ctx.addIssue({ code: 'custom', path: ['taxes'], message: 'Each tax component may appear only once per line' })
    }
  })
  .transform((value) => ({ ...value, itemSnapshot: {} as Record<string, unknown> }))
export type UpsertFinancialDocumentLineInput = z.infer<typeof upsertFinancialDocumentLineSchema>

export const removeFinancialDocumentLineSchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
  lineNumber: z.number().int().min(1).max(9999),
})

export const issueFinancialDocumentSchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type IssueFinancialDocumentInput = z.infer<typeof issueFinancialDocumentSchema>

export const cancelFinancialDocumentSchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
  reason: z.string().trim().min(1, 'Cancellation reason is required').max(240),
})
export type CancelFinancialDocumentInput = z.infer<typeof cancelFinancialDocumentSchema>

export const listFinancialDocumentsQuerySchema = z.object({
  organizationId: z.uuid(),
  documentType: financialDocumentTypeSchema.optional(),
  status: financialDocumentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListFinancialDocumentsQuery = z.infer<typeof listFinancialDocumentsQuerySchema>

export const financialDocumentDetailQuerySchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
})
export type FinancialDocumentDetailQuery = z.infer<typeof financialDocumentDetailQuerySchema>

export const invoiceAdjustmentTypeSchema = z.enum(['credit_note', 'debit_note'])
export type InvoiceAdjustmentType = z.infer<typeof invoiceAdjustmentTypeSchema>

export const invoiceAdjustmentLineSchema = z.object({
  originalLineId: z.uuid(),
  basisQuantity: positiveDecimalSchema,
  taxableAdjustment: positiveDecimalSchema,
})
export type InvoiceAdjustmentLineInput = z.infer<typeof invoiceAdjustmentLineSchema>

export const issueInvoiceAdjustmentSchema = z.object({
  organizationId: z.uuid(),
  originalInvoiceId: z.uuid(),
  adjustmentType: invoiceAdjustmentTypeSchema,
  lines: z.array(invoiceAdjustmentLineSchema).min(1, 'At least one adjustment line is required').max(200),
  documentDate: z.string().regex(isoDatePattern, 'Document date must use YYYY-MM-DD'),
  seriesCode: z
    .string()
    .trim()
    .min(1, 'Series code is required')
    .max(8)
    .regex(seriesPattern, 'Series can contain letters, numbers and hyphens')
    .transform((value) => value.toUpperCase()),
  reason: z.string().trim().min(1, 'Adjustment reason is required').max(240),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
}).superRefine((value, ctx) => {
  const lineIds = new Set<string>()
  value.lines.forEach((line, index) => {
    if (lineIds.has(line.originalLineId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines', index, 'originalLineId'],
        message: 'Each original invoice line may appear only once per adjustment',
      })
    }
    lineIds.add(line.originalLineId)
  })
})
export type IssueInvoiceAdjustmentInput = z.infer<typeof issueInvoiceAdjustmentSchema>

export const financialAdjustmentHistoryQuerySchema = z.object({
  organizationId: z.uuid(),
  originalInvoiceId: z.uuid(),
})
export type FinancialAdjustmentHistoryQuery = z.infer<typeof financialAdjustmentHistoryQuerySchema>
