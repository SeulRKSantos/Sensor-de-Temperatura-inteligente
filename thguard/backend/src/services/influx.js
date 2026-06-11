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
  writeApi.flush().catch(e => console.error('[InfluxDB] Erro ao gravar:', e.message));
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

async function queryHistory(sensorId, range = '24h') {
  sensorId = sanitizeSensorId(sensorId); range = sanitizeRange(range);
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const window = windowForRange(range);
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "environment" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        rows.push({ ts: obj._time, temperature: obj.temperature, humidity: obj.humidity });
      },
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
      |> filter(fn: (r) => r._measurement == "environment" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
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


// ── Diário: leituras minuto a minuto (últimas 24h) ────────────────
async function queryDailyCSV(sensorId) {
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "environment" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        rows.push({
          ts: new Date(obj._time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          temperature: obj.temperature != null ? obj.temperature.toFixed(2) : '',
          humidity:    obj.humidity    != null ? obj.humidity.toFixed(2)    : ''
        });
      },
      error: reject,
      complete: () => resolve(rows)
    });
  });
}

// ── Semanal: médias a cada 2 horas (últimos 7 dias) ───────────────
async function queryWeeklyCSV(sensorId) {
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -168h)
      |> filter(fn: (r) => r._measurement == "environment" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 2h, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        rows.push({
          ts: new Date(obj._time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          temperature: obj.temperature != null ? obj.temperature.toFixed(2) : '',
          humidity:    obj.humidity    != null ? obj.humidity.toFixed(2)    : ''
        });
      },
      error: reject,
      complete: () => resolve(rows)
    });
  });
}

// ── Mensal: médias diárias (últimos 30 dias) ──────────────────────
async function queryMonthlyCSV(sensorId) {
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -720h)
      |> filter(fn: (r) => r._measurement == "environment" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1d, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        rows.push({
          ts: new Date(obj._time).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          temperature: obj.temperature != null ? obj.temperature.toFixed(2) : '',
          humidity:    obj.humidity    != null ? obj.humidity.toFixed(2)    : ''
        });
      },
      error: reject,
      complete: () => resolve(rows)
    });
  });
}

function rowsToCSV(rows, type) {
  const headers = {
    daily:   'Data/Hora;Temperatura (C);Umidade (%)',
    weekly:  'Data/Hora (media 2h);Temperatura (C);Umidade (%)',
    monthly: 'Data (media diaria);Temperatura (C);Umidade (%)'
  };
  const header = headers[type] || 'Data;Temperatura;Umidade';
  const lines  = rows.map(r => `${r.ts};${r.temperature};${r.humidity}`);
  return [header, ...lines].join('\r\n');
}


// ── Estatísticas: média, máximo e mínimo por período ─────────────
async function queryPeriodStats(sensorId, range) {
  const { queryApi } = getClients();
  const bucket = process.env.INFLUX_BUCKET;
  const stats = {};

  const queries = {
    mean: `from(bucket:"${bucket}")|>range(start:-${range})|>filter(fn:(r)=>r._measurement=="environment" and r.sensor_id=="${sensorId}" and r._field=="temperature")|>mean()`,
    max:  `from(bucket:"${bucket}")|>range(start:-${range})|>filter(fn:(r)=>r._measurement=="environment" and r.sensor_id=="${sensorId}" and r._field=="temperature")|>max()`,
    min:  `from(bucket:"${bucket}")|>range(start:-${range})|>filter(fn:(r)=>r._measurement=="environment" and r.sensor_id=="${sensorId}" and r._field=="temperature")|>min()`,
  };

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
       WHERE sensor_id=? AND type IN ('temp_high','humid_high') AND ts >= ?`,
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

module.exports = { writePoint, queryHistory, queryStats, queryDailyCSV, queryWeeklyCSV, queryMonthlyCSV, rowsToCSV, queryPeriodStats, countAlertsInPeriod };
