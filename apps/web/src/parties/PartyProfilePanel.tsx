import {
  createPartyAddressSchema,
  createPartyTaxRegistrationSchema,
  updatePartyAddressSchema,
  updatePartyTaxRegistrationSchema,
} from '@inventory/contracts'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import type { Party } from './party'
import {
  buildPartyProfilePath,
  type PartyAddress,
  type PartyProfile,
  type PartyTaxRegistration,
} from './profile'
import '../party-profile.css'

type ProfileResponse = {
  data: PartyProfile
  requestId: string
}

type PartyProfilePanelProps = {
  organizationId: string
  party: Party
  onClose: () => void
}

function friendlyProfileError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') return 'Your role does not allow this action.'
    if (error.code === 'party_not_found') return 'This party is no longer active.'
    if (error.code === 'party_address_not_found') return 'This address is no longer active.'
    if (error.code === 'tax_registration_not_found') return 'This tax registration is no longer active.'
    if (error.code === 'tax_registration_conflict') return 'That tax registration already exists in this organization.'
    if (error.code === 'invalid_tax_registration') return 'Check the tax registration details.'
    if (error.code === 'invalid_party_address') return 'Check the address details.'
    return `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

export function PartyProfilePanel({ organizationId, party, onClose }: PartyProfilePanelProps) {
  const [profile, setProfile] = useState<PartyProfile>({ addresses: [], taxRegistrations: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingAddress, setEditingAddress] = useState<PartyAddress | null>(null)
  const [addressLabel, setAddressLabel] = useState('Billing')
  const [recipientName, setRecipientName] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [stateName, setStateName] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('IN')
  const [defaultBilling, setDefaultBilling] = useState(true)
  const [defaultShipping, setDefaultShipping] = useState(false)
  const [registeredAddress, setRegisteredAddress] = useState(false)
  const [savingAddress, setSavingAddress] = useState(false)

  const [editingTax, setEditingTax] = useState<PartyTaxRegistration | null>(null)
  const [scheme, setScheme] = useState('GSTIN')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [registeredName, setRegisteredName] = useState('')
  const [taxCountryCode, setTaxCountryCode] = useState('IN')
  const [taxStateCode, setTaxStateCode] = useState('')
  const [defaultTax, setDefaultTax] = useState(true)
  const [savingTax, setSavingTax] = useState(false)

  const loadProfile = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch<ProfileResponse>(buildPartyProfilePath(organizationId, party.id))
      setProfile(response.data)
      setError(null)
    } catch (caught) {
      setError(friendlyProfileError(caught))
    } finally {
      setLoading(false)
    }
  }, [organizationId, party.id])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  function resetAddressForm() {
    setEditingAddress(null)
    setAddressLabel('Billing')
    setRecipientName('')
    setAddressLine1('')
    setAddressLine2('')
    setCity('')
    setDistrict('')
    setStateName('')
    setStateCode('')
    setPostalCode('')
    setCountryCode('IN')
    setDefaultBilling(true)
    setDefaultShipping(false)
    setRegisteredAddress(false)
  }

  function startAddressEdit(address: PartyAddress) {
    setEditingAddress(address)
    setAddressLabel(address.label)
    setRecipientName(address.recipient_name ?? '')
    setAddressLine1(address.address_line_1)
    setAddressLine2(address.address_line_2 ?? '')
    setCity(address.city)
    setDistrict(address.district ?? '')
    setStateName(address.state_name ?? '')
    setStateCode(address.state_code ?? '')
    setPostalCode(address.postal_code ?? '')
    setCountryCode(address.country_code)
    setDefaultBilling(address.is_default_billing)
    setDefaultShipping(address.is_default_shipping)
    setRegisteredAddress(address.is_registered_address)
  }

  async function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const draft = {
      organizationId,
      partyId: party.id,
      label: addressLabel,
      recipientName,
      addressLine1,
      addressLine2,
      city,
      district,
      stateName,
      stateCode,
      postalCode,
      countryCode,
      isDefaultBilling: defaultBilling,
      isDefaultShipping: defaultShipping,
      isRegisteredAddress: registeredAddress,
    }

    const parsed = editingAddress
      ? updatePartyAddressSchema.safeParse({ ...draft, addressId: editingAddress.id })
      : createPartyAddressSchema.safeParse(draft)

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the address details.')
      return
    }

    setSavingAddress(true)
    setError(null)
    try {
      if (editingAddress) {
        await apiFetch(`/v1/parties/${party.id}/addresses/${editingAddress.id}`, {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
        })
      } else {
        await apiFetch(`/v1/parties/${party.id}/addresses`, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        })
      }
      resetAddressForm()
      await loadProfile()
    } catch (caught) {
      setError(friendlyProfileError(caught))
    } finally {
      setSavingAddress(false)
    }
  }

  async function archiveAddress(address: PartyAddress) {
    if (!window.confirm(`Archive address “${address.label}”?`)) return
    try {
      await apiFetch(`/v1/parties/${party.id}/addresses/${address.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      })
      if (editingAddress?.id === address.id) resetAddressForm()
      await loadProfile()
    } catch (caught) {
      setError(friendlyProfileError(caught))
    }
  }

  function resetTaxForm() {
    setEditingTax(null)
    setScheme('GSTIN')
    setRegistrationNumber('')
    setRegisteredName('')
    setTaxCountryCode('IN')
    setTaxStateCode('')
    setDefaultTax(true)
  }

  function startTaxEdit(registration: PartyTaxRegistration) {
    setEditingTax(registration)
    setScheme(registration.scheme)
    setRegistrationNumber(registration.registration_number)
    setRegisteredName(registration.registered_name ?? '')
    setTaxCountryCode(registration.country_code)
    setTaxStateCode(registration.state_code ?? '')
    setDefaultTax(registration.is_default)
  }

  async function submitTaxRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const draft = {
      organizationId,
      partyId: party.id,
      scheme,
      registrationNumber,
      registeredName,
      countryCode: taxCountryCode,
      stateCode: taxStateCode,
      isDefault: defaultTax,
    }

    const parsed = editingTax
      ? updatePartyTaxRegistrationSchema.safeParse({ ...draft, registrationId: editingTax.id })
      : createPartyTaxRegistrationSchema.safeParse(draft)

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the tax registration details.')
      return
    }

    setSavingTax(true)
    setError(null)
    try {
      if (editingTax) {
        await apiFetch(`/v1/parties/${party.id}/tax-registrations/${editingTax.id}`, {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
        })
      } else {
        await apiFetch(`/v1/parties/${party.id}/tax-registrations`, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        })
      }
      resetTaxForm()
      await loadProfile()
    } catch (caught) {
      setError(friendlyProfileError(caught))
    } finally {
      setSavingTax(false)
    }
  }

  async function archiveTaxRegistration(registration: PartyTaxRegistration) {
    if (!window.confirm(`Archive ${registration.scheme} ${registration.registration_number}?`)) return
    try {
      await apiFetch(`/v1/parties/${party.id}/tax-registrations/${registration.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      })
      if (editingTax?.id === registration.id) resetTaxForm()
      await loadProfile()
    } catch (caught) {
      setError(friendlyProfileError(caught))
    }
  }

  return (
    <section className="party-profile-panel" aria-labelledby={`profile-${party.id}`}>
      <div className="profile-header">
        <div>
          <p className="eyebrow">Party profile</p>
          <h2 id={`profile-${party.id}`}>{party.display_name}</h2>
          <p className="muted">Addresses and tax registrations are preserved historically by archiving.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>Close profile</button>
      </div>

      {error ? <p className="error-message profile-error" role="alert">{error}</p> : null}
      {loading ? <p className="muted">Loading profile…</p> : null}

      <div className="profile-columns">
        <section className="profile-section">
          <div className="profile-section-heading">
            <div><h3>Addresses</h3><span>{profile.addresses.length} active</span></div>
          </div>

          <div className="profile-record-list">
            {profile.addresses.map((address) => (
              <article className="profile-record" key={address.id}>
                <div className="profile-record-heading">
                  <strong>{address.label}</strong>
                  <div className="profile-badges">
                    {address.is_default_billing ? <span>Billing</span> : null}
                    {address.is_default_shipping ? <span>Shipping</span> : null}
                    {address.is_registered_address ? <span>Registered</span> : null}
                  </div>
                </div>
                <p>{address.address_line_1}{address.address_line_2 ? `, ${address.address_line_2}` : ''}</p>
                <p className="muted">{[address.city, address.district, address.state_name, address.postal_code].filter(Boolean).join(', ')}</p>
                <div className="profile-record-actions">
                  <button className="text-button" type="button" onClick={() => startAddressEdit(address)}>Edit</button>
                  <button className="text-button danger-text" type="button" onClick={() => void archiveAddress(address)}>Archive</button>
                </div>
              </article>
            ))}
            {!loading && profile.addresses.length === 0 ? <p className="profile-empty">No address added yet.</p> : null}
          </div>

          <form className="profile-form" onSubmit={submitAddress}>
            <h4>{editingAddress ? 'Edit address' : 'Add address'}</h4>
            <label>Label<input required maxLength={80} value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} /></label>
            <label>Recipient name<input maxLength={200} value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label>
            <label className="full-field">Address line 1<input required maxLength={240} value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} /></label>
            <label className="full-field">Address line 2<input maxLength={240} value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} /></label>
            <label>City<input required maxLength={120} value={city} onChange={(event) => setCity(event.target.value)} /></label>
            <label>District<input maxLength={120} value={district} onChange={(event) => setDistrict(event.target.value)} /></label>
            <label>State name<input maxLength={120} value={stateName} onChange={(event) => setStateName(event.target.value)} /></label>
            <label>State code<input maxLength={20} value={stateCode} onChange={(event) => setStateCode(event.target.value)} /></label>
            <label>Postal code<input maxLength={20} value={postalCode} onChange={(event) => setPostalCode(event.target.value)} /></label>
            <label>Country code<input required maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} /></label>
            <div className="profile-checks full-field">
              <label><input type="checkbox" checked={defaultBilling} onChange={(event) => setDefaultBilling(event.target.checked)} /> Default billing</label>
              <label><input type="checkbox" checked={defaultShipping} onChange={(event) => setDefaultShipping(event.target.checked)} /> Default shipping</label>
              <label><input type="checkbox" checked={registeredAddress} onChange={(event) => setRegisteredAddress(event.target.checked)} /> Registered address</label>
            </div>
            <div className="profile-form-actions full-field">
              <button className="primary-button" disabled={savingAddress} type="submit">{savingAddress ? 'Saving…' : editingAddress ? 'Save address' : 'Add address'}</button>
              {editingAddress ? <button className="secondary-button" type="button" onClick={resetAddressForm}>Cancel edit</button> : null}
            </div>
          </form>
        </section>

        <section className="profile-section">
          <div className="profile-section-heading">
            <div><h3>Tax registrations</h3><span>{profile.taxRegistrations.length} active</span></div>
          </div>

          <div className="profile-record-list">
            {profile.taxRegistrations.map((registration) => (
              <article className="profile-record" key={registration.id}>
                <div className="profile-record-heading">
                  <strong>{registration.scheme}</strong>
                  <div className="profile-badges">
                    {registration.is_default ? <span>Default</span> : null}
                    <span className={`verification-${registration.verification_status}`}>{registration.verification_status}</span>
                  </div>
                </div>
                <p className="tax-number">{registration.registration_number}</p>
                <p className="muted">{registration.registered_name ?? 'No registered name'} · {registration.country_code}{registration.state_code ? ` / ${registration.state_code}` : ''}</p>
                <div className="profile-record-actions">
                  <button className="text-button" type="button" onClick={() => startTaxEdit(registration)}>Edit</button>
                  <button className="text-button danger-text" type="button" onClick={() => void archiveTaxRegistration(registration)}>Archive</button>
                </div>
              </article>
            ))}
            {!loading && profile.taxRegistrations.length === 0 ? <p className="profile-empty">No tax registration added yet.</p> : null}
          </div>

          <form className="profile-form" onSubmit={submitTaxRegistration}>
            <h4>{editingTax ? 'Edit tax registration' : 'Add tax registration'}</h4>
            <label>Scheme<input required maxLength={30} value={scheme} onChange={(event) => setScheme(event.target.value.toUpperCase())} placeholder="GSTIN" /></label>
            <label>Registration number<input required maxLength={80} value={registrationNumber} onChange={(event) => {
              const next = event.target.value.toUpperCase()
              setRegistrationNumber(next)
              if (scheme.toUpperCase() === 'GSTIN' && /^\d{2}/.test(next)) setTaxStateCode(next.slice(0, 2))
            }} /></label>
            <label className="full-field">Registered name<input maxLength={200} value={registeredName} onChange={(event) => setRegisteredName(event.target.value)} /></label>
            <label>Country code<input required maxLength={2} value={taxCountryCode} onChange={(event) => setTaxCountryCode(event.target.value.toUpperCase())} /></label>
            <label>State code<input maxLength={20} value={taxStateCode} onChange={(event) => setTaxStateCode(event.target.value)} /></label>
            <div className="profile-checks full-field">
              <label><input type="checkbox" checked={defaultTax} onChange={(event) => setDefaultTax(event.target.checked)} /> Default for this scheme</label>
            </div>
            <p className="profile-note full-field">GSTIN is structurally validated only. It remains unverified until a trusted verification integration confirms it.</p>
            <div className="profile-form-actions full-field">
              <button className="primary-button" disabled={savingTax} type="submit">{savingTax ? 'Saving…' : editingTax ? 'Save registration' : 'Add registration'}</button>
              {editingTax ? <button className="secondary-button" type="button" onClick={resetTaxForm}>Cancel edit</button> : null}
            </div>
          </form>
        </section>
      </div>
    </section>
  )
}
