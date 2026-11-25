import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { admin } from '../hooks/api'
import {
  HardDrive, Database, Activity, FileText, Archive, Trash2, RotateCcw, Download, RefreshCw,
  AlertTriangle, Search, Server, Mail, ScrollText, Settings, Cpu, X,
  Upload, KeyRound, Copy, History, Ban, CircuitBoard,
} from 'lucide-react'

// Painel de administração (só admin): espaço, métricas, lixeira de sensores,
// exclusão de leituras, arquivos guardados, logs e retenção.
const ABAS = [
  ['geral', 'Visão geral', Activity], ['sensores', 'Sensores', Cpu], ['dados', 'Leituras', Database],
  ['arquivos', 'Arquivos', Archive], ['firmware', 'Firmware', CircuitBoard], ['logs', 'Logs', ScrollText],
  ['config', 'Retenção', Settings],
]

// ── formatação ────────────────────────────────────────────────────
export function fmtBytes(b) {
  if (b == null || !Number.isFinite(Number(b))) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = Number(b), i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 && i ? 1 : 0 })} ${u[i]}`
}
const fmtDT = (d) => d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—'
const fmtD = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString('pt-BR')
function idade(d) {
  if (!d) return '—'
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 90) return 'agora'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  return `há ${Math.round(s / 86400)} dias`
}
const retencaoTxt = (sec) => !sec ? 'infinita (nada é apagado automaticamente)' : sec % 86400 === 0 ? `${sec / 86400} dias` : `${Math.round(sec / 3600)} horas`

// ── peças comuns ──────────────────────────────────────────────────
function Card({ title, icon: Icon, children, style, right }) {
  return (
    <section className="adm-card" style={style}>
      <header className="adm-card-h">
        <h2>{Icon && <Icon size={15} />} {title}</h2>
        {right}
      </header>
      {children}
    </section>
  )
}
const Msg = ({ m }) => !m ? null : (
  <div role={m.tipo === 'erro' ? 'alert' : 'status'} className={`adm-msg ${m.tipo}`}>{m.texto}</div>
)
function Btn({ children, variant = 'sec', ...p }) { return <button type="button" className={`adm-btn ${variant}`} {...p}>{children}</button> }

// Confirmação de exclusão: mostra o que vai sumir e pede EXCLUIR digitado
function ConfirmDialog({ open, title, children, onCancel, onConfirm, busy, label = 'Excluir definitivamente' }) {
  const [txt, setTxt] = useState('')
  const ref = useRef(null)
  useEffect(() => { if (open) { setTxt(''); setTimeout(() => ref.current?.focus(), 50) } }, [open])
  if (!open) return null
  return (
    <div className="adm-overlay" role="dialog" aria-modal="true" aria-labelledby="adm-dlg-t" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <div className="adm-dialog">
        <h3 id="adm-dlg-t"><AlertTriangle size={17} /> {title}</h3>
        <div className="adm-dialog-body">{children}</div>
        <label className="adm-label" htmlFor="adm-confirm">Para confirmar, digite <b>EXCLUIR</b></label>
        <input id="adm-confirm" ref={ref} className="adm-input" value={txt} onChange={(e) => setTxt(e.target.value)} autoComplete="off" />
        <div className="adm-dialog-actions">
          <Btn onClick={onCancel} disabled={busy}>Cancelar</Btn>
          <Btn variant="danger" disabled={txt !== 'EXCLUIR' || busy} onClick={onConfirm}>{busy ? 'Excluindo…' : label}</Btn>
        </div>
      </div>
    </div>
  )
}

function Bar({ used, total, warnAt = 0.8, dangerAt = 0.92 }) {
  const f = total ? Math.min(1, used / total) : 0
  const color = f >= dangerAt ? 'var(--danger)' : f >= warnAt ? 'var(--warn)' : 'var(--accent2)'
  return <div className="adm-bar" aria-hidden="true"><span style={{ width: `${f * 100}%`, background: color }} /></div>
}

async function baixarBlob(res, nomePadrao) {
  const blob = await res.blob()
  const nome = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')?.[1] || nomePadrao
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Visão geral ───────────────────────────────────────────────────
function Geral({ t, irPara }) {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const carregar = useCallback(() => { setErro(''); admin.overview(t()).then(setD).catch((e) => setErro(e.message)) }, [])
  useEffect(carregar, [carregar])
  if (erro) return <Msg m={{ tipo: 'erro', texto: `Não foi possível carregar: ${erro}` }} />
  if (!d) return <div className="adm-muted">Carregando…</div>
  const disco = d.disk
  const totalDados = (d.mariadb.bytes || 0) + (d.influx.bytes || 0) + (d.files.reports.bytes || 0) + (d.files.backups.bytes || 0)
  const max = Math.max(1, ...d.readingsPerDay.map((x) => x.count))
  const ret = d.influx.retentionSeconds
  return (
    <div className="adm-grid">
      {ret > 0 && ret <= 90 * 86400 && (
        <div className="adm-msg warn" style={{ gridColumn: '1 / -1' }}>
          O InfluxDB apaga sozinho as leituras com mais de <b>{retencaoTxt(ret)}</b>. Relatórios mensais e históricos de meses mais antigos ficam vazios.
          Para guardar por mais tempo, aumente a retenção do bucket <code>{d.influx.name}</code> no servidor (veja a aba Retenção).
        </div>
      )}
      <Card title="Discos" icon={HardDrive} style={{ gridColumn: '1 / -1' }}
        right={<span className="adm-muted">TH-GUARD ocupa {fmtBytes(totalDados)}</span>}>
        {(d.disks?.length ? d.disks : disco ? [{ name: 'Disco do servidor', ...disco, holds: [] }] : []).map((k) => (
          <div key={k.name + k.path} className="adm-disk">
            <div className="adm-disk-h">
              <b>{k.name}</b>
              {k.error ? <span className="adm-err">{k.error}</span>
                : <span className="mono">{fmtBytes(k.free)} livres de {fmtBytes(k.total)} · {Math.round((k.used / k.total) * 100)}%</span>}
            </div>
            {!k.error && <Bar used={k.used} total={k.total} />}
            {k.holds?.length > 0 && <div className="adm-sub">Guarda: {k.holds.join(', ')}</div>}
          </div>
        ))}
        {!d.disks?.length && !disco && <div className="adm-muted">Indisponível</div>}
      </Card>
      <Card title="InfluxDB (leituras)" icon={Activity}>
        {d.influx.error ? <div className="adm-err">{d.influx.error}</div> : <>
          <div className="adm-big">{fmtBytes(d.influx.bytes)}</div>
          <dl className="adm-kv"><dt>Bucket</dt><dd>{d.influx.name}</dd><dt>Retenção</dt><dd>{retencaoTxt(ret)}</dd></dl>
        </>}
      </Card>
      <Card title="MariaDB (cadastros e logs)" icon={Database}>
        {d.mariadb.error ? <div className="adm-err">{d.mariadb.error}</div> : <>
          <div className="adm-big">{fmtBytes(d.mariadb.bytes)}</div>
          <table className="adm-mini"><tbody>
            {d.mariadb.tables.slice(0, 5).map((x) => <tr key={x.name}><td>{x.name}</td><td>{fmtN(x.rows)} linhas</td><td>{fmtBytes(x.bytes)}</td></tr>)}
          </tbody></table>
        </>}
      </Card>
      <Card title="Arquivos guardados" icon={Archive} right={<Btn onClick={() => irPara('arquivos')}>Abrir</Btn>}>
        <dl className="adm-kv">
          <dt>Relatórios</dt><dd>{d.files.reports.error ? '—' : `${fmtN(d.files.reports.count)} · ${fmtBytes(d.files.reports.bytes)}`}</dd>
          <dt>Backups</dt><dd>{d.files.backups.error ? '—' : !d.files.backups.exists ? 'pasta não montada' : `${fmtN(d.files.backups.count)} · ${fmtBytes(d.files.backups.bytes)}`}</dd>
        </dl>
      </Card>
      <Card title="Sensores" icon={Cpu} right={<Btn onClick={() => irPara('sensores')}>Abrir</Btn>}>
        <div className="adm-big">{d.sensors.online} <small>de {d.sensors.total} online</small></div>
        <dl className="adm-kv"><dt>Industriais</dt><dd>{d.sensors.industrial}</dd><dt>TH-GUARD</dt><dd>{d.sensors.thguard}</dd><dt>Na lixeira</dt><dd>{d.sensors.trash}</dd></dl>
      </Card>
      <Card title="Últimas 24 h" icon={ScrollText} right={<Btn onClick={() => irPara('logs')}>Logs</Btn>}>
        <dl className="adm-kv">
          <dt>Erros</dt><dd style={{ color: d.logs24h.error ? 'var(--danger)' : undefined }}>{fmtN(d.logs24h.error || 0)}</dd>
          <dt>Avisos</dt><dd style={{ color: d.logs24h.warn ? 'var(--warn)' : undefined }}>{fmtN(d.logs24h.warn || 0)}</dd>
          <dt>Informações</dt><dd>{fmtN(d.logs24h.info || 0)}</dd>
          <dt>E-mails (7 dias)</dt><dd>{fmtN(d.emails7d.total)}</dd>
          <dt>Usuários</dt><dd>{d.users.total} ({Object.entries(d.users.byRole).map(([r, n]) => `${n} ${r}`).join(', ')})</dd>
        </dl>
      </Card>
      <Card title="Leituras por dia (30 dias, todos os sensores)" icon={Activity} style={{ gridColumn: '1 / -1' }}>
        {d.readingsPerDay.length ? (
          <div className="adm-chart" role="img" aria-label="Leituras por dia nos últimos 30 dias">
            {d.readingsPerDay.map((x) => (
              <div key={x.day} className="adm-col" title={`${x.day.split('-').reverse().join('/')}: ${fmtN(x.count)} leituras`}>
                <span style={{ height: `${Math.max(1, (x.count / max) * 100)}%`, opacity: x.count ? 1 : 0.25 }} />
              </div>
            ))}
          </div>
        ) : <div className="adm-muted">Sem dados do InfluxDB.</div>}
        {d.readingsPerDay.length > 0 && <div className="adm-axis"><span>{fmtD(d.readingsPerDay[0].day + 'T12:00:00Z')}</span><span>máx. {fmtN(max)}/dia</span><span>hoje</span></div>}
      </Card>
    </div>
  )
}

// ── Sensores e lixeira ────────────────────────────────────────────
function Sensores({ t }) {
  const [d, setD] = useState(null)
  const [msg, setMsg] = useState(null)
  const [dlg, setDlg] = useState(null)        // { tipo: 'trash' | 'purge', s }
  const [hist, setHist] = useState(false)
  const [busy, setBusy] = useState(false)
  const carregar = useCallback(() => admin.sensors(t()).then(setD).catch((e) => setMsg({ tipo: 'erro', texto: e.message })), [])
  useEffect(() => { carregar() }, [carregar])

  async function acao(fn, ok) {
    setBusy(true); setMsg(null)
    try { const r = await fn(); setMsg({ tipo: 'ok', texto: typeof ok === 'function' ? ok(r) : ok }); setDlg(null); await carregar() }
    catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    setBusy(false)
  }
  if (!d) return <><Msg m={msg} /><div className="adm-muted">Carregando…</div></>
  const cobCor = (c) => c >= 90 ? 'var(--text)' : c >= 50 ? 'var(--warn)' : 'var(--danger)'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Msg m={msg} />
      {d.influxError && <Msg m={{ tipo: 'warn', texto: `Métricas do InfluxDB indisponíveis: ${d.influxError}` }} />}
      <Card title={`Sensores ativos (${d.active.length})`} icon={Cpu}>
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>Sensor</th><th>Tipo</th><th>Estado</th><th>Última leitura</th><th className="num">Leituras 24 h</th><th className="num">Cobertura 24 h</th><th>Guardado desde</th><th className="num">E-mails 30 d</th><th /></tr></thead>
          <tbody>
            {d.active.map((s) => (
              <tr key={s.id}>
                <td><b>{s.name}</b><div className="adm-sub mono">{s.id}{s.location ? ` · ${s.location}` : ''}</div></td>
                <td>{s.kind === 'industrial' ? 'Industrial' : 'TH-GUARD'}</td>
                <td><span className={`adm-dot ${s.online ? 'on' : 'off'}`} />{s.online ? 'Online' : 'Offline'}</td>
                <td>{idade(s.lastReading)}</td>
                <td className="num">{fmtN(s.readings24h)}</td>
                <td className="num" style={{ color: cobCor(s.coverage24h) }}>{s.coverage24h}%</td>
                <td>{fmtD(s.firstReading)}</td>
                <td className="num">{fmtN(s.emails30d)}</td>
                <td className="right"><Btn onClick={() => { setHist(false); setDlg({ tipo: 'trash', s }) }} title="Mover para a lixeira"><Trash2 size={13} /> Lixeira</Btn></td>
              </tr>
            ))}
            {!d.active.length && <tr><td colSpan={9} className="adm-muted">Nenhum sensor ativo.</td></tr>}
          </tbody>
        </table></div>
        <p className="adm-note">Cobertura = leituras recebidas nas últimas 24 h em relação às esperadas pelo intervalo de envio (5 s nos industriais, 30 s nos TH-GUARD).</p>
      </Card>

      <Card title={`Lixeira (${d.trash.length})`} icon={Trash2}>
        <p className="adm-note" style={{ marginTop: 0 }}>Sensores na lixeira não aparecem no painel e as leituras deles são descartadas. Depois de {d.trashDays} dias são excluídos definitivamente.</p>
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>Sensor</th><th>Excluído</th><th>Exclusão automática</th><th>Histórico de leituras</th><th /></tr></thead>
          <tbody>
            {d.trash.map((s) => (
              <tr key={s.id}>
                <td><b>{s.name}</b><div className="adm-sub mono">{s.id}</div></td>
                <td>{fmtDT(s.deletedAt)}<div className="adm-sub">{s.deletedBy || '—'}</div></td>
                <td>{fmtD(s.purgeAt)}</td>
                <td>{s.purgeHistory ? 'Será apagado' : 'Será mantido'}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <Btn disabled={busy} onClick={() => acao(() => admin.restore(s.id, t()), `${s.name} restaurado. O dispositivo recebe o ID de novo quando reconectar.`)}><RotateCcw size={13} /> Restaurar</Btn>{' '}
                  <Btn variant="danger" onClick={() => { setHist(s.purgeHistory); setDlg({ tipo: 'purge', s }) }}><X size={13} /> Excluir</Btn>
                </td>
              </tr>
            ))}
            {!d.trash.length && <tr><td colSpan={5} className="adm-muted">A lixeira está vazia.</td></tr>}
          </tbody>
        </table></div>
      </Card>

      {dlg?.tipo === 'trash' && (
        <div className="adm-overlay" role="dialog" aria-modal="true" aria-labelledby="adm-trash-t">
          <div className="adm-dialog">
            <h3 id="adm-trash-t"><Trash2 size={17} /> Mover {dlg.s.name} para a lixeira?</h3>
            <div className="adm-dialog-body">
              O sensor some do painel e as leituras dele passam a ser descartadas. Pode ser restaurado por {d.trashDays} dias.
              <label className="adm-check"><input type="checkbox" checked={hist} onChange={(e) => setHist(e.target.checked)} /> Na exclusão definitiva, apagar também o histórico de leituras ({fmtN(dlg.s.readings24h)} nas últimas 24 h)</label>
            </div>
            <div className="adm-dialog-actions">
              <Btn onClick={() => setDlg(null)} disabled={busy}>Cancelar</Btn>
              <Btn variant="danger" disabled={busy} onClick={() => acao(() => admin.trash(dlg.s.id, hist, t()), `${dlg.s.name} foi para a lixeira.`)}>Mover para a lixeira</Btn>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={dlg?.tipo === 'purge'} busy={busy} title={`Excluir ${dlg?.s.name} definitivamente?`} onCancel={() => setDlg(null)}
        onConfirm={() => acao(() => admin.purge(dlg.s.id, hist, t()), (r) => `${dlg.s.name} excluído definitivamente${hist ? (r.historyDeleted ? ' com o histórico de leituras.' : `. O histórico NÃO foi apagado: ${r.historyError}`) : '. O histórico de leituras foi mantido.'}`)}>
        Apaga o cadastro, a calibração, os alertas configurados e o histórico de e-mails de <b>{dlg?.s.id}</b>. Não dá para desfazer.
        <label className="adm-check"><input type="checkbox" checked={hist} onChange={(e) => setHist(e.target.checked)} /> Apagar também todas as leituras deste sensor no InfluxDB</label>
      </ConfirmDialog>
    </div>
  )
}

// ── Exclusão de leituras ──────────────────────────────────────────
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
function inicioBR(d) { return new Date(`${d}T00:00:00-03:00`).toISOString() }
function fimBR(d) {                         // fim do dia escolhido (ou agora, se for hoje)
  const fim = new Date(`${d}T00:00:00-03:00`).getTime() + 86400e3
  return new Date(Math.min(fim, Date.now())).toISOString()
}
function Dados({ t }) {
  const [sensores, setSensores] = useState([])
  const [f, setF] = useState({ sensorId: '', start: '', end: '' })
  const [prev, setPrev] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dlg, setDlg] = useState(false)
  useEffect(() => { admin.sensors(t()).then((d) => setSensores([...d.active, ...d.trash])).catch(() => {}) }, [])
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPrev(null) }
  const corpo = () => ({ sensorId: f.sensorId || null, start: inicioBR(f.start), stop: fimBR(f.end) })
  const valido = f.start && f.end && f.start <= f.end
  async function calcular() {
    setBusy(true); setMsg(null)
    try { setPrev(await admin.dataPreview(corpo(), t())) } catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    setBusy(false)
  }
  async function excluir() {
    setBusy(true)
    try {
      const r = await admin.dataDelete(corpo(), t())
      setMsg({ tipo: 'ok', texto: `${fmtN(r.deleted)} leituras apagadas (${f.sensorId || 'todos os sensores'}, ${f.start.split('-').reverse().join('/')} a ${f.end.split('-').reverse().join('/')}).` })
      setPrev(null); setDlg(false)
    } catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    setBusy(false)
  }
  const nome = (id) => sensores.find((s) => s.id === id)?.name || id
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
      <Msg m={msg} />
      <Card title="Apagar leituras antigas" icon={Database}>
        <p className="adm-note" style={{ marginTop: 0 }}>Apaga do InfluxDB todas as séries (temperatura, umidade, tensão, estado do indicador) no período. Relatórios e gráficos desse período ficam vazios. Calcule antes para ver quantas leituras serão apagadas.</p>
        <div className="adm-form">
          <label className="adm-field"><span>Sensor</span>
            <select className="adm-input" value={f.sensorId} onChange={set('sensorId')}>
              <option value="">Todos os sensores</option>
              {sensores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id}){s.deletedAt ? ' · na lixeira' : ''}</option>)}
            </select>
          </label>
          <label className="adm-field"><span>De</span><input type="date" className="adm-input" value={f.start} max={hojeBR()} onChange={set('start')} /></label>
          <label className="adm-field"><span>Até (inclusive)</span><input type="date" className="adm-input" value={f.end} max={hojeBR()} min={f.start || undefined} onChange={set('end')} /></label>
          <Btn variant="pri" disabled={!valido || busy} onClick={calcular}><Search size={13} /> Calcular</Btn>
        </div>
        {prev && (
          <div className="adm-preview">
            <div><b>{fmtN(prev.total)}</b> leituras no período{prev.sensorId ? ` de ${nome(prev.sensorId)}` : ''}.</div>
            {!prev.sensorId && Object.keys(prev.bySensor).length > 0 && (
              <ul>{Object.entries(prev.bySensor).sort((a, b) => b[1] - a[1]).map(([id, n]) => <li key={id}>{nome(id)} <span className="mono">({id})</span>: {fmtN(n)}</li>)}</ul>
            )}
            <Btn variant="danger" disabled={!prev.total || busy} onClick={() => setDlg(true)}><Trash2 size={13} /> Apagar {fmtN(prev.total)} leituras</Btn>
          </div>
        )}
      </Card>
      <ConfirmDialog open={dlg} busy={busy} title="Apagar leituras?" onCancel={() => setDlg(false)} onConfirm={excluir} label="Apagar leituras">
        {fmtN(prev?.total)} leituras de <b>{f.sensorId ? nome(f.sensorId) : 'todos os sensores'}</b>, de {f.start.split('-').reverse().join('/')} a {f.end.split('-').reverse().join('/')}, serão apagadas do InfluxDB. Não dá para desfazer.
      </ConfirmDialog>
    </div>
  )
}

// ── Arquivos ──────────────────────────────────────────────────────
function Arquivos({ t }) {
  const [kind, setKind] = useState('reports')
  const [d, setD] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [msg, setMsg] = useState(null)
  const [dias, setDias] = useState(90)
  const [dlg, setDlg] = useState(null)       // 'sel' | 'idade'
  const [busy, setBusy] = useState(false)
  const carregar = useCallback(() => { setD(null); setSel(new Set()); admin.files(kind, t()).then(setD).catch((e) => setMsg({ tipo: 'erro', texto: e.message })) }, [kind])
  useEffect(() => { setMsg(null); carregar() }, [carregar])
  const antigos = d ? d.files.filter((x) => Date.parse(x.mtime) < Date.now() - dias * 86400e3) : []
  const toggle = (p) => { const n = new Set(sel); n.has(p) ? n.delete(p) : n.add(p); setSel(n) }
  async function exec(fn, ok) {
    setBusy(true)
    try { const r = await fn(); setMsg({ tipo: r.errors?.length ? 'warn' : 'ok', texto: ok(r) }); setDlg(null); carregar() }
    catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    setBusy(false)
  }
  async function baixar(f) {
    try { await baixarBlob(await admin.fileDownload(kind, f.path, t()), f.name) } catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
  }
  const selBytes = d ? d.files.filter((x) => sel.has(x.path)).reduce((a, x) => a + x.size, 0) : 0
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="adm-seg" role="tablist">
        {[['reports', 'Relatórios gerados', FileText], ['backups', 'Backups do MariaDB', Archive]].map(([k, l, I]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}><I size={13} /> {l}</button>
        ))}
      </div>
      <Msg m={msg} />
      {!d ? <div className="adm-muted">Carregando…</div> : (
        <Card title={`${fmtN(d.count)} arquivos · ${fmtBytes(d.bytes)}`} icon={kind === 'reports' ? FileText : Archive}
          right={<Btn onClick={carregar}><RefreshCw size={13} /> Atualizar</Btn>}>
          <p className="adm-note" style={{ marginTop: 0 }}>
            {kind === 'reports'
              ? 'Cópias de todos os relatórios gerados: anexos dos e-mails diários, semanais e mensais, CSV e Excel baixados no painel. Organizados por mês.'
              : d.exists ? 'Arquivos do backup do MariaDB. Só arquivos de backup (.sql, .gz, .zip, .tgz…) podem ser apagados por aqui.'
                : 'A pasta de backups não está montada no backend. Configure BACKUP_HOST_DIR no .env do servidor (veja a documentação).'}
          </p>
          <div className="adm-toolbar">
            <Btn variant="danger" disabled={!sel.size} onClick={() => setDlg('sel')}><Trash2 size={13} /> Apagar selecionados ({sel.size})</Btn>
            <span className="adm-muted" style={{ marginLeft: 'auto' }}>Mais antigos que</span>
            <input type="number" min="1" className="adm-input" style={{ width: 80 }} value={dias} onChange={(e) => setDias(Math.max(1, Number(e.target.value) || 1))} aria-label="Dias" />
            <span className="adm-muted">dias: {antigos.length}</span>
            <Btn disabled={!antigos.length} onClick={() => setDlg('idade')}>Apagar antigos</Btn>
          </div>
          <div className="adm-table-wrap" style={{ maxHeight: 520 }}><table className="adm-table">
            <thead><tr>
              <th style={{ width: 28 }}><input type="checkbox" aria-label="Selecionar todos" checked={d.files.length > 0 && sel.size === d.files.length} onChange={(e) => setSel(e.target.checked ? new Set(d.files.map((x) => x.path)) : new Set())} /></th>
              <th>Arquivo</th><th className="num">Tamanho</th><th>Modificado</th><th />
            </tr></thead>
            <tbody>
              {d.files.map((f) => (
                <tr key={f.path} className={sel.has(f.path) ? 'sel' : ''}>
                  <td><input type="checkbox" aria-label={`Selecionar ${f.name}`} checked={sel.has(f.path)} onChange={() => toggle(f.path)} /></td>
                  <td className="mono">{f.path}</td>
                  <td className="num">{fmtBytes(f.size)}</td>
                  <td>{fmtDT(f.mtime)}</td>
                  <td className="right"><Btn onClick={() => baixar(f)} title="Baixar"><Download size={13} /></Btn></td>
                </tr>
              ))}
              {!d.files.length && <tr><td colSpan={5} className="adm-muted">Nenhum arquivo.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      <ConfirmDialog open={dlg === 'sel'} busy={busy} title={`Apagar ${sel.size} arquivo(s)?`} onCancel={() => setDlg(null)}
        onConfirm={() => exec(() => admin.filesDelete(kind, [...sel], t()), (r) => `${r.count} arquivo(s) apagado(s), ${fmtBytes(r.bytes)} liberados.${r.errors.length ? ` ${r.errors.length} não puderam ser apagados: ${r.errors[0].error}` : ''}`)}>
        {fmtBytes(selBytes)} serão apagados de {kind === 'reports' ? 'relatórios gerados' : 'backups do MariaDB'}. Não dá para desfazer.
      </ConfirmDialog>
      <ConfirmDialog open={dlg === 'idade'} busy={busy} title={`Apagar ${antigos.length} arquivo(s) com mais de ${dias} dias?`} onCancel={() => setDlg(null)}
        onConfirm={() => exec(() => admin.filesCleanup(kind, dias, t()), (r) => `${r.count} arquivo(s) apagado(s), ${fmtBytes(r.bytes)} liberados.`)}>
        {fmtBytes(antigos.reduce((a, x) => a + x.size, 0))} em {antigos.length} arquivo(s) modificados antes de {fmtD(Date.now() - dias * 86400e3)}.
      </ConfirmDialog>
    </div>
  )
}

// ── Logs ──────────────────────────────────────────────────────────
const NIVEL = { info: ['Info', 'var(--muted)'], warn: ['Aviso', 'var(--warn)'], error: ['Erro', 'var(--danger)'] }
const TIPO_EMAIL = { temp_high: 'Temperatura alta', temp_normal: 'Temperatura normal', humid_high: 'Umidade alta', humid_normal: 'Umidade normal',
  sensor_offline: 'Sensor offline', sensor_online: 'Sensor online', sensor_fault: 'Falha no sensor', fault_cleared: 'Falha normalizada',
  daily: 'Relatório diário', weekly: 'Relatório semanal', monthly: 'Relatório mensal' }

function LogSistema({ t }) {
  const [f, setF] = useState({ level: '', category: '', q: '' })
  const [d, setD] = useState(null)
  const [mais, setMais] = useState(false)
  const [msg, setMsg] = useState(null)
  const [dias, setDias] = useState(30)
  const [dlg, setDlg] = useState(false)
  const [busy, setBusy] = useState(false)
  const carregar = useCallback(async (before) => {
    try {
      const r = await admin.logsSystem({ ...f, before, limit: 200 }, t())
      setD((old) => before && old ? { ...r, rows: [...old.rows, ...r.rows] } : r)
      setMais(r.rows.length === 200)
    } catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
  }, [f])
  useEffect(() => { const id = setTimeout(() => carregar(), f.q ? 350 : 0); return () => clearTimeout(id) }, [carregar])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function limpar() {
    setBusy(true)
    try { const r = await admin.logsSystemCleanup(dias, t()); setMsg({ tipo: 'ok', texto: `${fmtN(r.count)} linha(s) apagada(s).` }); setDlg(false); carregar() }
    catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    setBusy(false)
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Msg m={msg} />
      <div className="adm-toolbar">
        <select className="adm-input" value={f.level} onChange={set('level')} aria-label="Nível"><option value="">Todos os níveis</option><option value="error">Erros</option><option value="warn">Avisos</option><option value="info">Informações</option></select>
        <select className="adm-input" value={f.category} onChange={set('category')} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {d?.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({fmtN(c.count)})</option>)}
        </select>
        <input className="adm-input" style={{ flex: '1 1 200px' }} placeholder="Buscar na mensagem ou usuário" value={f.q} onChange={set('q')} aria-label="Buscar" />
        <Btn onClick={() => carregar()}><RefreshCw size={13} /></Btn>
      </div>
      {d && <div className="adm-muted">{fmtN(d.total)} linhas guardadas desde {fmtDT(d.oldest)}</div>}
      <div className="adm-table-wrap" style={{ maxHeight: 560 }}><table className="adm-table adm-log">
        <thead><tr><th>Quando</th><th>Nível</th><th>Categoria</th><th>Mensagem</th><th>Usuário</th></tr></thead>
        <tbody>
          {d?.rows.map((r) => (
            <tr key={r.id}>
              <td className="mono nowrap">{fmtDT(r.ts)}</td>
              <td><span className="adm-lvl" style={{ color: NIVEL[r.level]?.[1] }}>{NIVEL[r.level]?.[0] || r.level}</span></td>
              <td className="mono">{r.category}</td>
              <td className="msg">{r.message}</td>
              <td className="adm-sub">{r.user || ''}</td>
            </tr>
          ))}
          {d && !d.rows.length && <tr><td colSpan={5} className="adm-muted">Nada encontrado.</td></tr>}
        </tbody>
      </table></div>
      <div className="adm-toolbar">
        {mais && <Btn onClick={() => carregar(d.rows[d.rows.length - 1].id)}>Carregar mais antigos</Btn>}
        <span className="adm-muted" style={{ marginLeft: 'auto' }}>Apagar linhas com mais de</span>
        <input type="number" min="0" className="adm-input" style={{ width: 80 }} value={dias} onChange={(e) => setDias(Math.max(0, Number(e.target.value) || 0))} aria-label="Dias" />
        <span className="adm-muted">dias</span>
        <Btn variant="danger" onClick={() => setDlg(true)}><Trash2 size={13} /> Limpar log</Btn>
      </div>
      <ConfirmDialog open={dlg} busy={busy} title="Limpar o log do sistema?" onCancel={() => setDlg(false)} onConfirm={limpar} label="Limpar">
        {dias === 0 ? 'Todas as linhas do log do sistema serão apagadas.' : `Linhas com mais de ${dias} dias serão apagadas.`} A ação de limpeza fica registrada.
      </ConfirmDialog>
    </div>
  )
}

function LogEmail({ t }) {
  const [f, setF] = useState({ sensor: '', type: '' })
  const [d, setD] = useState(null)
  const [msg, setMsg] = useState(null)
  const [dias, setDias] = useState(365)
  const [dlg, setDlg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sensores, setSensores] = useState([])
  const carregar = useCallback(() => admin.logsEmail({ ...f, limit: 300 }, t()).then(setD).catch((e) => setMsg({ tipo: 'erro', texto: e.message })), [f])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { admin.sensors(t()).then((x) => setSensores(x.active)).catch(() => {}) }, [])
  async function limpar() {
    setBusy(true)
    try { const r = await admin.logsEmailCleanup(dias, t()); setMsg({ tipo: 'ok', texto: `${fmtN(r.count)} registro(s) apagado(s).` }); setDlg(false); carregar() }
    catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    setBusy(false)
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Msg m={msg} />
      <div className="adm-toolbar">
        <select className="adm-input" value={f.sensor} onChange={(e) => setF({ ...f, sensor: e.target.value })} aria-label="Sensor"><option value="">Todos os sensores</option>{sensores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</select>
        <select className="adm-input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Tipo"><option value="">Todos os tipos</option>{Object.entries(TIPO_EMAIL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {d && <span className="adm-muted" style={{ marginLeft: 'auto' }}>{fmtN(d.total)} e-mails registrados desde {fmtD(d.oldest)}</span>}
      </div>
      <div className="adm-table-wrap" style={{ maxHeight: 560 }}><table className="adm-table">
        <thead><tr><th>Quando</th><th>Sensor</th><th>Tipo</th><th>Para</th><th>Assunto</th></tr></thead>
        <tbody>
          {d?.rows.map((r) => (
            <tr key={r.id}>
              <td className="mono nowrap">{fmtDT(r.ts)}</td>
              <td>{r.sensorName || r.sensorId}<div className="adm-sub mono">{r.sensorId}</div></td>
              <td>{TIPO_EMAIL[r.type] || r.type}</td>
              <td className="adm-sub">{r.to}</td>
              <td className="msg">{r.subject}</td>
            </tr>
          ))}
          {d && !d.rows.length && <tr><td colSpan={5} className="adm-muted">Nenhum e-mail registrado.</td></tr>}
        </tbody>
      </table></div>
      <div className="adm-toolbar">
        <span className="adm-muted" style={{ marginLeft: 'auto' }}>Apagar registros com mais de</span>
        <input type="number" min="0" className="adm-input" style={{ width: 80 }} value={dias} onChange={(e) => setDias(Math.max(0, Number(e.target.value) || 0))} aria-label="Dias" />
        <span className="adm-muted">dias</span>
        <Btn variant="danger" onClick={() => setDlg(true)}><Trash2 size={13} /> Limpar histórico</Btn>
      </div>
      <ConfirmDialog open={dlg} busy={busy} title="Limpar o histórico de e-mails?" onCancel={() => setDlg(false)} onConfirm={limpar} label="Limpar">
        {dias === 0 ? 'Todo o histórico de e-mails será apagado.' : `Registros com mais de ${dias} dias serão apagados.`} Os e-mails enviados não são afetados, só o registro no TH-GUARD.
      </ConfirmDialog>
    </div>
  )
}

function LogContainers({ t }) {
  const [lista, setLista] = useState(null)
  const [nome, setNome] = useState('')
  const [tail, setTail] = useState(300)
  const [linhas, setLinhas] = useState(null)
  const [auto, setAuto] = useState(false)
  const [msg, setMsg] = useState(null)
  const fim = useRef(null)
  useEffect(() => {
    admin.containers(t()).then((r) => { setLista(r); if (r.containers.length) setNome(r.containers.find((c) => c.name === 'thguard-backend')?.name || r.containers[0].name) })
      .catch((e) => setMsg({ tipo: 'erro', texto: e.message }))
  }, [])
  const carregar = useCallback(() => {
    if (!nome) return
    admin.containerLogs(nome, tail, t()).then((r) => { setLinhas(r.lines); setMsg(null) }).catch((e) => setMsg({ tipo: 'erro', texto: e.message }))
  }, [nome, tail])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (!auto) return; const id = setInterval(carregar, 5000); return () => clearInterval(id) }, [auto, carregar])
  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [linhas])
  if (lista && !lista.enabled) return <Msg m={{ tipo: 'warn', texto: 'Logs dos containers desativados: o serviço dockerproxy não está configurado (docker-compose.override.yml).' }} />
  const atual = lista?.containers.find((c) => c.name === nome)
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Msg m={msg} />
      <div className="adm-toolbar">
        <select className="adm-input" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Container">
          {lista?.containers.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.state === 'running' ? 'rodando' : c.state}</option>)}
        </select>
        <select className="adm-input" value={tail} onChange={(e) => setTail(Number(e.target.value))} aria-label="Linhas"><option value={100}>100 linhas</option><option value={300}>300 linhas</option><option value={1000}>1000 linhas</option><option value={2000}>2000 linhas</option></select>
        <Btn onClick={carregar}><RefreshCw size={13} /> Atualizar</Btn>
        <label className="adm-check" style={{ margin: 0 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Atualizar a cada 5 s</label>
        {atual && <span className="adm-muted" style={{ marginLeft: 'auto' }}>{atual.image} · {atual.status}</span>}
      </div>
      <div className="adm-term" role="log" aria-label={`Log do container ${nome}`}>
        {linhas?.map((l, i) => (
          <div key={i} className={l.stream === 'stderr' ? 'err' : ''}><span className="ts">{l.ts ? new Date(l.ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''}</span>{l.text}</div>
        ))}
        {linhas && !linhas.length && <div className="adm-muted">Sem linhas.</div>}
        <div ref={fim} />
      </div>
      <p className="adm-note">Somente leitura: o painel não reinicia nem para containers. Linhas em vermelho vieram da saída de erro (stderr).</p>
    </div>
  )
}

function Logs({ t }) {
  const [sub, setSub] = useState('sistema')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="adm-seg" role="tablist">
        {[['sistema', 'Sistema', ScrollText], ['email', 'E-mails enviados', Mail], ['containers', 'Containers', Server]].map(([k, l, I]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}><I size={13} /> {l}</button>
        ))}
      </div>
      {sub === 'sistema' && <LogSistema t={t} />}
      {sub === 'email' && <LogEmail t={t} />}
      {sub === 'containers' && <LogContainers t={t} />}
    </div>
  )
}

// ── Firmware: atualização dos sensores pela rede (OTA) ────────────
const OTA_ST = {
  queued: ['Na fila', 'var(--muted)'], sent: ['Comando enviado', 'var(--accent2)'], accepted: ['Aceito pelo sensor', 'var(--accent2)'],
  downloading: ['Baixando e gravando', 'var(--accent2)'], rebooting: ['Reiniciando', 'var(--warn)'],
  done: ['Concluído', '#22c55e'], failed: ['Falhou', 'var(--danger)'], cancelled: ['Cancelado', 'var(--muted)'],
}
const OTA_ATIVO = ['queued', 'sent', 'accepted', 'downloading', 'rebooting']

function Firmware({ t }) {
  const [d, setD] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fwSel, setFwSel] = useState('')
  const [sel, setSel] = useState(new Set())
  const [arquivo, setArquivo] = useState(null)
  const [notas, setNotas] = useState('')
  const [dlg, setDlg] = useState(null)          // { tipo: 'deploy' } | { tipo: 'apagar', fw }
  const [copiado, setCopiado] = useState(false)
  const inputRef = useRef(null)

  const carregar = useCallback(() => admin.firmware(t()).then((r) => {
    setD(r)
    setFwSel((cur) => cur && r.firmwares.some((f) => String(f.id) === String(cur)) ? cur : (r.firmwares[0] ? String(r.firmwares[0].id) : ''))
  }).catch((e) => setMsg({ tipo: 'erro', texto: e.message })), [])
  useEffect(() => { carregar() }, [carregar])
  const emAndamento = !!d?.jobs.some((j) => OTA_ATIVO.includes(j.status))
  useEffect(() => {                             // acompanha o andamento a cada 2 s
    if (!emAndamento) return undefined
    const id = setInterval(carregar, 2000)
    return () => clearInterval(id)
  }, [emAndamento, carregar])

  async function acao(fn, ok) {
    setBusy(true); setMsg(null)
    try { const r = await fn(); setMsg({ tipo: 'ok', texto: typeof ok === 'function' ? ok(r) : ok }); setDlg(null); await carregar(); return r }
    catch (e) { setMsg({ tipo: 'erro', texto: e.message }) }
    finally { setBusy(false) }
    return null
  }

  async function enviar(e) {
    e.preventDefault()
    if (!arquivo) return
    const r = await acao(() => admin.firmwareUpload(arquivo, notas, t()),
      (x) => x.duplicate ? `Este arquivo já estava no servidor (${x.version}).` : `Firmware ${x.version} (${x.model}) recebido e conferido.`)
    if (r) { setArquivo(null); setNotas(''); if (inputRef.current) inputRef.current.value = ''; setFwSel(String(r.id)) }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(d.publicKey.macro); setCopiado(true); setTimeout(() => setCopiado(false), 2500) }
    catch { setMsg({ tipo: 'warn', texto: 'Não foi possível copiar automaticamente. Selecione o texto e copie com Ctrl+C.' }) }
  }

  if (!d) return <><Msg m={msg} /><div className="adm-muted">Carregando…</div></>
  const fw = d.firmwares.find((f) => String(f.id) === String(fwSel))
  const motivo = (s) => {
    if (s.busy) return s.busy === 'queued' ? 'Na fila de atualização' : `Atualizando agora (${OTA_ST[s.busy][0].toLowerCase()})`
    if (s.reason) return s.reason
    if (!fw) return 'escolha um firmware'
    if (String(s.model || '').toUpperCase() !== fw.model) return `firmware de outro modelo (${fw.model})`
    if (s.fw === fw.version) return 'já está nesta versão'
    return null
  }
  const aptos = d.sensors.filter((s) => !motivo(s))
  const escolhidos = aptos.filter((s) => sel.has(s.id))
  const alternar = (id) => setSel((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n })
  const ativos = d.jobs.filter((j) => OTA_ATIVO.includes(j.status)).sort((a, b) => a.id - b.id)
  const lotesComFila = [...new Set(ativos.filter((j) => j.status === 'queued').map((j) => j.batch))]

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Msg m={msg} />

      {ativos.length > 0 && (
        <Card title="Atualização em andamento" icon={RefreshCw}
          right={lotesComFila.map((b) => <Btn key={b} disabled={busy} onClick={() => acao(() => admin.otaCancel(b, t()), (r) => `${r.cancelled} atualização(ões) tirada(s) da fila.`)}><Ban size={13} /> Cancelar a fila</Btn>)}>
          <div style={{ display: 'grid', gap: 12 }}>
            {ativos.map((j) => (
              <div key={j.id} className="adm-ota-row">
                <div className="adm-ota-h">
                  <span><b>{j.sensorName || j.sensorId}</b> <span className="adm-sub mono">{j.sensorId}</span></span>
                  <span className="mono" style={{ fontSize: 12 }}>{j.fromVersion || '?'} → {j.toVersion}</span>
                </div>
                <div className="adm-ota-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progress ?? 0} aria-label={`Progresso de ${j.sensorId}`}>
                  <span style={{ width: `${j.status === 'queued' ? 0 : j.progress ?? 0}%`, background: OTA_ST[j.status][1] }} />
                </div>
                <div className="adm-sub" style={{ color: OTA_ST[j.status][1] }}>
                  {OTA_ST[j.status][0]}{j.status === 'downloading' && j.progress != null ? ` · ${j.progress}%` : ''}{j.message && !['queued', 'downloading'].includes(j.status) ? ` · ${j.message}` : ''}
                </div>
              </div>
            ))}
          </div>
          <p className="adm-note">Um sensor por vez. Se um falhar, os seguintes do mesmo envio são cancelados. Depois de reiniciar, o sensor tem até 5 minutos para se conectar com a versão nova; se não conseguir, ele volta sozinho para a anterior.</p>
        </Card>
      )}

      <Card title="Atualizar sensores" icon={CircuitBoard}>
        {!d.firmwares.length ? <p className="adm-muted" style={{ margin: 0 }}>Envie um firmware abaixo para começar.</p> : (<>
          <div className="adm-form" style={{ marginBottom: 12 }}>
            <label className="adm-field" htmlFor="ota-fw">Firmware
              <select id="ota-fw" className="adm-input" value={fwSel} onChange={(e) => { setFwSel(e.target.value); setSel(new Set()) }}>
                {d.firmwares.map((f) => <option key={f.id} value={f.id}>{f.version} ({f.model}){f.notes ? ` · ${f.notes}` : ''}</option>)}
              </select>
            </label>
            <Btn onClick={() => setSel(new Set(aptos.map((s) => s.id)))} disabled={!aptos.length}>Marcar todos os aptos</Btn>
            <Btn onClick={() => setSel(new Set())} disabled={!sel.size}>Desmarcar</Btn>
          </div>
          <div className="adm-table-wrap"><table className="adm-table">
            <thead><tr><th style={{ width: 34 }} /><th>Sensor</th><th>Estado</th><th>Versão atual</th><th>Situação</th></tr></thead>
            <tbody>
              {d.sensors.map((s) => {
                const m = motivo(s)
                return (
                  <tr key={s.id} className={sel.has(s.id) && !m ? 'sel' : ''}>
                    <td><input type="checkbox" aria-label={`Atualizar ${s.name}`} disabled={!!m} checked={sel.has(s.id) && !m} onChange={() => alternar(s.id)} /></td>
                    <td><b>{s.name}</b><div className="adm-sub mono">{s.id}{s.model ? ` · ${s.model}` : ''}</div></td>
                    <td><span className={`adm-dot ${s.online ? 'on' : 'off'}`} />{s.online ? 'Online' : 'Offline'}</td>
                    <td className="mono">{s.fw || '—'}</td>
                    <td className={m ? 'adm-muted' : ''}>{m || 'Pode atualizar'}</td>
                  </tr>
                )
              })}
              {!d.sensors.length && <tr><td colSpan={5} className="adm-muted">Nenhum sensor com atualização pela rede.</td></tr>}
            </tbody>
          </table></div>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn variant="pri" disabled={!escolhidos.length || busy} onClick={() => setDlg({ tipo: 'deploy' })}>
              <Upload size={13} /> {escolhidos.length ? `Atualizar ${escolhidos.length} sensor${escolhidos.length === 1 ? '' : 'es'} para ${fw?.version}` : 'Marque os sensores para atualizar'}
            </Btn>
            <span className="adm-muted" style={{ fontSize: 12 }}>Sensores com firmware anterior à {d.otaMin.VA01} precisam de uma gravação por USB antes da primeira atualização pela rede.</span>
          </div>
        </>)}
      </Card>

      <Card title="Firmwares no servidor" icon={Upload}>
        <form onSubmit={enviar} className="adm-form" style={{ marginBottom: 12 }}>
          <label className="adm-field" htmlFor="ota-arq">Arquivo .bin
            <input id="ota-arq" ref={inputRef} type="file" accept=".bin,application/octet-stream" className="adm-input" onChange={(e) => setArquivo(e.target.files[0] || null)} />
          </label>
          <label className="adm-field" htmlFor="ota-notas" style={{ flex: 1, minWidth: 200 }}>Observação (opcional)
            <input id="ota-notas" className="adm-input" maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="O que mudou nesta versão" />
          </label>
          <Btn variant="pri" type="submit" disabled={!arquivo || busy}>{busy && arquivo ? 'Enviando…' : 'Enviar firmware'}</Btn>
        </form>
        <p className="adm-note" style={{ marginTop: 0 }}>
          Envie o <code>va01_industrial.ino.bin</code> gerado pelo <code>arduino-cli compile --output-dir</code> (não o <code>merged</code> nem o <code>bootloader</code>).
          O servidor confere o modelo e a versão gravados no arquivo; cada versão nova precisa de um <code>FW_VERSION</code> novo no código.
        </p>
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>Versão</th><th>Modelo</th><th className="num">Tamanho</th><th>SHA-256</th><th>Enviado</th><th className="num">Instalações</th><th /></tr></thead>
          <tbody>
            {d.firmwares.map((f) => (
              <tr key={f.id}>
                <td><b className="mono">{f.version}</b>{f.notes && <div className="adm-sub">{f.notes}</div>}</td>
                <td>{f.model}</td>
                <td className="num">{fmtBytes(f.size)}</td>
                <td className="mono" title={f.sha256}>{f.sha256.slice(0, 12)}…</td>
                <td>{fmtDT(f.uploadedAt)}<div className="adm-sub">{f.uploadedBy || '—'}</div></td>
                <td className="num">{fmtN(f.installs)}</td>
                <td className="right"><Btn variant="danger" disabled={busy} onClick={() => setDlg({ tipo: 'apagar', fw: f })}><Trash2 size={13} /> Apagar</Btn></td>
              </tr>
            ))}
            {!d.firmwares.length && <tr><td colSpan={7} className="adm-muted">Nenhum firmware enviado.</td></tr>}
          </tbody>
        </table></div>
      </Card>

      <Card title="Histórico de atualizações" icon={History}>
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>Quando</th><th>Sensor</th><th>Versão</th><th>Resultado</th><th>Detalhe</th><th>Por</th></tr></thead>
          <tbody>
            {d.jobs.map((j) => (
              <tr key={j.id}>
                <td className="nowrap">{fmtDT(j.finishedAt || j.startedAt || j.createdAt)}</td>
                <td><b>{j.sensorName || j.sensorId}</b><div className="adm-sub mono">{j.sensorId}</div></td>
                <td className="mono nowrap">{j.fromVersion || '?'} → {j.toVersion}</td>
                <td style={{ color: OTA_ST[j.status]?.[1], fontWeight: 600 }} className="nowrap">{OTA_ST[j.status]?.[0] || j.status}</td>
                <td className="msg">{j.message || '—'}</td>
                <td>{j.createdBy || '—'}</td>
              </tr>
            ))}
            {!d.jobs.length && <tr><td colSpan={6} className="adm-muted">Nenhuma atualização feita ainda.</td></tr>}
          </tbody>
        </table></div>
      </Card>

      <Card title="Chave pública para o secrets.h" icon={KeyRound} right={<Btn onClick={copiar}><Copy size={13} /> {copiado ? 'Copiado' : 'Copiar'}</Btn>}>
        <p className="adm-note" style={{ marginTop: 0 }}>
          Cole estas linhas no <code>secrets.h</code> do firmware antes de gravar por USB. O sensor só instala firmware assinado pela chave privada deste servidor
          (impressão digital <span className="mono">{d.publicKey.fingerprint}</span>).
        </p>
        <pre className="adm-code">{d.publicKey.macro}</pre>
        <p className="adm-note" style={{ marginBottom: 0 }}>
          A chave privada fica em <code>backend/data/firmware/ota-assinatura.key</code> no servidor. Inclua essa pasta no backup: se ela se perder, o servidor cria outra
          e os sensores voltam a aceitar firmware só por USB.
        </p>
      </Card>

      {dlg?.tipo === 'deploy' && (
        <div className="adm-overlay" role="dialog" aria-modal="true" aria-labelledby="adm-ota-t">
          <div className="adm-dialog">
            <h3 id="adm-ota-t" className="adm-dialog-info"><Upload size={17} /> Atualizar {escolhidos.length} sensor{escolhidos.length === 1 ? '' : 'es'} para {fw?.version}?</h3>
            <div className="adm-dialog-body">
              <ul style={{ margin: '0 0 10px 18px' }}>
                {escolhidos.map((s) => <li key={s.id}><b>{s.name}</b> <span className="mono adm-sub">{s.fw} → {fw?.version}</span></li>)}
              </ul>
              Os sensores são atualizados um de cada vez, nesta ordem. Cada um fica cerca de 1 minuto sem enviar leituras enquanto baixa o firmware e reinicia.
              Se algum falhar, os seguintes não são atualizados.
            </div>
            <div className="adm-dialog-actions">
              <Btn onClick={() => setDlg(null)} disabled={busy}>Cancelar</Btn>
              <Btn variant="pri" disabled={busy} onClick={async () => { const r = await acao(() => admin.firmwareDeploy(fw.id, escolhidos.map((s) => s.id), t()), (x) => `Atualização de ${x.count} sensor(es) iniciada.`); if (r) setSel(new Set()) }}>
                {busy ? 'Iniciando…' : 'Atualizar'}
              </Btn>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={dlg?.tipo === 'apagar'} busy={busy} title={`Apagar o firmware ${dlg?.fw?.version}?`} label="Apagar firmware" onCancel={() => setDlg(null)}
        onConfirm={() => acao(() => admin.firmwareDelete(dlg.fw.id, t()), `Firmware ${dlg.fw.version} apagado. O histórico das atualizações foi mantido.`)}>
        O arquivo sai do servidor e não pode mais ser enviado aos sensores. Os sensores que já estão nesta versão continuam funcionando.
      </ConfirmDialog>
    </div>
  )
}

// ── Retenção ──────────────────────────────────────────────────────
function Config({ t }) {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { admin.settings(t()).then(setS).catch((e) => setMsg({ tipo: 'erro', texto: e.message })) }, [])
  if (!s) return <><Msg m={msg} /><div className="adm-muted">Carregando…</div></>
  const campos = [
    ['trash_days', 'Sensores na lixeira', 'Dias até a exclusão definitiva automática (1 a 365).', 1],
    ['log_retention_days', 'Log do sistema', 'Linhas mais antigas são apagadas todo dia às 03:30. 0 = nunca apagar.', 0],
    ['email_retention_days', 'Histórico de e-mails', 'Registros mais antigos são apagados. 0 = nunca apagar.', 0],
    ['report_retention_days', 'Relatórios guardados', 'Arquivos mais antigos são apagados. 0 = guardar para sempre.', 0],
  ]
  async function salvar(e) {
    e.preventDefault(); setBusy(true); setMsg(null)
    try { setS(await admin.saveSettings(s, t())); setMsg({ tipo: 'ok', texto: 'Retenção salva. A próxima limpeza automática usa os novos valores.' }) }
    catch (err) { setMsg({ tipo: 'erro', texto: err.message }) }
    setBusy(false)
  }
  return (
    <form onSubmit={salvar} style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <Msg m={msg} />
      <Card title="Limpeza automática" icon={Settings}>
        <div style={{ display: 'grid', gap: 14 }}>
          {campos.map(([k, titulo, ajuda, min]) => (
            <label key={k} className="adm-setting" htmlFor={`cfg-${k}`}>
              <div><b>{titulo}</b><div className="adm-sub">{ajuda}</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input id={`cfg-${k}`} type="number" min={min} max={k === 'trash_days' ? 365 : 3650} className="adm-input" style={{ width: 90 }}
                  value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) })} />
                <span className="adm-muted">dias</span>
              </div>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 16 }}><Btn variant="pri" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Btn></div>
      </Card>
      <Card title="Leituras do InfluxDB" icon={Activity}>
        <p className="adm-note" style={{ margin: 0 }}>
          A retenção das leituras é do próprio InfluxDB e não é alterada por este painel. Para mudar (por exemplo, para 1 ano), no servidor:
        </p>
        <pre className="adm-code">{'docker exec thguard-influxdb influx bucket list\ndocker exec thguard-influxdb influx bucket update --id <ID do bucket> --retention 365d'}</pre>
        <p className="adm-note" style={{ margin: 0 }}>Use a aba Leituras para apagar períodos específicos.</p>
      </Card>
    </form>
  )
}

export default function AdminPage() {
  const { getToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const aba = ABAS.some(([k]) => k === params.get('aba')) ? params.get('aba') : 'geral'
  const irPara = (k) => setParams(k === 'geral' ? {} : { aba: k }, { replace: true })
  const t = getToken
  return (
    <div style={{ maxWidth: 1400 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Administração</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Espaço ocupado, sensores, leituras, arquivos, firmware e logs do TH-GUARD</p>
      </div>
      <div className="subtabs adm-tabs" role="tablist" aria-label="Seções da administração">
        {ABAS.map(([k, label, I]) => (
          <button key={k} role="tab" aria-selected={aba === k} className={`subtab${aba === k ? ' active' : ''}`} onClick={() => irPara(k)}>
            <I size={13} style={{ marginRight: 6, verticalAlign: -2 }} />{label}
          </button>
        ))}
      </div>
      {aba === 'geral' && <Geral t={t} irPara={irPara} />}
      {aba === 'sensores' && <Sensores t={t} />}
      {aba === 'dados' && <Dados t={t} />}
      {aba === 'arquivos' && <Arquivos t={t} />}
      {aba === 'firmware' && <Firmware t={t} />}
      {aba === 'logs' && <Logs t={t} />}
      {aba === 'config' && <Config t={t} />}
    </div>
  )
}
