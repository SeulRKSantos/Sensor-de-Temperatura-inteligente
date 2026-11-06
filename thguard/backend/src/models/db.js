const mysql = require('mysql2/promise');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'mariadb',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'thguard',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME     || 'thguard',
  waitForConnections: true,
  connectionLimit: 10,
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Converte ISO 8601 para formato MySQL
function toMySQL(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toISOString().slice(0, 19).replace('T', ' ');
}

async function ensureAdmin() {
  try {
    const users = await query('SELECT id FROM users LIMIT 1');
    if (users.length === 0) {
      await query(
        'INSERT INTO users (id,name,email,password,role) VALUES (?,?,?,?,?)',
        [uuid(), 'Administrador', 'admin@thguard.local',
         bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'changeme_on_first_login', 10), 'admin']
      );
      console.log('Usuario admin criado: admin@thguard.local (senha: ADMIN_PASSWORD)');
    }
  } catch (e) {
    console.error('[DB] ensureAdmin erro:', e.message);
    setTimeout(ensureAdmin, 5000);
  }
}
setTimeout(ensureAdmin, 3000);

// USERS
async function getUsers() {
  const users = await query('SELECT id,name,email,role,created_at as createdAt FROM users');
  const tagRows = await query('SELECT user_id, tag FROM user_tags');
  const tagsByUser = {};
  tagRows.forEach(r => {
    (tagsByUser[r.user_id] = tagsByUser[r.user_id] || []).push(r.tag);
  });
  return users.map(u => ({ ...u, tags: tagsByUser[u.id] || [] }));
}
async function getUserTags(userId) {
  const rows = await query('SELECT tag FROM user_tags WHERE user_id=?', [userId]);
  return rows.map(r => r.tag);
}
async function setUserTags(userId, tags) {
  await query('DELETE FROM user_tags WHERE user_id=?', [userId]);
  if (tags && tags.length) {
    const values = tags.map(t => [userId, t]);
    for (const [uid, tag] of values) {
      await query('INSERT IGNORE INTO user_tags (user_id, tag) VALUES (?,?)', [uid, tag]);
    }
  }
}
async function getAllTags() {
  const rows = await query('SELECT DISTINCT tag FROM sensors WHERE tag IS NOT NULL AND tag != \'\' ORDER BY tag');
  return rows.map(r => r.tag);
}
async function getUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email=?', [email]);
  if (!rows[0]) return null;
  const tags = await getUserTags(rows[0].id);
  return { ...rows[0], tags };
}
async function getUserById(id) {
  const rows = await query('SELECT * FROM users WHERE id=?', [id]);
  if (!rows[0]) return null;
  const tags = await getUserTags(id);
  return { ...rows[0], tags };
}
async function createUser({ name, email, password, role }) {
  const id = uuid();
  await query('INSERT INTO users (id,name,email,password,role) VALUES (?,?,?,?,?)',
    [id, name, email, password, role]);
  return { id, name, email, role };
}
async function updateUser(id, fields) {
  const map = { name:'name', email:'email', password:'password', role:'role' };
  const sets = [], vals = [];
  Object.entries(fields).forEach(([k,v]) => {
    if (map[k]) {
      sets.push(map[k]+'=?');
      // Converte datas para formato MySQL
      vals.push(k === 'lastSeen' ? toMySQL(v) : v);
    }
  });
  if (!sets.length) return;
  vals.push(id);
  await query('UPDATE users SET '+sets.join(',')+'  WHERE id=?', vals);
}
async function deleteUser(id) {
  await query('DELETE FROM users WHERE id=?', [id]);
}

// SCHEMA — migracoes idempotentes executadas no boot
// (o init.sql so roda na criacao do volume; isto atualiza bancos existentes)
async function ensureSchema() {
  await query(`ALTER TABLE sensors ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'thguard' AFTER mac`);
  await query(`ALTER TABLE sensors ADD COLUMN IF NOT EXISTS model VARCHAR(30) DEFAULT NULL AFTER kind`);
  await query(`ALTER TABLE sensors ADD COLUMN IF NOT EXISTS fw VARCHAR(30) DEFAULT NULL AFTER model`);
  await query(`CREATE TABLE IF NOT EXISTS industrial_config (
    sensor_id   VARCHAR(50) NOT NULL PRIMARY KEY,
    range_min   DOUBLE NOT NULL DEFAULT 0,
    range_max   DOUBLE NOT NULL DEFAULT 150,
    v_full      DOUBLE NOT NULL DEFAULT 10,
    divisor     DOUBLE NOT NULL DEFAULT 5,
    offset_mv   DOUBLE NOT NULL DEFAULT -16,
    gain        DOUBLE NOT NULL DEFAULT 1,
    offset_temp DOUBLE NOT NULL DEFAULT 0,
    fault_v     DOUBLE NOT NULL DEFAULT 10.5,
    low_v       DOUBLE NOT NULL DEFAULT 0.05,
    interval_s  INT   NOT NULL DEFAULT 5,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_industrial_sensor FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
  )`);
  console.log('[DB] Schema verificado (sensores industriais).');
}
let schemaReady = null;
function schema() {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch(e => {
      console.error('[DB] ensureSchema erro:', e.message);
      schemaReady = null;               // tenta de novo na proxima chamada
      throw e;
    });
  }
  return schemaReady;
}

// SENSORS
const IND_MAP = {
  rangeMin:'range_min', rangeMax:'range_max', vFull:'v_full', divisor:'divisor',
  offsetMv:'offset_mv', gain:'gain', offsetTemp:'offset_temp', faultV:'fault_v',
  lowV:'low_v', interval:'interval_s',
};
const SENSOR_SELECT = `SELECT s.id,s.mac,s.kind,s.model,s.fw,s.name,s.location,s.tag,s.online,
    s.last_seen as lastSeen,s.ip,s.ssid,s.temp_limit as tempLimit,s.humid_limit as humidLimit,
    s.alert_active as alertActive,s.created_at as createdAt,
    ic.range_min,ic.range_max,ic.v_full,ic.divisor,ic.offset_mv,ic.gain,ic.offset_temp,
    ic.fault_v,ic.low_v,ic.interval_s
  FROM sensors s LEFT JOIN industrial_config ic ON ic.sensor_id = s.id`;

function mapSensor(r) {
  const s = {
    id:r.id, mac:r.mac, kind:r.kind || 'thguard', model:r.model, fw:r.fw,
    name:r.name, location:r.location, tag:r.tag, online:!!r.online, lastSeen:r.lastSeen,
    ip:r.ip, ssid:r.ssid, tempLimit:r.tempLimit, humidLimit:r.humidLimit,
    alertActive:!!r.alertActive, createdAt:r.createdAt,
  };
  if (s.kind === 'industrial') {
    s.industrial = {};
    for (const [k, col] of Object.entries(IND_MAP)) {
      const v = r[col];
      s.industrial[k] = v == null ? v : Math.round(Number(v) * 1e6) / 1e6;   // evita 0.0500000007
    }
    if (r.range_min == null) s.industrial = null;     // sem linha de calibracao ainda
  }
  return s;
}

async function getSensors(kind) {
  await schema();
  const rows = kind
    ? await query(SENSOR_SELECT + ' WHERE s.kind=? ORDER BY s.id', [kind])
    : await query(SENSOR_SELECT + ' ORDER BY s.id');
  return rows.map(mapSensor);
}
async function getSensorById(id) {
  await schema();
  const rows = await query(SENSOR_SELECT + ' WHERE s.id=?', [id]);
  return rows[0] ? mapSensor(rows[0]) : null;
}
async function getSensorByMac(mac) {
  await schema();
  const rows = await query('SELECT id, kind FROM sensors WHERE mac=?', [mac]);
  return rows[0] || null;
}
async function createSensor({ id, mac, name, location, tempLimit, humidLimit, kind, model, fw }) {
  await schema();
  await query(`INSERT INTO sensors (id,mac,kind,model,fw,name,location,temp_limit,humid_limit)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, mac||null, kind||'thguard', model||null, fw||null, name,
     location||'Sem localizacao', tempLimit||25, humidLimit||80]);
  if (kind === 'industrial') await ensureIndustrialConfig(id);
}
async function ensureIndustrialConfig(sensorId) {
  await query('INSERT IGNORE INTO industrial_config (sensor_id) VALUES (?)', [sensorId]);
}
async function updateIndustrialConfig(sensorId, fields) {
  await ensureIndustrialConfig(sensorId);
  const sets = [], vals = [];
  Object.entries(fields).forEach(([k, v]) => {
    if (IND_MAP[k]) { sets.push(IND_MAP[k] + '=?'); vals.push(v); }
  });
  if (!sets.length) return;
  vals.push(sensorId);
  await query('UPDATE industrial_config SET ' + sets.join(',') + ' WHERE sensor_id=?', vals);
}
async function updateSensor(id, fields) {
  const map = { name:'name', location:'location', tag:'tag', online:'online', lastSeen:'last_seen',
    ip:'ip', ssid:'ssid', tempLimit:'temp_limit', humidLimit:'humid_limit',
    alertActive:'alert_active', mac:'mac', model:'model', fw:'fw' };
  const sets = [], vals = [];
  Object.entries(fields).forEach(([k,v]) => {
    if (map[k]) {
      sets.push(map[k]+'=?');
      // Converte datas para formato MySQL
      vals.push(k === 'lastSeen' ? toMySQL(v) : v);
    }
  });
  if (!sets.length) return;
  vals.push(id);
  await query('UPDATE sensors SET '+sets.join(',')+'  WHERE id=?', vals);
}
async function deleteSensor(id) {
  await query('DELETE FROM sensors WHERE id=?', [id]);
}
// Proximo ID com o prefixo do tipo: sensor-NNN (TH-GUARD) ou ind-NNN (industrial).
// Usa o maior numero + 1, para nao preencher "buracos" deixados por sensores
// apagados (o historico deles continua no InfluxDB e se misturaria com o novo).
async function getNextSensorId(prefix = 'sensor') {
  const rows = await query('SELECT id FROM sensors WHERE id LIKE ?', [prefix + '-%']);
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.id.slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return prefix + '-' + String(max + 1).padStart(3, '0');
}

// SENSOR ALERTS
async function getSensorAlerts(sensorId) {
  const rows = await query('SELECT * FROM sensor_alerts WHERE sensor_id=?', [sensorId]);
  const result = {};
  rows.forEach(r => {
    result[r.type] = { enabled:!!r.enabled, to:r.to_emails||'', cc:r.cc||'',
      bcc:r.bcc||'', subject:r.subject||'', body:r.body||'' };
  });
  return result;
}
async function saveSensorAlerts(sensorId, alerts) {
  for (const [type, cfg] of Object.entries(alerts)) {
    await query(`INSERT INTO sensor_alerts (sensor_id,type,enabled,to_emails,cc,bcc,subject,body)
      VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
      enabled=VALUES(enabled),to_emails=VALUES(to_emails),cc=VALUES(cc),
      bcc=VALUES(bcc),subject=VALUES(subject),body=VALUES(body)`,
      [sensorId, type, cfg.enabled?1:0, cfg.to||'', cfg.cc||'',
       cfg.bcc||'', cfg.subject||'', cfg.body||'']);
  }
}

// EMAIL HISTORY
async function addEmailHistory(sensorId, { type, to, subject }) {
  await query('INSERT INTO email_history (sensor_id,type,to_emails,subject) VALUES (?,?,?,?)',
    [sensorId, type, to, subject]);
}
async function getEmailHistory(sensorId) {
  return query(`SELECT type,ts,to_emails as \`to\`,subject FROM email_history
    WHERE sensor_id=? ORDER BY ts DESC LIMIT 50`, [sensorId]);
}

// SMTP
async function getSmtp() {
  const rows = await query('SELECT * FROM smtp_config WHERE id=1');
  return rows[0] || {};
}
async function saveSmtp({ host, port, user, pass, fromName }) {
  await query(`INSERT INTO smtp_config (id,host,port,user,pass,from_name) VALUES (1,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE host=VALUES(host),port=VALUES(port),user=VALUES(user),
    pass=VALUES(pass),from_name=VALUES(from_name)`,
    [host, port||587, user, pass, fromName||'TH-GUARD']);
}

module.exports = {
  query, uuid,
  getUsers, getUserByEmail, getUserById, createUser, updateUser, deleteUser,
  getSensors, getSensorById, getSensorByMac, createSensor, updateSensor,
  deleteSensor, getNextSensorId, schema,
  ensureIndustrialConfig, updateIndustrialConfig,
  getSensorAlerts, saveSensorAlerts,
  addEmailHistory, getEmailHistory,
  getSmtp, saveSmtp,
  getUserTags, setUserTags, getAllTags,
};
