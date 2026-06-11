const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url  = require('url');

let wss;

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
      jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      ws.close(1008, 'Token invalido');
      return;
    }
    console.log('[WS] Cliente autenticado conectado');
    ws.on('close', () => console.log('[WS] Cliente desconectado'));
  });

  console.log('[WS] WebSocket server iniciado em /ws');
}

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

module.exports = { setupWebSocket, broadcast };
