import app from './index'
import { financialDocumentRoutes } from './financial-documents'

app.route('/v1/financial-documents', financialDocumentRoutes)

export default app
