const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thguard-fw-'));
process.env.FIRMWARE_DIR = path.join(tmp, 'firmware');
const fw = require('../src/services/firmware');

// Imagem mínima de app do ESP32: cabeçalho 0xE9, chip 0, esp_app_desc_t e a marca
function image({ magic = 0xE9, chip = 0, appDesc = true, mark = 'THGUARD-FW|model=VA01|ver=va01-1.2.0|', size = 8192 } = {}) {
  const b = Buffer.alloc(size, 0xAA);
  b[0] = magic;
  b.writeUInt16LE(chip, 12);
  b.writeUInt32LE(appDesc ? 0xABCD5432 : 0x12345678, 32);
  if (mark) b.write(mark, 2000, 'latin1');
  return b;
}

describe('firmware: conferência do .bin enviado', () => {
  it('aceita a imagem do VA01 e lê modelo, versão e SHA-256', () => {
    const b = image();
    const r = fw.inspect(b);
    assert.equal(r.model, 'VA01');
    assert.equal(r.version, 'va01-1.2.0');
    assert.equal(r.size, b.length);
    assert.equal(r.sha256, crypto.createHash('sha256').update(b).digest('hex'));
  });
  it('recusa merged, bootloader, outro chip, sem marca, versão sem OTA e tamanho errado', () => {
    assert.throws(() => fw.inspect(image({ magic: 0xFF })), /ino\.bin/);                 // merged começa em 0xFF
    assert.throws(() => fw.inspect(image({ appDesc: false })), /bootloader/);
    assert.throws(() => fw.inspect(image({ chip: 9 })), /outro chip/);
    assert.throws(() => fw.inspect(image({ mark: null })), /marca do TH-GUARD/);
    assert.throws(() => fw.inspect(image({ mark: 'THGUARD-FW|model=VA01|ver=va01-1.1.0|' })), /não aceita atualização/);
    assert.throws(() => fw.inspect(image({ mark: 'THGUARD-FW|model=XPTO|ver=xpto-9.0.0|' })), /XPTO ainda não tem/);
    assert.throws(() => fw.inspect(image({ size: fw.MAX_SIZE + 1 })), /maior que a partição/);
    assert.throws(() => fw.inspect(Buffer.alloc(100)), /pequeno/);
    assert.throws(() => fw.inspect(undefined), /Envie o arquivo/);
  });
  it('confere o firmware compilado de verdade, quando FW_TEST_BIN aponta para ele', { skip: !process.env.FW_TEST_BIN }, () => {
    const r = fw.inspect(fs.readFileSync(process.env.FW_TEST_BIN));
    assert.equal(r.model, 'VA01');
    assert.match(r.version, /^va01-\d+\.\d+\.\d+$/);
  });
});

describe('firmware: versões', () => {
  it('compara versões e sabe quem aceita OTA', () => {
    assert.equal(fw.cmpVersion('va01-1.2.0', 'va01-1.10.0'), -1);
    assert.equal(fw.cmpVersion('va01-2.0.0', 'va01-1.9.9'), 1);
    assert.equal(fw.cmpVersion('va01-1.2.0', 'va01-1.2.0'), 0);
    assert.equal(fw.cmpVersion('x', 'va01-1.2.0'), null);
    assert.equal(fw.supportsOta('VA01', 'va01-1.2.0'), true);
    assert.equal(fw.supportsOta('va01', 'va01-1.3.1'), true);
    assert.equal(fw.supportsOta('VA01', 'va01-1.1.0'), false);
    assert.equal(fw.supportsOta('VA01', null), false);
    assert.equal(fw.supportsOta('VA01', 'thguard-9.9.9'), false);
    assert.equal(fw.supportsOta(null, 'va01-1.2.0'), false);
  });
});

describe('firmware: assinatura', () => {
  it('cria a chave uma vez, com permissão só do dono, e a reutiliza', async () => {
    fw._resetKeyCache();
    const k1 = await fw.publicKey();
    const file = path.join(process.env.FIRMWARE_DIR, 'ota-assinatura.key');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fw._resetKeyCache();
    const k2 = await fw.publicKey();
    assert.equal(k1.pem, k2.pem);
    assert.match(k1.macro, /^#define OTA_PUBKEY \\\n {2}"-----BEGIN PUBLIC KEY-----\\n" \\\n/);
    assert.match(k1.macro, /"-----END PUBLIC KEY-----\\n"\n$/);
  });
  it('a assinatura confere com a chave pública e falha se o arquivo mudar', async () => {
    const b = image();
    const sig = Buffer.from(await fw.sign(b), 'base64');
    const { pem } = await fw.publicKey();
    assert.equal(sig[0], 0x30, 'assinatura em DER, o formato que o mbedtls do ESP lê');
    assert.ok(crypto.verify('sha256', b, pem, sig));
    const outro = Buffer.from(b); outro[5000] ^= 1;
    assert.ok(!crypto.verify('sha256', outro, pem, sig));
  });
  it('guarda o arquivo sem deixar sair da pasta', async () => {
    const b = image();
    const info = fw.inspect(b);
    const filename = await fw.store(b, info);
    assert.match(filename, /^VA01-va01-1\.2\.0-[0-9a-f]{8}\.bin$/);
    assert.deepEqual(await fw.read({ filename }), b);
    assert.throws(() => fw.fileFor({ filename: '../ota-assinatura.key' }), /inválido/);
    await fw.unlink({ filename });
    assert.ok(!fs.existsSync(path.join(process.env.FIRMWARE_DIR, filename)));
  });
});
