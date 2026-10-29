import { createBrowserRouter } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          {
            path: '/inventory',
            element: <PlaceholderPage title="Inventory" description="Stock balances, movements, transfers and adjustments." />,
          },
          {
            path: '/invoices',
            element: <PlaceholderPage title="Invoices" description="Sales invoices, payments and immutable financial documents." />,
          },
          {
            path: '/settings',
            element: <PlaceholderPage title="Settings" description="Organization configuration, roles and customization." />,
          },
        ],
      },
    ],
  },
])
