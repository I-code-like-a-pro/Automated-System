'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server');
const demo = require('../lib/demo');

const newKey = () => crypto.randomBytes(24).toString('hex');
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbridge-'));
  const app = createApp({ dataDir: dir });
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, url, body, key) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const taskById = id => app.tasks.find(t => t.id === id);
  /* make a person with some evidence and put them in a cohort */
  const student = async (code, taskIds) => {
    const key = newKey();
    for (const id of taskIds) await call('POST', '/api/submit', { taskId: id, answer: demo.answerFor(taskById(id), 'good'), studentName: 'Secret Name ' + id }, key);
    if (code) await call('POST', '/api/cohort/join', { code }, key);
    return key;
  };
  return { app, call, student, stop: () => new Promise(r => { app.db.flushNow(); app.server.close(r); }) };
}

test('a cohort stays locked until it has enough members (k-anonymity), and reveals nothing while locked', async t => {
  const s = await start(); t.after(s.stop);
  for (let i = 0; i < 4; i++) await s.student('UNI-CS-2026', ['cart-total-off-by-one']);
  const locked = await s.call('GET', '/api/cohort/UNI-CS-2026');
  assert.equal(locked.status, 200); assert.equal(locked.json.locked, true); assert.equal(locked.json.size, 4); assert.equal(locked.json.need, 5);
  assert.ok(!('skills' in locked.json), 'no data at all while locked');
  await s.student('UNI-CS-2026', ['cart-total-off-by-one']);
  const open = (await s.call('GET', '/api/cohort/uni-cs-2026')).json;       // case-insensitive code
  assert.equal(open.locked, false); assert.equal(open.size, 5);
  assert.equal((await s.call('GET', '/api/cohort/NOPE-0000')).status, 404);
});

test('only anonymous aggregates are returned: no names, ids, hashes or individual scores', async t => {
  const s = await start(); t.after(s.stop);
  const keys = []; for (let i = 0; i < 6; i++) keys.push(await s.student('UNI-ANON-26', i < 3 ? ['cart-total-off-by-one', 'async-foreach', 'sort-mutates'] : ['status-update']));
  const raw = JSON.stringify((await s.call('GET', '/api/cohort/UNI-ANON-26')).json);
  assert.ok(!raw.includes('Secret Name'), 'student names never appear');
  assert.ok(!/ev_[0-9a-f]{8}/.test(raw), 'no evidence ids');
  keys.forEach(k => assert.ok(!raw.includes(k) && !raw.includes(crypto.createHash('sha256').update(k).digest('hex')), 'no keys or hashes'));
  const agg = JSON.parse(raw);
  agg.skills.forEach(sk => { assert.equal(sk.atTargetPct % 5, 0, 'percentages are rounded to 5'); assert.ok(sk.mean >= 0 && sk.mean <= 100); });
  assert.ok(agg.skills.find(x => x.id === 'debugging').mean > agg.skills.find(x => x.id === 'security').mean, 'half the class practised debugging, nobody practised security');
  const means = agg.skills.map(x => x.mean).sort((a, b) => a - b), cutoff = means[3];
  assert.ok(agg.gaps.length === 3 && agg.gaps.every(id => agg.skills.find(x => x.id === id).mean <= cutoff), 'gaps are the lowest-scoring skills');
  assert.ok(agg.suggested.length > 0, 'the weakest skills become teaching suggestions');
  assert.equal(agg.active, 6);
});

test('joining is voluntary and reversible, one cohort at a time, and deletion removes membership', async t => {
  const s = await start(); t.after(s.stop);
  const a = await s.student('CLASS-A-1', ['sort-mutates']);
  assert.deepEqual((await s.call('GET', '/api/cohort/mine', null, a)).json, { code: 'CLASS-A-1', size: 1 });
  await s.call('POST', '/api/cohort/join', { code: 'class-b-2' }, a);
  assert.equal((await s.call('GET', '/api/cohort/mine', null, a)).json.code, 'CLASS-B-2', 'moved to the new cohort');
  assert.equal((await s.call('GET', '/api/cohort/CLASS-A-1')).status, 404, 'the empty cohort disappeared');
  await s.call('POST', '/api/cohort/leave', null, a);
  assert.equal((await s.call('GET', '/api/cohort/mine', null, a)).json.code, null);
  await s.call('POST', '/api/cohort/join', { code: 'CLASS-C-3' }, a);
  await s.call('DELETE', '/api/mine', null, a);
  assert.equal((await s.call('GET', '/api/cohort/CLASS-C-3')).status, 404, 'erasing yourself removes you from the cohort');
  assert.equal((await s.call('POST', '/api/cohort/join', { code: 'x' }, a)).status, 400, 'bad code');
  assert.equal((await s.call('POST', '/api/cohort/join', { code: 'UNI-X-1' })).status, 401, 'needs an owner key');
});

test('the one-click demo creates a realistic student and a demo class through the real grading pipeline', async t => {
  const s = await start(); t.after(s.stop);
  const key = newKey(), r = await s.call('POST', '/api/demo', null, key);
  assert.equal(r.status, 200); assert.ok(r.json.evidence.length >= 10, 'demo student has evidence: ' + r.json.evidence.length);
  assert.ok(r.json.evidence.every(e => e.keyId && e.signature), 'every demo record is genuinely signed');
  assert.equal(r.json.evidence.filter(e => e.taskId === 'slugify').length, 1, 'the failed first attempt at slugify did not create evidence, the retry did');
  const dash = (await s.call('GET', '/api/cohort/' + r.json.cohort)).json;
  assert.equal(dash.locked, false); assert.ok(dash.size >= 14); assert.ok(dash.active >= 12);
  assert.ok(dash.skills.some(x => x.mean > 40) && dash.skills.some(x => x.mean < 25), 'the demo class has visible strengths and gaps: ' + JSON.stringify(dash.skills.map(x => x.mean)));
  const second = await s.call('POST', '/api/demo', null, newKey());
  assert.equal((await s.call('GET', '/api/cohort/' + r.json.cohort)).json.size, dash.size + 1, 'the demo class is seeded once, a new demo student just joins it');
  assert.ok(second.json.evidence.length >= 10);
});

test('demo can be switched off for production', async t => {
  process.env.DEMO = '0';
  try { const s = await start(); t.after(s.stop); assert.equal((await s.call('POST', '/api/demo', null, newKey())).status, 404); }
  finally { delete process.env.DEMO; }
});
