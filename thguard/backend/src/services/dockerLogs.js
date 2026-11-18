// Logs dos containers, lidos por um proxy do socket do Docker que só permite
// GET em /containers (serviço dockerproxy no compose). O backend nunca recebe o
// socket em si, e esta rota só expõe nome, estado e as linhas de log.
const DOCKER = () => (process.env.DOCKER_API || '').replace(/\/$/, '');
// Só containers com estes prefixos aparecem no painel (padrão: os do TH-GUARD)
const PREFIXES = () => (process.env.DOCKER_LOG_PREFIXES || 'thguard-').split(',').map((s) => s.trim()).filter(Boolean);

function enabled() { return !!DOCKER(); }

async function dockerGet(p, timeout = 10000) {
  const res = await fetch(DOCKER() + p, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Docker ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res;
}

const allowed = (name) => PREFIXES().some((p) => name.startsWith(p));

async function listContainers() {
  if (!enabled()) return { enabled: false, containers: [] };
  const list = await (await dockerGet('/containers/json?all=1')).json();
  const containers = list
    .map((c) => ({ name: (c.Names?.[0] || '').replace(/^\//, ''), image: c.Image, state: c.State, status: c.Status, created: c.Created * 1000 }))
    .filter((c) => allowed(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { enabled: true, containers };
}

// O Docker devolve stdout/stderr multiplexados: cabeçalho de 8 bytes por bloco
// (byte 0 = stream, bytes 4-7 = tamanho). Sem TTY é sempre esse formato.
function demux(buf) {
  const lines = [];
  let i = 0;
  const push = (stream, text) => text.split('\n').forEach((l) => { if (l.length) lines.push({ stream, ...splitTs(l) }); });
  if (buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
    while (i + 8 <= buf.length) {
      const stream = buf[i] === 2 ? 'stderr' : 'stdout';
      const size = buf.readUInt32BE(i + 4);
      push(stream, buf.slice(i + 8, i + 8 + size).toString('utf8'));
      i += 8 + size;
    }
  } else {
    push('stdout', buf.toString('utf8'));   // container com TTY
  }
  return lines;
}
function splitTs(l) {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s(.*)$/s.exec(l);
  return m ? { ts: m[1], text: m[2] } : { ts: null, text: l };
}

async function containerLogs(name, { tail = 300, sinceMinutes } = {}) {
  if (!enabled()) { const e = new Error('Logs dos containers desativados (DOCKER_API nao configurado)'); e.status = 503; throw e; }
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || !allowed(name)) { const e = new Error('Container nao permitido'); e.status = 403; throw e; }
  const n = Math.max(10, Math.min(2000, Number(tail) || 300));
  const since = sinceMinutes ? `&since=${Math.floor(Date.now() / 1000 - Number(sinceMinutes) * 60)}` : '';
  const res = await dockerGet(`/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&timestamps=1&tail=${n}${since}`, 15000);
  return { name, lines: demux(Buffer.from(await res.arrayBuffer())) };
}

module.exports = { enabled, listContainers, containerLogs, demux };
