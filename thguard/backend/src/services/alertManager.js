const db = require('../models/db');
const { sendAlert } = require('./email');

// Estado em memória dos alertas ativos
const alertState = {};
// { sensorId: { tempHigh: bool, humidHigh: bool, offline: bool, lastSeen: ts } }

const OFFLINE_THRESHOLD = 2 * 60 * 1000;       // 5 min sem dados = offline
const ALERT_REPEAT_INTERVAL = 30 * 60 * 1000;  // reenvio a cada 30 min se persistir
const NORMALIZE_DEBOUNCE = 3 * 60 * 1000;       // 3 min abaixo do limite p/ normalizar

// Chamado pelo mqtt.js a cada leitura recebida
async function processReading(sensorId, temperature, humidity) {
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
    await sendAlert(sensorId, 'sensor_online', { temperature, humidity });
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
      await sendAlert(sensorId, 'temp_high', { temperature, humidity });
    } else if (now - s.lastTempAlert >= ALERT_REPEAT_INTERVAL) {
      // Persiste — reenvia
      s.lastTempAlert = now;
      console.log(`[ALERT] ${sensorId} TEMP continua alta: ${temperature}°C`);
      await sendAlert(sensorId, 'temp_high', { temperature, humidity });
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
        await sendAlert(sensorId, 'temp_normal', { temperature, humidity });
      }
    }
  }

  // ── Umidade ───────────────────────────────────────────────────────
  const humidAlta = humidity >= sensor.humidLimit;

  if (humidAlta) {
    s.humidLowSince = null;
    if (!s.humidHigh) {
      s.humidHigh = true;
      s.lastHumidAlert = now;
      console.log(`[ALERT] ${sensorId} UMIDADE ALTA: ${humidity}%`);
      await sendAlert(sensorId, 'humid_high', { temperature, humidity });
    } else if (now - s.lastHumidAlert >= ALERT_REPEAT_INTERVAL) {
      s.lastHumidAlert = now;
      await sendAlert(sensorId, 'humid_high', { temperature, humidity });
    }
  } else {
    if (s.humidHigh) {
      if (!s.humidLowSince) {
        s.humidLowSince = now;
      } else if (now - s.humidLowSince >= NORMALIZE_DEBOUNCE) {
        s.humidHigh = false;
        s.humidLowSince = null;
        console.log(`[ALERT] ${sensorId} UMIDADE normalizada: ${humidity}%`);
        await sendAlert(sensorId, 'humid_normal', { temperature, humidity });
      }
    }
  }

  await db.updateSensor(sensorId, { alertActive: s.tempHigh || s.humidHigh ? 1 : 0 });
}

// Checker de offline — roda a cada minuto
function startOfflineChecker() {
  setInterval(async () => {
    const now = Date.now();
    const sensors = await db.getSensors();
    for (const sensor of sensors) {
      const s = alertState[sensor.id];
      if (!s) continue;
      if (!s.offline && now - s.lastSeen > OFFLINE_THRESHOLD) {
        s.offline = true;
        console.log(`[ALERT] ${sensor.id} OFFLINE (último dado há ${Math.round((now - s.lastSeen)/1000)}s)`);
        await sendAlert(sensor.id, 'sensor_offline', {});
      }
    }
  }, 60 * 1000);
}

// Retorna estado atual dos alertas (para a API)
function getAlertState() {
  return alertState;
}

module.exports = { processReading, startOfflineChecker, getAlertState };
