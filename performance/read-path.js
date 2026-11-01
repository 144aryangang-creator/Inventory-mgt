import http from 'k6/http'
import { check, sleep } from 'k6'

const apiBaseUrl = __ENV.API_BASE_URL
const accessToken = __ENV.ACCESS_TOKEN
const organizationId = __ENV.ORGANIZATION_ID

if (!apiBaseUrl || !accessToken || !organizationId) {
  throw new Error('API_BASE_URL, ACCESS_TOKEN and ORGANIZATION_ID are required')
}

export const options = {
  scenarios: {
    tenant_reads: {
      executor: 'constant-vus',
      vus: Number(__ENV.K6_VUS || 5),
      duration: __ENV.K6_DURATION || '20s',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
}

const headers = {
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/json',
}

function assertProtectedRead(response, label) {
  check(response, {
    [`${label}: status 200`]: (res) => res.status === 200,
    [`${label}: authenticated response is non-cacheable`]: (res) => res.headers['Cache-Control'] === 'no-store',
    [`${label}: request id is present`]: (res) => Boolean(res.headers['X-Request-Id']),
  })
}

export default function () {
  const encodedOrg = encodeURIComponent(organizationId)

  const organizations = http.get(`${apiBaseUrl}/v1/organizations`, {
    headers,
    tags: { endpoint: 'organizations' },
  })
  assertProtectedRead(organizations, 'organizations')

  const dashboard = http.get(`${apiBaseUrl}/v1/operations/dashboard?organizationId=${encodedOrg}`, {
    headers,
    tags: { endpoint: 'dashboard' },
  })
  assertProtectedRead(dashboard, 'dashboard')

  const items = http.get(`${apiBaseUrl}/v1/inventory/items?organizationId=${encodedOrg}&limit=25`, {
    headers,
    tags: { endpoint: 'items' },
  })
  assertProtectedRead(items, 'items')

  sleep(0.2)
}
