import { describe, expect, it } from 'vitest'
import { inventoryReferenceRoutes } from './inventory-references'

describe('inventory workspace API boundary', () => {
  it('rejects malformed item lookup organization IDs', async () => {
    const response = await inventoryReferenceRoutes.request('/items?organizationId=bad&limit=200')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects malformed warehouse lookup organization IDs', async () => {
    const response = await inventoryReferenceRoutes.request('/warehouses?organizationId=bad')
    expect(response.status).toBe(400)
  })

  it('rejects malformed item IDs before update database access', async () => {
    const response = await inventoryReferenceRoutes.request('/items/not-a-uuid', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sku: 'ITEM-1',
        name: 'Item',
        baseUom: 'EA',
        trackInventory: true,
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects numeric transfer quantities because decimals cross JS boundaries as strings', async () => {
    const response = await inventoryReferenceRoutes.request('/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        itemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        fromWarehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        toWarehouseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        quantity: 2,
        requestKey: 'transfer-1',
      }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects same-warehouse transfers', async () => {
    const response = await inventoryReferenceRoutes.request('/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        itemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        fromWarehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        toWarehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        quantity: '2',
        requestKey: 'transfer-1',
      }),
    })
    expect(response.status).toBe(400)
  })
})
