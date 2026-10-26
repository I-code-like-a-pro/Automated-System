'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LocalDB = require('../public/localdb.js');

/* a stand-in for window.localStorage */
function fakeStorage(init = {}, quota = Infinity) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if ([...m.values()].join('').length + String(v).length > quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }, key: i => [...m.keys()][i] || null, get length() { return m.size; }, _m: m,
  };
}
const rec = (id, taskId, score) => ({ id, taskId, score, issuedAt: '2026-01-01T00:00:0' + id.slice(-1) + 'Z', taskTitle: taskId });

test('a new person gets a private key that survives reopening', () => {
  const s = fakeStorage();
  const a = LocalDB.open(s), key = a.meta.ownerKey();
  assert.match(key, /^[a-f0-9]{48}$/);
  assert.equal(LocalDB.open(s).meta.ownerKey(), key, 'same browser, same key');
  assert.notEqual(LocalDB.open(fakeStorage()).meta.ownerKey(), key, 'different browser, different key');
});

test('profile is stored, merged and cleared', () => {
  const db = LocalDB.open(fakeStorage());
  assert.equal(db.profile.get(), null);
  db.profile.set({ name: 'Ada', major: 'CS' }); db.profile.set({ year: '2026' });
  const p = db.profile.get(); assert.equal(p.name, 'Ada'); assert.equal(p.year, '2026'); assert.ok(p.createdAt);
  db.profile.clear(); assert.equal(db.profile.get(), null);
});

test('evidence keeps only the best score per task', () => {
  const db = LocalDB.open(fakeStorage());
  assert.equal(db.evidence.put(rec('ev_1', 'fizz', 70)), 'added');
  assert.equal(db.evidence.put(rec('ev_2', 'fizz', 60)), 'kept');
  assert.equal(db.evidence.put(rec('ev_3', 'fizz', 90)), 'replaced');
  db.evidence.put(rec('ev_4', 'slug', 80));
  assert.equal(db.evidence.list().length, 2);
  assert.deepEqual(db.evidence.bestByTask(), { fizz: 90, slug: 80 });
  assert.equal(db.evidence.get('ev_3').score, 90); assert.equal(db.evidence.get('ev_1'), null);
});

test('drafts, queue and cache round-trip', () => {
  const s = fakeStorage(), db = LocalDB.open(s);
  db.drafts.set('t1', 'half an answer'); assert.equal(LocalDB.open(s).drafts.get('t1'), 'half an answer');
  db.drafts.clear('t1'); assert.equal(db.drafts.get('t1'), '');
  db.queue.push({ taskId: 'a' }); db.queue.push({ taskId: 'b' }); assert.equal(LocalDB.open(s).queue.list().length, 2);
  db.queue.setAll([]); assert.equal(db.queue.list().length, 0);
  db.cache.set('tasks', [1, 2]); assert.deepEqual(db.cache.get('tasks'), [1, 2]); assert.equal(db.cache.get('nope', 'x'), 'x');
});

test('backup and restore move a person to a new browser, keeping their key', () => {
  const old = LocalDB.open(fakeStorage());
  old.profile.set({ name: 'Grace', coursework: 'Git workshop' }); old.evidence.put(rec('ev_1', 'fizz', 100));
  const file = JSON.parse(JSON.stringify(old.export()));
  assert.equal(file.ownerKey, old.meta.ownerKey());

  const fresh = LocalDB.open(fakeStorage());
  const parsed = fresh.parseBackup(file);
  assert.equal(fresh.restore(parsed), 1);
  assert.equal(fresh.meta.ownerKey(), old.meta.ownerKey(), 'ownership of server-side records carries over');
  assert.equal(fresh.profile.get().name, 'Grace');
  assert.throws(() => fresh.parseBackup({ app: 'other' }), /not a SkillBridge backup/);
  assert.throws(() => fresh.parseBackup({ app: 'skillbridge', ownerKey: '<script>' }), /invalid key/);
});

test('a full or blocked storage never throws, and wiping resets everything', () => {
  const full = LocalDB.open(fakeStorage({}, 200));
  assert.equal(full.profile.set({ name: 'x'.repeat(500) }), false);
  assert.match(full.lastError, /full/);
  const blocked = LocalDB.open({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {}, key: () => null, length: 0 });
  assert.equal(blocked.persistent, false); blocked.profile.set({ name: 'still works in memory' });

  const s = fakeStorage(), db = LocalDB.open(s), key = db.meta.ownerKey();
  db.profile.set({ name: 'A' }); db.evidence.put(rec('ev_1', 't', 80)); db.wipe();
  assert.equal(db.profile.get(), null); assert.equal(db.evidence.list().length, 0); assert.notEqual(db.meta.ownerKey(), key, 'a wipe also rotates the key');
});

test('legacy keys from earlier prototypes (with login tokens) are removed', () => {
  const s = fakeStorage({ 'sb.token': '"sb_old"', 'sb.me': '{}', 'sb.draft.x': '"d"', other: 'keep' });
  LocalDB.open(s);
  assert.equal(s.getItem('sb.token'), null); assert.equal(s.getItem('sb.me'), null); assert.equal(s.getItem('other'), 'keep');
});
