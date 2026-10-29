import app from './index'
import { customerPaymentRoutes } from './customer-payments'
import { financialDocumentRoutes } from './financial-documents'
import { organizationBillingRoutes } from './organization-billing'

app.route('/v1/customer-payments', customerPaymentRoutes)
app.route('/v1/financial-documents', financialDocumentRoutes)
app.route('/v1/organization-billing-profiles', organizationBillingRoutes)

export default app
