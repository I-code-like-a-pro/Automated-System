'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sim = require('../lib/sim');
const samples = require('../lib/simsamples');
const { createApp } = require('../server');

/* ---------- canned model replies: an accountancy job, nothing to do with software ---------- */
const outline = over => ({ refuse: false, reason: '', title: 'Junior Accountant', company: { name: 'Baobab Foods Ltd', about: 'A Kumasi food distributor with 40 staff and a growing export order book.' }, blurb: 'Close the month, chase an invoice and explain a variance to your manager.',
  level: 'beginner', learn: ['Reconcile a bank statement', 'Prioritise month-end tasks', 'Explain a variance simply', 'Spot a suspicious invoice'], skills: ['Reconciliation', 'Month-end close', 'Accruals', 'Communication', 'Attention to detail', 'Prioritisation'],
  people: [{ name: 'Efua Mensah', role: 'Finance Manager' }, { name: 'Kwame Boateng', role: 'Accounts Payable Clerk' }, { name: 'Ama Darko', role: 'Sales Operations' }, { name: 'Yaw Owusu', role: 'Warehouse Lead' }],
  days: [{ theme: 'Reconcile the bank', goal: 'Your first day: the bank statement does not match the ledger.' }, { theme: 'Chase the invoice', goal: 'A supplier invoice looks odd and payment is due.' }, { theme: 'Explain the variance', goal: 'The monthly report shows a large cost variance.' }], disclaimer: '', ...over });
const stepsJson = () => ({ steps: [
  { t: '09:05', type: 'msg', from: 0, text: 'Good morning. Month-end is on Friday and the bank reconciliation is not balancing.' },
  { t: '09:30', type: 'msg', from: 1, text: 'I found two payments in the statement that are not in the ledger yet.' },
  { t: '09:45', type: 'reply', from: 0, text: 'Where would you start with the difference?', options: [{ label: 'List unmatched items and match them one by one', score: 100, resp: 'Good, methodical.' }, { label: 'Adjust the ledger to match the bank', score: 25, resp: 'That hides the problem.' }, { label: 'Ask someone else to do it', score: 50, resp: 'Try first, then ask.' }] },
  { t: '10:00', type: 'task', title: 'Write the reconciliation note', brief: 'Write a short note listing the unmatched items, your explanation for each and what you will do next. The difference is 2,450 made of two payments and one bank charge.', due: '11:15 AM', rubric: [{ label: 'Lists each unmatched item', weight: 2 }, { label: 'Explains the cause of each', weight: 2 }, { label: 'States clear next steps', weight: 1 }], points: 'Three items identified with causes and a next step for each.' },
  { t: '11:30', type: 'decision', q: 'Two urgent things, one hour', a: { title: 'Finish the reconciliation', detail: 'Month-end close depends on it.', score: 100, fb: 'Right, it blocks everyone else.' }, b: { title: 'Reply to a supplier chasing payment', detail: 'They emailed twice.', score: 50, fb: 'Important but it can wait an hour.' } },
  { t: '13:00', type: 'break' },
  { t: '14:30', type: 'quiz', q: 'A bank charge appears on the statement but not in the ledger. What do you do?', options: ['Ignore it', 'Record it in the ledger', 'Ask the bank to remove it', 'Delete the statement line'], correct: 1, why: 'Bank charges are real expenses that must be recorded.' },
] });
function fakeModel(over = {}) {
  const calls = { sim: 0, day: 0 };
  const complete = async ({ system }) => {
    if (/design realistic job simulations/.test(system)) { calls.sim++; return 'Sure:\n' + JSON.stringify((over.outline || outline)()); }
    if (/write ONE workday/.test(system)) { calls.day++; if (over.delay) await over.delay; return JSON.stringify((over.day || stepsJson)()); }
    throw new Error('unexpected prompt');
  };
  return { complete, calls };
}
const gather = async () => ({ notes: '- Month-end close involves bank reconciliation and accruals.', sources: [{ title: 'Source Org', url: 'https://example.org/accounting' }], via: 'web-search' });
const goodReview = async () => JSON.stringify({ scores: { c1: 1, c2: 0.9, c3: 1 }, comments: { c1: 'Covered.', c2: 'Good.', c3: 'Clear.' }, feedback: 'Clear and complete. I could act on this today.', fixes: [] });
const weakReview = async () => JSON.stringify({ scores: { c1: 0.4, c2: 0.2, c3: 0 }, comments: {}, feedback: 'Not ready to send yet.', fixes: ['List each unmatched item separately', 'Say why each one happened'] });

/* ---------------------------------------------------------------- unit: validation */
test('validateOutline: a fictional company, a manager and three teammates, three days', () => {
  const o = sim.validateOutline(outline());
  assert.equal(o.people.length, 4); assert.equal(o.people[0].key, 'mgr'); assert.equal(o.people[0].ini, 'EM'); assert.equal(o.dayThemes.length, 3); assert.equal(o.company.name, 'Baobab Foods Ltd');
  assert.throws(() => sim.validateOutline(outline({ people: outline().people.slice(0, 3) })), /rejected/);
  assert.throws(() => sim.validateOutline(outline({ days: outline().days.slice(0, 2) })), /rejected/);
  assert.throws(() => sim.validateOutline(outline({ skills: ['a'] })), /rejected/);
  assert.throws(() => sim.validateOutline(outline({ people: outline().people.map(p => ({ ...p, name: 'Same Name' })) })), /rejected/);
  assert.throws(() => sim.validateOutline({ refuse: true, reason: 'This is not something we can simulate.' }), e => e.user && e.status === 422 && /not something we can simulate/.test(e.message));
});

test('validateDay: timed steps, a real judgement call each time, shuffled so the best choice is not always first', () => {
  const people = sim.validateOutline(outline()).people;
  const ok = sim.validateDay(stepsJson(), people); assert.equal(ok.length, 7); assert.equal(ok[0].from, 'mgr'); assert.equal(ok[1].from, 'p1');
  const bad = fn => { const d = stepsJson(); fn(d.steps); return () => sim.validateDay(d, people); };
  assert.throws(bad(s => { s[2].t = '09:10'; }), /rejected/);                                   // time goes backwards
  assert.throws(bad(s => { s[0].t = '07:00'; }), /rejected/);                                   // before the workday
  assert.throws(bad(s => { s[2].options.forEach(o => { o.score = 60; }); }), /rejected/);       // no clearly best option
  assert.throws(bad(s => { s[4].a.score = 100; s[4].b.score = 95; }), /rejected/);              // both options fine: not a dilemma
  assert.throws(bad(s => { s.splice(4, 1); }), /rejected/);                                     // no decision
  assert.throws(bad(s => { s[6].options = ['x1', 'x1', 'y2', 'z3']; }), /rejected/);
  assert.throws(bad(s => { s[0].from = 9; }), /rejected/);
  assert.throws(bad(s => { s[3].rubric = [{ label: 'only one criterion here', weight: 1 }]; }), /rejected/);
  const bestFirst = new Set(), goodA = new Set(), quizPos = new Set();
  for (let i = 0; i < 60; i++) { const d = sim.validateDay(stepsJson(), people); bestFirst.add(d[2].options.findIndex(o => o.score === 100)); goodA.add(d[4].a.score === 100); quizPos.add(d[6].correct); assert.equal(d[6].options[d[6].correct], 'Record it in the ledger'); }
  assert.equal(bestFirst.size, 3, 'best reply spreads over all positions'); assert.equal(goodA.size, 2, 'the better decision is sometimes a, sometimes b'); assert.ok(quizPos.size >= 3);
});

test('publicDay: no scores, keys or feedback ever reach the browser', () => {
  const people = sim.validateOutline(outline()).people, steps = sim.validateDay(stepsJson(), people), pub = JSON.stringify(sim.publicDay({ theme: 't', goal: 'g', steps }));
  for (const secret of ['"score"', '"resp"', '"fb"', '"correct"', '"why"', '"points"', 'Good, methodical', 'That hides the problem', 'Right, it blocks everyone', 'must be recorded', 'Three items identified']) assert.ok(!pub.includes(secret), 'leaked ' + secret);
  assert.match(pub, /List unmatched items/); assert.match(pub, /Finish the reconciliation|Reply to a supplier/);
});

/* ---------------------------------------------------------------- unit: engine */
test('createSim and writeDay through a fake model', async () => {
  const m = fakeModel(), s = await sim.createSim({ job: '  Junior   accountant ' }, { complete: m.complete, gather });
  assert.match(s.id, /^sim_[a-f0-9]{10}$/); assert.equal(s.topic, 'Junior accountant'); assert.equal(s.title, 'Junior Accountant'); assert.equal(s.sources[0].title, 'Source Org'); assert.deepEqual(s.days, {});
  const day = await sim.writeDay(s, 2, { complete: m.complete, gather: async a => { assert.equal(a.focus, 'Chase the invoice', 'research is about that day'); return gather(); } });
  assert.equal(day.theme, 'Chase the invoice'); assert.equal(day.steps.length, 7);
  await assert.rejects(sim.writeDay(s, 4, { complete: m.complete, gather }), e => e.status === 404);
  await assert.rejects(sim.createSim({ job: 'ab' }, {}), /at least 3 letters/);
  await assert.rejects(sim.createSim({ job: 'Spy' }, { complete: async () => JSON.stringify({ refuse: true, reason: 'No.' }), gather }), e => e.status === 422);
  await assert.rejects(sim.createSim({ job: 'Accountant' }, { complete: async () => 'not json', gather }), /no JSON/);
});

test('reviewWork: rubric from the AI, one chance to revise, and never a score without a real reviewer', async () => {
  const s = { ...(await sim.createSim({ job: 'Accountant' }, { ...fakeModel(), gather })), days: {} }, day = await sim.writeDay(s, 1, { ...fakeModel(), gather }), step = day.steps.find(x => x.type === 'task');
  const weak = await sim.reviewWork(s, step, { text: 'some words about the bank', attempt: 1 }, { review: weakReview });
  assert.ok(weak.score < 80 && weak.needsRevision && weak.mode === 'ai'); assert.equal(weak.fixes.length, 2); assert.equal(weak.rubric.length, 3);
  const again = await sim.reviewWork(s, step, { text: 'some words about the bank', attempt: 2 }, { review: weakReview }); assert.equal(again.needsRevision, false, 'second attempt is final');
  const good = await sim.reviewWork(s, step, { text: 'a complete note', attempt: 1 }, { review: goodReview }); assert.ok(good.score >= 90 && !good.needsRevision);
  let seen; await sim.reviewWork(s, step, { text: 't', attachments: [{ mime: 'image/png', data: 'AAAA' }], attempt: 1 }, { review: async o => { seen = o; return goodReview(); } });
  assert.deepEqual(seen.attachments, [{ mime: 'image/png', data: 'AAAA' }]); assert.match(seen.system, /untrusted data/); assert.match(seen.user, /<work>/);
  await assert.rejects(sim.reviewWork(s, step, { text: 'x', attempt: 1 }, { review: async () => { throw new Error('AI HTTP 503'); } }), e => e.user && e.status === 503 && /not scored/.test(e.message));
  await assert.rejects(sim.reviewWork(s, step, { text: 'x', attempt: 1 }, { review: async () => 'not json' }), e => e.status === 503);
  // the hand-written samples can still be marked with no AI, by a transparent checklist
  const samp = samples.build(samples.JOBS[0]), t = samp.days['1'].steps.find(x => x.type === 'task');
  const chk = await sim.reviewWork(samp, t, { text: 'The goal is to launch Driver App 2.0 in 14 days. Milestones: week 1 finish payments, week 2 test. Owners: Tunde for engineering and Amina for design. Risks: the bank API times out, with a fallback plan and an owner assigned. We keep a buffer for delay.', attempt: 1 }, {});
  assert.equal(chk.mode, 'rubric'); assert.ok(chk.score >= 60, 'a good plan scores well on the checklist: ' + chk.score);
  const poor = await sim.reviewWork(samp, t, { text: 'We will do the project and it will be fine, I think it is a good plan overall.', attempt: 1 }, {}); assert.ok(poor.score < chk.score && poor.needsRevision);
  await assert.rejects(sim.reviewWork(samp, t, { text: 'x', attachments: [{ mime: 'image/png', data: 'AAAA' }], attempt: 1 }, {}), e => e.user && /AI reviewer is needed/.test(e.message));
});

test('scoring: punctuality, the day score and the certificate rows match the prototype\'s rules', () => {
  assert.deepEqual([sim.punctuality(-8), sim.punctuality(-5), sim.punctuality(0), sim.punctuality(14)], [{ status: 'early', score: 100 }, { status: 'on', score: 95 }, { status: 'on', score: 95 }, { status: 'late', score: 62 }]);
  assert.equal(sim.punctuality(100).score, 40, 'never below 40');
  const day = (p, st, task, dec, quiz, rep) => ({ pScore: p, status: st, results: { 1: { kind: 'task', score: task }, 2: { kind: 'decision', score: dec }, 3: { kind: 'quiz', correct: quiz }, 4: { kind: 'reply', score: rep } } });
  const d1 = day(100, 'early', 90, 100, true, 100), d2 = day(95, 'on', 90, 100, true, 50), d3 = day(100, 'late', 92, 60, true, 100);
  assert.equal(sim.dayScores(d1).overall, Math.round((100 + 90 + 100 + 100 + 100) / 5)); assert.equal(sim.dayScores(day(100, 'on', 0, 0, false, 0)).overall, Math.round((100 + 0 + 0 + 40 + 0) / 5));
  const c = sim.certificateData({ daysTotal: 3, days: [d1, d2, d3] });
  assert.equal(c.onTime, 2); assert.deepEqual(c.rows.map(r => r.label), ['Punctuality and reliability', 'Task quality', 'Decision-making', 'Critical thinking', 'Communication']);
  assert.equal(c.rows[0].score, Math.round((100 + 95 + 100) / 3)); assert.equal(c.rows[2].score, Math.round((100 + 100 + 60) / 3)); assert.equal(c.rows[3].score, Math.round((c.rows[2].score + 100) / 2));
  assert.match(c.rows[0].note, /2 of 3 days/); assert.deepEqual([95, 80, 65, 40].map(sim.gradeLabel), ['Distinction', 'Merit', 'Pass', 'Completed']);
});

/* ---------------------------------------------------------------- integration */
async function start(deps, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sim-')), app = createApp({ dataDir: dir, deps, ...opts });
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, url, body, key) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
  const job = async (r, key) => { assert.equal(r.status, 202, JSON.stringify(r.json)); for (let i = 0; i < 300; i++) { const j = await call('GET', '/api/jobs/' + r.json.job, null, key); if (j.json.status !== 'working') return j.json; await new Promise(x => setTimeout(x, 10)); } throw new Error('job never finished'); };
  return { app, call, job, stop: () => new Promise(r => { app.db.flushNow(); app.server.close(r); }) };
}
const newKey = () => crypto.randomBytes(24).toString('hex');
const NINE = Date.UTC(2026, 9, 26, 9, 0);        // 09:00 UTC; tzOffset 0 below

test('journey on a hand-written sample, with the AI completely off: two days to a verifiable certificate', async t => {
  const s = await start({ now: () => NINE }, { sampleCourse: true }); t.after(s.stop);
  const key = newKey(), other = newKey();
  assert.equal((await s.call('GET', '/api/health')).json.ai, false);
  const list = (await s.call('GET', '/api/sims')).json; assert.equal(list.sims.length, 2); assert.ok(list.sims.every(x => x.sample && x.company.name === 'Tembea Logistics')); assert.ok(!JSON.stringify(list).includes('"days":{'), 'scripts are not in the catalogue');
  const pm = list.sims.find(x => x.title === 'Project Manager'); assert.equal(pm.people[0].name, 'Chidi Eze'); assert.equal(pm.skills.length, 6);
  assert.equal((await s.call('POST', '/api/sims', { job: 'Nurse' }, key)).status, 503, 'inventing a new job still needs the AI');
  assert.equal((await s.call('POST', '/api/sims/' + pm.id + '/runs', { days: 2 })).status, 401);

  const run = (await s.call('POST', '/api/sims/' + pm.id + '/runs', { days: 2, name: 'Ada Okafor' }, key)).json.run; assert.equal(run.daysTotal, 2); assert.equal(run.days[0].clockedIn, false);
  assert.equal((await s.call('GET', '/api/runs/' + run.id, null, other)).status, 404, 'nobody else can open your run');
  assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/2/prepare', null, key)).status, 400, 'day 2 waits for day 1');
  assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/3/prepare', null, key)).status, 400, 'this run has only two days');
  assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/1/prepare', null, key)).json.ready, true);

  const play = async (n, startMin, goodTask = true) => {
    assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/' + n + '/clockin', { startMin: 'x', tzOffset: 0 }, key)).status, 400);
    const ci = await s.call('POST', '/api/runs/' + run.id + '/days/' + n + '/clockin', { startMin, tzOffset: 0 }, key); assert.equal(ci.status, 200);
    const pub = ci.json.day; assert.ok(!/"score"|"resp"|"fb"|"correct"/.test(JSON.stringify(pub)), 'no keys in the day the browser receives');
    const stored = s.app.db.simById(pm.id).days[String(n)], url = i => '/api/runs/' + run.id + '/days/' + n + '/steps/' + i;
    const interactive = stored.steps.map((st, i) => [st, i]).filter(([st]) => ['reply', 'task', 'decision', 'quiz'].includes(st.type));
    // out of order is refused
    const lastI = interactive[interactive.length - 1][1]; assert.equal((await s.call('POST', url(lastI), { choice: 0 }, key)).status, 400);
    assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/' + n + '/clockout', null, key)).status, 400, 'cannot clock out with work left');
    let taskResult;
    for (const [st, i] of interactive) {
      if (st.type === 'reply') { const r = await s.call('POST', url(i), { choice: st.options.findIndex(o => o.score === 100) }, key); assert.equal(r.status, 200); assert.ok(r.json.resp); const again = await s.call('POST', url(i), { choice: 0 }, key); assert.equal(again.json.done, true); assert.equal(again.json.resp, r.json.resp, 'answering twice returns the first result'); }
      if (st.type === 'decision') { const k = st.a.score >= 90 ? 'a' : 'b'; const r = await s.call('POST', url(i), { k, why: 'client first' }, key); assert.ok(r.json.fb); }
      if (st.type === 'quiz') { const r = await s.call('POST', url(i), { choice: st.correct }, key); assert.equal(r.json.correct, true); }
      if (st.type === 'task') {
        assert.equal((await s.call('POST', url(i), { text: 'too short' }, key)).status, 400);
        assert.equal((await s.call('POST', url(i), { text: 'x'.repeat(30), files: [{ mime: 'application/zip', data: 'AAAA' }] }, key)).status, 400, 'only PNG, JPG and PDF');
        const first = await s.call('POST', url(i), { text: 'We will do the project and it will be fine, I think it is a good plan overall for everybody.' }, key);
        assert.equal(first.status, 200); assert.equal(first.json.needsRevision, true); assert.ok(first.json.fixes.length >= 1); assert.equal(first.json.mode, 'rubric');
        assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/' + n + '/clockout', null, key)).status, 400, 'a task needing revision blocks clock-out');
        const good = 'The goal is to launch Driver App 2.0. Milestones with dates: week 1 payments, week 2 testing. Owners: Tunde and Amina are responsible. Risks: the bank API and a payments delay, a blocker with a fallback plan, mitigation and an owner assigned. We keep a buffer for delay. Impact and likelihood noted. Recommend go tomorrow, thanks.';
        taskResult = await s.call('POST', url(i), { text: goodTask ? good : first.json && 'still not much more than a vague sentence about doing the work properly.' }, key); assert.equal(taskResult.json.final, true); assert.equal(taskResult.json.improved, goodTask);
      }
    }
    const out = await s.call('POST', '/api/runs/' + run.id + '/clockout', null, key); assert.equal(out.status, 404);   // wrong route shape guards
    const co = await s.call('POST', '/api/runs/' + run.id + '/days/' + n + '/clockout', null, key); assert.equal(co.status, 200); return co.json.summary;
  };
  const d1 = await play(1, 548); assert.equal(d1.status, 'early'); assert.equal(d1.delta, -8); assert.equal(d1.clockIn, '9:00 AM'); assert.equal(d1.quiz, true); assert.ok(d1.overall > 60 && d1.manager.name === 'Chidi Eze'); assert.equal(d1.last, false); assert.equal(d1.improved, true);
  assert.equal((await s.call('POST', '/api/runs/' + run.id + '/certificate', { studentName: 'Ada Okafor' }, key)).status, 403, 'not before every day is done');
  const resume = await s.call('GET', '/api/runs/' + run.id + '/days/1', null, key); assert.equal(resume.json.state.completed, true); assert.ok(Object.keys(resume.json.state.results).length >= 4, 'refreshing keeps your answers');
  assert.equal((await s.call('POST', '/api/runs/' + run.id + '/days/2/prepare', null, key)).json.ready, true);
  const d2 = await play(2, 530); assert.equal(d2.status, 'late'); assert.equal(d2.delta, 10); assert.equal(d2.last, true);

  const cert = (await s.call('POST', '/api/runs/' + run.id + '/certificate', { studentName: 'Ada Okafor' }, key)).json.certificate;
  assert.match(cert.id, /^cert_[a-f0-9]+$/); assert.equal(cert.certType, 'simulation'); assert.equal(cert.jobTitle, 'Project Manager'); assert.equal(cert.company, 'Tembea Logistics'); assert.equal(cert.days, 2); assert.equal(cert.onTime, 1);
  assert.equal(cert.rows.length, 5); assert.equal(cert.workLog.length, 2); assert.equal(cert.workLog[0].status, 'early'); assert.equal(cert.workLog[1].status, 'late'); assert.equal(cert.manager.name, 'Chidi Eze'); assert.equal(cert.aiDesigned, false);
  assert.match(cert.statement, /fictional company/); assert.match(cert.statement, /not an accredited qualification/);
  assert.equal((await s.call('POST', '/api/runs/' + run.id + '/certificate', { studentName: 'Someone Else' }, key)).json.certificate.id, cert.id, 'one certificate per run');
  assert.equal((await s.call('GET', '/api/verify/' + cert.id)).json.valid, true);
  assert.equal((await s.call('POST', '/api/verify', { records: [{ ...cert, overallScore: 100 }] })).json.results[0].valid, false, 'a changed score breaks the signature');
  assert.equal((await s.call('POST', '/api/verify', { records: [{ ...cert, rows: cert.rows.map(r => ({ ...r, score: 100 })) }] })).json.results[0].valid, false);
  assert.equal((await s.call('GET', '/api/runs', null, key)).json.runs[0].certificateId, cert.id);
  assert.equal((await s.call('GET', '/api/mine', null, key)).json.certificates.length, 1);
  await s.call('DELETE', '/api/mine', null, key);
  assert.equal((await s.call('GET', '/api/verify/' + cert.id)).status, 404, 'erasing yourself removes your run and certificate'); assert.equal(s.app.db.runById(run.id), null);
});

test('AI path: invent a job, share one AI call for a day, review uploaded work, outage means no score', async t => {
  const model = fakeModel(); let aiUp = false, release; const gate = new Promise(r => { release = r; });
  const slow = fakeModel({ delay: gate });
  const s = await start({ complete: slow.complete, gather, now: () => NINE, review: async o => { if (!aiUp) throw new Error('AI HTTP 503'); return goodReview(o); } }); t.after(s.stop);
  const a = newKey(), b = newKey();
  const made = await s.job(await s.call('POST', '/api/sims', { job: 'Junior accountant' }, a), a); assert.equal(made.status, 'done'); const sm = made.result.sim;
  assert.equal(sm.title, 'Junior Accountant'); assert.equal(sm.sample, false); assert.ok(!('days' in sm), 'the public view has no scripts');
  assert.equal((await s.call('POST', '/api/sims', { job: 'x' }, a)).status, 400);
  const ra = (await s.call('POST', '/api/sims/' + sm.id + '/runs', { days: 1, name: 'Ada' }, a)).json.run, rb = (await s.call('POST', '/api/sims/' + sm.id + '/runs', { days: 1, name: 'Bola' }, b)).json.run;
  const pa = await s.call('POST', '/api/runs/' + ra.id + '/days/1/prepare', null, a), pb = await s.call('POST', '/api/runs/' + rb.id + '/days/1/prepare', null, b); assert.equal(pa.status, 202); assert.equal(pb.status, 202);
  release(); assert.equal((await s.job(pa, a)).status, 'done'); assert.equal((await s.job(pb, b)).status, 'done'); assert.equal(slow.calls.day, 1, 'two learners starting the same day cost one AI call');
  assert.equal((await s.call('POST', '/api/runs/' + ra.id + '/days/1/prepare', null, a)).json.ready, true);

  await s.call('POST', '/api/runs/' + ra.id + '/days/1/clockin', { startMin: 540, tzOffset: 0 }, a);
  const stored = s.app.db.simById(sm.id).days['1'], url = i => '/api/runs/' + ra.id + '/days/1/steps/' + i, ti = stored.steps.findIndex(x => x.type === 'task');
  for (let i = 0; i < ti; i++) { const st = stored.steps[i]; if (st.type === 'reply') await s.call('POST', url(i), { choice: st.options.findIndex(o => o.score === 100) }, a); }
  const down = await s.call('POST', url(ti), { text: 'Unmatched items: two payments and a bank charge, each explained, with next steps for each of them.' }, a);
  assert.equal(down.status, 503); assert.match(down.json.error, /not scored/); assert.equal(s.app.db.runById(ra.id).days[0].results[ti], undefined, 'no score was recorded');
  aiUp = true;
  assert.equal((await s.call('POST', url(ti), { text: '', files: [{ mime: 'image/gif', data: 'AAAA' }] }, a)).status, 400);
  const pdf = await s.call('POST', url(ti), { files: [{ mime: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') }] }, a);
  assert.equal(pdf.status, 200); assert.equal(pdf.json.final, true); assert.ok(pdf.json.score >= 90); assert.equal(pdf.json.mode, 'ai');
  assert.equal((await s.call('POST', url(ti), { text: 'a second attempt after the first was final' }, a)).json.done, true);
});

test('code and styles are revalidated with an ETag, so an update reaches everyone at once', async t => {
  const s = await start({}); t.after(s.stop);
  const base = 'http://127.0.0.1:' + s.app.server.address().port;
  for (const file of ['/style.css', '/sim.js', '/app.js', '/learn.js']) {
    const first = await fetch(base + file, { headers: { 'accept-encoding': 'identity' } }), etag = first.headers.get('etag');
    assert.equal(first.status, 200); assert.ok(etag, file + ' has an ETag'); assert.equal(first.headers.get('cache-control'), 'no-cache', file + ' is revalidated, not cached for an hour');
    const again = await fetch(base + file, { headers: { 'if-none-match': etag } }); assert.equal(again.status, 304, file + ' answers 304 when unchanged');
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8').split('{').length > 100 ? 'ok' : 'bad', /ok/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'the stylesheet has balanced braces (an unbalanced block makes browsers drop every rule after it)');
  for (const must of ['.sim .kv', '.sim .paper', '.sim .feed', '.dpanel', '@keyframes s']) assert.ok(css.includes(must), 'stylesheet keeps ' + must);
});

test('a busy or refused request is explained, and quota trouble is described plainly', async t => {
  const s = await start({ complete: async () => { throw new Error('AI HTTP 429: quota'); }, gather }); t.after(s.stop);
  const k = newKey(), r = await s.job(await s.call('POST', '/api/sims', { job: 'Teacher' }, k), k);
  assert.equal(r.status, 'error'); assert.match(r.error, /busy or has reached its usage limit/);
  const s2 = await start({ complete: async () => JSON.stringify({ refuse: true, reason: 'Not something we can simulate.' }), gather }); t.after(s2.stop);
  const r2 = await s2.job(await s2.call('POST', '/api/sims', { job: 'Something bad' }, k), k); assert.match(r2.error, /Not something we can simulate/);
});
