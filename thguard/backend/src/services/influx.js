const { InfluxDB, Point } = require('@influxdata/influxdb-client');

// Sanitiza inputs para queries Flux — previne injecao
function sanitizeSensorId(id) {
  if (typeof id !== 'string') throw new Error('sensorId invalido');
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(id)) throw new Error('sensorId invalido');
  return id;
}

function sanitizeRange(range) {
  const allowed = ['1h','6h','24h','168h','720h','4320h','8760h'];
  if (!allowed.includes(range)) throw new Error('range invalido');
  return range;
}

// ── Tipo de sensor ────────────────────────────────────────────────
// TH-GUARD (DHT):  measurement "environment", campos temperature + humidity
// Industrial (VA01): measurement "industrial", campos temperature + voltage
//                    (+ mv, spread, fault gravados para diagnostico)
// O tipo e identificado pelo prefixo do ID (ind-NNN), atribuido no registro.
function isIndustrialId(id) { return typeof id === 'string' && id.startsWith('ind-'); }
function measurementOf(id)  { return isIndustrialId(id) ? 'industrial' : 'environment'; }
function secondFieldOf(id)  { return isIndustrialId(id) ? 'voltage' : 'humidity'; }
function fieldFilter(id)    { return `r._field == "temperature" or r._field == "${secondFieldOf(id)}"`; }


let writeApi, queryApi;

function getClients() {
  if (!writeApi) {
    const client = new InfluxDB({
      url: process.env.INFLUX_URL || 'http://influxdb:8086',
      token: process.env.INFLUX_TOKEN
    });
    const org = process.env.INFLUX_ORG;
    const bucket = process.env.INFLUX_BUCKET;
    writeApi = client.getWriteApi(org, bucket, 'ms');
    queryApi = client.getQueryApi(org);
  }
  return { writeApi, queryApi };
}

function writePoint(sensorId, temperature, humidity) {
  const { writeApi } = getClients();
  const point = new Point('environment')
    .tag('sensor_id', sensorId)
    .floatField('temperature', temperature)
    .floatField('humidity', humidity);
  writeApi.writePoint(point);
  // Batch gerenciado pelo cliente InfluxDB (flushInterval configurado no getClients)
}

// Leitura industrial. Em falha upscale a temperatura nao e gravada
// (o valor nao tem significado fisico), mas a tensao sim.
function writeIndustrialPoint(sensorId, { temperature, voltage, mv, spread, fault }) {
  const { writeApi } = getClients();
  const point = new Point('industrial')
    .tag('sensor_id', sensorId)
    .floatField('voltage', voltage)
    .floatField('mv', mv)
    .intField('fault', fault || 0);
  if (temperature != null && Number.isFinite(temperature)) point.floatField('temperature', temperature);
  if (spread != null && Number.isFinite(spread)) point.floatField('spread', spread);
  writeApi.writePoint(point);
}

// Agrega dados por janela de tempo para não sobrecarregar o gráfico
function windowForRange(range) {
  const map = {
    '1h':   '2m',   // 1h  → ponto a cada 2 min  (~30 pontos)
    '6h':   '10m',  // 6h  → ponto a cada 10 min (~36 pontos)
    '24h':  '30m',  // 24h → ponto a cada 30 min (~48 pontos)
    '168h': '3h',   // 7d  → ponto a cada 3h     (~56 pontos)
    '720h': '1d',   // 30d → ponto a cada 1 dia  (~30 pontos)
    '4320h':'7d',   // 6m  → ponto a cada 7 dias (~26 pontos)
    '8760h':'14d',  // 1a  → ponto a cada 14 dias (~26 pontos)
  };
  return map[range] || '1h';
}

// Monta a linha de saida com os campos do tipo do sensor
function rowOut(sensorId, obj, fmt) {
  const f2 = secondFieldOf(sensorId);
  const out = { ts: fmt ? fmt(obj._time) : obj._time };
  if (fmt) {
    out.temperature = obj.temperature != null ? obj.temperature.toFixed(2) : '';
    out[f2] = obj[f2] != null ? obj[f2].toFixed(f2 === 'voltage' ? 3 : 2) : '';
  } else {
    out.temperature = obj.temperature;
    out[f2] = obj[f2];
  }
  return out;
}

async function queryHistory(sensorId, range = '24h') {
  sensorId = sanitizeSensorId(sensorId); range = sanitizeRange(range);
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const window = windowForRange(range);
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "${measurementOf(sensorId)}" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => ${fieldFilter(sensorId)})
      |> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) { rows.push(rowOut(sensorId, tableMeta.toObject(row))); },
      error: reject,
      complete: () => resolve(rows)
    });
  });
}

async function queryStats(sensorId, range = '24h') {
  sensorId = sanitizeSensorId(sensorId); range = sanitizeRange(range);
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "${measurementOf(sensorId)}" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => ${fieldFilter(sensorId)})
      |> group(columns: ["_field"])
      |> mean()
  `;
  const stats = {};
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        stats[obj._field] = obj._value;
      },
      error: reject,
      complete: () => resolve(stats)
    });
  });
}

// ── CSV dos relatorios por e-mail ─────────────────────────────────
async function queryCSV(sensorId, range, every, fmt) {
  sensorId = sanitizeSensorId(sensorId);
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "${measurementOf(sensorId)}" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => ${fieldFilter(sensorId)})
      |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) { rows.push(rowOut(sensorId, tableMeta.toObject(row), fmt)); },
      error: reject,
      complete: () => resolve(rows)
    });
  });
}

const fmtDateTime = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fmtDate     = t => new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

// Diário: leituras minuto a minuto (últimas 24h)
function queryDailyCSV(sensorId)   { return queryCSV(sensorId, '24h',  '1m', fmtDateTime); }
// Semanal: médias a cada 2 horas (últimos 7 dias)
function queryWeeklyCSV(sensorId)  { return queryCSV(sensorId, '168h', '2h', fmtDateTime); }
// Mensal: médias diárias (últimos 30 dias)
function queryMonthlyCSV(sensorId) { return queryCSV(sensorId, '720h', '1d', fmtDate); }

function rowsToCSV(rows, type, sensorId) {
  const ind = isIndustrialId(sensorId);
  const second = ind ? 'Tensao transmissor (V)' : 'Umidade (%)';
  const headers = {
    daily:   `Data/Hora;Temperatura (C);${second}`,
    weekly:  `Data/Hora (media 2h);Temperatura (C);${second}`,
    monthly: `Data (media diaria);Temperatura (C);${second}`
  };
  const header = headers[type] || `Data;Temperatura;${second}`;
  const key = ind ? 'voltage' : 'humidity';
  const lines  = rows.map(r => `${r.ts};${r.temperature};${r[key]}`);
  return [header, ...lines].join('\r\n');
}


// ── Estatísticas: média, máximo e mínimo por período ─────────────
async function queryPeriodStats(sensorId, range) {
  sensorId = sanitizeSensorId(sensorId);
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const m = measurementOf(sensorId);
  const stats = {};

  const base = `from(bucket:"${bucket}")|>range(start:-${range})|>filter(fn:(r)=>r._measurement=="${m}" and r.sensor_id=="${sensorId}" and r._field=="temperature")`;
  const queries = { mean: base + '|>mean()', max: base + '|>max()', min: base + '|>min()' };

  for (const [key, query] of Object.entries(queries)) {
    await new Promise((resolve, reject) => {
      queryApi.queryRows(query, {
        next(row, tableMeta) {
          const obj = tableMeta.toObject(row);
          stats[key] = obj._value != null ? parseFloat(obj._value.toFixed(2)) : null;
        },
        error: reject,
        complete: resolve
      });
    });
  }
  return stats;
}

// ── Contagem de alertas no período ────────────────────────────────
async function countAlertsInPeriod(sensorId, range, db) {
  try {
    const since = new Date(Date.now() - parsePeriodMs(range));
    const rows = await db.query(
      `SELECT COUNT(*) as total FROM email_history
       WHERE sensor_id=? AND type IN ('temp_high','humid_high','sensor_fault') AND ts >= ?`,
      [sensorId, since.toISOString().slice(0,19).replace('T',' ')]
    );
    return rows[0]?.total || 0;
  } catch { return 0; }
}

function parsePeriodMs(range) {
  const match = range.match(/(\d+)([hd])/);
  if (!match) return 0;
  const [, n, unit] = match;
  return parseInt(n) * (unit === 'h' ? 3600000 : 86400000);
}

module.exports = {
  writePoint, writeIndustrialPoint, queryHistory, queryStats,
  queryDailyCSV, queryWeeklyCSV, queryMonthlyCSV, rowsToCSV,
  queryPeriodStats, countAlertsInPeriod, sanitizeSensorId, sanitizeRange,
  isIndustrialId,
};
