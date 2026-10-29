import { describe, expect, it } from 'vitest'
import {
  createOrganizationBillingProfileSchema,
  listOrganizationBillingProfilesQuerySchema,
  updateOrganizationBillingProfileSchema,
} from './organization-billing'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const valid = {
  organizationId,
  code: ' main ',
  legalName: ' Bhopal Tractors Private Limited ',
  tradeName: ' Bhopal Tractors ',
  gstin: '23abcde1234f1z5',
  addressLine1: ' 1 Main Road ',
  city: ' Bhopal ',
  stateName: ' Madhya Pradesh ',
  stateCode: '23',
  postalCode: '462001',
  countryCode: 'in',
}

describe('organization billing profile contracts', () => {
  it('normalizes seller profile identifiers and GSTIN', () => {
    const parsed = createOrganizationBillingProfileSchema.parse(valid)
    expect(parsed.code).toBe('MAIN')
    expect(parsed.gstin).toBe('23ABCDE1234F1Z5')
    expect(parsed.countryCode).toBe('IN')
  })

  it('rejects GSTIN/state mismatches', () => {
    expect(createOrganizationBillingProfileSchema.safeParse({ ...valid, stateCode: '27' }).success).toBe(false)
  })

  it('does not expose a client verification-state field', () => {
    const parsed = createOrganizationBillingProfileSchema.parse({
      ...valid,
      gstinVerificationStatus: 'verified',
    })
    expect('gstinVerificationStatus' in parsed).toBe(false)
  })

  it('requires exact profile IDs for updates', () => {
    expect(updateOrganizationBillingProfileSchema.safeParse({ ...valid, profileId }).success).toBe(true)
    expect(updateOrganizationBillingProfileSchema.safeParse({ ...valid, profileId: '../profile' }).success).toBe(false)
  })

  it('defaults seller profile list to active records', () => {
    expect(listOrganizationBillingProfilesQuerySchema.parse({ organizationId }).status).toBe('active')
  })
})
