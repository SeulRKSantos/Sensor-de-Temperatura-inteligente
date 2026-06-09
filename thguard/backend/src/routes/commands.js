const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { publishCommand } = require('../services/mqtt');

// POST /api/commands/:sensorId
// Envia um comando para o sensor via MQTT
// Comandos suportados:
//   { action: 'set_config', tempLimit, humidLimit, location, ssid1, pass1, ssid2, pass2, serverIp }
//   { action: 'restart' }
//   { action: 'reset_eeprom' }

router.post('/:sensorId', auth(['admin', 'editor']), (req, res) => {
  const { sensorId } = req.params;
  const { action, ...params } = req.body;

  const allowedActions = ['set_config', 'restart', 'reset_eeprom'];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: `Ação inválida. Use: ${allowedActions.join(', ')}` });
  }

  const ok = publishCommand(sensorId, { action, ...params });
  if (!ok) return res.status(503).json({ error: 'MQTT broker não conectado' });

  res.json({ ok: true, sensorId, action, params });
});

module.exports = router;
