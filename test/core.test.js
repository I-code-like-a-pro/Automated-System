'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const signer = require('../lib/sign');
const { grade, publicTask, heuristicWritten } = require('../lib/grade');
const { runTests } = require('../lib/sandbox');
const Skills = require('../public/skills.js');
const tasks = require('../data/tasks.json');
const roles = require('../data/roles.json');
const byId = Object.fromEntries(tasks.map(t => [t.id, t]));

test('canonical JSON ignores key order', () => {
  assert.equal(signer.canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), signer.canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test('signed evidence verifies, and any change is detected (Ed25519)', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'sb-keys-'));
  const keys = signer.loadKeys(dir), other = signer.loadKeys(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'sb-keys-')));
  const rec = signer.sign(keys, { id: 'ev_1', score: 90, studentName: 'Ada' });
  assert.equal(rec.alg, 'Ed25519'); assert.equal(rec.keyId, keys.keyId);
  assert.equal(signer.verify(keys, rec), true);
  assert.equal(signer.verify(keys, { ...rec, score: 100 }), false, 'score tampering');
  assert.equal(signer.verify(keys, { ...rec, studentName: 'Bob' }), false, 'name tampering');
  assert.equal(signer.verify(keys, { ...rec, keyId: other.keyId }), false, 'swapped key id');
  assert.equal(signer.verify(other, rec), false, 'a different issuer key');
  assert.equal(signer.verify(keys, { id: 'x' }), false, 'missing signature');
  assert.equal(signer.verify(keys, { ...rec, alg: 'none' }), false, 'alg downgrade');
  assert.equal(signer.loadKeys(dir).keyId, keys.keyId, 'the key persists across restarts');
  assert.ok(require('node:fs').readFileSync(require('node:path').join(dir, 'signing-key.pem'), 'utf8').includes('PRIVATE KEY'));
});

test('public tasks never contain answers', () => {
  tasks.forEach(t => {
    const json = JSON.stringify(publicTask(t));
    assert.ok(!/"correct"|"scores"|"explain"|"keywords"/.test(json), t.id + ' leaks an answer field');
    if (t.code) {
      const pub = publicTask(t).code;
      assert.ok(pub.samples.length >= 1 && pub.hiddenCount >= 1, t.id + ' needs samples and hidden tests');
      assert.equal(pub.samples.length + pub.hiddenCount, t.code.tests.length);
    }
  });
});

test('mcq grading', async () => {
  const t = byId['cart-total-off-by-one'];
  const good = await grade(t, { choice: t.mcq.correct });
  assert.equal(good.score, 100); assert.equal(good.passed, true);
  const bad = await grade(t, { choice: (t.mcq.correct + 1) % t.mcq.options.length });
  assert.equal(bad.score, 0); assert.equal(bad.passed, false);
  assert.ok((await grade(t, { choice: 99 })).error);
});

test('scenario grading averages the step scores', async () => {
  const t = byId['merge-conflict'];
  const best = await grade(t, { choices: t.scenario.steps.map(s => s.scores.indexOf(Math.max(...s.scores))) });
  assert.equal(best.score, 100);
  const worst = await grade(t, { choices: t.scenario.steps.map(s => s.scores.indexOf(Math.min(...s.scores))) });
  assert.ok(worst.score < 20 && !worst.passed);
  assert.ok((await grade(t, { choices: [0] })).error, 'wrong number of steps');
});

test('code grading runs hidden tests in the sandbox', async () => {
  const t = byId['fizzbuzz'];
  const good = await grade(t, { code: "function fizzbuzz(n){ if(n%15===0) return 'FizzBuzz'; if(n%3===0) return 'Fizz'; if(n%5===0) return 'Buzz'; return String(n); }" });
  assert.equal(good.score, 100);
  const cheat = await grade(t, { code: "function fizzbuzz(n){ return n===3?'Fizz':n===5?'Buzz':String(n); }" });   // passes only the visible samples
  assert.ok(cheat.score < 100 && cheat.score > 0, 'hard-coding the samples must not earn full marks, got ' + cheat.score);
});

test('sandbox survives endless loops, missing functions and attempts to reach Node', async () => {
  const loop = await runTests({ code: 'function f(){ while(true){} }', fn: 'f', tests: [{ args: [], expect: 1 }] });
  assert.equal(loop[0].ok, false);
  const missing = await runTests({ code: 'var x = 1;', fn: 'f', tests: [{ args: [], expect: 1 }] });
  assert.match(missing[0].err, /Define a function/);
  const evil = await runTests({ code: "function f(){ return typeof process + typeof require; }", fn: 'f', tests: [{ args: [], expect: 'undefinedundefined' }] });
  assert.equal(evil[0].ok, true, 'process and require must not exist inside the sandbox');
  const escape = await runTests({ code: "function f(){ try { return this.constructor.constructor('return process')().pid; } catch (e) { return 'blocked'; } }", fn: 'f', tests: [{ args: [], expect: 'blocked' }] });
  assert.equal(escape[0].ok, true, 'string code generation is disabled');
});

test('written grading: a good answer passes, keyword stuffing and empty effort do not', async () => {
  const t = byId['review-password-pr'];
  const good = await grade(t, { text: "Thanks for the PR! One concern: the password is stored in plain text, so if the database leaks an attacker gets every user's password. Could we hash it with bcrypt and a per-user salt before inserting? Happy to pair on it if useful." });
  assert.ok(good.passed && good.score >= 85, 'good score ' + good.score);
  const stuffed = await grade(t, { text: 'plain text leak hash salt please bcrypt attacker plain text leak hash salt please bcrypt attacker plain text leak hash salt please bcrypt attacker plain text leak hash salt' });
  assert.ok(stuffed.score < good.score && stuffed.score < 60, 'stuffing score ' + stuffed.score);
  const lazy = await grade(t, { text: 'looks fine to me, ship it, nice work everyone on this' });
  assert.equal(lazy.passed, false);
  assert.match(heuristicWritten(t, 'x y z').feedback, /Automatic checklist/);
});

test('AI grading is used when available and clamps scores; failures fall back to the rubric', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const t = byId['status-update'];
    const fake = async () => ({ rubric: t.written.rubric.map(r => ({ id: r.id, label: r.label, weight: r.weight, score: 1, comment: 'ok' })), feedback: 'Nice.' });
    const ai = await grade(t, { text: 'Fixed checkout today; CSV export is half done; waiting on design for wording; next I will finish the export tomorrow.' }, { aiGrade: fake });
    assert.equal(ai.mode, 'ai'); assert.equal(ai.score, 100);
    const broken = await grade(t, { text: 'Fixed checkout today; CSV export is half done; waiting on design for wording; next I will finish the export tomorrow.' }, { aiGrade: async () => { throw new Error('down'); } });
    assert.equal(broken.mode, 'rubric');
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

test('skills: claimed comes from coursework, verified comes from evidence', () => {
  const skills = roles['software-engineer'].skills;
  const claimed = Skills.claimedFromCoursework('Data Structures, Software Engineering, Git club, group project', skills);
  assert.ok(claimed['version-control'].claimed > 0 && claimed['problem-solving'].claimed > 0);
  assert.ok(Object.values(claimed).every(c => c.claimed <= 60), 'claims are capped: coursework is not proof');
  const list = tasks.filter(t => t.role === 'software-engineer');
  const none = Skills.levelsFromEvidence([], list, skills);
  assert.equal(none.debugging.level, 0);
  const one = Skills.levelsFromEvidence([{ taskId: 'cart-total-off-by-one', score: 100 }], list, skills);
  const many = Skills.levelsFromEvidence(['cart-total-off-by-one', 'admin-assignment-bug', 'async-foreach'].map(id => ({ taskId: id, score: 100 })), list, skills);
  assert.ok(one.debugging.level < many.debugging.level, 'more evidence gives more confidence');
  assert.ok(one.debugging.level <= 50, 'a single task cannot prove mastery');
  assert.ok(many.debugging.level >= 70, 'three strong debugging tasks reach employer level');
  const recs = Skills.recommend(none, list, [], 70, 3);
  assert.equal(recs.length, 3);
});

test('the best answer is spread across positions, so guessing "always A" does not work', () => {
  const pos = [];
  tasks.forEach(t => {
    if (t.mcq) pos.push(t.mcq.correct);
    if (t.scenario) t.scenario.steps.forEach(s => pos.push(s.scores.indexOf(Math.max(...s.scores))));
  });
  const counts = {}; pos.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
  assert.ok(Object.keys(counts).length >= 3, 'uses at least three positions: ' + JSON.stringify(counts));
  assert.ok(Math.max(...Object.values(counts)) / pos.length <= 0.5, 'no position holds more than half of the answers: ' + JSON.stringify(counts));
  tasks.filter(t => t.mcq).forEach(t => assert.ok(/^Right|^Good/.test(t.mcq.explain[t.mcq.correct]) || t.mcq.explain[t.mcq.correct].length > 0, t.id));
});
