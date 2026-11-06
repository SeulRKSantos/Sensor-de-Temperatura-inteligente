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

  it('sem sinal abaixo de 0,05 V, mas com temperatura', () => {
    const r = convert(16);                // 0 V
    assert.equal(r.fault, FAULT.NO_SIGNAL);
    assert.equal(r.temperature, 0);
  });

  it('lowV = 0 desativa o "sem sinal"', () => {
    assert.equal(convert(16, { lowV: 0 }).fault, FAULT.NONE);
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
});
