// Log do sistema: tudo o que o backend escreve no console (console.log/warn/error)
// vai também para a tabela system_log, em lotes, para o painel de administração.
// Eventos de auditoria (login, ações de admin) entram com o usuário.
//
// O console continua funcionando igual (docker logs); se o banco cair, as linhas
// ficam numa fila limitada e são gravadas quando ele voltar.
const util = require('util');

const MAX_QUEUE = 2000;
const FLUSH_MS = 2000;
let queue = [];
let dbRef = null;
let flushing = false;
let dropped = 0;
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };

// "[MQTT] Conectado" -> categoria "mqtt", mensagem "Conectado"
function parse(text) {
  const m = /^\s*\[([A-Za-z0-9 _-]{1,28})\]\s*(.*)$/s.exec(text);
  return m ? { category: m[1].trim().toLowerCase().replace(/\s+/g, '_'), message: m[2] } : { category: 'sistema', message: text };
}

function push(level, category, message, userEmail = null) {
  if (queue.length >= MAX_QUEUE) { queue.shift(); dropped++; }
  queue.push({ ts: new Date(), level, category: String(category).slice(0, 30), message: String(message).slice(0, 2000), userEmail });
}

async function flush() {
  if (flushing || !dbRef || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, 200);
  try {
    if (dropped) {
      batch.unshift({ ts: new Date(), level: 'warn', category: 'log', message: `${dropped} linha(s) de log descartadas com o banco indisponivel`, userEmail: null });
      dropped = 0;
    }
    const ph = batch.map(() => '(?,?,?,?,?)').join(',');
    await dbRef.query(`INSERT INTO system_log (ts, level, category, message, user_email) VALUES ${ph}`,
      batch.flatMap((r) => [r.ts, r.level, r.category, r.message, r.userEmail]));
  } catch (e) {
    queue = batch.concat(queue).slice(-MAX_QUEUE);   // devolve à fila; tenta no próximo ciclo
    if (!/system_log/.test(e.message)) original.error('[LOG] Falha ao gravar log do sistema:', e.message);
  } finally {
    flushing = false;
  }
}

let installed = false;
function install(db) {
  dbRef = db;
  if (installed) return;
  installed = true;
  const wrap = (fn, level) => (...args) => {
    original[fn](...args);
    try { const { category, message } = parse(util.format(...args)); push(level, category, message); } catch { /* nunca quebra o console */ }
  };
  console.log = wrap('log', 'info');
  console.info = wrap('info', 'info');
  console.warn = wrap('warn', 'warn');
  console.error = wrap('error', 'error');
  setInterval(() => { flush(); }, FLUSH_MS).unref();
  process.on('uncaughtException', (e) => { console.error('[PROCESSO] Erro nao tratado:', e && e.stack || e); });
  process.on('unhandledRejection', (e) => { console.error('[PROCESSO] Promise rejeitada sem tratamento:', e && e.message || e); });
}

// Ação de um usuário (login, exclusões, configurações). Também aparece no console.
function audit(user, category, message, level = 'info') {
  const email = user && (user.email || user) || null;
  original[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${category.toUpperCase()}] ${message}${email ? ` (${email})` : ''}`);
  push(level, category, message, email);
}

module.exports = { install, audit, flush, parse, _queue: () => queue };
