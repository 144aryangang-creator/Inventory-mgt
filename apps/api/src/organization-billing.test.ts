import { describe, expect, it } from 'vitest'
import { organizationBillingRoutes } from './organization-billing'

describe('organization billing profile API boundary', () => {
  it('rejects invalid list queries before calling the database', async () => {
    const response = await organizationBillingRoutes.request('/?organizationId=not-a-uuid')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects attempts to supply malformed GST seller identity', async () => {
    const response = await organizationBillingRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        code: 'MAIN',
        legalName: 'Seller',
        gstin: '27ABCDE1234F1Z5',
        addressLine1: '1 Road',
        city: 'Bhopal',
        stateName: 'Madhya Pradesh',
        stateCode: '23',
        postalCode: '462001',
        countryCode: 'IN',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })
})
