/* In-browser verification of SkillBridge evidence with the issuer's PUBLIC key (Ed25519 via WebCrypto).
   No secret is involved and no server call is needed once the public key document has been fetched once, so an
   employer can check a portfolio file offline. Works in browsers that support Ed25519 in WebCrypto and in Node 20+. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./canonical.js')); else root.Verifier = factory(root.Canonical);
})(typeof self !== 'undefined' ? self : this, function (canonical) {
  'use strict';
  const fromB64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const keyCache = new Map();

  /* null = this browser cannot verify Ed25519 (fall back to the server), true/false = result of the check */
  async function verify(record, keysDoc) {
    const sub = subtle();
    if (!sub || !record || typeof record.signature !== 'string' || !record.keyId || !keysDoc || !Array.isArray(keysDoc.keys)) return sub ? false : null;
    const entry = keysDoc.keys.find(k => k.keyId === record.keyId);
    if (!entry) return false;                                           // signed by a key this issuer does not publish
    try {
      let key = keyCache.get(entry.keyId);
      if (!key) { key = await sub.importKey('jwk', entry.jwk, { name: 'Ed25519' }, false, ['verify']); keyCache.set(entry.keyId, key); }
      const { signature, ...body } = record;
      return await sub.verify('Ed25519', key, fromB64u(signature), new TextEncoder().encode(canonical(body)));
    } catch (e) {
      return /not supported|unrecognized|algorithm/i.test(String(e && e.message)) ? null : false;
    }
  }
  return { verify };
});
