const nodemailer = require('nodemailer');
const db = require('../models/db');
const { queryHistory, queryStats, queryDailyCSV, queryWeeklyCSV, queryMonthlyCSV, rowsToCSV, queryPeriodStats, countAlertsInPeriod } = require('./influx');

// ── Envia email usando as configurações SMTP do sensor ─────────────
async function sendAlert(sensorId, alertType, data) {
  const sensor = await db.getSensorById(sensorId);
  if (!sensor) return;

  const smtp = await db.getSmtp();
  if (!smtp.host || !smtp.user || !smtp.pass) {
    console.log('[EMAIL] SMTP não configurado. Pulando envio.');
    return;
  }

  const alerts = await db.getSensorAlerts(sensorId);
  const alertCfg = alerts[alertType];
  if (!alertCfg || !alertCfg.enabled) {
    console.log(`[EMAIL] Alerta ${alertType} desabilitado para ${sensorId}.`);
    return;
  }

  // Monta destinatários
  const to   = (alertCfg.to  || '').split(',').map(e => e.trim()).filter(Boolean);
  const cc   = (alertCfg.cc  || '').split(',').map(e => e.trim()).filter(Boolean);
  const bcc  = (alertCfg.bcc || '').split(',').map(e => e.trim()).filter(Boolean);

  if (to.length === 0) {
    console.log(`[EMAIL] Nenhum destinatário para ${alertType}.`);
    return;
  }

  // Substitui variáveis no assunto e corpo
  const vars = {
    '{{sensor_id}}':   sensorId,
    '{{sensor_name}}': sensor.name,
    '{{location}}':    sensor.location,
    '{{temperature}}': data.temperature != null ? String(data.temperature.toFixed(1)) : '--',
    '{{humidity}}':    data.humidity != null ? String(data.humidity.toFixed(1)) : '--',
    '{{temp_limit}}':  String(sensor.tempLimit),
    '{{humid_limit}}': String(sensor.humidLimit),
    '{{datetime}}':    new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  };

  let subject = alertCfg.subject || defaultSubject(alertType);
  let body    = alertCfg.body    || defaultBody(alertType);

  Object.entries(vars).forEach(([k, v]) => {
    subject = subject.replaceAll(k, v);
    body    = body.replaceAll(k, v);
  });

  try {
    const transporter = nodemailer.createTransport({
      host:   smtp.host,
      port:   parseInt(smtp.port) || 587,
      secure: smtp.port == 465,
      auth: { user: smtp.user, pass: smtp.pass }
    });

    // Gera estatísticas e CSV anexo para relatórios
    let attachments = [];
    let extraBody = '';
    const now = new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');

    try {
      if (alertType === 'daily') {
        const [rows, stats] = await Promise.all([
          queryDailyCSV(sensorId),
          queryPeriodStats(sensorId, '24h')
        ]);
        extraBody = [
          '',
          '=== RESUMO DO DIA ===',
          `Temperatura media:  ${stats.mean ?? '--'}°C`,
          `Temperatura maxima: ${stats.max  ?? '--'}°C`,
          `Temperatura minima: ${stats.min  ?? '--'}°C`,
          `Data/Hora: ${vars['{{datetime}}']}`,
        ].join('\n');
        if (rows.length > 0) {
          attachments.push({
            filename:    `relatorio_diario_${sensorId}_${now}.csv`,
            content:     Buffer.from('\uFEFF' + rowsToCSV(rows, 'daily'), 'utf8'),
            contentType: 'text/csv; charset=utf-8'
          });
        }
      } else if (alertType === 'weekly') {
        const [rows, stats, alertCount] = await Promise.all([
          queryWeeklyCSV(sensorId),
          queryPeriodStats(sensorId, '168h'),
          countAlertsInPeriod(sensorId, '168h', require('../models/db'))
        ]);
        extraBody = [
          '',
          '=== RESUMO DA SEMANA ===',
          `Temperatura maxima: ${stats.max ?? '--'}°C`,
          `Temperatura minima: ${stats.min ?? '--'}°C`,
          `Alertas na semana:  ${alertCount}`,
          `Data/Hora: ${vars['{{datetime}}']}`,
        ].join('\n');
        if (rows.length > 0) {
          attachments.push({
            filename:    `relatorio_semanal_${sensorId}_${now}.csv`,
            content:     Buffer.from('\uFEFF' + rowsToCSV(rows, 'weekly'), 'utf8'),
            contentType: 'text/csv; charset=utf-8'
          });
        }
      } else if (alertType === 'monthly') {
        const [rows, stats, alertCount] = await Promise.all([
          queryMonthlyCSV(sensorId),
          queryPeriodStats(sensorId, '720h'),
          countAlertsInPeriod(sensorId, '720h', require('../models/db'))
        ]);
        extraBody = [
          '',
          '=== RESUMO DO MES ===',
          `Temperatura maxima: ${stats.max ?? '--'}°C`,
          `Temperatura minima: ${stats.min ?? '--'}°C`,
          `Alertas no mes:     ${alertCount}`,
          `Data/Hora: ${vars['{{datetime}}']}`,
        ].join('\n');
        if (rows.length > 0) {
          attachments.push({
            filename:    `relatorio_mensal_${sensorId}_${now}.csv`,
            content:     Buffer.from('\uFEFF' + rowsToCSV(rows, 'monthly'), 'utf8'),
            contentType: 'text/csv; charset=utf-8'
          });
        }
      }
    } catch (e) {
      console.error('[EMAIL] Erro ao gerar CSV anexo:', e.message);
    }

    await transporter.sendMail({
      from:        `"${smtp.fromName || 'TH-GUARD'}" <${smtp.user}>`,
      to:          to.join(', '),
      cc:          cc.length  ? cc.join(', ')  : undefined,
      bcc:         bcc.length ? bcc.join(', ') : undefined,
      subject,
      text:        body + extraBody,
      attachments: attachments.length ? attachments : undefined,
    });

    console.log(`[EMAIL] ${alertType} enviado para ${sensorId} → ${to.join(', ')}`);

    await db.addEmailHistory(sensorId, {
      type: alertType, to: to.join(', '), subject
    });

  } catch (e) {
    console.error(`[EMAIL] Erro ao enviar ${alertType}:`, e.message);
  }
}

// ── Textos padrão por tipo de alerta ──────────────────────────────
function defaultSubject(type) {
  const s = {
    temp_high:    '⚠️ ALERTA: Temperatura acima do limite — {{sensor_name}}',
    humid_high:   '⚠️ ALERTA: Umidade acima do limite — {{sensor_name}}',
    sensor_offline: '🔴 SENSOR OFFLINE — {{sensor_name}}',
    temp_normal:  '✅ Temperatura normalizada — {{sensor_name}}',
    humid_normal: '✅ Umidade normalizada — {{sensor_name}}',
    sensor_online:'🟢 Sensor online — {{sensor_name}}',
    daily:        '📊 Relatório Diário — {{sensor_name}}',
    weekly:       '📊 Relatório Semanal — {{sensor_name}}',
    monthly:      '📊 Relatório Mensal — {{sensor_name}}',
  };
  return s[type] || 'Alerta TH-GUARD — {{sensor_name}}';
}

function defaultBody(type) {
  const b = {
    temp_high:    'Sensor: {{sensor_name}}\nLocal: {{location}}\nTemperatura atual: {{temperature}}°C\nLimite configurado: {{temp_limit}}°C\nData/Hora: {{datetime}}',
    humid_high:   'Sensor: {{sensor_name}}\nLocal: {{location}}\nUmidade atual: {{humidity}}%\nLimite configurado: {{humid_limit}}%\nData/Hora: {{datetime}}',
    sensor_offline:'Sensor: {{sensor_name}}\nLocal: {{location}}\nO sensor está offline ou não está enviando dados.\nData/Hora: {{datetime}}',
    temp_normal:  'Sensor: {{sensor_name}}\nLocal: {{location}}\nTemperatura normalizada: {{temperature}}°C\nData/Hora: {{datetime}}',
    humid_normal: 'Sensor: {{sensor_name}}\nLocal: {{location}}\nUmidade normalizada: {{humidity}}%\nData/Hora: {{datetime}}',
    sensor_online:'Sensor: {{sensor_name}}\nLocal: {{location}}\nO sensor voltou a enviar dados.\nData/Hora: {{datetime}}',
    daily:        'Sensor: {{sensor_name}}\nLocal: {{location}}\nRelatório diário de monitoramento.\nTemperatura atual: {{temperature}}°C\nUmidade atual: {{humidity}}%\nData/Hora: {{datetime}}',
    weekly:       'Sensor: {{sensor_name}}\nLocal: {{location}}\nRelatório semanal de monitoramento.\nData/Hora: {{datetime}}',
    monthly:      'Sensor: {{sensor_name}}\nLocal: {{location}}\nRelatório mensal de monitoramento.\nData/Hora: {{datetime}}',
  };
  return b[type] || 'Alerta gerado em {{datetime}}';
}

module.exports = { sendAlert, defaultSubject, defaultBody };
