import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../hooks/api'
import { useAuth } from '../context/AuthContext'
import { useRealtimeData } from '../hooks/useRealtimeData'
import { Thermometer, Droplets, Wifi, WifiOff, AlertTriangle } from 'lucide-react'

export default function DashboardPage() {
  const { getToken } = useAuth()
  const [sensors, setSensors] = useState([])
  const [liveData, setLiveData] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    api.getSensors(getToken()).then(setSensors).catch(console.error)
  }, [])

  const handleMsg = useCallback((msg) => {
    if (msg.type === 'reading') {
      setLiveData(prev => ({
        ...prev,
        [msg.sensorId]: { temperature: msg.temperature, humidity: msg.humidity, ts: msg.ts }
      }))
    }
    if (msg.type === 'status') {
      setSensors(prev => prev.map(s =>
        s.id === msg.sensorId ? { ...s, online: true, lastSeen: new Date().toISOString(), ip: msg.ip, ssid: msg.ssid } : s
      ))
    }
    if (msg.type === 'alert') {
      setSensors(prev => prev.map(s =>
        s.id === msg.sensorId ? { ...s, alertActive: msg.isAlert } : s
      ))
    }
  }, [])

  useRealtimeData(handleMsg)

  const alertCount  = sensors.filter(s => s.alertActive).length
  const onlineCount = sensors.filter(s => s.online).length

  return (
    <div>
      <style>{`
        .stat-grid   { grid-template-columns: repeat(3,1fr) !important; }
        .sensor-grid { grid-template-columns: repeat(auto-fill,minmax(280px,1fr)) !important; }
        @media(max-width:768px){
          .stat-grid   { grid-template-columns: repeat(3,1fr) !important; }
          .sensor-grid { grid-template-columns: 1fr !important; }
          .stat-val    { font-size: 22px !important; }
        }
        @media(max-width:480px){
          .stat-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>Dashboard</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
          {sensors.length} sensores · {onlineCount} online · {alertCount} em alerta
        </p>
      </div>

      <div className="stat-grid" style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <StatCard label="Sensores" value={sensors.length}  icon={<Thermometer size={16} color="var(--accent2)" />} color="var(--accent2)" />
        <StatCard label="Online"   value={onlineCount}     icon={<Wifi size={16} color="var(--accent)" />}         color="var(--accent)" />
        <StatCard label="Alertas"  value={alertCount}      icon={<AlertTriangle size={16} color={alertCount > 0 ? 'var(--danger)' : 'var(--muted)'} />} color={alertCount > 0 ? 'var(--danger)' : 'var(--muted)'} />
      </div>

      {sensors.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>
          Aguardando conexão dos sensores...
        </div>
      ) : (
        <div className="sensor-grid" style={{ display: 'grid', gap: 12 }}>
          {sensors.map(sensor => {
            const live  = liveData[sensor.id]
            const temp  = live?.temperature ?? '—'
            const humid = live?.humidity    ?? '—'
            const isAlert  = sensor.alertActive
            const isOnline = sensor.online

            return (
              <div key={sensor.id} style={{
                background: 'var(--surface)',
                border: `1px solid ${isAlert ? 'rgba(224,60,60,0.4)' : 'var(--border)'}`,
                borderRadius: 10, padding: 16, cursor: 'pointer',
                boxShadow: isAlert ? '0 0 20px rgba(224,60,60,0.06)' : 'none'
              }} onClick={() => navigate(`/sensor/${sensor.id}`)}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{sensor.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sensor.location}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isAlert && <AlertTriangle size={14} color="var(--danger)" />}
                    {isOnline ? <Wifi size={14} color="var(--accent)" /> : <WifiOff size={14} color="var(--muted)" />}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <ReadingBox
                    icon={<Thermometer size={14} color={typeof temp === 'number' && temp >= sensor.tempLimit ? 'var(--danger)' : 'var(--temp)'} />}
                    label="TEMP" value={typeof temp === 'number' ? temp.toFixed(1) : temp}
                    unit="°C" danger={typeof temp === 'number' && temp >= sensor.tempLimit} valueColor="var(--temp)"
                  />
                  <ReadingBox
                    icon={<Droplets size={14} color={typeof humid === 'number' && humid >= sensor.humidLimit ? 'var(--danger)' : 'var(--accent2)'} />}
                    label="HUMID" value={typeof humid === 'number' ? humid.toFixed(1) : humid}
                    unit="%" danger={typeof humid === 'number' && humid >= sensor.humidLimit} valueColor="var(--accent2)"
                  />
                </div>

                {sensor.ip && (
                  <div style={{ marginTop: 10, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {sensor.ip} · {sensor.ssid}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
    }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
        <div className="stat-val" style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'var(--font-mono)', lineHeight: 1.2, marginTop: 4 }}>{value}</div>
      </div>
      {icon}
    </div>
  )
}

function ReadingBox({ icon, label, value, unit, danger, valueColor }) {
  return (
    <div style={{
      background: 'var(--bg)',
      border: `1px solid ${danger ? 'rgba(224,60,60,0.3)' : 'var(--border)'}`,
      borderRadius: 8, padding: '10px 12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: danger ? 'var(--danger)' : 'var(--muted)', marginBottom: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
        {icon} {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: danger ? 'var(--danger)' : (valueColor || 'var(--text)') }}>
        {value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  )
}
