import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

if (!email || !password) {
  throw new Error('E2E_EMAIL and E2E_PASSWORD are required')
}

test('user can onboard, receive supplier stock, fulfill across warehouses, return stock and issue a return credit', async ({ page }, testInfo) => {
  const suffix = testInfo.retry + 1
  const sku = `E2E-ITEM-${String(suffix).padStart(3, '0')}`
  const itemName = `E2E Imported Widget ${suffix}`
  const warehouseCode = `E2E-WH-${String(suffix).padStart(3, '0')}`
  const warehouseName = `E2E Warehouse ${suffix}`
  const secondWarehouseCode = `E2E-WH2-${String(suffix).padStart(3, '0')}`
  const secondWarehouseName = `E2E Warehouse Two ${suffix}`
  const supplierCode = `E2E-SUP-${String(suffix).padStart(3, '0')}`
  const supplierName = `E2E Supplier ${suffix}`
  const supplierLegalName = `E2E Supplier ${suffix} Private Limited`
  const customerCode = `E2E-CUST-${String(suffix).padStart(3, '0')}`
  const customerName = `E2E Customer ${suffix}`
  const customerLegalName = `${customerName} Private Limited`
  const sellerCode = `E2E-SELL-${String(suffix).padStart(3, '0')}`
  const sellerLegalName = `E2E Seller ${suffix} Private Limited`

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

  await warehousePanel.getByLabel('Code').fill(secondWarehouseCode)
  await warehousePanel.getByLabel('Name').fill(secondWarehouseName)
  await warehousePanel.getByRole('button', { name: 'Add warehouse' }).click()
  await expect(warehousePanel.getByRole('article').filter({ hasText: secondWarehouseCode })).toContainText(secondWarehouseName)

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

  let receiptForm = page.locator('form.purchase-receipt-form')
  let receiptSelects = receiptForm.getByRole('combobox')
  await expect(receiptSelects).toHaveCount(3)
  await receiptSelects.nth(0).selectOption({ label: `${supplierCode} · ${supplierName}` })
  await receiptSelects.nth(1).selectOption({ label: `${warehouseCode} · ${warehouseName}` })
  await page.getByLabel('Supplier delivery / reference', { exact: true }).fill(`E2E-DN-${suffix}`)
  await page.getByLabel('Notes', { exact: true }).fill('Posted by real-stack Playwright E2E')
  await receiptSelects.nth(2).selectOption({ label: `${sku} · ${itemName}` })
  await page.getByLabel(/^Quantity/).fill('3')
  await page.getByLabel('Unit cost', { exact: true }).fill('100.50')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('receipt becomes immutable')
    await dialog.accept()
  })
  await receiptForm.getByRole('button', { name: 'Post purchase receipt' }).click()

  const receiptRow = page.locator('.purchase-receipt-list-row').filter({ hasText: supplierName }).filter({ hasText: warehouseCode }).first()
  await expect(receiptRow).toBeVisible()
  await expect(page.locator('.purchase-receipt-detail-header').getByRole('heading', { name: supplierLegalName })).toBeVisible()
  await expect(page.locator('.purchase-receipt-detail-lines').getByText(itemName)).toBeVisible()
  await expect(page.locator('.purchase-receipt-detail-lines')).toContainText('Unit cost 100.5')

  // Receive one additional unit into a second warehouse so the same invoice can be completed across warehouses.
  await page.getByRole('button', { name: 'Receive goods' }).click()
  receiptForm = page.locator('form.purchase-receipt-form')
  receiptSelects = receiptForm.getByRole('combobox')
  await receiptSelects.nth(0).selectOption({ label: `${supplierCode} · ${supplierName}` })
  await receiptSelects.nth(1).selectOption({ label: `${secondWarehouseCode} · ${secondWarehouseName}` })
  await page.getByLabel('Supplier delivery / reference', { exact: true }).fill(`E2E-DN2-${suffix}`)
  await page.getByLabel('Notes', { exact: true }).fill('Second warehouse receipt for multi-warehouse E2E')
  await receiptSelects.nth(2).selectOption({ label: `${sku} · ${itemName}` })
  await page.getByLabel(/^Quantity/).fill('1')
  await page.getByLabel('Unit cost', { exact: true }).fill('100.50')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('receipt becomes immutable')
    await dialog.accept()
  })
  await receiptForm.getByRole('button', { name: 'Post purchase receipt' }).click()
  await expect(page.locator('.purchase-receipt-list-row').filter({ hasText: secondWarehouseCode }).first()).toBeVisible()

  await navigation.getByRole('link', { name: 'Inventory' }).click()
  const balanceRow = page.locator('.inventory-balance-panel .inventory-table-row').filter({ hasText: sku }).filter({ hasText: warehouseCode })
  await expect(balanceRow).toBeVisible()
  await expect(balanceRow).toContainText('3 EA')
  const secondBalanceRow = page.locator('.inventory-balance-panel .inventory-table-row').filter({ hasText: sku }).filter({ hasText: secondWarehouseCode })
  await expect(secondBalanceRow).toBeVisible()
  await expect(secondBalanceRow).toContainText('1 EA')

  // Create a seller legal profile used for immutable invoice snapshots.
  await navigation.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Seller & billing settings' })).toBeVisible()
  await page.getByRole('button', { name: 'New seller profile' }).click()
  const sellerForm = page.locator('form.seller-form')
  await sellerForm.getByLabel('Profile code').fill(sellerCode)
  await sellerForm.getByLabel('Legal name').fill(sellerLegalName)
  await sellerForm.getByLabel('Registered address').fill('1 E2E Seller Road')
  await sellerForm.getByLabel('City').fill('Bhopal')
  await sellerForm.getByLabel('State name').fill('Madhya Pradesh')
  await sellerForm.getByLabel('State code').fill('23')
  await sellerForm.getByLabel('Postal code').fill('462001')
  await sellerForm.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.locator('.seller-profile-card').filter({ hasText: sellerCode })).toContainText(sellerLegalName)

  // Create a customer and the billing address required by invoice snapshotting.
  await navigation.getByRole('link', { name: 'Customers' }).click()
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible()
  await page.getByRole('button', { name: 'New Customer' }).click()
  const customerForm = page.locator('form.party-form')
  await customerForm.getByLabel('Code').fill(customerCode)
  await customerForm.getByLabel('Legal name').fill(customerLegalName)
  await customerForm.getByLabel('Display name').fill(customerName)
  await customerForm.getByRole('button', { name: 'Create Customer' }).click()

  const customerRow = page.locator('.party-row').filter({ hasText: customerCode }).first()
  await expect(customerRow).toContainText(customerName)
  await customerRow.getByRole('button', { name: 'Manage' }).click()

  const addressForm = page.locator('form.profile-form').filter({ has: page.getByRole('heading', { name: 'Add address' }) })
  await addressForm.getByLabel('Recipient name').fill(customerName)
  await addressForm.getByLabel('Address line 1').fill('20 E2E Customer Road')
  await addressForm.getByLabel('City').fill('Bhopal')
  await addressForm.getByLabel('State name').fill('Madhya Pradesh')
  await addressForm.getByLabel('State code').fill('23')
  await addressForm.getByLabel('Postal code').fill('462001')
  await addressForm.getByRole('button', { name: 'Add address' }).click()
  await expect(page.locator('.profile-record').filter({ hasText: '20 E2E Customer Road' })).toBeVisible()

  // Create and issue a stock-backed intra-state invoice.
  await navigation.getByRole('link', { name: 'Invoices' }).click()
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible()
  await page.getByRole('button', { name: 'New tax invoice' }).click()

  const invoiceForm = page.locator('form.invoice-form')
  const invoiceSelects = invoiceForm.getByRole('combobox')
  await expect(invoiceSelects).toHaveCount(6)
  await invoiceSelects.nth(0).selectOption({ label: `${sellerCode} · ${sellerLegalName}` })
  await invoiceSelects.nth(1).selectOption({ label: `${customerCode} · ${customerName}` })
  await expect(invoiceSelects.nth(2).locator('option:checked')).not.toHaveValue('')
  await invoiceForm.getByLabel('Series').fill('INV')
  await invoiceForm.getByLabel('Notes').fill(`Issued by real-stack Playwright E2E ${suffix}`)
  await invoiceForm.getByRole('button', { name: 'Create draft' }).click()

  const lineForm = page.locator('form.invoice-line-form')
  await expect(lineForm).toBeVisible()
  await lineForm.getByRole('combobox').selectOption({ label: `${sku} · ${itemName}` })
  await lineForm.getByLabel('Description').fill(itemName)
  await lineForm.getByLabel('HSN/SAC').fill('8708')
  await lineForm.getByLabel('Quantity').fill('2')
  await lineForm.getByLabel('Unit price').fill('500')
  await lineForm.getByRole('button', { name: 'Add line' }).click()
  await expect(page.locator('.invoice-line-row').filter({ hasText: itemName })).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('become immutable')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Issue invoice' }).click()
  await expect(page.locator('.invoice-detail-header')).toContainText('Issued')
  await expect(page.locator('.invoice-totals')).toContainText('1180')

  // Post half of the invoiced quantity from warehouse one.
  const fulfillmentPanel = page.locator('.invoice-fulfillment').first()
  await expect(fulfillmentPanel).toContainText('Unfulfilled')
  await fulfillmentPanel.getByRole('button', { name: 'Post fulfillment' }).click()
  let fulfillmentForm = page.locator('form.invoice-return-form')
  await fulfillmentForm.getByRole('combobox').selectOption({ label: `${warehouseCode} · ${warehouseName}` })
  await fulfillmentForm.getByPlaceholder('Quantity shipping now').fill('1')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('immutable sale movements')
    await dialog.accept()
  })
  await fulfillmentForm.getByRole('button', { name: 'Post fulfillment' }).click()
  await expect(page.locator('.invoice-fulfillment').first()).toContainText('Partially fulfilled')

  // Complete the remaining invoice quantity from warehouse two.
  await page.locator('.invoice-fulfillment').first().getByRole('button', { name: 'Post fulfillment' }).click()
  fulfillmentForm = page.locator('form.invoice-return-form')
  await fulfillmentForm.getByRole('combobox').selectOption({ label: `${secondWarehouseCode} · ${secondWarehouseName}` })
  await fulfillmentForm.getByPlaceholder('Quantity shipping now').fill('1')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('immutable sale movements')
    await dialog.accept()
  })
  await fulfillmentForm.getByRole('button', { name: 'Post fulfillment' }).click()

  const fulfilledPanel = page.locator('.invoice-fulfillment').first()
  await expect(fulfilledPanel).toContainText('Fulfilled')
  await expect(page.locator('.invoice-fulfillment-posting')).toHaveCount(2)
  await expect(page.locator('.invoice-fulfillment-posting').filter({ hasText: warehouseCode })).toHaveCount(1)
  await expect(page.locator('.invoice-fulfillment-posting').filter({ hasText: secondWarehouseCode })).toHaveCount(1)

  // Return the unit from the exact second-warehouse posting.
  let secondPosting = page.locator('.invoice-fulfillment-posting').filter({ hasText: secondWarehouseCode }).first()
  await secondPosting.getByRole('button', { name: 'Record return' }).click()
  let returnForm = secondPosting.locator('form.invoice-return-form')
  await returnForm.getByPlaceholder('Return quantity').fill('1')
  await returnForm.getByLabel('Return reason').fill('E2E customer return')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Stock will return')
    await dialog.accept()
  })
  await returnForm.getByRole('button', { name: 'Post sales return' }).click()

  secondPosting = page.locator('.invoice-fulfillment-posting').filter({ hasText: secondWarehouseCode }).first()
  await expect(secondPosting).toContainText('E2E customer return')
  await expect(secondPosting.getByRole('button', { name: 'Issue credit note' })).toBeVisible()

  // Issue the financial credit from the immutable physical return.
  await secondPosting.getByRole('button', { name: 'Issue credit note' }).click()
  const creditForm = secondPosting.locator('form.invoice-return-form')
  await creditForm.getByPlaceholder('Quantity to credit').fill('1')
  await creditForm.getByLabel('Series').fill('CRN')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Issue this GST credit note')
    await dialog.accept()
  })
  await creditForm.getByRole('button', { name: 'Issue return credit note' }).click()

  secondPosting = page.locator('.invoice-fulfillment-posting').filter({ hasText: secondWarehouseCode }).first()
  await expect(secondPosting).toContainText('CRN/')
  await expect(secondPosting).toContainText('issued')

  await navigation.getByRole('link', { name: 'Inventory' }).click()
  const postSaleBalance = page.locator('.inventory-balance-panel .inventory-table-row').filter({ hasText: sku }).filter({ hasText: warehouseCode })
  await expect(postSaleBalance).toBeVisible()
  await expect(postSaleBalance).toContainText('2 EA')
  const returnedWarehouseBalance = page.locator('.inventory-balance-panel .inventory-table-row').filter({ hasText: sku }).filter({ hasText: secondWarehouseCode })
  await expect(returnedWarehouseBalance).toBeVisible()
  await expect(returnedWarehouseBalance).toContainText('1 EA')
})
