import { describe, expect, it } from 'vitest'
import { chooseActiveOrganization, suggestOrganizationSlug, type Organization } from './organization'

const organizations: Organization[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Alpha',
    slug: 'alpha',
    country_code: 'IN',
    base_currency: 'INR',
    timezone: 'Asia/Kolkata',
    allow_negative_stock: false,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Beta',
    slug: 'beta',
    country_code: 'IN',
    base_currency: 'INR',
    timezone: 'Asia/Kolkata',
    allow_negative_stock: false,
  },
]

describe('organization selection', () => {
  it('honors a valid preferred organization', () => {
    expect(chooseActiveOrganization(organizations, organizations[1]?.id)?.name).toBe('Beta')
  })

  it('falls back to the first accessible organization', () => {
    expect(chooseActiveOrganization(organizations, 'not-accessible')?.name).toBe('Alpha')
  })

  it('returns null when the user has no organizations', () => {
    expect(chooseActiveOrganization([], null)).toBeNull()
  })
})

describe('suggestOrganizationSlug', () => {
  it('creates a URL-safe lowercase suggestion', () => {
    expect(suggestOrganizationSlug('  Bhopal Tractor & Farm  ')).toBe('bhopal-tractor-farm')
  })
})
