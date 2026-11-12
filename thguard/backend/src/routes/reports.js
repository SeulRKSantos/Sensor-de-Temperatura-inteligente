// Relatórios mensais dos sensores industriais: calendário do mês e .xlsx de cada dia.
const router = require('express').Router();
const { auth } = require('../middleware/auth');
const db = require('../models/db');
const rep = require('../services/industrialReport');

// Mesmo critério de acesso do resto da API: admin vê tudo; os demais, os sensores das suas tags
function hasAccess(user, sensor) {
  if (user.role === 'admin') return true;
  return !!sensor.tag && (user.tags || []).includes(sensor.tag);
}

// ?sensor=all | ind-NNN  →  sensores industriais que o usuário pode ver
async function resolveSensors(req) {
  const all = (await db.getSensors('industrial')).filter((s) => hasAccess(req.user, s));
  const wanted = req.query.sensor || 'all';
  if (wanted === 'all') return all;
  const s = all.find((x) => x.id === wanted);
  if (!s) { const e = new Error('Sensor industrial nao encontrado ou sem permissao'); e.status = 404; throw e; }
  return [s];
}
const fail = (res, e) => res.status(e.status || (/invalid[oa]/.test(e.message) ? 400 : 500)).json({ error: e.message });

// Calendário: minutos com leitura por dia (máximo 1440) e por sensor
router.get('/industrial/days', auth(['admin', 'editor']), async (req, res) => {
  try {
    const { month, days } = rep.parseMonth(req.query.month);
    const sensors = await resolveSensors(req);
    const coverage = sensors.length ? await rep.queryMonthCoverage(sensors.map((s) => s.id), month) : {};
    res.json({
      month, days, today: rep.localDate(Date.now()), minutesPerDay: rep.MINUTES,
      sensors: sensors.map((s) => ({ id: s.id, name: s.name })),
      coverage,
    });
  } catch (e) { fail(res, e); }
});

// Relatório do dia em .xlsx: "Minuto a minuto" + "Gráfico"
router.get('/industrial/daily.xlsx', auth(['admin', 'editor']), async (req, res) => {
  try {
    const { day, start } = rep.parseDay(req.query.date);
    if (start > Date.now()) return res.status(400).json({ error: 'Dia ainda nao comecou' });
    const sensors = await resolveSensors(req);
    if (!sensors.length) return res.status(404).json({ error: 'Nenhum sensor industrial disponivel' });
    const ids = sensors.map((s) => s.id);
    const rows = await rep.queryDayMinutes(ids, day);
    if (!rows.length) return res.status(404).json({ error: 'Sem leituras neste dia' });
    const grid = rep.buildMinuteGrid(rows, ids, start);
    const buf = rep.buildDailyWorkbook({
      day, grid,
      sensors: sensors.map((s) => ({ id: s.id, name: s.name || s.id, location: s.location, tempLimit: s.tempLimit ?? null })),
    });
    const who = sensors.length === 1 ? sensors[0].id : 'todos';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="industrial_${who}_${day}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) { fail(res, e); }
});

module.exports = router;
