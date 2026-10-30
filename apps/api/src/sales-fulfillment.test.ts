import { describe, expect, it } from 'vitest'
import { salesFulfillmentRoutes } from './sales-fulfillment'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const fulfillmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const fulfillmentLineId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const salesReturnId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const warehouseId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

describe('sales fulfillment API boundary', () => {
  it('rejects malformed legacy fulfillment identifiers before database access', async () => {
    const response = await salesFulfillmentRoutes.request('/not-a-uuid/fulfill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        warehouseId,
        requestKey: 'fulfill-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects malformed singular fulfillment status reads', async () => {
    const response = await salesFulfillmentRoutes.request('/not-a-uuid/fulfillment?organizationId=bad')
    expect(response.status).toBe(400)
  })

  it('rejects malformed plural fulfillment history reads', async () => {
    const response = await salesFulfillmentRoutes.request('/not-a-uuid/fulfillments?organizationId=bad')
    expect(response.status).toBe(400)
  })

  it('rejects numeric partial fulfillment quantities before database access', async () => {
    const response = await salesFulfillmentRoutes.request(`/${documentId}/fulfillments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        warehouseId,
        lines: [{ financialDocumentLineId: fulfillmentLineId, quantity: 1 }],
        requestKey: 'partial-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects duplicate invoice lines in one partial fulfillment request', async () => {
    const response = await salesFulfillmentRoutes.request(`/${documentId}/fulfillments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        warehouseId,
        lines: [
          { financialDocumentLineId: fulfillmentLineId, quantity: '1' },
          { financialDocumentLineId: fulfillmentLineId, quantity: '1' },
        ],
        requestKey: 'partial-2',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects non-string return quantities before database access', async () => {
    const response = await salesFulfillmentRoutes.request(`/fulfillments/${fulfillmentId}/returns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        lines: [{ fulfillmentLineId, quantity: 1 }],
        reason: 'Customer return',
        requestKey: 'return-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects duplicate fulfillment lines in one return request', async () => {
    const response = await salesFulfillmentRoutes.request(`/fulfillments/${fulfillmentId}/returns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        lines: [
          { fulfillmentLineId, quantity: '1' },
          { fulfillmentLineId, quantity: '1' },
        ],
        reason: 'Customer return',
        requestKey: 'return-2',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed return history identifiers', async () => {
    const response = await salesFulfillmentRoutes.request('/fulfillments/bad/returns?organizationId=bad')
    expect(response.status).toBe(400)
  })

  it('rejects numeric return-credit quantities before database access', async () => {
    const response = await salesFulfillmentRoutes.request(`/returns/${salesReturnId}/credit-note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        lines: [{ fulfillmentLineId, quantity: 1 }],
        documentDate: '2026-10-30',
        seriesCode: 'CRN',
        requestKey: 'credit-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed return-credit history identifiers', async () => {
    const response = await salesFulfillmentRoutes.request('/returns/bad/credits?organizationId=bad')
    expect(response.status).toBe(400)
  })
})
