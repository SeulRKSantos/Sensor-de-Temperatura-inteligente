const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const rep = require('../src/services/industrialReport');
const { crc32, colName } = require('../src/services/xlsx');

// Lê os arquivos de um ZIP pelo diretório central (o suficiente para conferir o .xlsx)
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    const csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const crc = buf.readUInt32LE(p + 16);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = zlib.inflateRawSync(buf.slice(off + 30 + lnl + lel, off + 30 + lnl + lel + csize));
    assert.equal(crc32(data), crc, `CRC de ${name}`);
    out[name] = data.toString('utf8');
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

describe('datas no horário de Brasília', () => {
  it('dia começa às 03:00 UTC e dura 24 h', () => {
    const d = rep.parseDay('2026-11-12');
    assert.equal(new Date(d.start).toISOString(), '2026-11-12T03:00:00.000Z');
    assert.equal(d.stop - d.start, 86400000);
  });
  it('rejeita data inexistente ou fora do formato', () => {
    for (const s of ['2026-02-30', '2026-13-01', '12/11/2026', '2026-11-1', '', null, '2026-11-12T00:00"); drop']) {
      assert.throws(() => rep.parseDay(s), /invalida/);
    }
  });
  it('mês tem o número certo de dias, inclusive dezembro e fevereiro', () => {
    assert.equal(rep.parseMonth('2026-11').days, 30);
    assert.equal(rep.parseMonth('2026-12').days, 31);
    assert.equal(rep.parseMonth('2028-02').days, 29);
    assert.throws(() => rep.parseMonth('2026-00'), /invalido/);
  });
  it('localDate converte o instante para o dia local', () => {
    assert.equal(rep.localDate(Date.parse('2026-11-12T02:59:00Z')), '2026-11-11');
    assert.equal(rep.localDate(Date.parse('2026-11-12T03:00:00Z')), '2026-11-12');
  });
});

describe('estado de cada minuto', () => {
  it('temperatura presente = ligado; sem temperatura: desligado, falha ou sem leitura', () => {
    assert.equal(rep.minuteStatus({ temperature: 80, off: 0, fault: 0 }), 'on');
    assert.equal(rep.minuteStatus({ temperature: null, off: 1, fault: 2 }), 'off');
    assert.equal(rep.minuteStatus({ temperature: null, off: 0, fault: 1 }), 'fault');
    assert.equal(rep.minuteStatus(undefined), 'none');
    // minuto em que o indicador desligou no meio: a média das leituras válidas vale
    assert.equal(rep.minuteStatus({ temperature: 75.2, off: 0.4, fault: 0.8 }), 'on');
  });
});

describe('grade de 1440 minutos', () => {
  const { start } = rep.parseDay('2026-11-12');
  const rows = [
    { t: start, sensor: 'ind-001', temperature: 50.123, off: 0, fault: 0 },              // 00:00 local
    { t: start + 61 * 60000, sensor: 'ind-001', temperature: null, off: 1, fault: 2 },    // 01:01
    { t: start + 1439 * 60000, sensor: 'ind-002', temperature: 30, off: 0, fault: 0 },    // 23:59
    { t: start - 60000, sensor: 'ind-001', temperature: 99, off: 0, fault: 0 },           // dia anterior: ignora
    { t: start, sensor: 'ind-999', temperature: 99, off: 0, fault: 0 },                   // sensor fora da lista
  ];
  const g = rep.buildMinuteGrid(rows, ['ind-001', 'ind-002'], start);
  it('posiciona cada leitura no minuto local certo', () => {
    assert.equal(g['ind-001'].length, 1440);
    assert.deepEqual(g['ind-001'][0], { temp: 50.12, status: 'on' });
    assert.deepEqual(g['ind-001'][61], { temp: null, status: 'off' });
    assert.deepEqual(g['ind-002'][1439], { temp: 30, status: 'on' });
    assert.equal(g['ind-001'][1].status, 'none');
    assert.equal(g['ind-999'], undefined);
  });
  it('resumo conta os minutos de cada estado e o tempo acima do limite', () => {
    const m = rep.summarize(g['ind-001'], 40);
    assert.equal(m.measuring, 1); assert.equal(m.off, 1); assert.equal(m.withReading, 2);
    assert.equal(m.min, 50.12); assert.equal(m.max, 50.12); assert.equal(m.above, 1);
    assert.equal(rep.summarize(g['ind-002'], null).above, null);
  });
});

describe('arquivo .xlsx do dia', () => {
  const { start } = rep.parseDay('2026-11-12');
  const rows = Array.from({ length: 1440 }, (_, i) => ({ t: start + i * 60000, sensor: 'ind-001', temperature: i < 600 ? null : 60 + i / 100, off: i < 600 ? 1 : 0, fault: 0 }));
  const sensors = [{ id: 'ind-001', name: 'Reator <R-03> & cia', location: 'Tinturaria', tempLimit: 70 }];
  const files = unzip(rep.buildDailyWorkbook({ day: '2026-11-12', sensors, grid: rep.buildMinuteGrid(rows, ['ind-001'], start) }));

  it('tem as duas planilhas, o desenho e o gráfico ligados entre si', () => {
    for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
      'xl/worksheets/_rels/sheet2.xml.rels', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/charts/chart1.xml']) {
      assert.ok(files[f], `falta ${f}`);
    }
    assert.match(files['xl/workbook.xml'], /<sheet name="Minuto a minuto" sheetId="1"/);
    assert.match(files['xl/workbook.xml'], /<sheet name="Gráfico" sheetId="2"/);
    assert.match(files['xl/worksheets/sheet2.xml'], /<drawing r:id="rId1"\/>/);
    assert.doesNotMatch(files['xl/worksheets/sheet1.xml'], /<drawing/);
  });
  it('planilha 1 tem 1440 linhas de minuto e escapa o nome do sensor', () => {
    const s1 = files['xl/worksheets/sheet1.xml'];
    assert.match(s1, /<c r="A6" t="inlineStr"><is><t xml:space="preserve">00:00<\/t>/);
    assert.match(s1, /<c r="A1445" t="inlineStr"><is><t xml:space="preserve">23:59<\/t>/);
    assert.match(s1, /Reator &lt;R-03&gt; &amp; cia \(°C\)/);
    assert.match(s1, /Indicador Therma desligado/);
    assert.match(s1, /<pane ySplit="5"/);
  });
  it('gráfico aponta para as colunas de horário, temperatura e limite', () => {
    const c = files['xl/charts/chart1.xml'];
    assert.match(c, /<c:f>'Minuto a minuto'!\$A\$6:\$A\$1445<\/c:f>/);
    assert.match(c, /<c:f>'Minuto a minuto'!\$B\$6:\$B\$1445<\/c:f>/);
    assert.match(c, /<c:f>'Minuto a minuto'!\$D\$6:\$D\$1445<\/c:f>/);
    assert.match(c, /<c:dispBlanksAs val="gap"\/>/);
    assert.equal((c.match(/<c:ser>/g) || []).length, 2);   // sensor + limite
  });
  it('colName cobre além da coluna Z', () => {
    assert.equal(colName(0), 'A'); assert.equal(colName(25), 'Z'); assert.equal(colName(26), 'AA'); assert.equal(colName(52), 'BA');
  });
});
