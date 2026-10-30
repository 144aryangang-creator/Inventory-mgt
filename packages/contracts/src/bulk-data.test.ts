import { describe, expect, it } from 'vitest'
import {
  CsvContractError,
  encodeSpreadsheetCsv,
  normalizeBulkCsv,
  parseVersionedCsv,
  spreadsheetSafeCsvCell,
} from './bulk-data'

describe('bulk CSV contracts', () => {
  it('parses quoted commas, quotes and line breaks without coercion', () => {
    const parsed = parseVersionedCsv(
      'sku,name,description,base_uom,track_inventory\r\nITEM-1,"Widget, Large","Line 1\nLine 2 ""quoted""",EA,true\r\n',
      'items',
    )
    expect(parsed.rows).toEqual([{
      sku: 'ITEM-1',
      name: 'Widget, Large',
      description: 'Line 1\nLine 2 "quoted"',
      base_uom: 'EA',
      track_inventory: 'true',
    }])
  })

  it('requires exact versioned headers and column counts', () => {
    expect(() => parseVersionedCsv('name,sku,description,base_uom,track_inventory\nA,B,,EA,true', 'items'))
      .toThrowError(CsvContractError)
    expect(() => parseVersionedCsv('sku,name,description,base_uom,track_inventory\nA,B,EA,true', 'items'))
      .toThrowError(CsvContractError)
  })

  it('rejects unclosed and mid-field quotes', () => {
    expect(() => parseVersionedCsv('sku,name,description,base_uom,track_inventory\nA,"broken,desc,EA,true', 'items'))
      .toThrowError(CsvContractError)
    expect(() => parseVersionedCsv('sku,name,description,base_uom,track_inventory\nA,ab"c,,EA,true', 'items'))
      .toThrowError(CsvContractError)
  })

  it('normalizes item rows and detects duplicate SKUs', () => {
    const valid = normalizeBulkCsv(
      'sku,name,description,base_uom,track_inventory\nabc,Item A,,ea,YES',
      'items',
    )
    expect(valid.issues).toEqual([])
    expect(valid.data).toEqual({ entity: 'items', rows: [{ sku: 'ABC', name: 'Item A', baseUom: 'EA', trackInventory: true }] })

    const duplicate = normalizeBulkCsv(
      'sku,name,description,base_uom,track_inventory\nabc,Item A,,EA,true\nABC,Item B,,EA,true',
      'items',
    )
    expect(duplicate.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_in_file', row: 3 })]))
  })

  it('normalizes customer email and rejects invalid email', () => {
    const valid = normalizeBulkCsv(
      'code,legal_name,display_name,email,phone\nc-1,Customer One,Customer One,USER@EXAMPLE.COM,123',
      'customers',
    )
    expect(valid.data).toEqual({ entity: 'customers', rows: [{ code: 'C-1', legalName: 'Customer One', displayName: 'Customer One', email: 'user@example.com', phone: '123' }] })

    const invalid = normalizeBulkCsv(
      'code,legal_name,display_name,email,phone\nc-1,Customer One,Customer One,not-email,',
      'customers',
    )
    expect(invalid.issues[0]).toMatchObject({ row: 2, field: 'email' })
  })

  it('requires positive opening stock and detects duplicate item/warehouse positions', () => {
    const invalid = normalizeBulkCsv(
      'item_sku,warehouse_code,quantity,unit_cost\nA,MAIN,0,10',
      'opening-stock',
    )
    expect(invalid.issues[0]).toMatchObject({ row: 2, field: 'quantity' })

    const duplicate = normalizeBulkCsv(
      'item_sku,warehouse_code,quantity,unit_cost\nA,MAIN,1,10\na,main,2,10',
      'opening-stock',
    )
    expect(duplicate.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_in_file', row: 3 })]))
  })

  it('skips blank lines but rejects an empty data set', () => {
    const parsed = parseVersionedCsv('code,legal_name,display_name,email,phone\n\nC1,Legal,Display,,\n\n', 'customers')
    expect(parsed.rows).toHaveLength(1)
    expect(() => parseVersionedCsv('code,legal_name,display_name,email,phone\n\n', 'customers')).toThrowError(CsvContractError)
  })

  it('rejects NUL bytes', () => {
    expect(() => parseVersionedCsv('sku,name,description,base_uom,track_inventory\nA,\0B,,EA,true', 'items')).toThrowError(CsvContractError)
  })

  it('quotes every export cell and escapes embedded quotes', () => {
    expect(spreadsheetSafeCsvCell('A "quoted" value')).toBe('"A ""quoted"" value"')
  })

  it('neutralizes common spreadsheet formula prefixes', () => {
    for (const value of ['=1+1', '+1', '-1', '@SUM(1,1)', '＝1+1', '\t=1+1']) {
      expect(spreadsheetSafeCsvCell(value)).toBe(`"\t${value.replaceAll('"', '""')}"`)
    }
  })

  it('emits UTF-8 BOM, stable columns and CRLF rows', () => {
    const csv = encodeSpreadsheetCsv(['code', 'name'], [['A', '=danger'], ['B', 'Normal']])
    expect(csv).toBe('\uFEFF"code","name"\r\n"A","\t=danger"\r\n"B","Normal"\r\n')
  })
})
