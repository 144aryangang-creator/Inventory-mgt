import {
  archivePartySchema,
  createOrganizationSchema,
  createPartySchema,
  listPartiesQuerySchema,
  postInventoryMovementSchema,
  updatePartySchema,
} from '@inventory/contracts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

type Bindings = {
  APP_ORIGIN: string
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}

type Variables = {
  requestId: string
  supabase: SupabaseClient
  userId: string
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('*', secureHeaders())

app.use('*', async (c, next) => {
  const requestId = c.req.header('CF-Ray') ?? crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  await next()
})

app.use('/v1/*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.APP_ORIGIN,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 600,
  })

  return corsMiddleware(c, next)
})

app.get('/health', (c) => c.json({ ok: true, service: 'inventory-mgt-api' }))

app.use('/v1/*', async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401)
  }

  const accessToken = authorization.slice('Bearer '.length).trim()
  if (!accessToken) {
    return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401)
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const { data, error } = await supabase.auth.getClaims(accessToken)
  const subject = data?.claims?.sub

  if (error || typeof subject !== 'string' || subject.length === 0) {
    return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401)
  }

  c.set('supabase', supabase)
  c.set('userId', subject)
  await next()
})

app.get('/v1/me', (c) => c.json({ userId: c.get('userId'), requestId: c.get('requestId') }))

app.get('/v1/organizations', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('organizations')
    .select('id,name,slug,country_code,base_currency,timezone,allow_negative_stock')
    .order('name')

  if (error) {
    console.error('organizations_query_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

app.post('/v1/organizations', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = createOrganizationSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      requestId: c.get('requestId'),
    }, 400)
  }

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_organization', {
    p_name: input.name,
    p_slug: input.slug,
    p_country_code: input.countryCode,
    p_base_currency: input.baseCurrency,
    p_timezone: input.timezone,
  })

  if (error) {
    console.error('organization_create_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '23505') return c.json({ error: 'organization_slug_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '23514' || error.code === '22023') return c.json({ error: 'invalid_organization', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ organizationId: data, requestId: c.get('requestId') }, 201)
})

app.get('/v1/parties', async (c) => {
  const parsed = listPartiesQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    role: c.req.query('role') || undefined,
    status: c.req.query('status') || undefined,
    query: c.req.query('q') || undefined,
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })

  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      requestId: c.get('requestId'),
    }, 400)
  }

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('search_parties', {
    p_organization_id: input.organizationId,
    p_role: input.role ?? null,
    p_status: input.status,
    p_query: input.query ?? null,
    p_limit: input.limit,
    p_offset: input.offset,
  })

  if (error) {
    console.error('party_search_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

app.post('/v1/parties', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = createPartySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      requestId: c.get('requestId'),
    }, 400)
  }

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('create_party', {
    p_organization_id: input.organizationId,
    p_code: input.code,
    p_legal_name: input.legalName,
    p_display_name: input.displayName,
    p_roles: input.roles,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_custom_data: input.customData,
  })

  if (error) {
    console.error('party_create_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '23505') return c.json({ error: 'party_code_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '22023' || error.code === '23514') return c.json({ error: 'invalid_party', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ partyId: data, requestId: c.get('requestId') }, 201)
})

app.patch('/v1/parties/:partyId', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'validation_failed', requestId: c.get('requestId') }, 400)
  }

  const parsed = updatePartySchema.safeParse({ ...body, partyId: c.req.param('partyId') })
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      requestId: c.get('requestId'),
    }, 400)
  }

  const input = parsed.data
  const { error } = await c.get('supabase').rpc('update_party', {
    p_organization_id: input.organizationId,
    p_party_id: input.partyId,
    p_code: input.code,
    p_legal_name: input.legalName,
    p_display_name: input.displayName,
    p_roles: input.roles,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_custom_data: input.customData,
  })

  if (error) {
    console.error('party_update_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '23505') return c.json({ error: 'party_code_conflict', requestId: c.get('requestId') }, 409)
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'party_not_found', requestId: c.get('requestId') }, 404)
    if (error.code === '22023' || error.code === '23514') return c.json({ error: 'invalid_party', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})

app.post('/v1/parties/:partyId/archive', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'validation_failed', requestId: c.get('requestId') }, 400)
  }

  const parsed = archivePartySchema.safeParse({ ...body, partyId: c.req.param('partyId') })
  if (!parsed.success) {
    return c.json({ error: 'validation_failed', requestId: c.get('requestId') }, 400)
  }

  const { error } = await c.get('supabase').rpc('archive_party', {
    p_organization_id: parsed.data.organizationId,
    p_party_id: parsed.data.partyId,
  })

  if (error) {
    console.error('party_archive_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === 'P0002') return c.json({ error: 'party_not_found', requestId: c.get('requestId') }, 404)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ ok: true, requestId: c.get('requestId') })
})

app.post('/v1/inventory/movements', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400) }

  const parsed = postInventoryMovementSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      requestId: c.get('requestId'),
    }, 400)
  }

  const input = parsed.data
  const { data, error } = await c.get('supabase').rpc('post_inventory_movement', {
    p_organization_id: input.organizationId,
    p_item_id: input.itemId,
    p_warehouse_id: input.warehouseId,
    p_movement_type: input.movementType,
    p_quantity: input.quantity,
    p_unit_cost: input.unitCost ?? null,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_request_key: input.requestKey ?? null,
  })

  if (error) {
    console.error('inventory_post_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '23514') return c.json({ error: 'insufficient_stock_or_invalid_quantity', requestId: c.get('requestId') }, 409)
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '22023') return c.json({ error: 'idempotency_conflict', requestId: c.get('requestId') }, 409)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ movementId: data, requestId: c.get('requestId') }, 201)
})

app.notFound((c) => c.json({ error: 'not_found', requestId: c.get('requestId') }, 404))

app.onError((error, c) => {
  console.error('unhandled_api_error', { requestId: c.get('requestId'), name: error.name })
  return c.json({ error: 'internal_error', requestId: c.get('requestId') }, 500)
})

export default app
