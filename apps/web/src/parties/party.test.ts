import { describe, expect, it } from 'vitest'
import { buildPartySearchPath } from './party'

describe('buildPartySearchPath', () => {
  it('encodes tenant, role and search text safely', () => {
    const path = buildPartySearchPath(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'customer',
      'Acme & Sons',
    )
    const url = new URL(path, 'https://example.test')

    expect(url.pathname).toBe('/v1/parties')
    expect(url.searchParams.get('organizationId')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(url.searchParams.get('role')).toBe('customer')
    expect(url.searchParams.get('q')).toBe('Acme & Sons')
    expect(url.searchParams.get('limit')).toBe('50')
  })
})
