const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url  = require('url');

let wss;

// Tag de cada sensor, para entregar as leituras em tempo real apenas a quem
// pode ver o sensor (mesma regra das rotas: admin ve tudo; demais so a tag deles;
// sensor sem tag so admin). Atualizado a cada 30 s.
const sensorTag = new Map();
async function refreshTags() {
  try {
    const db = require('../models/db');
    const sensors = await db.getSensors();
    sensorTag.clear();
    sensors.forEach(s => sensorTag.set(s.id, s.tag || null));
  } catch (e) { /* banco ainda subindo: tenta no proximo ciclo */ }
}

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Valida JWT no handshake
    const params = url.parse(req.url, true).query;
    const token  = params.token;
    if (!token) {
      ws.close(1008, 'Token ausente');
      return;
    }
    try {
      ws.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      ws.close(1008, 'Token invalido');
      return;
    }
    console.log('[WS] Cliente autenticado conectado');
    ws.on('close', () => console.log('[WS] Cliente desconectado'));
  });

  refreshTags();
  setInterval(refreshTags, 30 * 1000);
  console.log('[WS] WebSocket server iniciado em /ws');
}

function canSee(user, sensorId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!sensorId) return true;                       // mensagem sem sensor: geral
  const tag = sensorTag.get(sensorId);
  return !!tag && (user.tags || []).includes(tag);
}

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && canSee(client.user, data.sensorId)) client.send(msg);
  });
}

module.exports = { setupWebSocket, broadcast, refreshTags };
