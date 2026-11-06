const router = require('express').Router();
const { auth } = require('../middleware/auth');
const db = require('../models/db');
const { queryHistory, queryStats } = require('../services/influx');

// Verifica se o usuario tem acesso a um sensor com base na tag
function hasAccess(user, sensor) {
  if (user.role === 'admin') return true;
  if (!sensor.tag) return false; // sensor sem tag so admin acessa
  return (user.tags || []).includes(sensor.tag);
}

router.get('/', auth(), async (req, res) => {
  try {
    const all = await db.getSensors();
    const filtered = req.user.role === 'admin'
      ? all
      : all.filter(s => (req.user.tags || []).includes(s.tag));
    res.json(filtered);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', auth(), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    if (!hasAccess(req.user, sensor)) return res.status(403).json({ error: 'Sem permissão para este sensor' });
    res.json(sensor);
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
    await db.updateSensor(req.params.id, fields);
    res.json(await db.getSensorById(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth(['admin']), async (req, res) => {
  try {
    await db.deleteSensor(req.params.id);
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
