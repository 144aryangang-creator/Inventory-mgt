import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

if (!email || !password) {
  throw new Error('E2E_EMAIL and E2E_PASSWORD are required')
}

test('user can onboard and import an item through CSV dry-run', async ({ page }, testInfo) => {
  const suffix = testInfo.retry + 1
  const sku = `E2E-ITEM-${String(suffix).padStart(3, '0')}`
  const itemName = `E2E Imported Widget ${suffix}`

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

  await page.getByRole('link', { name: 'Import / Export' }).click()
  await expect(page.getByRole('heading', { name: 'Import & Export' })).toBeVisible()

  const csv = [
    'sku,name,description,base_uom,track_inventory',
    `${sku},${itemName},Created by browser E2E,EA,true`,
    '',
  ].join('\r\n')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  await page.getByRole('button', { name: 'Validate / Dry Run' }).click()
  await expect(page.getByText(/Dry run passed for 1 row/)).toBeVisible()
  await expect(page.getByText(/No data was changed/)).toBeVisible()

  const importButton = page.getByRole('button', { name: 'Import validated file' })
  await expect(importButton).toBeEnabled()
  await importButton.click()
  await expect(page.getByText(/Import completed\. Batch/)).toBeVisible()

  await page.getByRole('link', { name: 'Inventory' }).click()
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  await expect(page.getByText(itemName)).toBeVisible()
  await expect(page.getByText(sku)).toBeVisible()
})
