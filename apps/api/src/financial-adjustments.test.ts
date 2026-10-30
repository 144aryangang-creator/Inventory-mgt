import { describe, expect, it } from 'vitest'
import { financialAdjustmentRoutes } from './financial-adjustments'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const originalInvoiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const originalLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('financial adjustment API boundary', () => {
  it('rejects malformed adjustment history identifiers before database access', async () => {
    const response = await financialAdjustmentRoutes.request('/?organizationId=bad&originalInvoiceId=bad')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'validation_failed' })
  })

  it('rejects numeric quantity/value inputs before database access', async () => {
    const response = await financialAdjustmentRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        originalInvoiceId,
        adjustmentType: 'credit_note',
        lines: [{ originalLineId, basisQuantity: 1, taxableAdjustment: 100 }],
        documentDate: '2026-10-30',
        seriesCode: 'CRN',
        reason: 'Commercial concession',
        requestKey: 'adjust-1',
      }),
    })

    expect(response.status).toBe(400)
  })

  it('rejects duplicate original invoice lines before database access', async () => {
    const response = await financialAdjustmentRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        originalInvoiceId,
        adjustmentType: 'debit_note',
        lines: [
          { originalLineId, basisQuantity: '1', taxableAdjustment: '100' },
          { originalLineId, basisQuantity: '1', taxableAdjustment: '50' },
        ],
        documentDate: '2026-10-30',
        seriesCode: 'DBN',
        reason: 'Undercharged value',
        requestKey: 'adjust-2',
      }),
    })

    expect(response.status).toBe(400)
  })

  it('rejects tax invoices as an adjustment type', async () => {
    const response = await financialAdjustmentRoutes.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        originalInvoiceId,
        adjustmentType: 'tax_invoice',
        lines: [{ originalLineId, basisQuantity: '1', taxableAdjustment: '100' }],
        documentDate: '2026-10-30',
        seriesCode: 'INV',
        reason: 'Invalid adjustment',
        requestKey: 'adjust-3',
      }),
    })

    expect(response.status).toBe(400)
  })
})
