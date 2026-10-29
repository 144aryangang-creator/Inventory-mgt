import { describe, expect, it } from 'vitest'
import { inventoryReferenceRoutes } from './inventory-references'

describe('inventory reference API boundary', () => {
  it('rejects malformed item lookup organization IDs', async () => {
    const response = await inventoryReferenceRoutes.request('/items?organizationId=bad&limit=200')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects malformed warehouse lookup organization IDs', async () => {
    const response = await inventoryReferenceRoutes.request('/warehouses?organizationId=bad')
    expect(response.status).toBe(400)
  })
})
