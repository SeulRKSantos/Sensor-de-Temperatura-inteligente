const router = require('express').Router();
const { auth } = require('../middleware/auth');
const db = require('../models/db');
const { queryHistory, queryStats } = require('../services/influx');
const industrial = require('../services/industrial');
const { resendConfig, clearRetainedConfig } = require('../services/mqtt');
const { refreshTags } = require('../services/websocket');

// Anexa a ultima leitura conhecida (sensores industriais) para o painel nao abrir vazio
function withLast(s) {
  if (s.kind !== 'industrial') return s;
  return { ...s, last: industrial.lastReading[s.id] || null };
}

// Verifica se o usuario tem acesso a um sensor com base na tag
function hasAccess(user, sensor) {
  if (user.role === 'admin') return true;
  if (!sensor.tag) return false; // sensor sem tag so admin acessa
  return (user.tags || []).includes(sensor.tag);
}

router.get('/', auth(), async (req, res) => {
  try {
    // ?kind=thguard | industrial  (sem o parametro: todos, como antes)
    const kind = ['thguard','industrial'].includes(req.query.kind) ? req.query.kind : undefined;
    const all = await db.getSensors(kind);
    const filtered = req.user.role === 'admin'
      ? all
      : all.filter(s => (req.user.tags || []).includes(s.tag));
    res.json(filtered.map(withLast));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', auth(), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    if (!hasAccess(req.user, sensor)) return res.status(403).json({ error: 'Sem permissão para este sensor' });
    res.json(withLast(sensor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth(['admin','editor']), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    if (!hasAccess(req.user, sensor)) return res.status(403).json({ error: 'Sem permissão para este sensor' });

    const allowed = ['name','location','tempLimit','humidLimit'];
    if (req.user.role === 'admin') allowed.push('tag'); // so admin move sensor entre tags

    const fields = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
    for (const k of ['tempLimit','humidLimit']) {
      if (fields[k] !== undefined) {
        const v = Number(fields[k]);
        if (!Number.isFinite(v)) return res.status(400).json({ error: `${k} invalido` });
        fields[k] = v;
      }
    }
    if (fields.tag !== undefined) fields.tag = String(fields.tag).trim() || null;

    // Calibracao do sensor industrial (faixa, offset, divisor, intervalo...)
    let resend = false;
    if (sensor.kind === 'industrial' && req.body.industrial && typeof req.body.industrial === 'object') {
      const v = industrial.validate(req.body.industrial, sensor.industrial);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const prevInterval = sensor.industrial ? sensor.industrial.interval : null;
      await db.updateIndustrialConfig(req.params.id, v.value);
      if (v.value.interval !== undefined && v.value.interval !== prevInterval) resend = true;
      console.log(`[SENSORS] Calibracao de ${req.params.id} alterada por ${req.user.email}:`, v.value);
    }

    await db.updateSensor(req.params.id, fields);
    if (resend) await resendConfig(req.params.id);   // o ESP aplica o novo intervalo
    if (fields.tag !== undefined) refreshTags();
    res.json(withLast(await db.getSensorById(req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth(['admin']), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    await db.deleteSensor(req.params.id);
    if (sensor && sensor.mac) clearRetainedConfig(sensor.mac);
    delete industrial.lastReading[req.params.id];
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/history', auth(), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    if (!hasAccess(req.user, sensor)) return res.status(403).json({ error: 'Sem permissão para este sensor' });
    const range = req.query.range || '24h';
    res.json(await queryHistory(req.params.id, range));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/stats', auth(), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    if (!hasAccess(req.user, sensor)) return res.status(403).json({ error: 'Sem permissão para este sensor' });
    const range = req.query.range || '24h';
    res.json(await queryStats(req.params.id, range));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/meta/tags', auth(), async (req, res) => {
  try { res.json(await db.getAllTags()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
