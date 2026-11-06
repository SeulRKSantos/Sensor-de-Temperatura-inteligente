const router = require('express').Router();
const { auth } = require('../middleware/auth');
const db = require('../models/db');
const { sendAlert, defaultSubject, defaultBody } = require('../services/email');
const { getAlertState } = require('../services/alertManager');
const { queryHistory, queryStats } = require('../services/influx');

const ALERT_TYPES = {
  thguard:    ['temp_high','humid_high','sensor_offline','temp_normal',
               'humid_normal','sensor_online','daily','weekly','monthly'],
  industrial: ['temp_high','temp_normal','sensor_fault','fault_cleared',
               'sensor_offline','sensor_online','daily','weekly','monthly'],
};
const typesOf = (sensor) => ALERT_TYPES[sensor.kind] || ALERT_TYPES.thguard;

// Middleware — valida acesso ao sensor da URL com base na tag do usuario
async function checkSensorAccess(req, res, next) {
  try {
    const sensor = await db.getSensorById(req.params.sensorId);
    if (!sensor) return res.status(404).json({ error: 'Sensor nao encontrado' });
    const allowed = req.user.role === 'admin' ||
      (sensor.tag && (req.user.tags || []).includes(sensor.tag));
    if (!allowed) return res.status(403).json({ error: 'Sem permissão para este sensor' });
    req.sensor = sensor;
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

router.get('/smtp', auth(['admin']), async (req, res) => {
  try {
    const smtp = await db.getSmtp();
    res.json({ ...smtp, pass: smtp.pass ? '***' : '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/smtp', auth(['admin']), async (req, res) => {
  try {
    const { host, port, user, pass, fromName } = req.body;
    const current = await db.getSmtp();
    await db.saveSmtp({
      host: host||'', port: port||587, user: user||'',
      pass: (pass && pass !== '***') ? pass : (current.pass||''),
      fromName: fromName||'TH-GUARD'
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:sensorId', auth(), checkSensorAccess, async (req, res) => {
  try {
    const saved = await db.getSensorAlerts(req.params.sensorId);
    const alerts = {};
    typesOf(req.sensor).forEach(t => {
      alerts[t] = {
        enabled: false, to:'', cc:'', bcc:'',
        subject: defaultSubject(t, req.sensor.kind), body: defaultBody(t, req.sensor.kind),
        ...(saved[t]||{})
      };
    });
    res.json(alerts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:sensorId', auth(['admin','editor']), checkSensorAccess, async (req, res) => {
  try {
    // Aceita apenas os tipos validos para o tipo de sensor
    const valid = typesOf(req.sensor);
    const body = {};
    Object.entries(req.body || {}).forEach(([t, cfg]) => { if (valid.includes(t)) body[t] = cfg; });
    await db.saveSensorAlerts(req.params.sensorId, body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:sensorId/test/:type', auth(['admin','editor']), checkSensorAccess, async (req, res) => {
  try {
    if (!typesOf(req.sensor).includes(req.params.type))
      return res.status(400).json({ error: 'Tipo de alerta invalido para este sensor' });
    const sample = req.sensor.kind === 'industrial'
      ? { temperature: 85.0, voltage: 5.67, fault: req.params.type === 'sensor_fault' ? 1 : 0 }
      : { temperature: 26.5, humidity: 85 };
    await sendAlert(req.params.sensorId, req.params.type, sample);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:sensorId/history', auth(), checkSensorAccess, async (req, res) => {
  try { res.json(await db.getEmailHistory(req.params.sensorId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:sensorId/state', auth(), checkSensorAccess, (req, res) => {
  res.json(getAlertState()[req.params.sensorId] || {});
});

router.get('/:sensorId/report/:period', auth(), checkSensorAccess, async (req, res) => {
  const ranges = { monthly:'720h', semiannual:'4320h', annual:'8760h' };
  const range = ranges[req.params.period];
  if (!range) return res.status(400).json({ error: 'Periodo invalido' });
  try {
    const data = await queryHistory(req.params.sensorId, range);
    if (req.query.format === 'csv') {
      const ind = req.sensor.kind === 'industrial';
      const second = ind ? 'voltage' : 'humidity';
      const csv = [`timestamp,temperature,${second}`,
        ...data.map(r => `${r.ts},${r.temperature??''},${r[second]??''}`)
      ].join('\n');
      res.setHeader('Content-Type','text/csv');
      res.setHeader('Content-Disposition',
        `attachment; filename="${req.params.sensorId}_${req.params.period}.csv"`);
      return res.send(csv);
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
