import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

if (!email || !password) {
  throw new Error('E2E_EMAIL and E2E_PASSWORD are required')
}

test('issued document print, operational dashboard and audit history stay connected', async ({ page }, testInfo) => {
  const suffix = testInfo.retry + 1
  const sellerCode = `VIS-SELL-${String(suffix).padStart(3, '0')}`
  const sellerLegalName = `Visibility Seller ${suffix} Private Limited`
  const customerCode = `VIS-CUST-${String(suffix).padStart(3, '0')}`
  const customerName = `Visibility Customer ${suffix}`
  const customerLegalName = `${customerName} Private Limited`
  const serviceDescription = `Visibility Service ${suffix}`

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.locator('h1').first()).toHaveText(/Create your organization|Operational Dashboard/)
  const onboardingHeading = page.getByRole('heading', { name: 'Create your organization' })
  if (await onboardingHeading.isVisible()) {
    await page.getByLabel('Business name').fill('E2E Inventory Business')
    await page.getByLabel('Organization slug').fill('e2e-inventory-business')
    await page.getByRole('button', { name: 'Create organization' }).click()
  }

  await expect(page.getByRole('heading', { name: 'Operational Dashboard' })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })

  // Create a seller profile specifically for this visibility test.
  await navigation.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Seller & billing settings' })).toBeVisible()
  await page.getByRole('button', { name: 'New seller profile' }).click()
  const sellerForm = page.locator('form.seller-form')
  await sellerForm.getByLabel('Profile code').fill(sellerCode)
  await sellerForm.getByLabel('Legal name').fill(sellerLegalName)
  await sellerForm.getByLabel('Registered address').fill('11 Visibility Seller Road')
  await sellerForm.getByLabel('City').fill('Bhopal')
  await sellerForm.getByLabel('State name').fill('Madhya Pradesh')
  await sellerForm.getByLabel('State code').fill('23')
  await sellerForm.getByLabel('Postal code').fill('462001')
  await sellerForm.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.locator('.seller-profile-card').filter({ hasText: sellerCode })).toContainText(sellerLegalName)

  // Create a customer and billing address so the issued document has immutable buyer snapshots.
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
  await addressForm.getByLabel('Address line 1').fill('22 Visibility Customer Road')
  await addressForm.getByLabel('City').fill('Bhopal')
  await addressForm.getByLabel('State name').fill('Madhya Pradesh')
  await addressForm.getByLabel('State code').fill('23')
  await addressForm.getByLabel('Postal code').fill('462001')
  await addressForm.getByRole('button', { name: 'Add address' }).click()
  await expect(page.locator('.profile-record').filter({ hasText: '22 Visibility Customer Road' })).toBeVisible()

  // Issue a service-only invoice so print/reporting can be verified without stock setup.
  await navigation.getByRole('link', { name: 'Invoices' }).click()
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible()
  await page.getByRole('button', { name: 'New tax invoice' }).click()

  const invoiceForm = page.locator('form.invoice-form')
  const invoiceSelects = invoiceForm.getByRole('combobox')
  await expect(invoiceSelects).toHaveCount(6)
  await invoiceSelects.nth(0).selectOption({ label: `${sellerCode} · ${sellerLegalName}` })
  await invoiceSelects.nth(1).selectOption({ label: `${customerCode} · ${customerName}` })
  await expect(invoiceSelects.nth(2).locator('option:checked')).not.toHaveValue('')
  await invoiceForm.getByLabel('Series').fill('VIS')
  await invoiceForm.getByLabel('Notes').fill(`Visibility E2E invoice ${suffix}`)
  await invoiceForm.getByRole('button', { name: 'Create draft' }).click()

  const lineForm = page.locator('form.invoice-line-form')
  await expect(lineForm).toBeVisible()
  await lineForm.getByLabel('Description').fill(serviceDescription)
  await lineForm.getByLabel('HSN/SAC').fill('9983')
  await lineForm.getByLabel('Quantity').fill('1')
  await lineForm.getByLabel('Unit price').fill('1000')
  await lineForm.getByRole('button', { name: 'Add line' }).click()
  await expect(page.locator('.invoice-line-row').filter({ hasText: serviceDescription })).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('become immutable')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Issue invoice' }).click()
  await expect(page.locator('.invoice-detail-header')).toContainText('Issued')
  await expect(page.locator('.invoice-totals')).toContainText('1180')
  const documentNumber = (await page.locator('.invoice-detail-header .eyebrow').textContent())?.trim() ?? ''
  expect(documentNumber).toMatch(/^VIS\//)

  // The authenticated print route must render only the issued document's immutable snapshots/totals.
  const documentOperations = page.locator('.invoice-fulfillment').first()
  await expect(documentOperations.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await documentOperations.getByRole('button', { name: 'Print / Save PDF' }).click()
  const printPage = await popupPromise
  await expect(printPage.locator('.print-kicker')).toHaveText('Tax Invoice')
  await expect(printPage.getByRole('heading', { name: documentNumber })).toBeVisible()
  await expect(printPage.getByText(sellerLegalName)).toBeVisible()
  const billToBlock = printPage.locator('.print-party-block').filter({ hasText: 'Bill To' })
  await expect(billToBlock.getByText(customerLegalName)).toBeVisible()
  await expect(printPage.getByText(serviceDescription)).toBeVisible()
  await expect(printPage.locator('.print-grand-total')).toContainText('INR 1180')
  await expect(printPage.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible()
  await printPage.close()

  // Dashboard must expose PostgreSQL-derived operational data without mixing currency/UOM totals.
  await navigation.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Operational Dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Issued financial documents' })).toBeVisible()
  const inrCard = page.locator('.operations-currency-grid article').filter({ hasText: 'INR' }).first()
  await expect(inrCard).toBeVisible()
  await expect(inrCard).toContainText('Net document value')
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Purchase receiving' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sales fulfillment' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Audit activity' })).toBeVisible()

  // Audit viewer must show the immutable issue event written by the database workflow.
  await navigation.getByRole('link', { name: 'Audit Log' }).click()
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
  await page.getByLabel('Action').fill('financial_document.issued')
  await page.getByRole('button', { name: 'Apply' }).click()

  const issueEvent = page.locator('.audit-event-list article').filter({ hasText: 'financial_document.issued' }).first()
  await expect(issueEvent).toBeVisible()
  await issueEvent.getByText('Metadata').click()
  await expect(issueEvent).toContainText(documentNumber)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
