import { describe, expect, it } from 'vitest'
import { financialDocumentRoutes } from './financial-documents'

describe('financial document API boundary', () => {
  it('rejects invalid list queries before calling the database', async () => {
    const response = await financialDocumentRoutes.request('/?organizationId=not-a-uuid&limit=500')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects invalid detail identifiers before calling the database', async () => {
    const response = await financialDocumentRoutes.request('/not-a-uuid?organizationId=not-a-uuid')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects invalid draft payloads before calling the database', async () => {
    const response = await financialDocumentRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentType: 'tax_invoice' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects malformed JSON', async () => {
    const response = await financialDocumentRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_json' })
  })
})
