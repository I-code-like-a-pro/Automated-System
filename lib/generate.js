'use strict';
/* AI task generator. Asks Claude to write a fresh workplace task in the same shape as data/tasks.json, then refuses anything
   that does not pass strict checks, so a bad AI reply can never reach a student:
     - shape and length checks for every field
     - answer positions are shuffled HERE (models like to put the right answer first)
     - code tasks must ship a reference solution; it has to pass every test in the sandbox, and the starter has to fail some,
       so a broken or trivial test suite is rejected
   Answer keys, hidden tests and the solution stay on the server. Needs an AI key (see lib/llm.js). */
const crypto = require('node:crypto');
const { runTests } = require('./sandbox');
const llm = require('./llm');

const TYPES = ['mcq', 'scenario', 'code', 'written'];
const SETTINGS = ['an online shop', 'a hospital booking app', 'a bank\'s mobile app', 'a delivery company', 'a school portal', 'a ride-hailing startup', 'a news website', 'a farming co-operative\'s dashboard', 'a government services site', 'a small SaaS team', 'a telecom billing system', 'a logistics tracker'];
const FIRST = ['Dana', 'Sam', 'Priya', 'Tunde', 'Mei', 'Carlos', 'Amara', 'Jon', 'Ines', 'Kofi'];
const TITLES = ['Engineering Manager', 'Senior Developer', 'Developer', 'Tech Lead', 'QA Engineer', 'Product Manager'];

const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const pick = list => list[crypto.randomInt(list.length)];
const fail = msg => { throw new Error('Generated task rejected: ' + msg); };

function shuffle(n) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- the prompt ---------- */
function buildPrompt({ role, skill, type, difficulty, avoid }) {
  const shape = {
    mcq: '{"title","brief","from":{"name","title"},"minutes":3-10,"mcq":{"code":"short snippet or log (may be empty)","options":[4 strings],"correct":0-3,"explain":[4 strings, one per option, saying why it is right or wrong]}}',
    scenario: '{"title","brief","from":{"name","title"},"minutes":5-12,"scenario":{"steps":[2-4 x {"prompt","options":[4 strings],"scores":[4 numbers 0..1, exactly one is 1, a poor choice is 0],"explain":[4 strings]}]}}',
    code: '{"title","brief","from":{"name","title"},"minutes":5-15,"code":{"fn":"camelCaseName","starter":"function name(args) {\\n  // your code here\\n}","solution":"a complete correct JavaScript function","tests":[6-8 x {"args":[...JSON values],"expect":JSON value}]}} Include edge cases (empty input, boundaries). Plain JavaScript only, no imports, deterministic, no I/O.',
    written: '{"title","brief","from":{"name","title"},"minutes":6-15,"written":{"code":"optional snippet shown to the student (may be empty)","prompt":"what to write","minWords":25-80,"rubric":[3-5 x {"id":"short-slug","label":"what a good answer does","weight":1-3}]}}',
  }[type];
  const system = 'You write realistic, fair workplace tasks that test whether a university graduate can do the job of a ' + role.title + '. ' +
    'A colleague gives the brief, as in a real first week. The task must be answerable from the brief alone, have ONE clearly best answer (or a clear rubric), and avoid trick questions. ' +
    'Reply with a single JSON object and nothing else. No markdown fences.';
  const user = 'Skill to test: ' + skill.name + ' (' + skill.desc + ')\nTask type: ' + type + '\nDifficulty: ' + difficulty + ' on a scale of 1 (easy) to 3 (hard)\nSetting: ' + pick(SETTINGS) +
    '\nColleague: ' + pick(FIRST) + ', ' + pick(TITLES) + (avoid.length ? '\nDo not repeat these existing task titles: ' + avoid.slice(0, 12).join('; ') : '') +
    '\n\nJSON shape: ' + shape;
  return { system, user };
}

/* ---------- validation ---------- */
function checkCommon(t) {
  if (!t || typeof t !== 'object') fail('not an object');
  if (!str(t.title, 6, 90)) fail('title');
  if (!str(t.brief, 40, 900)) fail('brief');
  if (!t.from || !str(t.from.name, 2, 30) || !str(t.from.title, 2, 40)) fail('colleague');
  const minutes = Math.round(Number(t.minutes));
  if (!(minutes >= 2 && minutes <= 30)) fail('minutes');
  return minutes;
}
const optionsOk = (o, n = 4) => Array.isArray(o) && o.length === n && o.every(x => str(x, 2, 260)) && new Set(o.map(x => x.trim().toLowerCase())).size === n;

function buildMcq(t) {
  const m = t.mcq || fail('missing mcq');
  if (!optionsOk(m.options) || !Array.isArray(m.explain) || m.explain.length !== 4 || !m.explain.every(x => str(x, 4, 400))) fail('mcq options');
  if (!Number.isInteger(m.correct) || m.correct < 0 || m.correct > 3) fail('mcq correct');
  if (m.code != null && (typeof m.code !== 'string' || m.code.length > 2000)) fail('mcq code');
  const order = shuffle(4);
  return { mcq: { code: m.code || '', options: order.map(i => m.options[i]), correct: order.indexOf(m.correct), explain: order.map(i => m.explain[i]) } };
}

function buildScenario(t) {
  const s = t.scenario || fail('missing scenario');
  if (!Array.isArray(s.steps) || s.steps.length < 2 || s.steps.length > 4) fail('scenario steps');
  const steps = s.steps.map((st, n) => {
    if (!st || !str(st.prompt, 10, 400) || !optionsOk(st.options)) fail('scenario step ' + (n + 1));
    if (!Array.isArray(st.scores) || st.scores.length !== 4 || !st.scores.every(x => typeof x === 'number' && x >= 0 && x <= 1)) fail('scenario scores');
    if (Math.max(...st.scores) !== 1) fail('scenario needs one best option');
    if (Math.min(...st.scores) > 0.3) fail('scenario needs a clearly poor option');
    if (!Array.isArray(st.explain) || st.explain.length !== 4 || !st.explain.every(x => str(x, 4, 400))) fail('scenario explain');
    const order = shuffle(4);
    return { prompt: st.prompt.trim(), options: order.map(i => st.options[i]), scores: order.map(i => st.scores[i]), explain: order.map(i => st.explain[i]) };
  });
  return { scenario: { steps } };
}

async function buildCode(t, deps) {
  const c = t.code || fail('missing code');
  if (typeof c.fn !== 'string' || !/^[a-zA-Z_$][\w$]{1,40}$/.test(c.fn)) fail('function name');
  if (!str(c.starter, 10, 1500) || !c.starter.includes(c.fn)) fail('starter');
  if (!str(c.solution, 10, 4000) || !c.solution.includes(c.fn)) fail('solution');
  if (!Array.isArray(c.tests) || c.tests.length < 5 || c.tests.length > 10) fail('test count');
  const tests = c.tests.map((x, i) => {
    if (!x || !Array.isArray(x.args) || x.args.length > 5 || !('expect' in x)) fail('test ' + (i + 1));
    try { JSON.stringify(x); } catch (e) { fail('test ' + (i + 1) + ' not JSON'); }
    if (JSON.stringify(x).length > 600) fail('test ' + (i + 1) + ' too large');
    return { args: x.args, expect: x.expect };
  });
  if (new Set(tests.map(x => JSON.stringify(x.args))).size < tests.length) fail('duplicate tests');
  const run = deps.runTests || runTests;
  // the reference solution must pass every test, otherwise the tests (or the solution) are wrong
  const ref = await run({ code: c.solution, fn: c.fn, tests });
  if (!ref.length || !ref.every(r => r.ok)) fail('reference solution fails its own tests');
  // the untouched starter must not pass everything, otherwise there is nothing to do
  const start = await run({ code: c.starter, fn: c.fn, tests });
  if (start.every(r => r.ok)) fail('starter already passes');
  tests.forEach((x, i) => { x.public = i < 2; });
  return { code: { fn: c.fn, starter: c.starter, tests } };
}

function buildWritten(t) {
  const w = t.written || fail('missing written');
  if (!str(w.prompt, 8, 300)) fail('prompt');
  if (w.code != null && (typeof w.code !== 'string' || w.code.length > 2000)) fail('written code');
  const minWords = Math.round(Number(w.minWords));
  if (!(minWords >= 15 && minWords <= 150)) fail('minWords');
  if (!Array.isArray(w.rubric) || w.rubric.length < 3 || w.rubric.length > 5) fail('rubric size');
  const seen = new Set();
  const rubric = w.rubric.map((r, i) => {
    if (!r || !str(r.label, 8, 160)) fail('rubric label');
    const weight = Math.round(Number(r.weight));
    if (!(weight >= 1 && weight <= 3)) fail('rubric weight');
    let id = String(r.id || 'c' + (i + 1)).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24) || 'c' + (i + 1);
    if (seen.has(id)) id = 'c' + (i + 1); seen.add(id);
    return { id, label: r.label.trim(), weight };
  });
  return { written: { code: w.code || '', prompt: w.prompt.trim(), minWords, rubric } };   // no keywords: only the AI grader can mark it
}

/* turn the model's raw text into a validated, ready-to-store task. Exported so tests can feed it canned replies. */
async function parseAndBuild(raw, ctx, deps = {}) {
  const m = String(raw).match(/\{[\s\S]*\}/); if (!m) fail('no JSON in reply');
  let t; try { t = JSON.parse(m[0]); } catch (e) { fail('invalid JSON'); }
  const minutes = checkCommon(t);
  const body = ctx.type === 'mcq' ? buildMcq(t) : ctx.type === 'scenario' ? buildScenario(t) : ctx.type === 'code' ? await buildCode(t, deps) : buildWritten(t);
  return {
    id: 'gen_' + crypto.randomBytes(6).toString('hex'), role: ctx.role.id, type: ctx.type, difficulty: ctx.difficulty, minutes, generated: true,
    title: t.title.trim(), skills: { [ctx.skill.id]: 3 }, from: { name: t.from.name.trim(), title: t.from.title.trim() }, brief: t.brief.trim(), ...body,
  };
}

const callModel = (prompt, fetchImpl) => llm.complete({ system: prompt.system, user: prompt.user, maxTokens: 3000, timeoutMs: 30000, json: true, purpose: 'write', fetch: fetchImpl });

/* ask, validate, and retry once with a fresh sample if the reply is rejected */
async function generateTask(opts, deps = {}) {
  const { role, skill } = opts;
  const type = TYPES.includes(opts.type) ? opts.type : pick(TYPES), difficulty = Math.max(1, Math.min(3, Math.round(Number(opts.difficulty)) || 2));
  const ctx = { role, skill, type, difficulty }, fetchImpl = deps.fetch || fetch;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await parseAndBuild(await callModel(buildPrompt({ ...ctx, avoid: opts.avoid || [] }), fetchImpl), ctx, deps); }
    catch (e) { lastErr = e; if (/AI HTTP (401|403|429)/.test(e.message)) break; }
  }
  throw lastErr;
}

module.exports = { generateTask, parseAndBuild, buildPrompt, TYPES };
