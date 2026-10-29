import { describe, expect, it } from 'vitest'
import { financialDocumentRoutes } from './financial-documents'

describe('financial document API boundary', () => {
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
