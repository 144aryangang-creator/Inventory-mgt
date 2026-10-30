import { describe, expect, it } from 'vitest'
import {
  cancelFinancialDocumentSchema,
  createFinancialDocumentDraftSchema,
  financialAdjustmentHistoryQuerySchema,
  financialDocumentDetailQuerySchema,
  issueFinancialDocumentSchema,
  issueInvoiceAdjustmentSchema,
  listFinancialDocumentsQuerySchema,
  upsertFinancialDocumentLineSchema,
} from './financial-documents'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const supplierProfileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const recipientPartyId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const billingAddressId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const originalLineId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

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

  it('rejects credit/debit notes on the generic tax-invoice draft route', () => {
    expect(createFinancialDocumentDraftSchema.safeParse({
      organizationId,
      supplierProfileId,
      recipientPartyId,
      billingAddressId,
      documentType: 'credit_note',
      linkedDocumentId: documentId,
      documentDate: '2026-10-30',
      seriesCode: 'CN',
      supplyType: 'intra_state',
    }).success).toBe(false)

    expect(createFinancialDocumentDraftSchema.safeParse({
      organizationId,
      supplierProfileId,
      recipientPartyId,
      billingAddressId,
      documentType: 'debit_note',
      linkedDocumentId: documentId,
      documentDate: '2026-10-30',
      seriesCode: 'DN',
      supplyType: 'intra_state',
    }).success).toBe(false)
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

  it('accepts exact-decimal credit/debit adjustments and normalizes series', () => {
    const parsed = issueInvoiceAdjustmentSchema.parse({
      organizationId,
      originalInvoiceId: documentId,
      adjustmentType: 'credit_note',
      lines: [{ originalLineId, basisQuantity: '1.250000', taxableAdjustment: '125.50' }],
      documentDate: '2026-10-30',
      seriesCode: ' crn ',
      reason: 'Commercial concession',
      requestKey: 'adjust-1',
    })

    expect(parsed.seriesCode).toBe('CRN')
    expect(parsed.lines[0]?.taxableAdjustment).toBe('125.50')
  })

  it('rejects numeric adjustment quantities/values and unsupported adjustment types', () => {
    expect(issueInvoiceAdjustmentSchema.safeParse({
      organizationId,
      originalInvoiceId: documentId,
      adjustmentType: 'credit_note',
      lines: [{ originalLineId, basisQuantity: 1, taxableAdjustment: '100' }],
      documentDate: '2026-10-30',
      seriesCode: 'CRN',
      reason: 'Commercial concession',
      requestKey: 'adjust-2',
    }).success).toBe(false)

    expect(issueInvoiceAdjustmentSchema.safeParse({
      organizationId,
      originalInvoiceId: documentId,
      adjustmentType: 'tax_invoice',
      lines: [{ originalLineId, basisQuantity: '1', taxableAdjustment: '100' }],
      documentDate: '2026-10-30',
      seriesCode: 'INV',
      reason: 'Invalid type',
      requestKey: 'adjust-3',
    }).success).toBe(false)
  })

  it('rejects duplicate original invoice lines in one adjustment request', () => {
    expect(issueInvoiceAdjustmentSchema.safeParse({
      organizationId,
      originalInvoiceId: documentId,
      adjustmentType: 'debit_note',
      lines: [
        { originalLineId, basisQuantity: '1', taxableAdjustment: '50' },
        { originalLineId, basisQuantity: '1', taxableAdjustment: '25' },
      ],
      documentDate: '2026-10-30',
      seriesCode: 'DBN',
      reason: 'Undercharged value',
      requestKey: 'adjust-4',
    }).success).toBe(false)
  })

  it('validates financial adjustment history identifiers', () => {
    expect(financialAdjustmentHistoryQuerySchema.safeParse({ organizationId, originalInvoiceId: documentId }).success).toBe(true)
    expect(financialAdjustmentHistoryQuerySchema.safeParse({ organizationId, originalInvoiceId: 'bad' }).success).toBe(false)
  })
})
