import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { ApiError, apiFetch } from '../lib/api'
import {
  buildFinancialDocumentPrintModel,
  snapshotAddress,
  snapshotText,
  type PrintFinancialDocumentDetail,
} from '../invoices/print-model'
import '../print-financial-document.css'

type DetailResponse = { data: PrintFinancialDocumentDetail; requestId: string }

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'document_not_found') return 'Financial document not found.'
    if (error.code === 'forbidden') return 'You do not have access to this financial document.'
    return `Request failed (${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
  }
  return error instanceof Error ? error.message : 'Request failed'
}

function SnapshotBlock({ title, snapshot, taxKey }: { title: string; snapshot: Record<string, unknown>; taxKey: string }) {
  const name = snapshotText(snapshot, 'legal_name') ?? snapshotText(snapshot, 'recipient_name') ?? snapshotText(snapshot, 'display_name') ?? '—'
  const gstin = snapshotText(snapshot, taxKey)
  const address = snapshotAddress(snapshot)
  return (
    <section className="print-party-block">
      <h3>{title}</h3>
      <strong>{name}</strong>
      {address.map((part, index) => <span key={`${title}-${index}`}>{part}</span>)}
      <span><b>GSTIN:</b> {gstin ?? 'Unregistered'}</span>
      {snapshotText(snapshot, 'phone') ? <span><b>Phone:</b> {snapshotText(snapshot, 'phone')}</span> : null}
      {snapshotText(snapshot, 'email') ? <span><b>Email:</b> {snapshotText(snapshot, 'email')}</span> : null}
    </section>
  )
}

export function FinancialDocumentPrintPage() {
  const { documentId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const organizationId = searchParams.get('organizationId') ?? ''
  const [detail, setDetail] = useState<PrintFinancialDocumentDetail | null>(null)
  const [linkedDocumentNumber, setLinkedDocumentNumber] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId || !organizationId) {
      setError('Missing financial document or organization reference.')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const response = await apiFetch<DetailResponse>(
          `/v1/financial-documents/${encodeURIComponent(documentId)}?organizationId=${encodeURIComponent(organizationId)}`,
        )
        if (cancelled) return
        setDetail(response.data)

        const linkedId = response.data.document.linked_document_id
        if (linkedId) {
          const linked = await apiFetch<DetailResponse>(
            `/v1/financial-documents/${encodeURIComponent(linkedId)}?organizationId=${encodeURIComponent(organizationId)}`,
          )
          if (!cancelled) setLinkedDocumentNumber(linked.data.document.document_number ?? null)
        } else {
          setLinkedDocumentNumber(null)
        }
      } catch (caught) {
        if (!cancelled) setError(friendlyError(caught))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [documentId, organizationId])

  const model = useMemo(
    () => detail ? buildFinancialDocumentPrintModel(detail, linkedDocumentNumber) : null,
    [detail, linkedDocumentNumber],
  )

  if (loading) return <main className="print-document-state">Loading document…</main>
  if (error || !model) return <main className="print-document-state error-message">{error ?? 'Document unavailable.'}</main>
  if (model.status === 'draft') return <main className="print-document-state">Draft documents are not printable. Issue the document first.</main>

  const shippingHasAddress = snapshotAddress(model.shipping).length > 0

  return (
    <main className="print-document-page">
      <div className="print-toolbar no-print">
        <button className="secondary-button" type="button" onClick={() => window.close()}>Close</button>
        <button className="primary-button" type="button" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <article className="financial-document-sheet">
        <header className="print-document-header">
          <div>
            <span className="print-kicker">{model.status === 'cancelled' ? 'CANCELLED · ' : ''}{model.title}</span>
            <h1>{model.documentNumber}</h1>
          </div>
          <dl>
            <div><dt>Date</dt><dd>{model.documentDate}</dd></div>
            <div><dt>Supply</dt><dd>{model.supplyType.replaceAll('_', ' ')}</dd></div>
            <div><dt>Place of supply</dt><dd>{model.placeOfSupplyStateCode ?? '—'}</dd></div>
            <div><dt>Reverse charge</dt><dd>{model.reverseCharge ? 'Yes' : 'No'}</dd></div>
            {model.linkedDocumentNumber ? <div><dt>Original invoice</dt><dd>{model.linkedDocumentNumber}</dd></div> : null}
          </dl>
        </header>

        {model.status === 'cancelled' ? (
          <div className="print-cancelled-banner">CANCELLED{model.cancellationReason ? ` · ${model.cancellationReason}` : ''}</div>
        ) : null}

        <div className="print-party-grid">
          <SnapshotBlock title="Supplier" snapshot={model.seller} taxKey="gstin" />
          <SnapshotBlock title="Bill To" snapshot={model.buyer} taxKey="tax_registration_number" />
          {shippingHasAddress ? <SnapshotBlock title="Ship To" snapshot={model.shipping} taxKey="tax_registration_number" /> : null}
        </div>

        <table className="print-line-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th>HSN/SAC</th>
              <th className="number-cell">Qty</th>
              <th>UOM</th>
              <th className="number-cell">Rate</th>
              <th className="number-cell">Discount</th>
              <th className="number-cell">Taxable</th>
              <th>Tax</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.line_number}</td>
                <td>{line.description}</td>
                <td>{line.hsn_sac ?? '—'}</td>
                <td className="number-cell">{String(line.quantity)}</td>
                <td>{line.uom}</td>
                <td className="number-cell">{String(line.unit_price)}</td>
                <td className="number-cell">{String(line.discount_amount)}</td>
                <td className="number-cell">{String(line.taxable_value)}</td>
                <td>{line.taxes.length ? line.taxes.map((tax) => `${tax.component} ${String(tax.rate)}%: ${String(tax.amount)}`).join(' · ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="print-totals">
          <div><span>Subtotal</span><strong>{model.currencyCode} {String(model.totals.subtotal)}</strong></div>
          <div><span>Discount</span><strong>{model.currencyCode} {String(model.totals.discount)}</strong></div>
          <div><span>Taxable value</span><strong>{model.currencyCode} {String(model.totals.taxable)}</strong></div>
          {String(model.totals.cgst) !== '0' && String(model.totals.cgst) !== '0.000000' ? <div><span>CGST</span><strong>{model.currencyCode} {String(model.totals.cgst)}</strong></div> : null}
          {String(model.totals.sgst) !== '0' && String(model.totals.sgst) !== '0.000000' ? <div><span>SGST</span><strong>{model.currencyCode} {String(model.totals.sgst)}</strong></div> : null}
          {String(model.totals.utgst) !== '0' && String(model.totals.utgst) !== '0.000000' ? <div><span>UTGST</span><strong>{model.currencyCode} {String(model.totals.utgst)}</strong></div> : null}
          {String(model.totals.igst) !== '0' && String(model.totals.igst) !== '0.000000' ? <div><span>IGST</span><strong>{model.currencyCode} {String(model.totals.igst)}</strong></div> : null}
          {String(model.totals.cess) !== '0' && String(model.totals.cess) !== '0.000000' ? <div><span>CESS</span><strong>{model.currencyCode} {String(model.totals.cess)}</strong></div> : null}
          {String(model.totals.roundOff) !== '0' && String(model.totals.roundOff) !== '0.000000' ? <div><span>Round off</span><strong>{model.currencyCode} {String(model.totals.roundOff)}</strong></div> : null}
          <div className="print-grand-total"><span>Grand Total</span><strong>{model.currencyCode} {String(model.totals.grandTotal)}</strong></div>
        </section>

        {model.notes ? <section className="print-notes"><strong>Notes</strong><p>{model.notes}</p></section> : null}
        <footer className="print-footer">Generated from immutable issued financial-document snapshots and PostgreSQL-authoritative totals.</footer>
      </article>
    </main>
  )
}
