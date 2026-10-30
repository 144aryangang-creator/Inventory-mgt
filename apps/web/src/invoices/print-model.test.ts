import { describe, expect, it } from 'vitest'
import {
  buildFinancialDocumentPrintModel,
  documentTitle,
  snapshotAddress,
  type PrintFinancialDocumentDetail,
} from './print-model'

const detail: PrintFinancialDocumentDetail = {
  document: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    document_type: 'credit_note',
    status: 'issued',
    document_date: '2026-10-30',
    document_number: 'CRN/2026-27/000001',
    linked_document_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    currency_code: 'INR',
    supply_type: 'intra_state',
    supplier_state_code: '23',
    place_of_supply_state_code: '23',
    reverse_charge: false,
    supplier_snapshot: {
      legal_name: 'Seller Private Limited',
      gstin: '23ABCDE1234F1Z5',
      address_line_1: '1 Seller Road',
      city: 'Bhopal',
      state_name: 'Madhya Pradesh',
      postal_code: '462001',
      country_code: 'IN',
    },
    bill_to_snapshot: {
      legal_name: 'Buyer Private Limited',
      tax_registration_number: '23ABCDE1234F1Z5',
      address_line_1: '2 Buyer Road',
      city: 'Bhopal',
      state_name: 'Madhya Pradesh',
      postal_code: '462002',
      country_code: 'IN',
    },
    ship_to_snapshot: {},
    subtotal: '100.000000',
    discount_total: '5.000000',
    taxable_total: '95.000000',
    cgst_total: '8.550000',
    sgst_total: '8.550000',
    utgst_total: '0.000000',
    igst_total: '0.000000',
    cess_total: '0.000000',
    round_off: '0.000000',
    grand_total: '112.100000',
    notes: 'Return credit',
    issued_at: '2026-10-30T00:00:00Z',
    cancelled_at: null,
    cancellation_reason: null,
  },
  lines: [{
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    line_number: 1,
    item_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    item_snapshot: { sku: 'ITEM-1', name: 'Item One' },
    description: 'Item One',
    hsn_sac: '8708',
    quantity: '1',
    uom: 'EA',
    unit_price: '100',
    discount_amount: '5',
    taxable_value: '95',
  }],
  taxes: [
    { line_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', component: 'CGST', rate: '9', amount: '8.55' },
    { line_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', component: 'SGST', rate: '9', amount: '8.55' },
  ],
}

describe('financial document print model', () => {
  it('labels each supported financial document type', () => {
    expect(documentTitle('tax_invoice')).toBe('Tax Invoice')
    expect(documentTitle('credit_note')).toBe('Credit Note')
    expect(documentTitle('debit_note')).toBe('Debit Note')
  })

  it('groups immutable tax rows under their source line', () => {
    const model = buildFinancialDocumentPrintModel(detail, 'INV/2026-27/000001')
    expect(model.lines[0]?.taxes.map((tax) => tax.component)).toEqual(['CGST', 'SGST'])
    expect(model.totals.grandTotal).toBe('112.100000')
  })

  it('preserves linked original document number for correction documents', () => {
    const model = buildFinancialDocumentPrintModel(detail, 'INV/2026-27/000001')
    expect(model.title).toBe('Credit Note')
    expect(model.linkedDocumentNumber).toBe('INV/2026-27/000001')
  })

  it('formats snapshot address parts without inventing missing values', () => {
    expect(snapshotAddress(detail.document.supplier_snapshot)).toEqual([
      '1 Seller Road',
      'Bhopal',
      'Madhya Pradesh - 462001',
      'IN',
    ])
    expect(snapshotAddress({})).toEqual([])
  })
})
