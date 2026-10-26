'use strict';
/* SkillBridge server: zero dependencies.
   Two databases, each with one job:
     - SERVER (lib/db.js, a JSON file): only what must be shared between people: the registry of signed evidence (so an employer can
       verify a link) and opt-in public portfolios. No accounts, no emails, no coursework.
     - BROWSER (public/localdb.js, localStorage): each person's own data: profile, coursework, evidence copy, drafts, offline queue.
   A person is identified by a random private key generated in their browser (sent as x-owner-key). The server stores only its hash.
   Run:  node server.js     (PORT, DATA_DIR, GEMINI_API_KEY or ANTHROPIC_API_KEY are optional environment variables) */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
if (require.main === module) require('./lib/env').load(path.join(__dirname, '.env'), { override: true });   // AI keys etc.; .env beats stale machine variables (tests never read .env)
const { open } = require('./lib/db');
const signer = require('./lib/sign');
const { grade, publicTask } = require('./lib/grade');
const ai = require('./lib/ai');
const generator = require('./lib/generate');
const coursesLib = require('./lib/courses');
const simLib = require('./lib/sim');
const cohortLib = require('./lib/cohort');
const demo = require('./lib/demo');
const Skills = require('./public/skills.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const MAX_VERIFY_RECORDS = 60, MAX_EVIDENCE_PER_OWNER = 200, MAX_COHORTS = 5000, MAX_COHORT_SIZE = 5000, DEMO_COHORT = 'DEMO-UNI-2026';
const MAX_GENERATED_PER_OWNER = 40, MAX_GENERATED_TOTAL = 3000, MAX_COURSES = 2000, MAX_ATTEMPTS_PER_OWNER = 12, MAX_SIMS = 1000, MAX_RUNS_PER_OWNER = 20;
const ALLOWED_UPLOADS = ['image/png', 'image/jpeg', 'application/pdf'];

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const publicDir = path.join(__dirname, 'public');
  const roles = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'roles.json'), 'utf8'));
  const tasks = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tasks.json'), 'utf8'));
  const tasksById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const db = open(path.join(dataDir, opts.dbName || 'db.json'));
  const keys = signer.loadKeys(dataDir);        // Ed25519: private key stays here, the public key is published
  const deps = opts.deps || {};
  const demoEnabled = process.env.DEMO ? process.env.DEMO !== '0' : process.env.NODE_ENV !== 'production';

  /* ---------- helpers ---------- */
  /* Anything the AI writes can take a minute, so it runs as a background job: the request returns at once and the page polls.
     (A single request held open for a minute is fragile over tunnels, proxies and mobile connections.) */
  const jobs = new Map();   // jobs in progress or recently finished (in memory only)
  function startJob(owner, key, work, label, budget) {
    for (const [id, j] of jobs) if (Date.now() - j.createdAt > 15 * 60e3) jobs.delete(id);                // forget old jobs
    const running = [...jobs.values()].find(j => j.owner === owner && j.status === 'working');
    if (running) return running.key === key ? running : { busy: true };                                  // one at a time per person; asking again for the same thing reuses it
    if (budget && !takeBudget(budget.name, budget.cap)) return { limited: true };
    const job = { id: 'job_' + crypto.randomBytes(8).toString('hex'), owner, key, status: 'working', createdAt: Date.now() };
    jobs.set(job.id, job);
    (async () => {
      try { job.result = await work(); job.status = 'done'; }
      catch (e) {
        const outOfCapacity = /AI HTTP (429|503)|quota|timeout|aborted/i.test(String(e && e.message));
        job.status = 'error'; job.error = e && e.user ? e.message : outOfCapacity
          ? 'The AI service is busy or has reached its usage limit for now. Please try again in a little while. (The sample course works without AI.)'
          : 'The AI could not produce a good result this time. Please try again.';
        if (!(e && e.user)) console.error('[' + label + '] failed: ' + String(e && e.message).slice(0, 300));
      }
    })();
    return job;
  }
  /* daily caps on AI work, shared by everyone, so one busy day cannot run up the bill */
  function takeBudget(name, cap) {
    const day = new Date().toISOString().slice(0, 10), b = db.data.meta.budget && db.data.meta.budget.day === day ? db.data.meta.budget : (db.data.meta.budget = { day });
    if ((b[name] || 0) >= cap) return false;
    b[name] = (b[name] || 0) + 1; return true;
  }
  const aiReady = () => ai.enabled() || !!deps.generate || !!deps.createCourse || !!deps.createSim || !!deps.complete;
  const simDayWork = new Map();   // one AI call per workday, however many learners start it at once
  /* simulations: what the browser may know about a run, a day, and a step's result (never keys or scores of options not chosen) */
  const runOf = (req, id) => { const owner = ownerOf(req), run = owner ? db.runById(id) : null; return run && run.ownerHash === owner ? { owner, run, sim: db.simById(run.simId) } : { owner, run: null, sim: null }; };
  const publicRun = (r, s) => s && {
    id: r.id, simId: r.simId, title: s.title, company: s.company.name, sample: !!s.static, daysTotal: r.daysTotal, name: r.name, createdAt: r.createdAt,
    days: Array.from({ length: r.daysTotal }, (_, k) => { const d = r.days[k]; return { n: k + 1, clockedIn: !!d, completed: !!(d && d.completedAt), status: d ? d.status : null, theme: (s.dayThemes[k] || {}).theme }; }),
    completed: r.days.slice(0, r.daysTotal).filter(d => d && d.completedAt).length === r.daysTotal && r.days.length >= r.daysTotal, certificateId: (db.certForRun(r.ownerHash, r.id) || { record: {} }).record.id || null,
  };
  function stepReply(step, r) {
    if (r.kind === 'reply') return { kind: 'reply', resp: r.resp, choice: r.choice };
    if (r.kind === 'decision') return { kind: 'decision', fb: r.fb, k: r.k, why: r.why, title: r.title };
    if (r.kind === 'quiz') return { kind: 'quiz', correct: r.correct, answer: r.answer, why: r.why, choice: r.choice };
    const last = r.attempts[r.attempts.length - 1];
    return { kind: 'task', final: r.final, needsRevision: !r.final, attempt: r.attempts.length, score: last.score, bestScore: r.score, improved: r.improved, feedback: last.feedback, fixes: last.fixes, rubric: last.rubric, mode: last.mode };
  }
  const publicDayState = d => d && ({ clockIn: d.clockIn, status: d.status, delta: d.delta, completed: !!d.completedAt, results: Object.fromEntries(Object.entries(d.results).map(([i, r]) => [i, stepReply(null, r)])) });
  function daySummary(run, sim, n) {
    const d = run.days[n - 1], s = simLib.dayScores(d), last = n >= run.daysTotal;
    return { day: n, theme: sim.days[String(n)].theme, clockIn: d.clockIn, status: d.status, delta: d.delta, task: s.task, decision: s.decision, quiz: s.quiz, reply: s.reply, overall: s.overall, note: simLib.managerNote(s.overall), manager: { name: sim.people[0].name, role: sim.people[0].role, ini: sim.people[0].ini, color: sim.people[0].color }, last,
      improved: Object.values(d.results).some(r => r.kind === 'task' && r.improved) };
  }
  const researchDeps = () => ({ budget: { take: () => takeBudget('research', Number(process.env.RESEARCH_DAILY_LIMIT) || 200) } });
  const publicCourse = c => { const { ownerHash, bank, ...rest } = c; return { ...rest, lessonsReady: Object.keys(db.lessonsOf(c.id)) }; };   // the question bank never leaves the server
  if (opts.sampleCourse) { require('./lib/democourse').seed(db); require('./lib/simsamples').seed(db); }   // hand-written samples that work with no AI (SAMPLE_COURSE=0 turns them off)
  const buckets = new Map();
  function limited(req, name, max, windowMs) {
    const key = name + ':' + (req.socket.remoteAddress || 'x'), now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    return ++b.n > max;
  }
  const send = (res, status, body, headers = {}) => {
    const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, { ...SECURITY, 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };
  /* public, rarely-changing JSON: the browser keeps a copy but re-checks with an ETag, so changes show up at once and
     an unchanged file costs only a tiny 304 reply (good for slow connections) */
  const sendCached = (req, res, obj, extra = {}) => {
    const body = JSON.stringify(obj), etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...SECURITY, ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
    res.writeHead(200, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', ETag: etag, 'Cache-Control': 'no-cache', ...extra }); res.end(body);
  };
  const readJson = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 4 * 1024 * 1024) req.destroy();           // absolute cap: stop reading hostile uploads
      else if (size <= limit) chunks.push(c);              // over the limit: read and discard, then answer 413
    });
    req.on('end', () => {
      if (size > limit) return reject(Object.assign(new Error('Request too large'), { status: 413 }));
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  /* the person's private key lives in their browser; we only ever keep its hash */
  const ownerOf = req => { const k = String(req.headers['x-owner-key'] || ''); return /^[a-f0-9]{32,64}$/.test(k) ? signer.sha256(k) : null; };
  const bestPerTask = list => { const best = {}; list.forEach(e => { if (!best[e.taskId] || e.score > best[e.taskId].score) best[e.taskId] = e; }); return Object.values(best); };

  /* grade + (on a pass) sign and store evidence. Used by the API and by the demo seeder, so demo data goes through the real pipeline. */
  async function issue(owner, task, answer, studentName, timeSpentSec) {
    const result = await grade(task, answer, deps);
    if (result.error) return { error: result.error, status: result.status };
    let evidence = null, note = '';
    if (result.passed) {
      const mine = db.evidenceForOwner(owner), best = mine.filter(e => e.taskId === task.id).reduce((a, e) => Math.max(a, e.score), -1);
      if (result.score <= best) note = 'You already hold evidence for this task with an equal or higher score.';
      else if (mine.length >= MAX_EVIDENCE_PER_OWNER) note = 'Evidence limit reached for this profile.';
      else {
        evidence = signer.sign(keys, {
          id: signer.randomId('ev_'), version: 3, issuer: 'SkillBridge', studentName: clean(studentName, 80) || 'Anonymous student',
          taskId: task.id, taskTitle: task.title, role: task.role, skills: task.skills, ...(task.generated ? { aiGeneratedTask: true } : {}),
          score: result.score, level: Skills.levelName(result.score), graderMode: result.mode, feedback: result.feedback,
          rubric: result.rubric.map(r => ({ label: r.label, weight: r.weight, score: Math.round(r.score * 100) / 100 })),
          submissionHash: signer.sha256(JSON.stringify(answer)), timeSpentSec: Math.max(0, Math.min(86400, Number(timeSpentSec) || 0)), issuedAt: new Date().toISOString(),
        });
        db.data.evidence[evidence.id] = { record: evidence, ownerHash: owner }; db.save();
      }
    }
    return { score: result.score, passed: result.passed, mode: result.mode, rubric: result.rubric, feedback: result.feedback, level: Skills.levelName(result.score), evidence, note };
  }
  /* grade result -> signed evidence for a module quiz or final exam (only on a pass that beats the previous best) */
  async function issueAssessment(owner, course, attempt, graded, studentName, timeSpentSec) {
    const taskId = coursesLib.taskIdFor(course.id, attempt.moduleId), mod = course.modules.find(x => x.id === attempt.moduleId);
    const title = course.title + ': ' + (mod ? mod.title + ' quiz' : 'final exam');
    const mine = db.evidenceForOwner(owner), best = mine.filter(e => e.taskId === taskId).reduce((a, e) => Math.max(a, e.score), -1);
    let evidence = null, note = '';
    if (graded.passed) {
      if (graded.score <= best) note = 'You already hold evidence for this with an equal or higher score.';
      else if (mine.length >= MAX_EVIDENCE_PER_OWNER) note = 'Evidence limit reached for this profile.';
      else {
        evidence = signer.sign(keys, {
          id: signer.randomId('ev_'), version: 3, issuer: 'SkillBridge', studentName: clean(studentName, 80) || 'Anonymous student',
          taskId, taskTitle: title, role: 'course', skills: {}, courseId: course.id, courseTitle: course.title, moduleId: attempt.moduleId, aiGeneratedTask: !course.static,
          score: graded.score, level: Skills.levelName(graded.score), graderMode: graded.results.some(r => r.type === 'written') ? 'ai' : 'auto',
          feedback: (course.static ? 'Quiz drawn from a fixed question bank and marked automatically. ' : 'Quiz written and marked by AI. ') + graded.results.filter(r => r.score >= 0.999).length + ' of ' + graded.results.length + ' questions fully correct.',
          rubric: graded.results.map((r, i) => ({ label: 'Question ' + (i + 1) + ': ' + attempt.questions[i].question.slice(0, 90), weight: r.weight, score: Math.round(r.score * 100) / 100 })),
          submissionHash: signer.sha256(JSON.stringify({ attempt: attempt.id, answers: graded.results.map(r => r.chosen == null ? r.score : r.chosen) })), timeSpentSec: Math.max(0, Math.min(86400, Number(timeSpentSec) || 0)), issuedAt: new Date().toISOString(),
        });
        db.data.evidence[evidence.id] = { record: evidence, ownerHash: owner }; db.save();
      }
    }
    const el = coursesLib.eligibility(course, db.evidenceForOwner(owner));
    return { score: graded.score, passed: graded.passed, passMark: coursesLib.PASS_MARK, level: Skills.levelName(graded.score), results: graded.results.map(r => ({ ...r })), evidence, note, eligible: el.ok, missing: el.missing || [] };
  }
  /* a synthetic class for the demo, created once. Its students are fake and never have a login. */
  async function ensureDemoCohort() {
    if (db.data.meta.demoSeeded) return;
    db.data.meta.demoSeeded = true;
    for (let i = 0; i < 14; i++) {
      const owner = signer.sha256('demo-class-member-' + i), arche = demo.ARCHETYPES[i % demo.ARCHETYPES.length], rand = demo.rng(1000 + i * 77), name = demo.NAMES[i % demo.NAMES.length] + ' ' + String.fromCharCode(65 + i) + '.';
      cohortLib.CODE_RE.test(DEMO_COHORT) && db.joinCohort(owner, DEMO_COHORT);
      for (const step of demo.plan(tasks, arche, rand)) await issue(owner, step.task, demo.answerFor(step.task, step.quality), name, 120 + Math.floor(rand() * 500));
    }
    db.save();
  }

  /* ---------- API ---------- */
  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    let mm;
    if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true, ai: aiReady(), passMark: 60, tasks: tasks.length, courses: Object.keys(db.data.courses).length });
    if ((p === '/api/keys' || p === '/.well-known/skillbridge-keys.json') && m === 'GET') return sendCached(req, res, keys.document, { 'Access-Control-Allow-Origin': '*' });
    if (p === '/api/roles' && m === 'GET') return sendCached(req, res, roles);
    if (p === '/api/tasks' && m === 'GET') return sendCached(req, res, tasks.map(publicTask));

    /* Grade a submission. On a pass the signed record is stored in the shared registry (tied to the owner hash) and returned,
       so the browser can also keep its own copy in localStorage. */
    if (p === '/api/submit' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (limited(req, 'submit', 60, 60e3)) return send(res, 429, { error: 'Slow down a little and try again in a minute.' });
      const b = await readJson(req, 40 * 1024);
      let task = tasksById[b.taskId];
      if (!task) { const g = db.generatedById(String(b.taskId)); if (g && g.ownerHash === owner) task = g.task; }   // AI-written tasks are private to who asked for them
      if (!task) return send(res, 404, { error: 'Unknown task' });
      const out = await issue(owner, task, b.answer, b.studentName, b.timeSpentSec);
      if (out.error) return send(res, out.status || 400, { error: out.error });
      return send(res, 200, out);
    }

    /* Ask the AI to write a fresh task for one skill. It is validated (and code tasks are proven solvable) before it is stored.
       Answer keys stay on the server; the browser gets the same stripped shape as any other task. */
    if (p === '/api/generate' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (!aiReady()) return send(res, 503, { error: 'AI task generation is not set up on this server (it needs a GEMINI_API_KEY or ANTHROPIC_API_KEY).' });
      if (limited(req, 'generate', 8, 60e3)) return send(res, 429, { error: 'Slow down a little and try again in a minute.' });
      const b = await readJson(req, 4 * 1024);
      const role = Object.entries(roles).map(([id, r]) => ({ id, ...r })).find(r => r.id === (b.role || 'software-engineer'));
      const skill = role && role.skills.find(s => s.id === b.skillId);
      if (!skill) return send(res, 400, { error: 'Choose one of the role\'s skills' });
      const type = b.type && generator.TYPES.includes(b.type) ? b.type : undefined;
      const job = startJob(owner, 'generate', async () => {
        const avoid = tasks.filter(t => t.skills[skill.id]).map(t => t.title).concat(db.generatedForOwner(owner).map(t => t.title));
        const task = await (deps.generate || generator.generateTask)({ role, skill, type, difficulty: b.difficulty, avoid }, deps);
        db.addGenerated(owner, task, MAX_GENERATED_PER_OWNER, MAX_GENERATED_TOTAL);
        return { task: publicTask(task) };
      }, 'generate ' + skill.id + '/' + (type || 'any'), { name: 'generate', cap: Number(process.env.GEN_DAILY_LIMIT) || 300 });
      if (job.limited) return send(res, 429, { error: 'The daily limit for AI-written tasks has been reached. Try again tomorrow, or practise the existing tasks.' });
      if (job.busy) return send(res, 409, { error: 'Your last request is still being written. Wait for it to finish.' });
      return send(res, 202, { job: job.id });
    }
    if ((mm = /^\/api\/(?:generate|jobs)\/(job_[a-f0-9]{16})$/.exec(p)) && m === 'GET') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const job = jobs.get(mm[1]); if (!job || job.owner !== owner) return send(res, 404, { error: 'Unknown job' });
      if (job.status === 'error') return send(res, 200, { status: 'error', error: job.error });
      if (job.status === 'working') return send(res, 200, { status: 'working', seconds: Math.round((Date.now() - job.createdAt) / 1000) });
      return send(res, 200, { status: 'done', result: job.result, ...job.result });   // `task` stays at the top level for the practice page
    }

    /* ======================= courses: learn any subject, practise, earn a certificate =======================
       Everything the AI writes (outline, lessons, quizzes) is validated first. Quiz answer keys stay here. Passing is decided
       from the signed evidence registry, never from the browser. */
    if (p === '/api/courses' && m === 'GET') {
      return send(res, 200, { courses: db.listCourses(url.searchParams.get('q'), 60).map(c => ({ id: c.id, title: c.title, summary: c.summary, level: c.level, topic: c.topic, kind: c.kind, modules: c.modules.length, lessons: c.modules.reduce((n, mo) => n + mo.lessons.length, 0), sample: !!c.static, createdAt: c.createdAt })), aiOn: aiReady() });
    }
    if (p === '/api/courses' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (!aiReady()) return send(res, 503, { error: 'Creating a course needs the AI, which is not set up on this server (it needs a GEMINI_API_KEY or ANTHROPIC_API_KEY).' });
      if (limited(req, 'course', 6, 3600e3)) return send(res, 429, { error: 'You have created several courses in the last hour. Please try again later.' });
      const b = await readJson(req, 4 * 1024), topic = coursesLib.cleanTopic(b.topic);
      if (topic.length < 3) return send(res, 400, { error: 'Tell me what you want to learn (at least 3 letters).' });
      const job = startJob(owner, 'course', async () => {
        const course = await (deps.createCourse || coursesLib.createCourse)({ topic, level: b.level, sourceUrl: b.sourceUrl }, { ...deps, researchDeps: researchDeps() });
        db.addCourse(course, owner, MAX_COURSES);
        return { course: publicCourse(db.courseById(course.id)) };
      }, 'course ' + topic, { name: 'course', cap: Number(process.env.COURSE_DAILY_LIMIT) || 60 });
      if (job.limited) return send(res, 429, { error: 'The daily limit for new courses has been reached. Try again tomorrow, or open an existing course.' });
      if (job.busy) return send(res, 409, { error: 'Your last request is still being written. Wait for it to finish.' });
      return send(res, 202, { job: job.id });
    }
    if ((mm = /^\/api\/courses\/(crs_[a-f0-9]{10})$/.exec(p)) && m === 'GET') {
      const c = db.courseById(mm[1]); if (!c) return send(res, 404, { error: 'This course does not exist.' });
      return send(res, 200, { course: publicCourse(c) });
    }
    if ((mm = /^\/api\/courses\/(crs_[a-f0-9]{10})\/lessons\/(l\d+-\d+)$/.exec(p)) && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const c = db.courseById(mm[1]); if (!c || !coursesLib.findLesson(c, mm[2])) return send(res, 404, { error: 'Unknown lesson' });
      const cached = db.lessonOf(c.id, mm[2]); if (cached) return send(res, 200, { lesson: cached });        // written once, shared by every learner
      if (!aiReady()) return send(res, 503, { error: 'This lesson has not been written yet and the AI is not set up on this server.' });
      if (limited(req, 'lesson', 30, 3600e3)) return send(res, 429, { error: 'Too many lessons requested. Try again soon.' });
      const lid = mm[2], job = startJob(owner, 'lesson:' + c.id + ':' + lid, async () => {
        const lesson = db.lessonOf(c.id, lid) || await (deps.writeLesson || coursesLib.writeLesson)(c, lid, { ...deps, researchDeps: researchDeps() });
        db.putLesson(c.id, lesson); return { lesson };
      }, 'lesson ' + c.id + '/' + lid, { name: 'lesson', cap: Number(process.env.LESSON_DAILY_LIMIT) || 600 });
      if (job.limited) return send(res, 429, { error: 'The daily limit for newly written lessons has been reached. Try again tomorrow.' });
      if (job.busy) return send(res, 409, { error: 'Another lesson is still being written. Wait for it to finish.' });
      return send(res, 202, { job: job.id });
    }
    if ((mm = /^\/api\/courses\/(crs_[a-f0-9]{10})\/assessments$/.exec(p)) && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const c = db.courseById(mm[1]); if (!c) return send(res, 404, { error: 'This course does not exist.' });
      const moduleId = String((await readJson(req, 2 * 1024)).moduleId || '');
      if (moduleId !== 'final' && !c.modules.some(x => x.id === moduleId)) return send(res, 400, { error: 'Unknown module' });
      const open = db.openAttempt(owner, c.id, moduleId); if (open) return send(res, 200, { attempt: coursesLib.publicAttempt(open) });   // refresh-safe: same quiz until it is submitted
      if (c.bank) {                                                                                  // a hand-written course: draw from its question bank, instantly, no AI
        const attempt = require('./lib/democourse').attemptFromBank(c, moduleId); if (!attempt) return send(res, 400, { error: 'Unknown module' });
        db.putAttempt(attempt, owner, MAX_ATTEMPTS_PER_OWNER); return send(res, 200, { attempt: coursesLib.publicAttempt(attempt) });
      }
      if (!aiReady()) return send(res, 503, { error: 'Quizzes are written by the AI, which is not set up on this server.' });
      if (limited(req, 'quiz', 20, 3600e3)) return send(res, 429, { error: 'Too many quizzes started. Try again soon.' });
      const job = startJob(owner, 'quiz:' + c.id + ':' + moduleId, async () => {
        const attempt = await (deps.writeAssessment || coursesLib.writeAssessment)(c, moduleId, db.lessonsOf(c.id), deps);
        db.putAttempt(attempt, owner, MAX_ATTEMPTS_PER_OWNER); return { attempt: coursesLib.publicAttempt(attempt) };
      }, 'quiz ' + c.id + '/' + moduleId, { name: 'quiz', cap: Number(process.env.QUIZ_DAILY_LIMIT) || 600 });
      if (job.limited) return send(res, 429, { error: 'The daily limit for new quizzes has been reached. Try again tomorrow.' });
      if (job.busy) return send(res, 409, { error: 'Another request is still being written. Wait for it to finish.' });
      return send(res, 202, { job: job.id });
    }
    if ((mm = /^\/api\/assessments\/(att_[a-f0-9]{16})\/submit$/.exec(p)) && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (limited(req, 'quizsubmit', 40, 3600e3)) return send(res, 429, { error: 'Too many submissions. Try again soon.' });
      const b = await readJson(req, 40 * 1024), attempt = db.attemptById(mm[1]);
      if (!attempt || attempt.ownerHash !== owner) return send(res, 404, { error: 'This quiz has expired. Start it again to get new questions.' });
      const c = db.courseById(attempt.courseId); if (!c) return send(res, 404, { error: 'This course no longer exists.' });
      let graded; try { graded = await coursesLib.gradeAttempt(attempt, b.answers, deps); } catch (e) { return send(res, e.status || 500, { error: e.user ? e.message : 'Could not grade this quiz. Please try again.' }); }
      db.deleteAttempt(attempt.id);                                                 // a new quiz means new questions: no memorising keys across attempts
      const out = await issueAssessment(owner, c, attempt, graded, b.studentName, b.timeSpentSec);
      return send(res, 200, out);
    }
    if ((mm = /^\/api\/courses\/(crs_[a-f0-9]{10})\/progress$/.exec(p)) && m === 'GET') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const c = db.courseById(mm[1]); if (!c) return send(res, 404, { error: 'This course does not exist.' });
      const ev = db.evidenceForOwner(owner).filter(e => e.courseId === c.id), best = {};
      ev.forEach(e => { if (!best[e.taskId] || e.score > best[e.taskId].score) best[e.taskId] = e; });
      const el = coursesLib.eligibility(c, ev), cert = db.certFor(owner, c.id);
      return send(res, 200, { quizzes: Object.fromEntries(c.modules.map(x => [x.id, best[coursesLib.taskIdFor(c.id, x.id)] ? { score: best[coursesLib.taskIdFor(c.id, x.id)].score, evidenceId: best[coursesLib.taskIdFor(c.id, x.id)].id } : null])), final: best[coursesLib.taskIdFor(c.id, 'final')] ? { score: best[coursesLib.taskIdFor(c.id, 'final')].score, evidenceId: best[coursesLib.taskIdFor(c.id, 'final')].id } : null, eligible: el.ok, missing: el.missing || [], certificate: cert ? cert.record : null, passMark: coursesLib.PASS_MARK });
    }
    if ((mm = /^\/api\/courses\/(crs_[a-f0-9]{10})\/certificate$/.exec(p)) && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const c = db.courseById(mm[1]); if (!c) return send(res, 404, { error: 'This course does not exist.' });
      const existing = db.certFor(owner, c.id); if (existing) return send(res, 200, { certificate: existing.record });   // one certificate per person per course
      const el = coursesLib.eligibility(c, db.evidenceForOwner(owner));
      if (!el.ok) return send(res, 403, { error: 'Not yet: ' + el.missing.join('; ') + '.', missing: el.missing });
      const name = clean((await readJson(req, 2 * 1024)).studentName, 80); if (name.length < 2) return send(res, 400, { error: 'Enter the name to print on the certificate.' });
      const cert = signer.sign(keys, {
        id: signer.randomId('cert_'), kind: 'certificate', version: 1, issuer: 'SkillBridge', studentName: name,
        courseId: c.id, courseTitle: c.title, courseLevel: c.level, summary: c.summary, outcomes: c.outcomes,
        modules: el.modules.map(x => ({ title: x.title, score: x.score })), finalScore: el.finalScore, overallScore: el.overall, grade: el.grade, passMark: coursesLib.PASS_MARK,
        evidenceIds: el.modules.map(x => x.evidenceId).concat(el.finalEvidenceId), aiDesigned: !c.static, issuedAt: new Date().toISOString(),
        statement: c.static
          ? 'Awarded for passing every module quiz and the final exam of this sample course. The quizzes are drawn from a fixed question bank and marked automatically. This certificate shows completion on SkillBridge; it is not an accredited qualification.'
          : 'Awarded for passing every module quiz and the final exam of this course. The course, lessons and questions were written by AI and the answers were marked automatically. This certificate shows completion on SkillBridge; it is not an accredited qualification.',
      });
      db.putCert(cert, owner); return send(res, 200, { certificate: cert });
    }

    /* ======================= work simulations: a virtual workday for any job =======================
       The browser plays the scripted day; every choice is sent here, where the scores and keys live. The certificate is built from
       the server's own record of the run. */
    if (p === '/api/sims' && m === 'GET') {
      return send(res, 200, { sims: db.listSims(url.searchParams.get('q'), 60).map(s => simLib.publicSim(s)), aiOn: aiReady() });
    }
    if (p === '/api/sims' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (!aiReady()) return send(res, 503, { error: 'Creating a simulation needs the AI, which is not set up on this server (it needs a GEMINI_API_KEY or ANTHROPIC_API_KEY).' });
      if (limited(req, 'sim', 6, 3600e3)) return send(res, 429, { error: 'You have created several simulations in the last hour. Please try again later.' });
      const job = coursesLib.cleanTopic((await readJson(req, 4 * 1024)).job);
      if (job.length < 3) return send(res, 400, { error: 'Type the job you want to try (at least 3 letters).' });
      const j = startJob(owner, 'sim', async () => {
        const sim = await (deps.createSim || simLib.createSim)({ job }, { ...deps, researchDeps: researchDeps() });
        db.addSim(sim, owner, MAX_SIMS); return { sim: simLib.publicSim(db.simById(sim.id)) };
      }, 'sim ' + job, { name: 'sim', cap: Number(process.env.SIM_DAILY_LIMIT) || 60 });
      if (j.limited) return send(res, 429, { error: 'The daily limit for new simulations has been reached. Try again tomorrow, or open an existing one.' });
      if (j.busy) return send(res, 409, { error: 'Your last request is still being written. Wait for it to finish.' });
      return send(res, 202, { job: j.id });
    }
    if ((mm = /^\/api\/sims\/(sim_[a-f0-9]{10})$/.exec(p)) && m === 'GET') {
      const s = db.simById(mm[1]); return s ? send(res, 200, { sim: simLib.publicSim(s) }) : send(res, 404, { error: 'This simulation does not exist.' });
    }
    if ((mm = /^\/api\/sims\/(sim_[a-f0-9]{10})\/runs$/.exec(p)) && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const s = db.simById(mm[1]); if (!s) return send(res, 404, { error: 'This simulation does not exist.' });
      if (db.runsForOwner(owner).length >= MAX_RUNS_PER_OWNER) return send(res, 400, { error: 'You have reached the limit of simulations in progress. Finish or erase some first.' });
      const b = await readJson(req, 2 * 1024), daysTotal = [1, 2, 3].includes(Number(b.days)) ? Number(b.days) : 1;
      const run = { id: 'run_' + crypto.randomBytes(6).toString('hex'), ownerHash: owner, simId: s.id, daysTotal, name: clean(b.name, 80), createdAt: new Date().toISOString(), days: [] };
      db.putRun(run); return send(res, 200, { run: publicRun(run, s) });
    }
    if (p === '/api/runs' && m === 'GET') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      return send(res, 200, { runs: db.runsForOwner(owner).map(r => publicRun(r, db.simById(r.simId))).filter(Boolean) });
    }
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})$/.exec(p)) && m === 'GET') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      return send(res, 200, { run: publicRun(run, sim), sim: simLib.publicSim(sim) });
    }
    /* make sure the day's script exists (written the first time anyone needs it, then shared) */
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})\/days\/([123])\/prepare$/.exec(p)) && m === 'POST') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      const n = Number(mm[2]); if (n > run.daysTotal) return send(res, 400, { error: 'This run has only ' + run.daysTotal + ' day(s).' });
      if (n > 1 && !(run.days[n - 2] && run.days[n - 2].completedAt)) return send(res, 400, { error: 'Finish the previous day first.' });
      if (sim.days[String(n)]) return send(res, 200, { ready: true });
      if (!aiReady()) return send(res, 503, { error: 'This day has not been written yet and the AI is not set up on this server.' });
      if (limited(req, 'simday', 20, 3600e3)) return send(res, 429, { error: 'Too many days requested. Try again soon.' });
      const key = sim.id + ':' + n;
      const j = startJob(owner, 'simday:' + key, async () => {
        if (!sim.days[String(n)]) {
          if (!simDayWork.has(key)) simDayWork.set(key, (deps.writeDay || simLib.writeDay)(sim, n, { ...deps, researchDeps: researchDeps() }).then(d => { db.putSimDay(sim.id, n, d); }).finally(() => simDayWork.delete(key)));
          await simDayWork.get(key);          // two learners starting the same day share one AI call
        }
        return { ready: true };
      }, 'simday ' + key, { name: 'simday', cap: Number(process.env.SIMDAY_DAILY_LIMIT) || 300 });
      if (j.limited) return send(res, 429, { error: 'The daily limit for newly written workdays has been reached. Try again tomorrow.' });
      if (j.busy) return send(res, 409, { error: 'Another request is still being written. Wait for it to finish.' });
      return send(res, 202, { job: j.id });
    }
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})\/days\/([123])$/.exec(p)) && m === 'GET') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      const n = Number(mm[2]), day = sim.days[String(n)]; if (!day || n > run.daysTotal) return send(res, 404, { error: 'This day is not ready yet.' });
      if (!run.days[n - 1]) return send(res, 404, { error: 'Clock in first.' });
      return send(res, 200, { day: simLib.publicDay(day), state: publicDayState(run.days[n - 1]), people: sim.people, company: sim.company });
    }
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})\/days\/([123])\/clockin$/.exec(p)) && m === 'POST') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      const n = Number(mm[2]), day = sim.days[String(n)]; if (n > run.daysTotal) return send(res, 400, { error: 'This run has only ' + run.daysTotal + ' day(s).' });
      if (!day) return send(res, 409, { error: 'This day is still being prepared.' });
      if (n > 1 && !(run.days[n - 2] && run.days[n - 2].completedAt)) return send(res, 400, { error: 'Finish the previous day first.' });
      if (run.days[n - 1]) return send(res, 200, { day: simLib.publicDay(day), state: publicDayState(run.days[n - 1]), people: sim.people, company: sim.company });   // already clocked in: resume
      const b = await readJson(req, 1024), startMin = Number(b.startMin), tz = Number(b.tzOffset);
      if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439 || !Number.isFinite(tz) || Math.abs(tz) > 840) return send(res, 400, { error: 'Choose the time your shift starts.' });
      const now = (deps.now || Date.now)(), nowMin = (((Math.floor(now / 60000) - Math.round(tz)) % 1440) + 1440) % 1440;
      let delta = nowMin - startMin; if (delta > 720) delta -= 1440; if (delta < -720) delta += 1440; if (delta < -60) delta = 0;   // arriving hours early is just "on time"
      const pu = simLib.punctuality(delta), clock = ((nowMin / 60 | 0) % 12 || 12) + ':' + String(nowMin % 60).padStart(2, '0') + (nowMin >= 720 ? ' PM' : ' AM');
      run.days[n - 1] = { n, startMin, clockInAt: new Date(now).toISOString(), clockIn: clock, status: pu.status, delta, pScore: pu.score, results: {}, completedAt: null };
      db.putRun(run);
      return send(res, 200, { day: simLib.publicDay(day), state: publicDayState(run.days[n - 1]), people: sim.people, company: sim.company });
    }
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})\/days\/([123])\/steps\/(\d{1,2})$/.exec(p)) && m === 'POST') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      const n = Number(mm[2]), i = Number(mm[3]), d = run.days[n - 1], day = sim.days[String(n)], step = day && day.steps[i];
      if (!d || !step) return send(res, 400, { error: 'Clock in first.' }); if (d.completedAt) return send(res, 400, { error: 'This day is finished.' });
      if (!['reply', 'task', 'decision', 'quiz'].includes(step.type)) return send(res, 400, { error: 'Nothing to answer here.' });
      for (let k = 0; k < i; k++) { const sk = day.steps[k]; if (['reply', 'task', 'decision', 'quiz'].includes(sk.type) && !(d.results[k] && (sk.type !== 'task' || d.results[k].final))) return send(res, 400, { error: 'Answer the earlier steps first.' }); }
      const prev = d.results[i]; if (prev && (step.type !== 'task' || prev.final)) return send(res, 200, { done: true, ...stepReply(step, prev) });   // answering twice returns the first result
      const b = await readJson(req, 3 * 1024 * 1024);
      if (step.type === 'reply') {
        const o = step.options[Number(b.choice)]; if (!o) return send(res, 400, { error: 'Choose a reply.' });
        d.results[i] = { kind: 'reply', choice: Number(b.choice), score: o.score, resp: o.resp, final: true }; db.putRun(run); return send(res, 200, stepReply(step, d.results[i]));
      }
      if (step.type === 'decision') {
        const o = step[b.k === 'b' ? 'b' : b.k === 'a' ? 'a' : null]; if (!o) return send(res, 400, { error: 'Choose one option.' });
        d.results[i] = { kind: 'decision', k: b.k, why: clean(b.why, 200), title: o.title, score: o.score, fb: o.fb, final: true }; db.putRun(run); return send(res, 200, stepReply(step, d.results[i]));
      }
      if (step.type === 'quiz') {
        const c = Number(b.choice); if (!Number.isInteger(c) || c < 0 || c > 3) return send(res, 400, { error: 'Choose an answer.' });
        d.results[i] = { kind: 'quiz', choice: c, correct: c === step.correct, score: c === step.correct ? 100 : 0, why: step.why, answer: step.correct, final: true }; db.putRun(run); return send(res, 200, stepReply(step, d.results[i]));
      }
      /* a task: pasted text and/or an attached screenshot or PDF, reviewed against the rubric; one chance to revise */
      if (limited(req, 'review', 40, 3600e3)) return send(res, 429, { error: 'Too many submissions. Try again soon.' });
      const text = typeof b.text === 'string' ? b.text.trim().slice(0, 7000) : '', files = Array.isArray(b.files) ? b.files.slice(0, 2) : [], attachments = [];
      for (const f of files) {
        if (!f || !ALLOWED_UPLOADS.includes(f.mime) || typeof f.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(f.data) || f.data.length > 2.4e6) return send(res, 400, { error: 'Attach a PNG, JPG or PDF under about 1.5 MB, or paste your work as text.' });
        attachments.push({ mime: f.mime, data: f.data });
      }
      if (text.length < 20 && !attachments.length) return send(res, 400, { error: 'Paste your work (at least a few sentences) or attach a file first.' });
      const attempt = (prev ? prev.attempts.length : 0) + 1;
      let review; try { review = await simLib.reviewWork(sim, step, { text, attachments, attempt }, deps); } catch (e) { return send(res, e.user ? e.status : 500, { error: e.user ? e.message : 'Could not review your work. Please try again.' }); }
      const attempts = (prev ? prev.attempts : []).concat({ score: review.score, feedback: review.feedback, fixes: review.fixes, rubric: review.rubric.map(r => ({ label: r.label, score: Math.round(r.score * 100) / 100, comment: r.comment })), mode: review.mode });
      const best = Math.max(...attempts.map(x => x.score)), final = !review.needsRevision;
      d.results[i] = { kind: 'task', attempts, score: best, final, improved: attempts.length > 1 && attempts[attempts.length - 1].score > attempts[0].score };
      db.putRun(run); return send(res, 200, stepReply(step, d.results[i]));
    }
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})\/days\/([123])\/clockout$/.exec(p)) && m === 'POST') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      const n = Number(mm[2]), d = run.days[n - 1], day = sim.days[String(n)]; if (!d || !day) return send(res, 400, { error: 'Clock in first.' });
      const open = day.steps.findIndex((s, k) => ['reply', 'task', 'decision', 'quiz'].includes(s.type) && !(d.results[k] && d.results[k].final));
      if (open >= 0) return send(res, 400, { error: 'There is still work left today.' });
      if (!d.completedAt) { d.completedAt = new Date().toISOString(); db.putRun(run); }
      return send(res, 200, { summary: daySummary(run, sim, n) });
    }
    if ((mm = /^\/api\/runs\/(run_[a-f0-9]{12})\/certificate$/.exec(p)) && m === 'POST') {
      const { run, sim, owner } = runOf(req, mm[1]); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' }); if (!run) return send(res, 404, { error: 'This simulation run does not exist.' });
      const existing = db.certForRun(owner, run.id); if (existing) return send(res, 200, { certificate: existing.record });
      const unfinished = []; for (let k = 0; k < run.daysTotal; k++) if (!(run.days[k] && run.days[k].completedAt)) unfinished.push(k + 1);
      if (unfinished.length) return send(res, 403, { error: 'Finish and clock out of every day first (still to do: day ' + unfinished.join(', ') + ').' });
      const b = await readJson(req, 2 * 1024), name = clean(b.studentName, 80) || run.name; if (name.length < 2) return send(res, 400, { error: 'Enter the name to print on the certificate.' });
      const cd = simLib.certificateData(run), mgr = sim.people[0];
      const cert = signer.sign(keys, {
        id: signer.randomId('cert_'), kind: 'certificate', certType: 'simulation', version: 1, issuer: 'SkillBridge', studentName: name,
        runId: run.id, simId: sim.id, jobTitle: sim.title, company: sim.company.name, companyAbout: sim.company.about, days: run.daysTotal, onTime: cd.onTime,
        overallScore: cd.overall, grade: simLib.gradeLabel(cd.overall), rows: cd.rows,
        workLog: run.days.slice(0, run.daysTotal).map((d, k) => ({ day: k + 1, theme: sim.days[String(k + 1)].theme, status: d.status, clockIn: d.clockIn, task: simLib.dayScores(d).task, decision: simLib.dayScores(d).decision })),
        manager: { name: mgr.name, role: mgr.role }, aiDesigned: !sim.static, issuedAt: new Date().toISOString(),
        statement: 'This certifies completion of a simulated work experience at a fictional company. The company, the people and the scenarios were ' + (sim.static ? 'written by the SkillBridge team' : 'written by AI') + ', and the work was reviewed ' + (sim.static ? 'by an AI reviewer or a keyword checklist' : 'by AI') + '. It is not employment, not experience with a real employer, and not an accredited qualification.',
      });
      db.putCert(cert, owner); return send(res, 200, { certificate: cert });
    }

    /* Everything the server holds for this owner (lets a restored browser re-sync). */
    if (p === '/api/mine') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (m === 'GET') { const pf = db.portfolioByOwner(owner); return send(res, 200, { evidence: db.evidenceForOwner(owner), certificates: db.certsForOwner(owner), tasks: db.generatedForOwner(owner).map(publicTask), portfolio: pf ? { isPublic: pf.isPublic, publicId: pf.publicId, name: pf.name, major: pf.major, year: pf.year } : null }); }
      if (m === 'DELETE') { db.removeOwner(owner); return send(res, 200, { ok: true }); }   // right to be forgotten
    }

    /* Opt-in public portfolio. The student chooses what name/major/year to show; nothing else is published. */
    if (p === '/api/publish' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const b = await readJson(req);
      if (!db.evidenceForOwner(owner).length) return send(res, 400, { error: 'Earn some evidence first, then you can share a portfolio.' });
      let pf = db.portfolioByOwner(owner);
      if (!pf) { pf = { publicId: crypto.randomBytes(6).toString('hex'), ownerHash: owner, isPublic: false }; db.data.portfolios[pf.publicId] = pf; }
      pf.isPublic = !!b.public; pf.name = clean(b.name, 80) || 'Anonymous student'; pf.major = clean(b.major, 100); pf.year = clean(b.year, 10); pf.role = roles[b.role] ? b.role : 'software-engineer'; pf.updatedAt = new Date().toISOString();
      db.save(); return send(res, 200, { isPublic: pf.isPublic, publicId: pf.publicId });
    }
    if ((mm = /^\/api\/portfolio\/([\w-]{1,30})$/.exec(p)) && m === 'GET') {
      const pf = db.portfolioByPublicId(mm[1]); if (!pf) return send(res, 404, { error: 'This portfolio is not public or does not exist.' });
      const role = roles[pf.role] || roles['software-engineer'], list = tasks.filter(t => t.role === pf.role);
      const evidence = bestPerTask(db.evidenceForOwner(pf.ownerHash));
      return send(res, 200, { student: { name: pf.name, major: pf.major, year: pf.year, roleTitle: role.title }, levels: Skills.levelsFromEvidence(evidence, list, role.skills), targetLevel: role.targetLevel, skills: role.skills.map(s => ({ id: s.id, name: s.name })), evidence });
    }

    /* ---- university cohorts: voluntary, anonymous, aggregate-only (see lib/cohort.js) ---- */
    if (p === '/api/cohort/join' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (limited(req, 'join', 30, 3600e3)) return send(res, 429, { error: 'Too many class changes. Try again later.' });
      const code = cohortLib.normalise((await readJson(req)).code);
      if (!cohortLib.CODE_RE.test(code)) return send(res, 400, { error: 'A cohort code is 4 to 32 letters, numbers or dashes, like UNI-CS-2026.' });
      const existing = db.data.cohorts[code];
      if (!existing && Object.keys(db.data.cohorts).length >= MAX_COHORTS) return send(res, 400, { error: 'This server cannot create more classes right now.' });
      if (existing && existing.members.length >= MAX_COHORT_SIZE && !existing.members.includes(owner)) return send(res, 400, { error: 'This class is full.' });
      const c = db.joinCohort(owner, code); return send(res, 200, { code: c.code, size: c.members.length });
    }
    if (p === '/api/cohort/leave' && m === 'POST') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      db.leaveCohort(owner); return send(res, 200, { ok: true });
    }
    if (p === '/api/cohort/mine' && m === 'GET') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const c = db.cohortOf(owner); return send(res, 200, { code: c ? c.code : null, size: c ? c.members.length : 0 });
    }
    if ((mm = /^\/api\/cohort\/([A-Za-z0-9-]{4,32})$/.exec(p)) && m === 'GET') {
      if (limited(req, 'cohort', 60, 60e3)) return send(res, 429, { error: 'Too many requests.' });
      const agg = cohortLib.aggregate(db, cohortLib.normalise(mm[1]), roles, tasks);
      return agg ? send(res, 200, agg) : send(res, 404, { error: 'No cohort has this code yet.' });
    }

    /* ---- one-click demo (set DEMO=0 to disable; off when NODE_ENV=production unless DEMO=1) ---- */
    if (p === '/api/demo' && m === 'POST') {
      if (!demoEnabled) return send(res, 404, { error: 'Not found' });
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (limited(req, 'demo', 10, 3600e3)) return send(res, 429, { error: 'The demo was started too many times from this address. Try again later.' });
      await ensureDemoCohort();
      const studentName = 'Amina Yusuf (demo)', picks = [['cart-total-off-by-one', 'good'], ['admin-assignment-bug', 'good'], ['async-foreach', 'good'], ['sql-injection', 'good'], ['merge-conflict', 'good'], ['incident-triage', 'good'], ['safe-average', 'good'], ['fizzbuzz', 'good'], ['slugify', 'poor'], ['slugify', 'good'], ['status-update', 'good'], ['review-password-pr', 'good']];
      const evidence = [];
      for (const [id, q] of picks) { const out = await issue(owner, tasksById[id], demo.answerFor(tasksById[id], q), studentName, 180 + Math.floor(Math.random() * 300)); if (out.evidence) evidence.push(out.evidence); }
      db.joinCohort(owner, DEMO_COHORT);
      return send(res, 200, { studentName, evidence: db.evidenceForOwner(owner), cohort: DEMO_COHORT });
    }

    /* Verification: by id from the registry, or (for backup files) by checking the signature of records you send. */
    if ((mm = /^\/api\/verify\/([\w-]{1,40})$/.exec(p)) && m === 'GET') {
      const row = db.evidenceById(mm[1]) || db.certById(mm[1]);                       // evidence (ev_...) or a course certificate (cert_...)
      if (!row) return send(res, 404, { valid: false, reason: 'No credential with this ID was issued by this system.' });
      const pf = db.portfolioByOwner(row.ownerHash);
      return send(res, 200, { valid: signer.verify(keys, row.record), evidence: row.record, portfolioUrl: pf && pf.isPublic ? '/p/' + pf.publicId : null });
    }
    if (p === '/api/verify' && m === 'POST') {
      if (limited(req, 'verify', 120, 60e3)) return send(res, 429, { error: 'Too many checks. Try again in a minute.' });
      const b = await readJson(req, 512 * 1024);
      if (!Array.isArray(b.records) || !b.records.length) return send(res, 400, { error: 'Send the evidence records to check' });
      if (b.records.length > MAX_VERIFY_RECORDS) return send(res, 400, { error: 'At most ' + MAX_VERIFY_RECORDS + ' records at a time' });
      return send(res, 200, { results: b.records.map(r => ({ id: r && typeof r.id === 'string' ? r.id.slice(0, 40) : null, valid: !!(r && typeof r === 'object' && signer.verify(keys, r)) })) });
    }
    return send(res, 404, { error: 'Not found' });
  }

  /* ---------- static files ---------- */
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || /^\/(verify|p)(\/|$)/.test(rel)) rel = '/index.html';   // single-page app routes
    const file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep) && file !== publicDir) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found');
      const ext = path.extname(file).toLowerCase();
      /* code and styles are revalidated every time (a 304 costs a few hundred bytes), so an update reaches everyone at once;
         only images and icons are cached for an hour */
      const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"', revalidate = /^(\.html|\.js|\.css|\.json|\.webmanifest)$/.test(ext);
      if (revalidate && req.headers['if-none-match'] === etag) { res.writeHead(304, { ...SECURITY, ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': revalidate || rel === '/sw.js' ? 'no-cache' : 'public, max-age=3600', Vary: 'Accept-Encoding', ...(revalidate ? { ETag: etag } : {}) };
      // The practice-test worker evaluates the student's own code. It has no DOM, cookies or storage, and its policy forbids every network call.
      if (rel === '/runner.js') headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";
      if (/gzip/.test(req.headers['accept-encoding'] || '') && /^(\.html|\.js|\.css|\.json|\.svg|\.webmanifest)$/.test(ext) && buf.length > 500) { headers['Content-Encoding'] = 'gzip'; buf = zlib.gzipSync(buf); }
      send(res, 200, buf, headers);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') || url.pathname === '/.well-known/skillbridge-keys.json') return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on our side' : e.message });
    }
  });
  return { server, db, keys, tasks, roles };
}

module.exports = { createApp };

if (require.main === module) {
  const { server, db } = createApp({ sampleCourse: process.env.SAMPLE_COURSE !== '0' });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log('SkillBridge running at http://localhost:' + port + (ai.enabled() ? '  (AI on: ' + require('./lib/llm').provider() + ')' : '  (AI off: set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env to write and mark tasks with AI)')));
  const stop = () => { db.flushNow(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
