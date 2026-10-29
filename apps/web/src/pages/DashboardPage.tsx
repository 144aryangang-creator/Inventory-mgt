import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

type Organization = {
  id: string
  name: string
  slug: string
  country_code: string
  base_currency: string
  timezone: string
  allow_negative_stock: boolean
}

type OrganizationResponse = {
  data: Organization[]
  requestId: string
}

export function DashboardPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void apiFetch<OrganizationResponse>('/v1/organizations')
      .then((response) => {
        if (!active) return
        setOrganizations(response.data)
        setError(null)
      })
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
  }, [])

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Dashboard</h1>
          <p className="muted">Foundation shell. Business KPIs will be added after core modules.</p>
        </div>
      </div>

      <div className="card-grid">
        <article className="metric-card">
          <span>Organizations available</span>
          <strong>{loading ? '—' : organizations.length}</strong>
        </article>
        <article className="metric-card">
          <span>Security model</span>
          <strong>RLS</strong>
        </article>
        <article className="metric-card">
          <span>Inventory source</span>
          <strong>Ledger</strong>
        </article>
      </div>

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      <section className="panel">
        <div className="panel-heading">
          <h2>Your organizations</h2>
          <span className="status-pill">RLS scoped</span>
        </div>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && organizations.length === 0 ? (
          <p className="muted">No organizations are available to this account yet.</p>
        ) : null}
        <div className="organization-list">
          {organizations.map((organization) => (
            <div className="organization-row" key={organization.id}>
              <div>
                <strong>{organization.name}</strong>
                <span>{organization.slug}</span>
              </div>
              <div className="organization-meta">
                <span>{organization.country_code}</span>
                <span>{organization.base_currency}</span>
                <span>{organization.timezone}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
