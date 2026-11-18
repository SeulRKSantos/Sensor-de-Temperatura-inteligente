// InfluxDB no painel de administração: tamanho e retenção do bucket, período
// guardado, leituras por sensor e exclusão manual de leituras por período/sensor.
const { InfluxDB } = require('@influxdata/influxdb-client');
const { sanitizeSensorId } = require('./influx');

const URL_ = () => (process.env.INFLUX_URL || 'http://influxdb:8086').replace(/\/$/, '');
const BUCKET = () => process.env.INFLUX_BUCKET;
const ORG = () => process.env.INFLUX_ORG;
const headers = () => ({ Authorization: `Token ${process.env.INFLUX_TOKEN}`, 'Content-Type': 'application/json' });

let queryApi;
function q() {
  if (!queryApi) queryApi = new InfluxDB({ url: URL_(), token: process.env.INFLUX_TOKEN }).getQueryApi(ORG());
  return queryApi;
}
function rows(flux) {
  return new Promise((resolve, reject) => {
    const out = [];
    q().queryRows(flux, { next: (r, m) => out.push(m.toObject(r)), error: reject, complete: () => resolve(out) });
  });
}

async function api(pathname, opts = {}) {
  const res = await fetch(URL_() + pathname, { ...opts, headers: { ...headers(), ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`InfluxDB ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res;
}

// Bucket: id e retenção (0 = infinita)
async function bucketInfo() {
  const res = await api(`/api/v2/buckets?name=${encodeURIComponent(BUCKET())}&org=${encodeURIComponent(ORG())}`);
  const b = (await res.json()).buckets?.[0];
  if (!b) return null;
  const rule = (b.retentionRules || []).find((r) => r.type === 'expire');
  return { id: b.id, name: b.name, retentionSeconds: rule ? rule.everySeconds : 0 };
}

// Tamanho em disco, pelas métricas Prometheus do InfluxDB (storage_shard_disk_size)
async function bucketDiskBytes(bucketId) {
  try {
    const res = await fetch(URL_() + '/metrics', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const text = await res.text();
    let total = 0, found = false;
    for (const line of text.split('\n')) {
      if (!line.startsWith('storage_shard_disk_size{') && !line.startsWith('storage_wal_size{')) continue;
      if (bucketId && !line.includes(`bucket="${bucketId}"`)) continue;
      const v = Number(line.trim().split(/\s+/).pop());
      if (Number.isFinite(v)) { total += v; found = true; }
    }
    return found ? total : null;
  } catch { return null; }
}

// Uma "leitura" = um ponto: temperatura nos TH-GUARD, tensão nos industriais
// (a tensão é gravada até com o indicador desligado)
const READING = '((r._measurement == "industrial" and r._field == "voltage") or (r._measurement == "environment" and r._field == "temperature"))';

// Por sensor: primeira e última leitura guardadas e quantidade nas últimas 24 h
async function perSensor() {
  const [first, last, day] = await Promise.all([
    rows(`from(bucket: "${BUCKET()}") |> range(start: 0) |> filter(fn: (r) => ${READING}) |> first() |> keep(columns: ["sensor_id", "_time"])`),
    rows(`from(bucket: "${BUCKET()}") |> range(start: -3650d) |> filter(fn: (r) => ${READING}) |> last() |> keep(columns: ["sensor_id", "_time"])`),
    rows(`from(bucket: "${BUCKET()}") |> range(start: -24h) |> filter(fn: (r) => ${READING}) |> count() |> keep(columns: ["sensor_id", "_value"])`),
  ]);
  const out = {};
  const get = (id) => (out[id] ||= { first: null, last: null, readings24h: 0 });
  first.forEach((r) => { get(r.sensor_id).first = r._time; });
  last.forEach((r) => { get(r.sensor_id).last = r._time; });
  day.forEach((r) => { get(r.sensor_id).readings24h = Number(r._value) || 0; });
  return out;
}

// Leituras por dia nos últimos N dias (todas as séries), para o gráfico de volume
async function readingsPerDay(days = 30) {
  const r = await rows(`from(bucket: "${BUCKET()}") |> range(start: -${Math.max(1, Math.min(365, days | 0))}d)
    |> filter(fn: (r) => ${READING}) |> group()
    |> aggregateWindow(every: 1d, offset: 3h, fn: count, createEmpty: true, timeSrc: "_start")`);
  return r.map((x) => ({ day: new Date(Date.parse(x._time) - 3 * 3600e3).toISOString().slice(0, 10), count: Number(x._value) || 0 }));
}

// ── Exclusão manual ───────────────────────────────────────────────
function parseRange(start, stop) {
  const a = Date.parse(start), b = Date.parse(stop);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) { const e = new Error('periodo invalido (inicio deve ser antes do fim)'); e.status = 400; throw e; }
  if (b > Date.now() + 60000) { const e = new Error('o fim do periodo nao pode estar no futuro'); e.status = 400; throw e; }
  return { start: new Date(a).toISOString(), stop: new Date(b).toISOString() };
}

// Quantas leituras seriam apagadas (para o admin confirmar antes)
async function countRange({ start, stop, sensorId }) {
  const r = parseRange(start, stop);
  const sid = sensorId ? ` and r.sensor_id == "${sanitizeSensorId(sensorId)}"` : '';
  const res = await rows(`from(bucket: "${BUCKET()}") |> range(start: ${r.start}, stop: ${r.stop})
    |> filter(fn: (r) => ${READING}${sid}) |> group(columns: ["sensor_id"]) |> count()`);
  const bySensor = Object.fromEntries(res.map((x) => [x.sensor_id, Number(x._value) || 0]));
  return { ...r, sensorId: sensorId || null, total: Object.values(bySensor).reduce((a, b) => a + b, 0), bySensor };
}

// Apaga todas as séries (temperatura, tensão, estado...) do sensor no período.
// Sem sensor, apaga tudo do período.
async function deleteRange({ start, stop, sensorId }) {
  const r = parseRange(start, stop);
  const body = { start: r.start, stop: r.stop };
  if (sensorId) body.predicate = `sensor_id="${sanitizeSensorId(sensorId)}"`;
  await api(`/api/v2/delete?org=${encodeURIComponent(ORG())}&bucket=${encodeURIComponent(BUCKET())}`, { method: 'POST', body: JSON.stringify(body) });
  return { ...r, sensorId: sensorId || null };
}

// Todo o histórico de um sensor (exclusão definitiva de sensor)
function deleteSensorHistory(sensorId) {
  return deleteRange({ start: '1970-01-01T00:00:00Z', stop: new Date().toISOString(), sensorId });
}

module.exports = { bucketInfo, bucketDiskBytes, perSensor, readingsPerDay, countRange, deleteRange, deleteSensorHistory, parseRange };
