import { describe, expect, it } from 'vitest'
import {
  fulfillSalesInvoiceSchema,
  inventoryReferenceQuerySchema,
  issueSalesReturnCreditNoteSchema,
  postSalesFulfillmentSchema,
  returnSalesFulfillmentSchema,
  salesFulfillmentHistoryQuerySchema,
} from './sales-fulfillment'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const warehouseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const fulfillmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const fulfillmentLineId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const salesReturnId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

describe('sales fulfillment contracts', () => {
  it('accepts exact identifiers and idempotency key for legacy full fulfillment', () => {
    expect(fulfillSalesInvoiceSchema.parse({
      organizationId,
      documentId,
      warehouseId,
      requestKey: ' fulfill-1 ',
    }).requestKey).toBe('fulfill-1')
  })

  it('rejects malformed identifiers and empty request keys', () => {
    expect(fulfillSalesInvoiceSchema.safeParse({ organizationId, documentId: '../invoice', warehouseId, requestKey: 'x' }).success).toBe(false)
    expect(fulfillSalesInvoiceSchema.safeParse({ organizationId, documentId, warehouseId, requestKey: ' ' }).success).toBe(false)
  })

  it('accepts exact decimal partial fulfillment quantities', () => {
    expect(postSalesFulfillmentSchema.safeParse({
      organizationId,
      documentId,
      warehouseId,
      lines: [{ financialDocumentLineId: fulfillmentLineId, quantity: '1.250000' }],
      requestKey: 'partial-1',
    }).success).toBe(true)

    expect(postSalesFulfillmentSchema.safeParse({
      organizationId,
      documentId,
      warehouseId,
      lines: [{ financialDocumentLineId: fulfillmentLineId, quantity: 1.25 }],
      requestKey: 'partial-1',
    }).success).toBe(false)
  })

  it('rejects duplicate original invoice lines in one fulfillment posting', () => {
    expect(postSalesFulfillmentSchema.safeParse({
      organizationId,
      documentId,
      warehouseId,
      lines: [
        { financialDocumentLineId: fulfillmentLineId, quantity: '1' },
        { financialDocumentLineId: fulfillmentLineId, quantity: '1' },
      ],
      requestKey: 'partial-2',
    }).success).toBe(false)
  })

  it('validates fulfillment history identifiers', () => {
    expect(salesFulfillmentHistoryQuerySchema.safeParse({ organizationId, documentId }).success).toBe(true)
    expect(salesFulfillmentHistoryQuerySchema.safeParse({ organizationId, documentId: 'bad' }).success).toBe(false)
  })

  it('validates exact decimal sales return quantities', () => {
    expect(returnSalesFulfillmentSchema.safeParse({
      organizationId,
      fulfillmentId,
      lines: [{ fulfillmentLineId, quantity: '1.250000' }],
      reason: 'Customer return',
      requestKey: 'return-1',
    }).success).toBe(true)
    expect(returnSalesFulfillmentSchema.safeParse({
      organizationId,
      fulfillmentId,
      lines: [{ fulfillmentLineId, quantity: 1.25 }],
      reason: 'Customer return',
      requestKey: 'return-1',
    }).success).toBe(false)
  })

  it('rejects duplicate fulfillment lines in one return request', () => {
    expect(returnSalesFulfillmentSchema.safeParse({
      organizationId,
      fulfillmentId,
      lines: [
        { fulfillmentLineId, quantity: '1' },
        { fulfillmentLineId, quantity: '1' },
      ],
      reason: 'Customer return',
      requestKey: 'return-2',
    }).success).toBe(false)
  })

  it('normalizes return credit series and requires exact decimal quantities', () => {
    const parsed = issueSalesReturnCreditNoteSchema.parse({
      organizationId,
      salesReturnId,
      lines: [{ fulfillmentLineId, quantity: '1.500000' }],
      documentDate: '2026-10-30',
      seriesCode: ' crn ',
      requestKey: 'credit-1',
    })
    expect(parsed.seriesCode).toBe('CRN')

    expect(issueSalesReturnCreditNoteSchema.safeParse({
      organizationId,
      salesReturnId,
      lines: [{ fulfillmentLineId, quantity: 1.5 }],
      documentDate: '2026-10-30',
      seriesCode: 'CRN',
      requestKey: 'credit-1',
    }).success).toBe(false)
  })

  it('rejects duplicate return-credit source lines and invalid dates', () => {
    expect(issueSalesReturnCreditNoteSchema.safeParse({
      organizationId,
      salesReturnId,
      lines: [
        { fulfillmentLineId, quantity: '1' },
        { fulfillmentLineId, quantity: '1' },
      ],
      documentDate: '30-10-2026',
      seriesCode: 'CRN',
      requestKey: 'credit-2',
    }).success).toBe(false)
  })

  it('bounds inventory reference lookups', () => {
    expect(inventoryReferenceQuerySchema.parse({ organizationId }).limit).toBe(100)
    expect(inventoryReferenceQuerySchema.safeParse({ organizationId, limit: '101' }).success).toBe(false)
  })
})
