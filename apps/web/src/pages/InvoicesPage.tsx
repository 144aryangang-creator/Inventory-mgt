import {
  createFinancialDocumentDraftSchema,
  upsertFinancialDocumentLineSchema,
  type SupplyType,
} from '@inventory/contracts/financial-documents'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import { buildPartySearchPath, type Party } from '../parties/party'
import { buildPartyProfilePath, type PartyProfile } from '../parties/profile'
import '../invoices.css'

type SellerProfile = {
  id: string
  code: string
  legal_name: string
  trade_name: string | null
  gstin: string | null
  gstin_verification_status: 'unverified' | 'verified' | 'invalid'
  state_code: string
  is_default: boolean
}

type FinancialDocumentSummary = {
  id: string
  document_type: 'tax_invoice' | 'credit_note' | 'debit_note'
  status: 'draft' | 'issued' | 'cancelled'
  document_date: string
  document_number: string | null
  series_code: string
  supplier_profile_id: string | null
  recipient_party_id: string | null
  billing_address_id: string | null
  shipping_address_id: string | null
  recipient_tax_registration_id: string | null
  currency_code: string
  supply_type: SupplyType
  grand_total: string | number
  issued_at: string | null
  cancelled_at: string | null
}

type FinancialDocumentLine = {
  id: string
  line_number: number
  description: string
  hsn_sac: string | null
  quantity: string | number
  uom: string
  unit_price: string | number
  discount_amount: string | number
  taxable_value: string | number
}

type FinancialDocumentTax = {
  line_id: string
  component: 'CGST' | 'SGST' | 'UTGST' | 'IGST' | 'CESS'
  rate: string | number
  amount: string | number
}

type FinancialDocumentDetail = {
  document: FinancialDocumentSummary & {
    organization_id: string
    supplier_state_code: string | null
    place_of_supply_state_code: string | null
    reverse_charge: boolean
    supplier_snapshot: Record<string, unknown>
    bill_to_snapshot: Record<string, unknown>
    ship_to_snapshot: Record<string, unknown>
    subtotal: string | number
    discount_total: string | number
    taxable_total: string | number
    cgst_total: string | number
    sgst_total: string | number
    utgst_total: string | number
    igst_total: string | number
    cess_total: string | number
    round_off: string | number
    notes: string | null
    cancellation_reason: string | null
  }
  lines: FinancialDocumentLine[]
  taxes: FinancialDocumentTax[]
}

type ListResponse<T> = { data: T[]; requestId: string }
type DetailResponse = { data: FinancialDocumentDetail; requestId: string }

type DraftForm = {
  supplierProfileId: string
  customerId: string
  billingAddressId: string
  shippingAddressId: string
  taxRegistrationId: string
  documentDate: string
  seriesCode: string
  supplyType: SupplyType
  placeOfSupplyStateCode: string
  reverseCharge: boolean
  notes: string
}

type LineForm = {
  description: string
  hsnSac: string
  quantity: string
  uom: string
  unitPrice: string
  discountAmount: string
  cgstRate: string
  sgstRate: string
  igstRate: string
  cessRate: string
}

function localIsoDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const emptyLine: LineForm = {
  description: '', hsnSac: '', quantity: '1', uom: 'EA', unitPrice: '', discountAmount: '0',
  cgstRate: '9', sgstRate: '9', igstRate: '18', cessRate: '0',
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow this action.',
      invalid_document_reference: 'One of the selected seller/customer profile records is no longer valid.',
      invalid_financial_document: 'Check the invoice profile, date, series and supply details.',
      invalid_document_line: 'Check the line quantity, price, discount and tax rates.',
      document_not_issuable: 'This draft cannot be issued. Check lines and GST tax treatment.',
      issue_conflict: 'This invoice was already issued by another request.',
      document_not_found: 'Invoice not found.',
      issued_document_not_found: 'Only an issued invoice can be cancelled.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function displaySnapshotName(snapshot: Record<string, unknown>): string {
  const legal = snapshot.legal_name
  const display = snapshot.display_name
  if (typeof legal === 'string' && legal) return legal
  if (typeof display === 'string' && display) return display
  return '—'
}

function statusLabel(status: FinancialDocumentSummary['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function InvoicesPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [documents, setDocuments] = useState<FinancialDocumentSummary[]>([])
  const [sellerProfiles, setSellerProfiles] = useState<SellerProfile[]>([])
  const [customers, setCustomers] = useState<Party[]>([])
  const [customerProfile, setCustomerProfile] = useState<PartyProfile | null>(null)
  const [detail, setDetail] = useState<FinancialDocumentDetail | null>(null)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [showDraftForm, setShowDraftForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftForm>({
    supplierProfileId: '', customerId: '', billingAddressId: '', shippingAddressId: '', taxRegistrationId: '',
    documentDate: localIsoDate(), seriesCode: 'INV', supplyType: 'intra_state', placeOfSupplyStateCode: '',
    reverseCharge: false, notes: '',
  })
  const [line, setLine] = useState<LineForm>(emptyLine)

  const loadDocuments = useCallback(async () => {
    if (!activeOrganization) { setDocuments([]); return }
    const response = await apiFetch<ListResponse<FinancialDocumentSummary>>(
      `/v1/financial-documents?organizationId=${encodeURIComponent(activeOrganization.id)}&limit=100`,
    )
    setDocuments(response.data)
  }, [activeOrganization])

  const loadReferences = useCallback(async () => {
    if (!activeOrganization) return
    const [sellerResponse, customerResponse] = await Promise.all([
      apiFetch<ListResponse<SellerProfile>>(
        `/v1/organization-billing-profiles?organizationId=${encodeURIComponent(activeOrganization.id)}`,
      ),
      apiFetch<ListResponse<Party>>(buildPartySearchPath(activeOrganization.id, 'customer', '')),
    ])
    setSellerProfiles(sellerResponse.data)
    setCustomers(customerResponse.data)
    setDraft((current) => ({
      ...current,
      supplierProfileId: current.supplierProfileId || sellerResponse.data.find((profile) => profile.is_default)?.id || sellerResponse.data[0]?.id || '',
    }))
  }, [activeOrganization])

  const loadDetail = useCallback(async (documentId: string) => {
    if (!activeOrganization) return
    const response = await apiFetch<DetailResponse>(
      `/v1/financial-documents/${encodeURIComponent(documentId)}?organizationId=${encodeURIComponent(activeOrganization.id)}`,
    )
    setDetail(response.data)
    setSelectedDocumentId(documentId)
  }, [activeOrganization])

  useEffect(() => {
    if (!activeOrganization) return
    setLoading(true)
    setError(null)
    Promise.all([loadDocuments(), loadReferences()])
      .catch((caught) => setError(friendlyError(caught)))
      .finally(() => setLoading(false))
  }, [activeOrganization, loadDocuments, loadReferences])

  useEffect(() => {
    if (!activeOrganization || !draft.customerId) {
      setCustomerProfile(null)
      return
    }

    apiFetch<{ data: PartyProfile }>(buildPartyProfilePath(activeOrganization.id, draft.customerId))
      .then((response) => {
        setCustomerProfile(response.data)
        const billing = response.data.addresses.find((address) => address.is_default_billing) ?? response.data.addresses[0]
        const shipping = response.data.addresses.find((address) => address.is_default_shipping) ?? billing
        const tax = response.data.taxRegistrations.find((registration) => registration.is_default && registration.scheme === 'GSTIN')
          ?? response.data.taxRegistrations.find((registration) => registration.scheme === 'GSTIN')
        setDraft((current) => ({
          ...current,
          billingAddressId: billing?.id ?? '',
          shippingAddressId: shipping?.id ?? billing?.id ?? '',
          taxRegistrationId: tax?.id ?? '',
          placeOfSupplyStateCode: billing?.state_code ?? tax?.state_code ?? current.placeOfSupplyStateCode,
        }))
      })
      .catch((caught) => setError(friendlyError(caught)))
  }, [activeOrganization, draft.customerId])

  const selectedSeller = useMemo(
    () => sellerProfiles.find((profile) => profile.id === draft.supplierProfileId) ?? null,
    [draft.supplierProfileId, sellerProfiles],
  )

  useEffect(() => {
    if (!selectedSeller || !draft.placeOfSupplyStateCode) return
    const nextSupplyType: SupplyType = selectedSeller.state_code === draft.placeOfSupplyStateCode ? 'intra_state' : 'inter_state'
    setDraft((current) => current.supplyType === 'export' || current.supplyType === 'sez'
      ? current
      : { ...current, supplyType: nextSupplyType })
  }, [draft.placeOfSupplyStateCode, selectedSeller])

  const nextLineNumber = useMemo(
    () => Math.max(0, ...(detail?.lines.map((item) => item.line_number) ?? [])) + 1,
    [detail],
  )

  const taxesByLine = useMemo(() => {
    const result = new Map<string, FinancialDocumentTax[]>()
    for (const tax of detail?.taxes ?? []) {
      const existing = result.get(tax.line_id) ?? []
      existing.push(tax)
      result.set(tax.line_id, existing)
    }
    return result
  }, [detail])

  function resetDraftForm() {
    setDraft({
      supplierProfileId: sellerProfiles.find((profile) => profile.is_default)?.id ?? sellerProfiles[0]?.id ?? '',
      customerId: '', billingAddressId: '', shippingAddressId: '', taxRegistrationId: '',
      documentDate: localIsoDate(), seriesCode: 'INV', supplyType: 'intra_state', placeOfSupplyStateCode: '',
      reverseCharge: false, notes: '',
    })
    setCustomerProfile(null)
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization) return

    const parsed = createFinancialDocumentDraftSchema.safeParse({
      organizationId: activeOrganization.id,
      supplierProfileId: draft.supplierProfileId,
      recipientPartyId: draft.customerId,
      billingAddressId: draft.billingAddressId,
      shippingAddressId: draft.shippingAddressId || undefined,
      recipientTaxRegistrationId: draft.taxRegistrationId || undefined,
      documentType: 'tax_invoice',
      documentDate: draft.documentDate,
      seriesCode: draft.seriesCode,
      supplyType: draft.supplyType,
      currencyCode: activeOrganization.base_currency,
      placeOfSupplyStateCode: draft.placeOfSupplyStateCode || undefined,
      reverseCharge: draft.reverseCharge,
      notes: draft.notes,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the invoice details.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch<{ documentId: string }>('/v1/financial-documents', {
        method: 'POST', body: JSON.stringify(parsed.data),
      })
      setShowDraftForm(false)
      resetDraftForm()
      await Promise.all([loadDocuments(), loadDetail(response.documentId)])
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization || !detail || detail.document.status !== 'draft') return

    const taxes: { component: 'CGST' | 'SGST' | 'IGST' | 'CESS'; rate: string }[] = []
    if (detail.document.supply_type === 'intra_state') {
      if (line.cgstRate !== '0') taxes.push({ component: 'CGST', rate: line.cgstRate })
      if (line.sgstRate !== '0') taxes.push({ component: 'SGST', rate: line.sgstRate })
    } else {
      if (line.igstRate !== '0') taxes.push({ component: 'IGST', rate: line.igstRate })
    }
    if (line.cessRate !== '0') taxes.push({ component: 'CESS', rate: line.cessRate })

    const parsed = upsertFinancialDocumentLineSchema.safeParse({
      organizationId: activeOrganization.id,
      documentId: detail.document.id,
      lineNumber: nextLineNumber,
      description: line.description,
      quantity: line.quantity,
      uom: line.uom,
      unitPrice: line.unitPrice,
      hsnSac: line.hsnSac,
      discountAmount: line.discountAmount,
      taxes,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the line details.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/${detail.document.id}/lines`, {
        method: 'POST', body: JSON.stringify(parsed.data),
      })
      setLine(emptyLine)
      await loadDetail(detail.document.id)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function removeLine(lineNumber: number) {
    if (!activeOrganization || !detail || detail.document.status !== 'draft') return
    try {
      await apiFetch(`/v1/financial-documents/${detail.document.id}/lines/${lineNumber}/remove`, {
        method: 'POST', body: JSON.stringify({ organizationId: activeOrganization.id }),
      })
      await loadDetail(detail.document.id)
    } catch (caught) {
      setError(friendlyError(caught))
    }
  }

  async function issueDocument() {
    if (!activeOrganization || !detail || detail.document.status !== 'draft') return
    if (!window.confirm('Issue this invoice? After issue, header, lines and taxes become immutable.')) return

    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/${detail.document.id}/issue`, {
        method: 'POST',
        body: JSON.stringify({
          organizationId: activeOrganization.id,
          requestKey: `web-issue-${detail.document.id}-${crypto.randomUUID()}`,
        }),
      })
      await Promise.all([loadDocuments(), loadDetail(detail.document.id)])
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function cancelDocument() {
    if (!activeOrganization || !detail || detail.document.status !== 'issued') return
    const reason = window.prompt('Cancellation reason')?.trim()
    if (!reason) return

    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/${detail.document.id}/cancel`, {
        method: 'POST', body: JSON.stringify({ organizationId: activeOrganization.id, reason }),
      })
      await Promise.all([loadDocuments(), loadDetail(detail.document.id)])
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Invoices</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading invoice-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>Invoices</h1>
          <p className="muted">Profile-derived GST invoices. PostgreSQL calculates taxable values and tax amounts.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowDraftForm((value) => !value)}>
          {showDraftForm ? 'Close' : 'New tax invoice'}
        </button>
      </div>

      {error ? <p className="error-message invoice-error" role="alert">{error}</p> : null}

      {showDraftForm ? (
        <section className="panel invoice-draft-panel">
          <div className="panel-heading"><h2>New tax invoice draft</h2></div>
          {sellerProfiles.length === 0 ? (
            <p className="empty-state">Configure an active seller profile in Settings before creating invoices.</p>
          ) : (
            <form className="invoice-form" onSubmit={createDraft}>
              <label>Seller profile<select required value={draft.supplierProfileId} onChange={(e) => setDraft({ ...draft, supplierProfileId: e.target.value })}>
                {sellerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.code} · {profile.legal_name}</option>)}
              </select></label>
              <label>Customer<select required value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
                <option value="">Select customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.display_name}</option>)}
              </select></label>
              <label>Billing address<select required value={draft.billingAddressId} onChange={(e) => {
                const address = customerProfile?.addresses.find((item) => item.id === e.target.value)
                setDraft({ ...draft, billingAddressId: e.target.value, placeOfSupplyStateCode: address?.state_code ?? draft.placeOfSupplyStateCode })
              }}>
                <option value="">Select address</option>
                {customerProfile?.addresses.map((address) => <option key={address.id} value={address.id}>{address.label} · {address.city}</option>)}
              </select></label>
              <label>Shipping address<select value={draft.shippingAddressId} onChange={(e) => setDraft({ ...draft, shippingAddressId: e.target.value })}>
                <option value="">Same as billing</option>
                {customerProfile?.addresses.map((address) => <option key={address.id} value={address.id}>{address.label} · {address.city}</option>)}
              </select></label>
              <label>GST registration<select value={draft.taxRegistrationId} onChange={(e) => setDraft({ ...draft, taxRegistrationId: e.target.value })}>
                <option value="">Unregistered / none</option>
                {customerProfile?.taxRegistrations.filter((registration) => registration.scheme === 'GSTIN').map((registration) => (
                  <option key={registration.id} value={registration.id}>{registration.registration_number} · {registration.verification_status}</option>
                ))}
              </select></label>
              <label>Invoice date<input type="date" required value={draft.documentDate} onChange={(e) => setDraft({ ...draft, documentDate: e.target.value })} /></label>
              <label>Series<input required maxLength={8} value={draft.seriesCode} onChange={(e) => setDraft({ ...draft, seriesCode: e.target.value.toUpperCase() })} /></label>
              <label>Supply type<select value={draft.supplyType} onChange={(e) => setDraft({ ...draft, supplyType: e.target.value as SupplyType })}>
                <option value="intra_state">Intra-State</option>
                <option value="inter_state">Inter-State</option>
                <option value="export">Export</option>
                <option value="sez">SEZ</option>
              </select></label>
              <label>Place of supply state code<input maxLength={20} value={draft.placeOfSupplyStateCode} onChange={(e) => setDraft({ ...draft, placeOfSupplyStateCode: e.target.value })} /></label>
              <label className="invoice-check"><input type="checkbox" checked={draft.reverseCharge} onChange={(e) => setDraft({ ...draft, reverseCharge: e.target.checked })} />Reverse charge</label>
              <label className="invoice-full-field">Notes<textarea maxLength={2000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
              <p className="invoice-note invoice-full-field">Seller and buyer legal identities are snapshotted from the selected master records. Browser-entered free-form legal identity is not accepted.</p>
              <div className="invoice-form-actions invoice-full-field"><button className="primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : 'Create draft'}</button></div>
            </form>
          )}
        </section>
      ) : null}

      <div className="invoice-layout">
        <section className="panel invoice-list-panel">
          <div className="panel-heading"><h2>Documents</h2><span className="record-count">{loading ? 'Loading…' : `${documents.length} shown`}</span></div>
          {!loading && documents.length === 0 ? <p className="empty-state">No financial documents found.</p> : null}
          <div className="invoice-list">
            {documents.map((document) => (
              <button className={`invoice-list-row ${selectedDocumentId === document.id ? 'selected' : ''}`} type="button" key={document.id} onClick={() => void loadDetail(document.id)}>
                <span><strong>{document.document_number ?? `${document.series_code} draft`}</strong><small>{document.document_date} · {document.document_type.replace('_', ' ')}</small></span>
                <span><strong>{document.currency_code} {String(document.grand_total)}</strong><small>{statusLabel(document.status)}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel invoice-detail-panel">
          {!detail ? <p className="empty-state">Select an invoice to view or edit it.</p> : (
            <>
              <div className="invoice-detail-header">
                <div>
                  <p className="eyebrow">{detail.document.document_number ?? 'Draft'}</p>
                  <h2>{displaySnapshotName(detail.document.bill_to_snapshot)}</h2>
                  <p className="muted">{detail.document.document_date} · {detail.document.supply_type.replace('_', ' ')}</p>
                </div>
                <div className="invoice-detail-actions">
                  <span className="status-pill neutral">{statusLabel(detail.document.status)}</span>
                  {detail.document.status === 'draft' ? <button className="primary-button" type="button" disabled={saving || detail.lines.length === 0} onClick={() => void issueDocument()}>Issue invoice</button> : null}
                  {detail.document.status === 'issued' ? <button className="secondary-button danger-text" type="button" disabled={saving} onClick={() => void cancelDocument()}>Cancel invoice</button> : null}
                </div>
              </div>

              <div className="invoice-snapshot-grid">
                <div><span>Seller</span><strong>{displaySnapshotName(detail.document.supplier_snapshot)}</strong></div>
                <div><span>Buyer GSTIN</span><strong>{String(detail.document.bill_to_snapshot.tax_registration_number ?? 'Unregistered')}</strong></div>
                <div><span>Place of supply</span><strong>{detail.document.place_of_supply_state_code ?? '—'}</strong></div>
                <div><span>Total</span><strong>{detail.document.currency_code} {String(detail.document.grand_total)}</strong></div>
              </div>

              <div className="invoice-lines">
                {detail.lines.length === 0 ? <p className="empty-state">No lines yet.</p> : detail.lines.map((documentLine) => (
                  <article className="invoice-line-row" key={documentLine.id}>
                    <div><strong>{documentLine.line_number}. {documentLine.description}</strong><span>HSN/SAC {documentLine.hsn_sac ?? '—'} · {String(documentLine.quantity)} {documentLine.uom} × {String(documentLine.unit_price)}</span></div>
                    <div><strong>Taxable {String(documentLine.taxable_value)}</strong><span>{(taxesByLine.get(documentLine.id) ?? []).map((tax) => `${tax.component} ${String(tax.rate)}% = ${String(tax.amount)}`).join(' · ') || 'No tax'}</span></div>
                    {detail.document.status === 'draft' ? <button className="text-button danger-text" type="button" onClick={() => void removeLine(documentLine.line_number)}>Remove</button> : null}
                  </article>
                ))}
              </div>

              {detail.document.status === 'draft' ? (
                <form className="invoice-line-form" onSubmit={addLine}>
                  <h3>Add line {nextLineNumber}</h3>
                  <label className="invoice-full-field">Description<input required maxLength={500} value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} /></label>
                  <label>HSN/SAC<input maxLength={16} value={line.hsnSac} onChange={(e) => setLine({ ...line, hsnSac: e.target.value })} /></label>
                  <label>Quantity<input inputMode="decimal" required value={line.quantity} onChange={(e) => setLine({ ...line, quantity: e.target.value })} /></label>
                  <label>Unit<input required maxLength={20} value={line.uom} onChange={(e) => setLine({ ...line, uom: e.target.value })} /></label>
                  <label>Unit price<input inputMode="decimal" required value={line.unitPrice} onChange={(e) => setLine({ ...line, unitPrice: e.target.value })} /></label>
                  <label>Discount amount<input inputMode="decimal" required value={line.discountAmount} onChange={(e) => setLine({ ...line, discountAmount: e.target.value })} /></label>
                  {detail.document.supply_type === 'intra_state' ? (
                    <><label>CGST %<input inputMode="decimal" value={line.cgstRate} onChange={(e) => setLine({ ...line, cgstRate: e.target.value })} /></label><label>SGST %<input inputMode="decimal" value={line.sgstRate} onChange={(e) => setLine({ ...line, sgstRate: e.target.value })} /></label></>
                  ) : <label>IGST %<input inputMode="decimal" value={line.igstRate} onChange={(e) => setLine({ ...line, igstRate: e.target.value })} /></label>}
                  <label>CESS %<input inputMode="decimal" value={line.cessRate} onChange={(e) => setLine({ ...line, cessRate: e.target.value })} /></label>
                  <p className="invoice-note invoice-full-field">Taxable value and tax amounts are calculated by PostgreSQL when this line is saved. Any browser preview is non-authoritative.</p>
                  <div className="invoice-form-actions invoice-full-field"><button className="primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : 'Add line'}</button></div>
                </form>
              ) : null}

              <div className="invoice-totals">
                <span>Taxable <strong>{String(detail.document.taxable_total)}</strong></span>
                <span>CGST <strong>{String(detail.document.cgst_total)}</strong></span>
                <span>SGST/UTGST <strong>{String(detail.document.sgst_total)} / {String(detail.document.utgst_total)}</strong></span>
                <span>IGST <strong>{String(detail.document.igst_total)}</strong></span>
                <span>CESS <strong>{String(detail.document.cess_total)}</strong></span>
                <span className="invoice-grand-total">Grand total <strong>{detail.document.currency_code} {String(detail.document.grand_total)}</strong></span>
              </div>

              {detail.document.status === 'cancelled' ? <p className="invoice-cancel-reason">Cancelled: {detail.document.cancellation_reason}</p> : null}
            </>
          )}
        </section>
      </div>
    </section>
  )
}
