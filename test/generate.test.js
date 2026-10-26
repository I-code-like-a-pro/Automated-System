'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseAndBuild, generateTask } = require('../lib/generate');
const envLoader = require('../lib/env');
const Skills = require('../public/skills.js');
const { createApp } = require('../server');
const roles = require('../data/roles.json');

const role = { id: 'software-engineer', ...roles['software-engineer'] };
const skill = role.skills.find(s => s.id === 'debugging');
const ctx = type => ({ role, skill, type, difficulty: 2 });
const from = { name: 'Dana', title: 'Tech Lead' };
const base = { title: 'The invoice total is wrong', brief: 'Customers report the invoice total is off by one cent for some orders. Look at this code and decide.', from, minutes: 5 };
const mcq = over => ({ ...base, mcq: { code: 'total = a + b', options: ['Round once at the end', 'Round each line then add', 'Use floats', 'Ignore it'], correct: 0, explain: ['Right: rounding once avoids drift.', 'Drifts.', 'Floats drift.', 'Customers notice.'], ...over } });
const scenario = steps => ({ ...base, minutes: 8, scenario: { steps } });
const step = over => ({ prompt: 'A customer reports data loss. What first?', options: ['Check the logs', 'Reboot everything', 'Ignore it', 'Blame the user'], scores: [1, 0.2, 0, 0], explain: ['Good start.', 'Not ideal.', 'Not good.', 'Not good.'], ...over });
const code = over => ({ ...base, code: { fn: 'sumEven', starter: 'function sumEven(nums) {\n  // your code here\n}', solution: 'function sumEven(nums) { return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b, 0); }', tests: [{ args: [[1, 2, 3, 4]], expect: 6 }, { args: [[]], expect: 0 }, { args: [[7]], expect: 0 }, { args: [[2]], expect: 2 }, { args: [[-2, 3]], expect: -2 }, { args: [[10, 20, 5]], expect: 30 }], ...over } });
const written = over => ({ ...base, written: { code: '', prompt: 'Write your reply to the customer.', minWords: 30, rubric: [{ id: 'a', label: 'Apologises sincerely', weight: 1 }, { id: 'b', label: 'Explains next steps', weight: 2 }, { id: 'c', label: 'Gives a time frame', weight: 1 }], ...over } });
const build = (obj, type) => parseAndBuild('Sure! ```json\n' + JSON.stringify(obj) + '\n```', ctx(type));
const rejects = (obj, type, re) => assert.rejects(build(obj, type), re || /rejected/);

test('mcq: answers are shuffled but the key still points at the right option', async () => {
  const positions = new Set();
  for (let i = 0; i < 40; i++) {
    const t = await build(mcq(), 'mcq');
    assert.equal(t.mcq.options[t.mcq.correct], 'Round once at the end');
    assert.match(t.mcq.explain[t.mcq.correct], /^Right/);   // the explanation moved with its option
    positions.add(t.mcq.correct);
  }
  assert.ok(positions.size >= 3, 'correct answer should not sit in one place: ' + [...positions]);
  const t = await build(mcq(), 'mcq');
  assert.ok(t.id.startsWith('gen_') && t.generated === true && t.skills.debugging === 3 && t.role === 'software-engineer');
});

test('rejects malformed or unfair tasks', async () => {
  await rejects(mcq({ options: ['a1', 'a1', 'b2', 'c3'] }), 'mcq');                 // duplicate options
  await rejects(mcq({ correct: 4 }), 'mcq');
  await rejects(mcq({ explain: ['only one'] }), 'mcq');
  await rejects({ ...mcq(), title: '' }, 'mcq');
  await rejects(scenario([step(), step({ scores: [0.6, 0.5, 0.4, 0.5] })]), 'scenario');   // no clearly poor option and no best
  await rejects(scenario([step()]), 'scenario');                                     // needs 2+ steps
  await rejects(written({ rubric: [{ id: 'a', label: 'Only one criterion', weight: 1 }] }), 'written');
  await assert.rejects(parseAndBuild('no json here', ctx('mcq')), /no JSON/);
  await assert.rejects(parseAndBuild('{ broken', ctx('mcq')), /rejected/);
});

test('scenario and written tasks pass when well formed', async () => {
  const s = await build(scenario([step(), step({ prompt: 'The fix is ready. What next?' })]), 'scenario');
  s.scenario.steps.forEach(st => { assert.equal(Math.max(...st.scores), 1); assert.equal(st.options[st.scores.indexOf(1)], 'Check the logs'); });
  const w = await build(written(), 'written');
  assert.equal(w.written.rubric.length, 3); assert.ok(!JSON.stringify(w).includes('keywords'));
});

test('code: the reference solution must pass every test and the starter must not', async () => {
  const ok = await build(code(), 'code');
  assert.equal(ok.code.tests.filter(t => t.public).length, 2); assert.ok(!('solution' in ok.code), 'the solution is never stored on the task');
  await rejects(code({ solution: 'function sumEven(nums) { return 0; }' }), 'code', /reference solution fails/);             // wrong solution
  await rejects(code({ tests: [...code().code.tests.slice(0, 5), { args: [[1, 2]], expect: 999 }] }), 'code', /reference solution fails/);   // wrong expectation
  await rejects(code({ starter: 'function sumEven(nums) { return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b, 0); }' }), 'code', /starter already passes/);
  await rejects(code({ fn: 'bad name!' }), 'code', /function name/);
  await rejects(code({ solution: 'function sumEven(nums) { while (true) {} }' }), 'code', /reference solution fails/);   // endless loop is caught by the sandbox
});

test('generateTask retries once on a bad reply and gives up cleanly', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let calls = 0;
  const reply = text => async () => { calls++; return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) }; };
  const flaky = async () => (++calls === 1 ? { ok: true, json: async () => ({ content: [{ text: 'oops' }] }) } : { ok: true, json: async () => ({ content: [{ text: JSON.stringify(mcq()) }] }) });
  const t = await generateTask({ role, skill, type: 'mcq', difficulty: 2 }, { fetch: flaky });
  assert.equal(calls, 2); assert.equal(t.type, 'mcq');
  calls = 0; await assert.rejects(generateTask({ role, skill, type: 'mcq' }, { fetch: reply('nothing useful') }), /rejected/); assert.equal(calls, 2);
  calls = 0; await assert.rejects(generateTask({ role, skill, type: 'mcq' }, { fetch: async () => { calls++; return { ok: false, status: 401 }; } }), /AI HTTP 401/); assert.equal(calls, 1, 'a bad key is not retried');
  delete process.env.ANTHROPIC_API_KEY;
});

/* ---------- through the real server ---------- */
async function start(deps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gen-'));
  const app = createApp({ dataDir: dir, deps });
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, url, body, key) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { app, call, stop: () => new Promise(r => { app.db.flushNow(); app.server.close(r); }) };
}
const newKey = () => crypto.randomBytes(24).toString('hex');
/* generation is a background job: start it, then poll until it is done (mirrors what the page does) */
async function gen(s, body, key) {
  const start = await s.call('POST', '/api/generate', body, key);
  if (start.status !== 202) return start;
  for (let i = 0; i < 200; i++) {
    const j = await s.call('GET', '/api/generate/' + start.json.job, null, key);
    if (j.json.status === 'done') return { status: 200, json: { task: j.json.task } };
    if (j.json.status === 'error') return { status: 502, json: { error: j.json.error } };
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('job never finished');
}
const modelSays = obj => async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify(obj) }] }) });

test('API: without an AI key generation is off and says so', async t => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, g: process.env.GEMINI_API_KEY };
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
  t.after(() => { if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a; if (saved.g) process.env.GEMINI_API_KEY = saved.g; });
  const s = await start({}); t.after(s.stop);
  assert.equal((await s.call('GET', '/api/health')).json.ai, false);
  const r = await gen(s, { skillId: 'debugging' }, newKey());
  assert.equal(r.status, 503); assert.match(r.json.error, /GEMINI_API_KEY or ANTHROPIC_API_KEY/);
});

test('llm: picks the provider from the keys and speaks each one\'s protocol', async t => {
  const llm = require('../lib/llm');
  const keep = { ...process.env }; t.after(() => { for (const k of ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'AI_MODEL', 'AI_GEN_MODEL']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } });
  for (const k of ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'AI_MODEL', 'AI_GEN_MODEL']) delete process.env[k];
  assert.equal(llm.provider(), null); assert.equal(llm.enabled(), false);
  await assert.rejects(llm.complete({ system: 's', user: 'u' }), /not configured/);

  process.env.GEMINI_API_KEY = 'AQ.test'; assert.equal(llm.provider(), 'gemini');
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; assert.equal(llm.provider(), 'anthropic', 'Anthropic wins when both are set');
  process.env.AI_PROVIDER = 'gemini'; assert.equal(llm.provider(), 'gemini', 'AI_PROVIDER overrides');
  delete process.env.ANTHROPIC_API_KEY; delete process.env.AI_PROVIDER;

  let seen;
  const gemini = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"ok":' }, { text: 'true}' }] } }] }) }; };
  assert.equal(await llm.complete({ system: 'SYS', user: 'USER', json: true, purpose: 'write', fetch: gemini }), '{"ok":true}', 'joins parts and drops thought parts');
  assert.match(seen.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash:generateContent$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'AQ.test'); assert.ok(!seen.url.includes('AQ.test'), 'the key goes in a header, never the URL');
  assert.equal(seen.body.systemInstruction.parts[0].text, 'SYS'); assert.equal(seen.body.contents[0].parts[0].text, 'USER');
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');

  // an overloaded or withdrawn model falls through to the next; a bad key does not
  const tried = [], flaky = status => async url => { tried.push(url.match(/models\/([^:]+):/)[1]); return tried.length < 3 ? { ok: false, status, json: async () => ({ error: { message: 'busy' } }) } : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'fine' }] } }] }) }; };
  assert.equal(await llm.complete({ system: 's', user: 'u', purpose: 'mark', fetch: flaky(503) }), 'fine');
  assert.deepEqual(tried, ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'], 'marking tries the fast model first');
  tried.length = 0; await assert.rejects(llm.complete({ system: 's', user: 'u', fetch: async url => { tried.push(url); return { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) }; } }), /API key not valid/);
  assert.equal(tried.length, 1, 'a 400 is not retried on another model');
  tried.length = 0; await assert.rejects(llm.complete({ system: 's', user: 'u', fetch: async url => { tried.push(url); return { ok: false, status: 503, json: async () => ({}) }; } }), /AI HTTP 503/);
  assert.equal(tried.length, 3, 'gives up after the last model');

  process.env.AI_GEN_MODEL = 'gemini-custom'; await llm.complete({ system: 's', user: 'u', purpose: 'write', fetch: gemini }); assert.match(seen.url, /gemini-custom:generateContent/);
  await assert.rejects(llm.complete({ system: 's', user: 'u', fetch: async () => ({ ok: false, status: 400 }) }), /AI HTTP 400/);
  await assert.rejects(llm.complete({ system: 's', user: 'u', fetch: async () => ({ ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }) }), /SAFETY/);

  // and a whole task through Gemini: validated exactly like any other provider's reply
  delete process.env.AI_GEN_MODEL;
  const viaGemini = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(mcq()) }] } }] }) });
  const task = await generateTask({ role, skill, type: 'mcq', difficulty: 2 }, { fetch: viaGemini });
  assert.equal(task.type, 'mcq'); assert.equal(task.mcq.options[task.mcq.correct], 'Round once at the end');
});

test('API: generate -> answer -> signed evidence, private to the person who asked', async t => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; t.after(() => { delete process.env.ANTHROPIC_API_KEY; });
  const s = await start({ fetch: modelSays(mcq()) }); t.after(s.stop);
  const key = newKey(), other = newKey();

  assert.equal((await gen(s, { skillId: 'debugging', type: 'mcq' })).status, 401, 'needs an owner key');
  assert.equal((await gen(s, { skillId: 'no-such-skill' }, key)).status, 400);

  const g = await gen(s, { skillId: 'debugging', type: 'mcq', difficulty: 2 }, key);
  assert.equal(g.status, 200); const task = g.json.task;
  assert.ok(task.generated && task.id.startsWith('gen_'));
  assert.ok(!JSON.stringify(task).includes('"correct"') && !JSON.stringify(task).includes('explain'), 'answers never leave the server');

  const stored = s.app.db.generatedById(task.id).task, right = stored.mcq.correct;
  assert.equal((await s.call('POST', '/api/submit', { taskId: task.id, answer: { choice: right } }, other)).status, 404, 'another person cannot use it');
  const miss = await s.call('POST', '/api/submit', { taskId: task.id, answer: { choice: (right + 1) % 4 } }, key);
  assert.equal(miss.json.passed, false);
  const hit = await s.call('POST', '/api/submit', { taskId: task.id, answer: { choice: right }, studentName: 'Ada' }, key);
  assert.equal(hit.json.passed, true); assert.equal(hit.json.evidence.aiGeneratedTask, true);
  const check = await s.call('POST', '/api/verify', { records: [hit.json.evidence] });
  assert.equal(check.json.results[0].valid, true, 'signature covers the AI flag');
  const tampered = { ...hit.json.evidence, aiGeneratedTask: false };
  assert.equal((await s.call('POST', '/api/verify', { records: [tampered] })).json.results[0].valid, false);

  const mine = await s.call('GET', '/api/mine', null, key);
  assert.equal(mine.json.tasks.length, 1); assert.equal(mine.json.tasks[0].id, task.id);
  assert.equal((await s.call('GET', '/api/mine', null, other)).json.tasks.length, 0);
  await s.call('DELETE', '/api/mine', null, key);
  assert.equal(s.app.db.generatedById(task.id), null, 'erasing yourself removes generated tasks');
});

test('API: written AI tasks are graded by the AI, and never scored without it', async t => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; t.after(() => { delete process.env.ANTHROPIC_API_KEY; });
  let aiUp = false;
  const aiGrade = async task => { if (!aiUp) throw new Error('AI HTTP 500'); return { rubric: task.written.rubric.map(r => ({ id: r.id, label: r.label, weight: r.weight, score: 1, comment: 'Good.' })), feedback: 'Well done.' }; };
  const s = await start({ fetch: modelSays(written()), aiGrade }); t.after(s.stop);
  const key = newKey(), id = (await gen(s, { skillId: 'communication', type: 'written' }, key)).json.task.id;
  const text = 'I am sorry about the wrong total. We will fix your invoice today and email you a corrected copy within one working day.';
  const down = await s.call('POST', '/api/submit', { taskId: id, answer: { text } }, key);
  assert.equal(down.status, 503); assert.match(down.json.error, /not available/);
  assert.equal(s.app.db.evidenceForOwner(require('../lib/sign').sha256(key)).length, 0, 'no evidence without a real mark');
  aiUp = true;
  const up = await s.call('POST', '/api/submit', { taskId: id, answer: { text } }, key);
  assert.equal(up.status, 200); assert.equal(up.json.mode, 'ai'); assert.equal(up.json.passed, true); assert.ok(up.json.evidence);
});

test('API: code tasks keep scoring by hidden tests; AI only adds a review', async t => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; t.after(() => { delete process.env.ANTHROPIC_API_KEY; });
  const s = await start({ fetch: modelSays(code()), aiReview: async () => 'Nice use of filter.' }); t.after(s.stop);
  const key = newKey(), id = (await gen(s, { skillId: 'problem-solving', type: 'code' }, key)).json.task.id;
  const good = await s.call('POST', '/api/submit', { taskId: id, answer: { code: 'function sumEven(nums) { return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b, 0); }' } }, key);
  assert.equal(good.json.score, 100); assert.match(good.json.feedback, /Nice use of filter/);
  const bad = await s.call('POST', '/api/submit', { taskId: id, answer: { code: 'function sumEven(nums) { return 0; }' } }, key);
  assert.ok(bad.json.score < 100); assert.equal(bad.json.mode, 'auto');
});

test('API: daily limit protects the AI bill', async t => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.GEN_DAILY_LIMIT = '2';
  t.after(() => { delete process.env.ANTHROPIC_API_KEY; delete process.env.GEN_DAILY_LIMIT; });
  const s = await start({ fetch: modelSays(mcq()) }); t.after(s.stop);
  const key = newKey();
  assert.equal((await gen(s, { skillId: 'debugging', type: 'mcq' }, key)).status, 200);
  assert.equal((await gen(s, { skillId: 'debugging', type: 'mcq' }, key)).status, 200);
  assert.equal((await gen(s, { skillId: 'debugging', type: 'mcq' }, key)).status, 429);
});

test('API: a model that keeps failing gives a friendly error, not a crash', async t => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; t.after(() => { delete process.env.ANTHROPIC_API_KEY; });
  const s = await start({ fetch: modelSays({ title: 'x' }) }); t.after(s.stop);
  const r = await gen(s, { skillId: 'debugging', type: 'mcq' }, newKey());
  assert.equal(r.status, 502); assert.match(r.json.error, /try again/i);
});

test('skill levels count evidence from tasks that are not in the list (AI-written)', () => {
  const sk = [{ id: 'debugging' }], list = [];
  const ev = [{ taskId: 'gen_a', score: 90, skills: { debugging: 3 } }, { taskId: 'gen_b', score: 80, skills: { debugging: 3 } }];
  const lv = Skills.levelsFromEvidence(ev, list, sk);
  assert.equal(lv.debugging.tasksDone, 2); assert.ok(lv.debugging.level > 0);
});

test('.env loader: real variables win, quotes and comments handled', t => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-env-')), '.env');
  fs.writeFileSync(f, '# comment\nSB_TEST_A="hello"\nSB_TEST_B=world\nSB_TEST_C=\nSB_TEST_KEEP=fromfile\n');
  process.env.SB_TEST_KEEP = 'real'; t.after(() => ['SB_TEST_A', 'SB_TEST_B', 'SB_TEST_C', 'SB_TEST_KEEP'].forEach(k => delete process.env[k]));
  assert.equal(envLoader.load(f), 2);
  assert.equal(process.env.SB_TEST_A, 'hello'); assert.equal(process.env.SB_TEST_B, 'world');
  assert.equal(process.env.SB_TEST_KEEP, 'real'); assert.equal(process.env.SB_TEST_C, undefined);
  assert.equal(envLoader.load(path.join(os.tmpdir(), 'nope', '.env')), 0);
  assert.equal(envLoader.load(f, { override: true }), 3, 'override lets the file win over an existing variable');
  assert.equal(process.env.SB_TEST_KEEP, 'fromfile');
});

test('API: generation runs as a background job that only its owner can poll', async t => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; t.after(() => { delete process.env.ANTHROPIC_API_KEY; });
  let release; const gate = new Promise(r => { release = r; });
  const s = await start({ generate: async opts => { await gate; return require('../lib/generate').parseAndBuild(JSON.stringify(mcq()), { role, skill, type: 'mcq', difficulty: 2 }); } }); t.after(s.stop);
  const key = newKey(), other = newKey();
  const a = await s.call('POST', '/api/generate', { skillId: 'debugging', type: 'mcq' }, key);
  assert.equal(a.status, 202); assert.match(a.json.job, /^job_[a-f0-9]{16}$/, 'returns at once, before the AI has finished');
  const again = await s.call('POST', '/api/generate', { skillId: 'debugging', type: 'mcq' }, key);
  assert.equal(again.json.job, a.json.job, 'one job at a time per person: the second ask reuses it');
  assert.equal((await s.call('GET', '/api/generate/' + a.json.job, null, key)).json.status, 'working');
  assert.equal((await s.call('GET', '/api/generate/' + a.json.job, null, other)).status, 404, 'another person cannot read the job');
  assert.equal((await s.call('GET', '/api/generate/' + a.json.job)).status, 401);
  assert.equal((await s.call('GET', '/api/generate/job_0000000000000000', null, key)).status, 404);
  release();
  let done; for (let i = 0; i < 200 && !done; i++) { const j = await s.call('GET', '/api/generate/' + a.json.job, null, key); if (j.json.status === 'done') done = j.json; else await new Promise(r => setTimeout(r, 10)); }
  assert.ok(done && done.task.generated && !JSON.stringify(done.task).includes('"correct"'));
  const next = await s.call('POST', '/api/generate', { skillId: 'debugging', type: 'mcq' }, key);
  assert.notEqual(next.json.job, a.json.job, 'a finished job does not block the next one');
});
