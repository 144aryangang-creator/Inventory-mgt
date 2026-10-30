import app from './index'
import { customerPaymentRoutes } from './customer-payments'
import { financialAdjustmentRoutes } from './financial-adjustments'
import { financialDocumentRoutes } from './financial-documents'
import { inventoryReferenceRoutes } from './inventory-references'
import { organizationBillingRoutes } from './organization-billing'

app.route('/v1/customer-payments', customerPaymentRoutes)
app.route('/v1/financial-adjustments', financialAdjustmentRoutes)
app.route('/v1/financial-documents', financialDocumentRoutes)
app.route('/v1/inventory', inventoryReferenceRoutes)
app.route('/v1/organization-billing-profiles', organizationBillingRoutes)

export default app
