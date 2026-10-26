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
const cohortLib = require('./lib/cohort');
const demo = require('./lib/demo');
const Skills = require('./public/skills.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const MAX_VERIFY_RECORDS = 60, MAX_EVIDENCE_PER_OWNER = 200, MAX_COHORTS = 5000, MAX_COHORT_SIZE = 5000, DEMO_COHORT = 'DEMO-UNI-2026';
const MAX_GENERATED_PER_OWNER = 40, MAX_GENERATED_TOTAL = 3000;

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
  const jobs = new Map();   // AI task-writing jobs in progress (in memory only)
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
    if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true, ai: ai.enabled() || !!deps.generate, passMark: 60, tasks: tasks.length });
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
      if (!(ai.enabled() || deps.generate)) return send(res, 503, { error: 'AI task generation is not set up on this server (it needs a GEMINI_API_KEY or ANTHROPIC_API_KEY).' });
      if (limited(req, 'generate', 8, 60e3)) return send(res, 429, { error: 'Slow down a little and try again in a minute.' });
      const b = await readJson(req, 4 * 1024);
      const role = Object.entries(roles).map(([id, r]) => ({ id, ...r })).find(r => r.id === (b.role || 'software-engineer'));
      const skill = role && role.skills.find(s => s.id === b.skillId);
      if (!skill) return send(res, 400, { error: 'Choose one of the role\'s skills' });
      const type = b.type && generator.TYPES.includes(b.type) ? b.type : undefined;
      const day = new Date().toISOString().slice(0, 10), gen = db.data.meta.gen && db.data.meta.gen.day === day ? db.data.meta.gen : (db.data.meta.gen = { day, n: 0 });
      const cap = Number(process.env.GEN_DAILY_LIMIT) || 300;
      if (gen.n >= cap) return send(res, 429, { error: 'The daily limit for AI-written tasks has been reached. Try again tomorrow, or practise the existing tasks.' });
      // Writing a task can take a minute, so it runs as a background job: this call returns at once and the page polls for the result.
      // (A single request held open for a minute is fragile over tunnels, proxies and mobile connections.)
      const running = [...jobs.values()].find(j => j.owner === owner && j.status === 'working');
      if (running) return send(res, 202, { job: running.id });                       // one at a time per person: reuse the one in progress
      gen.n++;
      const job = { id: 'job_' + crypto.randomBytes(8).toString('hex'), owner, status: 'working', createdAt: Date.now() };
      jobs.set(job.id, job);
      for (const [id, j] of jobs) if (Date.now() - j.createdAt > 15 * 60e3) jobs.delete(id);   // forget old jobs
      (async () => {
        try {
          const avoid = tasks.filter(t => t.skills[skill.id]).map(t => t.title).concat(db.generatedForOwner(owner).map(t => t.title));
          const task = await (deps.generate || generator.generateTask)({ role, skill, type, difficulty: b.difficulty, avoid }, deps);
          db.addGenerated(owner, task, MAX_GENERATED_PER_OWNER, MAX_GENERATED_TOTAL);
          job.task = publicTask(task); job.status = 'done';
        } catch (e) { job.status = 'error'; job.error = 'The AI could not produce a good task this time. Please try again.'; }
      })();
      return send(res, 202, { job: job.id });
    }
    if ((mm = /^\/api\/generate\/(job_[a-f0-9]{16})$/.exec(p)) && m === 'GET') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      const job = jobs.get(mm[1]); if (!job || job.owner !== owner) return send(res, 404, { error: 'Unknown job' });
      return send(res, 200, job.status === 'done' ? { status: 'done', task: job.task } : job.status === 'error' ? { status: 'error', error: job.error } : { status: 'working', seconds: Math.round((Date.now() - job.createdAt) / 1000) });
    }

    /* Everything the server holds for this owner (lets a restored browser re-sync). */
    if (p === '/api/mine') {
      const owner = ownerOf(req); if (!owner) return send(res, 401, { error: 'Missing or invalid owner key' });
      if (m === 'GET') { const pf = db.portfolioByOwner(owner); return send(res, 200, { evidence: db.evidenceForOwner(owner), tasks: db.generatedForOwner(owner).map(publicTask), portfolio: pf ? { isPublic: pf.isPublic, publicId: pf.publicId, name: pf.name, major: pf.major, year: pf.year } : null }); }
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
      const row = db.evidenceById(mm[1]);
      if (!row) return send(res, 404, { valid: false, reason: 'No evidence with this ID was issued by this system.' });
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
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || rel === '/sw.js' || rel === '/app.js' ? 'no-cache' : 'public, max-age=3600', Vary: 'Accept-Encoding' };
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
  const { server, db } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log('SkillBridge running at http://localhost:' + port + (ai.enabled() ? '  (AI on: ' + require('./lib/llm').provider() + ')' : '  (AI off: set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env to write and mark tasks with AI)')));
  const stop = () => { db.flushNow(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
