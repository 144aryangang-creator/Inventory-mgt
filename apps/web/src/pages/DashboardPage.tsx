import { createOrganizationSchema } from '@inventory/contracts'
import { useState, type FormEvent } from 'react'
import { useOrganization } from '../organizations/OrganizationProvider'
import { suggestOrganizationSlug } from '../organizations/organization'

function OrganizationOnboarding() {
  const { createOrganization } = useOrganization()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const parsed = createOrganizationSchema.safeParse({
      name,
      slug,
      countryCode: 'IN',
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the organization details')
      return
    }

    setBusy(true)
    try {
      await createOrganization(parsed.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create organization')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="onboarding-panel">
      <p className="eyebrow">First setup</p>
      <h1>Create your organization</h1>
      <p className="muted">
        Your organization is the security and data boundary for inventory, customers and invoices.
      </p>

      <form className="onboarding-form" onSubmit={onSubmit}>
        <label>
          Business name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              const nextName = event.target.value
              setName(nextName)
              if (!slugEdited) setSlug(suggestOrganizationSlug(nextName))
            }}
          />
        </label>

        <label>
          Organization slug
          <input
            required
            minLength={3}
            maxLength={63}
            pattern="[A-Za-z0-9][A-Za-z0-9-]*"
            value={slug}
            onChange={(event) => {
              setSlugEdited(true)
              setSlug(event.target.value)
            }}
          />
          <small>Used as a stable organization identifier. Letters, numbers and hyphens only.</small>
        </label>

        <div className="setup-defaults">
          <span>Country: India</span>
          <span>Currency: INR</span>
          <span>Timezone: Asia/Kolkata</span>
        </div>

        {error ? <p className="error-message" role="alert">{error}</p> : null}

        <button className="primary-button" disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </section>
  )
}

export function DashboardPage() {
  const { organizations, activeOrganization, loading, error } = useOrganization()

  if (loading) {
    return <div className="centered-panel-state">Loading organization…</div>
  }

  if (organizations.length === 0) {
    return <OrganizationOnboarding />
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>{activeOrganization?.name ?? 'Dashboard'}</h1>
          <p className="muted">Active organization context for upcoming business modules.</p>
        </div>
      </div>

      <div className="card-grid">
        <article className="metric-card">
          <span>Accessible organizations</span>
          <strong>{organizations.length}</strong>
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
        <div className="organization-list">
          {organizations.map((organization) => (
            <div
              className={`organization-row${organization.id === activeOrganization?.id ? ' active' : ''}`}
              key={organization.id}
            >
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
