const db = require('../models/db');
const { sendAlert } = require('./email');
const { queryStats } = require('./influx');

const lastSent = {};

async function runScheduler() {
  try {
    const now = new Date();
    const sensors = await db.getSensors();

    for (const sensor of sensors) {
      const key = (period) => `${sensor.id}:${period}`;
      const alerts = await db.getSensorAlerts(sensor.id);

      // Diário — às 00:01
      if (now.getHours() === 0 && now.getMinutes() === 1) {
        if (lastSent[key('daily')] !== now.toDateString()) {
          lastSent[key('daily')] = now.toDateString();
          if (alerts.daily && alerts.daily.enabled) {
            try {
              const stats = await queryStats(sensor.id, '24h');
              await sendAlert(sensor.id, 'daily', { temperature: stats.temperature, humidity: stats.humidity });
            } catch (e) { console.error('[SCHEDULER] Erro diário:', e.message); }
          }
        }
      }

      // Semanal — segunda às 00:05
      if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 5) {
        if (lastSent[key('weekly')] !== now.toDateString()) {
          lastSent[key('weekly')] = now.toDateString();
          if (alerts.weekly && alerts.weekly.enabled) {
            try {
              const stats = await queryStats(sensor.id, '168h');
              await sendAlert(sensor.id, 'weekly', { temperature: stats.temperature, humidity: stats.humidity });
            } catch (e) { console.error('[SCHEDULER] Erro semanal:', e.message); }
          }
        }
      }

      // Mensal — dia 1 às 00:10
      if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 10) {
        if (lastSent[key('monthly')] !== now.toDateString()) {
          lastSent[key('monthly')] = now.toDateString();
          if (alerts.monthly && alerts.monthly.enabled) {
            try {
              const stats = await queryStats(sensor.id, '720h');
              await sendAlert(sensor.id, 'monthly', { temperature: stats.temperature, humidity: stats.humidity });
            } catch (e) { console.error('[SCHEDULER] Erro mensal:', e.message); }
          }
        }
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
