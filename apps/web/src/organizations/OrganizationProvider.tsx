import type { CreateOrganizationInput } from '@inventory/contracts'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { apiFetch } from '../lib/api'
import { chooseActiveOrganization, type Organization } from './organization'

type OrganizationResponse = {
  data: Organization[]
  requestId: string
}

type CreateOrganizationResponse = {
  organizationId: string
  requestId: string
}

type OrganizationContextValue = {
  organizations: Organization[]
  activeOrganization: Organization | null
  loading: boolean
  error: string | null
  selectOrganization: (organizationId: string) => void
  createOrganization: (input: CreateOrganizationInput) => Promise<void>
  refreshOrganizations: () => Promise<void>
}

const storageKey = 'inventory.activeOrganizationId'
const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined)

function readStoredOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writeStoredOrganizationId(organizationId: string | null) {
  try {
    if (organizationId) {
      window.localStorage.setItem(storageKey, organizationId)
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // Storage availability is a UX optimization, never a security dependency.
  }
}

export function OrganizationProvider({ children }: PropsWithChildren) {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadOrganizations = useCallback(async (preferredId?: string | null) => {
    const response = await apiFetch<OrganizationResponse>('/v1/organizations')
    const chosen = chooseActiveOrganization(
      response.data,
      preferredId === undefined ? readStoredOrganizationId() : preferredId,
    )

    setOrganizations(response.data)
    setActiveOrganization(chosen)
    writeStoredOrganizationId(chosen?.id ?? null)
    setError(null)
  }, [])

  useEffect(() => {
    let active = true

    void loadOrganizations()
      .catch((caught) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'Could not load organizations')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadOrganizations])

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      activeOrganization,
      loading,
      error,
      selectOrganization: (organizationId) => {
        const next = organizations.find((organization) => organization.id === organizationId)
        if (!next) return
        setActiveOrganization(next)
        writeStoredOrganizationId(next.id)
      },
      createOrganization: async (input) => {
        const response = await apiFetch<CreateOrganizationResponse>('/v1/organizations', {
          method: 'POST',
          body: JSON.stringify(input),
        })
        await loadOrganizations(response.organizationId)
      },
      refreshOrganizations: async () => {
        await loadOrganizations(activeOrganization?.id)
      },
    }),
    [activeOrganization, error, loadOrganizations, loading, organizations],
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext)
  if (!context) throw new Error('useOrganization must be used within OrganizationProvider')
  return context
}
