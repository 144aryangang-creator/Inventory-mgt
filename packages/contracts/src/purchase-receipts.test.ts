import { describe, expect, it } from 'vitest'
import {
  listPurchaseReceiptsQuerySchema,
  postPurchaseReceiptSchema,
  purchaseReceiptDetailQuerySchema,
} from './purchase-receipts'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const supplierPartyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const warehouseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const itemId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const receiptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('purchase receipt contracts', () => {
  it('accepts exact decimal quantities and costs', () => {
    const parsed = postPurchaseReceiptSchema.parse({
      organizationId,
      supplierPartyId,
      warehouseId,
      lines: [{ itemId, quantity: '2.500000', unitCost: '100.25' }],
      supplierReference: ' DN-10 ',
      notes: ' accepted goods ',
      receivedAt: '2026-10-30T00:10:00.000Z',
      requestKey: ' receipt-1 ',
    })

    expect(parsed.lines[0]).toMatchObject({ quantity: '2.500000', unitCost: '100.25' })
    expect(parsed.supplierReference).toBe('DN-10')
    expect(parsed.notes).toBe('accepted goods')
    expect(parsed.requestKey).toBe('receipt-1')
  })

  it('allows zero unit cost but rejects zero quantity', () => {
    expect(postPurchaseReceiptSchema.safeParse({
      organizationId,
      supplierPartyId,
      warehouseId,
      lines: [{ itemId, quantity: '1', unitCost: '0' }],
      requestKey: 'receipt-free',
    }).success).toBe(true)

    expect(postPurchaseReceiptSchema.safeParse({
      organizationId,
      supplierPartyId,
      warehouseId,
      lines: [{ itemId, quantity: '0', unitCost: '10' }],
      requestKey: 'receipt-zero',
    }).success).toBe(false)
  })

  it('rejects binary-number quantity and cost inputs', () => {
    expect(postPurchaseReceiptSchema.safeParse({
      organizationId,
      supplierPartyId,
      warehouseId,
      lines: [{ itemId, quantity: 2, unitCost: 100.25 }],
      requestKey: 'receipt-numeric',
    }).success).toBe(false)
  })

  it('rejects malformed references and timestamps', () => {
    expect(postPurchaseReceiptSchema.safeParse({
      organizationId,
      supplierPartyId: 'bad',
      warehouseId,
      lines: [{ itemId, quantity: '1', unitCost: '10' }],
      requestKey: 'receipt-bad-id',
    }).success).toBe(false)

    expect(postPurchaseReceiptSchema.safeParse({
      organizationId,
      supplierPartyId,
      warehouseId,
      lines: [{ itemId, quantity: '1', unitCost: '10' }],
      receivedAt: 'not-a-date',
      requestKey: 'receipt-bad-date',
    }).success).toBe(false)
  })

  it('bounds history pagination', () => {
    expect(listPurchaseReceiptsQuerySchema.parse({ organizationId })).toMatchObject({ limit: 50, offset: 0 })
    expect(listPurchaseReceiptsQuerySchema.safeParse({ organizationId, limit: '101' }).success).toBe(false)
  })

  it('requires exact UUIDs for detail reads', () => {
    expect(purchaseReceiptDetailQuerySchema.safeParse({ organizationId, receiptId }).success).toBe(true)
    expect(purchaseReceiptDetailQuerySchema.safeParse({ organizationId, receiptId: '../receipt' }).success).toBe(false)
  })
})
