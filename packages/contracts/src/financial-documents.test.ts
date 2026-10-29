import { describe, expect, it } from 'vitest'
import {
  cancelFinancialDocumentSchema,
  createFinancialDocumentDraftSchema,
  financialDocumentDetailQuerySchema,
  issueFinancialDocumentSchema,
  listFinancialDocumentsQuerySchema,
  upsertFinancialDocumentLineSchema,
} from './financial-documents'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('financial document contracts', () => {
  it('normalizes series and currency', () => {
    const parsed = createFinancialDocumentDraftSchema.parse({
      organizationId,
      documentType: 'tax_invoice',
      documentDate: '2026-10-30',
      seriesCode: ' inv ',
      supplyType: 'intra_state',
      supplierSnapshot: { legalName: 'Seller' },
      billToSnapshot: { legalName: 'Buyer' },
      currencyCode: 'inr',
    })

    expect(parsed.seriesCode).toBe('INV')
    expect(parsed.currencyCode).toBe('INR')
  })

  it('requires credit and debit notes to reference an invoice', () => {
    const parsed = createFinancialDocumentDraftSchema.safeParse({
      organizationId,
      documentType: 'credit_note',
      documentDate: '2026-10-30',
      seriesCode: 'CN',
      supplyType: 'intra_state',
      supplierSnapshot: {},
      billToSnapshot: {},
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects duplicate tax components on a line', () => {
    const parsed = upsertFinancialDocumentLineSchema.safeParse({
      organizationId,
      documentId,
      lineNumber: 1,
      description: 'Item',
      quantity: '1',
      uom: 'EA',
      unitPrice: '100',
      taxableValue: '100',
      taxes: [
        { component: 'CGST', rate: '9', amount: '9' },
        { component: 'CGST', rate: '9', amount: '9' },
      ],
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects binary-number inputs in decimal fields', () => {
    const parsed = upsertFinancialDocumentLineSchema.safeParse({
      organizationId,
      documentId,
      lineNumber: 1,
      description: 'Item',
      quantity: 1,
      uom: 'EA',
      unitPrice: 100,
      taxableValue: 100,
    })

    expect(parsed.success).toBe(false)
  })

  it('requires idempotency key when issuing', () => {
    expect(issueFinancialDocumentSchema.safeParse({ organizationId, documentId, requestKey: '' }).success).toBe(false)
  })

  it('requires a cancellation reason', () => {
    expect(cancelFinancialDocumentSchema.safeParse({ organizationId, documentId, reason: ' ' }).success).toBe(false)
  })

  it('bounds invoice list pagination and validates filters', () => {
    expect(listFinancialDocumentsQuerySchema.safeParse({ organizationId, limit: '101' }).success).toBe(false)
    expect(listFinancialDocumentsQuerySchema.safeParse({ organizationId, status: 'posted' }).success).toBe(false)
    expect(listFinancialDocumentsQuerySchema.parse({ organizationId })).toMatchObject({ limit: 50, offset: 0 })
  })

  it('requires exact UUIDs for financial document detail reads', () => {
    expect(financialDocumentDetailQuerySchema.safeParse({ organizationId, documentId }).success).toBe(true)
    expect(financialDocumentDetailQuerySchema.safeParse({ organizationId, documentId: '../invoice' }).success).toBe(false)
  })
})
