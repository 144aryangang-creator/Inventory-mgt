import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

if (!email || !password) {
  throw new Error('E2E_EMAIL and E2E_PASSWORD are required')
}

test('user can onboard, import master data and receive supplier stock', async ({ page }, testInfo) => {
  const suffix = testInfo.retry + 1
  const sku = `E2E-ITEM-${String(suffix).padStart(3, '0')}`
  const itemName = `E2E Imported Widget ${suffix}`
  const warehouseCode = `E2E-WH-${String(suffix).padStart(3, '0')}`
  const warehouseName = `E2E Warehouse ${suffix}`
  const supplierCode = `E2E-SUP-${String(suffix).padStart(3, '0')}`
  const supplierName = `E2E Supplier ${suffix}`
  const supplierLegalName = `E2E Supplier ${suffix} Private Limited`

  await page.goto('/login')

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Retries may reuse the organization created by an earlier failed attempt.
  await expect(page.locator('h1').first()).toHaveText(/Create your organization|Operational Dashboard/)
  const onboardingHeading = page.getByRole('heading', { name: 'Create your organization' })
  if (await onboardingHeading.isVisible()) {
    await page.getByLabel('Business name').fill('E2E Inventory Business')
    await page.getByLabel('Organization slug').fill('e2e-inventory-business')
    await page.getByRole('button', { name: 'Create organization' }).click()
  }

  await expect(page.getByRole('heading', { name: 'Operational Dashboard' })).toBeVisible()
  await expect(page.getByLabel('Active organization').locator('option:checked')).toHaveText('E2E Inventory Business')

  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await navigation.getByRole('link', { name: 'Import / Export' }).click()
  await expect(page.getByRole('heading', { name: 'Import & Export' })).toBeVisible()

  const itemCsv = [
    'sku,name,description,base_uom,track_inventory',
    `${sku},${itemName},Created by browser E2E,EA,true`,
    '',
  ].join('\r\n')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(itemCsv, 'utf8'),
  })

  await page.getByRole('button', { name: 'Validate / Dry Run' }).click()
  await expect(page.getByText(/Dry run passed for 1 row/)).toBeVisible()
  await expect(page.getByText(/No data was changed/)).toBeVisible()

  const importButton = page.getByRole('button', { name: 'Import validated file' })
  await expect(importButton).toBeEnabled()
  await importButton.click()
  await expect(page.getByText(/Import completed\. Batch/)).toBeVisible()

  await navigation.getByRole('link', { name: 'Inventory' }).click()
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()

  const itemCard = page.getByRole('article').filter({ hasText: sku }).first()
  await expect(itemCard).toBeVisible()
  await expect(itemCard).toContainText(itemName)
  await expect(itemCard).toContainText(sku)

  const warehousePanel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Warehouses' }) })
  await warehousePanel.getByLabel('Code').fill(warehouseCode)
  await warehousePanel.getByLabel('Name').fill(warehouseName)
  await warehousePanel.getByRole('button', { name: 'Add warehouse' }).click()
  await expect(warehousePanel.getByRole('article').filter({ hasText: warehouseCode })).toContainText(warehouseName)

  await navigation.getByRole('link', { name: 'Import / Export' }).click()
  await page.locator('.bulk-entities button').filter({ hasText: 'Suppliers' }).click()
  await expect(page.getByRole('heading', { name: 'Suppliers' })).toBeVisible()

  const supplierCsv = [
    'code,legal_name,display_name,email,phone',
    `${supplierCode},${supplierLegalName},${supplierName},supplier-${suffix}@example.test,555000${suffix}`,
    '',
  ].join('\r\n')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'suppliers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(supplierCsv, 'utf8'),
  })
  await page.getByRole('button', { name: 'Validate / Dry Run' }).click()
  await expect(page.getByText(/Dry run passed for 1 row/)).toBeVisible()
  await page.getByRole('button', { name: 'Import validated file' }).click()
  await expect(page.getByText(/Import completed\. Batch/)).toBeVisible()

  await navigation.getByRole('link', { name: 'Purchase Receipts' }).click()
  await expect(page.getByRole('heading', { name: 'Purchase Receipts' })).toBeVisible()
  await page.getByRole('button', { name: 'Receive goods' }).click()

  await page.getByLabel('Supplier').selectOption({ label: `${supplierCode} · ${supplierName}` })
  await page.getByLabel('Receiving warehouse').selectOption({ label: `${warehouseCode} · ${warehouseName}` })
  await page.getByLabel('Supplier delivery / reference').fill(`E2E-DN-${suffix}`)
  await page.getByLabel('Notes').fill('Posted by real-stack Playwright E2E')
  await page.getByLabel('Item').selectOption({ label: `${sku} · ${itemName}` })
  await page.getByLabel(/^Quantity/).fill('3')
  await page.getByLabel('Unit cost').fill('100.50')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('receipt becomes immutable')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Post purchase receipt' }).click()

  const receiptRow = page.locator('.purchase-receipt-list-row').filter({ hasText: supplierName }).first()
  await expect(receiptRow).toBeVisible()
  await expect(receiptRow).toContainText(warehouseCode)
  await expect(page.locator('.purchase-receipt-detail-header').getByRole('heading', { name: supplierLegalName })).toBeVisible()
  await expect(page.locator('.purchase-receipt-detail-lines').getByText(itemName)).toBeVisible()
  await expect(page.locator('.purchase-receipt-detail-lines')).toContainText('Unit cost 100.5')

  await navigation.getByRole('link', { name: 'Inventory' }).click()
  const balanceRow = page.locator('.inventory-balance-panel .inventory-table-row').filter({ hasText: sku }).filter({ hasText: warehouseCode })
  await expect(balanceRow).toBeVisible()
  await expect(balanceRow).toContainText('3 EA')
})
