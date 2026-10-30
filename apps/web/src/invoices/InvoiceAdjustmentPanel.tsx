import {
  issueInvoiceAdjustmentSchema,
  type InvoiceAdjustmentType,
} from '@inventory/contracts/financial-documents'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'

type InvoiceLine = {
  id: string
  line_number: number
  description: string
  quantity: string | number
  uom: string
  taxable_value: string | number
}

type InvoiceDetailResponse = {
  data: {
    document: {
      id: string
      document_type: 'tax_invoice' | 'credit_note' | 'debit_note'
      status: 'draft' | 'issued' | 'cancelled'
      document_number: string | null
      currency_code: string
    }
    lines: InvoiceLine[]
  }
  requestId: string
}

type FinancialAdjustment = {
  id: string
  original_invoice_id: string
  adjustment_document_id: string
  adjustment_type: 'credit_note' | 'debit_note'
  reason: string
  document_date: string
  series_code: string
  request_key: string
  created_at: string
}

type FinancialAdjustmentLine = {
  adjustment_id: string
  original_invoice_line_id: string
  adjustment_document_id: string
  adjustment_document_line_id: string
  basis_quantity: string | number
  taxable_adjustment: string | number
  created_at: string
}

type AdjustmentDocument = {
  id: string
  document_type: 'credit_note' | 'debit_note'
  status: 'draft' | 'issued' | 'cancelled'
  document_number: string | null
  document_date: string
  currency_code: string
  taxable_total: string | number
  cgst_total: string | number
  sgst_total: string | number
  utgst_total: string | number
  igst_total: string | number
  cess_total: string | number
  grand_total: string | number
  cancelled_at: string | null
  cancellation_reason: string | null
}

type AdjustmentHistoryResponse = {
  data: FinancialAdjustment[]
  lines: FinancialAdjustmentLine[]
  documents: AdjustmentDocument[]
  requestId: string
}

type InvoiceAdjustmentPanelProps = {
  organizationId: string
  documentId: string
  documentStatus: 'draft' | 'issued' | 'cancelled'
  onChanged: () => Promise<void> | void
}

function localIsoDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow credit/debit adjustments.',
      original_invoice_or_line_not_found: 'The original issued invoice or selected line is no longer available.',
      adjustment_idempotency_conflict: 'This adjustment request conflicts with an earlier request.',
      adjustment_not_allowed: 'This adjustment is not allowed. Check the original quantity and remaining credit value.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

export function InvoiceAdjustmentPanel({ organizationId, documentId, documentStatus, onChanged }: InvoiceAdjustmentPanelProps) {
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([])
  const [isTaxInvoice, setIsTaxInvoice] = useState(false)
  const [adjustments, setAdjustments] = useState<FinancialAdjustment[]>([])
  const [adjustmentLines, setAdjustmentLines] = useState<FinancialAdjustmentLine[]>([])
  const [adjustmentDocuments, setAdjustmentDocuments] = useState<AdjustmentDocument[]>([])
  const [showForm, setShowForm] = useState(false)
  const [adjustmentType, setAdjustmentType] = useState<InvoiceAdjustmentType>('credit_note')
  const [documentDate, setDocumentDate] = useState(localIsoDate())
  const [seriesCode, setSeriesCode] = useState('CRN')
  const [reason, setReason] = useState('')
  const [basisQuantities, setBasisQuantities] = useState<Record<string, string>>({})
  const [taxableAdjustments, setTaxableAdjustments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(documentStatus !== 'draft')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (documentStatus === 'draft') {
      setIsTaxInvoice(false)
      setInvoiceLines([])
      setAdjustments([])
      setAdjustmentLines([])
      setAdjustmentDocuments([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const detail = await apiFetch<InvoiceDetailResponse>(
        `/v1/financial-documents/${encodeURIComponent(documentId)}?organizationId=${encodeURIComponent(organizationId)}`,
      )
      const taxInvoice = detail.data.document.document_type === 'tax_invoice'
      setIsTaxInvoice(taxInvoice)
      setInvoiceLines(taxInvoice ? detail.data.lines : [])

      if (taxInvoice) {
        const history = await apiFetch<AdjustmentHistoryResponse>(
          `/v1/financial-adjustments?organizationId=${encodeURIComponent(organizationId)}&originalInvoiceId=${encodeURIComponent(documentId)}`,
        )
        setAdjustments(history.data)
        setAdjustmentLines(history.lines)
        setAdjustmentDocuments(history.documents)
      } else {
        setAdjustments([])
        setAdjustmentLines([])
        setAdjustmentDocuments([])
      }
      setError(null)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [documentId, documentStatus, organizationId])

  useEffect(() => { void load() }, [load])

  function resetForm(nextType: InvoiceAdjustmentType = adjustmentType) {
    setAdjustmentType(nextType)
    setDocumentDate(localIsoDate())
    setSeriesCode(nextType === 'credit_note' ? 'CRN' : 'DBN')
    setReason('')
    setBasisQuantities({})
    setTaxableAdjustments({})
    setError(null)
  }

  function changeType(nextType: InvoiceAdjustmentType) {
    setAdjustmentType(nextType)
    setSeriesCode(nextType === 'credit_note' ? 'CRN' : 'DBN')
  }

  function openPrint(adjustmentDocumentId: string) {
    const url = `/financial-documents/${encodeURIComponent(adjustmentDocumentId)}/print?organizationId=${encodeURIComponent(organizationId)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function issueAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (posting) return

    const lines = invoiceLines
      .map((line) => ({
        originalLineId: line.id,
        basisQuantity: basisQuantities[line.id]?.trim() ?? '',
        taxableAdjustment: taxableAdjustments[line.id]?.trim() ?? '',
      }))
      .filter((line) => line.basisQuantity !== '' || line.taxableAdjustment !== '')

    const parsed = issueInvoiceAdjustmentSchema.safeParse({
      organizationId,
      originalInvoiceId: documentId,
      adjustmentType,
      lines,
      documentDate,
      seriesCode,
      reason,
      requestKey: `web-adjust-${documentId}-${crypto.randomUUID()}`,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the adjustment details.')
      return
    }

    const label = adjustmentType === 'credit_note' ? 'credit note' : 'debit note'
    if (!window.confirm(`Issue this ${label}? It will be issued immediately and become immutable.`)) return

    setPosting(true)
    setError(null)
    try {
      await apiFetch('/v1/financial-adjustments', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setShowForm(false)
      resetForm(adjustmentType)
      await load()
      await onChanged()
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setPosting(false)
    }
  }

  if (documentStatus === 'draft' || (!loading && !isTaxInvoice)) return null

  return (
    <div className="invoice-return-history invoice-adjustment-panel">
      <div className="invoice-fulfillment-return-header">
        <div>
          <strong>Commercial credit / debit notes</strong>
          <small>{loading ? 'Loading adjustments…' : adjustments.length === 0 ? 'No non-return financial adjustments.' : `${adjustments.length} immutable adjustment${adjustments.length === 1 ? '' : 's'}.`}</small>
        </div>
        {documentStatus === 'issued' && isTaxInvoice ? (
          <button className="secondary-button" type="button" disabled={posting || loading} onClick={() => {
            setShowForm((current) => !current)
            if (!showForm) resetForm()
          }}>
            {showForm ? 'Close adjustment' : 'New credit / debit note'}
          </button>
        ) : null}
      </div>

      {adjustments.map((adjustment) => {
        const document = adjustmentDocuments.find((entry) => entry.id === adjustment.adjustment_document_id)
        const lines = adjustmentLines.filter((entry) => entry.adjustment_id === adjustment.id)
        return (
          <div className="invoice-return-record" key={adjustment.id}>
            <span>
              <strong>{document?.document_number ?? adjustment.series_code} · {adjustment.adjustment_type === 'credit_note' ? 'Credit Note' : 'Debit Note'}</strong>
              <small>{adjustment.document_date} · {adjustment.reason}</small>
              {lines.map((line) => <small key={line.adjustment_document_line_id}>Line {line.original_invoice_line_id.slice(0, 8)} · basis {String(line.basis_quantity)} · taxable adjustment {String(line.taxable_adjustment)}</small>)}
            </span>
            <span>
              <small>{document?.status ?? 'unknown'} · {document?.currency_code ?? ''} {document ? String(document.grand_total) : ''}</small>
              {document?.status === 'cancelled' && document.cancellation_reason ? <small>Cancelled: {document.cancellation_reason}</small> : null}
              {document ? <button className="text-button" type="button" onClick={() => openPrint(document.id)}>Print</button> : null}
            </span>
          </div>
        )
      })}

      {showForm && documentStatus === 'issued' ? (
        <form className="invoice-return-form" onSubmit={issueAdjustment}>
          <p className="muted">Select original invoice lines and enter only the taxable value being reduced or increased. GST components/rates, legal identities, HSN/SAC and item snapshots are copied from the issued invoice by PostgreSQL.</p>
          <label>
            Adjustment type
            <select value={adjustmentType} onChange={(event) => changeType(event.target.value as InvoiceAdjustmentType)}>
              <option value="credit_note">Credit note · reduce taxable value</option>
              <option value="debit_note">Debit note · increase taxable value</option>
            </select>
          </label>
          {invoiceLines.map((line) => (
            <div className="invoice-adjustment-line" key={line.id}>
              <span><strong>{line.line_number}. {line.description}</strong><small>Original {String(line.quantity)} {line.uom} · taxable {String(line.taxable_value)}</small></span>
              <label>Basis quantity<input inputMode="decimal" placeholder="e.g. 1" value={basisQuantities[line.id] ?? ''} onChange={(event) => setBasisQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
              <label>Taxable adjustment<input inputMode="decimal" placeholder="e.g. 500" value={taxableAdjustments[line.id] ?? ''} onChange={(event) => setTaxableAdjustments((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
            </div>
          ))}
          <label>Document date<input type="date" required value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></label>
          <label>Series<input required maxLength={8} value={seriesCode} onChange={(event) => setSeriesCode(event.target.value.toUpperCase())} /></label>
          <label>Reason<textarea required maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <p className="muted">Credit notes share one taxable-value ceiling with return-linked credits. Debit notes may increase value but remain tied to original invoice lines and GST treatment.</p>
          <button className="primary-button" type="submit" disabled={posting}>{posting ? 'Issuing…' : adjustmentType === 'credit_note' ? 'Issue credit note' : 'Issue debit note'}</button>
        </form>
      ) : null}

      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </div>
  )
}
