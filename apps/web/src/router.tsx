import { createBrowserRouter } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './layout/AppShell'
import { AuditLogPage } from './pages/AuditLogPage'
import { BulkDataPage } from './pages/BulkDataPage'
import { FinancialDocumentPrintPage } from './pages/FinancialDocumentPrintPage'
import { InventoryPage } from './pages/InventoryPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { LoginPage } from './pages/LoginPage'
import { OperationalDashboardPage } from './pages/OperationalDashboardPage'
import { PartyPage } from './pages/PartyPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { PurchaseReceiptsPage } from './pages/PurchaseReceiptsPage'
import { SettingsPage } from './pages/SettingsPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/financial-documents/:documentId/print', element: <FinancialDocumentPrintPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <OperationalDashboardPage /> },
          { path: '/customers', element: <PartyPage role="customer" title="Customers" singular="Customer" /> },
          { path: '/suppliers', element: <PartyPage role="supplier" title="Suppliers" singular="Supplier" /> },
          { path: '/inventory', element: <InventoryPage /> },
          { path: '/purchases', element: <PurchaseReceiptsPage /> },
          { path: '/invoices', element: <InvoicesPage /> },
          { path: '/payments', element: <PaymentsPage /> },
          { path: '/data', element: <BulkDataPage /> },
          { path: '/audit', element: <AuditLogPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
])
