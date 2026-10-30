import { describe, expect, it } from 'vitest'
import { operationsRoutes } from './operations'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('operations API boundary', () => {
  it('rejects malformed dashboard organization identifiers', async () => {
    const response = await operationsRoutes.request('/dashboard?organizationId=bad')
    expect(response.status).toBe(400)
  })

  it('rejects dashboard windows outside the supported range', async () => {
    const response = await operationsRoutes.request(`/dashboard?organizationId=${organizationId}&days=366`)
    expect(response.status).toBe(400)
  })

  it('rejects malformed audit filters before database access', async () => {
    const response = await operationsRoutes.request(`/audit-events?organizationId=${organizationId}&actorUserId=bad`)
    expect(response.status).toBe(400)
  })

  it('rejects excessive audit pagination', async () => {
    const response = await operationsRoutes.request(`/audit-events?organizationId=${organizationId}&limit=101`)
    expect(response.status).toBe(400)
  })
})
