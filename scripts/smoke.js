'use strict';
/* End-to-end smoke test: boots the real server in-process on a random port with a throwaway data folder and walks
   through what a student, an employer and a university would do. Prints a readable checklist.  Run: npm run smoke */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createApp } = require('../server');
const demo = require('../lib/demo');
const Verifier = require('../public/verifier.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbridge-smoke-'));
  const app = createApp({ dataDir: dir });
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port, key = crypto.randomBytes(24).toString('hex');
  const call = async (method, url, body, k) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(k ? { 'x-owner-key': k } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  let failed = 0;
  const check = (label, ok, detail) => { console.log((ok ? '  PASS ' : '  FAIL ') + label + (detail ? '  (' + detail + ')' : '')); if (!ok) failed++; };

  console.log('SkillBridge smoke test on ' + base);
  console.log('\nStudent');
  const tasks = (await call('GET', '/api/tasks')).json;
  check('task list served without answers', tasks.length >= 20 && !JSON.stringify(tasks).includes('"correct"'), tasks.length + ' tasks');
  const byId = Object.fromEntries(app.tasks.map(t => [t.id, t]));
  const evidence = [];
  for (const id of ['cart-total-off-by-one', 'sql-injection', 'merge-conflict', 'fizzbuzz', 'status-update']) {
    const r = await call('POST', '/api/submit', { taskId: id, answer: demo.answerFor(byId[id], 'good'), studentName: 'Smoke Tester' }, key);
    check('graded "' + id + '" (' + byId[id].type + ')', r.json.passed && r.json.evidence, r.json.score + '%'); if (r.json.evidence) evidence.push(r.json.evidence);
  }
  const bad = await call('POST', '/api/submit', { taskId: 'slugify', answer: demo.answerFor(byId.slugify, 'poor'), studentName: 'Smoke Tester' }, key);
  check('a weak answer earns no evidence', !bad.json.passed && !bad.json.evidence, bad.json.score + '%');

  console.log('\nEmployer');
  const v = await call('GET', '/api/verify/' + evidence[0].id);
  check('verify by link (registry)', v.json.valid === true);
  const doc = (await call('GET', '/.well-known/skillbridge-keys.json')).json;
  check('verify offline with only the published public key', await Verifier.verify(evidence[0], doc) === true, 'key ' + doc.keys[0].keyId);
  check('an edited score is rejected', await Verifier.verify({ ...evidence[0], score: 100 - 1 }, doc) === false);

  console.log('\nUniversity');
  for (let i = 0; i < 5; i++) { const k = crypto.randomBytes(24).toString('hex'); await call('POST', '/api/submit', { taskId: 'sort-mutates', answer: demo.answerFor(byId['sort-mutates'], 'good'), studentName: 'S' + i }, k); await call('POST', '/api/cohort/join', { code: 'SMOKE-CLASS-1' }, k); }
  const dash = (await call('GET', '/api/cohort/SMOKE-CLASS-1')).json;
  check('class dashboard unlocks at 5 students', dash.locked === false && dash.size === 5);
  check('dashboard holds no names or ids', !/Smoke|S\d|ev_/.test(JSON.stringify(dash)));

  console.log('\nPrivacy');
  await call('DELETE', '/api/mine', null, key);
  check('erasing yourself removes your evidence', (await call('GET', '/api/verify/' + evidence[0].id)).status === 404);

  await new Promise(r => app.server.close(r));
  console.log('\n' + (failed ? failed + ' check(s) FAILED' : 'All checks passed'));
  process.exit(failed ? 1 : 0);
})();
