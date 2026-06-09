// Agendador de relatórios periódicos e consolidação de médias
const { loadDB } = require('../models/db');
const { sendAlert } = require('./email');
const { queryStats, queryHistory } = require('./influx');

// Guarda o último envio por sensor+período
const lastSent = {};

async function runScheduler() {
  const now = new Date();
  const db = loadDB();

  for (const sensor of db.sensors) {
    const key = (period) => `${sensor.id}:${period}`;

    // ── Diário — envia às 00:01 ────────────────────────────────────
    if (now.getHours() === 0 && now.getMinutes() === 1) {
      if (lastSent[key('daily')] !== now.toDateString()) {
        lastSent[key('daily')] = now.toDateString();
        const alerts = sensor.alerts || {};
        if (alerts.daily?.enabled) {
          try {
            const stats = await queryStats(sensor.id, '24h');
            await sendAlert(sensor.id, 'daily', {
              temperature: stats.temperature,
              humidity: stats.humidity
            });
          } catch (e) {
            console.error('[SCHEDULER] Erro relatório diário:', e.message);
          }
        }
      }
    }

    // ── Semanal — segunda-feira às 00:05 ──────────────────────────
    if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 5) {
      if (lastSent[key('weekly')] !== now.toDateString()) {
        lastSent[key('weekly')] = now.toDateString();
        const alerts = sensor.alerts || {};
        if (alerts.weekly?.enabled) {
          try {
            const stats = await queryStats(sensor.id, '168h');
            await sendAlert(sensor.id, 'weekly', {
              temperature: stats.temperature,
              humidity: stats.humidity
            });
          } catch (e) {
            console.error('[SCHEDULER] Erro relatório semanal:', e.message);
          }
        }
      }
    }

    // ── Mensal — dia 1 às 00:10 ────────────────────────────────────
    if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 10) {
      if (lastSent[key('monthly')] !== now.toDateString()) {
        lastSent[key('monthly')] = now.toDateString();
        const alerts = sensor.alerts || {};
        if (alerts.monthly?.enabled) {
          try {
            const stats = await queryStats(sensor.id, '720h');
            await sendAlert(sensor.id, 'monthly', {
              temperature: stats.temperature,
              humidity: stats.humidity
            });
          } catch (e) {
            console.error('[SCHEDULER] Erro relatório mensal:', e.message);
          }
        }
      }
    }
  }
}

function startScheduler() {
  // Roda a cada minuto
  setInterval(runScheduler, 60 * 1000);
  console.log('[SCHEDULER] Agendador de relatórios iniciado.');
}

module.exports = { startScheduler };
