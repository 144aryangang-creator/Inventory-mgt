import {
  issueSalesReturnCreditNoteSchema,
  postSalesFulfillmentSchema,
  returnSalesFulfillmentSchema,
} from '@inventory/contracts/sales-fulfillment'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { InvoiceAdjustmentPanel } from './InvoiceAdjustmentPanel'

type Warehouse = { id: string; code: string; name: string; is_active: boolean }
type FinancialDocumentType = 'tax_invoice' | 'credit_note' | 'debit_note'
type FulfillmentStatus = 'not_applicable' | 'unfulfilled' | 'partial' | 'fulfilled'
type FulfillmentSummaryLine = {
  financialDocumentLineId: string
  lineNumber: number
  itemId: string
  description: string
  uom: string
  invoicedQuantity: string | number
  fulfilledQuantity: string | number
  remainingQuantity: string | number
}
type FulfillmentSummary = {
  financialDocumentId: string
  documentStatus: 'draft' | 'issued' | 'cancelled'
  status: FulfillmentStatus
  stockLineCount: number
  lines: FulfillmentSummaryLine[]
}
type Fulfillment = {
  id: string
  financial_document_id: string
  warehouse_id: string
  request_key: string
  request_payload: unknown
  posted_at: string
  created_by: string
}
type FulfillmentLine = {
  fulfillment_id: string
  financial_document_line_id: string
  item_id: string
  inventory_movement_id: string
  quantity: string | number
  created_at: string
}
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
type FulfillmentHistoryResponse = { summary: FulfillmentSummary; data: Fulfillment[]; lines: FulfillmentLine[]; requestId: string }
type ReturnHistoryResponse = { data: SalesReturn[]; lines: SalesReturnLine[]; requestId: string }
type CreditHistoryResponse = { data: ReturnCreditLink[]; allocations: ReturnCreditAllocation[]; documents: ReturnCreditDocument[]; requestId: string }
type DocumentTypeResponse = { data: { document: { document_type: FinancialDocumentType } }; requestId: string }

function localIsoDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function decimalIsZero(value: string | number): boolean {
  return /^0+(?:\.0+)?$/.test(String(value).trim())
}

function fulfillmentStatusLabel(status: FulfillmentStatus): string {
  if (status === 'not_applicable') return 'No stock posting'
  if (status === 'unfulfilled') return 'Unfulfilled'
  if (status === 'partial') return 'Partially fulfilled'
  return 'Fulfilled'
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      forbidden: 'Your role does not allow this stock or credit action.',
      invoice_not_found: 'The tax invoice is no longer available.',
      issued_invoice_not_found: 'Only an issued tax invoice can be fulfilled.',
      issued_invoice_or_line_not_found: 'The issued invoice or selected invoice line is no longer available.',
      invalid_warehouse_or_reference: 'The selected warehouse is no longer available.',
      fulfillment_conflict: 'This legacy fulfillment request conflicts with an earlier request.',
      fulfillment_idempotency_conflict: 'This fulfillment request key conflicts with an earlier posting.',
      fulfillment_quantity_not_allowed_or_insufficient_stock: 'Fulfillment failed. Check remaining invoice quantity and warehouse stock.',
      insufficient_stock_or_not_fulfillable: 'Fulfillment failed. Check remaining quantity and stock availability.',
      multiple_fulfillments_use_plural_endpoint: 'This invoice has multiple fulfillment postings. Reload the invoice to view full history.',
      fulfillment_or_line_not_found: 'The selected fulfillment line is no longer available.',
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
  const [documentType, setDocumentType] = useState<FinancialDocumentType | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [summary, setSummary] = useState<FulfillmentSummary | null>(null)
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([])
  const [fulfillmentLines, setFulfillmentLines] = useState<FulfillmentLine[]>([])
  const [fulfillmentQuantities, setFulfillmentQuantities] = useState<Record<string, string>>({})
  const [showFulfillmentForm, setShowFulfillmentForm] = useState(false)
  const [returns, setReturns] = useState<SalesReturn[]>([])
  const [returnLines, setReturnLines] = useState<SalesReturnLine[]>([])
  const [returnFulfillmentId, setReturnFulfillmentId] = useState<string | null>(null)
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [returnReason, setReturnReason] = useState('')
  const [creditLinks, setCreditLinks] = useState<ReturnCreditLink[]>([])
  const [creditAllocations, setCreditAllocations] = useState<ReturnCreditAllocation[]>([])
  const [creditDocuments, setCreditDocuments] = useState<ReturnCreditDocument[]>([])
  const [creditReturnId, setCreditReturnId] = useState<string | null>(null)
  const [creditQuantities, setCreditQuantities] = useState<Record<string, string>>({})
  const [creditDate, setCreditDate] = useState(localIsoDate())
  const [creditSeries, setCreditSeries] = useState('CRN')
  const [loading, setLoading] = useState(documentStatus !== 'draft')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses])

  const load = useCallback(async () => {
    if (documentStatus === 'draft') {
      setDocumentType(null)
      setSummary(null)
      setFulfillments([])
      setFulfillmentLines([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const detail = await apiFetch<DocumentTypeResponse>(
        `/v1/financial-documents/${encodeURIComponent(documentId)}?organizationId=${encodeURIComponent(organizationId)}`,
      )
      const nextDocumentType = detail.data.document.document_type
      setDocumentType(nextDocumentType)

      if (nextDocumentType !== 'tax_invoice') {
        setSummary(null)
        setFulfillments([])
        setFulfillmentLines([])
        setReturns([])
        setReturnLines([])
        setCreditLinks([])
        setCreditAllocations([])
        setCreditDocuments([])
        setError(null)
        return
      }

      const [warehouseResponse, fulfillmentResponse] = await Promise.all([
        apiFetch<ListResponse<Warehouse>>(`/v1/inventory/warehouses?organizationId=${encodeURIComponent(organizationId)}`),
        apiFetch<FulfillmentHistoryResponse>(
          `/v1/financial-documents/${encodeURIComponent(documentId)}/fulfillments?organizationId=${encodeURIComponent(organizationId)}`,
        ),
      ])

      setWarehouses(warehouseResponse.data)
      setWarehouseId((current) => current || warehouseResponse.data[0]?.id || '')
      setSummary(fulfillmentResponse.summary)
      setFulfillments(fulfillmentResponse.data)
      setFulfillmentLines(fulfillmentResponse.lines)

      const returnResponses = await Promise.all(fulfillmentResponse.data.map((fulfillment) => apiFetch<ReturnHistoryResponse>(
        `/v1/financial-documents/fulfillments/${encodeURIComponent(fulfillment.id)}/returns?organizationId=${encodeURIComponent(organizationId)}`,
      )))
      const nextReturns = returnResponses.flatMap((response) => response.data)
      setReturns(nextReturns)
      setReturnLines(returnResponses.flatMap((response) => response.lines))

      const creditResponses = await Promise.all(nextReturns.map((salesReturn) => apiFetch<CreditHistoryResponse>(
        `/v1/financial-documents/returns/${encodeURIComponent(salesReturn.id)}/credits?organizationId=${encodeURIComponent(organizationId)}`,
      )))
      setCreditLinks(creditResponses.flatMap((response) => response.data))
      setCreditAllocations(creditResponses.flatMap((response) => response.allocations))
      setCreditDocuments(creditResponses.flatMap((response) => response.documents))
      setError(null)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }, [documentId, documentStatus, organizationId])

  useEffect(() => { void load() }, [load])

  function openPrint(documentToPrint = documentId) {
    const url = `/financial-documents/${encodeURIComponent(documentToPrint)}/print?organizationId=${encodeURIComponent(organizationId)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function postFulfillment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!summary || posting) return

    const lines = summary.lines
      .map((line) => ({
        financialDocumentLineId: line.financialDocumentLineId,
        quantity: fulfillmentQuantities[line.financialDocumentLineId]?.trim() ?? '',
      }))
      .filter((line) => line.quantity !== '')

    const parsed = postSalesFulfillmentSchema.safeParse({
      organizationId,
      documentId,
      warehouseId,
      lines,
      requestKey: `web-fulfill-${documentId}-${crypto.randomUUID()}`,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the warehouse and fulfillment quantities.')
      return
    }
    if (!window.confirm('Post this fulfillment? The selected quantities will leave the chosen warehouse through immutable sale movements.')) return

    setPosting(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/${encodeURIComponent(documentId)}/fulfillments`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setFulfillmentQuantities({})
      setShowFulfillmentForm(false)
      await load()
      await onChanged()
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setPosting(false)
    }
  }

  function openReturnForm(fulfillmentId: string) {
    setReturnFulfillmentId((current) => current === fulfillmentId ? null : fulfillmentId)
    setReturnQuantities({})
    setReturnReason('')
    setError(null)
  }

  async function postReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!returnFulfillmentId || posting) return

    const sourceLines = fulfillmentLines.filter((line) => line.fulfillment_id === returnFulfillmentId)
    const lines = sourceLines
      .map((line) => ({
        fulfillmentLineId: line.financial_document_line_id,
        quantity: returnQuantities[line.financial_document_line_id]?.trim() ?? '',
      }))
      .filter((line) => line.quantity !== '')

    const parsed = returnSalesFulfillmentSchema.safeParse({
      organizationId,
      fulfillmentId: returnFulfillmentId,
      lines,
      reason: returnReason,
      requestKey: `web-return-${returnFulfillmentId}-${crypto.randomUUID()}`,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the return quantities and reason.')
      return
    }
    if (!window.confirm('Post this sales return? Stock will return to the warehouse used by this exact fulfillment posting.')) return

    setPosting(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/fulfillments/${encodeURIComponent(returnFulfillmentId)}/returns`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setReturnFulfillmentId(null)
      setReturnQuantities({})
      setReturnReason('')
      await load()
      await onChanged()
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setPosting(false)
    }
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

    const lines = returnLines
      .filter((line) => line.return_id === creditReturnId)
      .map((line) => ({
        fulfillmentLineId: line.fulfillment_line_id,
        quantity: creditQuantities[line.fulfillment_line_id]?.trim() ?? '',
      }))
      .filter((line) => line.quantity !== '')

    const parsed = issueSalesReturnCreditNoteSchema.safeParse({
      organizationId,
      salesReturnId: creditReturnId,
      lines,
      documentDate: creditDate,
      seriesCode: creditSeries,
      requestKey: `web-return-credit-${creditReturnId}-${crypto.randomUUID()}`,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the credit-note quantities.')
      return
    }
    if (!window.confirm('Issue this GST credit note from the selected returned quantities? It will be issued immediately and become immutable.')) return

    setPosting(true)
    setError(null)
    try {
      await apiFetch(`/v1/financial-documents/returns/${encodeURIComponent(creditReturnId)}/credit-note`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setCreditReturnId(null)
      setCreditQuantities({})
      await load()
      await onChanged()
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setPosting(false)
    }
  }

  if (documentStatus === 'draft') return null
  if (loading) return <div className="invoice-fulfillment"><span className="muted">Loading document operations…</span></div>

  if (documentType !== 'tax_invoice') {
    return (
      <div className="invoice-fulfillment">
        <div><span className="eyebrow">Document output</span><strong>{documentStatus === 'cancelled' ? 'Cancelled correction document' : 'Issued correction document'}</strong><small>Credit/debit notes do not post inventory directly.</small></div>
        <button className="secondary-button" type="button" onClick={() => openPrint()}>Print / Save PDF</button>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
      </div>
    )
  }

  const canPostFulfillment = documentStatus === 'issued'
    && summary !== null
    && summary.status !== 'fulfilled'
    && summary.status !== 'not_applicable'

  return (
    <>
      <div className={`invoice-fulfillment ${summary?.status === 'fulfilled' ? 'fulfilled' : ''}`}>
        <div className="invoice-fulfillment-return-stack">
          <div className="invoice-fulfillment-return-header">
            <div>
              <span className="eyebrow">Stock fulfillment</span>
              <strong>{summary ? fulfillmentStatusLabel(summary.status) : hasStockLines ? 'Stock-backed invoice' : 'No stock posting'}</strong>
              <small>{summary?.status === 'partial' ? 'More than one warehouse/posting may complete the remaining quantities.' : summary?.status === 'fulfilled' ? 'All stock-backed invoice quantities have been posted.' : summary?.status === 'not_applicable' ? 'No tracked inventory lines require fulfillment.' : 'No stock has been posted yet.'}</small>
            </div>
            <div className="invoice-fulfillment-actions">
              {summary ? <span className="status-pill neutral">{summary.status.replace('_', ' ')}</span> : null}
              {canPostFulfillment ? <button className="secondary-button" type="button" disabled={posting} onClick={() => setShowFulfillmentForm((current) => !current)}>{showFulfillmentForm ? 'Close posting' : 'Post fulfillment'}</button> : null}
              <button className="secondary-button" type="button" onClick={() => openPrint()}>Print / Save PDF</button>
            </div>
          </div>

          {showFulfillmentForm && canPostFulfillment && summary ? (
            <form className="invoice-return-form" onSubmit={postFulfillment}>
              <p className="muted">Choose one warehouse for this immutable posting and enter only the quantities shipping now. PostgreSQL enforces remaining invoice quantity and warehouse stock.</p>
              <label>Warehouse<select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={posting || warehouses.length === 0}>{warehouses.length === 0 ? <option value="">No active warehouse</option> : null}{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
              {summary.lines.filter((line) => !decimalIsZero(line.remainingQuantity)).map((line) => (
                <label key={line.financialDocumentLineId}>
                  {line.lineNumber}. {line.description} · invoiced {String(line.invoicedQuantity)} {line.uom} · fulfilled {String(line.fulfilledQuantity)} · remaining {String(line.remainingQuantity)}
                  <input inputMode="decimal" placeholder="Quantity shipping now" value={fulfillmentQuantities[line.financialDocumentLineId] ?? ''} onChange={(event) => setFulfillmentQuantities((current) => ({ ...current, [line.financialDocumentLineId]: event.target.value }))} />
                </label>
              ))}
              <button className="primary-button" type="submit" disabled={posting || !warehouseId}>{posting ? 'Posting…' : 'Post fulfillment'}</button>
            </form>
          ) : null}

          {fulfillments.length > 0 ? (
            <div className="invoice-return-history">
              <div><strong>Fulfillment history</strong><small>{fulfillments.length} immutable posting{fulfillments.length === 1 ? '' : 's'} across warehouse shipments.</small></div>
              {fulfillments.map((fulfillment) => {
                const warehouse = warehouseById.get(fulfillment.warehouse_id)
                const sourceLines = fulfillmentLines.filter((line) => line.fulfillment_id === fulfillment.id)
                const fulfillmentReturns = returns.filter((salesReturn) => salesReturn.fulfillment_id === fulfillment.id)
                return (
                  <article className="invoice-fulfillment-posting" key={fulfillment.id}>
                    <div className="invoice-fulfillment-return-header">
                      <div>
                        <strong>{warehouse ? `${warehouse.code} · ${warehouse.name}` : 'Warehouse'} </strong>
                        <small>{new Date(fulfillment.posted_at).toLocaleString()} · posting {fulfillment.id.slice(0, 8)}</small>
                      </div>
                      {documentStatus === 'issued' ? <button className="text-button" type="button" disabled={posting} onClick={() => openReturnForm(fulfillment.id)}>{returnFulfillmentId === fulfillment.id ? 'Close return' : 'Record return'}</button> : null}
                    </div>

                    <div className="invoice-fulfillment-line-list">
                      {sourceLines.map((line) => {
                        const sourceSummary = summary?.lines.find((entry) => entry.financialDocumentLineId === line.financial_document_line_id)
                        return <small key={`${fulfillment.id}-${line.financial_document_line_id}`}>{sourceSummary ? `${sourceSummary.lineNumber}. ${sourceSummary.description}` : `Line ${line.financial_document_line_id.slice(0, 8)}`} · shipped {String(line.quantity)} {sourceSummary?.uom ?? ''}</small>
                      })}
                    </div>

                    {returnFulfillmentId === fulfillment.id ? (
                      <form className="invoice-return-form" onSubmit={postReturn}>
                        <p className="muted">Enter quantities physically returned from this posting. Stock is restored to this posting's warehouse.</p>
                        {sourceLines.map((line) => {
                          const sourceSummary = summary?.lines.find((entry) => entry.financialDocumentLineId === line.financial_document_line_id)
                          return (
                            <label key={`return-${fulfillment.id}-${line.financial_document_line_id}`}>
                              {sourceSummary?.description ?? `Line ${line.financial_document_line_id.slice(0, 8)}`} · shipped {String(line.quantity)} {sourceSummary?.uom ?? ''}
                              <input inputMode="decimal" placeholder="Return quantity" value={returnQuantities[line.financial_document_line_id] ?? ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.financial_document_line_id]: event.target.value }))} />
                            </label>
                          )
                        })}
                        <label>Return reason<textarea required maxLength={240} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label>
                        <button className="primary-button" type="submit" disabled={posting}>{posting ? 'Posting return…' : 'Post sales return'}</button>
                      </form>
                    ) : null}

                    {fulfillmentReturns.length > 0 ? (
                      <div className="invoice-fulfillment-return-history">
                        {fulfillmentReturns.map((salesReturn) => {
                          const sourceReturnLines = returnLines.filter((line) => line.return_id === salesReturn.id)
                          const links = creditLinks.filter((link) => link.sales_return_id === salesReturn.id)
                          return (
                            <div className="invoice-return-record" key={salesReturn.id}>
                              <span>
                                <strong>{salesReturn.reason}</strong>
                                <small>{new Date(salesReturn.posted_at).toLocaleString()}</small>
                                {sourceReturnLines.map((line) => <small key={`${salesReturn.id}-${line.fulfillment_line_id}`}>Returned {String(line.quantity)} · invoice line {line.fulfillment_line_id.slice(0, 8)}</small>)}
                              </span>
                              <span>
                                {links.length === 0 ? <small>No financial credit issued.</small> : links.map((link) => {
                                  const creditDocument = creditDocuments.find((entry) => entry.id === link.credit_note_id)
                                  const allocations = creditAllocations.filter((entry) => entry.credit_note_id === link.credit_note_id)
                                  return (
                                    <small key={link.id}>
                                      {creditDocument?.document_number ?? 'Credit note'} · {creditDocument?.status ?? 'unknown'} · {creditDocument?.currency_code ?? ''} {creditDocument ? String(creditDocument.grand_total) : ''} · qty {allocations.map((entry) => String(entry.quantity)).join(', ')}
                                      {creditDocument ? <button className="text-button" type="button" onClick={() => openPrint(creditDocument.id)}>Print</button> : null}
                                    </small>
                                  )
                                })}
                                <button className="text-button" type="button" onClick={() => openCreditForm(salesReturn.id)} disabled={posting}>{creditReturnId === salesReturn.id ? 'Close credit' : 'Issue credit note'}</button>
                              </span>

                              {creditReturnId === salesReturn.id ? (
                                <form className="invoice-return-form" onSubmit={issueReturnCredit}>
                                  <p className="muted">Enter only returned quantities to credit now. PostgreSQL shares the active credit ceiling with commercial credits.</p>
                                  {sourceReturnLines.map((line) => (
                                    <label key={`credit-${salesReturn.id}-${line.fulfillment_line_id}`}>
                                      Returned invoice line {line.fulfillment_line_id.slice(0, 8)} · returned {String(line.quantity)}
                                      <input inputMode="decimal" placeholder="Quantity to credit" value={creditQuantities[line.fulfillment_line_id] ?? ''} onChange={(event) => setCreditQuantities((current) => ({ ...current, [line.fulfillment_line_id]: event.target.value }))} />
                                    </label>
                                  ))}
                                  <label>Credit note date<input type="date" required value={creditDate} onChange={(event) => setCreditDate(event.target.value)} /></label>
                                  <label>Series<input required maxLength={8} value={creditSeries} onChange={(event) => setCreditSeries(event.target.value.toUpperCase())} /></label>
                                  <button className="primary-button" type="submit" disabled={posting}>{posting ? 'Issuing credit…' : 'Issue return credit note'}</button>
                                </form>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : null}
        </div>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
      </div>

      <InvoiceAdjustmentPanel organizationId={organizationId} documentId={documentId} documentStatus={documentStatus} onChanged={onChanged} />
    </>
  )
}
