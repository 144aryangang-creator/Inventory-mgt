import { z } from 'zod'

const positiveDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const itemCodePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/
const warehouseCodePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/

const positiveQuantitySchema = z
  .string()
  .regex(positiveDecimalPattern, 'Quantity must be a positive decimal string with at most 6 decimal places')
  .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'Quantity must be greater than zero')

const optionalText = (max: number) => z
  .string()
  .trim()
  .max(max)
  .transform((value) => (value === '' ? undefined : value))
  .optional()

const itemBaseSchema = z.object({
  organizationId: z.uuid(),
  sku: z
    .string()
    .trim()
    .min(1, 'SKU is required')
    .max(80)
    .regex(itemCodePattern, 'SKU can contain letters, numbers, dot, underscore, slash and hyphen')
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'Item name is required').max(200),
  description: optionalText(2000),
  baseUom: z
    .string()
    .trim()
    .min(1, 'Base unit is required')
    .max(20)
    .transform((value) => value.toUpperCase()),
  trackInventory: z.boolean().default(true),
  customData: z.record(z.string(), z.unknown()).default({}),
})

export const createInventoryItemSchema = itemBaseSchema
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>

export const updateInventoryItemSchema = itemBaseSchema.extend({ itemId: z.uuid() })
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>

export const archiveInventoryItemSchema = z.object({
  organizationId: z.uuid(),
  itemId: z.uuid(),
})

const warehouseBaseSchema = z.object({
  organizationId: z.uuid(),
  code: z
    .string()
    .trim()
    .min(1, 'Warehouse code is required')
    .max(40)
    .regex(warehouseCodePattern, 'Warehouse code can contain letters, numbers, dot, underscore, slash and hyphen')
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'Warehouse name is required').max(120),
})

export const createWarehouseSchema = warehouseBaseSchema
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>

export const updateWarehouseSchema = warehouseBaseSchema.extend({ warehouseId: z.uuid() })
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>

export const archiveWarehouseSchema = z.object({
  organizationId: z.uuid(),
  warehouseId: z.uuid(),
})

export const inventoryMasterListQuerySchema = z.object({
  organizationId: z.uuid(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  query: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export const inventoryBalanceQuerySchema = z.object({
  organizationId: z.uuid(),
  itemId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
})

export const inventoryMovementListQuerySchema = z.object({
  organizationId: z.uuid(),
  itemId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export const transferInventorySchema = z
  .object({
    organizationId: z.uuid(),
    itemId: z.uuid(),
    fromWarehouseId: z.uuid(),
    toWarehouseId: z.uuid(),
    quantity: positiveQuantitySchema,
    requestKey: z.string().trim().min(1, 'Request key is required').max(120),
  })
  .refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
    path: ['toWarehouseId'],
    message: 'Destination warehouse must differ from source warehouse',
  })

export type TransferInventoryInput = z.infer<typeof transferInventorySchema>
