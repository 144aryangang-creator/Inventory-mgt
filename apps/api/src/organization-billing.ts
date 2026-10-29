import {
  archiveOrganizationBillingProfileSchema,
  createOrganizationBillingProfileSchema,
  listOrganizationBillingProfilesQuerySchema,
  updateOrganizationBillingProfileSchema,
} from '@inventory/contracts/organization-billing'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Hono, type Context } from 'hono'

type Env = {
  Bindings: {
    APP_ORIGIN: string
    SUPABASE_URL: string
    SUPABASE_PUBLISHABLE_KEY: string
  }
  Variables: {
    requestId: string
    supabase: SupabaseClient
    userId: string
  }
}

export const organizationBillingRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

organizationBillingRoutes.get('/', async (c) => {
  const parsed = listOrganizationBillingProfilesQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    status: c.req.query('status') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data, error } = await c
    .get('supabase')
    .from('organization_billing_profiles')
    .select('id,code,legal_name,trade_name,gstin,gstin_verification_status,address_line_1,address_line_2,city,district,state_name,state_code,postal_code,country_code,is_default,status,created_at,updated_at')
    .eq('organization_id', parsed.data.organizationId)
    .eq('status', parsed.data.status)
    .order('is_default', { ascending: false })
    .order('code', { ascending: true })

  if (error) {
    console.error('organization_billing_profiles_read_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

organizationBillingRoutes.post('/', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = createOrganizationBillingProfileSchema.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_organization_billing_profile', {
    p_organization_id: input.organizationId,
    p_code: input.code,
    p_legal_name: input.legalName,
    p_address_line_1: input.addressLine1,
    p_city: input.city,
    p_state_name: input.stateName,
    p_state_code: input.stateCode,
    p_postal_code: input.postalCode,
    p_country_code: input.countryCode,
    p_trade_name: input.tradeName ?? null,
    p_gstin: input.gstin ?? null,
    p_address_line_2: input.addressLine2 ?? null,
    p_district: input.district ?? null,
    p_is_default: input.isDefault,
    p_custom_data: input.customData,
  })

  if (error) {
    console.error('organization_billing_profile_create_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '23505') return c.json({ error: 'billing_profile_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514' || error.code === '22023') return c.json({ error: 'invalid_billing_profile', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ profileId: data, requestId: c.get('requestId') }, 201)
})

organizationBillingRoutes.patch('/:profileId', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = updateOrganizationBillingProfileSchema.safeParse({ ...body, profileId: c.req.param('profileId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  const { error } = await c.get('supabase').rpc('update_organization_billing_profile', {
    p_organization_id: input.organizationId,
    p_profile_id: input.profileId,
    p_code: input.code,
    p_legal_name: input.legalName,
    p_address_line_1: input.addressLine1,
    p_city: input.city,
    p_state_name: input.stateName,
    p_state_code: input.stateCode,
    p_postal_code: input.postalCode,
    p_country_code: input.countryCode,
    p_trade_name: input.tradeName ?? null,
    p_gstin: input.gstin ?? null,
    p_address_line_2: input.addressLine2 ?? null,
    p_district: input.district ?? null,
    p_is_default: input.isDefault,
    p_custom_data: input.customData,
  })

  if (error) {
    console.error('organization_billing_profile_update_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'billing_profile_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '23505') return c.json({ error: 'billing_profile_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '23514' || error.code === '22023') return c.json({ error: 'invalid_billing_profile', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})

organizationBillingRoutes.post('/:profileId/archive', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validationResponse(c)

  const parsed = archiveOrganizationBillingProfileSchema.safeParse({ ...body, profileId: c.req.param('profileId') })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { error } = await c.get('supabase').rpc('archive_organization_billing_profile', {
    p_organization_id: parsed.data.organizationId,
    p_profile_id: parsed.data.profileId,
  })

  if (error) {
    console.error('organization_billing_profile_archive_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'billing_profile_not_found', requestId: c.get('requestId') }, 404)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})
