// Painel de administração: espaço, métricas, lixeira de sensores, exclusão de
// leituras, arquivos guardados e logs. Tudo só para admin e tudo auditado.
const router = require('express').Router();
const { auth } = require('../middleware/auth');
const db = require('../models/db');
const files = require('../services/files');
const influxAdmin = require('../services/influxAdmin');
const dockerLogs = require('../services/dockerLogs');
const logger = require('../services/logger');
const { purgeSensor } = require('../services/maintenance');

router.use(auth(['admin']));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (!e.status || e.status >= 500) console.error(`[ADMIN] ${req.method} ${req.path}:`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// Exclusões pedem a palavra EXCLUIR digitada (o painel pede ao usuário)
function requireConfirm(req) { if (req.body?.confirm !== 'EXCLUIR') throw bad('Confirme digitando EXCLUIR'); }
const settled = async (p) => { try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: e.message }; } };

// ── Visão geral ───────────────────────────────────────────────────
router.get('/overview', wrap(async (req, res) => {
  const [tables, bucket, reports, backups, sensors, trash, users, logs24, emails7, perDay] = await Promise.all([
    settled(db.query(`SELECT table_name AS name, table_rows AS \`rows\`, data_length + index_length AS bytes
      FROM information_schema.TABLES WHERE table_schema = DATABASE() ORDER BY bytes DESC`)),
    settled(influxAdmin.bucketInfo()),
    settled(files.list('reports')),
    settled(files.list('backups')),
    db.getSensors(),
    db.getTrashedSensors(),
    db.query('SELECT role, COUNT(*) AS n FROM users GROUP BY role'),
    settled(db.query(`SELECT level, COUNT(*) AS n FROM system_log WHERE ts > NOW() - INTERVAL 1 DAY GROUP BY level`)),
    db.query(`SELECT type, COUNT(*) AS n FROM email_history WHERE ts > NOW() - INTERVAL 7 DAY GROUP BY type`),
    settled(influxAdmin.readingsPerDay(30)),
  ]);
  const influxBytes = bucket.ok && bucket.value ? await influxAdmin.bucketDiskBytes(bucket.value.id) : null;
  const sum = (rows) => rows.reduce((a, r) => a + Number(r.n), 0);
  res.json({
    disk: files.disk(),
    disks: files.disks(),
    mariadb: tables.ok ? { bytes: tables.value.reduce((a, t) => a + Number(t.bytes || 0), 0), tables: tables.value.map((t) => ({ name: t.name, rows: Number(t.rows || 0), bytes: Number(t.bytes || 0) })) } : { error: tables.error },
    influx: bucket.ok ? { ...(bucket.value || {}), bytes: influxBytes } : { error: bucket.error },
    files: {
      reports: reports.ok ? { count: reports.value.count, bytes: reports.value.bytes, dir: reports.value.dir, exists: reports.value.exists } : { error: reports.error },
      backups: backups.ok ? { count: backups.value.count, bytes: backups.value.bytes, dir: backups.value.dir, exists: backups.value.exists } : { error: backups.error },
    },
    sensors: {
      total: sensors.length, online: sensors.filter((s) => s.online).length,
      industrial: sensors.filter((s) => s.kind === 'industrial').length, thguard: sensors.filter((s) => s.kind !== 'industrial').length,
      trash: trash.length,
    },
    users: { total: sum(users), byRole: Object.fromEntries(users.map((u) => [u.role, Number(u.n)])) },
    logs24h: logs24.ok ? Object.fromEntries(logs24.value.map((r) => [r.level, Number(r.n)])) : {},
    emails7d: { total: sum(emails7), byType: Object.fromEntries(emails7.map((r) => [r.type, Number(r.n)])) },
    readingsPerDay: perDay.ok ? perDay.value : [],
    dockerLogs: dockerLogs.enabled(),
  });
}));

// ── Sensores (ativos e lixeira) ───────────────────────────────────
router.get('/sensors', wrap(async (req, res) => {
  const [active, trash, influx, emails] = await Promise.all([
    db.getSensors(), db.getTrashedSensors(), settled(influxAdmin.perSensor()),
    db.query(`SELECT sensor_id, COUNT(*) AS n, MAX(ts) AS last FROM email_history WHERE ts > NOW() - INTERVAL 30 DAY GROUP BY sensor_id`),
  ]);
  const settings = await db.getSettings();
  const em = Object.fromEntries(emails.map((r) => [r.sensor_id, { n: Number(r.n), last: r.last }]));
  const metrics = influx.ok ? influx.value : {};
  // Intervalo esperado entre leituras: 5 s nos industriais (configurável), 30 s nos TH-GUARD
  const expected = (s) => 86400 / (s.kind === 'industrial' ? (s.industrial?.interval || 5) : 30);
  const view = (s) => {
    const m = metrics[s.id] || {};
    return {
      id: s.id, name: s.name, kind: s.kind, location: s.location, tag: s.tag, mac: s.mac, online: s.online, lastSeen: s.lastSeen,
      createdAt: s.createdAt, firstReading: m.first || null, lastReading: m.last || null, readings24h: m.readings24h || 0,
      coverage24h: Math.min(100, Math.round(((m.readings24h || 0) / expected(s)) * 100)),
      emails30d: em[s.id]?.n || 0,
      ...(s.deletedAt ? { deletedAt: s.deletedAt, deletedBy: s.deletedBy, purgeHistory: s.purgeHistory,
        purgeAt: new Date(new Date(s.deletedAt).getTime() + settings.trash_days * 86400e3).toISOString() } : {}),
    };
  };
  res.json({ active: active.map(view), trash: trash.map(view), trashDays: settings.trash_days, influxError: influx.ok ? null : influx.error });
}));

router.post('/sensors/:id/trash', wrap(async (req, res) => {
  const s = await db.getSensorById(req.params.id);
  if (!s) throw bad('Sensor nao encontrado', 404);
  const { clearRetainedConfig } = require('../services/mqtt');
  await db.trashSensor(s.id, { by: req.user.email, purgeHistory: !!req.body?.purgeHistory });
  if (s.mac) clearRetainedConfig(s.mac);
  logger.audit(req.user, 'admin', `Sensor ${s.id} (${s.name}) enviado para a lixeira${req.body?.purgeHistory ? ' (historico sera apagado na exclusao definitiva)' : ''}`);
  res.json({ ok: true });
}));

router.post('/sensors/:id/restore', wrap(async (req, res) => {
  const s = await db.getSensorById(req.params.id, { includeDeleted: true });
  if (!s || !s.deletedAt) throw bad('Sensor nao esta na lixeira', 404);
  await db.restoreSensor(s.id);
  const { resendConfig } = require('../services/mqtt');
  await resendConfig(s.id);                  // o dispositivo volta a receber o ID
  logger.audit(req.user, 'admin', `Sensor ${s.id} (${s.name}) restaurado da lixeira`);
  res.json({ ok: true });
}));

// Exclusão definitiva: só de sensores que já estão na lixeira
router.delete('/sensors/:id', wrap(async (req, res) => {
  requireConfirm(req);
  const s = await db.getSensorById(req.params.id, { includeDeleted: true });
  if (!s) throw bad('Sensor nao encontrado', 404);
  if (!s.deletedAt) throw bad('Envie o sensor para a lixeira antes de excluir definitivamente');
  const history = req.body?.history !== undefined ? !!req.body.history : s.purgeHistory;
  res.json({ ok: true, ...(await purgeSensor(s, { history, by: req.user })) });
}));

// ── Leituras no InfluxDB ──────────────────────────────────────────
router.post('/data/preview', wrap(async (req, res) => {
  const { start, stop, sensorId } = req.body || {};
  res.json(await influxAdmin.countRange({ start, stop, sensorId: sensorId || null }));
}));

router.post('/data/delete', wrap(async (req, res) => {
  requireConfirm(req);
  const { start, stop, sensorId } = req.body || {};
  const before = await influxAdmin.countRange({ start, stop, sensorId: sensorId || null });
  const r = await influxAdmin.deleteRange({ start, stop, sensorId: sensorId || null });
  logger.audit(req.user, 'admin', `Leituras apagadas no InfluxDB: ${sensorId || 'todos os sensores'}, ${r.start} a ${r.stop} (${before.total} leituras)`, 'warn');
  res.json({ ok: true, ...r, deleted: before.total });
}));

// ── Arquivos guardados (relatórios e backups) ─────────────────────
router.get('/files/:kind', wrap(async (req, res) => { res.json(await files.list(req.params.kind)); }));

router.get('/files/:kind/download', wrap(async (req, res) => {
  const full = await files.resolveInside(req.params.kind, req.query.path);
  logger.audit(req.user, 'admin', `Arquivo baixado: ${req.params.kind}/${req.query.path}`);
  res.download(full);
}));

router.delete('/files/:kind', wrap(async (req, res) => {
  requireConfirm(req);
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 500) : [];
  if (!paths.length) throw bad('Nenhum arquivo informado');
  let count = 0, bytes = 0; const errors = [];
  for (const p of paths) {
    try { const r = await files.remove(req.params.kind, p); count++; bytes += r.size; }
    catch (e) { errors.push({ path: p, error: e.message }); }
  }
  logger.audit(req.user, 'admin', `${count} arquivo(s) de ${req.params.kind} apagado(s) (${bytes} bytes)`, 'warn');
  res.json({ ok: true, count, bytes, errors });
}));

router.post('/files/:kind/cleanup', wrap(async (req, res) => {
  requireConfirm(req);
  const r = await files.cleanup(req.params.kind, req.body?.olderThanDays);
  logger.audit(req.user, 'admin', `Limpeza de ${req.params.kind}: ${r.count} arquivo(s) com mais de ${req.body.olderThanDays} dias apagados`, 'warn');
  res.json({ ok: true, ...r });
}));

// ── Logs ──────────────────────────────────────────────────────────
router.get('/logs/system', wrap(async (req, res) => {
  const where = [], params = [];
  if (['info', 'warn', 'error'].includes(req.query.level)) { where.push('level = ?'); params.push(req.query.level); }
  if (req.query.category && /^[a-z0-9_-]{1,30}$/.test(req.query.category)) { where.push('category = ?'); params.push(req.query.category); }
  if (req.query.q) { where.push('(message LIKE ? OR user_email LIKE ?)'); const like = `%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`; params.push(like, like); }
  if (req.query.before && /^\d+$/.test(req.query.before)) { where.push('id < ?'); params.push(Number(req.query.before)); }
  const limit = Math.max(20, Math.min(500, Number(req.query.limit) || 200));
  const sql = `SELECT id, ts, level, category, message, user_email AS user FROM system_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`;
  const [rows, cats, totals] = await Promise.all([
    db.query(sql, params),
    db.query('SELECT category, COUNT(*) AS n FROM system_log GROUP BY category ORDER BY n DESC'),
    db.query(`SELECT COUNT(*) AS n, MIN(ts) AS oldest, SUM(LENGTH(message)) AS chars FROM system_log`),
  ]);
  res.json({ rows, categories: cats.map((c) => ({ name: c.category, count: Number(c.n) })), total: Number(totals[0].n), oldest: totals[0].oldest });
}));

router.post('/logs/system/cleanup', wrap(async (req, res) => {
  requireConfirm(req);
  const days = Number(req.body?.olderThanDays);
  if (!Number.isFinite(days) || days < 0) throw bad('Informe a idade em dias (0 apaga tudo)');
  const r = await db.query('DELETE FROM system_log WHERE ts < NOW() - INTERVAL ? DAY', [days]);
  logger.audit(req.user, 'admin', `Log do sistema limpo: ${r.affectedRows} linha(s) com mais de ${days} dias`, 'warn');
  res.json({ ok: true, count: r.affectedRows });
}));

router.get('/logs/email', wrap(async (req, res) => {
  const where = [], params = [];
  if (req.query.sensor && /^[A-Za-z0-9_-]{1,50}$/.test(req.query.sensor)) { where.push('e.sensor_id = ?'); params.push(req.query.sensor); }
  if (req.query.type && /^[a-z_]{1,30}$/.test(req.query.type)) { where.push('e.type = ?'); params.push(req.query.type); }
  if (req.query.before && /^\d+$/.test(req.query.before)) { where.push('e.id < ?'); params.push(Number(req.query.before)); }
  const limit = Math.max(20, Math.min(500, Number(req.query.limit) || 200));
  const [rows, totals] = await Promise.all([
    db.query(`SELECT e.id, e.ts, e.sensor_id AS sensorId, s.name AS sensorName, e.type, e.to_emails AS \`to\`, e.subject
      FROM email_history e LEFT JOIN sensors s ON s.id = e.sensor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT ${limit}`, params),
    db.query('SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM email_history'),
  ]);
  res.json({ rows, total: Number(totals[0].n), oldest: totals[0].oldest });
}));

router.post('/logs/email/cleanup', wrap(async (req, res) => {
  requireConfirm(req);
  const days = Number(req.body?.olderThanDays);
  if (!Number.isFinite(days) || days < 0) throw bad('Informe a idade em dias (0 apaga tudo)');
  const r = await db.query('DELETE FROM email_history WHERE ts < NOW() - INTERVAL ? DAY', [days]);
  logger.audit(req.user, 'admin', `Historico de e-mails limpo: ${r.affectedRows} registro(s) com mais de ${days} dias`, 'warn');
  res.json({ ok: true, count: r.affectedRows });
}));

router.get('/logs/containers', wrap(async (req, res) => { res.json(await dockerLogs.listContainers()); }));
router.get('/logs/containers/:name', wrap(async (req, res) => {
  res.json(await dockerLogs.containerLogs(req.params.name, { tail: req.query.tail, sinceMinutes: req.query.sinceMinutes }));
}));

// ── Configurações de retenção ─────────────────────────────────────
router.get('/settings', wrap(async (req, res) => { res.json(await db.getSettings()); }));
router.put('/settings', wrap(async (req, res) => {
  const limits = { log_retention_days: [0, 3650], email_retention_days: [0, 3650], report_retention_days: [0, 3650], trash_days: [1, 365] };
  const clean = {};
  for (const [k, [min, max]] of Object.entries(limits)) {
    if (req.body?.[k] === undefined) continue;
    const v = Number(req.body[k]);
    if (!Number.isInteger(v) || v < min || v > max) throw bad(`${k} deve ser inteiro entre ${min} e ${max}`);
    clean[k] = v;
  }
  await db.saveSettings(clean);
  logger.audit(req.user, 'admin', `Configuracoes de retencao alteradas: ${JSON.stringify(clean)}`);
  res.json(await db.getSettings());
}));

module.exports = router;
