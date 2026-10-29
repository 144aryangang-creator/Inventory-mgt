import { createPartySchema, type PartyRole } from '@inventory/contracts'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import { PartyProfilePanel } from '../parties/PartyProfilePanel'
import { buildPartySearchPath, type Party } from '../parties/party'

type PartyResponse = {
  data: Party[]
  requestId: string
}

type PartyPageProps = {
  role: PartyRole
  title: string
  singular: string
}

function friendlyPartyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'party_code_conflict') return 'That party code already exists in this organization.'
    if (error.code === 'forbidden') return 'Your role does not allow this action.'
    if (error.code === 'party_not_found') return 'This party is no longer active.'
    return `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

export function PartyPage({ role, title, singular }: PartyPageProps) {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [parties, setParties] = useState<Party[]>([])
  const [selectedParty, setSelectedParty] = useState<Party | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [code, setCode] = useState('')
  const [legalName, setLegalName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  const loadParties = useCallback(async () => {
    if (!activeOrganization) {
      setParties([])
      return
    }

    setLoading(true)
    try {
      const response = await apiFetch<PartyResponse>(
        buildPartySearchPath(activeOrganization.id, role, query),
      )
      setParties(response.data)
      setSelectedParty((current) => {
        if (!current) return null
        return response.data.find((party) => party.id === current.id) ?? null
      })
      setError(null)
    } catch (caught) {
      setError(friendlyPartyError(caught))
    } finally {
      setLoading(false)
    }
  }, [activeOrganization, query, role])

  useEffect(() => {
    setSelectedParty(null)
    setQuery('')
    setQueryDraft('')
  }, [activeOrganization?.id, role])

  useEffect(() => {
    void loadParties()
  }, [loadParties])

  function resetForm() {
    setCode('')
    setLegalName('')
    setDisplayName('')
    setEmail('')
    setPhone('')
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return

    const parsed = createPartySchema.safeParse({
      organizationId: activeOrganization.id,
      code,
      legalName,
      displayName,
      roles: [role],
      email,
      phone,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? `Check the ${singular.toLowerCase()} details.`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      await apiFetch('/v1/parties', { method: 'POST', body: JSON.stringify(parsed.data) })
      resetForm()
      setShowCreate(false)
      await loadParties()
    } catch (caught) {
      setError(friendlyPartyError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function archiveParty(party: Party) {
    if (!activeOrganization) return
    const confirmed = window.confirm(`Archive ${party.display_name}? Existing documents will keep their historical data.`)
    if (!confirmed) return

    try {
      await apiFetch(`/v1/parties/${party.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ organizationId: activeOrganization.id }),
      })
      if (selectedParty?.id === party.id) setSelectedParty(null)
      await loadParties()
    } catch (caught) {
      setError(friendlyPartyError(caught))
    }
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>

  if (!activeOrganization) {
    return (
      <section className="panel">
        <h1>{title}</h1>
        <p className="muted">Create an organization from the Dashboard before adding business parties.</p>
      </section>
    )
  }

  return (
    <section>
      <div className="page-heading party-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>{title}</h1>
          <p className="muted">Tenant-scoped party master. Records are archived rather than destructively deleted.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Close' : `New ${singular}`}
        </button>
      </div>

      {showCreate ? (
        <section className="panel party-create-panel">
          <div className="panel-heading"><h2>New {singular}</h2></div>
          <form className="party-form" onSubmit={onCreate}>
            <label>
              Code
              <input required maxLength={40} value={code} onChange={(event) => setCode(event.target.value)} placeholder={role === 'customer' ? 'CUST-001' : 'SUP-001'} />
            </label>
            <label>
              Legal name
              <input required maxLength={200} value={legalName} onChange={(event) => {
                const next = event.target.value
                setLegalName(next)
                if (!displayName) setDisplayName(next)
              }} />
            </label>
            <label>
              Display name
              <input required maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              Email
              <input type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Phone
              <input type="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <div className="party-form-actions">
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : `Create ${singular}`}</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="party-toolbar">
          <form onSubmit={(event) => { event.preventDefault(); setQuery(queryDraft.trim()) }} className="party-search">
            <label className="sr-only" htmlFor={`${role}-search`}>Search {title}</label>
            <input id={`${role}-search`} value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`} maxLength={100} />
            <button className="secondary-button" type="submit">Search</button>
            {query ? <button className="text-button" type="button" onClick={() => { setQueryDraft(''); setQuery('') }}>Clear</button> : null}
          </form>
          <span className="record-count">{loading ? 'Loading…' : `${parties.length} shown`}</span>
        </div>

        {error ? <p className="error-message party-error" role="alert">{error}</p> : null}

        {!loading && parties.length === 0 ? <p className="empty-state">No {title.toLowerCase()} found.</p> : null}

        <div className="party-list">
          {parties.map((party) => (
            <article className="party-row" key={party.id}>
              <div className="party-main">
                <strong>{party.display_name}</strong>
                <span>{party.code} · {party.legal_name}</span>
              </div>
              <div className="party-contact">
                <span>{party.email ?? 'No email'}</span>
                <span>{party.phone ?? 'No phone'}</span>
              </div>
              <div className="party-roles">
                {party.roles.map((partyRole) => <span className="status-pill neutral" key={partyRole}>{partyRole}</span>)}
              </div>
              <div className="party-actions">
                <button className="text-button" type="button" onClick={() => setSelectedParty((current) => current?.id === party.id ? null : party)}>
                  {selectedParty?.id === party.id ? 'Close' : 'Manage'}
                </button>
                <button className="text-button danger-text" type="button" onClick={() => void archiveParty(party)}>Archive</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selectedParty ? (
        <PartyProfilePanel
          organizationId={activeOrganization.id}
          party={selectedParty}
          onClose={() => setSelectedParty(null)}
        />
      ) : null}
    </section>
  )
}
