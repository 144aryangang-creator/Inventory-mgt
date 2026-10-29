import { describe, expect, it } from 'vitest'
import { fulfillSalesInvoiceSchema, inventoryReferenceQuerySchema } from './sales-fulfillment'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const warehouseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('sales fulfillment contracts', () => {
  it('accepts exact identifiers and idempotency key', () => {
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

  it('bounds inventory reference lookups', () => {
    expect(inventoryReferenceQuerySchema.parse({ organizationId }).limit).toBe(100)
    expect(inventoryReferenceQuerySchema.safeParse({ organizationId, limit: '101' }).success).toBe(false)
  })
})
