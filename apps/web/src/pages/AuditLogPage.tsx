import { auditEventQuerySchema } from '@inventory/contracts/operations'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import '../operations.css'

type AuditEvent = {
  id: string
  organization_id: string
  actor_user_id: string
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

type ListResponse = { data: AuditEvent[]; requestId: string }

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') return 'Your organization membership does not allow this audit history.'
    return `Audit request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Audit request failed'
}

export function AuditLogPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ action: '', entityType: '', actorUserId: '' })
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const limit = 50

  const load = useCallback(async () => {
    if (!activeOrganization) { setEvents([]); return }
    const parsed = auditEventQuerySchema.safeParse({
      organizationId: activeOrganization.id,
      action: appliedFilters.action || undefined,
      entityType: appliedFilters.entityType || undefined,
      actorUserId: appliedFilters.actorUserId || undefined,
      limit,
      offset,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the audit filters.')
      return
    }

    const params = new URLSearchParams({
      organizationId: parsed.data.organizationId,
      limit: String(parsed.data.limit),
      offset: String(parsed.data.offset),
    })
    if (parsed.data.action) params.set('action', parsed.data.action)
    if (parsed.data.entityType) params.set('entityType', parsed.data.entityType)
    if (parsed.data.actorUserId) params.set('actorUserId', parsed.data.actorUserId)

    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch<ListResponse>(`/v1/operations/audit-events?${params.toString()}`)
      setEvents(response.data)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [activeOrganization, appliedFilters, offset])

  useEffect(() => { void load() }, [load])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOffset(0)
    setAppliedFilters({ action: action.trim(), entityType: entityType.trim(), actorUserId: actorUserId.trim() })
  }

  function clearFilters() {
    setAction('')
    setEntityType('')
    setActorUserId('')
    setOffset(0)
    setAppliedFilters({ action: '', entityType: '', actorUserId: '' })
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Audit Log</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading operations-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>Audit Log</h1>
          <p className="muted">Tenant-scoped immutable business-event history. Use this for operational traceability; it is not a substitute for infrastructure/security logs.</p>
        </div>
      </div>

      <section className="panel operations-section">
        <form className="audit-filters" onSubmit={applyFilters}>
          <label>Action<input placeholder="e.g. purchase_receipt.posted" value={action} onChange={(event) => setAction(event.target.value)} /></label>
          <label>Entity type<input placeholder="e.g. purchase_receipt" value={entityType} onChange={(event) => setEntityType(event.target.value)} /></label>
          <label>Actor user ID<input placeholder="UUID" value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} /></label>
          <div className="audit-filter-actions"><button className="primary-button" type="submit">Apply</button><button className="secondary-button" type="button" onClick={clearFilters}>Clear</button></div>
        </form>
      </section>

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      <section className="panel operations-section">
        <div className="panel-heading"><h2>Events</h2><span className="record-count">{loading ? 'Loading…' : `${events.length} shown`}</span></div>
        {!loading && events.length === 0 ? <p className="empty-state">No audit events match these filters.</p> : null}
        <div className="audit-event-list">
          {events.map((event) => (
            <article key={event.id}>
              <div className="audit-event-header">
                <span><strong>{event.action}</strong><small>{event.entity_type}{event.entity_id ? ` · ${event.entity_id.slice(0, 8)}` : ''}</small></span>
                <span><strong>{new Date(event.created_at).toLocaleString()}</strong><small>actor {event.actor_user_id.slice(0, 8)}</small></span>
              </div>
              {Object.keys(event.metadata ?? {}).length > 0 ? <details><summary>Metadata</summary><pre>{JSON.stringify(event.metadata, null, 2)}</pre></details> : null}
            </article>
          ))}
        </div>
        <div className="audit-pagination">
          <button className="secondary-button" type="button" disabled={offset === 0 || loading} onClick={() => setOffset((current) => Math.max(0, current - limit))}>Previous</button>
          <span className="muted">Rows {offset + 1}–{offset + events.length}</span>
          <button className="secondary-button" type="button" disabled={events.length < limit || loading} onClick={() => setOffset((current) => current + limit)}>Next</button>
        </div>
      </section>
    </section>
  )
}
