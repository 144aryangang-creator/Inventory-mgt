import { z } from 'zod'

const quantityPattern = /^-?\d{1,14}(?:\.\d{1,6})?$/
const nonNegativeDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/

const isZeroDecimal = (value: string) => /^-?0+(?:\.0+)?$/.test(value)
const isNegativeDecimal = (value: string) => value.startsWith('-') && !isZeroDecimal(value)
const isPositiveDecimal = (value: string) => !value.startsWith('-') && !isZeroDecimal(value)

export const inventoryMovementTypeSchema = z.enum([
  'receipt',
  'sale',
  'return_in',
  'return_out',
  'transfer_in',
  'transfer_out',
  'adjustment_in',
  'adjustment_out',
])

export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>

const inboundMovementTypes = new Set<InventoryMovementType>([
  'receipt',
  'return_in',
  'transfer_in',
  'adjustment_in',
])

export const postInventoryMovementSchema = z
  .object({
    organizationId: z.uuid(),
    itemId: z.uuid(),
    warehouseId: z.uuid(),
    movementType: inventoryMovementTypeSchema,
    // Decimal strings are intentional: do not pass money/quantity through JS floating-point math.
    quantity: z.string().regex(quantityPattern, 'quantity must have at most 14 integer and 6 decimal digits'),
    unitCost: z
      .string()
      .regex(nonNegativeDecimalPattern, 'unitCost must be a non-negative decimal with at most 6 decimal digits')
      .nullable()
      .optional(),
    referenceType: z.string().trim().min(1).max(80).nullable().optional(),
    referenceId: z.uuid().nullable().optional(),
    requestKey: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (isZeroDecimal(value.quantity)) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'quantity must not be zero',
      })
      return
    }

    const inbound = inboundMovementTypes.has(value.movementType)
    if (inbound && !isPositiveDecimal(value.quantity)) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'inbound movement quantity must be positive',
      })
    }

    if (!inbound && !isNegativeDecimal(value.quantity)) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'outbound movement quantity must be negative',
      })
    }
  })

export type PostInventoryMovementInput = z.infer<typeof postInventoryMovementSchema>

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').max(120),
  slug: z
    .string()
    .trim()
    .min(3, 'Slug must be at least 3 characters')
    .max(63)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Slug can contain only letters, numbers and hyphens')
    .transform((value) => value.toLowerCase()),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Country code must contain 2 letters')
    .transform((value) => value.toUpperCase()),
  baseCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency must contain 3 letters')
    .transform((value) => value.toUpperCase()),
  timezone: z.string().trim().min(1, 'Timezone is required').max(100),
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
