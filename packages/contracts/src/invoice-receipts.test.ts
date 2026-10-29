import { describe, expect, it } from 'vitest'
import { recordAndAllocateInvoicePaymentSchema } from './invoice-receipts'

const base = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  customerPartyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  documentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  paymentDate: '2026-10-30',
  amount: '500.25',
  currencyCode: 'inr',
  method: 'upi' as const,
  paymentRequestKey: 'payment-key',
  allocationRequestKey: 'allocation-key',
}

describe('atomic invoice receipt contract', () => {
  it('normalizes currency and accepts exact decimal strings', () => {
    expect(recordAndAllocateInvoicePaymentSchema.parse(base).currencyCode).toBe('INR')
  })

  it('rejects missing allocation idempotency keys', () => {
    expect(recordAndAllocateInvoicePaymentSchema.safeParse({ ...base, allocationRequestKey: '' }).success).toBe(false)
  })

  it('rejects numeric amount inputs', () => {
    expect(recordAndAllocateInvoicePaymentSchema.safeParse({ ...base, amount: 500.25 }).success).toBe(false)
  })
})
