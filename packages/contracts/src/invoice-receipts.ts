import { z } from 'zod'
import { paymentMethodSchema } from './customer-payments'

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
  paymentRequestKey: z.string().trim().min(1).max(128),
  allocationRequestKey: z.string().trim().min(1).max(128),
  reference: optionalText(120),
  notes: optionalText(1000),
})

export type RecordAndAllocateInvoicePaymentInput = z.infer<typeof recordAndAllocateInvoicePaymentSchema>
