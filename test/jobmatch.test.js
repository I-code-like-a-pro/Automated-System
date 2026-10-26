'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JobMatch = require('../public/jobmatch.js');
const Skills = require('../public/skills.js');
const roles = require('../data/roles.json'), tasks = require('../data/tasks.json');
const role = roles['software-engineer'];
const list = tasks.filter(t => t.role === 'software-engineer');
const levelsFor = ids => Skills.levelsFromEvidence(ids.map(id => ({ taskId: id, score: 100 })), list, role.skills);
const ad = JobMatch.SAMPLES[0].text;

test('a pasted ad is turned into skill requirements', () => {
  const r = JobMatch.analyse(ad, role, levelsFor([]), list, []);
  const ids = r.found.map(f => f.skillId);
  ['problem-solving', 'debugging', 'testing', 'version-control', 'code-review', 'communication', 'requirements', 'security', 'teamwork'].forEach(id => assert.ok(ids.includes(id), 'finds ' + id));
  r.found.forEach(f => assert.ok(f.requirement >= 55 && f.requirement <= 85, f.skillId + ' requirement ' + f.requirement));
  assert.ok(r.notAssessed.includes('sql') && r.notAssessed.includes('docker') && r.notAssessed.includes('aws'), 'names tools it cannot assess: ' + r.notAssessed);
});

test('readiness rises as the student earns verified evidence, and never exceeds what is proven', () => {
  const none = JobMatch.analyse(ad, role, levelsFor([]), list, []);
  assert.equal(none.readiness, 0); assert.equal(none.strengths.length, 0); assert.ok(none.gaps.length >= 8);
  const some = ['cart-total-off-by-one', 'async-foreach', 'sort-mutates', 'interval-leak', 'safe-average', 'fizzbuzz', 'slugify'];
  const mid = JobMatch.analyse(ad, role, levelsFor(some), list, some.map(id => ({ taskId: id })));
  assert.ok(mid.readiness > none.readiness && mid.readiness < 100, 'partial readiness ' + mid.readiness);
  assert.ok(mid.strengths.some(s => s.skillId === 'debugging'), 'debugging evidence counts');
  const all = list.map(t => t.id), full = JobMatch.analyse(ad, role, levelsFor(all), list, all.map(id => ({ taskId: id })));
  assert.equal(full.readiness, 100); assert.equal(full.plan.length, 0, 'nothing left to practise');
});

test('the plan targets the gaps this ad cares about, skipping tasks already passed', () => {
  const passed = ['cart-total-off-by-one'];
  const r = JobMatch.analyse(ad, role, levelsFor(passed), list, passed.map(id => ({ taskId: id })));
  assert.ok(r.plan.length > 0 && r.plan.length <= 4);
  assert.ok(!r.plan.some(t => passed.includes(t.id)), 'does not suggest finished tasks');
  assert.ok(r.planMinutes > 0);
  const security = JobMatch.analyse(JobMatch.SAMPLES[2].text, role, levelsFor([]), list, []);
  assert.ok(security.plan.some(t => t.skills.security), 'a security-heavy ad recommends a security task');
});

test('very short or empty ads are rejected, and ads with no recognised skills give an honest empty result', () => {
  assert.ok(JobMatch.analyse('', role, levelsFor([]), list, []).error);
  assert.ok(JobMatch.analyse('hiring now', role, levelsFor([]), list, []).error);
  const odd = JobMatch.analyse('We make artisanal sourdough bread and need someone who loves mornings and flour very much indeed.', role, levelsFor([]), list, []);
  assert.equal(odd.found.length, 0); assert.equal(odd.readiness, 0);
});

test('the tailored pack leads with the most relevant evidence', () => {
  const ev = [{ id: 'a', taskId: 'x', score: 90, skills: { security: 3 } }, { id: 'b', taskId: 'y', score: 70, skills: { debugging: 2, testing: 1 } }, { id: 'c', taskId: 'z', score: 100, skills: { 'code-review': 1 } }];
  const result = { skillIds: ['debugging', 'testing'] };
  assert.deepEqual(JobMatch.pack(result, ev).map(e => e.id), ['b'], 'only evidence relevant to the ad');
  assert.deepEqual(JobMatch.pack({ skillIds: ['debugging', 'testing', 'security'] }, ev).map(e => e.id), ['b', 'a'], 'more matching skills first');
});
