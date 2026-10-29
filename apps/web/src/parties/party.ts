import type { PartyRole, PartyStatus } from '@inventory/contracts'

export type Party = {
  id: string
  organization_id: string
  code: string
  legal_name: string
  display_name: string
  email: string | null
  phone: string | null
  status: PartyStatus
  roles: PartyRole[]
  created_at: string
  updated_at: string
}

export function buildPartySearchPath(
  organizationId: string,
  role: PartyRole,
  query: string,
  offset = 0,
): string {
  const params = new URLSearchParams({
    organizationId,
    role,
    status: 'active',
    limit: '50',
    offset: String(offset),
  })
  const normalizedQuery = query.trim()
  if (normalizedQuery) params.set('q', normalizedQuery)
  return `/v1/parties?${params.toString()}`
}
