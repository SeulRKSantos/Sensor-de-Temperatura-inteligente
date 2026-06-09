import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../hooks/api'
import { Bell, Mail, Settings, Send, CheckCircle, Clock, Thermometer, Droplets, WifiOff, ChevronDown, ChevronUp } from 'lucide-react'

const ALERT_TYPES = [
  { key: 'temp_high',      label: 'Temperatura Alta',     icon: <Thermometer size={14} />, color: 'var(--danger)' },
  { key: 'temp_normal',    label: 'Temperatura Normal',   icon: <Thermometer size={14} />, color: 'var(--ok)' },
  { key: 'humid_high',     label: 'Umidade Alta',         icon: <Droplets size={14} />,    color: 'var(--accent2)' },
  { key: 'humid_normal',   label: 'Umidade Normal',       icon: <Droplets size={14} />,    color: 'var(--ok)' },
  { key: 'sensor_offline', label: 'Sensor Offline',       icon: <WifiOff size={14} />,     color: 'var(--warn)' },
  { key: 'sensor_online',  label: 'Sensor Online',        icon: <Bell size={14} />,        color: 'var(--ok)' },
  { key: 'daily',          label: 'Relatório Diário',     icon: <Mail size={14} />,        color: 'var(--muted)' },
  { key: 'weekly',         label: 'Relatório Semanal',    icon: <Mail size={14} />,        color: 'var(--muted)' },
  { key: 'monthly',        label: 'Relatório Mensal',     icon: <Mail size={14} />,        color: 'var(--muted)' },
]

export default function AlertsPage() {
  const { getToken, can } = useAuth()
  const [sensors, setSensors]     = useState([])
  const [selected, setSelected]   = useState(null)
  const [alerts, setAlerts]       = useState({})
  const [smtp, setSmtp]           = useState({})
  const [history, setHistory]     = useState([])
  const [tab, setTab]             = useState('alerts') // alerts | smtp | history
  const [expanded, setExpanded]   = useState(null)
  const [status, setStatus]       = useState('')
  const [saving, setSaving]       = useState(false)
  const [testing, setTesting]     = useState(null)

  useEffect(() => {
    api.getSensors(getToken()).then(setSensors)
    if (can(['admin'])) api.getSmtp(getToken()).then(setSmtp)
  }, [])

  useEffect(() => {
    if (!selected) return
    api.getAlerts(selected, getToken()).then(setAlerts)
    api.getAlertHistory(selected, getToken()).then(setHistory)
  }, [selected])

  async function saveAlerts() {
    setSaving(true)
    try {
      await api.saveAlerts(selected, alerts, getToken())
      setStatus('Alertas salvos com sucesso!')
    } catch (e) {
      setStatus('Erro: ' + e.message)
    }
    setSaving(false)
    setTimeout(() => setStatus(''), 4000)
  }

  async function saveSmtp() {
    setSaving(true)
    try {
      await api.saveSmtp(smtp, getToken())
      setStatus('SMTP salvo com sucesso!')
    } catch (e) {
      setStatus('Erro: ' + e.message)
    }
    setSaving(false)
    setTimeout(() => setStatus(''), 4000)
  }

  async function testAlert(type) {
    if (!selected) return
    setTesting(type)
    try {
      await api.testAlert(selected, type, getToken())
      setStatus(`Email de teste "${type}" enviado!`)
    } catch (e) {
      setStatus('Erro: ' + e.message)
    }
    setTesting(null)
    setTimeout(() => setStatus(''), 4000)
  }

  function updateAlert(type, field, value) {
    setAlerts(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value }
    }))
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Alertas & Notificações</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
          Configure emails de alerta por sensor
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
        {/* Sidebar sensores */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Sensores
          </div>
          {sensors.map(s => (
            <button key={s.id} onClick={() => setSelected(s.id)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: selected === s.id ? 'rgba(26,79,214,0.15)' : 'transparent',
              color: selected === s.id ? 'var(--accent)' : 'var(--text)',
              fontSize: 13, marginBottom: 2
            }}>
              <div style={{ fontWeight: 500 }}>{s.name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{s.id}</div>
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div>
          {!selected ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Selecione um sensor para configurar os alertas
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                {[
                  { key: 'alerts', label: 'Alertas' },
                  can(['admin']) ? { key: 'smtp', label: 'Servidor SMTP' } : null,
                  { key: 'history', label: 'Histórico de Envios' },
                ].filter(Boolean).map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)} style={{
                    padding: '6px 16px', borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: tab === t.key ? 'var(--accent)' : 'var(--surface)',
                    color: tab === t.key ? '#000' : 'var(--muted)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
                  }}>{t.label}</button>
                ))}
              </div>

              {/* Tab: Alertas */}
              {tab === 'alerts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ALERT_TYPES.map(({ key, label, icon, color }) => {
                    const cfg = alerts[key] || {}
                    const isOpen = expanded === key
                    return (
                      <div key={key} style={{
                        background: 'var(--surface)', border: `1px solid ${cfg.enabled ? color + '44' : 'var(--border)'}`,
                        borderRadius: 10, overflow: 'hidden'
                      }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 10 }}
                          onClick={() => setExpanded(isOpen ? null : key)}>
                          <span style={{ color }}>{icon}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                            onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={cfg.enabled || false}
                              onChange={e => updateAlert(key, 'enabled', e.target.checked)} />
                            <span style={{ fontSize: 11, color: cfg.enabled ? 'var(--ok)' : 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                              {cfg.enabled ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </label>
                          {isOpen ? <ChevronUp size={14} color="var(--muted)" /> : <ChevronDown size={14} color="var(--muted)" />}
                        </div>

                        {/* Conteúdo expandido */}
                        {isOpen && (
                          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14 }}>
                              {[
                                { f: 'to',  label: 'Para (To)' },
                                { f: 'cc',  label: 'Cópia (CC)' },
                                { f: 'bcc', label: 'Cópia Oculta (BCC)' },
                              ].map(({ f, label }) => (
                                <div key={f}>
                                  <label style={lblStyle}>{label}</label>
                                  <input value={cfg[f] || ''} onChange={e => updateAlert(key, f, e.target.value)}
                                    placeholder="email1@x.com, email2@x.com" style={inpStyle} />
                                </div>
                              ))}
                            </div>

                            <div style={{ marginTop: 12 }}>
                              <label style={lblStyle}>Assunto</label>
                              <input value={cfg.subject || ''} onChange={e => updateAlert(key, 'subject', e.target.value)} style={inpStyle} />
                            </div>

                            <div style={{ marginTop: 10 }}>
                              <label style={lblStyle}>
                                Corpo do email
                                <span style={{ color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                                  variáveis: {'{{sensor_name}} {{temperature}} {{humidity}} {{datetime}} {{location}} {{temp_limit}} {{humid_limit}}'}
                                </span>
                              </label>
                              <textarea value={cfg.body || ''} onChange={e => updateAlert(key, 'body', e.target.value)}
                                rows={4} style={{ ...inpStyle, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                            </div>

                            {can(['admin', 'editor']) && (
                              <button onClick={() => testAlert(key)} disabled={testing === key} style={{
                                marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
                                padding: '7px 14px', background: 'transparent',
                                border: '1px solid var(--border2)', borderRadius: 6,
                                color: 'var(--muted)', cursor: 'pointer', fontSize: 11,
                                fontFamily: 'var(--font-mono)'
                              }}>
                                <Send size={12} />
                                {testing === key ? 'Enviando...' : 'Enviar email de teste'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {can(['admin', 'editor']) && (
                    <button onClick={saveAlerts} disabled={saving} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
                      background: 'var(--accent)', color: '#000', border: 'none',
                      borderRadius: 8, cursor: 'pointer', fontSize: 13,
                      fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 4, alignSelf: 'flex-start'
                    }}>
                      <CheckCircle size={14} />
                      {saving ? 'Salvando...' : 'Salvar configurações'}
                    </button>
                  )}
                </div>
              )}

              {/* Tab: SMTP */}
              {tab === 'smtp' && can(['admin']) && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Servidor de Saída de Email (SMTP)</h3>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                    Configuração global usada por todos os sensores para envio de alertas.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {[
                      { k: 'fromName', label: 'Nome do Remetente', placeholder: 'TH-GUARD' },
                      { k: 'host',     label: 'Servidor SMTP',     placeholder: 'smtp.gmail.com' },
                      { k: 'port',     label: 'Porta',             placeholder: '587' },
                      { k: 'user',     label: 'Email / Usuário',   placeholder: 'seu@email.com' },
                    ].map(({ k, label, placeholder }) => (
                      <div key={k}>
                        <label style={lblStyle}>{label}</label>
                        <input value={smtp[k] || ''} onChange={e => setSmtp(p => ({ ...p, [k]: e.target.value }))}
                          placeholder={placeholder} style={inpStyle} />
                      </div>
                    ))}
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={lblStyle}>Senha / App Password</label>
                      <input type="password" value={smtp.pass || ''} onChange={e => setSmtp(p => ({ ...p, pass: e.target.value }))}
                        placeholder="••••••••••••" style={inpStyle} />
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                        Para Gmail: use uma <strong>Senha de App</strong> (conta Google → Segurança → Senhas de app)
                      </p>
                    </div>
                  </div>
                  <button onClick={saveSmtp} disabled={saving} style={{
                    marginTop: 16, display: 'flex', alignItems: 'center', gap: 6,
                    padding: '9px 18px', background: 'var(--accent)', color: '#000',
                    border: 'none', borderRadius: 7, cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)'
                  }}>
                    <CheckCircle size={13} />
                    {saving ? 'Salvando...' : 'Salvar SMTP'}
                  </button>
                </div>
              )}

              {/* Tab: Histórico */}
              {tab === 'history' && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  {history.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      Nenhum email enviado ainda para este sensor.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Tipo', 'Assunto', 'Para', 'Data/Hora'].map(h => (
                            <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)', background: 'rgba(26,79,214,0.12)', color: 'var(--accent)' }}>
                                {h.type}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text)' }}>{h.subject}</td>
                            <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{h.to}</td>
                            <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                              {new Date(h.ts).toLocaleString('pt-BR')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {status && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 12, background: 'rgba(26,79,214,0.08)', border: '1px solid rgba(26,79,214,0.3)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {status}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const lblStyle = {
  display: 'block', fontSize: 10, color: 'var(--muted)',
  fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
  letterSpacing: 1, marginBottom: 4
}
const inpStyle = {
  width: '100%', padding: '8px 10px', background: 'var(--bg)',
  border: '1px solid var(--border2)', borderRadius: 6,
  color: 'var(--text)', fontSize: 13, outline: 'none',
  fontFamily: 'var(--font-body)', boxSizing: 'border-box'
}
