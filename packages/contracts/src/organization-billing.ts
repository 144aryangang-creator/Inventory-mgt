import { z } from 'zod'

const codePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

const billingProfileBaseSchema = z
  .object({
    organizationId: z.uuid(),
    code: z
      .string()
      .trim()
      .min(1, 'Profile code is required')
      .max(40)
      .regex(codePattern, 'Code can contain letters, numbers, dot, underscore, slash and hyphen')
      .transform((value) => value.toUpperCase()),
    legalName: z.string().trim().min(1, 'Legal name is required').max(200),
    tradeName: optionalText(200),
    gstin: z
      .string()
      .trim()
      .transform((value) => (value === '' ? undefined : value.toUpperCase()))
      .optional(),
    addressLine1: z.string().trim().min(1, 'Registered address is required').max(240),
    addressLine2: optionalText(240),
    city: z.string().trim().min(1, 'City is required').max(120),
    district: optionalText(120),
    stateName: z.string().trim().min(1, 'State name is required').max(120),
    stateCode: z.string().trim().min(1, 'State code is required').max(20),
    postalCode: z.string().trim().min(1, 'Postal code is required').max(20),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'Country code must contain 2 letters')
      .transform((value) => value.toUpperCase())
      .default('IN'),
    isDefault: z.boolean().default(false),
    customData: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (!value.gstin) return
    if (value.countryCode !== 'IN' || !gstinPattern.test(value.gstin)) {
      ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN must use the standard 15-character Indian format' })
      return
    }
    if (value.gstin.slice(0, 2) !== value.stateCode) {
      ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'State code must match the first 2 digits of GSTIN' })
    }
  })

export const createOrganizationBillingProfileSchema = billingProfileBaseSchema
export type CreateOrganizationBillingProfileInput = z.infer<typeof createOrganizationBillingProfileSchema>

export const updateOrganizationBillingProfileSchema = billingProfileBaseSchema.and(z.object({ profileId: z.uuid() }))
export type UpdateOrganizationBillingProfileInput = z.infer<typeof updateOrganizationBillingProfileSchema>

export const archiveOrganizationBillingProfileSchema = z.object({
  organizationId: z.uuid(),
  profileId: z.uuid(),
})

export const listOrganizationBillingProfilesQuerySchema = z.object({
  organizationId: z.uuid(),
  status: z.enum(['active', 'archived']).default('active'),
})
