const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thguard-admin-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
const files = require('../src/services/files');
const { demux } = require('../src/services/dockerLogs');
const { parse } = require('../src/services/logger');
const { parseRange } = require('../src/services/influxAdmin');

describe('arquivos: nada sai da pasta da categoria', () => {
  before(() => {
    fs.mkdirSync(path.join(tmp, 'backups', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'backups', 'b.sql.gz'), 'x');
    fs.writeFileSync(path.join(tmp, 'backups', 'notas.txt'), 'x');
    fs.writeFileSync(path.join(tmp, 'segredo.txt'), 'segredo');
    fs.symlinkSync(path.join(tmp, 'segredo.txt'), path.join(tmp, 'backups', 'sub', 'link.sql'));
  });
  it('recusa .., caminho absoluto, vazio e byte nulo', async () => {
    for (const p of ['../segredo.txt', 'sub/../../segredo.txt', '/etc/passwd', '', 'a\0b']) {
      await assert.rejects(files.resolveInside('backups', p), (e) => e.status === 400, p);
    }
  });
  it('recusa link simbólico que aponta para fora', async () => {
    await assert.rejects(files.resolveInside('backups', 'sub/link.sql'), /fora da pasta/);
    await assert.rejects(files.remove('backups', 'sub/link.sql'));
    assert.ok(fs.existsSync(path.join(tmp, 'segredo.txt')));
  });
  it('em backups só apaga tipos de backup', async () => {
    await assert.rejects(files.remove('backups', 'notas.txt'), /nao pode ser apagado/);
    assert.equal((await files.remove('backups', 'b.sql.gz')).path, 'b.sql.gz');
  });
  it('guarda relatório na pasta do mês e limpa o nome', async () => {
    const rel = await files.saveReport('../../relatorio diário?.csv', 'a,b');
    assert.match(rel, /^\d{4}-\d{2}\/\.\._\.\._relatorio_di_rio_\.csv$/);
    const { files: list } = await files.list('reports');
    assert.equal(list.length, 1);
    assert.equal(fs.readFileSync(path.join(process.env.DATA_DIR, 'relatorios', rel), 'utf8'), 'a,b');
  });
  it('categoria desconhecida é erro 400', () => {
    assert.throws(() => files.root('../etc'), (e) => e.status === 400);
  });
});

describe('logs dos containers', () => {
  const frame = (s, t) => { const p = Buffer.from(t); const h = Buffer.alloc(8); h[0] = s; h.writeUInt32BE(p.length, 4); return Buffer.concat([h, p]); };
  it('separa stdout e stderr e a hora de cada linha', () => {
    const out = demux(Buffer.concat([frame(1, '2026-11-18T14:00:00.1Z linha 1\n2026-11-18T14:00:01Z linha 2\n'), frame(2, '2026-11-18T14:00:02Z erro\n')]));
    assert.deepEqual(out.map((l) => [l.stream, l.ts, l.text]), [
      ['stdout', '2026-11-18T14:00:00.1Z', 'linha 1'], ['stdout', '2026-11-18T14:00:01Z', 'linha 2'], ['stderr', '2026-11-18T14:00:02Z', 'erro']]);
  });
  it('container com TTY (sem cabeçalho) vira texto simples', () => {
    assert.deepEqual(demux(Buffer.from('a\nb\n')).map((l) => l.text), ['a', 'b']);
  });
});

describe('log do sistema e períodos', () => {
  it('categoria vem do prefixo entre colchetes', () => {
    assert.deepEqual(parse('[MQTT] Conectado ao broker'), { category: 'mqtt', message: 'Conectado ao broker' });
    assert.deepEqual(parse('[DB] ensureAdmin erro: x'), { category: 'db', message: 'ensureAdmin erro: x' });
    assert.deepEqual(parse('TH-GUARD backend rodando'), { category: 'sistema', message: 'TH-GUARD backend rodando' });
  });
  it('período de exclusão: início antes do fim e fim não futuro', () => {
    assert.deepEqual(parseRange('2026-10-01T03:00:00Z', '2026-11-01T03:00:00Z'), { start: '2026-10-01T03:00:00.000Z', stop: '2026-11-01T03:00:00.000Z' });
    assert.throws(() => parseRange('2026-11-01', '2026-10-01'), /periodo invalido/);
    assert.throws(() => parseRange('2026-10-01', '2999-01-01'), /futuro/);
    assert.throws(() => parseRange('ontem', 'hoje'), /periodo invalido/);
  });
});
