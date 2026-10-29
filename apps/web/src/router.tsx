import { createBrowserRouter } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { LoginPage } from './pages/LoginPage'
import { PartyPage } from './pages/PartyPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/customers', element: <PartyPage role="customer" title="Customers" singular="Customer" /> },
          { path: '/suppliers', element: <PartyPage role="supplier" title="Suppliers" singular="Supplier" /> },
          { path: '/inventory', element: <PlaceholderPage title="Inventory" description="Stock balances, movements, transfers and adjustments." /> },
          { path: '/invoices', element: <InvoicesPage /> },
          { path: '/payments', element: <PaymentsPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
])
