import { describe, expect, it } from 'vitest'
import { auditEventQuerySchema, operationalDashboardQuerySchema } from './operations'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('operations contracts', () => {
  it('defaults dashboard to a 30 day window', () => {
    expect(operationalDashboardQuerySchema.parse({ organizationId })).toMatchObject({ days: 30 })
  })

  it('bounds dashboard windows to one year', () => {
    expect(operationalDashboardQuerySchema.safeParse({ organizationId, days: '0' }).success).toBe(false)
    expect(operationalDashboardQuerySchema.safeParse({ organizationId, days: '366' }).success).toBe(false)
    expect(operationalDashboardQuerySchema.safeParse({ organizationId, days: '365' }).success).toBe(true)
  })

  it('normalizes audit pagination and accepts exact filters', () => {
    expect(auditEventQuerySchema.parse({
      organizationId,
      action: ' purchase_receipt.posted ',
      entityType: ' purchase_receipt ',
      actorUserId,
    })).toMatchObject({
      action: 'purchase_receipt.posted',
      entityType: 'purchase_receipt',
      actorUserId,
      limit: 50,
      offset: 0,
    })
  })

  it('rejects malformed audit identifiers and excessive pagination', () => {
    expect(auditEventQuerySchema.safeParse({ organizationId: 'bad' }).success).toBe(false)
    expect(auditEventQuerySchema.safeParse({ organizationId, actorUserId: 'bad' }).success).toBe(false)
    expect(auditEventQuerySchema.safeParse({ organizationId, limit: '101' }).success).toBe(false)
  })
})
