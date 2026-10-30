import {
  auditEventQuerySchema,
  operationalDashboardQuerySchema,
} from '@inventory/contracts/operations'
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

export const operationsRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

operationsRoutes.get('/dashboard', async (c) => {
  const parsed = operationalDashboardQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    days: c.req.query('days') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data, error } = await c.get('supabase').rpc('get_operational_dashboard_summary', {
    p_organization_id: parsed.data.organizationId,
    p_days: parsed.data.days,
  })

  if (error) {
    console.error('operational_dashboard_failed', { requestId: c.get('requestId'), code: error.code })
    if (error.code === '42501') return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    if (error.code === '22023') return c.json({ error: 'invalid_dashboard_window', requestId: c.get('requestId') }, 400)
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

operationsRoutes.get('/audit-events', async (c) => {
  const parsed = auditEventQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    action: c.req.query('action') || undefined,
    entityType: c.req.query('entityType') || undefined,
    actorUserId: c.req.query('actorUserId') || undefined,
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('audit_events')
    .select('id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1)

  if (input.action) query = query.eq('action', input.action)
  if (input.entityType) query = query.eq('entity_type', input.entityType)
  if (input.actorUserId) query = query.eq('actor_user_id', input.actorUserId)

  const { data, error } = await query
  if (error) {
    console.error('audit_event_list_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data: data ?? [], requestId: c.get('requestId') })
})
