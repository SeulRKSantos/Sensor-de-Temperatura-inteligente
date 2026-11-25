// Download do firmware pelo ESP durante a atualização pela rede.
// Sem login: o ESP usa o token de 64 caracteres que recebeu no comando MQTT,
// válido só enquanto aquele job está em andamento. O arquivo baixado ainda é
// conferido no ESP pelo SHA-256 e pela assinatura antes de ser instalado.
const router = require('express').Router();
const ota = require('../services/ota');

router.get('/fw/:token', async (req, res) => {
  try {
    const d = await ota.downloadFor(req.params.token);
    if (!d) return res.status(404).json({ error: 'nao encontrado' });
    console.log(`[OTA] ${d.job.sensor_id}: baixando ${d.fw.version} (${d.fw.size} bytes) de ${req.ip}`);
    res.set('Cache-Control', 'no-store');
    res.sendFile(d.file, { headers: { 'Content-Type': 'application/octet-stream' } }, (err) => {
      if (err && !res.headersSent) res.status(500).end();
      else if (err) console.warn(`[OTA] ${d.job.sensor_id}: download interrompido (${err.message})`);
    });
  } catch (e) {
    console.error('[OTA] download:', e.message);
    res.status(500).json({ error: 'erro no servidor' });
  }
});

module.exports = router;
