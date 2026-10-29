import { postInventoryMovementSchema } from '@inventory/contracts'
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
    origin: (origin) => (origin === c.env.APP_ORIGIN ? origin : c.env.APP_ORIGIN),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 600,
  })

  return corsMiddleware(c, next)
})

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'inventory-mgt-api',
  }),
)

// All /v1 routes require a valid Supabase user access token.
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
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  // getClaims verifies the token; do not trust a decoded-but-unverified JWT.
  const { data, error } = await supabase.auth.getClaims(accessToken)
  const subject = data?.claims?.sub

  if (error || typeof subject !== 'string' || subject.length === 0) {
    return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401)
  }

  c.set('supabase', supabase)
  c.set('userId', subject)
  await next()
})

app.get('/v1/me', (c) =>
  c.json({
    userId: c.get('userId'),
    requestId: c.get('requestId'),
  }),
)

app.get('/v1/organizations', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('organizations')
    .select('id,name,slug,country_code,base_currency,timezone,allow_negative_stock')
    .order('name')

  if (error) {
    console.error('organizations_query_failed', {
      requestId: c.get('requestId'),
      code: error.code,
    })
    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ data, requestId: c.get('requestId') })
})

app.post('/v1/inventory/movements', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json', requestId: c.get('requestId') }, 400)
  }

  const parsed = postInventoryMovementSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: 'validation_failed',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        requestId: c.get('requestId'),
      },
      400,
    )
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
    console.error('inventory_post_failed', {
      requestId: c.get('requestId'),
      code: error.code,
    })

    if (error.code === '23514') {
      return c.json({ error: 'insufficient_stock_or_invalid_quantity', requestId: c.get('requestId') }, 409)
    }

    if (error.code === '42501') {
      return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403)
    }

    if (error.code === '22023') {
      return c.json({ error: 'idempotency_conflict', requestId: c.get('requestId') }, 409)
    }

    return c.json({ error: 'request_failed', requestId: c.get('requestId') }, 500)
  }

  return c.json({ movementId: data, requestId: c.get('requestId') }, 201)
})

app.notFound((c) => c.json({ error: 'not_found', requestId: c.get('requestId') }, 404))

app.onError((error, c) => {
  console.error('unhandled_api_error', {
    requestId: c.get('requestId'),
    name: error.name,
  })

  return c.json({ error: 'internal_error', requestId: c.get('requestId') }, 500)
})

export default app
