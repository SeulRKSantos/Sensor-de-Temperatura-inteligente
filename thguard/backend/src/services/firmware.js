// Firmwares para a atualização pela rede (OTA) dos sensores.
//
// O .bin enviado pelo painel é conferido (imagem de app do ESP32 + marca TH-GUARD
// com modelo e versão) e guardado em FIRMWARE_DIR. Na hora de atualizar, o backend
// assina o SHA-256 do arquivo com uma chave ECDSA P-256 que só existe no servidor;
// o ESP só instala se a assinatura bater com a chave pública gravada nele
// (OTA_PUBKEY no secrets.h). Quem tiver só a senha do MQTT não consegue gravar
// um firmware próprio nos sensores.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./files');

const dir = () => path.resolve(process.env.FIRMWARE_DIR || path.join(DATA_DIR, 'firmware'));
const keyFile = () => path.join(dir(), 'ota-assinatura.key');
const MAX_SIZE = 0x140000;           // partição de app do esquema padrão do ESP32 (1,25 MB)
// Primeira versão de cada modelo que aceita OTA (antes dela, só por USB)
const OTA_MIN = { VA01: 'va01-1.2.0' };

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// "va01-1.2.0" -> [1, 2, 0]
function parseVersion(v) {
  const m = /(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function cmpVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function supportsOta(model, fw) {
  const min = OTA_MIN[String(model || '').toUpperCase()];
  if (!min || !fw) return false;
  const prefix = min.split('-')[0];
  if (!String(fw).toLowerCase().startsWith(prefix + '-')) return false;
  const c = cmpVersion(fw, min);
  return c !== null && c >= 0;
}

// Confere o .bin e devolve modelo, versão, tamanho e SHA-256
function inspect(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw bad('Envie o arquivo .bin do firmware.');
  if (buf.length < 4096) throw bad('Arquivo pequeno demais para ser um firmware.');
  if (buf.length > MAX_SIZE) throw bad(`Firmware maior que a partição do ESP32 (${(buf.length / 1048576).toFixed(2)} MB; máximo 1,25 MB).`);
  if (buf[0] !== 0xE9) {
    throw bad('Não é a imagem do programa do ESP32. Envie o arquivo "<sketch>.ino.bin" (não o merged, bootloader ou partitions).');
  }
  if (buf.readUInt16LE(12) !== 0) throw bad('Firmware compilado para outro chip (o VA01 usa ESP32).');
  // esp_app_desc_t logo depois do primeiro segmento: separa o app do bootloader
  if (buf.readUInt32LE(32) !== 0xABCD5432) {
    throw bad('Não é a imagem do programa do ESP32 (parece bootloader ou outro arquivo). Envie o "<sketch>.ino.bin".');
  }
  const m = /THGUARD-FW\|model=([A-Za-z0-9_-]{1,20})\|ver=([A-Za-z0-9._-]{1,30})\|/.exec(buf.toString('latin1'));
  if (!m) throw bad('O arquivo não tem a marca do TH-GUARD (firmware antigo, sem OTA, ou de outro projeto).');
  const model = m[1].toUpperCase(), version = m[2];
  if (!OTA_MIN[model]) throw bad(`Modelo ${model} ainda não tem atualização pela rede.`);
  if (!supportsOta(model, version)) throw bad(`A versão ${version} não aceita atualização pela rede (mínimo ${OTA_MIN[model]}).`);
  return { model, version, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

// Chave de assinatura: criada na primeira vez e guardada só no servidor (0600)
let keyCache = null;
async function signingKey() {
  if (keyCache) return keyCache;
  await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
  let pem;
  try { pem = await fsp.readFile(keyFile(), 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    try {
      await fsp.writeFile(keyFile(), pem, { mode: 0o600, flag: 'wx' });
      console.log(`[OTA] Chave de assinatura criada em ${keyFile()}. Faça backup dela: sem ela, os sensores só aceitam firmware por USB.`);
    } catch (w) {
      if (w.code !== 'EEXIST') throw w;
      pem = await fsp.readFile(keyFile(), 'utf8');   // outra chamada criou primeiro
    }
  }
  const privateKey = crypto.createPrivateKey(pem);
  const publicPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  keyCache = { privateKey, publicPem };
  return keyCache;
}

// Linhas prontas para colar no secrets.h
function pubkeyMacro(publicPem) {
  const lines = publicPem.trim().split(/\r?\n/);
  return '#define OTA_PUBKEY \\\n' + lines.map((l) => `  "${l}\\n"`).join(' \\\n') + '\n';
}

async function publicKey() {
  const { publicPem } = await signingKey();
  return {
    pem: publicPem,
    macro: pubkeyMacro(publicPem),
    fingerprint: crypto.createHash('sha256').update(crypto.createPublicKey(publicPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16),
  };
}

// Assinatura ECDSA (DER, base64) do conteúdo; o ESP confere sobre o SHA-256
async function sign(buf) {
  const { privateKey } = await signingKey();
  return crypto.sign('sha256', buf, { key: privateKey, dsaEncoding: 'der' }).toString('base64');
}

function fileFor(fw) {
  const safe = path.basename(String(fw.filename || ''));
  if (!safe || safe !== fw.filename) throw bad('nome de arquivo de firmware inválido', 500);
  return path.join(dir(), safe);
}

async function store(buf, info) {
  await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
  const filename = `${info.model}-${info.version}-${info.sha256.slice(0, 8)}.bin`.replace(/[^A-Za-z0-9._-]/g, '_');
  const full = path.join(dir(), filename);
  const tmp = `${full}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, buf, { mode: 0o600 });
  await fsp.rename(tmp, full);
  return filename;
}

async function read(fw) { return fsp.readFile(fileFor(fw)); }
async function unlink(fw) { await fsp.unlink(fileFor(fw)).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }

function _resetKeyCache() { keyCache = null; }

module.exports = {
  inspect, store, read, unlink, fileFor, sign, publicKey, pubkeyMacro, signingKey,
  parseVersion, cmpVersion, supportsOta, OTA_MIN, MAX_SIZE, dir, _resetKeyCache,
};
