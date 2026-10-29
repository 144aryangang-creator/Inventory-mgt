import type { PartyStatus } from '@inventory/contracts'

export type PartyAddress = {
  id: string
  organization_id: string
  party_id: string
  label: string
  recipient_name: string | null
  address_line_1: string
  address_line_2: string | null
  city: string
  district: string | null
  state_name: string | null
  state_code: string | null
  postal_code: string | null
  country_code: string
  is_default_billing: boolean
  is_default_shipping: boolean
  is_registered_address: boolean
  status: PartyStatus
  created_at: string
  updated_at: string
}

export type PartyTaxRegistration = {
  id: string
  organization_id: string
  party_id: string
  scheme: string
  registration_number: string
  registered_name: string | null
  country_code: string
  state_code: string | null
  is_default: boolean
  verification_status: 'unverified' | 'verified' | 'invalid'
  status: PartyStatus
  created_at: string
  updated_at: string
}

export type PartyProfile = {
  addresses: PartyAddress[]
  taxRegistrations: PartyTaxRegistration[]
}

export function buildPartyProfilePath(organizationId: string, partyId: string): string {
  const params = new URLSearchParams({ organizationId })
  return `/v1/parties/${encodeURIComponent(partyId)}/profile?${params.toString()}`
}
