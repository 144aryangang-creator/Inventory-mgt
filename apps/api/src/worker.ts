import { Hono } from 'hono'
import app from './index'
import { bulkDataRoutes } from './bulk-data'
import { customerPaymentRoutes } from './customer-payments'
import { financialAdjustmentRoutes } from './financial-adjustments'
import { financialDocumentRoutes } from './financial-documents'
import { inventoryReferenceRoutes } from './inventory-references'
import { operationsRoutes } from './operations'
import { organizationBillingRoutes } from './organization-billing'
import { purchaseReceiptRoutes } from './purchase-receipts'
import { salesFulfillmentRoutes } from './sales-fulfillment'

app.route('/v1/bulk-data', bulkDataRoutes)
app.route('/v1/customer-payments', customerPaymentRoutes)
app.route('/v1/financial-adjustments', financialAdjustmentRoutes)
app.route('/v1/financial-documents', financialDocumentRoutes)
app.route('/v1/financial-documents', salesFulfillmentRoutes)
app.route('/v1/inventory', inventoryReferenceRoutes)
app.route('/v1/operations', operationsRoutes)
app.route('/v1/organization-billing-profiles', organizationBillingRoutes)
app.route('/v1/purchase-receipts', purchaseReceiptRoutes)

// Wrap the complete API after every route has been mounted so authenticated
// business responses cannot be cached by browsers, shared proxies, or CDNs.
const worker = new Hono()
worker.use('/v1/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})
worker.route('/', app)
worker.notFound((c) => c.json({ error: 'not_found' }, 404))

export default worker
