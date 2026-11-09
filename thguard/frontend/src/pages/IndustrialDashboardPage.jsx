import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../hooks/api'
import { useAuth } from '../context/AuthContext'
import { useRealtimeData } from '../hooks/useRealtimeData'
import { Factory, Wifi, WifiOff, AlertTriangle, Zap, PowerOff } from 'lucide-react'
import { statusOf, FAULT_INFO, isOff } from '../lib/industrial'

export default function IndustrialDashboardPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [sensors, setSensors] = useState([])
  const [live, setLive] = useState({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api.getSensors(getToken(), 'industrial').then(list => {
      setSensors(list)
      const init = {}
      list.forEach(s => { if (s.last) init[s.id] = s.last })
      setLive(init)
    }).catch(console.error).finally(() => setLoaded(true))
  }, [])

  const handleMsg = useCallback((msg) => {
    if (msg.type === 'reading' && msg.kind === 'industrial') {
      setLive(prev => ({ ...prev, [msg.sensorId]: msg }))
      setSensors(prev => prev.map(s => s.id === msg.sensorId ? { ...s, online: true } : s))
    }
    if (msg.type === 'status') {
      setSensors(prev => prev.map(s =>
        s.id !== msg.sensorId ? s
          : msg.online === false ? { ...s, online: false }
          : { ...s, online: true, ip: msg.ip ?? s.ip, ssid: msg.ssid ?? s.ssid }
      ))
    }
    if (msg.type === 'sensor_registered' && msg.kind === 'industrial') {
      api.getSensors(getToken(), 'industrial').then(setSensors).catch(() => {})
    }
  }, [])

  useRealtimeData(handleMsg)

  const online = sensors.filter(s => s.online).length
  const alarm  = sensors.filter(s => s.alertActive).length
  const faults = sensors.filter(s => s.online && live[s.id]?.fault === 'upscale').length
  const offs   = sensors.filter(s => s.online && isOff(live[s.id])).length

  // Agrupa pelo grupo (tag) do sensor
  const groups = {}
  sensors.forEach(s => { const g = s.tag || 'Sem grupo'; (groups[g] = groups[g] || []).push(s) })
  const groupNames = Object.keys(groups).sort((a, b) => a === 'Sem grupo' ? 1 : b === 'Sem grupo' ? -1 : a.localeCompare(b))

  return (
    <div>
      <style>{`
        .ind-stats { grid-template-columns: repeat(5,1fr) !important; }
        .ind-grid  { grid-template-columns: repeat(auto-fill,minmax(290px,1fr)) !important; }
        @media(max-width:768px){
          .ind-stats { grid-template-columns: repeat(2,1fr) !important; }
          .ind-grid  { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Factory size={18} color="var(--accent2)" /> Sensores industriais
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
          {sensors.length} sensores · {online} online · {alarm} em alarme · {faults} com falha · {offs} com indicador Therma desligado
        </p>
      </div>

      <div className="ind-stats" style={{ display: 'grid', gap: 12, marginBottom: 22 }}>
        <Stat label="Sensores" value={sensors.length} color="var(--accent2)" icon={<Factory size={16} color="var(--accent2)" />} />
        <Stat label="Online"   value={online} color="var(--accent)" icon={<Wifi size={16} color="var(--accent)" />} />
        <Stat label="Alarme"   value={alarm}  color={alarm ? 'var(--danger)' : 'var(--muted)'} icon={<AlertTriangle size={16} color={alarm ? 'var(--danger)' : 'var(--muted)'} />} />
        <Stat label="Falha upscale" value={faults} color={faults ? 'var(--danger)' : 'var(--muted)'} icon={<Zap size={16} color={faults ? 'var(--danger)' : 'var(--muted)'} />} />
        <Stat label="Therma desligado" value={offs} color={offs ? 'var(--off)' : 'var(--muted)'} icon={<PowerOff size={16} color={offs ? 'var(--off)' : 'var(--muted)'} />} />
      </div>

      {loaded && sensors.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Nenhum sensor industrial registrado ainda.
          <div style={{ fontSize: 11, marginTop: 6 }}>Ligue um VA01 com o firmware industrial: ele aparece aqui sozinho ao se registrar (ID ind-001, ind-002...).</div>
        </div>
      )}

      {groupNames.map(g => (
        <div key={g} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {g} · {groups[g].length}
          </div>
          <div className="ind-grid" style={{ display: 'grid', gap: 12 }}>
            {groups[g].map(s => <SensorCard key={s.id} sensor={s} live={live[s.id]} onClick={() => navigate(`/industrial/sensor/${s.id}`)} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function SensorCard({ sensor, live, onClick }) {
  const cal = sensor.industrial || { rangeMin: 0, rangeMax: 150 }
  const t = live?.temperature
  const hasT = typeof t === 'number'
  const st = statusOf(sensor, live)
  const off = isOff(live)
  const danger = !off && (sensor.alertActive || (hasT && t >= sensor.tempLimit))
  const span = (cal.rangeMax - cal.rangeMin) || 1
  const pct = hasT ? Math.max(0, Math.min(100, ((t - cal.rangeMin) / span) * 100)) : 0
  const limPct = Math.max(0, Math.min(100, ((sensor.tempLimit - cal.rangeMin) / span) * 100))

  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', cursor: 'pointer', borderRadius: 10, padding: 16,
      border: `1px solid ${danger ? 'rgba(224,60,60,0.45)' : 'var(--border)'}`,
      opacity: sensor.online ? 1 : 0.65,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sensor.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sensor.location} · <span style={{ fontFamily: 'var(--font-mono)' }}>{sensor.id}</span></div>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontFamily: 'var(--font-mono)', color: st.color, border: `1px solid ${st.color}`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
          {sensor.online ? <Wifi size={10} /> : <WifiOff size={10} />} {st.label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {off ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1.55, color: 'var(--off)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <PowerOff size={18} /> DESLIGADO
          </span>
        ) : (
          <>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 700, lineHeight: 1, color: danger ? 'var(--danger)' : 'var(--temp)' }}>
              {hasT ? t.toFixed(1) : '—'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>°C</span>
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {live?.voltage != null ? `${live.voltage.toFixed(2)} V` : '— V'}
        </span>
      </div>

      {/* Posicao na faixa do transmissor + marca do limite */}
      <div style={{ position: 'relative', height: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, marginTop: 12 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: danger ? 'var(--danger)' : 'var(--temp)', borderRadius: 3, transition: 'width .4s' }} />
        <div title={`Limite ${sensor.tempLimit} °C`} style={{ position: 'absolute', left: `${limPct}%`, top: -4, bottom: -4, width: 2, background: 'var(--danger)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 5 }}>
        <span>{cal.rangeMin}°</span>
        <span>limite {sensor.tempLimit}°</span>
        <span>{cal.rangeMax}°</span>
      </div>

      {live?.fault && FAULT_INFO[live.fault] && (
        <div style={{ marginTop: 10, fontSize: 11, color: FAULT_INFO[live.fault].color }}>
          {FAULT_INFO[live.fault].text}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, icon }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'var(--font-mono)', lineHeight: 1.2, marginTop: 4 }}>{value}</div>
      </div>
      {icon}
    </div>
  )
}
