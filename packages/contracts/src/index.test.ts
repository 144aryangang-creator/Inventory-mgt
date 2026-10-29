import { describe, expect, it } from 'vitest'
import {
  createOrganizationSchema,
  createPartyAddressSchema,
  createPartySchema,
  createPartyTaxRegistrationSchema,
  listPartiesQuerySchema,
  postInventoryMovementSchema,
} from './index'

const base = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  itemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  warehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requestKey: 'request-1',
}

describe('postInventoryMovementSchema', () => {
  it('accepts positive inbound decimal strings', () => {
    expect(postInventoryMovementSchema.safeParse({ ...base, movementType: 'receipt', quantity: '10.250000', unitCost: '199.95' }).success).toBe(true)
  })

  it('accepts negative outbound decimal strings', () => {
    expect(postInventoryMovementSchema.safeParse({ ...base, movementType: 'sale', quantity: '-1.5' }).success).toBe(true)
  })

  it('rejects positive outbound quantities', () => {
    expect(postInventoryMovementSchema.safeParse({ ...base, movementType: 'sale', quantity: '1' }).success).toBe(false)
  })

  it('rejects zero quantity', () => {
    expect(postInventoryMovementSchema.safeParse({ ...base, movementType: 'receipt', quantity: '0.000000' }).success).toBe(false)
  })

  it('rejects values beyond database decimal precision', () => {
    expect(postInventoryMovementSchema.safeParse({ ...base, movementType: 'receipt', quantity: '1.1234567' }).success).toBe(false)
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
    expect(createOrganizationSchema.safeParse({ name: 'Tenant', slug: '../tenant', countryCode: 'IN', baseCurrency: 'INR', timezone: 'Asia/Kolkata' }).success).toBe(false)
  })
})

describe('party schemas', () => {
  it('normalizes party codes and optional email', () => {
    const parsed = createPartySchema.parse({
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      code: ' cust-001 ',
      legalName: ' Acme Private Limited ',
      displayName: ' Acme ',
      roles: ['customer', 'supplier'],
      email: 'ACCOUNTS@EXAMPLE.COM',
      phone: '',
    })

    expect(parsed.code).toBe('CUST-001')
    expect(parsed.legalName).toBe('Acme Private Limited')
    expect(parsed.email).toBe('accounts@example.com')
    expect(parsed.phone).toBeUndefined()
  })

  it('rejects unsafe party codes and duplicate roles', () => {
    const invalidCode = createPartySchema.safeParse({
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      code: '../customer',
      legalName: 'Acme',
      displayName: 'Acme',
      roles: ['customer'],
    })
    const duplicateRoles = createPartySchema.safeParse({
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      code: 'CUST-001',
      legalName: 'Acme',
      displayName: 'Acme',
      roles: ['customer', 'customer'],
    })

    expect(invalidCode.success).toBe(false)
    expect(duplicateRoles.success).toBe(false)
  })

  it('bounds party search pagination', () => {
    expect(listPartiesQuerySchema.safeParse({ organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', limit: '101' }).success).toBe(false)
    expect(listPartiesQuerySchema.parse({ organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }).limit).toBe(50)
  })
})

describe('party profile schemas', () => {
  const identity = {
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    partyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }

  it('normalizes address defaults and blank optional fields', () => {
    const parsed = createPartyAddressSchema.parse({
      ...identity,
      label: ' Billing ',
      recipientName: '',
      addressLine1: ' 1 Main Road ',
      addressLine2: '',
      city: ' Bhopal ',
      district: '',
      stateName: 'Madhya Pradesh',
      stateCode: '23',
      postalCode: '462001',
      countryCode: 'in',
      isDefaultBilling: true,
    })

    expect(parsed.label).toBe('Billing')
    expect(parsed.addressLine1).toBe('1 Main Road')
    expect(parsed.countryCode).toBe('IN')
    expect(parsed.recipientName).toBeUndefined()
    expect(parsed.addressLine2).toBeUndefined()
    expect(parsed.isDefaultBilling).toBe(true)
    expect(parsed.isDefaultShipping).toBe(false)
  })

  it('accepts and normalizes a structurally valid GSTIN', () => {
    const parsed = createPartyTaxRegistrationSchema.parse({
      ...identity,
      scheme: 'gstin',
      registrationNumber: '23abcde1234f1z5',
      registeredName: 'Example Private Limited',
      countryCode: 'in',
      stateCode: '23',
      isDefault: true,
    })

    expect(parsed.scheme).toBe('GSTIN')
    expect(parsed.registrationNumber).toBe('23ABCDE1234F1Z5')
    expect(parsed.countryCode).toBe('IN')
  })

  it('rejects malformed GSTIN and mismatched state code', () => {
    expect(createPartyTaxRegistrationSchema.safeParse({
      ...identity,
      scheme: 'GSTIN',
      registrationNumber: '23BAD',
      countryCode: 'IN',
      stateCode: '23',
    }).success).toBe(false)

    expect(createPartyTaxRegistrationSchema.safeParse({
      ...identity,
      scheme: 'GSTIN',
      registrationNumber: '23ABCDE1234F1Z5',
      countryCode: 'IN',
      stateCode: '27',
    }).success).toBe(false)
  })

  it('keeps non-GST tax schemes generic', () => {
    expect(createPartyTaxRegistrationSchema.safeParse({
      ...identity,
      scheme: 'VAT',
      registrationNumber: 'EU-123456',
      countryCode: 'DE',
      stateCode: '',
    }).success).toBe(true)
  })
})
