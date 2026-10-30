import {
  issueSalesReturnCreditNoteSchema,
  returnSalesFulfillmentSchema,
} from '@inventory/contracts/sales-fulfillment'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { InvoiceAdjustmentPanel } from './InvoiceAdjustmentPanel'

type Warehouse = { id: string; code: string; name: string; is_active: boolean }
type Fulfillment = { id: string; financial_document_id: string; warehouse_id: string; request_key: string; posted_at: string; created_by: string }
type FulfillmentLine = { financial_document_line_id: string; item_id: string; inventory_movement_id: string; quantity: string | number; created_at: string }
type SalesReturn = { id: string; fulfillment_id: string; reason: string; request_key: string; posted_at: string }
type SalesReturnLine = { return_id: string; fulfillment_id: string; fulfillment_line_id: string; item_id: string; inventory_movement_id: string; quantity: string | number; created_at: string }
type ReturnCreditLink = { id: string; sales_return_id: string; credit_note_id: string; document_date: string; series_code: string; request_key: string; created_at: string }
type ReturnCreditAllocation = { sales_return_credit_note_id: string; sales_return_id: string; fulfillment_line_id: string; credit_note_id: string; credit_note_line_id: string; quantity: string | number; created_at: string }
type ReturnCreditDocument = { id: string; status: 'draft' | 'issued' | 'cancelled'; document_number: string | null; document_date: string; grand_total: string | number; currency_code: string; cancelled_at: string | null; cancellation_reason: string | null }

type InvoiceFulfillmentPanelProps = {
  organizationId: string
  documentId: string
  documentStatus: 'draft' | 'issued' | 'cancelled'
  hasStockLines: boolean
  onChanged: () => Promise<void> | void
}

type ListResponse<T> = { data: T[]; requestId: string }
type FulfillmentResponse = { data: Fulfillment | null; lines: FulfillmentLine[]; requestId: string }
type ReturnHistoryResponse = { data: SalesReturn[]; lines: SalesReturnLine[]; requestId: string }
type CreditHistoryResponse = { data: ReturnCreditLink[]; allocations: ReturnCreditAllocation[]; documents: ReturnCreditDocument[]; requestId: string }

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
      forbidden: 'Your role does not allow this stock or credit action.',
      issued_invoice_not_found: 'Only an issued tax invoice can be fulfilled.',
      invalid_warehouse_or_reference: 'The selected warehouse is no longer available.',
      fulfillment_conflict: 'This invoice has already been fulfilled.',
      insufficient_stock_or_not_fulfillable: 'Fulfilment failed. Check stock availability and stock-backed invoice lines.',
      fulfillment_or_line_not_found: 'The selected fulfilment line is no longer available.',
      return_idempotency_conflict: 'This return request conflicts with an earlier request.',
      return_quantity_not_allowed: 'A return quantity exceeds the quantity still eligible to be returned.',
      return_or_source_line_not_found: 'The selected return or return line is no longer available.',
      credit_note_idempotency_conflict: 'This credit-note request conflicts with an earlier request.',
      credit_quantity_not_allowed: 'A credit quantity exceeds the returned quantity still eligible for financial credit.',
    }
    return messages[error.code] ?? `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

export function InvoiceFulfillmentPanel({ organizationId, documentId, documentStatus, hasStockLines, onChanged }: InvoiceFulfillmentPanelProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null)
  const [fulfillmentLines, setFulfillmentLines] = useState<FulfillmentLine[]>([])
  const [returns, setReturns] = useState<SalesReturn[]>([])
  const [returnLines, setReturnLines] = useState<SalesReturnLine[]>([])
  const [creditLinks, setCreditLinks] = useState<ReturnCreditLink[]>([])
  const [creditAllocations, setCreditAllocations] = useState<ReturnCreditAllocation[]>([])
  const [creditDocuments, setCreditDocuments] = useState<ReturnCreditDocument[]>([])
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [returnReason, setReturnReason] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [creditReturnId, setCreditReturnId] = useState<string | null>(null)
  const [creditQuantities, setCreditQuantities] = useState<Record<string, string>>({})
  const [creditDate, setCreditDate] = useState(localIsoDate())
  const [creditSeries, setCreditSeries] = useState('CRN')
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [warehouseResponse, fulfillmentResponse] = await Promise.all([
        apiFetch<ListResponse<Warehouse>>(`/v1/inventory/warehouses?organizationId=${encodeURIComponent(organizationId)}`),
        apiFetch<FulfillmentResponse>(`/v1/financial-documents/${encodeURIComponent(documentId)}/fulfillment?organizationId=${encodeURIComponent(organizationId)}`),
      ])
      setWarehouses(warehouseResponse.data)
      setFulfillment(fulfillmentResponse.data)
      setFulfillmentLines(fulfillmentResponse.lines ?? [])
      setWarehouseId((current) => current || warehouseResponse.data[0]?.id || '')

      if (fulfillmentResponse.data) {
        const returnResponse = await apiFetch<ReturnHistoryResponse>(
          `/v1/financial-documents/fulfillments/${encodeURIComponent(fulfillmentResponse.data.id)}/returns?organizationId=${encodeURIComponent(organizationId)}`,
        )
        setReturns(returnResponse.data)
        setReturnLines(returnResponse.lines)

        const creditResponses = await Promise.all(returnResponse.data.map((salesReturn) => apiFetch<CreditHistoryResponse>(
          `/v1/financial-documents/returns/${encodeURIComponent(salesReturn.id)}/credits?organizationId=${encodeURIComponent(organizationId)}`,
        )))
        setCreditLinks(creditResponses.flatMap((response) => response.data))
        setCreditAllocations(creditResponses.flatMap((response) => response.allocations))
        setCreditDocuments(creditResponses.flatMap((response) => response.documents))
      } else {
        setReturns([])
        setReturnLines([])
        setCreditLinks([])
        setCreditAllocations([])
        setCreditDocuments([])
      }
      setError(null)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [documentId, organizationId])

  useEffect(() => { void load() }, [load])

  const fulfillmentWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === fulfillment?.warehouse_id),
    [fulfillment, warehouses],
  )

  function openPrint() {
    const url = `/financial-documents/${encodeURIComponent(documentId)}/print?organizationId=${encodeURIComponent(organizationId)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function fulfill() {
    if (!warehouseId || posting) return
    if (!window.confirm('Fulfil this invoice from the selected warehouse? All stock-backed lines post atomically.')) return
    setPosting(true); setError(null)
    try {
      await apiFetch(`/v1/financial-documents/${documentId}/fulfill`, {
        method: 'POST',
        body: JSON.stringify({ organizationId, warehouseId, requestKey: `web-fulfill-${documentId}-${crypto.randomUUID()}` }),
      })
      await load(); await onChanged()
    } catch (caught) { setError(friendlyError(caught)) } finally { setPosting(false) }
  }

  async function postReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fulfillment || posting) return
    const lines = fulfillmentLines.map((line) => ({
      fulfillmentLineId: line.financial_document_line_id,
      quantity: returnQuantities[line.financial_document_line_id]?.trim() ?? '',
    })).filter((line) => line.quantity !== '')
    const parsed = returnSalesFulfillmentSchema.safeParse({
      organizationId, fulfillmentId: fulfillment.id, lines, reason: returnReason,
      requestKey: `web-return-${fulfillment.id}-${crypto.randomUUID()}`,
    })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the return quantities and reason.'); return }
    if (!window.confirm('Post this sales return? Returned stock will be added back through an immutable return movement.')) return
    setPosting(true); setError(null)
    try {
      await apiFetch(`/v1/financial-documents/fulfillments/${encodeURIComponent(fulfillment.id)}/returns`, { method: 'POST', body: JSON.stringify(parsed.data) })
      setReturnQuantities({}); setReturnReason(''); setShowReturnForm(false)
      await load(); await onChanged()
    } catch (caught) { setError(friendlyError(caught)) } finally { setPosting(false) }
  }

  function openCreditForm(salesReturnId: string) {
    setCreditReturnId((current) => current === salesReturnId ? null : salesReturnId)
    setCreditQuantities({})
    setCreditDate(localIsoDate())
    setCreditSeries('CRN')
    setError(null)
  }

  async function issueReturnCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!creditReturnId || posting) return
    const lines = returnLines.filter((line) => line.return_id === creditReturnId).map((line) => ({
      fulfillmentLineId: line.fulfillment_line_id,
      quantity: creditQuantities[line.fulfillment_line_id]?.trim() ?? '',
    })).filter((line) => line.quantity !== '')
    const parsed = issueSalesReturnCreditNoteSchema.safeParse({
      organizationId,
      salesReturnId: creditReturnId,
      lines,
      documentDate: creditDate,
      seriesCode: creditSeries,
      requestKey: `web-return-credit-${creditReturnId}-${crypto.randomUUID()}`,
    })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the credit-note quantities.'); return }
    if (!window.confirm('Issue this GST credit note from the selected returned quantities? The document will be issued immediately and becomes immutable.')) return
    setPosting(true); setError(null)
    try {
      await apiFetch(`/v1/financial-documents/returns/${encodeURIComponent(creditReturnId)}/credit-note`, { method: 'POST', body: JSON.stringify(parsed.data) })
      setCreditReturnId(null); setCreditQuantities({})
      await load(); await onChanged()
    } catch (caught) { setError(friendlyError(caught)) } finally { setPosting(false) }
  }

  if (loading) return <div className="invoice-fulfillment"><span className="muted">Loading fulfilment…</span></div>

  if (fulfillment) {
    return (
      <>
        <div className="invoice-fulfillment fulfilled">
          <div className="invoice-fulfillment-return-stack">
            <div className="invoice-fulfillment-return-header">
              <div><span className="eyebrow">Stock fulfilment</span><strong>Fulfilled</strong><small>{fulfillmentWarehouse ? `${fulfillmentWarehouse.code} · ${fulfillmentWarehouse.name}` : 'Warehouse'} · {new Date(fulfillment.posted_at).toLocaleString()}</small></div>
              <div className="invoice-fulfillment-actions">
                <span className="status-pill neutral">stock posted</span>
                {documentStatus !== 'draft' ? <button className="secondary-button" type="button" onClick={openPrint}>Print / Save PDF</button> : null}
              </div>
            </div>

            <div className="invoice-return-history">
              <div className="invoice-fulfillment-return-header">
                <div><strong>Sales returns</strong><small>{returns.length === 0 ? 'No stock has been returned.' : `${returns.length} immutable return record${returns.length === 1 ? '' : 's'}.`}</small></div>
                {documentStatus === 'issued' && fulfillmentLines.length > 0 ? <button className="secondary-button" type="button" onClick={() => setShowReturnForm((current) => !current)} disabled={posting}>{showReturnForm ? 'Close return' : 'Record return'}</button> : null}
              </div>

              {returns.map((salesReturn) => {
                const sourceLines = returnLines.filter((line) => line.return_id === salesReturn.id)
                const links = creditLinks.filter((link) => link.sales_return_id === salesReturn.id)
                return (
                  <div className="invoice-return-record" key={salesReturn.id}>
                    <span>
                      <strong>{salesReturn.reason}</strong>
                      <small>{new Date(salesReturn.posted_at).toLocaleString()}</small>
                      {sourceLines.map((line) => <small key={`${salesReturn.id}-${line.fulfillment_line_id}`}>Returned {String(line.quantity)} · line {line.fulfillment_line_id.slice(0, 8)}</small>)}
                    </span>
                    <span>
                      {links.length === 0 ? <small>No financial credit issued.</small> : links.map((link) => {
                        const doc = creditDocuments.find((entry) => entry.id === link.credit_note_id)
                        const allocations = creditAllocations.filter((entry) => entry.credit_note_id === link.credit_note_id)
                        return <small key={link.id}>{doc?.document_number ?? 'Credit note'} · {doc?.status ?? 'unknown'} · {doc?.currency_code ?? ''} {doc ? String(doc.grand_total) : ''} · qty {allocations.map((entry) => String(entry.quantity)).join(', ')}</small>
                      })}
                      <button className="text-button" type="button" onClick={() => openCreditForm(salesReturn.id)} disabled={posting}>{creditReturnId === salesReturn.id ? 'Close credit' : 'Issue credit note'}</button>
                    </span>

                    {creditReturnId === salesReturn.id ? (
                      <form className="invoice-return-form" onSubmit={issueReturnCredit}>
                        <p className="muted">Enter only the returned quantities to credit now. Existing active credits remain reserved; PostgreSQL rejects over-crediting.</p>
                        {sourceLines.map((line) => (
                          <label key={`credit-${line.fulfillment_line_id}`}>
                            Returned line {line.fulfillment_line_id.slice(0, 8)} · returned {String(line.quantity)}
                            <input inputMode="decimal" placeholder="Quantity to credit" value={creditQuantities[line.fulfillment_line_id] ?? ''} onChange={(event) => setCreditQuantities((current) => ({ ...current, [line.fulfillment_line_id]: event.target.value }))} />
                          </label>
                        ))}
                        <label>Credit note date<input type="date" required value={creditDate} onChange={(event) => setCreditDate(event.target.value)} /></label>
                        <label>Series<input required maxLength={8} value={creditSeries} onChange={(event) => setCreditSeries(event.target.value)} /></label>
                        <p className="muted">Seller, buyer, item, price, discount and GST rates are copied from the original issued invoice. This credit note is issued immediately.</p>
                        <button className="primary-button" type="submit" disabled={posting}>{posting ? 'Issuing credit…' : 'Issue return credit note'}</button>
                      </form>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {showReturnForm ? (
              <form className="invoice-return-form" onSubmit={postReturn}>
                <p className="muted">Enter only the quantities being returned now. The database rejects any amount above the still-returnable fulfilled quantity.</p>
                {fulfillmentLines.map((line) => <label key={line.financial_document_line_id}>Invoice line {line.financial_document_line_id.slice(0, 8)} · fulfilled {String(line.quantity)}<input inputMode="decimal" placeholder="Return quantity" value={returnQuantities[line.financial_document_line_id] ?? ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.financial_document_line_id]: event.target.value }))} /></label>)}
                <label>Return reason<textarea required maxLength={240} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label>
                <button className="primary-button" type="submit" disabled={posting}>{posting ? 'Posting return…' : 'Post sales return'}</button>
              </form>
            ) : null}
          </div>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
        </div>
        <InvoiceAdjustmentPanel organizationId={organizationId} documentId={documentId} documentStatus={documentStatus} onChanged={onChanged} />
      </>
    )
  }

  if (documentStatus === 'draft') return null

  return (
    <>
      <div className="invoice-fulfillment">
        <div>
          <span className="eyebrow">Document output</span>
          <strong>{documentStatus === 'cancelled' ? 'Cancelled document' : hasStockLines ? 'Ready to fulfil' : 'Issued non-stock document'}</strong>
          <small>{documentStatus === 'cancelled' ? 'The cancelled status and reason are preserved on the print view.' : hasStockLines ? 'All stock-backed lines post in one database transaction.' : 'This document has no stock-backed lines.'}</small>
        </div>
        <div className="invoice-fulfillment-actions">
          {documentStatus === 'issued' && hasStockLines ? (
            <>
              <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={posting || warehouses.length === 0}>
                {warehouses.length === 0 ? <option value="">No active warehouse</option> : null}
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
              </select>
              <button className="primary-button" type="button" disabled={posting || !warehouseId} onClick={() => void fulfill()}>{posting ? 'Fulfilling…' : 'Fulfil stock'}</button>
            </>
          ) : null}
          <button className="secondary-button" type="button" onClick={openPrint}>Print / Save PDF</button>
        </div>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
      </div>
      <InvoiceAdjustmentPanel organizationId={organizationId} documentId={documentId} documentStatus={documentStatus} onChanged={onChanged} />
    </>
  )
}
