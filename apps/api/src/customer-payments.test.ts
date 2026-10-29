import { describe, expect, it } from 'vitest'
import { customerPaymentRoutes } from './customer-payments'

describe('customer payment API boundary', () => {
  it('rejects malformed payment list queries before database access', async () => {
    const response = await customerPaymentRoutes.request('/?organizationId=bad&limit=200')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects number amounts in payment creation', async () => {
    const response = await customerPaymentRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customerPartyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        paymentDate: '2026-10-30',
        amount: 100,
        currencyCode: 'INR',
        method: 'cash',
        requestKey: 'payment-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed allocation IDs', async () => {
    const response = await customerPaymentRoutes.request('/bad/allocations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        amount: '100',
        requestKey: 'allocation-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects non-string receipt amounts before database access', async () => {
    const response = await customerPaymentRoutes.request('/invoice/dddddddd-dddd-4ddd-8ddd-dddddddddddd/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customerPartyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        paymentDate: '2026-10-30',
        amount: 100,
        currencyCode: 'INR',
        method: 'upi',
        paymentRequestKey: 'payment-receipt-1',
        allocationRequestKey: 'allocation-receipt-1',
      }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })
})
