import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../hooks/api'
import { ChevronLeft, ChevronRight, Download, Loader2, FileSpreadsheet } from 'lucide-react'

// Relatórios mensais dos sensores industriais: o usuário escolhe o mês e clica
// no dia para baixar o .xlsx (minuto a minuto + gráfico). Horário de Brasília.
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MIN_DIA = 1440

const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
function somaMes(ym, d) {
  let [y, m] = ym.split('-').map(Number)
  m += d
  if (m < 1) { m = 12; y-- }
  if (m > 12) { m = 1; y++ }
  return `${y}-${String(m).padStart(2, '0')}`
}
const nomeMes = (ym) => { const [y, m] = ym.split('-').map(Number); const n = MESES[m - 1]; return `${n[0].toUpperCase()}${n.slice(1)} de ${y}` }
const dataBR = (d) => d.split('-').reverse().join('/')

export default function IndustrialMonthlyReports() {
  const { getToken } = useAuth()
  const hoje = hojeBR()
  const mesAtual = hoje.slice(0, 7)
  const [mes, setMes] = useState(mesAtual)
  const [sensores, setSensores] = useState([])
  const [sensor, setSensor] = useState('all')
  const [info, setInfo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [baixando, setBaixando] = useState(null)
  const [aviso, setAviso] = useState(null)   // { tipo: 'ok' | 'erro', texto }

  useEffect(() => { api.getSensors(getToken(), 'industrial').then(setSensores).catch(() => {}) }, [])

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro('')
    api.getIndustrialDays(mes, sensor, getToken())
      .then(d => { if (vivo) setInfo(d) })
      .catch(e => { if (vivo) { setErro(e.message); setInfo(null) } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [mes, sensor])

  // Minutos com leitura no dia: do sensor escolhido ou, em "todos", do sensor com mais dados
  function minutosDoDia(dia) {
    const c = info?.coverage?.[dia]
    if (!c) return 0
    return sensor === 'all' ? Math.max(0, ...Object.values(c)) : (c[sensor] || 0)
  }

  const dias = useMemo(() => {
    const [y, m] = mes.split('-').map(Number)
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const inicio = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    const lista = Array.from({ length: inicio }, () => null)
    for (let d = 1; d <= total; d++) lista.push(`${mes}-${String(d).padStart(2, '0')}`)
    return lista
  }, [mes])

  const diasComDados = info ? dias.filter(d => d && minutosDoDia(d) > 0).length : 0

  async function baixar(dia) {
    setBaixando(dia); setAviso(null)
    try {
      const res = await api.downloadIndustrialDay(dia, sensor, getToken())
      const blob = await res.blob()
      const nome = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1]
        || `industrial_${sensor === 'all' ? 'todos' : sensor}_${dia}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = nome
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setAviso({ tipo: 'ok', texto: `Relatório de ${dataBR(dia)} baixado (${nome}).` })
    } catch (e) {
      setAviso({ tipo: 'erro', texto: `Não foi possível baixar o relatório de ${dataBR(dia)}: ${e.message}` })
    }
    setBaixando(null)
  }

  const navBtn = (disabled) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
    color: disabled ? 'var(--border2)' : 'var(--text)', cursor: disabled ? 'default' : 'pointer',
  })

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={sensor} onChange={e => setSensor(e.target.value)} style={selStyle} aria-label="Sensor do relatório">
          <option value="all">Todos os sensores industriais</option>
          {sensores.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setMes(somaMes(mes, -1))} style={navBtn(false)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 170, textAlign: 'center', fontWeight: 600 }} aria-live="polite">{nomeMes(mes)}</div>
          <button onClick={() => mes < mesAtual && setMes(somaMes(mes, 1))} disabled={mes >= mesAtual} style={navBtn(mes >= mesAtual)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
          {mes !== mesAtual && (
            <button onClick={() => setMes(mesAtual)} style={{ ...navBtn(false), width: 'auto', padding: '0 12px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Mês atual</button>
          )}
        </div>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {carregando ? 'Carregando…' : erro ? '' : `${diasComDados} ${diasComDados === 1 ? 'dia' : 'dias'} com leitura`}
        </div>
      </div>

      <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--muted)', marginBottom: 16, maxWidth: 820 }}>
        <FileSpreadsheet size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Clique em um dia para baixar o relatório em Excel (.xlsx): a aba <b style={{ color: 'var(--text)' }}>Minuto a minuto</b> traz a temperatura de cada minuto e o estado do indicador Therma, e a aba <b style={{ color: 'var(--text)' }}>Gráfico</b> mostra a curva do dia com o resumo. Horário de Brasília.</span>
      </p>

      {erro && (
        <div role="alert" style={{ background: 'rgba(224,60,60,0.08)', border: '1px solid rgba(224,60,60,0.4)', color: 'var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
          Não foi possível carregar o calendário: {erro}
        </div>
      )}
      {aviso && (
        <div role="status" style={{
          background: aviso.tipo === 'ok' ? 'rgba(77,127,255,0.08)' : 'rgba(224,60,60,0.08)',
          border: `1px solid ${aviso.tipo === 'ok' ? 'rgba(77,127,255,0.35)' : 'rgba(224,60,60,0.4)'}`,
          color: aviso.tipo === 'ok' ? 'var(--text)' : 'var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>{aviso.texto}</div>
      )}

      {/* Calendário */}
      <div className="mcal" role="grid" aria-label={`Relatórios de ${nomeMes(mes)}`}>
        {DIAS_SEMANA.map(d => <div key={d} className="mcal-wd" role="columnheader">{d}</div>)}
        {dias.map((dia, i) => {
          if (!dia) return <div key={`v${i}`} aria-hidden="true" />
          const futuro = dia > hoje
          const min = minutosDoDia(dia)
          const pct = Math.round((min / MIN_DIA) * 100)
          const semDados = !carregando && !erro && min === 0
          const desab = futuro || carregando || !!erro || semDados || !!baixando
          const texto = futuro ? '' : carregando ? '…' : semDados ? 'sem leitura' : `${pct}% do dia`
          return (
            <button key={dia} className={`mcal-day${dia === hoje ? ' today' : ''}`} disabled={desab} onClick={() => baixar(dia)}
              title={futuro ? 'Dia ainda não chegou' : semDados ? 'Nenhuma leitura neste dia' : `Baixar o relatório de ${dataBR(dia)}`}
              aria-label={futuro ? `${dataBR(dia)}, dia futuro` : semDados ? `${dataBR(dia)}, sem leitura` : `Baixar relatório de ${dataBR(dia)}, ${pct}% do dia com leitura`}>
              <span className="mcal-num">{Number(dia.slice(8))}</span>
              <span className="mcal-cov">{dia === hoje && !futuro && !semDados && !carregando ? `${texto} · até agora` : texto}</span>
              {!futuro && !semDados && !carregando && <span className="mcal-bar"><span style={{ width: `${Math.max(2, pct)}%` }} /></span>}
              {!futuro && !semDados && !carregando && (
                <span className="mcal-ico" aria-hidden="true">
                  {baixando === dia ? <Loader2 size={14} className="mcal-spin" /> : <Download size={14} />}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {!carregando && !erro && info && info.sensors.length === 0 && (
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>Nenhum sensor industrial disponível para o seu usuário.</div>
      )}
    </div>
  )
}

const selStyle = {
  padding: '7px 12px', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 13, outline: 'none',
  fontFamily: 'var(--font-body)', minWidth: 240,
}
