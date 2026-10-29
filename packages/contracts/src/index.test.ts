import { describe, expect, it } from 'vitest'
import { createOrganizationSchema, postInventoryMovementSchema } from './index'

const base = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  itemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  warehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requestKey: 'request-1',
}

describe('postInventoryMovementSchema', () => {
  it('accepts positive inbound decimal strings', () => {
    expect(
      postInventoryMovementSchema.safeParse({
        ...base,
        movementType: 'receipt',
        quantity: '10.250000',
        unitCost: '199.95',
      }).success,
    ).toBe(true)
  })

  it('accepts negative outbound decimal strings', () => {
    expect(
      postInventoryMovementSchema.safeParse({
        ...base,
        movementType: 'sale',
        quantity: '-1.5',
      }).success,
    ).toBe(true)
  })

  it('rejects positive outbound quantities', () => {
    expect(
      postInventoryMovementSchema.safeParse({
        ...base,
        movementType: 'sale',
        quantity: '1',
      }).success,
    ).toBe(false)
  })

  it('rejects zero quantity', () => {
    expect(
      postInventoryMovementSchema.safeParse({
        ...base,
        movementType: 'receipt',
        quantity: '0.000000',
      }).success,
    ).toBe(false)
  })

  it('rejects values beyond database decimal precision', () => {
    expect(
      postInventoryMovementSchema.safeParse({
        ...base,
        movementType: 'receipt',
        quantity: '1.1234567',
      }).success,
    ).toBe(false)
  })
})

describe('createOrganizationSchema', () => {
  it('normalizes slug and ISO-like codes', () => {
    const parsed = createOrganizationSchema.parse({
      name: ' Bhopal Tractors ',
      slug: 'Bhopal-Tractors',
      countryCode: 'in',
      baseCurrency: 'inr',
      timezone: 'Asia/Kolkata',
    })

    expect(parsed).toEqual({
      name: 'Bhopal Tractors',
      slug: 'bhopal-tractors',
      countryCode: 'IN',
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    })
  })

  it('rejects unsafe slugs', () => {
    expect(
      createOrganizationSchema.safeParse({
        name: 'Tenant',
        slug: '../tenant',
        countryCode: 'IN',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(false)
  })
})
