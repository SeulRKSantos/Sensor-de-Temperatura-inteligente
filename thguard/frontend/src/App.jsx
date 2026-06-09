import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SensorDetailPage from './pages/SensorDetailPage'
import UsersPage from './pages/UsersPage'
import AlertsPage from './pages/AlertsPage'
import ReportsPage from './pages/ReportsPage'
import Layout from './components/Layout'

function ProtectedRole({ children, roles }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ color: '#00d4aa', padding: 40, fontFamily: 'monospace' }}>Carregando...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protected><Layout /></Protected>}>
            <Route index element={<DashboardPage />} />
            <Route path="sensor/:id" element={<SensorDetailPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="reports" element={<ProtectedRole roles={['admin','editor']}><ReportsPage /></ProtectedRole>} />
            <Route path="users" element={<UsersPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
