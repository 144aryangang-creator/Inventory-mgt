import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { OrganizationProvider, useOrganization } from '../organizations/OrganizationProvider'

const navigation = [
  ['/', 'Dashboard'],
  ['/customers', 'Customers'],
  ['/suppliers', 'Suppliers'],
  ['/inventory', 'Inventory'],
  ['/invoices', 'Invoices'],
  ['/settings', 'Settings'],
] as const

function AppShellContent() {
  const { session, signOut } = useAuth()
  const { organizations, activeOrganization, loading, selectOrganization } = useOrganization()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">IM</div>
          <div><strong>Inventory</strong><span>Operations</span></div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-context">
            <label className="organization-switcher">
              <span className="eyebrow">Organization</span>
              <select
                aria-label="Active organization"
                disabled={loading || organizations.length === 0}
                value={activeOrganization?.id ?? ''}
                onChange={(event) => selectOrganization(event.target.value)}
              >
                {organizations.length === 0 ? <option value="">No organization</option> : null}
                {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
              </select>
            </label>

            <div className="signed-in-user">
              <span className="eyebrow">Signed in as</span>
              <strong>{session?.user.email ?? 'User'}</strong>
            </div>
          </div>

          <button className="secondary-button" type="button" onClick={() => void signOut()}>Sign out</button>
        </header>

        <main className="content-area"><Outlet /></main>
      </div>
    </div>
  )
}

export function AppShell() {
  return <OrganizationProvider><AppShellContent /></OrganizationProvider>
}
