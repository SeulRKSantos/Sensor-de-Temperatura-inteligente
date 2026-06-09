import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('thguard_token')
    const stored = localStorage.getItem('thguard_user')
    if (token && stored) {
      setUser(JSON.parse(stored))
    }
    setLoading(false)
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
