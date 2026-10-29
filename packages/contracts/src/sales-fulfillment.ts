import { z } from 'zod'

export const fulfillSalesInvoiceSchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid(),
  warehouseId: z.uuid(),
  requestKey: z.string().trim().min(1, 'Request key is required').max(128),
})
export type FulfillSalesInvoiceInput = z.infer<typeof fulfillSalesInvoiceSchema>

export const inventoryReferenceQuerySchema = z.object({
  organizationId: z.uuid(),
  query: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})
export type InventoryReferenceQuery = z.infer<typeof inventoryReferenceQuerySchema>
