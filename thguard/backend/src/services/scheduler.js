const db = require('../models/db');
const { sendAlert } = require('./email');
const { queryStats } = require('./influx');
const lastSent = {};

// Tenta enviar um relatorio e SO marca como enviado em caso de sucesso.
// Isso garante retry automatico se a rede/SMTP estiver fora no minuto exato do disparo.
async function tryReport(sensor, period, range, dateKey) {
  const key = `${sensor.id}:${period}`;
  if (lastSent[key] === dateKey) return; // ja enviado com sucesso hoje/nesta janela

  const alerts = await db.getSensorAlerts(sensor.id);
  const conf = alerts[period];
  if (!conf || !conf.enabled) {
    lastSent[key] = dateKey; // desabilitado - nao precisa tentar de novo
    return;
  }

  try {
    const stats = await queryStats(sensor.id, range);
    await sendAlert(sensor.id, period, { temperature: stats.temperature, humidity: stats.humidity });
    lastSent[key] = dateKey; // SO marca apos sucesso real
    console.log(`[SCHEDULER] Relatorio ${period} enviado com sucesso para ${sensor.id}`);
  } catch (e) {
    console.error(`[SCHEDULER] Falha ao enviar ${period} para ${sensor.id} (tentara novamente): ${e.message}`);
    // Nao marca lastSent - proxima execucao (60s depois) tenta de novo dentro da janela
  }
}

async function runScheduler() {
  try {
    const now = new Date();
    const dateKey = now.toDateString();
    const h = now.getHours(), m = now.getMinutes();
    const sensors = await db.getSensors();

    for (const sensor of sensors) {
      // Diario — janela 00:00 a 00:09 (10 tentativas com retry automatico)
      if (h === 0 && m < 10) {
        await tryReport(sensor, 'daily', '24h', dateKey);
      }
      // Semanal — segunda-feira, janela 00:05 a 00:14
      if (now.getDay() === 1 && h === 0 && m >= 5 && m < 15) {
        await tryReport(sensor, 'weekly', '168h', dateKey);
      }
      // Mensal — dia 1, janela 00:10 a 00:19
      if (now.getDate() === 1 && h === 0 && m >= 10 && m < 20) {
        await tryReport(sensor, 'monthly', '720h', dateKey);
      }
    }
  } catch (e) {
    console.error('[SCHEDULER] Erro geral:', e.message);
  }
}

function startScheduler() {
  setInterval(runScheduler, 60 * 1000);
  console.log('[SCHEDULER] Agendador de relatórios iniciado.');
}

module.exports = { startScheduler };
