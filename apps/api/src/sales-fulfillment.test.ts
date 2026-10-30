import { describe, expect, it } from 'vitest'
import { salesFulfillmentRoutes } from './sales-fulfillment'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fulfillmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const fulfillmentLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('sales fulfillment API boundary', () => {
  it('rejects malformed fulfillment identifiers before database access', async () => {
    const response = await salesFulfillmentRoutes.request('/not-a-uuid/fulfill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        warehouseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        requestKey: 'fulfill-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects malformed fulfillment status reads', async () => {
    const response = await salesFulfillmentRoutes.request('/not-a-uuid/fulfillment?organizationId=bad')
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
})
