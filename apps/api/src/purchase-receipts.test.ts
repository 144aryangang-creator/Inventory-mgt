import { describe, expect, it } from 'vitest'
import { purchaseReceiptRoutes } from './purchase-receipts'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const supplierPartyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const warehouseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const itemId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

describe('purchase receipt API boundary', () => {
  it('rejects numeric quantities and costs before database access', async () => {
    const response = await purchaseReceiptRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        supplierPartyId,
        warehouseId,
        lines: [{ itemId, quantity: 1, unitCost: 100 }],
        requestKey: 'receipt-1',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed supplier and warehouse references', async () => {
    const response = await purchaseReceiptRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        supplierPartyId: 'bad',
        warehouseId: 'bad',
        lines: [{ itemId, quantity: '1', unitCost: '100' }],
        requestKey: 'receipt-2',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects invalid received timestamps', async () => {
    const response = await purchaseReceiptRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        supplierPartyId,
        warehouseId,
        lines: [{ itemId, quantity: '1', unitCost: '100' }],
        receivedAt: 'yesterday-ish',
        requestKey: 'receipt-3',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed receipt history filters', async () => {
    const response = await purchaseReceiptRoutes.request('/?organizationId=bad&limit=101')
    expect(response.status).toBe(400)
  })

  it('rejects malformed receipt detail identifiers', async () => {
    const response = await purchaseReceiptRoutes.request('/not-a-uuid?organizationId=bad')
    expect(response.status).toBe(400)
  })
})
