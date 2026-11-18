// Arquivos gerenciados pelo painel de administração:
//   reports  → relatórios gerados pelo TH-GUARD (anexos de e-mail, CSV e .xlsx baixados),
//              guardados em data/relatorios/AAAA-MM/ (volume ./backend/data do compose)
//   backups  → backups do MariaDB, montados em /backups (BACKUP_DIR)
// Nenhum caminho vindo da API sai da pasta da categoria.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const ROOTS = {
  reports: () => path.join(DATA_DIR, 'relatorios'),
  backups: () => process.env.BACKUP_DIR || '/backups',
};
// Só estes tipos podem ser apagados em backups: protege contra montar a pasta errada
const BACKUP_EXT = /\.(sql|sql\.gz|gz|zip|tgz|tar|tar\.gz|bz2|xz|zst|dump)$/i;
const MAX_DEPTH = 4;

function root(kind) {
  if (!ROOTS[kind]) { const e = new Error('categoria de arquivo invalida'); e.status = 400; throw e; }
  return path.resolve(ROOTS[kind]());
}

// Resolve um caminho relativo dentro da categoria; recusa "..", absolutos e links para fora
async function resolveInside(kind, rel) {
  const base = root(kind);
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) {
    const e = new Error('caminho invalido'); e.status = 400; throw e;
  }
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep)) { const e = new Error('caminho fora da pasta permitida'); e.status = 400; throw e; }
  let real;
  try { real = await fsp.realpath(full); } catch { const e = new Error('arquivo nao encontrado'); e.status = 404; throw e; }
  const realBase = await fsp.realpath(base).catch(() => base);
  if (!real.startsWith(realBase + path.sep)) { const e = new Error('caminho fora da pasta permitida'); e.status = 400; throw e; }
  return real;
}

async function walk(dir, base, depth, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory() && depth < MAX_DEPTH) await walk(full, base, depth + 1, out);
    else if (ent.isFile()) {
      try {
        const st = await fsp.stat(full);
        out.push({ path: path.relative(base, full).split(path.sep).join('/'), name: ent.name, size: st.size, mtime: st.mtime.toISOString() });
      } catch { /* arquivo sumiu no meio da listagem */ }
    }
  }
  return out;
}

async function list(kind) {
  const base = root(kind);
  const exists = fs.existsSync(base);
  const files = exists ? await walk(base, base, 0, []) : [];
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { kind, dir: base, exists, count: files.length, bytes: files.reduce((a, f) => a + f.size, 0), files };
}

function deletable(kind, file) {
  return kind !== 'backups' || BACKUP_EXT.test(file);
}

async function remove(kind, rel) {
  const full = await resolveInside(kind, rel);
  if (!deletable(kind, full)) { const e = new Error('tipo de arquivo nao pode ser apagado pelo painel'); e.status = 400; throw e; }
  const st = await fsp.stat(full);
  if (!st.isFile()) { const e = new Error('nao e um arquivo'); e.status = 400; throw e; }
  await fsp.unlink(full);
  return { path: rel, size: st.size };
}

async function cleanup(kind, olderThanDays) {
  const days = Number(olderThanDays);
  if (!Number.isFinite(days) || days < 1) { const e = new Error('informe dias >= 1'); e.status = 400; throw e; }
  const limit = Date.now() - days * 86400e3;
  const { files } = await list(kind);
  let count = 0, bytes = 0;
  for (const f of files) {
    if (Date.parse(f.mtime) >= limit || !deletable(kind, f.name)) continue;
    try { await remove(kind, f.path); count++; bytes += f.size; } catch { /* segue com os demais */ }
  }
  return { count, bytes };
}

// Guarda um relatório gerado (nunca lança: falha só vira log)
async function saveReport(filename, content) {
  try {
    const month = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);   // AAAA-MM em Brasília
    const safe = String(filename).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 150) || 'relatorio';
    const dir = path.join(root('reports'), month);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${safe}.${process.pid}.tmp`);
    await fsp.writeFile(tmp, content);
    await fsp.rename(tmp, path.join(dir, safe));
    return `${month}/${safe}`;
  } catch (e) {
    console.error('[ARQUIVOS] Nao foi possivel guardar o relatorio', filename, '-', e.message);
    return null;
  }
}

// Espaço do disco onde ficam os dados do TH-GUARD
function disk(dir = DATA_DIR) {
  try {
    const s = fs.statfsSync(fs.existsSync(dir) ? dir : '/');
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize, used: (s.blocks - s.bfree) * s.bsize };
  } catch { return null; }
}

module.exports = { list, remove, cleanup, saveReport, resolveInside, disk, root, DATA_DIR };
