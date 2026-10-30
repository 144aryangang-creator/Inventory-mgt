export type PrintTaxComponent = 'CGST' | 'SGST' | 'UTGST' | 'IGST' | 'CESS'

export type PrintFinancialDocument = {
  id: string
  document_type: 'tax_invoice' | 'credit_note' | 'debit_note'
  status: 'draft' | 'issued' | 'cancelled'
  document_date: string
  document_number: string | null
  linked_document_id: string | null
  currency_code: string
  supply_type: string
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
  grand_total: string | number
  notes: string | null
  issued_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
}

export type PrintFinancialDocumentLine = {
  id: string
  line_number: number
  item_id: string | null
  item_snapshot?: Record<string, unknown>
  description: string
  hsn_sac: string | null
  quantity: string | number
  uom: string
  unit_price: string | number
  discount_amount: string | number
  taxable_value: string | number
}

export type PrintFinancialDocumentTax = {
  line_id: string
  component: PrintTaxComponent
  rate: string | number
  amount: string | number
}

export type PrintFinancialDocumentDetail = {
  document: PrintFinancialDocument
  lines: PrintFinancialDocumentLine[]
  taxes: PrintFinancialDocumentTax[]
}

export type PrintLine = PrintFinancialDocumentLine & {
  taxes: PrintFinancialDocumentTax[]
}

export type FinancialDocumentPrintModel = {
  title: string
  documentNumber: string
  documentDate: string
  status: PrintFinancialDocument['status']
  linkedDocumentNumber: string | null
  currencyCode: string
  supplyType: string
  placeOfSupplyStateCode: string | null
  reverseCharge: boolean
  seller: Record<string, unknown>
  buyer: Record<string, unknown>
  shipping: Record<string, unknown>
  lines: PrintLine[]
  totals: {
    subtotal: string | number
    discount: string | number
    taxable: string | number
    cgst: string | number
    sgst: string | number
    utgst: string | number
    igst: string | number
    cess: string | number
    roundOff: string | number
    grandTotal: string | number
  }
  notes: string | null
  cancellationReason: string | null
}

export function documentTitle(type: PrintFinancialDocument['document_type']): string {
  if (type === 'credit_note') return 'Credit Note'
  if (type === 'debit_note') return 'Debit Note'
  return 'Tax Invoice'
}

export function snapshotText(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return null
}

export function snapshotAddress(snapshot: Record<string, unknown>): string[] {
  const locality = [snapshotText(snapshot, 'city'), snapshotText(snapshot, 'district')].filter(Boolean).join(', ')
  const statePostal = [snapshotText(snapshot, 'state_name'), snapshotText(snapshot, 'postal_code')].filter(Boolean).join(' - ')
  return [
    snapshotText(snapshot, 'address_line_1'),
    snapshotText(snapshot, 'address_line_2'),
    locality || null,
    statePostal || null,
    snapshotText(snapshot, 'country_code'),
  ].filter((value): value is string => Boolean(value))
}

export function buildFinancialDocumentPrintModel(
  detail: PrintFinancialDocumentDetail,
  linkedDocumentNumber: string | null = null,
): FinancialDocumentPrintModel {
  const taxesByLine = new Map<string, PrintFinancialDocumentTax[]>()
  for (const tax of detail.taxes) {
    const current = taxesByLine.get(tax.line_id) ?? []
    current.push(tax)
    taxesByLine.set(tax.line_id, current)
  }

  return {
    title: documentTitle(detail.document.document_type),
    documentNumber: detail.document.document_number ?? 'UNISSUED',
    documentDate: detail.document.document_date,
    status: detail.document.status,
    linkedDocumentNumber,
    currencyCode: detail.document.currency_code,
    supplyType: detail.document.supply_type,
    placeOfSupplyStateCode: detail.document.place_of_supply_state_code,
    reverseCharge: detail.document.reverse_charge,
    seller: detail.document.supplier_snapshot,
    buyer: detail.document.bill_to_snapshot,
    shipping: detail.document.ship_to_snapshot,
    lines: detail.lines.map((line) => ({ ...line, taxes: taxesByLine.get(line.id) ?? [] })),
    totals: {
      subtotal: detail.document.subtotal,
      discount: detail.document.discount_total,
      taxable: detail.document.taxable_total,
      cgst: detail.document.cgst_total,
      sgst: detail.document.sgst_total,
      utgst: detail.document.utgst_total,
      igst: detail.document.igst_total,
      cess: detail.document.cess_total,
      roundOff: detail.document.round_off,
      grandTotal: detail.document.grand_total,
    },
    notes: detail.document.notes,
    cancellationReason: detail.document.cancellation_reason,
  }
}
