// ═══════════════════════════════════════════════════════════════════
//  Sensores industriais (VA01: PT100 -> TxIsoRail 0-10 V -> divisor 5:1 -> ESP32)
//
//  O ESP envia a tensao no pino (mV, filtrada). A conversao para °C e
//  feita aqui, com a calibracao de cada sensor guardada no banco
//  (tabela industrial_config) e editada pelo painel.
//
//    mv_corr = mv + offset_mv
//    v_tx    = mv_corr / 1000 * divisor * gain          (tensao na saida do transmissor)
//    T       = range_min + (v_tx / v_full) * (range_max - range_min) + offset_temp
//
//    v_tx > fault_v  -> falha "upscale" (PT100 aberto/queimado): temperatura descartada
//    v_tx < off_v    -> AREA MORTA: indicador Therma desligado. Com o indicador
//                       desligado a entrada fica sem sinal e o ESP le a tensao
//                       residual do proprio pino, que viraria uma temperatura falsa.
//                       Desligar o indicador e parte normal do processo: a temperatura
//                       e descartada, o estado e registrado e NAO gera alerta de falha.
//                       Histerese de OFF_HYST_V para nao oscilar perto do limiar.
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS = {
  rangeMin:   0,      // °C correspondente a 0 V  (TxConfig)
  rangeMax:   150,    // °C correspondente a v_full (TxConfig) — "temperatura de relacao"
  vFull:      10,     // tensao de fundo de escala do transmissor (V)
  divisor:    5,      // fator do modulo sensor de tensao 0-25 V
  offsetMv:   -16,    // correcao do ADC no pino (mV) — validada em 05/11/2026
  gain:       1,      // ajuste fino de ganho (FATOR_CAL)
  offsetTemp: 0,      // ajuste fino em °C
  faultV:     10.5,   // acima disso = falha upscale
  offV:       0.75,   // area morta: abaixo disso = indicador Therma desligado (0 desativa)
  interval:   5,      // segundos entre envios do ESP
};

// Limites aceitos pelo painel (evita valores que quebram a conversao)
const RULES = {
  rangeMin:   [-200, 1000],
  rangeMax:   [-200, 1000],
  vFull:      [0.1, 30],
  divisor:    [0.1, 50],
  offsetMv:   [-500, 500],
  gain:       [0.5, 1.5],
  offsetTemp: [-50, 50],
  faultV:     [0.1, 30],
  offV:       [0, 5],
  interval:   [2, 300],
};

const FAULT = { NONE: 0, UPSCALE: 1, INDICATOR_OFF: 2 };
const FAULT_LABEL = { 0: null, 1: 'upscale', 2: 'indicator_off' };
const FAULT_TEXT  = { 0: 'Normal', 1: 'Falha upscale (PT100 aberto ou acima da faixa)', 2: 'Indicador Therma desligado' };
const OFF_HYST_V  = 0.05;   // para sair da area morta: v_tx >= off_v + 0,05 V

// wasOff: o sensor estava em area morta na leitura anterior (histerese)
function convert(mv, cal, wasOff = false) {
  const c = { ...DEFAULTS, ...(cal || {}) };
  const mvCorr = mv + c.offsetMv;
  const vTx = (mvCorr / 1000) * c.divisor * c.gain;
  const offLimit = wasOff ? c.offV + OFF_HYST_V : c.offV;
  let fault = FAULT.NONE;
  if (vTx > c.faultV) fault = FAULT.UPSCALE;
  else if (c.offV > 0 && vTx < offLimit) fault = FAULT.INDICATOR_OFF;

  let temperature = c.rangeMin + (vTx / c.vFull) * (c.rangeMax - c.rangeMin) + c.offsetTemp;
  if (fault !== FAULT.NONE) temperature = null;     // upscale ou indicador desligado: valor sem significado
  else temperature = Math.round(temperature * 100) / 100;

  return {
    temperature,
    voltage: Math.round(vTx * 1000) / 1000,
    mv:      Math.round(mv * 10) / 10,
    fault,
    faultLabel: FAULT_LABEL[fault],
    off: fault === FAULT.INDICATOR_OFF,
  };
}

// Valida/normaliza um objeto de calibracao vindo do painel.
// Retorna { ok, value, error }. Campos ausentes sao ignorados.
function validate(input, current) {
  const out = {};
  for (const [k, [min, max]] of Object.entries(RULES)) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    const v = Number(input[k]);
    if (!Number.isFinite(v)) return { ok: false, error: `${k}: valor invalido` };
    if (v < min || v > max) return { ok: false, error: `${k}: deve estar entre ${min} e ${max}` };
    out[k] = k === 'interval' ? Math.round(v) : v;
  }
  const merged = { ...DEFAULTS, ...(current || {}), ...out };
  if (merged.rangeMax <= merged.rangeMin)
    return { ok: false, error: 'A temperatura maxima da faixa deve ser maior que a minima' };
  if (merged.faultV <= merged.vFull * 0.9)
    return { ok: false, error: 'O limiar de falha deve ficar acima do fundo de escala do transmissor' };
  if (merged.offV >= merged.vFull * 0.5)
    return { ok: false, error: 'A area morta deve ficar bem abaixo do fundo de escala do transmissor' };
  return { ok: true, value: out };
}

// Ultima leitura de cada sensor industrial (para o painel nao abrir vazio)
const lastReading = {};

module.exports = { DEFAULTS, RULES, FAULT, FAULT_LABEL, FAULT_TEXT, OFF_HYST_V, convert, validate, lastReading };
