import app from './index'
import { bulkDataRoutes } from './bulk-data'
import { customerPaymentRoutes } from './customer-payments'
import { financialAdjustmentRoutes } from './financial-adjustments'
import { financialDocumentRoutes } from './financial-documents'
import { inventoryReferenceRoutes } from './inventory-references'
import { operationsRoutes } from './operations'
import { organizationBillingRoutes } from './organization-billing'
import { purchaseReceiptRoutes } from './purchase-receipts'

app.route('/v1/bulk-data', bulkDataRoutes)
app.route('/v1/customer-payments', customerPaymentRoutes)
app.route('/v1/financial-adjustments', financialAdjustmentRoutes)
app.route('/v1/financial-documents', financialDocumentRoutes)
app.route('/v1/inventory', inventoryReferenceRoutes)
app.route('/v1/operations', operationsRoutes)
app.route('/v1/organization-billing-profiles', organizationBillingRoutes)
app.route('/v1/purchase-receipts', purchaseReceiptRoutes)

export default app
