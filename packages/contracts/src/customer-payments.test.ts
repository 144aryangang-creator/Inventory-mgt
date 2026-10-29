import { describe, expect, it } from 'vitest'
import {
  allocateCustomerPaymentSchema,
  createCustomerPaymentSchema,
  invoicePaymentBalanceQuerySchema,
  listCustomerPaymentsQuerySchema,
} from './customer-payments'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customerPartyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const paymentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

describe('customer payment contracts', () => {
  it('normalizes currency and optional reference', () => {
    const parsed = createCustomerPaymentSchema.parse({
      organizationId,
      customerPartyId,
      paymentDate: '2026-10-30',
      amount: '1180.50',
      currencyCode: 'inr',
      method: 'bank_transfer',
      requestKey: 'payment-1',
      reference: ' UTR-001 ',
    })
    expect(parsed.currencyCode).toBe('INR')
    expect(parsed.reference).toBe('UTR-001')
  })

  it('rejects number inputs and zero amounts', () => {
    expect(createCustomerPaymentSchema.safeParse({
      organizationId,
      customerPartyId,
      paymentDate: '2026-10-30',
      amount: 100,
      currencyCode: 'INR',
      method: 'cash',
      requestKey: 'payment-2',
    }).success).toBe(false)

    expect(createCustomerPaymentSchema.safeParse({
      organizationId,
      customerPartyId,
      paymentDate: '2026-10-30',
      amount: '0',
      currencyCode: 'INR',
      method: 'cash',
      requestKey: 'payment-3',
    }).success).toBe(false)
  })

  it('validates allocation identifiers and exact decimal amount', () => {
    expect(allocateCustomerPaymentSchema.safeParse({
      organizationId,
      paymentId,
      documentId,
      amount: '500',
      requestKey: 'allocation-1',
    }).success).toBe(true)
    expect(allocateCustomerPaymentSchema.safeParse({
      organizationId,
      paymentId,
      documentId: '../invoice',
      amount: '500',
      requestKey: 'allocation-1',
    }).success).toBe(false)
  })

  it('bounds payment list pagination', () => {
    expect(listCustomerPaymentsQuerySchema.parse({ organizationId }).limit).toBe(50)
    expect(listCustomerPaymentsQuerySchema.safeParse({ organizationId, limit: '101' }).success).toBe(false)
  })

  it('requires exact invoice IDs for payment balances', () => {
    expect(invoicePaymentBalanceQuerySchema.safeParse({ organizationId, documentId }).success).toBe(true)
    expect(invoicePaymentBalanceQuerySchema.safeParse({ organizationId, documentId: 'bad' }).success).toBe(false)
  })
})
