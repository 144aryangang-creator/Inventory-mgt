import { describe, expect, it } from 'vitest'
import app from './worker'

const env = {
  APP_ORIGIN: 'http://localhost:5173',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
}

describe('API security boundaries', () => {
  it('returns a minimal public health response with baseline security headers', async () => {
    const response = await app.request('/health', {}, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: 'inventory-mgt-api',
    })
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('rejects protected API calls without a bearer token and disables caching', async () => {
    const response = await app.request('/v1/organizations', {}, env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: 'unauthorized',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects mounted invoice API calls without a bearer token', async () => {
    const response = await app.request('/v1/financial-documents', { method: 'POST' }, env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: 'unauthorized',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps sales-fulfillment routes mounted behind authentication', async () => {
    const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const organizationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const response = await app.request(
      `/v1/financial-documents/${documentId}/fulfillments?organizationId=${organizationId}`,
      {},
      env,
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'unauthorized' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects an empty bearer token', async () => {
    const response = await app.request(
      '/v1/organizations',
      {
        headers: {
          Authorization: 'Bearer ',
        },
      },
      env,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns a generic not-found response without leaking internals', async () => {
    const response = await app.request('/does-not-exist', {}, env)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'not_found',
    })
  })
})
