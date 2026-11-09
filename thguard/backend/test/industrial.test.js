const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { convert, validate, DEFAULTS, FAULT } = require('../src/services/industrial');

// Cadeia do VA01: T -> V_tx = T/150*10 -> pino = V_tx/5 -> o ADC le pino + 16 mV
const mvFor = (t, max = 150) => (t / max) * 10 / 5 * 1000 + 16;

describe('convert (padrao VA01: 0-150 °C, -16 mV, 5:1)', () => {
  it('24 °C -> 1,6 V no transmissor', () => {
    const r = convert(mvFor(24));
    assert.equal(r.temperature, 24);
    assert.equal(r.voltage, 1.6);
    assert.equal(r.fault, FAULT.NONE);
  });

  it('fundo de escala: 150 °C em 10 V', () => {
    const r = convert(mvFor(150));
    assert.equal(r.temperature, 150);
    assert.equal(r.voltage, 10);
  });

  it('nova faixa vale sem mudar o mV (0-40 °C)', () => {
    const r = convert(mvFor(24, 40), { ...DEFAULTS, rangeMax: 40 });
    assert.equal(r.temperature, 24);
  });

  it('offset de temperatura e ganho', () => {
    assert.equal(convert(mvFor(24), { offsetTemp: 0.5 }).temperature, 24.5);
    assert.equal(convert(mvFor(30), { gain: 1.1 }).voltage, 2.2);
  });

  it('upscale acima de 10,5 V: sem temperatura', () => {
    const r = convert(2316);              // 11,5 V
    assert.equal(r.fault, FAULT.UPSCALE);
    assert.equal(r.faultLabel, 'upscale');
    assert.equal(r.temperature, null);
  });

  it('area morta: abaixo de 0,75 V = indicador Therma desligado, sem temperatura', () => {
    const r = convert(16 + 120);          // 0,6 V (tensao residual do pino)
    assert.equal(r.fault, FAULT.INDICATOR_OFF);
    assert.equal(r.faultLabel, 'indicator_off');
    assert.equal(r.off, true);
    assert.equal(r.temperature, null);
    assert.equal(r.voltage, 0.6);
  });

  it('0,75 V ou mais = ligado', () => {
    const r = convert(16 + 150);          // 0,75 V
    assert.equal(r.off, false);
    assert.equal(r.temperature, 11.25);
  });

  it('histerese: estando desligado, so religa acima de 0,80 V', () => {
    assert.equal(convert(16 + 156, DEFAULTS, true).off, true);    // 0,78 V
    assert.equal(convert(16 + 160, DEFAULTS, true).off, false);   // 0,80 V
  });

  it('offV = 0 desativa a area morta', () => {
    assert.equal(convert(16, { offV: 0 }).fault, FAULT.NONE);
  });
});

describe('validate', () => {
  it('aceita e normaliza valores do painel', () => {
    const v = validate({ rangeMax: '120', interval: '10.4' });
    assert.equal(v.ok, true);
    assert.deepEqual(v.value, { rangeMax: 120, interval: 10 });
  });

  it('ignora campos vazios', () => {
    const v = validate({ rangeMax: '', gain: null });
    assert.equal(v.ok, true);
    assert.deepEqual(v.value, {});
  });

  it('rejeita faixa invertida considerando o valor atual', () => {
    assert.equal(validate({ rangeMax: 40 }, { ...DEFAULTS, rangeMin: 50 }).ok, false);
  });

  it('rejeita fora dos limites e nao numericos', () => {
    assert.equal(validate({ interval: 1 }).ok, false);
    assert.equal(validate({ gain: 2 }).ok, false);
    assert.equal(validate({ divisor: 'abc' }).ok, false);
  });

  it('rejeita limiar de falha abaixo do fundo de escala', () => {
    assert.equal(validate({ faultV: 8 }).ok, false);
  });

  it('area morta: aceita 0-5 V abaixo da metade da escala', () => {
    assert.equal(validate({ offV: 1.2 }).ok, true);
    assert.equal(validate({ offV: 6 }).ok, false);
  });
});

describe('CSV com o estado do indicador Therma', () => {
  const { offStatus, rowsToCSV } = require('../src/services/influx');

  it('texto por fracao desligada', () => {
    assert.equal(offStatus(0, true), 'Ligado');
    assert.equal(offStatus(null, true), 'Ligado');
    assert.equal(offStatus(1, false), 'Indicador Therma desligado');
    assert.equal(offStatus(0.25, true), 'Indicador Therma desligado 25% do periodo');
  });

  it('relatorio industrial tem a coluna; DHT nao', () => {
    const rows = [{ ts: '09/11 10:00', temperature: '', voltage: '0.420', status: 'Indicador Therma desligado' }];
    const ind = rowsToCSV(rows, 'daily', 'ind-001').split('\r\n');
    assert.match(ind[0], /;Indicador Therma$/);
    assert.equal(ind[1], '09/11 10:00;;0.420;Indicador Therma desligado');
    const dht = rowsToCSV([{ ts: 'x', temperature: '24.00', humidity: '60.00' }], 'daily', 'sensor-001');
    assert.doesNotMatch(dht, /Therma/);
  });
});
