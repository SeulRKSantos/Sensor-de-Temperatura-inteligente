import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../hooks/api'
import { useAuth } from '../context/AuthContext'
import { useRealtimeData } from '../hooks/useRealtimeData'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { ArrowLeft, Thermometer, Droplets, Zap, RefreshCw, Trash2, Save } from 'lucide-react'

const RANGES = [
  { label: '1h',  value: '1h' },
  { label: '6h',  value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '168h' },
]

export default function SensorDetailPage() {
  const { id } = useParams()
  const { getToken, can } = useAuth()
  const navigate = useNavigate()
  const [sensor, setSensor]       = useState(null)
  const [history, setHistory]     = useState([])
  const [range, setRange]         = useState('24h')
  const [liveTemp, setLiveTemp]   = useState(null)
  const [liveHumid, setLiveHumid] = useState(null)
  const [tab, setTab]             = useState('chart')
  const [config, setConfig]       = useState({})
  const [cmdStatus, setCmdStatus] = useState('')
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    api.getSensor(id, getToken()).then(s => {
      setSensor(s)
      setConfig({ name: s.name, location: s.location, tempLimit: s.tempLimit, humidLimit: s.humidLimit })
    })
  }, [id])

  useEffect(() => {
    api.getHistory(id, range, getToken()).then(data => {
      setHistory(data.map(d => ({
        ts: new Date(d.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        temperature: d.temperature != null ? parseFloat(d.temperature.toFixed(1)) : null,
        humidity:    d.humidity    != null ? parseFloat(d.humidity.toFixed(1))    : null,
      })))
    }).catch(console.error)
  }, [id, range])

  const handleMsg = useCallback((msg) => {
    if (msg.type === 'reading' && msg.sensorId === id) {
      setLiveTemp(msg.temperature)
      setLiveHumid(msg.humidity)
      setHistory(prev => [...prev.slice(-200), {
        ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        temperature: msg.temperature, humidity: msg.humidity
      }])
    }
  }, [id])

  useRealtimeData(handleMsg)

  async function saveConfig() {
    setSaving(true)
    try {
      await api.updateSensor(id, config, getToken())
      if (can(['admin', 'editor'])) {
        await api.sendCommand(id, { action: 'set_config', tempLimit: config.tempLimit, humidLimit: config.humidLimit, location: config.location }, getToken())
      }
      setSensor(prev => ({ ...prev, ...config }))
      setCmdStatus('Configurações salvas com sucesso!')
    } catch (e) { setCmdStatus('Erro: ' + e.message) }
    finally { setSaving(false); setTimeout(() => setCmdStatus(''), 4000) }
  }

  async function sendNetworkConfig(e) {
    e.preventDefault()
    const form = new FormData(e.target)
    try {
      await api.sendCommand(id, { action: 'set_config', ssid1: form.get('ssid1'), pass1: form.get('pass1'), ssid2: form.get('ssid2'), pass2: form.get('pass2'), serverIp: form.get('serverIp') }, getToken())
      setCmdStatus('Comando de rede enviado!')
    } catch (e) { setCmdStatus('Erro: ' + e.message) }
    setTimeout(() => setCmdStatus(''), 5000)
  }

  async function sendCmd(action) {
    try { await api.sendCommand(id, { action }, getToken()); setCmdStatus(`Comando "${action}" enviado.`) }
    catch (e) { setCmdStatus('Erro: ' + e.message) }
    setTimeout(() => setCmdStatus(''), 4000)
  }

  if (!sensor) return <div style={{ color: 'var(--muted)', padding: 40, fontFamily: 'var(--font-mono)', fontSize: 13 }}>Carregando...</div>

  const temp  = liveTemp  ?? '—'
  const humid = liveHumid ?? '—'
  const tempDanger  = typeof temp  === 'number' && temp  >= sensor.tempLimit
  const humidDanger = typeof humid === 'number' && humid >= sensor.humidLimit

  return (
    <div>
      <style>{`
        .live-grid   { grid-template-columns: 1fr 1fr 1fr !important; }
        .config-grid { grid-template-columns: 1fr 1fr !important; }
        .chart-h     { height: 260px !important; }
        @media(max-width:768px){
          .live-grid   { grid-template-columns: 1fr 1fr !important; }
          .config-grid { grid-template-columns: 1fr !important; }
          .chart-h     { height: 200px !important; }
          .tab-label   { font-size: 10px !important; padding: 5px 10px !important; }
          .range-btn   { padding: 4px 8px !important; font-size: 10px !important; }
          .cmd-wrap    { flex-wrap: wrap !important; }
        }
        @media(max-width:480px){
          .live-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={15} />
        </button>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>{sensor.name}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{sensor.id} · {sensor.location}</p>
        </div>
      </div>

      {/* Live readings */}
      <div className="live-grid" style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <LiveCard icon={<Thermometer size={16} color={tempDanger ? 'var(--danger)' : 'var(--temp)'} />}
          label="Temperatura" value={typeof temp === 'number' ? temp.toFixed(1) : '—'} unit="°C"
          danger={tempDanger} valueColor="var(--temp)" sub={`Limite: ${sensor.tempLimit}°C`} />
        <LiveCard icon={<Droplets size={16} color={humidDanger ? 'var(--danger)' : 'var(--accent2)'} />}
          label="Umidade" value={typeof humid === 'number' ? humid.toFixed(1) : '—'} unit="%"
          danger={humidDanger} valueColor="var(--accent2)" sub={`Limite: ${sensor.humidLimit}%`} />
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>REDE</div>
          <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{sensor.ip || '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sensor.ssid || '—'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, overflowX: 'auto', paddingBottom: 2 }}>
        {['chart', can(['admin','editor']) && 'config', can(['admin','editor']) && 'commands'].filter(Boolean).map(t => (
          <button key={t} className="tab-label" onClick={() => setTab(t)} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', whiteSpace: 'nowrap',
            background: tab === t ? 'var(--accent)' : 'var(--surface)',
            color: tab === t ? '#fff' : 'var(--muted)',
            cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
          }}>
            {t === 'chart' ? 'Gráfico' : t === 'config' ? 'Configurar' : 'Comandos'}
          </button>
        ))}
      </div>

      {/* Chart */}
      {tab === 'chart' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Histórico</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {RANGES.map(r => (
                <button key={r.value} className="range-btn" onClick={() => setRange(r.value)} style={{
                  padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
                  background: range === r.value ? 'rgba(26,79,214,0.2)' : 'transparent',
                  color: range === r.value ? 'var(--accent)' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)'
                }}>{r.label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" className="chart-h" height={260}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="ts" tick={{ fill: 'var(--muted)', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 9 }} width={32} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} labelStyle={{ color: 'var(--muted)' }} />
              <Line type="monotone" dataKey="temperature" stroke="var(--temp)"    dot={false} name="Temp °C"  strokeWidth={2} />
              <Line type="monotone" dataKey="humidity"    stroke="var(--accent2)" dot={false} name="Umidade %" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Config */}
      {tab === 'config' && can(['admin','editor']) && (
        <div className="config-grid" style={{ display: 'grid', gap: 14 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Identificação e Limites</h3>
            {[
              { key: 'name',       label: 'Nome do sensor',          type: 'text'   },
              { key: 'location',   label: 'Localização',             type: 'text'   },
              { key: 'tempLimit',  label: 'Limite temperatura (°C)', type: 'number' },
              { key: 'humidLimit', label: 'Limite umidade (%)',      type: 'number' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={lblStyle}>{f.label}</label>
                <input type={f.type} value={config[f.key] ?? ''}
                  onChange={e => setConfig(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
                  style={inpStyle} />
              </div>
            ))}
            <button onClick={saveConfig} disabled={saving} style={btnPrimary}>
              <Save size={13} /> {saving ? 'Salvando...' : 'Salvar e enviar ao sensor'}
            </button>
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Configuração de Rede</h3>
            <form onSubmit={sendNetworkConfig}>
              {[
                { name: 'ssid1',    label: 'WiFi Primário (SSID)'  },
                { name: 'pass1',    label: 'Senha WiFi Primário'    },
                { name: 'ssid2',    label: 'WiFi Secundário (SSID)' },
                { name: 'pass2',    label: 'Senha WiFi Secundário'  },
                { name: 'serverIp', label: 'IP do servidor MQTT'    },
              ].map(f => (
                <div key={f.name} style={{ marginBottom: 10 }}>
                  <label style={lblStyle}>{f.label}</label>
                  <input name={f.name} style={inpStyle} placeholder="—" />
                </div>
              ))}
              <button type="submit" style={btnPrimary}><Zap size={13} /> Enviar config de rede</button>
            </form>
          </div>
        </div>
      )}

      {/* Commands */}
      {tab === 'commands' && can(['admin','editor']) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Comandos remotos</h3>
          <div className="cmd-wrap" style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => sendCmd('restart')} style={{ ...btnSecondary, borderColor: 'rgba(232,149,10,0.4)', color: 'var(--warn)' }}>
              <RefreshCw size={13} /> Reiniciar sensor
            </button>
            <button onClick={() => sendCmd('reset_eeprom')} style={{ ...btnSecondary, borderColor: 'rgba(224,60,60,0.4)', color: 'var(--danger)' }}>
              <Trash2 size={13} /> Resetar EEPROM
            </button>
          </div>
        </div>
      )}

      {cmdStatus && (
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 12, background: 'rgba(26,79,214,0.08)', border: '1px solid rgba(26,79,214,0.3)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
          {cmdStatus}
        </div>
      )}
    </div>
  )
}

function LiveCard({ icon, label, value, unit, danger, sub, valueColor }) {
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${danger ? 'rgba(224,60,60,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: danger ? 'var(--danger)' : (valueColor || 'var(--text)'), lineHeight: 1 }}>
        {value}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 2 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>{sub}</div>
    </div>
  )
}

const lblStyle = { display: 'block', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }
const inpStyle = { width: '100%', padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)', boxSizing: 'border-box' }
const btnPrimary = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '9px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)' }
const btnSecondary = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }
