/* LocalDB: each person's own database, kept in their browser's localStorage (UMD: runs in the browser and in Node for tests).
   It stores what is personal and should never need a server: profile, coursework, the person's copy of their evidence, drafts,
   the offline queue and caches. It also holds a random private key that links this person to their records in the server's
   shared registry (the server only ever sees the key's hash). Tables:
     meta      { schema, ownerKey, createdAt, lastBackup }
     profile   { name, major, year, role, coursework, createdAt }
     evidence  [signed records issued by the server]  (best score per task)
     queue     [submissions made offline, waiting to be graded]
     drafts    { taskId: text }
     cache     { key: value }  (task list, roles)
   If localStorage is blocked (some private modes) it falls back to memory and reports persistent === false. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LocalDB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PREFIX = 'sb:', SCHEMA = 2;

  function randomKey() {
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('node:crypto').webcrypto;
    return Array.from(c.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  }
  function memoryStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => [...m.keys()][i] || null, get length() { return m.size; } }; }

  function open(storage) {
    let persistent = true;
    if (!storage) { try { storage = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { storage = null; } }
    try { storage.setItem(PREFIX + 'probe', '1'); storage.removeItem(PREFIX + 'probe'); } catch (e) { storage = null; }   // blocked or full: fall back to memory
    if (!storage) { storage = memoryStorage(); persistent = false; }
    const api = { persistent, lastError: null };

    const read = (name, fallback) => { try { const v = storage.getItem(PREFIX + name); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
    const write = (name, value) => { try { storage.setItem(PREFIX + name, JSON.stringify(value)); api.lastError = null; return true; } catch (e) { api.lastError = e && e.name === 'QuotaExceededError' ? 'Storage is full' : String(e && e.message || e); return false; } };
    const remove = name => { try { storage.removeItem(PREFIX + name); } catch (e) { /* ignore */ } };

    /* tidy up keys written by earlier prototypes (they used "sb." and held a server login token) */
    try { for (let i = (storage.length || 0) - 1; i >= 0; i--) { const k = storage.key(i); if (k && k.startsWith('sb.')) storage.removeItem(k); } } catch (e) { /* ignore */ }

    /* meta: schema version and the private owner key */
    let meta = read('meta', null);
    if (!meta || !meta.ownerKey) { meta = { schema: SCHEMA, ownerKey: randomKey(), createdAt: new Date().toISOString(), lastBackup: null }; write('meta', meta); }
    api.meta = { get: () => ({ ...meta }), ownerKey: () => meta.ownerKey, markBackup() { meta.lastBackup = new Date().toISOString(); write('meta', meta); }, setOwnerKey(k) { meta.ownerKey = k; write('meta', meta); } };

    api.profile = {
      get: () => read('profile', null),
      set(p) { return write('profile', { ...(read('profile', {}) || {}), ...p, createdAt: (read('profile', {}) || {}).createdAt || new Date().toISOString() }); },
      clear: () => remove('profile'),
    };

    const bestOnly = list => { const best = {}; list.forEach(e => { if (!best[e.taskId] || e.score > best[e.taskId].score) best[e.taskId] = e; }); return Object.values(best); };
    api.evidence = {
      list: () => read('evidence', []).slice().sort((a, b) => (b.issuedAt > a.issuedAt ? 1 : -1)),
      get: id => read('evidence', []).find(e => e.id === id) || null,
      /* keeps only the best score per task. returns 'added' | 'replaced' | 'kept' */
      put(rec) {
        const list = read('evidence', []), i = list.findIndex(e => e.taskId === rec.taskId);
        if (i >= 0 && list[i].score >= rec.score) return 'kept';
        if (i >= 0) { list[i] = rec; write('evidence', list); return 'replaced'; }
        list.push(rec); write('evidence', list); return 'added';
      },
      replaceAll: list => write('evidence', bestOnly(list)),
      remove(id) { write('evidence', read('evidence', []).filter(e => e.id !== id)); },
      bestByTask() { const b = {}; read('evidence', []).forEach(e => { b[e.taskId] = e.score; }); return b; },
    };

    api.queue = { list: () => read('queue', []), push(item) { const q = read('queue', []); q.push(item); return write('queue', q); }, setAll: list => write('queue', list) };

    api.drafts = {
      get: id => (read('drafts', {}) || {})[id] || '',
      set(id, text) { const d = read('drafts', {}) || {}; d[id] = text; return write('drafts', d); },
      clear(id) { const d = read('drafts', {}) || {}; delete d[id]; write('drafts', d); },
    };

    api.cache = { get: (k, fallback = null) => (read('cache', {}) || {})[k] ?? fallback, set(k, v) { const c = read('cache', {}) || {}; c[k] = v; return write('cache', c); } };

    /* backup file: everything that is personal, including the private key (so a restore on a new device keeps ownership) */
    api.export = () => ({ app: 'skillbridge', schema: SCHEMA, exportedAt: new Date().toISOString(), ownerKey: meta.ownerKey, profile: api.profile.get(), evidence: api.evidence.list() });
    /* validate the shape of a backup. Signatures are checked by the caller (via the server) before records are imported. */
    api.parseBackup = obj => {
      if (!obj || obj.app !== 'skillbridge') throw new Error('This is not a SkillBridge backup file');
      if (obj.ownerKey != null && !/^[a-f0-9]{32,64}$/.test(obj.ownerKey)) throw new Error('The backup has an invalid key');
      return { ownerKey: obj.ownerKey || null, profile: obj.profile && typeof obj.profile === 'object' ? obj.profile : null, evidence: Array.isArray(obj.evidence) ? obj.evidence : [] };
    };
    api.restore = ({ ownerKey, profile, evidence }) => {
      if (ownerKey) api.meta.setOwnerKey(ownerKey);
      if (profile) write('profile', profile);
      const merged = bestOnly(read('evidence', []).concat(evidence || [])); write('evidence', merged);
      return merged.length;
    };

    api.wipe = () => { ['meta', 'profile', 'evidence', 'queue', 'drafts', 'cache'].forEach(remove); meta = { schema: SCHEMA, ownerKey: randomKey(), createdAt: new Date().toISOString(), lastBackup: null }; write('meta', meta); };
    api.usageBytes = () => { let n = 0; ['meta', 'profile', 'evidence', 'queue', 'drafts', 'cache'].forEach(k => { try { n += (storage.getItem(PREFIX + k) || '').length; } catch (e) { /* ignore */ } }); return n; };
    return api;
  }
  return { open, SCHEMA };
});
