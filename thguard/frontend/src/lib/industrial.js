// Mesma conversao do backend (backend/src/services/industrial.js).
// Usada so para a pre-visualizacao na tela de calibracao; o valor oficial
// e sempre o calculado no servidor.
export const IND_DEFAULTS = {
  rangeMin: 0, rangeMax: 150, vFull: 10, divisor: 5, offsetMv: -16,
  gain: 1, offsetTemp: 0, faultV: 10.5, offV: 0.75, interval: 5,
}

export function convertMv(mv, cal) {
  const c = { ...IND_DEFAULTS, ...(cal || {}) }
  const n = k => Number(c[k])
  const vTx = ((mv + n('offsetMv')) / 1000) * n('divisor') * n('gain')
  let fault = null
  if (vTx > n('faultV')) fault = 'upscale'
  else if (n('offV') > 0 && vTx < n('offV')) fault = 'indicator_off'
  const t = n('rangeMin') + (vTx / n('vFull')) * (n('rangeMax') - n('rangeMin')) + n('offsetTemp')
  return { temperature: fault ? null : t, voltage: vTx, fault }
}

export const OFF_LABEL = 'Indicador Therma desligado'

export const FAULT_INFO = {
  upscale:       { label: 'FALHA UPSCALE',    text: 'PT100 aberto ou acima da faixa', color: 'var(--danger)' },
  indicator_off: { label: 'THERMA DESLIGADO', text: OFF_LABEL, color: 'var(--off)' },
}

export const isOff = (live) => live?.fault === 'indicator_off'

export function statusOf(sensor, live) {
  if (!sensor.online) return { label: 'OFFLINE', color: 'var(--muted)' }
  if (live?.fault && FAULT_INFO[live.fault]) return { label: FAULT_INFO[live.fault].label, color: FAULT_INFO[live.fault].color }
  if (sensor.alertActive) return { label: 'ALARME', color: 'var(--danger)' }
  return { label: 'NORMAL', color: 'var(--accent2)' }
}

// Faixas continuas de pontos com o indicador desligado (off >= 0,5 na janela),
// para sombrear o grafico. Retorna [{ x1, x2 }] com os rotulos do eixo X.
export function offSpans(data, key = 'ts') {
  const spans = []
  let start = null
  data.forEach((d, i) => {
    const off = d.off != null && d.off >= 0.5
    if (off && start === null) start = i
    if ((!off || i === data.length - 1) && start !== null) {
      const end = off ? i : i - 1
      // Estende meio passo para a faixa ter largura mesmo com um ponto so
      spans.push({ x1: data[Math.max(start - (start > 0 ? 1 : 0), 0)][key], x2: data[Math.min(end + 1, data.length - 1)][key] })
      start = null
    }
  })
  return spans
}
