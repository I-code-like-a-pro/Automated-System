'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const courses = require('../lib/courses');
const { createApp } = require('../server');

/* ---------- canned model replies for a course on something that is not programming ---------- */
const outline = over => ({ refuse: false, reason: '', title: 'Personal Budgeting Basics', summary: 'Learn how to plan, track and improve your own money so that you spend on purpose, save for goals and handle surprises calmly.', audience: 'Anyone starting to manage their own money', level: 'beginner', kind: 'general',
  outcomes: ['Learners will be able to build a monthly budget', 'Learners will be able to separate needs from wants', 'Learners will be able to set a savings goal', 'Learners will be able to plan for emergencies'],
  modules: [1, 2, 3].map(i => ({ title: 'Module ' + i + ' topic', summary: 'What module ' + i + ' covers in one sentence.', lessons: [{ title: 'Lesson ' + i + '.1 idea', minutes: 8 }, { title: 'Lesson ' + i + '.2 practice', minutes: 10 }] })),
  disclaimer: 'This course is educational and not personal financial advice.', ...over });
const para = 'A budget is a plan for your money that says where each unit of income will go before the month starts, so spending becomes a choice instead of a surprise. ';
const lessonJson = over => ({ intro: 'In this lesson you will learn to plan money on purpose. It builds on the previous lesson.', sections: [{ heading: 'The idea', body: para.repeat(2) }, { heading: 'How to do it', body: '- List income\n\n- List fixed costs\n\n' + para }, { heading: 'Common mistakes', body: para.repeat(2) }],
  example: { title: 'Ada plans her month', scenario: 'Ada earns 1,000 a month and has rent of 400, food of 250 and transport of 100.', walkthrough: 'She subtracts fixed costs, finds 250 left, assigns 100 to savings and keeps 150 for wants, then checks the total equals her income.' },
  keyTerms: [{ term: 'Budget', meaning: 'A plan for spending and saving.' }, { term: 'Fixed cost', meaning: 'A bill that stays the same each month.' }, { term: 'Surplus', meaning: 'Money left after planned spending.' }],
  checks: [{ question: 'What is a fixed cost?', answer: 'A bill that stays the same, like rent.' }, { question: 'Why check the total against income?', answer: 'To make sure every unit has a job.' }], recap: ['A budget plans money before it is spent.', 'Fixed costs come first.', 'Check your totals.'], ...over });
const mcqJson = i => ({ type: 'mcq', question: 'Question ' + i + ': which action best fits a good budget in this realistic situation?', options: ['Right answer ' + i, 'Wrong A ' + i, 'Wrong B ' + i, 'Wrong C ' + i], correct: 0, explain: ['Correct: it matches the plan.', 'Wrong: it ignores the plan.', 'Wrong: it hides the cost.', 'Wrong: it is unrealistic.'] });
const writtenJson = i => ({ type: 'written', question: 'Written ' + i + ': explain in a few sentences how you would plan for an unexpected expense.', minWords: 20, rubric: [{ label: 'Mentions an emergency fund', weight: 2 }, { label: 'Explains how to build it gradually', weight: 2 }, { label: 'Gives a realistic example', weight: 1 }] });
const questionsFor = (nm, nw) => ({ questions: [...Array(nm)].map((_, i) => mcqJson(i + 1)).concat([...Array(nw)].map((_, i) => writtenJson(i + 1))) });

/* a fake model: answers by recognising which prompt it was given */
function fakeModel(over = {}) {
  const calls = { outline: 0, lesson: 0, quiz: 0 };
  const complete = async ({ system, user }) => {
    if (/design short, practical online courses/.test(system)) { calls.outline++; return 'Here you go:\n' + JSON.stringify((over.outline || outline)()); }
    if (/writing ONE lesson/.test(system)) { calls.lesson++; return JSON.stringify(lessonJson()); }
    if (/fair assessment questions/.test(system)) { calls.quiz++; const m = /exactly (\d+) multiple-choice and (\d+) written/.exec(user); return JSON.stringify(over.questions ? over.questions(+m[1], +m[2]) : questionsFor(+m[1], +m[2])); }
    throw new Error('unexpected prompt');
  };
  return { complete, calls };
}
const gather = async () => ({ notes: '- Example: a household that tracks spending saves more (Source Org).', sources: [{ title: 'Source Org', url: 'https://example.org/budgeting' }], via: 'web-search', cached: false });
const okGrade = async task => ({ rubric: task.written.rubric.map(r => ({ id: r.id, label: r.label, weight: r.weight, score: 1, comment: 'Covered.' })), feedback: 'Well explained.' });

/* ---------------------------------------------------------------- unit: the engine */
test('createCourse: any topic becomes a validated outline', async () => {
  const c = await courses.createCourse({ topic: '  Personal   budgeting ', level: 'beginner' }, { ...fakeModel(), gather });
  assert.match(c.id, /^crs_[a-f0-9]{10}$/); assert.equal(c.topic, 'Personal budgeting'); assert.equal(c.modules.length, 3);
  assert.deepEqual(c.modules.map(m => m.id), ['m1', 'm2', 'm3']); assert.deepEqual(c.modules[0].lessons.map(l => l.id), ['l1-1', 'l1-2']);
  assert.equal(c.sources[0].url, 'https://example.org/budgeting'); assert.equal(c.research, 'web-search'); assert.match(c.disclaimer, /not personal financial advice/);
  await assert.rejects(courses.createCourse({ topic: 'ab' }, {}), /at least 3 letters/);
});

test('createCourse: refusals, bad replies and links', async () => {
  const refuse = { complete: async () => JSON.stringify({ refuse: true, reason: 'This asks for help hurting people.' }), gather };
  await assert.rejects(courses.createCourse({ topic: 'something harmful' }, refuse), e => e.user && e.status === 422 && /hurting people/.test(e.message));
  const model = o => ({ complete: async () => JSON.stringify(o), gather });
  await assert.rejects(courses.createCourse({ topic: 'Topic here' }, model(outline({ modules: outline().modules.slice(0, 2) }))), /rejected/);
  await assert.rejects(courses.createCourse({ topic: 'Topic here' }, model(outline({ title: '' }))), /rejected/);
  await assert.rejects(courses.createCourse({ topic: 'Topic here' }, model(outline({ outcomes: ['x'] }))), /rejected/);
  await assert.rejects(courses.createCourse({ topic: 'Topic here' }, { complete: async () => 'no json', gather }), /no JSON/);
  // a course based on a web page the author supplied: the page is read with the safe reader and listed as the source
  let seen; const readPage = async u => ({ url: u, title: 'Syllabus', text: 'Week 1: Budgeting. Week 2: Saving. '.repeat(10) });
  const c = await courses.createCourse({ topic: 'Money basics', sourceUrl: 'https://example.edu/syllabus' }, { complete: async o => { seen = o.user; return JSON.stringify(outline()); }, readPage, gather: async () => { throw new Error('should not search when a page was given'); } });
  assert.match(seen, /Syllabus/); assert.equal(c.research, 'page'); assert.equal(c.sources[0].title, 'Syllabus');
  await assert.rejects(courses.createCourse({ topic: 'Money basics', sourceUrl: 'http://10.0.0.1/' }, { complete: async () => '{}', readPage: async () => { throw new Error('That address is not a public website'); } }), e => e.user && /Could not use that link/.test(e.message));
  assert.match(seen, /NOT instructions/, 'fetched text is marked as data');
});

test('writeLesson: research is gathered for the lesson and its sources are kept', async () => {
  const c = await courses.createCourse({ topic: 'Personal budgeting' }, { ...fakeModel(), gather });
  let focus; const l = await courses.writeLesson(c, 'l2-1', { ...fakeModel(), gather: async a => { focus = a.focus; return gather(); } });
  assert.equal(focus, 'Lesson 2.1 idea'); assert.equal(l.title, 'Lesson 2.1 idea'); assert.equal(l.moduleId, 'm2'); assert.equal(l.sources.length, 1); assert.equal(l.research, 'web-search');
  await assert.rejects(courses.writeLesson(c, 'l9-9', fakeModel()), e => e.status === 404);
  const broken = { ...fakeModel(), complete: async () => JSON.stringify(lessonJson({ sections: [{ heading: 'x', body: 'short' }] })), gather };
  await assert.rejects(courses.writeLesson(c, 'l1-1', broken), /rejected/);
});

test('writeAssessment: right counts, shuffled keys, answers never in the public view', async () => {
  const c = await courses.createCourse({ topic: 'Personal budgeting' }, { ...fakeModel(), gather });
  const positions = new Set();
  for (let i = 0; i < 12; i++) { const a = await courses.writeAssessment(c, 'm1', {}, fakeModel()); a.questions.filter(q => q.type === 'mcq').forEach(q => { assert.match(q.options[q.correct], /^Right answer/); positions.add(q.correct); }); }
  assert.ok(positions.size >= 3, 'correct answers are spread across positions');
  const a = await courses.writeAssessment(c, 'm1', {}, fakeModel());
  assert.deepEqual([a.questions.filter(q => q.type === 'mcq').length, a.questions.filter(q => q.type === 'written').length], [6, 1]);
  const f = await courses.writeAssessment(c, 'final', {}, fakeModel());
  assert.deepEqual([f.questions.filter(q => q.type === 'mcq').length, f.questions.filter(q => q.type === 'written').length], [8, 2]);
  const pub = JSON.stringify(courses.publicAttempt(a)); assert.ok(!pub.includes('"correct"') && !pub.includes('"explain"') && !pub.includes('Correct: it matches'), 'no answer key or explanation in the public view');
  // a model that returns too few good questions is rejected rather than shipping a short quiz
  await assert.rejects(courses.writeAssessment(c, 'm1', {}, fakeModel({ questions: () => questionsFor(3, 1) })), /not enough valid questions/);
  // invalid questions are dropped, the rest are used
  const mixed = fakeModel({ questions: (nm, nw) => { const q = questionsFor(nm + 2, nw); q.questions[0].options = ['same', 'same', 'b', 'c']; q.questions[1].correct = 9; return q; } });
  assert.equal((await courses.writeAssessment(c, 'm1', {}, mixed)).questions.filter(q => q.type === 'mcq').length, 6);
  await assert.rejects(courses.writeAssessment(c, 'm9', {}, fakeModel()), e => e.status === 404);
});

test('gradeAttempt: answer key for choices, AI for written, never scores without the marker', async () => {
  const c = await courses.createCourse({ topic: 'Personal budgeting' }, { ...fakeModel(), gather });
  const a = await courses.writeAssessment(c, 'm1', {}, fakeModel());
  const allRight = a.questions.map(q => (q.type === 'mcq' ? { choice: q.correct } : { text: 'I would keep an emergency fund and build it gradually, for example saving a little each month.' }));
  const top = await courses.gradeAttempt(a, allRight, { aiGrade: okGrade }); assert.equal(top.score, 100); assert.equal(top.passed, true);
  const wrong = a.questions.map(q => (q.type === 'mcq' ? { choice: (q.correct + 1) % 4 } : { text: 'I would keep an emergency fund and build it gradually, for example saving a little each month.' }));
  const low = await courses.gradeAttempt(a, wrong, { aiGrade: okGrade }); assert.equal(low.score, Math.round(2 / 8 * 100)); assert.equal(low.passed, false);   // written counts double
  assert.match(low.results[0].feedback, /The best answer/);
  await assert.rejects(courses.gradeAttempt(a, allRight.slice(1), { aiGrade: okGrade }), e => e.user && /Answer every question/.test(e.message));
  await assert.rejects(courses.gradeAttempt(a, allRight.map((x, i) => (i === 0 ? { choice: 7 } : x)), { aiGrade: okGrade }), e => e.user);
  await assert.rejects(courses.gradeAttempt(a, allRight.map(x => (x.text ? { text: 'x' } : x)), { aiGrade: okGrade }), e => e.user && /Write an answer/.test(e.message));
  await assert.rejects(courses.gradeAttempt(a, allRight, { aiGrade: async () => { throw new Error('AI HTTP 503'); } }), e => e.user && e.status === 503 && /not scored/.test(e.message));
  const partial = await courses.gradeAttempt(a, allRight, { aiGrade: async t => ({ rubric: t.written.rubric.map(r => ({ id: r.id, label: r.label, weight: r.weight, score: 0, comment: '' })), feedback: 'Off topic.' }) });
  assert.equal(partial.score, Math.round(6 / 8 * 100), 'a written answer scored zero costs its double weight');
});

test('eligibility: needs every module quiz and the final, computed from evidence', async () => {
  const c = await courses.createCourse({ topic: 'Personal budgeting' }, { ...fakeModel(), gather });
  const ev = (mid, score) => ({ id: 'ev_' + mid + score, courseId: c.id, taskId: courses.taskIdFor(c.id, mid), score });
  let r = courses.eligibility(c, [ev('m1', 90), ev('m2', 60)]);
  assert.equal(r.ok, false); assert.ok(r.missing.some(x => /Module 2/.test(x)) && r.missing.some(x => /Module 3/.test(x)) && r.missing.some(x => /final/.test(x)));
  r = courses.eligibility(c, [ev('m1', 90), ev('m2', 80), ev('m3', 70), ev('final', 90), ev('m2', 75), { id: 'ev_other', courseId: 'crs_other', taskId: 'course:crs_other:m1', score: 100 }]);
  assert.equal(r.ok, true); assert.equal(r.finalScore, 90); assert.equal(r.overall, Math.round((90 + 80 + 70) / 3 * 0.4 + 90 * 0.6)); assert.equal(r.grade, courses.gradeLabel(r.overall)); assert.equal(r.modules[1].score, 80, 'best attempt counts');
  assert.deepEqual([95, 85, 75].map(courses.gradeLabel), ['Distinction', 'Merit', 'Pass']);
});

/* ---------------------------------------------------------------- integration: the whole learner journey over HTTP */
async function start(deps) {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-course-'));
  const app = createApp({ dataDir: dir, deps });
  await new Promise(r => app.server.listen(0, r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, url, body, key) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
  const job = async (r, key) => { assert.equal(r.status, 202, JSON.stringify(r.json)); for (let i = 0; i < 300; i++) { const j = await call('GET', '/api/jobs/' + r.json.job, null, key); if (j.json.status !== 'working') return j.json; await new Promise(x => setTimeout(x, 10)); } throw new Error('job never finished'); };
  return { app, call, job, stop: () => new Promise(r => { delete process.env.ANTHROPIC_API_KEY; app.db.flushNow(); app.server.close(r); }) };
}
const newKey = () => crypto.randomBytes(24).toString('hex');

test('journey: create a course, learn, pass every quiz and the final, get a verifiable certificate', async t => {
  const model = fakeModel(); const s = await start({ complete: model.complete, gather, aiGrade: okGrade }); t.after(s.stop);
  const key = newKey(), other = newKey();

  assert.equal((await s.call('POST', '/api/courses', { topic: 'Budgeting' })).status, 401);
  assert.equal((await s.call('POST', '/api/courses', { topic: 'x' }, key)).status, 400);
  const made = await s.job(await s.call('POST', '/api/courses', { topic: 'Personal budgeting', level: 'beginner' }, key), key);
  assert.equal(made.status, 'done'); const course = made.course; assert.ok(course.id && course.modules.length === 3 && !('ownerHash' in course), 'no owner link in the public view');

  const list = await s.call('GET', '/api/courses?q=budget'); assert.equal(list.json.courses.length, 1); assert.equal(list.json.courses[0].lessons, 6); assert.ok(!JSON.stringify(list.json).includes('ownerHash'));
  assert.equal((await s.call('GET', '/api/courses?q=astronomy')).json.courses.length, 0);
  assert.equal((await s.call('GET', '/api/courses/' + course.id)).json.course.title, 'Personal Budgeting Basics');

  // a lesson is written the first time anyone opens it and is then shared
  const first = await s.job(await s.call('POST', '/api/courses/' + course.id + '/lessons/l1-1', null, key), key);
  assert.equal(first.lesson.title, 'Lesson 1.1 idea'); assert.equal(first.lesson.sources[0].title, 'Source Org');
  const again = await s.call('POST', '/api/courses/' + course.id + '/lessons/l1-1', null, other); assert.equal(again.status, 200, 'cached lesson is served to everyone at once'); assert.equal(model.calls.lesson, 1);
  assert.deepEqual((await s.call('GET', '/api/courses/' + course.id)).json.course.lessonsReady, ['l1-1']);
  assert.equal((await s.call('POST', '/api/courses/' + course.id + '/lessons/l9-9', null, key)).status, 404);

  const ids = course.modules.map(m => m.id).concat('final'), passed = {};
  for (const mid of ids) {
    const started = await s.job(await s.call('POST', '/api/courses/' + course.id + '/assessments', { moduleId: mid }, key), key);
    const att = started.attempt; assert.ok(!JSON.stringify(att).includes('"correct"'), 'no answers in the quiz the browser receives');
    const refresh = await s.call('POST', '/api/courses/' + course.id + '/assessments', { moduleId: mid }, key); assert.equal(refresh.status, 200); assert.equal(refresh.json.attempt.id, att.id, 'refreshing the page keeps the same quiz');
    const stored = s.app.db.attemptById(att.id), answers = stored.questions.map(q => (q.type === 'mcq' ? { choice: q.correct } : { text: 'Keep an emergency fund and build it gradually, for example saving a little each month.' }));
    if (mid === 'm1') {
      assert.equal((await s.call('POST', '/api/assessments/' + att.id + '/submit', { answers }, other)).status, 404, 'nobody else can submit your quiz');
      const wrong = await s.call('POST', '/api/assessments/' + att.id + '/submit', { answers: stored.questions.map(q => (q.type === 'mcq' ? { choice: (q.correct + 1) % 4 } : { text: 'I am not sure about this at all really.' })), studentName: 'Ada Learner' }, key);
      assert.equal(wrong.json.passed, false); assert.equal(wrong.json.evidence, null);
      assert.equal(s.app.db.attemptById(att.id), null, 'a quiz is single-use: the next attempt has new questions');
      const retry = await s.job(await s.call('POST', '/api/courses/' + course.id + '/assessments', { moduleId: mid }, key), key);
      assert.notEqual(retry.attempt.id, att.id); const st2 = s.app.db.attemptById(retry.attempt.id);
      const ok = await s.call('POST', '/api/assessments/' + retry.attempt.id + '/submit', { answers: st2.questions.map(q => (q.type === 'mcq' ? { choice: q.correct } : { text: 'Keep an emergency fund and build it gradually, for example saving a little each month.' })), studentName: 'Ada Learner', timeSpentSec: 90 }, key);
      passed[mid] = ok.json; continue;
    }
    passed[mid] = (await s.call('POST', '/api/assessments/' + att.id + '/submit', { answers, studentName: 'Ada Learner', timeSpentSec: 120 }, key)).json;
  }
  for (const mid of ids) { assert.equal(passed[mid].passed, true, mid); assert.ok(passed[mid].evidence && passed[mid].evidence.signature, mid); assert.equal(passed[mid].evidence.courseId, course.id); }
  assert.equal(passed.final.eligible, true); assert.deepEqual(passed.m1.missing.length > 0, true, 'after the first quiz there was still work to do');

  const v = await s.call('POST', '/api/verify', { records: [passed.m2.evidence] }); assert.equal(v.json.results[0].valid, true);

  const prog = (await s.call('GET', '/api/courses/' + course.id + '/progress', null, key)).json;
  assert.equal(prog.eligible, true); assert.equal(prog.final.score, 100); assert.equal(prog.quizzes.m1.score, 100); assert.equal(prog.certificate, null);

  assert.equal((await s.call('POST', '/api/courses/' + course.id + '/certificate', { studentName: 'Ada Learner' }, other)).status, 403, 'someone who has not passed gets nothing');
  assert.equal((await s.call('POST', '/api/courses/' + course.id + '/certificate', { studentName: '' }, key)).status, 400);
  const cert = (await s.call('POST', '/api/courses/' + course.id + '/certificate', { studentName: 'Ada Learner' }, key)).json.certificate;
  assert.match(cert.id, /^cert_[a-f0-9]+$/); assert.equal(cert.kind, 'certificate'); assert.equal(cert.studentName, 'Ada Learner'); assert.equal(cert.overallScore, 100); assert.equal(cert.grade, 'Distinction'); assert.equal(cert.evidenceIds.length, 4); assert.equal(cert.aiDesigned, true); assert.match(cert.statement, /not an accredited qualification/);
  assert.equal((await s.call('POST', '/api/courses/' + course.id + '/certificate', { studentName: 'Someone Else' }, key)).json.certificate.id, cert.id, 'one certificate per person per course');

  const ver = await s.call('GET', '/api/verify/' + cert.id); assert.equal(ver.json.valid, true); assert.equal(ver.json.evidence.courseTitle, 'Personal Budgeting Basics');
  assert.equal((await s.call('POST', '/api/verify', { records: [{ ...cert, grade: 'Distinction', overallScore: 100, studentName: 'Mallory' }] })).json.results[0].valid, false, 'changing the name breaks the signature');
  assert.equal((await s.call('POST', '/api/verify', { records: [{ ...cert, finalScore: 99 }] })).json.results[0].valid, false);
  assert.equal((await s.call('GET', '/api/mine', null, key)).json.certificates.length, 1);

  await s.call('DELETE', '/api/mine', null, key);
  assert.equal((await s.call('GET', '/api/verify/' + cert.id)).status, 404, 'erasing yourself removes the certificate');
  assert.equal((await s.call('GET', '/api/courses/' + course.id)).status, 200, 'but the shared course stays');
  assert.equal(s.app.db.courseById(course.id).ownerHash, null);
});

test('API: written marking outage means no score and no evidence; budgets and busy state are enforced', async t => {
  let aiUp = false; const model = fakeModel();
  const s = await start({ complete: model.complete, gather, aiGrade: async tk => { if (!aiUp) throw new Error('AI HTTP 503'); return okGrade(tk); } }); t.after(s.stop);
  const key = newKey(), course = (await s.job(await s.call('POST', '/api/courses', { topic: 'Personal budgeting' }, key), key)).course;
  const att = (await s.job(await s.call('POST', '/api/courses/' + course.id + '/assessments', { moduleId: 'm1' }, key), key)).attempt, st = s.app.db.attemptById(att.id);
  const answers = st.questions.map(q => (q.type === 'mcq' ? { choice: q.correct } : { text: 'Keep an emergency fund and build it gradually, for example saving a little each month.' }));
  const down = await s.call('POST', '/api/assessments/' + att.id + '/submit', { answers, studentName: 'Ada' }, key);
  assert.equal(down.status, 503); assert.match(down.json.error, /not scored/); assert.equal(s.app.db.evidenceForOwner(require('../lib/sign').sha256(key)).length, 0);
  assert.ok(s.app.db.attemptById(att.id), 'the quiz is kept so the learner can resubmit once the marker is back');
  aiUp = true; assert.equal((await s.call('POST', '/api/assessments/' + att.id + '/submit', { answers, studentName: 'Ada' }, key)).json.passed, true);

  process.env.QUIZ_DAILY_LIMIT = '1'; t.after(() => { delete process.env.QUIZ_DAILY_LIMIT; });
  assert.equal((await s.call('POST', '/api/courses/' + course.id + '/assessments', { moduleId: 'm2' }, key)).status, 429, 'daily quiz budget (already used one today) is enforced');
});

test('API: a second request while one is being written is refused politely, not duplicated', async t => {
  let release; const gate = new Promise(r => { release = r; }), model = fakeModel();
  const slow = async o => { if (/design short, practical/.test(o.system)) await gate; return model.complete(o); };
  const s = await start({ complete: slow, gather, aiGrade: okGrade }); t.after(s.stop);
  const key = newKey();
  const a = await s.call('POST', '/api/courses', { topic: 'Personal budgeting' }, key), same = await s.call('POST', '/api/courses', { topic: 'Personal budgeting' }, key);
  assert.equal(a.status, 202); assert.equal(same.json.job, a.json.job, 'asking again for the same thing joins the running job');
  assert.equal((await s.call('POST', '/api/generate', { skillId: 'debugging' }, key)).status, 409, 'a different request waits');
  release(); const done = await s.job(a, key); assert.equal(done.status, 'done'); assert.equal(model.calls.outline, 1);
});

/* ---------------------------------------------------------------- the hand-written sample course: no AI needed */
test('sample course: content is valid and every question has one clear answer', () => {
  const demo = require('../lib/democourse'), { helpers } = require('../lib/generate');
  courses.validateOutline({ ...demo.course, refuse: false, modules: demo.course.modules });
  Object.entries(demo.lessons).forEach(([id, l]) => courses.validateLesson(l));
  assert.deepEqual(Object.keys(demo.lessons).sort(), demo.course.modules.flatMap(m => m.lessons.map(l => l.id)).sort(), 'a lesson for every outline entry');
  for (const [mid, list] of Object.entries(demo.bank)) {
    assert.ok(list.length >= 5, mid);
    list.forEach(x => { assert.ok(helpers.optionsOk(x.options), x.question); assert.ok(x.correct >= 0 && x.correct <= 3 && x.explain.length === 4 && x.explain.every(e => e.length >= 4), x.question); });
  }   // (answer positions in the source do not matter: options are reshuffled on every attempt, checked below)
  const questions = Object.values(demo.bank).flat(); assert.equal(new Set(questions.map(x => x.question)).size, questions.length, 'no duplicate questions');
  const positions = new Set(); for (let i = 0; i < 30; i++) { const a = demo.attemptFromBank({ id: demo.ID, bank: demo.bank }, 'm2'); assert.equal(a.questions.length, 5); a.questions.forEach(x => positions.add(x.correct)); }
  assert.equal(positions.size, 4, 'options are reshuffled on every attempt');
  assert.equal(demo.attemptFromBank({ id: demo.ID, bank: demo.bank }, 'final').questions.length, 8); assert.equal(demo.attemptFromBank({ id: demo.ID, bank: demo.bank }, 'm9'), null);
});

test('sample course: the whole journey to a certificate works with the AI completely off', async t => {
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sample-')), app = createApp({ dataDir: dir, sampleCourse: true });
  await new Promise(r => app.server.listen(0, r)); t.after(() => new Promise(r => { app.db.flushNow(); app.server.close(r); }));
  const base = 'http://127.0.0.1:' + app.server.address().port, key = newKey();
  const call = async (method, url, body, k) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(k ? { 'x-owner-key': k } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };

  assert.equal((await call('GET', '/api/health')).json.ai, false);
  const list = (await call('GET', '/api/courses')).json; assert.equal(list.aiOn, false); assert.equal(list.courses[0].sample, true); assert.equal(list.courses[0].title, 'Personal Budgeting Basics');
  const id = list.courses[0].id, pub = (await call('GET', '/api/courses/' + id)).json.course;
  assert.ok(!('bank' in pub) && !JSON.stringify(pub).includes('"explain"') && !JSON.stringify(pub).includes('"correct"'), 'the question bank never reaches the browser'); assert.equal(pub.lessonsReady.length, 6, 'every lesson is already written');
  const lesson = await call('POST', '/api/courses/' + id + '/lessons/l2-1', null, key); assert.equal(lesson.status, 200); assert.match(lesson.json.lesson.title, /Needs, wants/);
  assert.equal((await call('POST', '/api/courses', { topic: 'Anything at all' }, key)).status, 503, 'creating new courses still needs the AI');

  const answer = (att, good) => att.questions.map(q => ({ choice: good ? q.correct : (q.correct + 1) % 4 }));
  const take = async (mid, good, name) => {
    const r = await call('POST', '/api/courses/' + id + '/assessments', { moduleId: mid }, key); assert.equal(r.status, 200, 'a bank quiz is instant: no background job'); assert.ok(!JSON.stringify(r.json).includes('"correct"'));
    return call('POST', '/api/assessments/' + r.json.attempt.id + '/submit', { answers: answer(app.db.attemptById(r.json.attempt.id), good), studentName: name }, key);
  };
  const bad = await take('m1', false, 'Ada Learner'); assert.equal(bad.json.passed, false); assert.equal(bad.json.score, 0); assert.equal(bad.json.evidence, null);
  const results = []; for (const mid of ['m1', 'm2', 'm3', 'final']) results.push((await take(mid, true, 'Ada Learner')).json);
  results.forEach(r => { assert.equal(r.score, 100); assert.equal(r.passed, true); assert.equal(r.evidence.aiGeneratedTask, false); assert.match(r.evidence.feedback, /fixed question bank/); assert.equal(r.evidence.graderMode, 'auto'); });
  assert.equal(results[3].eligible, true);
  const cert = (await call('POST', '/api/courses/' + id + '/certificate', { studentName: 'Ada Learner' }, key)).json.certificate;
  assert.equal(cert.aiDesigned, false); assert.match(cert.statement, /sample course/); assert.match(cert.statement, /not an accredited qualification/); assert.equal(cert.grade, 'Distinction');
  assert.equal((await call('GET', '/api/verify/' + cert.id)).json.valid, true);
  assert.equal((await call('POST', '/api/verify', { records: [{ ...cert, aiDesigned: true }] })).json.results[0].valid, false);
  // restarting the server does not duplicate the sample course
  app.db.flushNow(); assert.equal(require('../lib/democourse').seed(app.db), false);
});

test('API: when the AI service is out of quota the learner is told so, plainly', async t => {
  const s = await start({ complete: async () => { throw new Error('AI HTTP 429: You exceeded your current quota'); }, gather }); t.after(s.stop);
  const key = newKey(), r = await s.job(await s.call('POST', '/api/courses', { topic: 'Personal budgeting' }, key), key);
  assert.equal(r.status, 'error'); assert.match(r.error, /busy or has reached its usage limit/); assert.match(r.error, /sample course works without AI/);
});

test('API: a refused topic and an unusable link come back as clear messages', async t => {
  const s = await start({ complete: async () => JSON.stringify({ refuse: true, reason: 'Not something we can teach.' }), gather }); t.after(s.stop);
  const key = newKey(); const r = await s.job(await s.call('POST', '/api/courses', { topic: 'Something harmful' }, key), key);
  assert.equal(r.status, 'error'); assert.match(r.error, /Not something we can teach/);
  const s2 = await start({ complete: fakeModel().complete, gather }); t.after(s2.stop);
  const r2 = await s2.job(await s2.call('POST', '/api/courses', { topic: 'Money basics', sourceUrl: 'http://127.0.0.1/secret' }, key), key);
  assert.equal(r2.status, 'error'); assert.match(r2.error, /Could not use that link/);
});
