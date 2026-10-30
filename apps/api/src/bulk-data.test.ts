import { describe, expect, it } from 'vitest'
import { bulkDataRoutes } from './bulk-data'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('bulk data API boundary', () => {
  it('rejects unknown bulk entities', async () => {
    const response = await bulkDataRoutes.request('/unknown/template')
    expect(response.status).toBe(400)
  })

  it('serves a versioned spreadsheet-safe CSV template without database access', async () => {
    const response = await bulkDataRoutes.request('/items/template')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('x-schema-version')).toBe('1')
    const body = await response.text()
    expect(body.startsWith('\uFEFF"sku","name","description","base_uom","track_inventory"')).toBe(true)
  })

  it('requires text/csv or text/plain content type', async () => {
    const response = await bulkDataRoutes.request(`/items/validate?organizationId=${organizationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(415)
  })

  it('rejects malformed CSV headers before database access', async () => {
    const response = await bulkDataRoutes.request(`/items/validate?organizationId=${organizationId}`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: 'name,sku,description,base_uom,track_inventory\nItem,A,,EA,true',
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'csv_contract_error', code: 'header_mismatch' })
  })

  it('rejects duplicate rows before database access', async () => {
    const response = await bulkDataRoutes.request(`/items/validate?organizationId=${organizationId}`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: 'sku,name,description,base_uom,track_inventory\nA,Item A,,EA,true\na,Item A Duplicate,,EA,true',
    })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ valid: false })
  })

  it('requires request key before import execution', async () => {
    const response = await bulkDataRoutes.request(`/items/import?organizationId=${organizationId}`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: 'sku,name,description,base_uom,track_inventory\nA,Item A,,EA,true',
    })
    expect(response.status).toBe(400)
  })

  it('does not misrepresent current balances as an opening-stock export', async () => {
    const response = await bulkDataRoutes.request(`/opening-stock/export?organizationId=${organizationId}`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'opening_stock_export_not_supported' })
  })
})
