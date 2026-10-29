import { z } from 'zod'

const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

const positiveDecimalSchema = z
  .string()
  .regex(positiveDecimalPattern, 'Use a positive decimal string with at most 14 integer and 6 decimal digits')
  .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'Amount must be greater than zero')

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

export const paymentMethodSchema = z.enum(['cash', 'bank_transfer', 'card', 'upi', 'cheque', 'other'])
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const createCustomerPaymentSchema = z.object({
  organizationId: z.uuid(),
  customerPartyId: z.uuid(),
  paymentDate: z.string().regex(isoDatePattern, 'Payment date must use YYYY-MM-DD'),
  amount: positiveDecimalSchema,
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency must contain 3 letters')
    .transform((value) => value.toUpperCase()),
  method: paymentMethodSchema,
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
  reference: optionalText(120),
  notes: optionalText(1000),
})
export type CreateCustomerPaymentInput = z.infer<typeof createCustomerPaymentSchema>

export const allocateCustomerPaymentSchema = z.object({
  organizationId: z.uuid(),
  paymentId: z.uuid(),
  documentId: z.uuid(),
  amount: positiveDecimalSchema,
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type AllocateCustomerPaymentInput = z.infer<typeof allocateCustomerPaymentSchema>

export const recordAndAllocateInvoicePaymentSchema = z.object({
  organizationId: z.uuid(),
  customerPartyId: z.uuid(),
  documentId: z.uuid(),
  paymentDate: z.string().regex(isoDatePattern, 'Payment date must use YYYY-MM-DD'),
  amount: positiveDecimalSchema,
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency must contain 3 letters')
    .transform((value) => value.toUpperCase()),
  method: paymentMethodSchema,
  paymentRequestKey: z.string().trim().min(1, 'Payment request key is required').max(128),
  allocationRequestKey: z.string().trim().min(1, 'Allocation request key is required').max(128),
  reference: optionalText(120),
  notes: optionalText(1000),
})
export type RecordAndAllocateInvoicePaymentInput = z.infer<typeof recordAndAllocateInvoicePaymentSchema>

export const reversePaymentAllocationSchema = z.object({
  organizationId: z.uuid(),
  allocationId: z.uuid(),
  amount: positiveDecimalSchema,
  reason: z.string().trim().min(1, 'Reversal reason is required').max(240),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type ReversePaymentAllocationInput = z.infer<typeof reversePaymentAllocationSchema>

export const reverseCustomerPaymentSchema = z.object({
  organizationId: z.uuid(),
  paymentId: z.uuid(),
  amount: positiveDecimalSchema,
  reason: z.string().trim().min(1, 'Reversal reason is required').max(240),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type ReverseCustomerPaymentInput = z.infer<typeof reverseCustomerPaymentSchema>

export const listCustomerPaymentsQuerySchema = z.object({
  organizationId: z.uuid(),
  customerPartyId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const invoicePaymentBalanceQuerySchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
})

export const invoicePaymentAllocationsQuerySchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
})
