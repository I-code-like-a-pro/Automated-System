'use strict';
/* Tamper-evident evidence signed with Ed25519 (public-key signatures).
   The server holds the private key and signs; anyone can verify with the published PUBLIC key at /.well-known/skillbridge-keys.json,
   in their own browser, even offline (public/verifier.js). Nobody but the issuer can create a valid record. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const canonical = require('../public/canonical.js');

const b64u = buf => Buffer.from(buf).toString('base64url');
const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const randomId = (prefix, bytes = 8) => prefix + crypto.randomBytes(bytes).toString('hex');

/* the signing key lives in data/signing-key.pem (mode 0600), or in the SIGNING_KEY_PEM environment variable.
   BACK IT UP: if it is lost, new records get a new key and old records can still be verified only if the old public key is kept
   (retired public keys go in data/retired-keys/*.json as the same {keyId, jwk} objects the keys endpoint publishes). */
function loadKeys(dataDir) {
  let pem = process.env.SIGNING_KEY_PEM, file = path.join(dataDir, 'signing-key.pem');
  if (!pem) { try { pem = fs.readFileSync(file, 'utf8'); } catch (e) { /* first run */ } }
  let privateKey;
  if (pem) privateKey = crypto.createPrivateKey(pem);
  else {
    privateKey = crypto.generateKeyPairSync('ed25519').privateKey;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' }), keyId = sha256(jwk.x).slice(0, 16);
  const published = [{ keyId, alg: 'Ed25519', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, status: 'active' }];
  try {                                                                  // retired public keys keep old evidence verifiable
    const dir = path.join(dataDir, 'retired-keys');
    fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => { const k = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (k.keyId && k.jwk) published.push({ keyId: k.keyId, alg: 'Ed25519', jwk: k.jwk, status: 'retired' }); });
  } catch (e) { /* no retired keys */ }
  const publicKeys = Object.fromEntries(published.map(k => [k.keyId, crypto.createPublicKey({ key: k.jwk, format: 'jwk' })]));
  return { privateKey, keyId, publicKeys, document: { issuer: 'SkillBridge', keys: published } };
}

/* returns a copy of the record with `alg`, `keyId` (both signed) and `signature` */
function sign(keys, record) {
  const { signature, ...rest } = record, body = { ...rest, alg: 'Ed25519', keyId: keys.keyId };
  return { ...body, signature: b64u(crypto.sign(null, Buffer.from(canonical(body)), keys.privateKey)) };
}
function verify(keys, record) {
  if (!record || typeof record !== 'object' || typeof record.signature !== 'string' || record.alg !== 'Ed25519') return false;
  const pub = keys.publicKeys[record.keyId]; if (!pub) return false;
  const { signature, ...body } = record;
  try { return crypto.verify(null, Buffer.from(canonical(body)), pub, Buffer.from(signature, 'base64url')); } catch (e) { return false; }
}
module.exports = { canonical, loadKeys, sign, verify, sha256, randomId };
