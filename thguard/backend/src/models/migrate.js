// Executa uma vez para migrar dados do db.json para o MariaDB
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  const jsonPath = path.join(__dirname, '../../data/db.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('[MIGRATE] db.json não encontrado. Pulando migração.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log('[MIGRATE] Iniciando migração do db.json...');

  // Usuários
  for (const u of (data.users || [])) {
    try {
      await db.query(
        'INSERT IGNORE INTO users (id,name,email,password,role,created_at) VALUES (?,?,?,?,?,?)',
        [u.id, u.name, u.email, u.password, u.role, u.createdAt || new Date()]
      );
      console.log(`[MIGRATE] Usuário: ${u.email}`);
    } catch (e) { console.error('[MIGRATE] Erro usuário:', e.message); }
  }

  // Sensores
  for (const s of (data.sensors || [])) {
    try {
      await db.query(
        `INSERT IGNORE INTO sensors
         (id,mac,name,location,online,last_seen,ip,ssid,temp_limit,humid_limit,alert_active,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, s.mac || null, s.name, s.location, s.online ? 1 : 0,
         s.lastSeen || null, s.ip || null, s.ssid || null,
         s.tempLimit || 25, s.humidLimit || 80, s.alertActive ? 1 : 0,
         s.createdAt || new Date()]
      );
      console.log(`[MIGRATE] Sensor: ${s.id}`);

      // Alertas do sensor
      if (s.alerts) await db.saveSensorAlerts(s.id, s.alerts);

      // Histórico de emails
      for (const h of (s.emailHistory || [])) {
        try {
          await db.query(
            'INSERT INTO email_history (sensor_id,type,ts,to_emails,subject) VALUES (?,?,?,?,?)',
            [s.id, h.type, h.ts || new Date(), h.to, h.subject]
          );
        } catch {}
      }
    } catch (e) { console.error('[MIGRATE] Erro sensor:', e.message); }
  }

  // SMTP
  if (data.smtpConfig) {
    await db.saveSmtp({
      host:     data.smtpConfig.host,
      port:     data.smtpConfig.port,
      user:     data.smtpConfig.user,
      pass:     data.smtpConfig.pass,
      fromName: data.smtpConfig.fromName,
    });
    console.log('[MIGRATE] SMTP migrado.');
  }

  // Renomeia o json para .bak após migração
  fs.renameSync(jsonPath, jsonPath + '.migrated');
  console.log('[MIGRATE] Concluído! db.json renomeado para db.json.migrated');
}

migrate().then(() => process.exit(0)).catch(e => {
  console.error('[MIGRATE] Falha:', e.message);
  process.exit(1);
});
