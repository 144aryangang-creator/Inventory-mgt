import { describe, expect, it } from 'vitest'
import { customerPaymentRoutes } from './customer-payments'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const paymentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const allocationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

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
        organizationId,
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
        organizationId,
        documentId,
        amount: '100',
        requestKey: 'allocation-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects non-string receipt amounts before database access', async () => {
    const response = await customerPaymentRoutes.request(`/invoice/${documentId}/receipt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
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

  it('rejects malformed allocation reversal amounts and missing reasons', async () => {
    const response = await customerPaymentRoutes.request(`/allocations/${allocationId}/reverse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        amount: 100,
        reason: '',
        requestKey: 'reverse-allocation-1',
      }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects malformed payment reversal IDs before database access', async () => {
    const response = await customerPaymentRoutes.request('/bad/reverse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        amount: '100',
        reason: 'Customer refund',
        requestKey: 'reverse-payment-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed invoice allocation history queries', async () => {
    const response = await customerPaymentRoutes.request('/invoice/bad/allocations?organizationId=bad')
    expect(response.status).toBe(400)
  })

  it('accepts structurally valid payment reversal payloads up to the database boundary', async () => {
    const response = await customerPaymentRoutes.request(`/${paymentId}/reverse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        amount: '100.50',
        reason: 'Customer refund',
        requestKey: 'reverse-payment-1',
      }),
    })
    expect(response.status).not.toBe(400)
  })
})
