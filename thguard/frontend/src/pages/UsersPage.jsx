import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../hooks/api'
import { Plus, Trash2, Edit2, X, Check } from 'lucide-react'

const ROLES = ['admin', 'editor', 'viewer']
const ROLE_LABELS = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador' }
const ROLE_COLORS = { admin: 'var(--danger)', editor: 'var(--warn)', viewer: 'var(--accent2)' }

export default function UsersPage() {
  const { getToken, user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'viewer' })
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const data = await api.getUsers(getToken())
    setUsers(data)
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      if (editId) {
        const body = { name: form.name, email: form.email, role: form.role }
        if (form.password) body.password = form.password
        await api.updateUser(editId, body, getToken())
      } else {
        await api.createUser(form, getToken())
      }
      setShowForm(false)
      setEditId(null)
      setForm({ name: '', email: '', password: '', role: 'viewer' })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(id) {
    if (id === me.id) return alert('Você não pode se remover.')
    if (!confirm('Remover usuário?')) return
    await api.deleteUser(id, getToken())
    load()
  }

  function startEdit(u) {
    setEditId(u.id)
    setForm({ name: u.name, email: u.email, password: '', role: u.role })
    setShowForm(true)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Usuários</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Gerenciar acesso à plataforma</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', email: '', password: '', role: 'viewer' }) }} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 7,
          cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)'
        }}>
          <Plus size={14} /> Novo usuário
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 20, marginBottom: 20
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>{editId ? 'Editar usuário' : 'Novo usuário'}</h3>
            <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { key: 'name', label: 'Nome', type: 'text', required: true },
                { key: 'email', label: 'E-mail', type: 'email', required: true },
                { key: 'password', label: editId ? 'Nova senha (opcional)' : 'Senha', type: 'password', required: !editId },
              ].map(f => (
                <div key={f.key}>
                  <label style={lblStyle}>{f.label}</label>
                  <input type={f.type} value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    required={f.required} style={inpStyle} />
                </div>
              ))}
              <div>
                <label style={lblStyle}>Perfil de acesso</label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} style={{ ...inpStyle }}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            {error && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
            <button type="submit" style={{
              marginTop: 16, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
              cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)'
            }}>
              <Check size={13} /> {editId ? 'Salvar alterações' : 'Criar usuário'}
            </button>
          </form>
        </div>
      )}

      {/* Tabela */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nome', 'E-mail', 'Perfil', 'Criado em', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13 }}>
                  {u.name} {u.id === me.id && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>(você)</span>}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{u.email}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                    background: `${ROLE_COLORS[u.role]}18`, color: ROLE_COLORS[u.role]
                  }}>
                    {ROLE_LABELS[u.role]}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => startEdit(u)} style={iconBtn}>
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => remove(u.id)} style={{ ...iconBtn, color: 'var(--danger)' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legenda de roles */}
      <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 8, textTransform: 'uppercase' }}>Permissões por perfil</div>
        <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--muted)' }}>
          <span><span style={{ color: 'var(--danger)', fontWeight: 600 }}>Admin</span> — tudo, incluindo usuários e delete de sensores</span>
          <span><span style={{ color: 'var(--warn)', fontWeight: 600 }}>Editor</span> — configura e envia comandos para sensores</span>
          <span><span style={{ color: 'var(--accent2)', fontWeight: 600 }}>Visualizador</span> — apenas leitura dos dados e gráficos</span>
        </div>
      </div>
    </div>
  )
}

const lblStyle = {
  display: 'block', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4
}
const inpStyle = {
  width: '100%', padding: '8px 10px', background: 'var(--bg)',
  border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)',
  fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)'
}
const iconBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: '1px solid var(--border)', borderRadius: 5,
  color: 'var(--muted)', cursor: 'pointer', padding: 5
}
