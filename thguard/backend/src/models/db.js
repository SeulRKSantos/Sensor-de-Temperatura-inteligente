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
  return query('SELECT id,name,email,role,created_at as createdAt FROM users');
}
async function getUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email=?', [email]);
  return rows[0] || null;
}
async function getUserById(id) {
  const rows = await query('SELECT * FROM users WHERE id=?', [id]);
  return rows[0] || null;
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

// SENSORS
async function getSensors() {
  const rows = await query(`SELECT id,mac,name,location,online,last_seen as lastSeen,
    ip,ssid,temp_limit as tempLimit,humid_limit as humidLimit,
    alert_active as alertActive,created_at as createdAt FROM sensors`);
  return rows.map(s => ({...s, online:!!s.online, alertActive:!!s.alertActive}));
}
async function getSensorById(id) {
  const rows = await query(`SELECT id,mac,name,location,online,last_seen as lastSeen,
    ip,ssid,temp_limit as tempLimit,humid_limit as humidLimit,
    alert_active as alertActive,created_at as createdAt FROM sensors WHERE id=?`, [id]);
  if (!rows[0]) return null;
  return {...rows[0], online:!!rows[0].online, alertActive:!!rows[0].alertActive};
}
async function getSensorByMac(mac) {
  const rows = await query('SELECT id FROM sensors WHERE mac=?', [mac]);
  return rows[0] || null;
}
async function createSensor({ id, mac, name, location, tempLimit, humidLimit }) {
  await query(`INSERT INTO sensors (id,mac,name,location,temp_limit,humid_limit) VALUES (?,?,?,?,?,?)`,
    [id, mac||null, name, location||'Sem localizacao', tempLimit||25, humidLimit||80]);
}
async function updateSensor(id, fields) {
  const map = { name:'name', location:'location', online:'online', lastSeen:'last_seen',
    ip:'ip', ssid:'ssid', tempLimit:'temp_limit', humidLimit:'humid_limit',
    alertActive:'alert_active', mac:'mac' };
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
async function getNextSensorId() {
  const rows = await query('SELECT COUNT(*) as c FROM sensors');
  let n = (rows[0].c || 0) + 1;
  while (true) {
    const id = 'sensor-'+String(n).padStart(3,'0');
    const exists = await query('SELECT id FROM sensors WHERE id=?', [id]);
    if (!exists.length) return id;
    n++;
  }
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
  deleteSensor, getNextSensorId,
  getSensorAlerts, saveSensorAlerts,
  addEmailHistory, getEmailHistory,
  getSmtp, saveSmtp,
};
