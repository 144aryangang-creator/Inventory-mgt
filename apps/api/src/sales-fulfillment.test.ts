import { describe, expect, it } from 'vitest'
import { salesFulfillmentRoutes } from './sales-fulfillment'

describe('sales fulfillment API boundary', () => {
  it('rejects malformed fulfillment identifiers before database access', async () => {
    const response = await salesFulfillmentRoutes.request('/not-a-uuid/fulfill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        warehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
})
