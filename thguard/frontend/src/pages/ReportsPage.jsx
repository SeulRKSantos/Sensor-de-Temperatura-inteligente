import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../hooks/api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Download, BarChart2 } from 'lucide-react'

const PERIODS = [
  { key: 'monthly',    label: 'Mensal (30 dias)',    range: '720h' },
  { key: 'semiannual', label: 'Semestral (6 meses)', range: '4320h' },
  { key: 'annual',     label: 'Anual (12 meses)',    range: '8760h' },
]

export default function ReportsPage() {
  const { getToken } = useAuth()
  const [sensors, setSensors]   = useState([])
  const [selected, setSelected] = useState(null)
  const [period, setPeriod]     = useState('monthly')
  const [data, setData]         = useState([])
  const [stats, setStats]       = useState({})
  const [loading, setLoading]   = useState(false)

  useEffect(() => { api.getSensors(getToken()).then(setSensors) }, [])

  useEffect(() => { if (selected) loadData() }, [selected, period])

  async function loadData() {
    setLoading(true)
    try {
      const p = PERIODS.find(p => p.key === period)
      const [hist, st] = await Promise.all([
        api.getHistory(selected, p.range, getToken()),
        api.getStats(selected, p.range, getToken()),
      ])
      setData(aggregateByDay(hist))
      setStats(st)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function aggregateByDay(rows) {
    const byDay = {}
    rows.forEach(r => {
      const day = new Date(r.ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      if (!byDay[day]) byDay[day] = { temps: [], humids: [], day }
      if (r.temperature != null) byDay[day].temps.push(r.temperature)
      if (r.humidity    != null) byDay[day].humids.push(r.humidity)
    })
    return Object.values(byDay).map(d => ({
      day:         d.day,
      temperature: d.temps.length  ? +(d.temps.reduce((a,b)=>a+b,0)  / d.temps.length).toFixed(1)  : null,
      humidity:    d.humids.length ? +(d.humids.reduce((a,b)=>a+b,0) / d.humids.length).toFixed(1) : null,
    }))
  }

  async function downloadCSV() {
    try {
      const res  = await api.downloadReport(selected, period, getToken())
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `${selected}_${period}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert('Erro ao baixar: ' + e.message) }
  }

  const sensor = sensors.find(s => s.id === selected)

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Relatórios</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
          Histórico mensal, semestral e anual por sensor
        </p>
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selected || ''} onChange={e => setSelected(e.target.value)} style={selStyle}>
          <option value="">Selecione o sensor...</option>
          {sensors.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
        </select>

        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{
              padding: '7px 14px', borderRadius: 6,
              border: `1px solid ${period === p.key ? 'var(--accent)' : 'var(--border)'}`,
              background: period === p.key ? 'rgba(26,79,214,0.2)' : 'var(--surface)',
              color: period === p.key ? 'var(--accent)' : 'var(--muted)',
              cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: period === p.key ? 700 : 400
            }}>{p.label}</button>
          ))}
        </div>

        {selected && (
          <button onClick={downloadCSV} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--muted)', cursor: 'pointer', fontSize: 12,
            fontFamily: 'var(--font-mono)', marginLeft: 'auto'
          }}>
            <Download size={13} /> Exportar CSV
          </button>
        )}
      </div>

      {!selected ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 60, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Selecione um sensor para visualizar os relatórios
        </div>
      ) : loading ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 60, textAlign: 'center', color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
          Carregando dados...
        </div>
      ) : (
        <>
          {/* Cards de estatísticas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Média Temperatura', value: stats.temperature != null ? stats.temperature.toFixed(1) + '°C' : '--', color: 'var(--temp)' },
              { label: 'Média Umidade',     value: stats.humidity    != null ? stats.humidity.toFixed(1)    + '%'  : '--', color: 'var(--accent2)' },
              { label: 'Pontos de dados',   value: data.length,                                                             color: 'var(--muted)' },
              { label: 'Período',           value: PERIODS.find(p => p.key === period)?.label,                              color: 'var(--muted)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Gráfico */}
          {data.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 60, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              <BarChart2 size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div>Sem dados para o período selecionado.</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>O InfluxDB retém dados conforme a configuração de retenção do bucket.</div>
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
                {sensor?.name} — Médias diárias ({PERIODS.find(p => p.key === period)?.label})
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="t" tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                  <YAxis yAxisId="h" orientation="right" tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: 'var(--muted)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
                  <Line yAxisId="t" type="monotone" dataKey="temperature" stroke="var(--temp)"    dot={false} name="Temp °C"   strokeWidth={2} connectNulls />
                  <Line yAxisId="h" type="monotone" dataKey="humidity"    stroke="var(--accent2)" dot={false} name="Umidade %"  strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>

              {/* Tabela */}
              <div style={{ marginTop: 20, maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Data', 'Temp média (°C)', 'Umidade média (%)'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{r.day}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--temp)' }}>{r.temperature ?? '--'}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--accent2)' }}>{r.humidity ?? '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const selStyle = {
  padding: '7px 12px', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 13, outline: 'none',
  fontFamily: 'var(--font-body)', minWidth: 220
}
