// Mesma conversao do backend (backend/src/services/industrial.js).
// Usada so para a pre-visualizacao na tela de calibracao; o valor oficial
// e sempre o calculado no servidor.
export const IND_DEFAULTS = {
  rangeMin: 0, rangeMax: 150, vFull: 10, divisor: 5, offsetMv: -16,
  gain: 1, offsetTemp: 0, faultV: 10.5, lowV: 0.05, interval: 5,
}

export function convertMv(mv, cal) {
  const c = { ...IND_DEFAULTS, ...(cal || {}) }
  const n = k => Number(c[k])
  const vTx = ((mv + n('offsetMv')) / 1000) * n('divisor') * n('gain')
  let fault = null
  if (vTx > n('faultV')) fault = 'upscale'
  else if (n('lowV') > 0 && vTx < n('lowV')) fault = 'no_signal'
  const t = n('rangeMin') + (vTx / n('vFull')) * (n('rangeMax') - n('rangeMin')) + n('offsetTemp')
  return { temperature: fault === 'upscale' ? null : t, voltage: vTx, fault }
}

export const FAULT_INFO = {
  upscale:   { label: 'FALHA UPSCALE', text: 'PT100 aberto ou acima da faixa', color: 'var(--danger)' },
  no_signal: { label: 'SEM SINAL',     text: 'Transmissor sem alimentação ou fio solto', color: 'var(--warn)' },
}

export function statusOf(sensor, live) {
  if (!sensor.online) return { label: 'OFFLINE', color: 'var(--muted)' }
  if (live?.fault && FAULT_INFO[live.fault]) return { label: FAULT_INFO[live.fault].label, color: FAULT_INFO[live.fault].color }
  if (sensor.alertActive) return { label: 'ALARME', color: 'var(--danger)' }
  return { label: 'NORMAL', color: 'var(--accent2)' }
}
