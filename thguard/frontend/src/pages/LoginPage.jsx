import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../hooks/api'
import { Thermometer, Lock, Mail } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, user } = await api.login(email, password)
      login(token, user)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse at 30% 50%, rgba(0,212,170,0.04) 0%, transparent 60%)'
    }}>
      <div style={{ width: 360 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
            <Thermometer size={28} color="var(--accent)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--accent)', fontWeight: 700 }}>
              TH-GUARD
            </span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            MONITORAMENTO AMBIENTAL
          </p>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 28
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: 'var(--text)' }}>
            Acesso ao painel
          </h2>

          <label style={labelStyle}>
            <Mail size={13} /> E-mail
          </label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="admin@thguard.local"
            required style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 14 }}>
            <Lock size={13} /> Senha
          </label>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required style={inputStyle}
          />

          {error && (
            <div style={{ background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)', borderRadius: 6, padding: '8px 12px', marginTop: 14, fontSize: 12, color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 20, width: '100%', padding: '10px 0',
            background: loading ? 'var(--border)' : 'var(--accent)', color: '#000',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)',
            letterSpacing: 1, transition: 'all 0.15s'
          }}>
            {loading ? 'AUTENTICANDO...' : 'ENTRAR'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'flex', alignItems: 'center', gap: 5,
  fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6,
  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1
}

const inputStyle = {
  width: '100%', padding: '9px 12px', background: 'var(--bg)',
  border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)',
  fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)'
}
