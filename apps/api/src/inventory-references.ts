import { inventoryReferenceQuerySchema } from '@inventory/contracts/sales-fulfillment'
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

export const inventoryReferenceRoutes = new Hono<Env>()

function validationResponse(c: Context<Env>, issues?: { path: PropertyKey[]; message: string }[]) {
  return c.json({
    error: 'validation_failed',
    ...(issues ? { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : {}),
    requestId: c.get('requestId'),
  }, 400)
}

inventoryReferenceRoutes.get('/items', async (c) => {
  const parsed = inventoryReferenceQuerySchema.safeParse({
    organizationId: c.req.query('organizationId'),
    query: c.req.query('q') || undefined,
    limit: c.req.query('limit') || undefined,
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const input = parsed.data
  let query = c
    .get('supabase')
    .from('items')
    .select('id,sku,name,unit,is_active')
    .eq('organization_id', input.organizationId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(input.limit)

  if (input.query) {
    const safeQuery = input.query.replace(/[%_]/g, '').trim()
    if (safeQuery) query = query.ilike('name', `%${safeQuery}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('inventory_items_reference_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

inventoryReferenceRoutes.get('/warehouses', async (c) => {
  const parsed = inventoryReferenceQuerySchema.pick({ organizationId: true }).safeParse({
    organizationId: c.req.query('organizationId'),
  })
  if (!parsed.success) return validationResponse(c, parsed.error.issues)

  const { data, error } = await c
    .get('supabase')
    .from('warehouses')
    .select('id,code,name,is_active')
    .eq('organization_id', parsed.data.organizationId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('inventory_warehouses_reference_failed', { requestId: c.get('requestId'), code: error.code })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})
