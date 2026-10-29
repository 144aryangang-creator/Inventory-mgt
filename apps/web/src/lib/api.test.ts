import { describe, expect, it } from 'vitest'
import { joinApiUrl } from './api'

describe('joinApiUrl', () => {
  it('joins a base URL and path without duplicate slashes', () => {
    expect(joinApiUrl('https://api.example.com/', '/v1/items')).toBe(
      'https://api.example.com/v1/items',
    )
  })

  it('supports same-origin API paths', () => {
    expect(joinApiUrl('', 'v1/items')).toBe('/v1/items')
  })
})
