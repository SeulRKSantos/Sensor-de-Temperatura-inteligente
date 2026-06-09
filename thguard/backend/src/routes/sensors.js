const router = require('express').Router();
const { auth } = require('../middleware/auth');
const db = require('../models/db');
const { queryHistory, queryStats } = require('../services/influx');

router.get('/', auth(), async (req, res) => {
  try { res.json(await db.getSensors()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', auth(), async (req, res) => {
  try {
    const sensor = await db.getSensorById(req.params.id);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    res.json(sensor);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth(['admin','editor']), async (req, res) => {
  try {
    const allowed = ['name','location','tempLimit','humidLimit'];
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
    const range = req.query.range || '24h';
    res.json(await queryHistory(req.params.id, range));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/stats', auth(), async (req, res) => {
  try {
    const range = req.query.range || '24h';
    res.json(await queryStats(req.params.id, range));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
