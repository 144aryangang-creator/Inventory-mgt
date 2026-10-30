import {
  paymentMethodSchema,
  recordAndAllocateInvoicePaymentSchema,
  reverseCustomerPaymentSchema,
  reversePaymentAllocationSchema,
  type PaymentMethod,
} from '@inventory/contracts/customer-payments'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import '../payments.css'

type FinancialDocumentSummary = {
  id: string
  document_type: 'tax_invoice' | 'credit_note' | 'debit_note'
  status: 'draft' | 'issued' | 'cancelled'
  document_date: string
  document_number: string | null
  recipient_party_id: string | null
  currency_code: string
  grand_total: string | number
}

type FinancialDocumentDetail = {
  document: FinancialDocumentSummary & {
    bill_to_snapshot: Record<string, unknown>
  }
}

type InvoiceBalance = {
  grand_total: string | number
  allocated_total: string | number
  balance_due: string | number
  payment_status: 'unpaid' | 'part_paid' | 'paid'
}

type CustomerPayment = {
  id: string
  customer_party_id: string
  payment_date: string
  amount: string | number
  currency_code: string
  method: PaymentMethod
  reference: string | null
  notes: string | null
  created_at: string
}

type PaymentAllocation = {
  id: string
  payment_id: string
  financial_document_id: string
  amount: string | number
  request_key: string
  created_at: string
}

type AllocationReversal = {
  id: string
  allocation_id: string
  amount: string | number
  reason: string
  request_key: string
  created_at: string
}

type CorrectionTarget =
  | { kind: 'allocation'; id: string; label: string }
  | { kind: 'payment'; id: string; label: string }

type ListResponse<T> = { data: T[]; requestId: string }
type DetailResponse = { data: FinancialDocumentDetail; requestId: string }
type BalanceResponse = { data: InvoiceBalance | null; requestId: string }
type AllocationResponse = { data: PaymentAllocation[]; reversals: AllocationReversal[]; requestId: string }

const paymentMethods = paymentMethodSchema.options

function localIsoDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayBuyer(snapshot: Record<string, unknown>): string {
  const legalName = snapshot.legal_name
  const displayName = snapshot.display_name
  if (typeof legalName === 'string' && legalName) return legalName
  if (typeof displayName === 'string' && displayName) return displayName
  return 'Customer'
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow this payment action.',
      payment_or_invoice_not_found: 'The selected customer or invoice is no longer available.',
      payment_not_found: 'The selected receipt is no longer available.',
      allocation_not_found: 'The selected allocation is no longer available.',
      payment_idempotency_conflict: 'This payment request conflicts with an earlier request.',
      allocation_not_allowed: 'The receipt cannot be applied. Check the invoice balance, customer and currency.',
      reversal_idempotency_conflict: 'This correction request key conflicts with an earlier correction.',
      reversal_not_allowed: 'This correction exceeds the amount currently available to reverse. Reverse allocations first if needed.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function statusLabel(status: InvoiceBalance['payment_status']): string {
  if (status === 'part_paid') return 'Part paid'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function PaymentsPage() {
  const { activeOrganization, loading: organizationLoading } = useOrganization()
  const [invoices, setInvoices] = useState<FinancialDocumentSummary[]>([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [detail, setDetail] = useState<FinancialDocumentDetail | null>(null)
  const [balance, setBalance] = useState<InvoiceBalance | null>(null)
  const [payments, setPayments] = useState<CustomerPayment[]>([])
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([])
  const [allocationReversals, setAllocationReversals] = useState<AllocationReversal[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentDate, setPaymentDate] = useState(localIsoDate())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('upi')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null)
  const [correctionAmount, setCorrectionAmount] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  )

  const loadInvoices = useCallback(async () => {
    if (!activeOrganization) {
      setInvoices([])
      return
    }

    const response = await apiFetch<ListResponse<FinancialDocumentSummary>>(
      `/v1/financial-documents?organizationId=${encodeURIComponent(activeOrganization.id)}&documentType=tax_invoice&status=issued&limit=100`,
    )
    setInvoices(response.data)
    setSelectedInvoiceId((current) => current || response.data[0]?.id || '')
  }, [activeOrganization])

  const loadInvoicePaymentState = useCallback(async (invoiceId: string) => {
    if (!activeOrganization || !invoiceId) {
      setDetail(null)
      setBalance(null)
      setPayments([])
      setAllocations([])
      setAllocationReversals([])
      return
    }

    const detailResponse = await apiFetch<DetailResponse>(
      `/v1/financial-documents/${encodeURIComponent(invoiceId)}?organizationId=${encodeURIComponent(activeOrganization.id)}`,
    )
    const customerPartyId = detailResponse.data.document.recipient_party_id

    const [balanceResponse, paymentsResponse, allocationResponse] = await Promise.all([
      apiFetch<BalanceResponse>(
        `/v1/customer-payments/invoice/${encodeURIComponent(invoiceId)}/balance?organizationId=${encodeURIComponent(activeOrganization.id)}`,
      ),
      customerPartyId
        ? apiFetch<ListResponse<CustomerPayment>>(
            `/v1/customer-payments?organizationId=${encodeURIComponent(activeOrganization.id)}&customerPartyId=${encodeURIComponent(customerPartyId)}&limit=20`,
          )
        : Promise.resolve({ data: [], requestId: '' }),
      apiFetch<AllocationResponse>(
        `/v1/customer-payments/invoice/${encodeURIComponent(invoiceId)}/allocations?organizationId=${encodeURIComponent(activeOrganization.id)}`,
      ),
    ])

    setDetail(detailResponse.data)
    setBalance(balanceResponse.data)
    setPayments(paymentsResponse.data)
    setAllocations(allocationResponse.data)
    setAllocationReversals(allocationResponse.reversals)
    setAmount(String(balanceResponse.data?.balance_due ?? ''))
  }, [activeOrganization])

  useEffect(() => {
    if (!activeOrganization) return
    setLoading(true)
    setError(null)
    loadInvoices()
      .catch((caught) => setError(friendlyError(caught)))
      .finally(() => setLoading(false))
  }, [activeOrganization, loadInvoices])

  useEffect(() => {
    if (!selectedInvoiceId) {
      setDetail(null)
      setBalance(null)
      return
    }
    setLoading(true)
    setError(null)
    setCorrectionTarget(null)
    loadInvoicePaymentState(selectedInvoiceId)
      .catch((caught) => setError(friendlyError(caught)))
      .finally(() => setLoading(false))
  }, [loadInvoicePaymentState, selectedInvoiceId])

  async function recordReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization || !detail || !selectedInvoice || !detail.document.recipient_party_id) return

    const requestId = crypto.randomUUID()
    const parsed = recordAndAllocateInvoicePaymentSchema.safeParse({
      organizationId: activeOrganization.id,
      customerPartyId: detail.document.recipient_party_id,
      documentId: selectedInvoice.id,
      paymentDate,
      amount,
      currencyCode: selectedInvoice.currency_code,
      method,
      paymentRequestKey: `web-payment-${selectedInvoice.id}-${requestId}`,
      allocationRequestKey: `web-allocation-${selectedInvoice.id}-${requestId}`,
      reference,
      notes,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the payment details.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/v1/customer-payments/invoice/${encodeURIComponent(selectedInvoice.id)}/receipt`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setReference('')
      setNotes('')
      await loadInvoicePaymentState(selectedInvoice.id)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  function startCorrection(target: CorrectionTarget, suggestedAmount: string) {
    setCorrectionTarget(target)
    setCorrectionAmount(suggestedAmount)
    setCorrectionReason('')
    setError(null)
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeOrganization || !selectedInvoice || !correctionTarget) return

    const requestKey = `web-${correctionTarget.kind}-reversal-${correctionTarget.id}-${crypto.randomUUID()}`
    const raw = {
      organizationId: activeOrganization.id,
      amount: correctionAmount,
      reason: correctionReason,
      requestKey,
    }

    const parsed = correctionTarget.kind === 'allocation'
      ? reversePaymentAllocationSchema.safeParse({ ...raw, allocationId: correctionTarget.id })
      : reverseCustomerPaymentSchema.safeParse({ ...raw, paymentId: correctionTarget.id })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the correction details.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const endpoint = correctionTarget.kind === 'allocation'
        ? `/v1/customer-payments/allocations/${encodeURIComponent(correctionTarget.id)}/reverse`
        : `/v1/customer-payments/${encodeURIComponent(correctionTarget.id)}/reverse`
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(parsed.data) })
      setCorrectionTarget(null)
      setCorrectionAmount('')
      setCorrectionReason('')
      await loadInvoicePaymentState(selectedInvoice.id)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSaving(false)
    }
  }

  if (organizationLoading) return <div className="centered-panel-state">Loading organization…</div>
  if (!activeOrganization) return <section className="panel"><h1>Payments</h1><p className="muted">Create an organization first.</p></section>

  return (
    <section>
      <div className="page-heading payment-heading">
        <div>
          <p className="eyebrow">{activeOrganization.name}</p>
          <h1>Payments</h1>
          <p className="muted">Record immutable customer receipts and apply corrections through append-only reversal entries.</p>
        </div>
      </div>

      {error ? <p className="error-message payment-error" role="alert">{error}</p> : null}

      <div className="payment-layout">
        <section className="panel payment-invoice-panel">
          <div className="panel-heading"><h2>Issued invoices</h2><span className="record-count">{loading ? 'Loading…' : `${invoices.length} shown`}</span></div>
          {invoices.length === 0 && !loading ? <p className="empty-state">No issued tax invoices available.</p> : null}
          <div className="payment-invoice-list">
            {invoices.map((invoice) => (
              <button
                className={`payment-invoice-row ${selectedInvoiceId === invoice.id ? 'selected' : ''}`}
                key={invoice.id}
                type="button"
                onClick={() => setSelectedInvoiceId(invoice.id)}
              >
                <span><strong>{invoice.document_number ?? 'Issued invoice'}</strong><small>{invoice.document_date}</small></span>
                <strong>{invoice.currency_code} {String(invoice.grand_total)}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="panel payment-detail-panel">
          {!selectedInvoice || !detail || !balance ? <p className="empty-state">Select an issued invoice to manage its payment.</p> : (
            <>
              <div className="payment-detail-header">
                <div>
                  <p className="eyebrow">{selectedInvoice.document_number ?? 'Invoice'}</p>
                  <h2>{displayBuyer(detail.document.bill_to_snapshot)}</h2>
                  <p className="muted">{selectedInvoice.document_date} · {selectedInvoice.currency_code}</p>
                </div>
                <span className={`status-pill ${balance.payment_status === 'paid' ? 'success' : 'neutral'}`}>{statusLabel(balance.payment_status)}</span>
              </div>

              <div className="payment-balance-grid">
                <div><span>Invoice total</span><strong>{selectedInvoice.currency_code} {String(balance.grand_total)}</strong></div>
                <div><span>Net allocated</span><strong>{selectedInvoice.currency_code} {String(balance.allocated_total)}</strong></div>
                <div><span>Balance due</span><strong>{selectedInvoice.currency_code} {String(balance.balance_due)}</strong></div>
              </div>

              {balance.payment_status !== 'paid' ? (
                <form className="payment-form" onSubmit={recordReceipt}>
                  <h3>Record receipt</h3>
                  <label>Payment date<input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
                  <label>Amount<input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
                  <label>Method<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
                    {paymentMethods.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
                  </select></label>
                  <label>Reference<input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR, cheque no., etc." /></label>
                  <label className="payment-full-field">Notes<textarea maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
                  <p className="payment-note payment-full-field">The receipt and its invoice allocation are committed in one database transaction. If allocation fails, no receipt is left behind.</p>
                  <div className="payment-full-field"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Recording…' : 'Record and apply receipt'}</button></div>
                </form>
              ) : <p className="payment-paid-note">This invoice is fully paid. Use allocation corrections below if a recorded application must be reversed.</p>}

              <div className="payment-history">
                <div className="panel-heading"><h3>Invoice allocation history</h3><span className="record-count">{allocations.length} entries</span></div>
                {allocations.length === 0 ? <p className="empty-state">No payment allocations recorded for this invoice.</p> : (
                  <div className="payment-history-list">
                    {allocations.map((allocation) => {
                      const reversals = allocationReversals.filter((entry) => entry.allocation_id === allocation.id)
                      return (
                        <article key={allocation.id}>
                          <span>
                            <strong>{selectedInvoice.currency_code} {String(allocation.amount)}</strong>
                            <small>Original allocation · {new Date(allocation.created_at).toLocaleString()}</small>
                            {reversals.map((reversal) => (
                              <small key={reversal.id}>Reversed {selectedInvoice.currency_code} {String(reversal.amount)} · {reversal.reason}</small>
                            ))}
                          </span>
                          <button className="text-button" type="button" onClick={() => startCorrection({ kind: 'allocation', id: allocation.id, label: 'Reverse allocation' }, String(allocation.amount))}>Reverse</button>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="payment-history">
                <div className="panel-heading"><h3>Recent customer receipts</h3><span className="record-count">{payments.length} shown</span></div>
                {payments.length === 0 ? <p className="empty-state">No recorded receipts for this customer.</p> : (
                  <div className="payment-history-list">
                    {payments.map((payment) => (
                      <article key={payment.id}>
                        <span><strong>{payment.currency_code} {String(payment.amount)}</strong><small>{payment.payment_date} · {payment.method.replace('_', ' ')}</small></span>
                        <span>{payment.reference ?? 'No reference'}</span>
                        <button className="text-button" type="button" onClick={() => startCorrection({ kind: 'payment', id: payment.id, label: 'Refund receipt' }, String(payment.amount))}>Refund</button>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              {correctionTarget ? (
                <form className="payment-form" onSubmit={submitCorrection}>
                  <h3>{correctionTarget.label}</h3>
                  <label>Amount<input inputMode="decimal" required value={correctionAmount} onChange={(event) => setCorrectionAmount(event.target.value)} /></label>
                  <label className="payment-full-field">Reason<textarea required maxLength={240} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Why is this correction required?" /></label>
                  <p className="payment-note payment-full-field">Corrections never edit or delete the original ledger entry. The database validates the remaining reversible amount and appends an audited reversal.</p>
                  <div className="payment-full-field">
                    <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving correction…' : 'Record correction'}</button>{' '}
                    <button className="secondary-button" type="button" disabled={saving} onClick={() => setCorrectionTarget(null)}>Cancel</button>
                  </div>
                </form>
              ) : null}
            </>
          )}
        </section>
      </div>
    </section>
  )
}
