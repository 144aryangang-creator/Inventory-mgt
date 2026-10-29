import app from './index'
import { financialDocumentRoutes } from './financial-documents'
import { organizationBillingRoutes } from './organization-billing'

app.route('/v1/financial-documents', financialDocumentRoutes)
app.route('/v1/organization-billing-profiles', organizationBillingRoutes)

export default app
