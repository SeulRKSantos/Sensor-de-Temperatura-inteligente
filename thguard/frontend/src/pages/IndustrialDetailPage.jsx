import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../hooks/api'
import { useAuth } from '../context/AuthContext'
import { useRealtimeData } from '../hooks/useRealtimeData'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { ArrowLeft, Thermometer, Zap, Activity, Wifi, RefreshCw, Trash2, Save, Lightbulb, Download, RotateCcw, Crosshair } from 'lucide-react'
import { IND_DEFAULTS, convertMv, statusOf, FAULT_INFO } from '../lib/industrial'

const RANGES = [
  { label: '1h',  value: '1h' },
  { label: '6h',  value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '168h' },
  { label: '30d', value: '720h' },
]

// Campos de calibracao exibidos no painel (ordem e textos)
const CAL_FIELDS = [
  { key: 'rangeMin',   label: 'Temperatura em 0 V (°C)',            step: 1,    hint: 'Início da faixa gravada no TxConfig' },
  { key: 'rangeMax',   label: 'Temperatura de relação (°C)',         step: 1,    hint: 'Fim da faixa: temperatura que o transmissor entrega em 10 V', highlight: true },
  { key: 'vFull',      label: 'Fundo de escala do transmissor (V)',  step: 0.1,  hint: 'TxIsoRail: 10 V' },
  { key: 'divisor',    label: 'Fator do módulo de tensão',           step: 0.01, hint: 'Módulo 0–25 V: 5' },
  { key: 'offsetMv',   label: 'Offset do ADC no pino (mV)',          step: 1,    hint: 'Validado em −16 mV' },
  { key: 'gain',       label: 'Ganho (ajuste fino)',                  step: 0.001, hint: '1,000 = sem ajuste' },
  { key: 'offsetTemp', label: 'Offset de temperatura (°C)',          step: 0.1,  hint: 'Correção final em graus' },
  { key: 'faultV',     label: 'Falha upscale acima de (V)',          step: 0.1,  hint: 'PT100 aberto leva a saída a ~11–12 V' },
  { key: 'lowV',       label: 'Sem sinal abaixo de (V)',             step: 0.01, hint: '0 desativa' },
  { key: 'interval',   label: 'Intervalo de envio do ESP (s)',       step: 1,    hint: '2 a 300 s — enviado ao sensor' },
]

export default function IndustrialDetailPage() {
  const { id } = useParams()
  const { getToken, can } = useAuth()
  const navigate = useNavigate()
  const isEditor = can(['admin', 'editor'])
  const isAdmin  = can(['admin'])

  const [sensor, setSensor]   = useState(null)
  const [error, setError]     = useState('')
  const [live, setLive]       = useState(null)
  const [history, setHistory] = useState([])
  const [range, setRange]     = useState('24h')
  const [showV, setShowV]     = useState(false)
  const [tab, setTab]         = useState('chart')
  const [ident, setIdent]     = useState({})
  const [cal, setCal]         = useState(IND_DEFAULTS)
  const [refTemp, setRefTemp] = useState('')
  const [tagOptions, setTagOptions] = useState([])
  const [status, setStatus]   = useState('')
  const [saving, setSaving]   = useState(false)

  function flash(msg, ms = 4500) { setStatus(msg); setTimeout(() => setStatus(''), ms) }

  function applySensor(s) {
    setSensor(s)
    setIdent({ name: s.name, location: s.location, tag: s.tag || '', tempLimit: s.tempLimit })
    setCal({ ...IND_DEFAULTS, ...(s.industrial || {}) })
    if (s.last) setLive(s.last)
  }

  useEffect(() => {
    api.getSensor(id, getToken()).then(s => {
      if (s.kind !== 'industrial') { navigate(`/sensor/${id}`, { replace: true }); return }
      applySensor(s)
    }).catch(e => setError(e.message))
    api.getTags(getToken()).then(setTagOptions).catch(() => {})
  }, [id])

  const fmtTs = (d) => range === '168h' || range === '720h'
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  useEffect(() => {
    api.getHistory(id, range, getToken()).then(data => {
      setHistory(data.map(d => ({
        ts: fmtTs(new Date(d.ts)),
        temperature: d.temperature != null ? +d.temperature.toFixed(1) : null,
        voltage:     d.voltage     != null ? +d.voltage.toFixed(3)     : null,
      })))
    }).catch(console.error)
  }, [id, range])

  const handleMsg = useCallback((msg) => {
    if (msg.sensorId !== id) return
    if (msg.type === 'reading') {
      setLive(msg)
      setSensor(prev => prev ? { ...prev, online: true } : prev)
      setHistory(prev => [...prev.slice(-300), {
        ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        temperature: msg.temperature != null ? +msg.temperature.toFixed(1) : null,
        voltage: msg.voltage,
      }])
    }
    if (msg.type === 'status') {
      setSensor(prev => !prev ? prev
        : msg.online === false ? { ...prev, online: false }
        : { ...prev, online: true, ip: msg.ip ?? prev.ip, ssid: msg.ssid ?? prev.ssid, fw: msg.fw ?? prev.fw })
    }
  }, [id])

  useRealtimeData(handleMsg)

  async function save() {
    setSaving(true)
    try {
      const body = {
        name: ident.name, location: ident.location, tempLimit: Number(ident.tempLimit),
        industrial: Object.fromEntries(CAL_FIELDS.map(f => [f.key, Number(cal[f.key])])),
      }
      if (isAdmin) body.tag = ident.tag
      const updated = await api.updateSensor(id, body, getToken())
      applySensor({ ...updated, last: live })
      flash('Configuração salva. A nova calibração vale a partir da próxima leitura.')
    } catch (e) { flash('Erro: ' + e.message, 6000) }
    finally { setSaving(false) }
  }

  async function sendCmd(action, label) {
    try { await api.sendCommand(id, { action }, getToken()); flash(`Comando "${label}" enviado.`) }
    catch (e) { flash('Erro: ' + e.message) }
  }

  async function sendNetwork(e) {
    e.preventDefault()
    const f = new FormData(e.target)
    const body = { action: 'set_config' }
    ;['ssid1', 'pass1', 'ssid2', 'pass2', 'serverIp'].forEach(k => { const v = (f.get(k) || '').trim(); if (v) body[k] = v })
    if (Object.keys(body).length === 1) { flash('Preencha ao menos um campo.'); return }
    try {
      await api.sendCommand(id, body, getToken())
      e.target.reset()
      flash('Configuração de rede enviada. O sensor reinicia para aplicar.')
    } catch (err) { flash('Erro: ' + err.message) }
  }

  async function removeSensor() {
    if (!window.confirm(`Excluir ${sensor.name} (${id})? O histórico no InfluxDB é mantido, mas a configuração e os alertas são apagados.`)) return
    try { await api.deleteSensor(id, getToken()); navigate('/industrial') }
    catch (e) { flash('Erro: ' + e.message) }
  }

  async function downloadCSV() {
    try {
      const res = await api.downloadReport(id, 'monthly', getToken())
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = `${id}_30dias.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { flash('Erro ao baixar: ' + e.message) }
  }

  if (error) return <div style={{ color: 'var(--danger)', padding: 40, fontFamily: 'var(--font-mono)', fontSize: 13 }}>{error}</div>
  if (!sensor) return <div style={{ color: 'var(--muted)', padding: 40, fontFamily: 'var(--font-mono)', fontSize: 13 }}>Carregando...</div>

  const t = live?.temperature
  const hasT = typeof t === 'number'
  const danger = hasT && t >= sensor.tempLimit
  const st = statusOf(sensor, live)
  const preview = live?.mv != null ? convertMv(live.mv, cal) : null
  const calChanged = CAL_FIELDS.some(f => Number(cal[f.key]) !== Number((sensor.industrial || IND_DEFAULTS)[f.key]))

  function applyReference() {
    const ref = Number(refTemp)
    if (!Number.isFinite(ref) || !preview || preview.temperature == null) return
    const off = +(Number(cal.offsetTemp) + (ref - preview.temperature)).toFixed(2)
    setCal(c => ({ ...c, offsetTemp: off }))
    flash(`Offset ajustado para ${off} °C. Clique em Salvar para aplicar.`)
  }

  // Eixo Y da temperatura: inclui o limite para a linha de referencia aparecer
  const temps = history.map(h => h.temperature).filter(v => v != null)
  let yDomain = ['auto', 'auto']
  if (temps.length) {
    const min = Math.min(...temps), max = Math.max(...temps, sensor.tempLimit)
    const pad = Math.max((max - min) * 0.1, 1)
    yDomain = [Math.floor(min - pad), Math.ceil(max + pad)]
  }

  const tabs = [['chart', 'Gráfico'], isEditor && ['config', 'Configurar'], isEditor && ['commands', 'Comandos']].filter(Boolean)

  return (
    <div>
      <style>{`
        .ind-live { grid-template-columns: repeat(4,1fr) !important; }
        .ind-cfg  { grid-template-columns: 1fr 1fr !important; }
        .ind-cal  { grid-template-columns: 1fr 1fr !important; }
        @media(max-width:1100px){ .ind-live { grid-template-columns: 1fr 1fr !important; } }
        @media(max-width:768px){
          .ind-cfg { grid-template-columns: 1fr !important; }
          .ind-cal { grid-template-columns: 1fr !important; }
        }
        @media(max-width:480px){ .ind-live { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Cabecalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/industrial')} style={iconBtn}><ArrowLeft size={15} /></button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>{sensor.name}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {sensor.id} · {sensor.location} · grupo: {sensor.tag || '—'}
          </p>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: st.color, border: `1px solid ${st.color}`, borderRadius: 4, padding: '3px 8px' }}>{st.label}</span>
      </div>

      {/* Leituras */}
      <div className="ind-live" style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <Card icon={<Thermometer size={16} color={danger ? 'var(--danger)' : 'var(--temp)'} />} label="Temperatura" danger={danger}>
          <Big color={danger ? 'var(--danger)' : 'var(--temp)'} value={hasT ? t.toFixed(1) : '—'} unit="°C" />
          <Sub>Limite {sensor.tempLimit} °C · faixa {sensor.industrial?.rangeMin ?? 0}–{sensor.industrial?.rangeMax ?? 150} °C</Sub>
        </Card>
        <Card icon={<Zap size={16} color="var(--accent2)" />} label="Saída do transmissor">
          <Big color="var(--accent2)" value={live?.voltage != null ? live.voltage.toFixed(2) : '—'} unit="V" />
          <Sub>Pino: {live?.mv != null ? `${live.mv.toFixed(1)} mV` : '—'}</Sub>
        </Card>
        <Card icon={<Activity size={16} color={live?.fault ? FAULT_INFO[live.fault]?.color : 'var(--muted)'} />} label="Sinal">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: live?.fault ? FAULT_INFO[live.fault]?.color : 'var(--text)', marginTop: 4 }}>
            {live?.fault ? FAULT_INFO[live.fault]?.label : live ? 'OK' : '—'}
          </div>
          <Sub>{live?.fault ? FAULT_INFO[live.fault]?.text : live?.spread != null ? `Ruído: ${Number(live.spread).toFixed(1)} mV` : 'Aguardando leitura'}</Sub>
        </Card>
        <Card icon={<Wifi size={16} color={sensor.online ? 'var(--accent)' : 'var(--muted)'} />} label="Rede / firmware">
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{sensor.ip || '—'}</div>
          <Sub>{sensor.ssid || '—'} · {sensor.fw || sensor.model || '—'}</Sub>
          <Sub>Envio a cada {sensor.industrial?.interval ?? 5} s · MAC {sensor.mac || '—'}</Sub>
        </Card>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, overflowX: 'auto' }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', whiteSpace: 'nowrap',
            background: tab === k ? 'var(--accent)' : 'var(--surface)', color: tab === k ? '#fff' : 'var(--muted)',
            cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
          }}>{label}</button>
        ))}
      </div>

      {/* Grafico */}
      {tab === 'chart' && (
        <div style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Histórico</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {RANGES.map(r => (
                <button key={r.value} onClick={() => setRange(r.value)} style={{
                  padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
                  background: range === r.value ? 'rgba(26,79,214,0.2)' : 'transparent',
                  color: range === r.value ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)'
                }}>{r.label}</button>
              ))}
              {isEditor && <button onClick={downloadCSV} style={{ ...iconBtn, padding: '4px 10px', fontSize: 11, gap: 5 }}><Download size={12} /> CSV 30d</button>}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: showV ? 'var(--accent2)' : 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 10, width: 'fit-content' }}>
            <input type="checkbox" checked={showV} onChange={e => setShowV(e.target.checked)} style={{ accentColor: 'var(--accent2)' }} />
            Mostrar tensão do transmissor (V)
          </label>
          {history.length === 0 ? (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>Sem dados no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="ts" tick={{ fill: 'var(--muted)', fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis yAxisId="t" tick={{ fill: 'var(--muted)', fontSize: 9 }} width={36} domain={yDomain} />
                {showV && <YAxis yAxisId="v" orientation="right" tick={{ fill: 'var(--muted)', fontSize: 9 }} width={36} domain={[0, 'auto']} />}
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} labelStyle={{ color: 'var(--muted)' }} />
                <ReferenceLine yAxisId="t" y={sensor.tempLimit} stroke="var(--danger)" strokeDasharray="4 4"
                  label={{ value: `limite ${sensor.tempLimit}°C`, fill: 'var(--danger)', fontSize: 10, position: 'insideTopRight' }} />
                <Line yAxisId="t" type="monotone" dataKey="temperature" stroke="var(--temp)" dot={false} name="Temp °C" strokeWidth={2} connectNulls isAnimationActive={false} />
                {showV && <Line yAxisId="v" type="monotone" dataKey="voltage" stroke="var(--accent2)" dot={false} name="Tensão V" strokeWidth={1.5} connectNulls isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Configurar */}
      {tab === 'config' && isEditor && (
        <>
          <div className="ind-cfg" style={{ display: 'grid', gap: 14 }}>
            <div style={box}>
              <h3 style={h3}>Identificação e alarme</h3>
              <Field label="Nome do sensor"><input style={inp} value={ident.name ?? ''} onChange={e => setIdent(p => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Localização / máquina"><input style={inp} value={ident.location ?? ''} onChange={e => setIdent(p => ({ ...p, location: e.target.value }))} /></Field>
              <Field label="Grupo (tag de acesso)">
                {isAdmin ? (
                  <>
                    <input style={inp} list="ind-tags" value={ident.tag ?? ''} placeholder="Ex: Produção, Utilidades..." onChange={e => setIdent(p => ({ ...p, tag: e.target.value }))} />
                    <datalist id="ind-tags">{tagOptions.map(t => <option key={t} value={t} />)}</datalist>
                    <div style={hintStyle}>Define quais usuários veem este sensor. Sem grupo, só administradores.</div>
                  </>
                ) : (
                  <div style={{ ...inp, color: 'var(--muted)' }}>{ident.tag || '—'} <span style={{ fontSize: 10 }}>(só administradores alteram)</span></div>
                )}
              </Field>
              <Field label="Alarme de temperatura alta (°C)">
                <input style={inp} type="number" step="0.5" value={ident.tempLimit ?? ''} onChange={e => setIdent(p => ({ ...p, tempLimit: e.target.value }))} />
                <div style={hintStyle}>Dispara o alerta "Temperatura Alta" configurado em Industrial → Alertas.</div>
              </Field>
            </div>

            <div style={box}>
              <h3 style={h3}>Pré-visualização da calibração</h3>
              {preview ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                    Última leitura do pino: <b style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{live.mv.toFixed(1)} mV</b>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <MiniStat label="Valor atual (salvo)" value={hasT ? `${t.toFixed(1)} °C` : '—'} sub={live.voltage != null ? `${live.voltage.toFixed(2)} V` : ''} />
                    <MiniStat label="Com os valores editados" highlight={calChanged}
                      value={preview.temperature != null ? `${preview.temperature.toFixed(1)} °C` : 'FALHA'} sub={`${preview.voltage.toFixed(2)} V${preview.fault ? ' · ' + FAULT_INFO[preview.fault].label : ''}`} />
                  </div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    <label style={lbl}>Ajuste por termômetro de referência</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{ ...inp, flex: 1 }} type="number" step="0.1" placeholder="Temperatura real agora (°C)" value={refTemp} onChange={e => setRefTemp(e.target.value)} />
                      <button onClick={applyReference} disabled={!refTemp || preview.temperature == null} style={{ ...btnSec, whiteSpace: 'nowrap' }}><Crosshair size={13} /> Calcular offset</button>
                    </div>
                    <div style={hintStyle}>Meça a temperatura real no mesmo instante; o painel ajusta o offset de temperatura para bater. Corrija primeiro em volts (offset do ADC / ganho) se a diferença variar com a temperatura.</div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Aguardando a primeira leitura do sensor para pré-visualizar.</div>
              )}
            </div>
          </div>

          <div style={{ ...box, marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ ...h3, marginBottom: 0 }}>Calibração da medição</h3>
              <button onClick={() => setCal(c => ({ ...IND_DEFAULTS, interval: c.interval }))} style={{ ...btnSec, padding: '5px 10px', fontSize: 11 }}><RotateCcw size={12} /> Valores padrão VA01</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
              T = mínimo + (V<sub>tx</sub> / fundo de escala) × (relação − mínimo) + offset, com V<sub>tx</sub> = (mV do pino + offset ADC) × fator × ganho.
              A faixa precisa ser a mesma gravada no transmissor pelo TxConfig.
            </p>
            <div className="ind-cal" style={{ display: 'grid', gap: '4px 16px' }}>
              {CAL_FIELDS.map(f => (
                <Field key={f.key} label={f.label} highlight={f.highlight}>
                  <input style={{ ...inp, ...(f.highlight ? { borderColor: 'var(--accent)' } : {}) }} type="number" step={f.step}
                    value={cal[f.key] ?? ''} onChange={e => setCal(c => ({ ...c, [f.key]: e.target.value }))} />
                  <div style={hintStyle}>{f.hint}</div>
                </Field>
              ))}
            </div>
            <button onClick={save} disabled={saving} style={btnPri}><Save size={13} /> {saving ? 'Salvando...' : 'Salvar configuração'}</button>
          </div>

          <div style={{ ...box, marginTop: 14 }}>
            <h3 style={h3}>Rede do sensor (Wi-Fi)</h3>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Campos vazios mantêm o valor atual. O sensor reinicia ao receber.</p>
            <form onSubmit={sendNetwork} className="ind-cal" style={{ display: 'grid', gap: '4px 16px' }}>
              {[
                ['ssid1', 'Wi-Fi principal (SSID)', 'text'], ['pass1', 'Senha do Wi-Fi principal', 'password'],
                ['ssid2', 'Wi-Fi reserva (SSID)', 'text'],   ['pass2', 'Senha do Wi-Fi reserva', 'password'],
                ['serverIp', 'IP do servidor MQTT', 'text'],
              ].map(([n, l, ty]) => (
                <Field key={n} label={l}><input name={n} type={ty} style={inp} placeholder="—" autoComplete="off" /></Field>
              ))}
              <div style={{ gridColumn: '1/-1' }}><button type="submit" style={btnPri}><Wifi size={13} /> Enviar configuração de rede</button></div>
            </form>
          </div>
        </>
      )}

      {/* Comandos */}
      {tab === 'commands' && isEditor && (
        <div style={box}>
          <h3 style={h3}>Comandos remotos</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => sendCmd('identify', 'identificar')} style={btnSec}><Lightbulb size={13} /> Identificar (piscar LED 15 s)</button>
            <button onClick={() => sendCmd('read_now', 'ler agora')} style={btnSec}><Activity size={13} /> Ler agora</button>
            <button onClick={() => sendCmd('restart', 'reiniciar')} style={{ ...btnSec, borderColor: 'rgba(232,149,10,0.4)', color: 'var(--warn)' }}><RefreshCw size={13} /> Reiniciar sensor</button>
            <button onClick={() => sendCmd('reset_eeprom', 'apagar ID')} style={{ ...btnSec, borderColor: 'rgba(224,60,60,0.4)', color: 'var(--danger)' }}><Trash2 size={13} /> Apagar ID no ESP</button>
            {isAdmin && <button onClick={removeSensor} style={{ ...btnSec, borderColor: 'rgba(224,60,60,0.4)', color: 'var(--danger)', marginLeft: 'auto' }}><Trash2 size={13} /> Excluir sensor do painel</button>}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
            "Apagar ID no ESP" faz o sensor se registrar de novo (recebe o mesmo ID, pois o MAC continua cadastrado).
          </p>
        </div>
      )}

      {status && (
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 12, background: 'rgba(26,79,214,0.08)', border: '1px solid rgba(26,79,214,0.3)', color: status.startsWith('Erro') ? 'var(--danger)' : 'var(--accent2)', fontFamily: 'var(--font-mono)' }}>
          {status}
        </div>
      )}
    </div>
  )
}

function Card({ icon, label, danger, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${danger ? 'rgba(224,60,60,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {icon}<span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{label}</span>
      </div>
      {children}
    </div>
  )
}
const Big = ({ value, unit, color }) => (
  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>
    {value}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3 }}>{unit}</span>
  </div>
)
const Sub = ({ children }) => <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>{children}</div>
const MiniStat = ({ label, value, sub, highlight }) => (
  <div style={{ background: 'var(--bg)', border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 12px' }}>
    <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 3 }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>
  </div>
)
const Field = ({ label, children, highlight }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ ...lbl, ...(highlight ? { color: 'var(--accent2)' } : {}) }}>{label}</label>
    {children}
  </div>
)

const box = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }
const h3 = { fontSize: 13, fontWeight: 600, marginBottom: 14 }
const lbl = { display: 'block', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }
const hintStyle = { fontSize: 10, color: 'var(--muted)', marginTop: 3 }
const inp = { width: '100%', padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)', boxSizing: 'border-box' }
const btnPri = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '9px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)' }
const btnSec = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }
const iconBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center' }
