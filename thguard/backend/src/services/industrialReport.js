// Relatórios diários dos sensores industriais (aba "Relatórios mensais"):
// calendário do mês com a cobertura de cada dia e o .xlsx do dia, minuto a minuto,
// com o gráfico temperatura × horário na segunda planilha.
const { InfluxDB } = require('@influxdata/influxdb-client');
const { buildWorkbook, colName, quoteSheet } = require('./xlsx');
const { sanitizeSensorId } = require('./influx');

// Horário de Brasília. Sem horário de verão desde 2019, então o deslocamento é fixo.
const TZ_OFFSET = '-03:00';
const TZ_OFFSET_MS = -3 * 3600 * 1000;
const DAY_MS = 86400000;
const MINUTES = 1440;

let queryApi;
function getQueryApi() {
  if (!queryApi) {
    const client = new InfluxDB({ url: process.env.INFLUX_URL || 'http://influxdb:8086', token: process.env.INFLUX_TOKEN });
    queryApi = client.getQueryApi(process.env.INFLUX_ORG);
  }
  return queryApi;
}
function runQuery(flux, onRow) {
  return new Promise((resolve, reject) => {
    getQueryApi().queryRows(flux, {
      next(row, meta) { onRow(meta.toObject(row)); },
      error: reject,
      complete: resolve,
    });
  });
}

// ── Datas (sempre no horário de Brasília) ─────────────────────────
function parseDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('data invalida (use AAAA-MM-DD)');
  const start = Date.parse(`${s}T00:00:00${TZ_OFFSET}`);
  if (!Number.isFinite(start) || localDate(start) !== s) throw new Error('data invalida (use AAAA-MM-DD)');
  return { day: s, start, stop: start + DAY_MS };
}
function parseMonth(s) {
  if (typeof s !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new Error('mes invalido (use AAAA-MM)');
  const [y, m] = s.split('-').map(Number);
  const start = Date.parse(`${s}-01T00:00:00${TZ_OFFSET}`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const stop = Date.parse(`${next}-01T00:00:00${TZ_OFFSET}`);
  return { month: s, start, stop, days: Math.round((stop - start) / DAY_MS) };
}
// "AAAA-MM-DD" local de um instante
const localDate = (ms) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const hhmm = (i) => `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
const brDate = (day) => day.split('-').reverse().join('/');

function sensorFilter(ids) {
  if (!ids.length) throw new Error('nenhum sensor');
  return '(' + ids.map((id) => `r.sensor_id == "${sanitizeSensorId(id)}"`).join(' or ') + ')';
}

// ── Consultas ─────────────────────────────────────────────────────
// Minutos com leitura por dia e por sensor. A tensão é gravada em toda leitura
// (a temperatura não é gravada com o indicador desligado ou em falha).
async function queryMonthCoverage(sensorIds, month) {
  const { start, stop } = parseMonth(month);
  const end = Math.min(stop, Date.now() + 60000);
  const out = {};
  if (end <= start) return out;
  const flux = `
    from(bucket: "${process.env.INFLUX_BUCKET}")
      |> range(start: ${iso(start)}, stop: ${iso(end)})
      |> filter(fn: (r) => r._measurement == "industrial" and r._field == "voltage" and ${sensorFilter(sensorIds)})
      |> aggregateWindow(every: 1m, fn: count, createEmpty: false, timeSrc: "_start")
      |> aggregateWindow(every: 1d, offset: 3h, fn: count, createEmpty: false, timeSrc: "_start")`;
  await runQuery(flux, (o) => {
    const day = localDate(new Date(o._time).getTime());
    (out[day] ||= {})[o.sensor_id] = Math.min(MINUTES, Number(o._value) || 0);
  });
  return out;
}

// Médias por minuto de temperatura, off e fault de um dia
async function queryDayMinutes(sensorIds, day) {
  const { start, stop } = parseDay(day);
  const rows = [];
  const flux = `
    from(bucket: "${process.env.INFLUX_BUCKET}")
      |> range(start: ${iso(start)}, stop: ${iso(stop)})
      |> filter(fn: (r) => r._measurement == "industrial" and ${sensorFilter(sensorIds)})
      |> filter(fn: (r) => r._field == "temperature" or r._field == "off" or r._field == "fault")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false, timeSrc: "_start")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;
  await runQuery(flux, (o) => rows.push({
    t: new Date(o._time).getTime(), sensor: o.sensor_id,
    temperature: o.temperature ?? null, off: o.off ?? null, fault: o.fault ?? null,
  }));
  return rows;
}

// ── Montagem do dia ───────────────────────────────────────────────
const STATUS = { on: 'Ligado', off: 'Indicador Therma desligado', fault: 'Falha do transmissor', none: 'Sem leitura' };

function minuteStatus(r) {
  if (!r) return 'none';
  if (r.temperature != null && Number.isFinite(r.temperature)) return 'on';
  if (r.off != null && r.off > 0) return 'off';         // dead zone: off = 1 (e fault = 2)
  if (r.fault != null && r.fault > 0) return 'fault';   // upscale: fault = 1
  return 'none';
}

// Grade de 1440 minutos por sensor: { [id]: [{ temp, status }] }
function buildMinuteGrid(rows, sensorIds, dayStart) {
  const grid = {};
  for (const id of sensorIds) grid[id] = Array.from({ length: MINUTES }, () => ({ temp: null, status: 'none' }));
  for (const r of rows) {
    const g = grid[r.sensor];
    const i = Math.floor((r.t - dayStart) / 60000);
    if (!g || i < 0 || i >= MINUTES) continue;
    const st = minuteStatus(r);
    g[i] = { temp: st === 'on' ? Math.round(r.temperature * 100) / 100 : null, status: st };
  }
  return grid;
}

function summarize(cells, limit) {
  const temps = cells.map((c) => c.temp).filter((v) => v != null);
  const count = (st) => cells.filter((c) => c.status === st).length;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    min: temps.length ? r2(Math.min(...temps)) : null,
    max: temps.length ? r2(Math.max(...temps)) : null,
    mean: temps.length ? r2(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    withReading: MINUTES - count('none'),
    measuring: temps.length,
    off: count('off'),
    fault: count('fault'),
    above: limit != null ? temps.filter((v) => v > limit).length : null,
  };
}

const PALETTE = ['1A4FD6', 'D97706', '0E9F6E', '7C3AED', 'DB2777', '0891B2', '65A30D', 'B45309'];
const STATUS_STYLE = { on: 'subtitle', off: 'off', fault: 'fault', none: 'muted' };
const fmtNow = (d = new Date()) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

// sensors: [{ id, name, location, tempLimit }]
function buildDailyWorkbook({ day, sensors, grid, generatedAt = new Date() }) {
  const single = sensors.length === 1;
  const DATA = 'Minuto a minuto', CHART = 'Gráfico';
  const HEAD = 5;                         // linha do cabeçalho da tabela
  const first = HEAD + 1, last = HEAD + MINUTES;
  const sub = `Sensores industriais · ${brDate(day)} · horário de Brasília (UTC−03:00)`;

  // Planilha 1: minuto a minuto
  const header = [{ v: 'Horário', s: 'header' }];
  sensors.forEach((s) => header.push({ v: `${s.name} (°C)`, s: 'header' }, { v: `${s.name} · Indicador Therma`, s: 'header' }));
  if (single && sensors[0].tempLimit != null) header.push({ v: 'Limite (°C)', s: 'header' });
  const rows = [
    [{ v: 'Relatório diário de temperatura', s: 'title' }],
    [{ v: sub, s: 'subtitle' }],
    [{ v: `Gerado em ${fmtNow(generatedAt)} pelo TH-GUARD. Cada linha é a média das leituras daquele minuto.`, s: 'muted' }],
    [],
    header,
  ];
  for (let i = 0; i < MINUTES; i++) {
    const row = [{ v: hhmm(i) }];
    for (const s of sensors) {
      const c = grid[s.id][i];
      row.push({ v: c.temp, s: 'num2' }, { v: STATUS[c.status], s: STATUS_STYLE[c.status] });
    }
    if (single && sensors[0].tempLimit != null) row.push({ v: sensors[0].tempLimit, s: 'num1' });
    rows.push(row);
  }
  const nCols = header.length;
  const cols = [10, ...sensors.flatMap(() => [16, 26]), ...(nCols > 1 + sensors.length * 2 ? [12] : [])];

  // Planilha 2: gráfico + resumo
  const series = sensors.map((s, k) => ({
    name: s.name, nameRef: `${quoteSheet(DATA)}!$${colName(1 + k * 2)}$${HEAD}`,
    ref: `${quoteSheet(DATA)}!$${colName(1 + k * 2)}$${first}:$${colName(1 + k * 2)}$${last}`,
    values: grid[s.id].map((c) => c.temp), color: PALETTE[k % PALETTE.length], width: 15875,
  }));
  if (single && sensors[0].tempLimit != null) {
    const lc = colName(nCols - 1);
    series.push({ name: `Limite (${sensors[0].tempLimit} °C)`, nameRef: `${quoteSheet(DATA)}!$${lc}$${HEAD}`,
      ref: `${quoteSheet(DATA)}!$${lc}$${first}:$${lc}$${last}`, values: Array(MINUTES).fill(sensors[0].tempLimit),
      color: 'C0392B', dash: 'dash', width: 12700 });
  }
  const sumHeader = ['Sensor', 'ID', 'Local', 'Limite (°C)', 'Mínima (°C)', 'Máxima (°C)', 'Média (°C)',
    'Minutos medindo', 'Minutos Therma desligado', 'Minutos em falha', 'Minutos sem leitura', 'Minutos acima do limite'].map((v) => ({ v, s: 'header' }));
  const sumRows = sensors.map((s) => {
    const m = summarize(grid[s.id], s.tempLimit);
    return [{ v: s.name, s: 'bold' }, s.id, s.location || '', { v: s.tempLimit, s: 'num1' }, { v: m.min, s: 'num2' }, { v: m.max, s: 'num2' },
      { v: m.mean, s: 'num2' }, { v: m.measuring, s: 'int' }, { v: m.off, s: 'int' }, { v: m.fault, s: 'int' },
      { v: MINUTES - m.withReading, s: 'int' }, { v: m.above, s: 'int' }];
  });
  const CHART_ROWS = 28;                  // gráfico ocupa as linhas 3 a 30
  const chartSheetRows = [
    [{ v: 'Temperatura minuto a minuto', s: 'title' }],
    [{ v: sub, s: 'subtitle' }],
  ];
  while (chartSheetRows.length < 2 + CHART_ROWS + 1) chartSheetRows.push([]);
  chartSheetRows.push([{ v: 'Resumo do dia', s: 'bold' }], sumHeader, ...sumRows);

  return buildWorkbook({
    title: `Relatório diário ${brDate(day)}`,
    sheets: [
      { name: DATA, rows, cols, freezeRows: HEAD, autoFilter: `A${HEAD}:${colName(nCols - 1)}${last}`,
        printTitleRows: `$${HEAD}:$${HEAD}`, rowHeights: { [HEAD - 1]: 32 } },
      { name: CHART, rows: chartSheetRows, cols: [28, 10, 18, 11, 12, 12, 11, 12, 14, 12, 12, 14], showGrid: false, landscape: true, fitToPage: true,
        chart: {
          anchor: { from: { col: 0, row: 2 }, to: { col: 10, row: 2 + CHART_ROWS } },
          title: `Temperatura × horário · ${brDate(day)}`, xTitle: 'Horário (Brasília)', yTitle: 'Temperatura (°C)',
          catRef: `${quoteSheet(DATA)}!$A$${first}:$A$${last}`, catValues: Array.from({ length: MINUTES }, (_, i) => hhmm(i)),
          tickSkip: 60, series,
        } },
    ],
  });
}

module.exports = {
  TZ_OFFSET, MINUTES, parseDay, parseMonth, localDate, hhmm,
  queryMonthCoverage, queryDayMinutes, minuteStatus, buildMinuteGrid, summarize, buildDailyWorkbook,
};
