const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSensorId, sanitizeRange } = require('../src/services/influx');

describe('sanitizeSensorId', () => {
  it('aceita IDs validos', () => {
    assert.equal(sanitizeSensorId('sensor-001'), 'sensor-001');
    assert.equal(sanitizeSensorId('sensor_002'), 'sensor_002');
    assert.equal(sanitizeSensorId('ABC123'), 'ABC123');
  });

  it('rejeita string vazia', () => {
    assert.throws(() => sanitizeSensorId(''), /invalido/);
  });

  it('rejeita ID com mais de 50 caracteres', () => {
    assert.throws(() => sanitizeSensorId('a'.repeat(51)), /invalido/);
  });

  it('rejeita caracteres especiais / injecao', () => {
    assert.throws(() => sanitizeSensorId('"); drop'), /invalido/);
    assert.throws(() => sanitizeSensorId('sensor 001'), /invalido/);
    assert.throws(() => sanitizeSensorId('sensor/001'), /invalido/);
  });

  it('rejeita tipo nao-string', () => {
    assert.throws(() => sanitizeSensorId(123), /invalido/);
    assert.throws(() => sanitizeSensorId(null), /invalido/);
  });
});

describe('sanitizeRange', () => {
  it('aceita ranges da whitelist', () => {
    const valid = ['1h', '6h', '24h', '168h', '720h', '4320h', '8760h'];
    for (const r of valid) {
      assert.equal(sanitizeRange(r), r);
    }
  });

  it('rejeita ranges fora da whitelist', () => {
    assert.throws(() => sanitizeRange('2h'), /invalido/);
    assert.throws(() => sanitizeRange('999h'), /invalido/);
    assert.throws(() => sanitizeRange(''), /invalido/);
    assert.throws(() => sanitizeRange('1h; drop'), /invalido/);
  });
});
