import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Thermometer, Users, LogOut, Activity, Bell, BarChart2, Menu, X } from 'lucide-react'
import { useRealtimeData } from '../hooks/useRealtimeData'

export default function Layout() {
  const { user, logout, can } = useAuth()
  const navigate = useNavigate()
  const { connected } = useRealtimeData(() => {})
  const [menuOpen, setMenuOpen] = useState(false)

  function handleLogout() { logout(); navigate('/login') }
  function closeMenu() { setMenuOpen(false) }

  const sidebarContent = (
    <>
      <div style={{ padding: '0 20px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Thermometer size={20} color="var(--accent)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>TH-GUARD</span>
          </div>
          <button onClick={closeMenu} style={{ display: 'none', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }} className="close-btn">
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>PLATFORM v2.0</div>
      </div>

      <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <NavLink to="/" end style={navStyle} onClick={closeMenu}><Activity size={15} /> Dashboard</NavLink>
        <NavLink to="/alerts" style={navStyle} onClick={closeMenu}><Bell size={15} /> Alertas</NavLink>
        <NavLink to="/reports" style={navStyle} onClick={closeMenu}><BarChart2 size={15} /> Relatórios</NavLink>
        {can(['admin']) && <NavLink to="/users" style={navStyle} onClick={closeMenu}><Users size={15} /> Usuários</NavLink>}
      </nav>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--accent)' : 'var(--danger)', boxShadow: connected ? '0 0 6px var(--accent)' : 'none' }} />
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{connected ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{user?.name}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{user?.role}</div>
        </div>
        <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', padding: '6px 10px', fontSize: 12, width: '100%' }}>
          <LogOut size={13} /> Sair
        </button>
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`
        .sidebar-desktop { display: flex; }
        .sidebar-mobile  { display: none; }
        .topbar          { display: none; }
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .topbar          { display: flex !important; }
          .sidebar-mobile  { display: flex !important; }
          .close-btn       { display: flex !important; }
          .main-content    { padding: 16px !important; }
        }
      `}</style>

      {/* SIDEBAR DESKTOP */}
      <aside className="sidebar-desktop" style={{
        width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)',
        flexDirection: 'column', padding: '24px 0', flexShrink: 0
      }}>
        {sidebarContent}
      </aside>

      {/* TOPBAR MOBILE */}
      <div className="topbar" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '12px 16px', alignItems: 'center', justifyContent: 'space-between',
        display: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Thermometer size={18} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>TH-GUARD</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--accent)' : 'var(--danger)' }} />
          <button onClick={() => setMenuOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: 4 }}>
            <Menu size={22} />
          </button>
        </div>
      </div>

      {/* DRAWER MOBILE */}
      {menuOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
          <div onClick={closeMenu} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <aside className="sidebar-mobile" style={{
            position: 'relative', width: 260, background: 'var(--surface)',
            flexDirection: 'column', padding: '20px 0', zIndex: 201,
            animation: 'slideIn 0.2s ease'
          }}>
            <style>{`@keyframes slideIn { from { transform: translateX(-100%) } to { transform: translateX(0) } }`}</style>
            <button onClick={closeMenu} style={{
              position: 'absolute', top: 14, right: 14,
              background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer'
            }}>
              <X size={20} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="main-content" style={{ flex: 1, overflow: 'auto', padding: 28, paddingTop: 28 }}
        onClick={() => menuOpen && closeMenu()}>
        <div style={{ paddingTop: 0 }} className="mobile-padtop">
          <style>{`@media(max-width:768px){ .mobile-padtop { padding-top: 56px !important; } }`}</style>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function navStyle({ isActive }) {
  return {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderRadius: 6, textDecoration: 'none',
    fontSize: 14, fontWeight: 500,
    color: isActive ? 'var(--accent)' : 'var(--muted)',
    background: isActive ? 'rgba(26,79,214,0.15)' : 'transparent',
    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'all 0.15s'
  }
}
