import { z } from 'zod'

const quantityPattern = /^-?\d{1,14}(?:\.\d{1,6})?$/
const nonNegativeDecimalPattern = /^\d{1,14}(?:\.\d{1,6})?$/
const partyCodePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
const basicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const taxSchemePattern = /^[A-Za-z0-9_-]{2,30}$/
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/

const isZeroDecimal = (value: string) => /^-?0+(?:\.0+)?$/.test(value)
const isNegativeDecimal = (value: string) => value.startsWith('-') && !isZeroDecimal(value)
const isPositiveDecimal = (value: string) => !value.startsWith('-') && !isZeroDecimal(value)

function optionalTrimmedText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

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
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'quantity must not be zero' })
      return
    }

    const inbound = inboundMovementTypes.has(value.movementType)
    if (inbound && !isPositiveDecimal(value.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'inbound movement quantity must be positive' })
    }

    if (!inbound && !isNegativeDecimal(value.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'outbound movement quantity must be negative' })
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

export const partyRoleSchema = z.enum(['customer', 'supplier'])
export type PartyRole = z.infer<typeof partyRoleSchema>

export const partyStatusSchema = z.enum(['active', 'archived'])
export type PartyStatus = z.infer<typeof partyStatusSchema>

const partyEmailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === '' || basicEmailPattern.test(value), 'Enter a valid email address')
  .transform((value) => (value === '' ? undefined : value.toLowerCase()))
  .optional()

const partyPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value) => (value === '' ? undefined : value))
  .optional()

const partyRolesSchema = z
  .array(partyRoleSchema)
  .min(1, 'At least one party role is required')
  .max(2)
  .refine((roles) => new Set(roles).size === roles.length, 'Party roles must be unique')

const partyBaseSchema = z.object({
  organizationId: z.uuid(),
  code: z
    .string()
    .trim()
    .min(1, 'Party code is required')
    .max(40)
    .regex(partyCodePattern, 'Code can contain letters, numbers, dot, underscore, slash and hyphen')
    .transform((value) => value.toUpperCase()),
  legalName: z.string().trim().min(1, 'Legal name is required').max(200),
  displayName: z.string().trim().min(1, 'Display name is required').max(200),
  roles: partyRolesSchema,
  email: partyEmailSchema,
  phone: partyPhoneSchema,
  customData: z.record(z.string(), z.unknown()).default({}),
})

export const createPartySchema = partyBaseSchema
export type CreatePartyInput = z.infer<typeof createPartySchema>

export const updatePartySchema = partyBaseSchema.extend({
  partyId: z.uuid(),
})
export type UpdatePartyInput = z.infer<typeof updatePartySchema>

export const archivePartySchema = z.object({
  organizationId: z.uuid(),
  partyId: z.uuid(),
})
export type ArchivePartyInput = z.infer<typeof archivePartySchema>

export const listPartiesQuerySchema = z.object({
  organizationId: z.uuid(),
  role: partyRoleSchema.optional(),
  status: partyStatusSchema.default('active'),
  query: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListPartiesQuery = z.infer<typeof listPartiesQuerySchema>

export const partyProfileQuerySchema = z.object({
  organizationId: z.uuid(),
  partyId: z.uuid(),
})

const partyAddressBaseSchema = z.object({
  organizationId: z.uuid(),
  partyId: z.uuid(),
  label: z.string().trim().min(1, 'Address label is required').max(80),
  recipientName: optionalTrimmedText(200),
  addressLine1: z.string().trim().min(1, 'Address line 1 is required').max(240),
  addressLine2: optionalTrimmedText(240),
  city: z.string().trim().min(1, 'City is required').max(120),
  district: optionalTrimmedText(120),
  stateName: optionalTrimmedText(120),
  stateCode: optionalTrimmedText(20),
  postalCode: optionalTrimmedText(20),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Country code must contain 2 letters')
    .transform((value) => value.toUpperCase())
    .default('IN'),
  isDefaultBilling: z.boolean().default(false),
  isDefaultShipping: z.boolean().default(false),
  isRegisteredAddress: z.boolean().default(false),
  customData: z.record(z.string(), z.unknown()).default({}),
})

export const createPartyAddressSchema = partyAddressBaseSchema
export type CreatePartyAddressInput = z.infer<typeof createPartyAddressSchema>

export const updatePartyAddressSchema = partyAddressBaseSchema.extend({
  addressId: z.uuid(),
})
export type UpdatePartyAddressInput = z.infer<typeof updatePartyAddressSchema>

export const archivePartyAddressSchema = z.object({
  organizationId: z.uuid(),
  partyId: z.uuid(),
  addressId: z.uuid(),
})

const taxRegistrationBaseObject = z.object({
  organizationId: z.uuid(),
  partyId: z.uuid(),
  scheme: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(taxSchemePattern, 'Tax scheme can contain only letters, numbers, underscore and hyphen')
    .transform((value) => value.toUpperCase()),
  registrationNumber: z
    .string()
    .trim()
    .min(2, 'Registration number is required')
    .max(80)
    .transform((value) => value.toUpperCase()),
  registeredName: optionalTrimmedText(200),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Country code must contain 2 letters')
    .transform((value) => value.toUpperCase())
    .default('IN'),
  stateCode: optionalTrimmedText(20),
  isDefault: z.boolean().default(false),
})

type TaxRegistrationShape = z.infer<typeof taxRegistrationBaseObject>

function validateTaxRegistration(value: TaxRegistrationShape, ctx: z.RefinementCtx) {
  if (value.scheme !== 'GSTIN') return

  if (value.countryCode !== 'IN') {
    ctx.addIssue({ code: 'custom', path: ['countryCode'], message: 'GSTIN must use country code IN' })
  }

  if (!gstinPattern.test(value.registrationNumber)) {
    ctx.addIssue({ code: 'custom', path: ['registrationNumber'], message: 'Enter a structurally valid 15-character GSTIN' })
  }

  if (!value.stateCode || value.stateCode !== value.registrationNumber.slice(0, 2)) {
    ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'GST state code must match the first 2 digits of GSTIN' })
  }
}

export const createPartyTaxRegistrationSchema = taxRegistrationBaseObject.superRefine(validateTaxRegistration)
export type CreatePartyTaxRegistrationInput = z.infer<typeof createPartyTaxRegistrationSchema>

export const updatePartyTaxRegistrationSchema = taxRegistrationBaseObject
  .extend({ registrationId: z.uuid() })
  .superRefine(validateTaxRegistration)
export type UpdatePartyTaxRegistrationInput = z.infer<typeof updatePartyTaxRegistrationSchema>

export const archivePartyTaxRegistrationSchema = z.object({
  organizationId: z.uuid(),
  partyId: z.uuid(),
  registrationId: z.uuid(),
})
