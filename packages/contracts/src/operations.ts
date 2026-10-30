import { z } from 'zod'

export const operationalDashboardQuerySchema = z.object({
  organizationId: z.uuid(),
  days: z.coerce.number().int().min(1).max(365).default(30),
})
export type OperationalDashboardQuery = z.infer<typeof operationalDashboardQuerySchema>

const optionalFilter = (max: number) => z
  .string()
  .trim()
  .min(1)
  .max(max)
  .optional()

export const auditEventQuerySchema = z.object({
  organizationId: z.uuid(),
  action: optionalFilter(120),
  entityType: optionalFilter(120),
  actorUserId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>
