const mqtt = require('mqtt');
const { writePoint } = require('./influx');
const { broadcast } = require('./websocket');
const db = require('../models/db');
const { processReading } = require('./alertManager');

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
      if (topic === 'thguard/register') {
        handleRegister(data);
        return;
      }

      const parts    = topic.split('/');
      const sensorId = parts[1];
      const type     = parts[2];

      if (type === 'data')   handleData(sensorId, data);
      if (type === 'status') handleStatus(sensorId, data);
    } catch (e) {
      console.error('[MQTT] Erro ao processar mensagem:', e.message);
    }
  });

  client.on('error',     (err) => console.error('[MQTT] Erro:', err.message));
  client.on('reconnect', ()    => console.log('[MQTT] Reconectando...'));
}

// ── Registro por MAC ───────────────────────────────────────────────
async function handleRegister(data) {
  const { mac } = data;
  if (!mac) { console.warn('[MQTT] Register sem MAC ignorado'); return; }
  const macNorm = mac.toUpperCase().replace(/[^A-F0-9]/g,'').slice(0,12);
  const existing = await db.getSensorByMac(macNorm);
  if (existing) {
    console.log(`[MQTT] MAC ${macNorm} ja registrado como ${existing.id} — reenviando config`);
    sendConfig(macNorm, existing.id);
    return;
  }
  const sensorId = await db.getNextSensorId();
  await registerNewSensor(macNorm, sensorId);
}

async function registerNewSensor(mac, sensorId) {
  await db.createSensor({ id:sensorId, mac, name:`Sensor ${sensorId}`, location:'Sem localizacao' });
  console.log(`[MQTT] Novo sensor registrado: ${sensorId} (MAC: ${mac})`);
  broadcast({ type: 'sensor_registered', sensorId, mac });
  sendConfig(mac, sensorId);
}

async function sendConfig(mac, sensorId) {
  if (!client) return;
  const topic  = `thguard/${mac}/config`;
  const sensor = await db.getSensorById(sensorId);
  const payload = JSON.stringify({
    sensor_id:  sensorId,
    tempLimit:  sensor ? sensor.tempLimit  : 25,
    humidLimit: sensor ? sensor.humidLimit : 80
  });
  client.publish(topic, payload, { retain: true });
  console.log(`[MQTT] Config enviada -> ${topic}: ${payload}`);
}

// ── Dados e status ─────────────────────────────────────────────────
async function handleData(sensorId, data) {
  const { temperature, humidity, ts } = data;
  await ensureSensorExists(sensorId);
  writePoint(sensorId, temperature, humidity);
  broadcast({ type: 'reading', sensorId, temperature, humidity, ts: ts || Date.now() });
  await processReading(sensorId, temperature, humidity);
}

async function handleStatus(sensorId, data) {
  await ensureSensorExists(sensorId);
  await db.updateSensor(sensorId, {
    online: true, lastSeen: new Date().toISOString(),
    ip: data.ip||null, ssid: data.ssid||null,
    ...(data.mac ? { mac: data.mac.toUpperCase().replace(/[^A-F0-9]/g,'').slice(0,12) } : {})
  });
  broadcast({ type: 'status', sensorId, ...data });
}

async function ensureSensorExists(sensorId) {
  const existing = await db.getSensorById(sensorId);
  if (!existing) {
    await db.createSensor({ id:sensorId, mac:null, name:`Sensor ${sensorId}`, location:'Sem localizacao' });
    console.log(`[MQTT] Sensor criado por fallback: ${sensorId}`);
  }
}

function publishCommand(sensorId, command) {
  if (!client) return false;
  client.publish(`thguard/${sensorId}/cmd`, JSON.stringify(command));
  console.log(`[MQTT] Comando → ${sensorId}:`, command);
  return true;
}

module.exports = { connectMQTT, publishCommand };
