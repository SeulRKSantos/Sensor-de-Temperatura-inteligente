// Operações de sensor do painel de administração e a limpeza automática diária.
const db = require('../models/db');
const influxAdmin = require('./influxAdmin');
const files = require('./files');
const industrial = require('./industrial');
const logger = require('./logger');

// Exclusão definitiva: cadastro (com calibração, alertas e histórico de e-mails, via
// ON DELETE CASCADE), config retida no broker e, se pedido, as leituras no InfluxDB.
async function purgeSensor(sensor, { history, by }) {
  const { clearRetainedConfig } = require('./mqtt');   // evita ciclo de require
  let historyDeleted = false, historyError = null;
  if (history) {
    try { await influxAdmin.deleteSensorHistory(sensor.id); historyDeleted = true; }
    catch (e) { historyError = e.message; }
  }
  await db.deleteSensor(sensor.id);
  if (sensor.mac) clearRetainedConfig(sensor.mac);
  delete industrial.lastReading[sensor.id];
  logger.audit(by, 'admin', `Sensor ${sensor.id} excluido definitivamente` +
    (history ? (historyDeleted ? ' com o historico de leituras' : ` (historico NAO apagado: ${historyError})`) : ' (historico de leituras mantido)'),
    historyError ? 'warn' : 'info');
  return { historyDeleted, historyError };
}

async function runDaily() {
  try {
    const s = await db.getSettings();
    // Sensores na lixeira há mais de trash_days
    for (const t of await db.getExpiredTrash(s.trash_days)) {
      try { await purgeSensor(t, { history: t.purgeHistory, by: 'limpeza automatica' }); }
      catch (e) { console.error(`[MANUTENCAO] Falha ao excluir ${t.id} da lixeira:`, e.message); }
    }
    if (s.log_retention_days > 0) {
      const r = await db.query('DELETE FROM system_log WHERE ts < NOW() - INTERVAL ? DAY', [s.log_retention_days]);
      if (r.affectedRows) console.log(`[MANUTENCAO] ${r.affectedRows} linha(s) do log do sistema com mais de ${s.log_retention_days} dias apagadas`);
    }
    if (s.email_retention_days > 0) {
      const r = await db.query('DELETE FROM email_history WHERE ts < NOW() - INTERVAL ? DAY', [s.email_retention_days]);
      if (r.affectedRows) console.log(`[MANUTENCAO] ${r.affectedRows} registro(s) do historico de e-mails apagados`);
    }
    if (s.report_retention_days > 0) {
      const r = await files.cleanup('reports', s.report_retention_days);
      if (r.count) console.log(`[MANUTENCAO] ${r.count} relatorio(s) guardado(s) com mais de ${s.report_retention_days} dias apagados`);
    }
  } catch (e) {
    console.error('[MANUTENCAO] Erro na limpeza diaria:', e.message);
  }
}

// Roda 10 min depois da partida e depois a cada 24 h, às 03:30 (Brasília)
function startMaintenance() {
  setTimeout(runDaily, 10 * 60e3).unref();
  const schedule = () => {
    const now = Date.now(), br = new Date(now - 3 * 3600e3);
    const next = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate(), 3, 30) + 3 * 3600e3;
    const wait = (next > now ? next : next + 86400e3) - now;
    setTimeout(() => { runDaily().finally(schedule); }, wait).unref();
  };
  schedule();
}

module.exports = { purgeSensor, runDaily, startMaintenance };
