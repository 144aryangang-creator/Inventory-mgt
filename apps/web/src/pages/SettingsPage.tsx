import {
  createOrganizationBillingProfileSchema,
  updateOrganizationBillingProfileSchema,
} from '@inventory/contracts/organization-billing'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import '../seller-settings.css'

type BillingProfile = {
  id: string
  code: string
  legal_name: string
  trade_name: string | null
  gstin: string | null
  gstin_verification_status: 'unverified' | 'verified' | 'invalid'
  address_line_1: string
  address_line_2: string | null
  city: string
  district: string | null
  state_name: string
  state_code: string
  postal_code: string
  country_code: string
  is_default: boolean
  status: 'active' | 'archived'
}

type BillingProfileResponse = { data: BillingProfile[]; requestId: string }

type FormState = {
  code: string
  legalName: string
  tradeName: string
  gstin: string
  addressLine1: string
  addressLine2: string
  city: string
  district: string
  stateName: string
  stateCode: string
  postalCode: string
  countryCode: string
  isDefault: boolean
}

const emptyForm: FormState = {
  code: '', legalName: '', tradeName: '', gstin: '', addressLine1: '', addressLine2: '',
  city: '', district: '', stateName: '', stateCode: '', postalCode: '', countryCode: 'IN', isDefault: false,
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') return 'Only organization owners or admins can change seller legal profiles.'
    if (error.code === 'billing_profile_conflict') return 'That profile code or GSTIN is already used in this organization.'
    if (error.code === 'invalid_billing_profile') return 'Check the GSTIN, state code and registered address.'
    if (error.code === 'billing_profile_not_found') return 'That seller profile is no longer active.'
    return `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function formFromProfile(profile: BillingProfile): FormState {
  return {
    code: profile.code,
    legalName: profile.legal_name,
    tradeName: profile.trade_name ?? '',
    gstin: profile.gstin ?? '',
    addressLine1: profile.address_line_1,
    addressLine2: profile.address_line_2 ?? '',
    city: profile.city,
    district: profile.district ?? '',
    stateName: profile.state_name,
    stateCode: profile.state_code,
    postalCode: profile.postal_code,
    countryCode: profile.country_code,
    isDefault: profile.is_default,
  }
}

export function SettingsPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [profiles, setProfiles] = useState<BillingProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const loadProfiles = useCallback(async () => {
    if (!activeOrganization) { setProfiles([]); return }
    setLoading(true)
    try {
      const response = await apiFetch<BillingProfileResponse>(
        `/v1/organization-billing-profiles?organizationId=${encodeURIComponent(activeOrganization.id)}`,
      )
      setProfiles(response.data)
      setError(null)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [activeOrganization])

  useEffect(() => { void loadProfiles() }, [loadProfiles])

  function beginCreate() {
    setEditingId(null)
    setForm({ ...emptyForm, isDefault: profiles.length === 0 })
    setShowForm(true)
    setError(null)
  }

  function beginEdit(profile: BillingProfile) {
    setEditingId(profile.id)
    setForm(formFromProfile(profile))
    setShowForm(true)
    setError(null)
  }

  function cancelForm() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return

    const raw = { organizationId: activeOrganization.id, ...form, ...(editingId ? { profileId: editingId } : {}) }
    const parsed = editingId
      ? updateOrganizationBillingProfileSchema.safeParse(raw)
      : createOrganizationBillingProfileSchema.safeParse(raw)

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the seller profile details.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        await apiFetch(`/v1/organization-billing-profiles/${editingId}`, {
          method: 'PATCH', body: JSON.stringify(parsed.data),
        })
      } else {
        await apiFetch('/v1/organization-billing-profiles', {
          method: 'POST', body: JSON.stringify(parsed.data),
        })
      }
      cancelForm()
      await loadProfiles()
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function archiveProfile(profile: BillingProfile) {
    if (!activeOrganization) return
    if (!window.confirm(`Archive seller profile ${profile.code}? Issued invoices will keep their historical seller snapshot.`)) return
    try {
      await apiFetch(`/v1/organization-billing-profiles/${profile.id}/archive`, {
        method: 'POST', body: JSON.stringify({ organizationId: activeOrganization.id }),
      })
      if (editingId === profile.id) cancelForm()
      await loadProfiles()
    } catch (caught) {
      setError(friendlyError(caught))
    }
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Settings</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading seller-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>Seller & billing settings</h1>
          <p className="muted">Legal seller identities used for invoices. Only owners/admins may change them.</p>
        </div>
        <button className="primary-button" type="button" onClick={showForm ? cancelForm : beginCreate}>
          {showForm ? 'Close form' : 'New seller profile'}
        </button>
      </div>

      {error ? <p className="error-message seller-error" role="alert">{error}</p> : null}

      {showForm ? (
        <section className="panel seller-form-panel">
          <div className="panel-heading"><h2>{editingId ? 'Edit seller profile' : 'New seller profile'}</h2></div>
          <form className="seller-form" onSubmit={saveProfile}>
            <label>Profile code<input required maxLength={40} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BHOPAL-MAIN" /></label>
            <label>Legal name<input required maxLength={200} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></label>
            <label>Trade name<input maxLength={200} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} /></label>
            <label>GSTIN<input maxLength={15} value={form.gstin} onChange={(e) => {
              const gstin = e.target.value.toUpperCase()
              setForm({ ...form, gstin, ...(gstin.length >= 2 ? { stateCode: gstin.slice(0, 2) } : {}) })
            }} placeholder="23ABCDE1234F1Z5" /></label>
            <label className="seller-full-field">Registered address<input required maxLength={240} value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} /></label>
            <label className="seller-full-field">Address line 2<input maxLength={240} value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></label>
            <label>City<input required maxLength={120} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
            <label>District<input maxLength={120} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></label>
            <label>State name<input required maxLength={120} value={form.stateName} onChange={(e) => setForm({ ...form, stateName: e.target.value })} /></label>
            <label>State code<input required maxLength={20} value={form.stateCode} onChange={(e) => setForm({ ...form, stateCode: e.target.value })} /></label>
            <label>Postal code<input required maxLength={20} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} /></label>
            <label>Country code<input required maxLength={2} value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value.toUpperCase() })} /></label>
            <label className="seller-default-check"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />Use as default seller profile</label>
            <p className="seller-form-note">GSTIN is structurally checked only. Editing GSTIN resets verification to unverified.</p>
            <div className="seller-form-actions">
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
              <button className="secondary-button" type="button" onClick={cancelForm}>Cancel</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading"><h2>Active seller profiles</h2><span className="record-count">{loading ? 'Loading…' : `${profiles.length} active`}</span></div>
        {!loading && profiles.length === 0 ? <p className="empty-state">No seller profile configured. Add one before creating compliant invoices.</p> : null}
        <div className="seller-profile-list">
          {profiles.map((profile) => (
            <article className="seller-profile-card" key={profile.id}>
              <div>
                <div className="seller-profile-title">
                  <strong>{profile.legal_name}</strong>
                  {profile.is_default ? <span className="status-pill neutral">default</span> : null}
                  <span className={`status-pill verification-${profile.gstin_verification_status}`}>{profile.gstin_verification_status}</span>
                </div>
                <p>{profile.code}{profile.trade_name ? ` · ${profile.trade_name}` : ''}</p>
                <p>{profile.gstin ?? 'Unregistered / no GSTIN'}</p>
                <p>{profile.address_line_1}{profile.address_line_2 ? `, ${profile.address_line_2}` : ''}, {profile.city}, {profile.state_name} {profile.postal_code}</p>
              </div>
              <div className="seller-profile-actions">
                <button className="text-button" type="button" onClick={() => beginEdit(profile)}>Edit</button>
                <button className="text-button danger-text" type="button" onClick={() => void archiveProfile(profile)}>Archive</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
