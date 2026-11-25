// Atualização de firmware pela rede (OTA), um sensor por vez.
//
// Fluxo de um job:
//   queued ─▶ sent (comando MQTT "ota" publicado) ─▶ accepted ─▶ downloading (n%)
//          ─▶ rebooting ─▶ done            (o ESP confirma a versão nova após reiniciar)
//   qualquer erro, recusa, tempo esgotado ou volta para a versão anterior ─▶ failed
// Quando um job falha, os próximos do mesmo lote são cancelados: um firmware
// com problema para no primeiro sensor.
const crypto = require('crypto');
const db = require('../models/db');
const firmware = require('./firmware');
const logger = require('./logger');
const { broadcast } = require('./websocket');

const ACTIVE = ['sent', 'accepted', 'downloading', 'rebooting'];
const FINAL = ['done', 'failed', 'cancelled'];
// Segundos sem notícia do sensor em cada etapa antes de considerar falha
const TIMEOUT_S = { sent: 90, accepted: 120, downloading: 120, rebooting: 480 };
const MAX_SENSORS = 50;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const q = (...a) => db.query(...a);
const mqtt = () => require('./mqtt');          // carregado sob demanda (mqtt.js usa este módulo)

// ── Firmwares ──────────────────────────────────────────────────────
async function listFirmware() {
  return (await q(`SELECT f.*, (SELECT COUNT(*) FROM ota_jobs j WHERE j.firmware_id = f.id AND j.status = 'done') AS installs
    FROM firmware f ORDER BY f.uploaded_at DESC, f.id DESC`)).map((f) => ({
    id: f.id, model: f.model, version: f.version, size: f.size, sha256: f.sha256, notes: f.notes,
    uploadedBy: f.uploaded_by, uploadedAt: f.uploaded_at, installs: Number(f.installs),
  }));
}

async function getFirmware(id) {
  const [f] = await q('SELECT * FROM firmware WHERE id = ?', [Number(id) || 0]);
  return f || null;
}

async function addFirmware(buf, { notes, user }) {
  const info = firmware.inspect(buf);
  const [same] = await q('SELECT * FROM firmware WHERE model = ? AND version = ?', [info.model, info.version]);
  if (same) {
    if (same.sha256 === info.sha256) return { duplicate: true, id: same.id, ...info };
    throw bad(`Já existe um firmware ${info.version} diferente deste. Aumente FW_VERSION no .ino antes de compilar.`, 409);
  }
  const filename = await firmware.store(buf, info);
  const r = await q('INSERT INTO firmware (model, version, filename, size, sha256, notes, uploaded_by) VALUES (?,?,?,?,?,?,?)',
    [info.model, info.version, filename, info.size, info.sha256, notes ? String(notes).slice(0, 300) : null, user?.email || null]);
  logger.audit(user, 'ota', `Firmware enviado: ${info.version} (${info.model}, ${info.size} bytes, sha256 ${info.sha256.slice(0, 12)})`);
  return { id: r.insertId, ...info };
}

async function removeFirmware(id, user) {
  const f = await getFirmware(id);
  if (!f) throw bad('Firmware não encontrado', 404);
  const [busy] = await q(`SELECT COUNT(*) AS n FROM ota_jobs WHERE firmware_id = ? AND status IN ('queued','sent','accepted','downloading','rebooting')`, [f.id]);
  if (Number(busy.n)) throw bad('Este firmware está em uma atualização em andamento.', 409);
  await firmware.unlink(f);
  await q('DELETE FROM firmware WHERE id = ?', [f.id]);
  logger.audit(user, 'ota', `Firmware apagado: ${f.version} (${f.model})`);
  return { id: f.id, version: f.version };
}

// ── Elegibilidade ─────────────────────────────────────────────────
function check(sensor, fw) {
  if (!sensor) return 'sensor não encontrado';
  if (sensor.deletedAt) return 'sensor na lixeira';
  if (!sensor.online) return 'sensor offline';
  if (!sensor.model) return 'modelo do sensor desconhecido (aguarde ele enviar o status)';
  if (!firmware.supportsOta(sensor.model, sensor.fw)) {
    const min = firmware.OTA_MIN[String(sensor.model).toUpperCase()];
    return min ? `firmware atual (${sensor.fw || '?'}) sem atualização pela rede: grave a ${min} por USB uma vez`
      : `modelo ${sensor.model} sem atualização pela rede`;
  }
  if (fw) {
    if (String(sensor.model).toUpperCase() !== fw.model) return `firmware de outro modelo (${fw.model})`;
    if (sensor.fw === fw.version) return 'já está nesta versão';
  }
  return null;
}

async function sensorsForOta() {
  const sensors = (await db.getSensors()).filter((s) => s.model || s.kind === 'industrial');
  const active = await q(`SELECT sensor_id, status FROM ota_jobs WHERE status IN ('queued','sent','accepted','downloading','rebooting')`);
  const busy = Object.fromEntries(active.map((j) => [j.sensor_id, j.status]));
  return sensors.map((s) => ({
    id: s.id, name: s.name, location: s.location, model: s.model, fw: s.fw, online: !!s.online, kind: s.kind,
    ota: firmware.supportsOta(s.model, s.fw), busy: busy[s.id] || null, reason: check(s, null),
  }));
}

// ── Jobs ──────────────────────────────────────────────────────────
function jobOut(j) {
  return {
    id: Number(j.id), batch: j.batch, sensorId: j.sensor_id, sensorName: j.sensor_name || null,
    firmwareId: j.firmware_id, fromVersion: j.from_version, toVersion: j.to_version,
    status: j.status, progress: j.progress === null ? null : Number(j.progress), message: j.message,
    createdBy: j.created_by, createdAt: j.created_at, startedAt: j.started_at, updatedAt: j.updated_at, finishedAt: j.finished_at,
  };
}

async function listJobs(limit = 100) {
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  return (await q(`SELECT j.*, s.name AS sensor_name FROM ota_jobs j LEFT JOIN sensors s ON s.id = j.sensor_id
    ORDER BY j.id DESC LIMIT ${n}`)).map(jobOut);
}

async function deploy(firmwareId, sensorIds, user) {
  const fw = await getFirmware(firmwareId);
  if (!fw) throw bad('Firmware não encontrado', 404);
  const ids = [...new Set((Array.isArray(sensorIds) ? sensorIds : []).map(String))];
  if (!ids.length) throw bad('Escolha pelo menos um sensor.');
  if (ids.length > MAX_SENSORS) throw bad(`No máximo ${MAX_SENSORS} sensores por vez.`);
  const busyRows = await q(`SELECT sensor_id FROM ota_jobs WHERE status IN ('queued','sent','accepted','downloading','rebooting')`);
  const busy = new Set(busyRows.map((r) => r.sensor_id));
  const problems = [];
  const sensors = [];
  for (const id of ids) {
    const s = await db.getSensorById(id, { includeDeleted: true });
    const why = busy.has(id) ? 'já tem uma atualização na fila' : check(s, fw);
    if (why) problems.push({ sensorId: id, reason: why }); else sensors.push(s);
  }
  if (problems.length) {
    const e = bad('Alguns sensores não podem ser atualizados agora: ' + problems.map((p) => `${p.sensorId} (${p.reason})`).join('; '));
    e.problems = problems; throw e;
  }
  const batch = crypto.randomUUID();
  for (const s of sensors) {
    await q('INSERT INTO ota_jobs (batch, sensor_id, firmware_id, from_version, to_version, created_by) VALUES (?,?,?,?,?,?)',
      [batch, s.id, fw.id, s.fw || null, fw.version, user?.email || null]);
  }
  logger.audit(user, 'ota', `Atualização para ${fw.version} agendada: ${sensors.map((s) => s.id).join(', ')}`);
  setImmediate(() => tick().catch((e) => console.error('[OTA] tick:', e.message)));
  return { batch, count: sensors.length };
}

async function cancelBatch(batch, user) {
  const r = await q(`UPDATE ota_jobs SET status='cancelled', message='cancelado no painel', finished_at=NOW(), updated_at=NOW()
    WHERE batch = ? AND status = 'queued'`, [String(batch)]);
  if (r.affectedRows) logger.audit(user, 'ota', `Lote ${String(batch).slice(0, 8)}: ${r.affectedRows} atualização(ões) cancelada(s)`);
  return { cancelled: r.affectedRows };
}

async function setJob(id, fields) {
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); vals.push(v); }
  sets.push('updated_at = NOW()');
  if (fields.status && FINAL.includes(fields.status)) sets.push('finished_at = NOW()', 'token = NULL');
  await q(`UPDATE ota_jobs SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  const [j] = await q('SELECT j.*, s.name AS sensor_name FROM ota_jobs j LEFT JOIN sensors s ON s.id = j.sensor_id WHERE j.id = ?', [id]);
  if (j) broadcast({ type: 'ota', job: jobOut(j) });
  return j;
}

async function failJob(job, msg) {
  await setJob(job.id, { status: 'failed', message: String(msg).slice(0, 300) });
  const r = await q(`UPDATE ota_jobs SET status='cancelled', message=?, finished_at=NOW(), updated_at=NOW()
    WHERE batch = ? AND status = 'queued'`, [`cancelado: a atualização de ${job.sensor_id} falhou`, job.batch]);
  logger.audit(null, 'ota', `${job.sensor_id}: atualização para ${job.to_version} falhou: ${msg}` +
    (r.affectedRows ? ` (${r.affectedRows} sensor(es) seguinte(s) cancelado(s))` : ''), 'warn');
}

async function finishOk(job, version) {
  await setJob(job.id, { status: 'done', progress: 100, message: `rodando ${version}` });
  logger.audit(null, 'ota', `${job.sensor_id}: atualizado de ${job.from_version || '?'} para ${version}`);
}

// Envia o próximo job da fila (só um sensor por vez em todo o sistema)
async function startNext() {
  const [active] = await q(`SELECT COUNT(*) AS n FROM ota_jobs WHERE status IN ('sent','accepted','downloading','rebooting')`);
  if (Number(active.n)) return null;
  const [job] = await q(`SELECT * FROM ota_jobs WHERE status = 'queued' ORDER BY id LIMIT 1`);
  if (!job) return null;
  const fw = await getFirmware(job.firmware_id);
  const sensor = await db.getSensorById(job.sensor_id, { includeDeleted: true });
  const why = !fw ? 'firmware apagado' : check(sensor, fw);
  if (why) { await failJob(job, why); return startNext(); }

  let buf;
  try { buf = await firmware.read(fw); } catch (e) { await failJob(job, 'arquivo do firmware não encontrado no servidor'); return startNext(); }
  if (crypto.createHash('sha256').update(buf).digest('hex') !== fw.sha256) {
    await failJob(job, 'arquivo do firmware alterado no servidor (SHA-256 não confere)'); return startNext();
  }
  const sig = await firmware.sign(buf);
  const token = crypto.randomBytes(32).toString('hex');
  const cmd = { action: 'ota', job: Number(job.id), version: fw.version, size: fw.size, sha256: fw.sha256, sig, path: `/api/ota/fw/${token}` };
  if (process.env.OTA_BASE_URL) cmd.url = process.env.OTA_BASE_URL.replace(/\/$/, '') + cmd.path;
  else cmd.port = Number(process.env.OTA_HTTP_PORT) || 8081;
  await q('UPDATE ota_jobs SET started_at = NOW() WHERE id = ?', [job.id]);
  await setJob(job.id, { status: 'sent', token, progress: 0, message: 'comando enviado' });
  if (!mqtt().publishCommand(job.sensor_id, cmd)) { await failJob(job, 'broker MQTT desconectado'); return null; }
  console.log(`[OTA] ${job.sensor_id}: comando de atualização para ${fw.version} enviado (job ${job.id})`);
  return job.id;
}

async function checkTimeouts() {
  const rows = await q(`SELECT *, TIMESTAMPDIFF(SECOND, updated_at, NOW()) AS idle FROM ota_jobs
    WHERE status IN ('sent','accepted','downloading','rebooting')`);
  for (const j of rows) {
    if (Number(j.idle) <= TIMEOUT_S[j.status]) continue;
    const msg = {
      sent: 'o sensor não respondeu ao comando (offline ou firmware sem OTA)',
      accepted: 'o sensor aceitou mas não começou o download',
      downloading: 'o download parou no meio',
      rebooting: 'o sensor não voltou depois de reiniciar',
    }[j.status];
    await failJob(j, `tempo esgotado: ${msg}`);
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try { await checkTimeouts(); await startNext(); } finally { ticking = false; }
}

// ── Mensagens do sensor ───────────────────────────────────────────
// thguard/<id>/ota {"job","state","progress","msg","version"}
async function handleOtaMessage(sensorId, data) {
  const id = Number(data && data.job);
  if (!id) return;
  const [job] = await q('SELECT * FROM ota_jobs WHERE id = ? AND sensor_id = ?', [id, sensorId]);
  if (!job) { console.warn(`[OTA] ${sensorId}: mensagem de job desconhecido (${id}) ignorada`); return; }
  if (FINAL.includes(job.status)) return;
  const st = String(data.state || '');
  const pct = Number.isFinite(Number(data.progress)) ? Math.max(0, Math.min(100, Math.round(Number(data.progress)))) : null;
  const msg = data.msg ? String(data.msg).slice(0, 250) : null;
  if (st === 'accepted') await setJob(id, { status: 'accepted', message: msg || 'aceito pelo sensor' });
  else if (st === 'downloading') await setJob(id, { status: 'downloading', ...(pct !== null ? { progress: pct } : {}) });
  else if (st === 'rebooting') await setJob(id, { status: 'rebooting', progress: 100, token: null, message: 'firmware gravado e conferido; reiniciando' });
  else if (st === 'done') {
    if (data.version === job.to_version) await finishOk(job, data.version);
    else await failJob(job, `o sensor voltou com a versão ${data.version || '?'} em vez de ${job.to_version}`);
  } else if (st === 'rolled_back') await failJob(job, msg || 'a versão nova não iniciou e o sensor voltou para a anterior');
  else if (st === 'error') await failJob(job, msg || 'erro informado pelo sensor');
  else return;
  if (['done', 'rolled_back', 'error'].includes(st)) setImmediate(() => tick().catch((e) => console.error('[OTA] tick:', e.message)));
}

// Plano B: o status com a versão nova também conclui o job (se a mensagem "done" se perder)
async function handleStatusFw(sensorId, fw) {
  if (!fw) return;
  const [job] = await q(`SELECT * FROM ota_jobs WHERE sensor_id = ? AND status = 'rebooting' ORDER BY id DESC LIMIT 1`, [sensorId]);
  if (job && fw === job.to_version) {
    await finishOk(job, fw);
    setImmediate(() => tick().catch((e) => console.error('[OTA] tick:', e.message)));
  }
}

// Download pelo ESP: o token vale só para o job em andamento
async function downloadFor(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const [job] = await q(`SELECT * FROM ota_jobs WHERE token = ? AND status IN ('sent','accepted','downloading')`, [token]);
  if (!job) return null;
  const fw = await getFirmware(job.firmware_id);
  if (!fw) return null;
  return { job, fw, file: firmware.fileFor(fw) };
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => console.error('[OTA] tick:', e.message)), 5000);
  timer.unref?.();
}

module.exports = {
  listFirmware, getFirmware, addFirmware, removeFirmware, sensorsForOta, listJobs, deploy, cancelBatch,
  handleOtaMessage, handleStatusFw, downloadFor, tick, start, check, TIMEOUT_S,
};
