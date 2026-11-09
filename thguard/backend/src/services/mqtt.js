const mqtt = require('mqtt');
const { writePoint, writeIndustrialPoint } = require('./influx');
const { broadcast } = require('./websocket');
const db = require('../models/db');
const { processReading, processIndustrial, isIndicatorOff } = require('./alertManager');
const industrial = require('./industrial');

let client;

function connectMQTT() {
  const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
  client = mqtt.connect(brokerUrl, {
    clientId:     'thguard-backend-' + Math.random().toString(16).slice(2, 8),
    username:     process.env.MQTT_USER     || '',
    password:     process.env.MQTT_PASSWORD || '',
    clean:        true,
    reconnectPeriod: 5000
  });

  client.on('connect', () => {
    console.log('[MQTT] Conectado ao broker');
    client.subscribe('thguard/register',   (err) => { if (!err) console.log('[MQTT] Inscrito em thguard/register'); });
    client.subscribe('thguard/+/data',     (err) => { if (!err) console.log('[MQTT] Inscrito em thguard/+/data'); });
    client.subscribe('thguard/+/status',   (err) => { if (!err) console.log('[MQTT] Inscrito em thguard/+/status'); });
  });

  client.on('message', (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());

      // Registro de novo sensor via MAC
      // Os handlers sao async: erros viram log, nao derrubam o processo
      const fail = (e) => console.error(`[MQTT] Erro em ${topic}:`, e.message);

      if (topic === 'thguard/register') {
        handleRegister(data).catch(fail);
        return;
      }

      const parts    = topic.split('/');
      const sensorId = parts[1];
      const type     = parts[2];
      if (!/^[A-Za-z0-9_-]{1,50}$/.test(sensorId || '')) return;

      if (type === 'data')   handleData(sensorId, data).catch(fail);
      if (type === 'status') handleStatus(sensorId, data).catch(fail);
    } catch (e) {
      console.error('[MQTT] Erro ao processar mensagem:', e.message);
    }
  });

  client.on('error',     (err) => console.error('[MQTT] Erro:', err.message));
  client.on('reconnect', ()    => console.log('[MQTT] Reconectando...'));
}

// ── Registro por MAC ───────────────────────────────────────────────
// Sensores TH-GUARD (DHT) mandam {"mac"}; os industriais (VA01) mandam
// {"mac","kind":"industrial","model","fw"} e recebem IDs ind-NNN.
async function handleRegister(data) {
  const { mac } = data;
  if (!mac) { console.warn('[MQTT] Register sem MAC ignorado'); return; }
  const macNorm = mac.toUpperCase().replace(/[^A-F0-9]/g,'').slice(0,12);
  const kind = data.kind === 'industrial' ? 'industrial' : 'thguard';
  const existing = await db.getSensorByMac(macNorm);
  if (existing) {
    if ((existing.kind || 'thguard') !== kind) {
      console.warn(`[MQTT] MAC ${macNorm} registrado como ${existing.id} (${existing.kind}) mas anunciou kind=${kind}. ` +
                   'Apague o sensor no painel para registrar de novo com o tipo certo.');
    }
    console.log(`[MQTT] MAC ${macNorm} ja registrado como ${existing.id} — reenviando config`);
    sendConfig(macNorm, existing.id);
    return;
  }
  const sensorId = await db.getNextSensorId(kind === 'industrial' ? 'ind' : 'sensor');
  await registerNewSensor(macNorm, sensorId, kind, data);
}

async function registerNewSensor(mac, sensorId, kind = 'thguard', data = {}) {
  if (kind === 'industrial') {
    await db.createSensor({
      id: sensorId, mac, kind, model: data.model || null, fw: data.fw || null,
      name: `Industrial ${sensorId}`, location: 'Sem localizacao',
      tempLimit: 120,           // padrao para maquina; ajustar no painel
    });
  } else {
    await db.createSensor({ id:sensorId, mac, name:`Sensor ${sensorId}`, location:'Sem localizacao' });
  }
  console.log(`[MQTT] Novo sensor registrado: ${sensorId} (MAC: ${mac}, tipo: ${kind})`);
  broadcast({ type: 'sensor_registered', sensorId, mac, kind });
  sendConfig(mac, sensorId);
}

async function sendConfig(mac, sensorId) {
  if (!client) return;
  const topic  = `thguard/${mac}/config`;
  const sensor = await db.getSensorById(sensorId);
  let payload;
  if (sensor && sensor.kind === 'industrial') {
    payload = JSON.stringify({
      sensor_id: sensorId,
      interval:  sensor.industrial ? sensor.industrial.interval : industrial.DEFAULTS.interval,
    });
  } else {
    payload = JSON.stringify({
      sensor_id:  sensorId,
      tempLimit:  sensor ? sensor.tempLimit  : 25,
      humidLimit: sensor ? sensor.humidLimit : 80
    });
  }
  client.publish(topic, payload, { retain: true });
  console.log(`[MQTT] Config enviada -> ${topic}: ${payload}`);
}

// Reenvia a config (retida) de um sensor ja cadastrado — usado quando o
// intervalo de envio e alterado no painel.
async function resendConfig(sensorId) {
  const sensor = await db.getSensorById(sensorId);
  if (!sensor || !sensor.mac) return false;
  await sendConfig(sensor.mac, sensorId);
  return true;
}

// Ao apagar um sensor, remove a config retida no broker; senao o ESP
// recebe o ID antigo de novo assim que reconecta.
function clearRetainedConfig(mac) {
  if (!client || !mac) return;
  client.publish(`thguard/${mac}/config`, '', { retain: true });
  console.log(`[MQTT] Config retida removida -> thguard/${mac}/config`);
}

// ── Dados e status ─────────────────────────────────────────────────
async function handleData(sensorId, data) {
  const sensor = await ensureSensorExists(sensorId);
  if (sensor.kind === 'industrial') return handleIndustrialData(sensor, data);

  const { temperature, humidity, ts } = data;
  if (typeof temperature !== 'number' || typeof humidity !== 'number') {
    console.warn(`[MQTT] ${sensorId}: leitura sem temperature/humidity ignorada`);
    return;
  }
  writePoint(sensorId, temperature, humidity);
  broadcast({ type: 'reading', sensorId, temperature, humidity, ts: ts || Date.now() });
  await processReading(sensorId, temperature, humidity);
}

async function handleIndustrialData(sensor, data) {
  const mv = Number(data.mv);
  if (!Number.isFinite(mv)) {
    console.warn(`[MQTT] ${sensor.id}: leitura industrial sem "mv" ignorada`);
    return;
  }
  if (!sensor.industrial) await db.ensureIndustrialConfig(sensor.id);
  const r = industrial.convert(mv, sensor.industrial, isIndicatorOff(sensor.id));
  const spread = Number.isFinite(Number(data.spread)) ? Number(data.spread) : null;

  writeIndustrialPoint(sensor.id, { ...r, spread });
  const reading = {
    type: 'reading', kind: 'industrial', sensorId: sensor.id,
    temperature: r.temperature, voltage: r.voltage, mv: r.mv, spread,
    fault: r.faultLabel, off: r.off, ts: Date.now(),
  };
  industrial.lastReading[sensor.id] = reading;
  broadcast(reading);
  await processIndustrial(sensor.id, r);
}

async function handleStatus(sensorId, data) {
  await ensureSensorExists(sensorId);
  await db.updateSensor(sensorId, {
    online: true, lastSeen: new Date().toISOString(),
    ip: data.ip||null, ssid: data.ssid||null,
    ...(data.mac ? { mac: data.mac.toUpperCase().replace(/[^A-F0-9]/g,'').slice(0,12) } : {}),
    ...(data.fw    ? { fw:    String(data.fw).slice(0,30) }    : {}),
    ...(data.model ? { model: String(data.model).slice(0,30) } : {}),
  });
  broadcast({ type: 'status', sensorId, ...data });
}

async function ensureSensorExists(sensorId) {
  const existing = await db.getSensorById(sensorId);
  if (existing) return existing;
  const kind = sensorId.startsWith('ind-') ? 'industrial' : 'thguard';
  await db.createSensor({
    id: sensorId, mac: null, kind,
    name: kind === 'industrial' ? `Industrial ${sensorId}` : `Sensor ${sensorId}`,
    location: 'Sem localizacao',
    ...(kind === 'industrial' ? { tempLimit: 120 } : {}),
  });
  console.log(`[MQTT] Sensor criado por fallback: ${sensorId} (${kind})`);
  return db.getSensorById(sensorId);
}

function publishCommand(sensorId, command) {
  if (!client) return false;
  client.publish(`thguard/${sensorId}/cmd`, JSON.stringify(command));
  console.log(`[MQTT] Comando → ${sensorId}:`, command);
  return true;
}

module.exports = { connectMQTT, publishCommand, resendConfig, clearRetainedConfig };
