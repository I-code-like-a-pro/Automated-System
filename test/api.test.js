'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server');

const newKey = () => crypto.randomBytes(24).toString('hex');   // what the browser's LocalDB generates for each person
const tasksJson = require('../data/tasks.json');
const right = id => ({ choice: tasksJson.find(t => t.id === id).mcq.correct });
const wrong = id => { const m = tasksJson.find(t => t.id === id).mcq; return { choice: (m.correct + 1) % m.options.length }; };

async function start(dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'skillbridge-'));
  const app = createApp({ dataDir: dir });
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, url, body, key) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  };
  return { app, call, base, dir, stop: () => new Promise(r => { app.db.flushNow(); app.server.close(r); }) };
}

test('journey: practise, earn signed evidence, verify by link, share, unshare, delete', async t => {
  const s = await start(); t.after(s.stop);
  const key = newKey();

  assert.equal((await s.call('GET', '/api/health')).json.ok, true);
  const pub = (await s.call('GET', '/api/tasks')).json;
  assert.ok(pub.length >= 20);
  assert.ok(!JSON.stringify(pub).includes('"correct"'), 'the API never ships answers');

  const task = s.app.tasks.find(x => x.id === 'cart-total-off-by-one');
  const miss = await s.call('POST', '/api/submit', { taskId: task.id, answer: wrong(task.id), studentName: 'Ada Lovelace' }, key);
  assert.equal(miss.json.passed, false); assert.equal(miss.json.evidence, null);

  const right = await s.call('POST', '/api/submit', { taskId: task.id, answer: { choice: task.mcq.correct }, studentName: 'Ada Lovelace', timeSpentSec: 42 }, key);
  assert.equal(right.json.passed, true); assert.ok(right.json.evidence.signature);
  const ev = right.json.evidence;

  const again = await s.call('POST', '/api/submit', { taskId: task.id, answer: { choice: task.mcq.correct }, studentName: 'Ada Lovelace' }, key);
  assert.equal(again.json.evidence, null); assert.match(again.json.note, /already hold/);

  // an employer verifies by link, no login, no key
  const v = await s.call('GET', '/api/verify/' + ev.id);
  assert.equal(v.json.valid, true); assert.equal(v.json.evidence.studentName, 'Ada Lovelace');
  assert.equal(v.json.portfolioUrl, null, 'private until the student shares it');

  // the person can re-sync their own records, nobody else can
  assert.equal((await s.call('GET', '/api/mine', null, key)).json.evidence.length, 1);

  // sharing is opt-in and needs evidence
  assert.equal((await s.call('POST', '/api/publish', { public: true }, newKey())).status, 400, 'no evidence yet');
  assert.equal((await s.call('GET', '/api/portfolio/anything')).status, 404);
  const shared = await s.call('POST', '/api/publish', { public: true, name: 'Ada L.', major: 'Computer Science', year: '2026' }, key);
  const pid = shared.json.publicId; assert.ok(pid);
  const portfolio = (await s.call('GET', '/api/portfolio/' + pid)).json;
  assert.equal(portfolio.student.name, 'Ada L.'); assert.equal(portfolio.evidence.length, 1); assert.ok(portfolio.levels.debugging.level > 0);
  assert.equal((await s.call('GET', '/api/verify/' + ev.id)).json.portfolioUrl, '/p/' + pid);
  await s.call('POST', '/api/publish', { public: false }, key);
  assert.equal((await s.call('GET', '/api/portfolio/' + pid)).status, 404, 'unsharing hides it');

  // tampering with a stored record is detected
  s.app.db.data.evidence[ev.id].record.score = 99; s.app.db.data.evidence[ev.id].record.taskTitle = 'Forged';
  assert.equal((await s.call('GET', '/api/verify/' + ev.id)).json.valid, false);
  s.app.db.data.evidence[ev.id].record.score = ev.score; s.app.db.data.evidence[ev.id].record.taskTitle = ev.taskTitle;

  // right to be forgotten
  assert.equal((await s.call('DELETE', '/api/mine', null, key)).status, 200);
  assert.equal((await s.call('GET', '/api/verify/' + ev.id)).status, 404);
  assert.equal((await s.call('GET', '/api/mine', null, key)).json.evidence.length, 0);
});

test('people are isolated: one key cannot read, change or delete another person\'s records', async t => {
  const s = await start(); t.after(s.stop);
  const a = newKey(), b = newKey();
  const ra = await s.call('POST', '/api/submit', { taskId: 'cart-total-off-by-one', answer: right('cart-total-off-by-one'), studentName: 'A' }, a);
  assert.ok(ra.json.evidence);
  assert.equal((await s.call('GET', '/api/mine', null, b)).json.evidence.length, 0, 'B sees none of A\'s records');
  await s.call('DELETE', '/api/mine', null, b);
  assert.equal((await s.call('GET', '/api/verify/' + ra.json.evidence.id)).json.valid, true, 'B cannot delete A\'s evidence');
  const rb = await s.call('POST', '/api/submit', { taskId: 'cart-total-off-by-one', answer: right('cart-total-off-by-one'), studentName: 'B' }, b);
  assert.ok(rb.json.evidence, 'B earns their own evidence for the same task');
});

test('the server database persists across restarts and never stores the private key itself', async t => {
  const s1 = await start(); const key = newKey();
  const r = await s1.call('POST', '/api/submit', { taskId: 'sort-mutates', answer: right('sort-mutates'), studentName: 'Grace' }, key);
  await s1.stop();
  assert.ok(fs.existsSync(path.join(s1.dir, 'db.json')), 'db.json was written');
  const raw = fs.readFileSync(path.join(s1.dir, 'db.json'), 'utf8');
  assert.ok(!raw.includes(key), 'only a hash of the key is stored');
  assert.ok(raw.includes(crypto.createHash('sha256').update(key).digest('hex')));

  const s2 = await start(s1.dir); t.after(s2.stop);
  assert.equal((await s2.call('GET', '/api/verify/' + r.json.evidence.id)).json.valid, true, 'evidence survives a restart');
  assert.equal((await s2.call('GET', '/api/mine', null, key)).json.evidence.length, 1, 'and is still linked to its owner');
});

test('stateless check of a backup file: edited records are rejected', async t => {
  const s = await start(); t.after(s.stop);
  const r = await s.call('POST', '/api/submit', { taskId: 'fizzbuzz', answer: { code: "function fizzbuzz(n){ if(n%15===0) return 'FizzBuzz'; if(n%3===0) return 'Fizz'; if(n%5===0) return 'Buzz'; return String(n); }" }, studentName: 'Linus' }, newKey());
  const good = r.json.evidence, forged = { ...good, score: 100, studentName: 'Someone Else' };
  const res = await s.call('POST', '/api/verify', { records: [good, forged, { id: 'ev_x' }, null] });
  assert.deepEqual(res.json.results.map(x => x.valid), [true, false, false, false]);
  assert.equal((await s.call('POST', '/api/verify', { records: [] })).status, 400);
  assert.equal((await s.call('POST', '/api/verify', { records: Array(61).fill(good) })).status, 400);
});

test('security basics: owner key required, validation, headers, static files, removed endpoints', async t => {
  const s = await start(); t.after(s.stop);
  assert.equal((await s.call('POST', '/api/submit', { taskId: 'x', answer: {} })).status, 401, 'no key');
  assert.equal((await s.call('POST', '/api/submit', { taskId: 'x', answer: {} }, 'not-a-key')).status, 401, 'malformed key');
  assert.equal((await s.call('GET', '/api/mine')).status, 401);
  const key = newKey();
  assert.equal((await s.call('POST', '/api/submit', { taskId: 'missing', answer: {} }, key)).status, 404);
  assert.equal((await s.call('POST', '/api/submit', { taskId: 'fizzbuzz', answer: { code: '' } }, key)).status, 400);
  assert.equal((await s.call('POST', '/api/register', { name: 'A' })).status, 404, 'no accounts exist any more');
  assert.equal((await s.call('GET', '/api/me', null, key)).status, 404);
  const big = await fetch(s.base + '/api/submit', { method: 'POST', headers: { 'x-owner-key': key }, body: JSON.stringify({ taskId: 'fizzbuzz', answer: { code: 'x'.repeat(200000) } }) });
  assert.equal(big.status, 413);
  const html = await fetch(s.base + '/');
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  assert.notEqual((await fetch(s.base + '/..%2f..%2fserver.js')).status, 200, 'no path traversal');
  assert.equal((await fetch(s.base + '/data/signing-key.pem')).status, 404, 'secrets are not served');
  assert.equal((await fetch(s.base + '/lib/db.js')).status, 404, 'server code is not served');
  for (const route of ['/verify', '/verify/ev_abc', '/p/abc123']) assert.equal((await fetch(s.base + route)).status, 200, 'SPA route ' + route);
  const asset = await fetch(s.base + '/localdb.js'); assert.equal(asset.status, 200);
});

test('a code task end to end through the API', async t => {
  const s = await start(); t.after(s.stop);
  const r = await s.call('POST', '/api/submit', { taskId: 'safe-average', answer: { code: 'function average(a){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }' }, studentName: 'Grace' }, newKey());
  assert.equal(r.json.score, 100); assert.equal(r.json.evidence.graderMode, 'auto');
  assert.equal((await s.call('GET', '/api/verify/' + r.json.evidence.id)).json.valid, true);
});

test('the issuer publishes its PUBLIC key, and anyone can verify evidence offline with it', async t => {
  const s = await start(); t.after(s.stop);
  const Verifier = require('../public/verifier.js');
  const r = await s.call('POST', '/api/submit', { taskId: 'fizzbuzz', answer: { code: "function fizzbuzz(n){ if(n%15===0) return 'FizzBuzz'; if(n%3===0) return 'Fizz'; if(n%5===0) return 'Buzz'; return String(n); }" }, studentName: 'Ada' }, newKey());
  const rec = r.json.evidence;
  const doc = (await s.call('GET', '/api/keys')).json, wellKnown = (await s.call('GET', '/.well-known/skillbridge-keys.json')).json;
  assert.deepEqual(doc, wellKnown, 'same document at the well-known URL');
  assert.equal(doc.keys[0].alg, 'Ed25519'); assert.ok(!JSON.stringify(doc).includes('"d"'), 'only the public half is published');
  assert.equal(rec.keyId, doc.keys[0].keyId);
  // verification with ONLY the published document: no server, no secret
  assert.equal(await Verifier.verify(rec, doc), true);
  assert.equal(await Verifier.verify({ ...rec, score: 100 - 1 }, doc), false, 'edited score');
  assert.equal(await Verifier.verify({ ...rec, studentName: 'Mallory' }, doc), false, 'edited name');
  assert.equal(await Verifier.verify({ ...rec, keyId: 'abcdef0123456789' }, doc), false, 'unknown key id');
  // an attacker signing their own record with their own key cannot pass as SkillBridge
  const evil = crypto.generateKeyPairSync('ed25519'), body = { ...rec }; delete body.signature;
  const forged = { ...body, studentName: 'Mallory', signature: crypto.sign(null, Buffer.from(require('../public/canonical.js')(({ ...body, studentName: 'Mallory' }))), evil.privateKey).toString('base64url') };
  assert.equal(await Verifier.verify(forged, doc), false, 'a record signed by someone else is rejected');
  assert.equal((await s.call('POST', '/api/verify', { records: [forged] })).json.results[0].valid, false, 'and the server agrees');
});

test('public content is revalidated with ETags: fresh after a change, tiny 304 when unchanged', async t => {
  const s = await start(); t.after(s.stop);
  for (const url of ['/api/tasks', '/api/roles', '/api/keys']) {
    const first = await fetch(s.base + url), etag = first.headers.get('etag'); await first.arrayBuffer();
    assert.ok(etag, url + ' has an ETag'); assert.match(first.headers.get('cache-control'), /no-cache/, 'never served stale without checking');
    const again = await fetch(s.base + url, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304, url + ' unchanged -> 304'); assert.equal((await again.text()).length, 0);
    assert.equal((await fetch(s.base + url, { headers: { 'if-none-match': '"other"' } })).status, 200);
  }
});
