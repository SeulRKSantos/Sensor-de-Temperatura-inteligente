import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../hooks/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('thguard_token')
    const stored = localStorage.getItem('thguard_user')
    if (token && stored) {
      // Mostra o usuario imediatamente (UX), mas valida o token no backend
      setUser(JSON.parse(stored))
      api.me(token)
        .then(fresh => {
          // Token valido — atualiza dados do usuario
          if (fresh) {
            localStorage.setItem('thguard_user', JSON.stringify(fresh))
            setUser(fresh)
          }
        })
        .catch(() => {
          // Token invalido/expirado — limpa sessao
          localStorage.removeItem('thguard_token')
          localStorage.removeItem('thguard_user')
          setUser(null)
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }

    // Ouve o evento global disparado quando a API recebe 401
    const onLogout = () => setUser(null)
    window.addEventListener('thguard:logout', onLogout)
    return () => window.removeEventListener('thguard:logout', onLogout)
  }, [])

  function login(token, userData) {
    localStorage.setItem('thguard_token', token)
    localStorage.setItem('thguard_user', JSON.stringify(userData))
    setUser(userData)
  }

  function logout() {
    localStorage.removeItem('thguard_token')
    localStorage.removeItem('thguard_user')
    setUser(null)
  }

  function getToken() {
    return localStorage.getItem('thguard_token')
  }

  function can(roles) {
    if (!user) return false
    return roles.includes(user.role)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, getToken, can, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
