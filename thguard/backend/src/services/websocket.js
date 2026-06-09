const { WebSocketServer } = require('ws');

let wss;

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Cliente conectado');
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
