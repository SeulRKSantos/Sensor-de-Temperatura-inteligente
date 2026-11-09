const db = require('../models/db');
const { sendAlert } = require('./email');
const { broadcast } = require('./websocket');

// Estado em memória dos alertas ativos
const alertState = {};
// { sensorId: { tempHigh: bool, humidHigh: bool, offline: bool, lastSeen: ts } }

const OFFLINE_THRESHOLD = 2 * 60 * 1000;       // 5 min sem dados = offline
const ALERT_REPEAT_INTERVAL = 30 * 60 * 1000;  // reenvio a cada 30 min se persistir
const NORMALIZE_DEBOUNCE = 3 * 60 * 1000;       // 3 min abaixo do limite p/ normalizar

// Chamado pelo mqtt.js a cada leitura recebida
async function processReading(sensorId, temperature, humidity, extra = {}) {
  const sensor = await db.getSensorById(sensorId);
  if (!sensor) return;

  const now = Date.now();
  if (!alertState[sensorId]) {
    alertState[sensorId] = {
      tempHigh: false, humidHigh: false, offline: false,
      lastSeen: now,
      tempHighSince: null, humidHighSince: null,
      tempLowSince: null, humidLowSince: null,
      lastTempAlert: 0, lastHumidAlert: 0,
    };
  }

  const s = alertState[sensorId];
  s.lastSeen = now;

  // ── Se estava offline, volta online ──────────────────────────────
  if (s.offline) {
    s.offline = false;
    console.log(`[ALERT] ${sensorId} voltou online`);
    await db.updateSensor(sensorId, { online: true });
    broadcast({ type: 'status', sensorId, online: true });
    await sendAlert(sensorId, 'sensor_online', { ...extra, temperature, humidity });
  }

  // ── Temperatura ───────────────────────────────────────────────────
  const tempAlta = temperature >= sensor.tempLimit;

  if (tempAlta) {
    s.tempLowSince = null;
    if (!s.tempHigh) {
      // Entrou em alerta
      s.tempHigh = true;
      s.tempHighSince = now;
      s.lastTempAlert = now;
      console.log(`[ALERT] ${sensorId} TEMP ALTA: ${temperature}°C`);
      await sendAlert(sensorId, 'temp_high', { ...extra, temperature, humidity });
    } else if (now - s.lastTempAlert >= ALERT_REPEAT_INTERVAL) {
      // Persiste — reenvia
      s.lastTempAlert = now;
      console.log(`[ALERT] ${sensorId} TEMP continua alta: ${temperature}°C`);
      await sendAlert(sensorId, 'temp_high', { ...extra, temperature, humidity });
    }
  } else {
    if (s.tempHigh) {
      if (!s.tempLowSince) {
        s.tempLowSince = now;
      } else if (now - s.tempLowSince >= NORMALIZE_DEBOUNCE) {
        // Normalizada confirmada
        s.tempHigh = false;
        s.tempLowSince = null;
        console.log(`[ALERT] ${sensorId} TEMP normalizada: ${temperature}°C`);
        await sendAlert(sensorId, 'temp_normal', { ...extra, temperature, humidity });
      }
    }
  }

  // ── Umidade ───────────────────────────────────────────────────────
  const humidAlta = humidity != null && humidity >= sensor.humidLimit;

  if (humidAlta) {
    s.humidLowSince = null;
    if (!s.humidHigh) {
      s.humidHigh = true;
      s.lastHumidAlert = now;
      console.log(`[ALERT] ${sensorId} UMIDADE ALTA: ${humidity}%`);
      await sendAlert(sensorId, 'humid_high', { ...extra, temperature, humidity });
    } else if (now - s.lastHumidAlert >= ALERT_REPEAT_INTERVAL) {
      s.lastHumidAlert = now;
      await sendAlert(sensorId, 'humid_high', { ...extra, temperature, humidity });
    }
  } else {
    if (s.humidHigh) {
      if (!s.humidLowSince) {
        s.humidLowSince = now;
      } else if (now - s.humidLowSince >= NORMALIZE_DEBOUNCE) {
        s.humidHigh = false;
        s.humidLowSince = null;
        console.log(`[ALERT] ${sensorId} UMIDADE normalizada: ${humidity}%`);
        await sendAlert(sensorId, 'humid_normal', { ...extra, temperature, humidity });
      }
    }
  }

  await db.updateSensor(sensorId, { alertActive: s.tempHigh || s.humidHigh || s.faultActive ? 1 : 0 });
}

// ── Sensores industriais ───────────────────────────────────────────
// r = resultado de industrial.convert(): { temperature, voltage, mv, fault, faultLabel }
// - temperatura: mesma logica do TH-GUARD (limite, reenvio a cada 30 min, debounce de 3 min)
// - falha (upscale / sem sinal): alerta "sensor_fault" e "fault_cleared" ao normalizar
const FAULT_CONFIRM = 3;   // leituras seguidas com falha antes de alertar (evita ruido)
const { FAULT_TEXT } = require('./industrial');

async function processIndustrial(sensorId, r) {
  const data = { temperature: r.temperature, voltage: r.voltage, fault: r.fault };

  if (r.temperature != null) {
    await processReading(sensorId, r.temperature, null, data);
  } else {
    // Upscale ou indicador desligado: sem temperatura valida, mas o sensor esta vivo
    await touch(sensorId, data);
  }

  const s = alertState[sensorId];
  const now = Date.now();

  // Area morta: indicador Therma desligado faz parte da operacao normal.
  // Nao e falha, nao gera e-mail e nao conta para normalizar uma falha.
  if (r.off) {
    if (!s.indicatorOff) console.log(`[IND] ${sensorId} indicador Therma desligado (V=${r.voltage})`);
    s.indicatorOff = true;
    await db.updateSensor(sensorId, { alertActive: s.faultActive ? 1 : 0 });
    return;
  }
  if (s.indicatorOff) console.log(`[IND] ${sensorId} indicador Therma ligado (V=${r.voltage})`);
  s.indicatorOff = false;

  if (r.fault) {
    s.faultCount = (s.faultCount || 0) + 1;
    s.faultOkCount = 0;
    if (!s.faultActive && s.faultCount >= FAULT_CONFIRM) {
      s.faultActive = true;
      s.faultType = r.fault;
      s.lastFaultAlert = now;
      console.log(`[ALERT] ${sensorId} FALHA: ${FAULT_TEXT[r.fault]} (V=${r.voltage})`);
      await sendAlert(sensorId, 'sensor_fault', data);
    } else if (s.faultActive && now - (s.lastFaultAlert || 0) >= ALERT_REPEAT_INTERVAL) {
      s.lastFaultAlert = now;
      await sendAlert(sensorId, 'sensor_fault', data);
    }
  } else {
    s.faultCount = 0;
    if (s.faultActive) {
      s.faultOkCount = (s.faultOkCount || 0) + 1;
      if (s.faultOkCount >= FAULT_CONFIRM) {
        s.faultActive = false;
        s.faultType = null;
        console.log(`[ALERT] ${sensorId} falha normalizada (V=${r.voltage})`);
        await sendAlert(sensorId, 'fault_cleared', data);
      }
    }
  }
  await db.updateSensor(sensorId, { alertActive: s.tempHigh || s.faultActive ? 1 : 0 });
}

// Estado de area morta do sensor (para a histerese da conversao)
function isIndicatorOff(sensorId) {
  return !!(alertState[sensorId] && alertState[sensorId].indicatorOff);
}

// Marca o sensor como vivo sem avaliar temperatura
async function touch(sensorId, data) {
  const s = ensureState(sensorId);
  s.lastSeen = Date.now();
  if (s.offline) {
    s.offline = false;
    console.log(`[ALERT] ${sensorId} voltou online`);
    await db.updateSensor(sensorId, { online: true });
    broadcast({ type: 'status', sensorId, online: true });
    await sendAlert(sensorId, 'sensor_online', data || {});
  }
}

function ensureState(sensorId) {
  if (!alertState[sensorId]) {
    alertState[sensorId] = {
      tempHigh: false, humidHigh: false, offline: false,
      lastSeen: Date.now(),
      tempHighSince: null, humidHighSince: null,
      tempLowSince: null, humidLowSince: null,
      lastTempAlert: 0, lastHumidAlert: 0,
      faultActive: false, faultType: null, faultCount: 0, faultOkCount: 0, lastFaultAlert: 0,
    };
  }
  return alertState[sensorId];
}

// Checker de offline — roda a cada minuto
async function initOfflineState() {
  // Inicializa estado dos sensores ja cadastrados no boot.
  // Sensores com last_seen antigo entram como offline imediatamente.
  const sensors = await db.getSensors();
  const now = Date.now();
  for (const sensor of sensors) {
    const lastSeenMs = sensor.lastSeen ? new Date(sensor.lastSeen).getTime() : 0;
    const isOffline = !lastSeenMs || (now - lastSeenMs > OFFLINE_THRESHOLD);
    alertState[sensor.id] = {
      tempHigh: false, humidHigh: false, offline: isOffline,
      lastSeen: lastSeenMs || now,
      tempHighSince: null, humidHighSince: null,
      tempLowSince: null, humidLowSince: null,
      lastTempAlert: 0, lastHumidAlert: 0,
    };
    // Corrige o banco se estava marcado online incorretamente
    if (isOffline && sensor.online) {
      await db.updateSensor(sensor.id, { online: false });
      broadcast({ type: 'status', sensorId: sensor.id, online: false });
      console.log(`[ALERT] ${sensor.id} marcado OFFLINE no boot (last_seen antigo)`);
    }
  }
}

function startOfflineChecker() {
  initOfflineState().catch(e => console.error('[ALERT] Erro init:', e.message));
  setInterval(async () => {
    const now = Date.now();
    const sensors = await db.getSensors();
    for (const sensor of sensors) {
      const s = alertState[sensor.id];
      if (!s) continue;
      if (!s.offline && now - s.lastSeen > OFFLINE_THRESHOLD) {
        s.offline = true;
        console.log(`[ALERT] ${sensor.id} OFFLINE (último dado há ${Math.round((now - s.lastSeen)/1000)}s)`);
        await db.updateSensor(sensor.id, { online: false });
        broadcast({ type: 'status', sensorId: sensor.id, online: false });
        await sendAlert(sensor.id, 'sensor_offline', {});
      }
    }
  }, 60 * 1000);
}

// Retorna estado atual dos alertas (para a API)
function getAlertState() {
  return alertState;
}

module.exports = { processReading, processIndustrial, isIndicatorOff, startOfflineChecker, getAlertState };
