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
const supplierProfileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const recipientPartyId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const billingAddressId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('financial document contracts', () => {
  it('normalizes series and currency', () => {
    const parsed = createFinancialDocumentDraftSchema.parse({
      organizationId,
      supplierProfileId,
      recipientPartyId,
      billingAddressId,
      documentType: 'tax_invoice',
      documentDate: '2026-10-30',
      seriesCode: ' inv ',
      supplyType: 'intra_state',
      currencyCode: 'inr',
    })

    expect(parsed.seriesCode).toBe('INV')
    expect(parsed.currencyCode).toBe('INR')
  })

  it('requires seller and buyer profile IDs and strips arbitrary identity snapshots', () => {
    expect(createFinancialDocumentDraftSchema.safeParse({
      organizationId,
      supplierProfileId,
      documentType: 'tax_invoice',
      documentDate: '2026-10-30',
      seriesCode: 'INV',
      supplyType: 'intra_state',
    }).success).toBe(false)

    const parsed = createFinancialDocumentDraftSchema.parse({
      organizationId,
      supplierProfileId,
      recipientPartyId,
      billingAddressId,
      documentType: 'tax_invoice',
      documentDate: '2026-10-30',
      seriesCode: 'INV',
      supplyType: 'intra_state',
      supplierSnapshot: { legalName: 'Forged Seller' },
      supplierStateCode: '99',
      billToSnapshot: { legalName: 'Forged Buyer' },
      shipToSnapshot: { address: 'Forged Address' },
    })

    expect('supplierSnapshot' in parsed).toBe(false)
    expect('supplierStateCode' in parsed).toBe(false)
    expect('billToSnapshot' in parsed).toBe(false)
    expect('shipToSnapshot' in parsed).toBe(false)
  })

  it('requires credit and debit notes to reference an invoice', () => {
    const parsed = createFinancialDocumentDraftSchema.safeParse({
      organizationId,
      supplierProfileId,
      recipientPartyId,
      billingAddressId,
      documentType: 'credit_note',
      documentDate: '2026-10-30',
      seriesCode: 'CN',
      supplyType: 'intra_state',
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
      taxes: [
        { component: 'CGST', rate: '9' },
        { component: 'CGST', rate: '9' },
      ],
    })

    expect(parsed.success).toBe(false)
  })

  it('strips client-supplied calculated amounts', () => {
    const parsed = upsertFinancialDocumentLineSchema.parse({
      organizationId,
      documentId,
      lineNumber: 1,
      description: 'Item',
      quantity: '2',
      uom: 'EA',
      unitPrice: '100',
      discountAmount: '10',
      taxableValue: '1',
      taxes: [{ component: 'IGST', rate: '18', amount: '0.01' }],
    })

    expect('taxableValue' in parsed).toBe(false)
    expect('amount' in parsed.taxes[0]!).toBe(false)
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
