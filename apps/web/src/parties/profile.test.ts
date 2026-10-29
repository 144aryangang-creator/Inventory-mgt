import { describe, expect, it } from 'vitest'
import { buildPartyProfilePath } from './profile'

describe('buildPartyProfilePath', () => {
  it('keeps organization context explicit and encodes the party id', () => {
    const path = buildPartyProfilePath(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    )
    const url = new URL(path, 'https://example.test')

    expect(url.pathname).toBe('/v1/parties/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/profile')
    expect(url.searchParams.get('organizationId')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })
})
