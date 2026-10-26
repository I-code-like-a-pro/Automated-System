/* Portable evidence: pack signed records into a short string that can live in a link's #fragment, a file, or a QR code.
   With no database, the evidence itself is what travels. A fragment is never sent to any server, so sharing a link
   reveals nothing to us; the verifier's browser sends the records to /api/verify only to check their signatures.
   Works in the browser and in Node (for tests). Compresses with gzip when the platform supports it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Share = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const toB64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Blob === 'function';

  /* records -> "z.<gzip+base64url>" (or "j.<base64url>" when gzip is unavailable) */
  async function encode(records) {
    const json = new TextEncoder().encode(JSON.stringify({ v: 2, records }));
    if (canCompress()) { try { return 'z.' + toB64u(await pipe(json, new CompressionStream('gzip'))); } catch (e) { /* fall through */ } }
    return 'j.' + toB64u(json);
  }

  /* any of: a bare payload, a full link, a "#d=payload" fragment, or the JSON of a portfolio/backup file -> array of records */
  async function decode(input) {
    let s = String(input || '').trim();
    if (!s) throw new Error('Nothing to check');
    if (s[0] === '{' || s[0] === '[') {                              // pasted file contents
      const obj = JSON.parse(s);
      return Array.isArray(obj) ? obj : Array.isArray(obj.records) ? obj.records : Array.isArray(obj.evidence) ? obj.evidence : [obj];
    }
    const m = /[#&]d=([A-Za-z0-9_.-]+)/.exec(s); if (m) s = m[1];
    const kind = s.slice(0, 2), data = s.slice(2);
    if (kind !== 'z.' && kind !== 'j.') throw new Error('This does not look like a SkillBridge link');
    let bytes = fromB64u(data);
    if (kind === 'z.') { if (!canCompress()) throw new Error('This browser cannot open compressed links'); bytes = await pipe(bytes, new DecompressionStream('gzip')); }
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!obj || !Array.isArray(obj.records)) throw new Error('This link has no evidence in it');
    return obj.records;
  }

  /* a portfolio / backup file is plain JSON (readable, and no need for gzip) */
  const fileJson = (records, profile) => JSON.stringify({ app: 'skillbridge', version: 2, exportedAt: new Date().toISOString(), profile: profile || undefined, records }, null, 2);

  return { encode, decode, fileJson };
});
