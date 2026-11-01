import { randomUUID } from 'node:crypto'

const apiBaseUrl = process.env.API_BASE_URL
const accessToken = process.env.ACCESS_TOKEN
const organizationId = process.env.ORGANIZATION_ID

if (!apiBaseUrl || !accessToken || !organizationId) {
  throw new Error('API_BASE_URL, ACCESS_TOKEN and ORGANIZATION_ID are required')
}

const suffix = randomUUID().slice(0, 8).toUpperCase()
const authHeaders = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

async function request(path, { method = 'GET', body, expected = [200] } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: authHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = text }
  }

  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`)
  }

  if (path.startsWith('/v1/') && response.headers.get('cache-control') !== 'no-store') {
    throw new Error(`${method} ${path} did not return Cache-Control: no-store`)
  }

  return { status: response.status, payload }
}

const item = await request('/v1/inventory/items', {
  method: 'POST',
  expected: [201],
  body: {
    organizationId,
    sku: `CONT-${suffix}`,
    name: `Contention Item ${suffix}`,
    baseUom: 'EA',
    trackInventory: true,
    customData: {},
  },
})
const itemId = item.payload.itemId

async function createWarehouse(code, name) {
  const result = await request('/v1/inventory/warehouses', {
    method: 'POST',
    expected: [201],
    body: { organizationId, code, name },
  })
  return result.payload.warehouseId
}

const sourceWarehouseId = await createWarehouse(`SRC-${suffix}`, `Source ${suffix}`)
const destinationAId = await createWarehouse(`DSTA-${suffix}`, `Destination A ${suffix}`)
const destinationBId = await createWarehouse(`DSTB-${suffix}`, `Destination B ${suffix}`)

const supplier = await request('/v1/parties', {
  method: 'POST',
  expected: [201],
  body: {
    organizationId,
    code: `SUP-${suffix}`,
    legalName: `Contention Supplier ${suffix}`,
    displayName: `Contention Supplier ${suffix}`,
    roles: ['supplier'],
    customData: {},
  },
})

await request('/v1/purchase-receipts', {
  method: 'POST',
  expected: [201],
  body: {
    organizationId,
    supplierPartyId: supplier.payload.partyId,
    warehouseId: sourceWarehouseId,
    lines: [{ itemId, quantity: '1', unitCost: '10' }],
    supplierReference: `CONT-${suffix}`,
    notes: 'Concurrency hardening seed receipt',
    requestKey: `contention-receipt-${suffix}`,
  },
})

const transferBody = (toWarehouseId, key) => ({
  organizationId,
  itemId,
  fromWarehouseId: sourceWarehouseId,
  toWarehouseId,
  quantity: '1',
  requestKey: key,
})

// Fire two outbound transfers together against exactly one unit on hand.
// PostgreSQL row locking + negative-stock protection must allow exactly one.
const [transferA, transferB] = await Promise.all([
  request('/v1/inventory/transfers', {
    method: 'POST',
    expected: [201, 409],
    body: transferBody(destinationAId, `contention-a-${suffix}`),
  }),
  request('/v1/inventory/transfers', {
    method: 'POST',
    expected: [201, 409],
    body: transferBody(destinationBId, `contention-b-${suffix}`),
  }),
])

const statuses = [transferA.status, transferB.status].sort((a, b) => a - b)
if (statuses[0] !== 201 || statuses[1] !== 409) {
  throw new Error(`Expected exactly one transfer success and one conflict; got ${statuses.join(', ')}`)
}

const balances = await request(`/v1/inventory/balances?organizationId=${encodeURIComponent(organizationId)}&itemId=${encodeURIComponent(itemId)}`)
const rows = Array.isArray(balances.payload.data) ? balances.payload.data : []
const byWarehouse = new Map(rows.map((row) => [row.warehouse_id, Number(row.quantity_on_hand)]))

const sourceBalance = byWarehouse.get(sourceWarehouseId) ?? 0
const destinationTotal = (byWarehouse.get(destinationAId) ?? 0) + (byWarehouse.get(destinationBId) ?? 0)

if (sourceBalance !== 0) {
  throw new Error(`Source stock must finish at 0; got ${sourceBalance}`)
}
if (destinationTotal !== 1) {
  throw new Error(`Exactly one destination must receive the unit; destination total is ${destinationTotal}`)
}
if ([...byWarehouse.values()].some((quantity) => quantity < 0)) {
  throw new Error('Negative stock was observed after concurrent transfers')
}

console.log(JSON.stringify({
  ok: true,
  invariant: 'single-unit concurrent transfer allows exactly one writer',
  statuses,
  sourceBalance,
  destinationTotal,
}))
