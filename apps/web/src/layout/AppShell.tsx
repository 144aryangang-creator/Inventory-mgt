import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthProvider'

const navigation = [
  ['/', 'Dashboard'],
  ['/inventory', 'Inventory'],
  ['/invoices', 'Invoices'],
  ['/settings', 'Settings'],
] as const

export function AppShell() {
  const { session, signOut } = useAuth()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">IM</div>
          <div>
            <strong>Inventory</strong>
            <span>Operations</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Signed in as</span>
            <strong>{session?.user.email ?? 'User'}</strong>
          </div>
          <button className="secondary-button" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </header>

        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
