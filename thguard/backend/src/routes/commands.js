const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { publishCommand } = require('../services/mqtt');
const db = require('../models/db');

// POST /api/commands/:sensorId
// Envia um comando para o sensor via MQTT
// Comandos suportados:
//   { action: 'set_config', tempLimit, humidLimit, location, ssid1, pass1, ssid2, pass2, serverIp }
//   { action: 'restart' }
//   { action: 'reset_eeprom' }
// Somente industriais (VA01):
//   { action: 'identify' }   pisca o LED da placa por 15 s
//   { action: 'read_now' }   envia uma leitura imediatamente

const ACTIONS = {
  thguard:    ['set_config', 'restart', 'reset_eeprom'],
  industrial: ['set_config', 'restart', 'reset_eeprom', 'identify', 'read_now'],
};

router.post('/:sensorId', auth(['admin', 'editor']), async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { action, ...params } = req.body;

    // Mesmo controle de acesso por tag das outras rotas
    const sensor = await db.getSensorById(sensorId);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    const allowed = req.user.role === 'admin' ||
      (sensor.tag && (req.user.tags || []).includes(sensor.tag));
    if (!allowed) return res.status(403).json({ error: 'Sem permissão para este sensor' });

    const allowedActions = ACTIONS[sensor.kind] || ACTIONS.thguard;
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ error: `Ação inválida. Use: ${allowedActions.join(', ')}` });
    }

    const ok = publishCommand(sensorId, { action, ...params });
    if (!ok) return res.status(503).json({ error: 'MQTT broker não conectado' });

    // Nao devolve senhas de Wi-Fi na resposta
    const safe = { ...params };
    if (safe.pass1) safe.pass1 = '***';
    if (safe.pass2) safe.pass2 = '***';
    res.json({ ok: true, sensorId, action, params: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
