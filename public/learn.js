/* SkillBridge "Learn": a course catalogue for ANY subject, in the spirit of an online-course site.
   Pick or ask the AI to create a course, read lessons with real examples (and the web sources behind them), take module quizzes
   and a final exam, and earn a signed certificate that anyone can verify. Progress lives in the learner's own browser (LocalDB);
   passing is decided by the server from signed evidence. All text is inserted with textContent, never innerHTML.
   app.js hands this file its helpers through Learn.init(ctx) and sends it any route it recognises through Learn.route(hash). */
(function () {
'use strict';
let ctx = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUGGESTIONS = ['Personal finance basics', 'Introduction to marketing', 'Public speaking', 'Spanish for beginners', 'First aid essentials', 'Project management', 'Data analysis with spreadsheets', 'Climate science'];
const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

function init(c) { ctx = c; }

/* ---------------------------------------------------------------- helpers */
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
const learnerName = () => { const p = ctx.db.profile.get(); return (p && p.name) || ctx.db.cache.get('learnerName', '') || ''; };

/* start something the AI writes. The server answers at once (200 if it is ready, 202 with a job) and we check back every 2 seconds,
   so no connection has to stay open for a minute. A brief network hiccup while waiting does not lose the work. */
async function runJob(method, url, body, onTick) {
  const start = await ctx.api(method, url, body);
  if (!start.job) return start;
  const t0 = Date.now(); let misses = 0;
  for (;;) {
    await sleep(2000);
    let j;
    try { j = await ctx.api('GET', '/api/jobs/' + start.job); misses = 0; }
    catch (e) { if (!ctx.isNetworkError(e) || ++misses > 8) throw e; if (onTick) onTick(Date.now() - t0, true); continue; }
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw Object.assign(new Error(j.error), { status: 502 });
    if (Date.now() - t0 > 240000) throw Object.assign(new Error('This is taking too long. Please try again.'), { status: 504 });
    if (onTick) onTick(Date.now() - t0, false);
  }
}
const errText = e => (ctx.isNetworkError(e) ? 'Could not reach the server. Check your connection and try again.' : e.message);

/* a status line that shows seconds elapsed while the AI works */
function workingBox() {
  const box = ctx.h('div', { 'aria-live': 'polite' });
  return { el: box,
    tick: label => (ms, slow) => box.replaceChildren(ctx.h('p', { class: 'dim' }, (slow ? 'Connection is slow, still trying... ' : label + ' ') + Math.round(ms / 1000) + 's (usually under a minute)')),
    show: text => box.replaceChildren(ctx.h('p', { class: 'dim' }, text)), fail: text => box.replaceChildren(ctx.h('div', { class: 'notice bad' }, text)), clear: () => box.replaceChildren() };
}

/* lesson text: short paragraphs, "- " bullets and **bold** only. Built with DOM nodes, so nothing the AI writes can run as code. */
function inline(text) {
  const out = []; text.split(/(\*\*[^*]+\*\*)/g).forEach(part => { if (!part) return; out.push(/^\*\*[^*]+\*\*$/.test(part) ? ctx.h('strong', null, part.slice(2, -2)) : part); });
  return out;
}
function rich(text) {
  return ctx.h('div', { class: 'rich' }, String(text).split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length && lines.every(l => /^[-*] /.test(l))) return ctx.h('ul', null, lines.map(l => ctx.h('li', null, inline(l.replace(/^[-*] /, '')))));
    return ctx.h('p', null, inline(lines.join(' ')));
  }));
}
const sourcesView = (sources, via) => {
  const how = { 'web-search': 'Examples and facts below were checked on the web.', knowledge: 'The AI judged this topic needed no web search.', wikipedia: 'Background taken from Wikipedia.', page: 'Based on the web page the author supplied.' }[via] || '';
  const links = (sources || []).map(s => ({ title: s.title, url: safeUrl(s.url) })).filter(s => s.url);
  if (!links.length && !how) return null;
  return ctx.h('section', { class: 'sources' }, ctx.h('h3', null, 'Sources'), how ? ctx.h('p', { class: 'small dim' }, how) : null,
    links.length ? ctx.h('ul', { class: 'small' }, links.map(s => ctx.h('li', null, ctx.h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title)))) : ctx.h('p', { class: 'small dim' }, 'No web sources were used for this part.'),
    ctx.h('p', { class: 'small dim' }, 'Written by AI. Check important facts against the sources, especially for health, legal or money decisions.'));
};

/* course data, kept for offline reading */
async function loadCourse(id) {
  try { const r = await ctx.api('GET', '/api/courses/' + id); ctx.db.learn.putDoc(id, { course: r.course }); return r.course; }
  catch (e) { const local = ctx.db.learn.doc(id); if (local && local.course && ctx.isNetworkError(e)) return local.course; throw e; }
}
async function syncProgress(course) {
  if (!navigator.onLine) return null;
  try {
    const p = await ctx.api('GET', '/api/courses/' + course.id + '/progress');
    Object.entries(p.quizzes).forEach(([mid, q]) => { if (q) ctx.db.learn.markQuiz(course.id, mid, q.score, q.evidenceId); });
    if (p.final) ctx.db.learn.markQuiz(course.id, 'final', p.final.score, p.final.evidenceId);
    if (p.certificate) { ctx.db.certs.put(p.certificate); const cur = ctx.db.learn.progress(course.id); ctx.db.learn.save(course.id, { ...cur, certId: p.certificate.id }); }
    return p;
  } catch (e) { return null; }
}
const lessonCount = c => c.modules.reduce((n, m) => n + m.lessons.length, 0);
function percentDone(course) {
  const p = ctx.db.learn.progress(course.id), total = lessonCount(course) + course.modules.length + 1;
  const done = course.modules.reduce((n, m) => n + m.lessons.filter(l => p.lessonsDone.includes(l.id)).length, 0) + course.modules.filter(m => (p.quizzes[m.id] || {}).best >= 70).length + ((p.quizzes.final || {}).best >= 70 ? 1 : 0);
  return Math.round(done / total * 100);
}
const progressBar = n => ctx.h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(n), 'aria-valuemin': '0', 'aria-valuemax': '100' }, ctx.h('i', { class: 'verified', style: { width: ctx.pct(n) + '%' } }));
const firstOpenLesson = course => { const p = ctx.db.learn.progress(course.id); for (const m of course.modules) for (const l of m.lessons) if (!p.lessonsDone.includes(l.id)) return l; return null; };

/* ---------------------------------------------------------------- catalogue */
async function pageCatalog() {
  const { h } = ctx, grid = h('div', { class: 'grid two' }), status = workingBox();
  let courses = [], q = '', aiOn = ctx.state.health.ai;
  const topic = h('input', { type: 'text', id: 'topic', maxlength: '120', placeholder: 'e.g. Introduction to accounting, Spanish for beginners, Nursing basics', 'aria-label': 'What do you want to learn?' });
  const level = h('select', { 'aria-label': 'Your level' }, Object.entries(LEVEL_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const url = h('input', { type: 'text', placeholder: 'https://... (optional)', 'aria-label': 'Web page to base the course on' });
  const btn = h('button', { type: 'submit' }, 'Create my course');
  const draw = () => {
    const mine = ctx.db.learn.all(), shown = courses.filter(c => !q || (c.title + ' ' + c.topic + ' ' + c.summary).toLowerCase().includes(q.toLowerCase()));
    grid.replaceChildren(...(shown.length ? shown.map(c => courseCard(c, mine[c.id])) : [h('p', { class: 'dim' }, courses.length ? 'No course matches. Try other words, or create it above.' : 'No courses yet. Create the first one above.')]));
  };
  const create = async ev => {
    ev.preventDefault();
    if (topic.value.trim().length < 3) { status.fail('Type what you want to learn first.'); return; }
    if (!navigator.onLine) { status.fail('Creating a course needs a connection.'); return; }
    btn.disabled = true; status.show('Designing your course... (usually under a minute)');
    try {
      const r = await runJob('POST', '/api/courses', { topic: topic.value.trim(), level: level.value, sourceUrl: url.value.trim() || undefined }, status.tick('Designing your course...'));
      ctx.db.learn.putDoc(r.course.id, { course: r.course }); ctx.db.learn.save(r.course.id, ctx.db.learn.progress(r.course.id)); location.href = '/#/course/' + r.course.id;
    } catch (e) { status.fail(errText(e)); btn.disabled = false; }
  };
  const mineCerts = ctx.db.certs.list();
  ctx.mount('learn',
    h('section', { class: 'hero' }, h('h1', null, 'Learn anything. Prove it.'), h('p', null, 'Short courses on any subject, built by AI with real examples from the web. Read the lessons, practise with quizzes, pass the final exam and earn a certificate anyone can verify.')),
    h('form', { class: 'card', onsubmit: create }, h('h2', null, 'What do you want to learn?'),
      aiOn ? null : h('div', { class: 'notice warn' }, 'Creating new courses needs the AI, which is not set up on this server. You can still open the courses below.'),
      topic, h('div', { class: 'chips' }, SUGGESTIONS.map(s => h('button', { type: 'button', class: 'chip btnish', onclick: () => { topic.value = s; topic.focus(); } }, s))),
      h('div', { class: 'row' }, h('label', { for: 'lvl', class: 'hint', style: { margin: 0 } }, 'Level'), level, btn),
      h('details', null, h('summary', null, 'Base it on a web page (optional)'), h('p', { class: 'small dim' }, 'Paste the address of a syllabus, article or guide and the course will follow it. Only public pages work.'), url), status.el),
    mineCerts.length ? h('section', null, h('h2', null, 'My certificates'), h('div', { class: 'grid two' }, mineCerts.map(c => h('article', { class: 'card' }, h('h3', null, c.courseTitle || (c.jobTitle + ' simulation')), h('p', { class: 'small dim' }, c.grade + ' · ' + c.overallScore + '% · ' + ctx.fmtDate(c.issuedAt)), h('a', { class: 'btn alt', href: '/#/certificate/' + c.id }, 'View certificate'))))) : null,
    h('section', null, h('h2', null, 'Courses'), h('input', { type: 'search', placeholder: 'Search courses', 'aria-label': 'Search courses', style: { maxWidth: '320px', marginBottom: '12px' }, oninput: e => { q = e.target.value; draw(); } }), grid));
  try { const r = await ctx.api('GET', '/api/courses'); courses = r.courses; ctx.db.cache.set('courseList', courses); if (r.aiOn !== undefined) aiOn = r.aiOn; }
  catch (e) { courses = ctx.db.cache.get('courseList', []); if (!ctx.isNetworkError(e)) status.fail(e.message); }
  draw();
}
function courseCard(c, prog) {
  const { h } = ctx, started = !!prog;
  return h('article', { class: 'card course' },
    h('div', { class: 'meta' }, h('span', { class: 'pill Proficient' }, LEVEL_LABEL[c.level] || c.level), c.sample ? h('span', { class: 'pill Strong' }, 'Sample · works without AI') : null, h('span', null, c.modules + ' modules · ' + c.lessons + ' lessons')),
    h('h3', null, h('a', { href: '/#/course/' + c.id }, c.title)), h('p', { class: 'small dim' }, c.summary),
    h('a', { class: 'btn alt', href: '/#/course/' + c.id, style: { alignSelf: 'flex-start' } }, started ? 'Continue' : 'View course'));
}

/* ---------------------------------------------------------------- one course */
async function pageCourse(id) {
  const { h } = ctx; ctx.mount('learn', ctx.loading('Opening the course...'));
  let course; try { course = await loadCourse(id); } catch (e) { return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'Course not found'), h('p', null, errText(e)), h('a', { href: '/#/learn' }, 'Back to courses'))); }
  const srv = await syncProgress(course), prog = ctx.db.learn.progress(id);
  if (!prog.startedAt) ctx.db.learn.save(id, prog);
  const next = firstOpenLesson(course), done = percentDone(course), cert = prog.certId ? ctx.db.certs.get(prog.certId) : null;
  const status = workingBox(), nameBox = h('input', { type: 'text', maxlength: '80', value: learnerName(), placeholder: 'Your full name', 'aria-label': 'Name to print on the certificate' });
  const quizBest = mid => (prog.quizzes[mid] || {}).best;
  const missing = srv ? srv.missing : null;
  const claim = async () => {
    const name = nameBox.value.trim(); if (name.length < 2) { status.fail('Enter the name to print on the certificate.'); return; }
    status.show('Issuing your certificate...');
    try { const r = await ctx.api('POST', '/api/courses/' + id + '/certificate', { studentName: name }); ctx.db.cache.set('learnerName', name); ctx.db.certs.put(r.certificate); ctx.db.learn.save(id, { ...ctx.db.learn.progress(id), certId: r.certificate.id }); location.href = '/#/certificate/' + r.certificate.id; }
    catch (e) { status.fail(errText(e)); }
  };
  ctx.mount('learn',
    h('p', null, h('a', { href: '/#/learn' }, '← All courses')),
    h('section', { class: 'card' }, h('div', { class: 'meta' }, h('span', { class: 'pill Proficient' }, LEVEL_LABEL[course.level] || course.level), h('span', { class: 'pill' }, course.static ? 'Hand-written sample course' : 'Designed by AI'), h('span', null, lessonCount(course) + ' lessons · ' + course.modules.length + ' quizzes + final exam')),
      h('h1', null, course.title), h('p', null, course.summary), h('p', { class: 'small dim' }, 'For: ' + course.audience),
      course.disclaimer ? h('div', { class: 'notice warn' }, course.disclaimer) : null,
      h('h3', null, 'You will be able to'), h('ul', null, course.outcomes.map(o => h('li', null, o.replace(/^Learners will be able to /i, '')))),
      h('div', { class: 'row' }, h('b', null, done + '% complete'), h('div', { style: { flex: '1', minWidth: '140px' } }, progressBar(done))),
      h('div', { class: 'row' }, next ? h('a', { class: 'btn', href: '/#/lesson/' + id + '/' + next.id }, prog.lessonsDone.length ? 'Continue: ' + next.title : 'Start learning') : h('a', { class: 'btn', href: '/#/quiz/' + id + '/final' }, 'Take the final exam'))),
    h('section', null, course.modules.map((m, mi) => {
      const best = quizBest(m.id);
      return h('article', { class: 'card module' }, h('h2', null, 'Module ' + (mi + 1) + ': ' + m.title), h('p', { class: 'small dim' }, m.summary),
        h('ul', { class: 'lessons' }, m.lessons.map(l => h('li', null, h('span', { class: 'tick', 'aria-hidden': 'true' }, prog.lessonsDone.includes(l.id) ? '✓' : '○'), h('a', { href: '/#/lesson/' + id + '/' + l.id }, l.title), h('span', { class: 'small dim' }, ' ' + l.minutes + ' min')))),
        h('div', { class: 'row' }, h('a', { class: 'btn alt', href: '/#/quiz/' + id + '/' + m.id }, best != null ? 'Retake quiz' : 'Take the module quiz'), best != null ? h('span', { class: 'pill ' + (best >= 70 ? 'Strong' : 'Developing') }, 'Best ' + best + '%' + (best >= 70 ? ' · passed' : ' · need 70%')) : h('span', { class: 'small dim' }, 'Pass mark 70%')));
    })),
    h('article', { class: 'card module' }, h('h2', null, 'Final exam'), h('p', { class: 'small dim' }, 'Covers every module. Fresh AI-written questions each time. You need 70%.'),
      h('div', { class: 'row' }, h('a', { class: 'btn alt', href: '/#/quiz/' + id + '/final' }, quizBest('final') != null ? 'Retake final exam' : 'Take the final exam'), quizBest('final') != null ? h('span', { class: 'pill ' + (quizBest('final') >= 70 ? 'Strong' : 'Developing') }, 'Best ' + quizBest('final') + '%') : null)),
    h('article', { class: 'card' }, h('h2', null, 'Certificate'),
      cert ? h('div', null, h('p', null, 'You earned this certificate: ' + cert.grade + ', ' + cert.overallScore + '%.'), h('a', { class: 'btn', href: '/#/certificate/' + cert.id }, 'View and print my certificate'))
        : srv && srv.eligible ? h('div', null, h('p', null, 'You have passed every quiz and the final exam. Enter your name exactly as you want it printed.'), nameBox, h('div', { class: 'row' }, h('button', { type: 'button', onclick: claim }, 'Get my certificate')), status.el)
        : h('div', null, h('p', { class: 'dim' }, 'Earned by passing every module quiz and the final exam (70% or more). The certificate is signed, so anyone can check it is genuine.'), missing && missing.length ? h('ul', { class: 'small' }, missing.map(x => h('li', null, x))) : (srv ? null : h('p', { class: 'small dim' }, 'Connect to the internet to check your progress.')))),
    sourcesView(course.sources, course.research));
}

/* ---------------------------------------------------------------- one lesson */
async function pageLesson(cid, lid) {
  const { h } = ctx; ctx.mount('learn', ctx.loading('Opening the lesson...'));
  let course; try { course = await loadCourse(cid); } catch (e) { return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'Course not found'), h('p', null, errText(e)), h('a', { href: '/#/learn' }, 'Back to courses'))); }
  const flat = course.modules.flatMap(m => m.lessons.map(l => ({ ...l, module: m }))), at = flat.findIndex(l => l.id === lid);
  if (at < 0) return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'Lesson not found'), h('a', { href: '/#/course/' + cid }, 'Back to the course')));
  const meta = flat[at], status = workingBox(), local = ctx.db.learn.doc(cid), cached = local && local.lessons && local.lessons[lid];
  let lesson = cached || null;
  if (!lesson) {
    ctx.mount('learn', h('p', null, h('a', { href: '/#/course/' + cid }, '← ' + course.title)), h('h1', null, meta.title), h('div', { class: 'card' }, status.el));
    if (!navigator.onLine) { status.fail('This lesson has not been downloaded yet. Connect to the internet to open it.'); return; }
    status.show('Your tutor is writing this lesson... (usually under a minute)');
    try { lesson = (await runJob('POST', '/api/courses/' + cid + '/lessons/' + lid, null, status.tick('Your tutor is writing this lesson...'))).lesson; ctx.db.learn.putDoc(cid, { lessons: { [lid]: lesson } }); }
    catch (e) { status.fail(errText(e)); status.el.append(ctx.h('div', { class: 'row' }, ctx.h('button', { type: 'button', onclick: () => pageLesson(cid, lid) }, 'Try again'), ctx.h('a', { class: 'btn alt', href: '/#/course/' + cid }, 'Back to the course'))); return; }
  } else ctx.db.learn.putDoc(cid, {});
  const prev = flat[at - 1], nxt = flat[at + 1], isDone = () => ctx.db.learn.progress(cid).lessonsDone.includes(lid);
  const doneBtn = h('button', { type: 'button' }, isDone() ? '✓ Completed' : 'Mark as complete');
  doneBtn.addEventListener('click', () => { ctx.db.learn.markLesson(cid, lid); doneBtn.textContent = '✓ Completed'; ctx.toast('Lesson marked complete'); });
  const lastInModule = !nxt || nxt.module.id !== meta.module.id;
  ctx.mount('learn',
    h('p', null, h('a', { href: '/#/course/' + cid }, '← ' + course.title)),
    h('div', { class: 'meta' }, h('span', null, 'Module: ' + meta.module.title), h('span', null, 'Lesson ' + (at + 1) + ' of ' + flat.length), h('span', null, meta.minutes + ' min read')),
    h('h1', null, lesson.title), h('p', { class: 'lead' }, lesson.intro),
    ...lesson.sections.map(s => h('section', { class: 'card' }, h('h2', null, s.heading), rich(s.body))),
    h('section', { class: 'card callout' }, h('div', { class: 'small dim' }, 'Worked example'), h('h2', null, lesson.example.title), h('p', null, h('b', null, 'Situation: '), lesson.example.scenario), rich(lesson.example.walkthrough)),
    h('section', { class: 'card' }, h('h2', null, 'Key terms'), h('dl', { class: 'terms' }, lesson.keyTerms.flatMap(k => [h('dt', null, k.term), h('dd', null, k.meaning)]))),
    h('section', { class: 'card' }, h('h2', null, 'Check yourself'), lesson.checks.map(c => h('details', { class: 'check' }, h('summary', null, c.question), h('p', null, c.answer)))),
    h('section', { class: 'card' }, h('h2', null, 'Recap'), h('ul', null, lesson.recap.map(r => h('li', null, r)))),
    sourcesView(lesson.sources, lesson.research),
    h('div', { class: 'row' }, doneBtn, prev ? h('a', { class: 'btn alt', href: '/#/lesson/' + cid + '/' + prev.id }, '← Previous') : null,
      nxt && !lastInModule ? h('a', { class: 'btn', href: '/#/lesson/' + cid + '/' + nxt.id }, 'Next lesson →') : h('a', { class: 'btn', href: '/#/quiz/' + cid + '/' + meta.module.id }, 'Take the module quiz →'),
      nxt && lastInModule ? h('a', { class: 'btn alt', href: '/#/lesson/' + cid + '/' + nxt.id }, 'Skip to next module') : null));
}

/* ---------------------------------------------------------------- quiz / final exam */
async function pageQuiz(cid, mid) {
  const { h } = ctx; ctx.mount('learn', ctx.loading('Opening the quiz...'));
  let course; try { course = await loadCourse(cid); } catch (e) { return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'Course not found'), h('p', null, errText(e)), h('a', { href: '/#/learn' }, 'Back to courses'))); }
  const mod = course.modules.find(m => m.id === mid), isFinal = mid === 'final';
  if (!mod && !isFinal) return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'Quiz not found'), h('a', { href: '/#/course/' + cid }, 'Back to the course')));
  const title = isFinal ? 'Final exam' : 'Quiz: ' + mod.title, status = workingBox(), body = h('div'), best = (ctx.db.learn.progress(cid).quizzes[mid] || {}).best;
  const startBtn = h('button', { type: 'button' }, 'Start ' + (isFinal ? 'the final exam' : 'the quiz'));
  startBtn.addEventListener('click', async () => {
    if (!navigator.onLine) { status.fail('Quizzes are written fresh by the AI, so they need a connection.'); return; }
    startBtn.disabled = true; status.show('Writing your questions... (usually under a minute)');
    try { const r = await runJob('POST', '/api/courses/' + cid + '/assessments', { moduleId: mid }, status.tick('Writing your questions...')); status.clear(); renderAttempt(r.attempt); }
    catch (e) { status.fail(errText(e)); startBtn.disabled = false; }
  });
  function renderAttempt(att) {
    const t0 = Date.now(), picks = att.questions.map(() => null), boxes = att.questions.map(q => (q.type === 'written' ? h('textarea', { 'aria-label': 'Your answer', style: { minHeight: '110px' } }) : null)), submit = h('button', { type: 'button' }, 'Submit answers');
    body.replaceChildren(h('div', { class: 'notice info' }, att.questions.length + ' questions. The written answers are marked by AI against a rubric. Pass mark: 70%.'),
      ...att.questions.map((q, i) => h('fieldset', { class: 'card quiz-q' }, h('legend', { class: 'small dim' }, 'Question ' + (i + 1) + ' of ' + att.questions.length + (q.type === 'written' ? ' · written (counts double)' : '')), h('p', null, h('b', null, q.question)),
        q.type === 'mcq' ? q.options.map((o, k) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'q' + i, value: k, onchange: () => { picks[i] = k; } }), h('span', null, o)))
          : h('div', null, boxes[i], h('details', null, h('summary', null, 'How this will be marked (aim for ' + q.minWords + '+ words)'), h('ul', null, q.rubric.map(r => h('li', null, r.label))))))),
      h('div', { class: 'row' }, submit), status.el);
    submit.addEventListener('click', async () => {
      const answers = att.questions.map((q, i) => (q.type === 'mcq' ? (picks[i] == null ? null : { choice: picks[i] }) : { text: boxes[i].value }));
      if (answers.some(a => a == null)) { status.fail('Answer every multiple-choice question first.'); return; }
      if (att.questions.some((q, i) => q.type === 'written' && boxes[i].value.trim().length < 10)) { status.fail('Write an answer for each written question.'); return; }
      submit.disabled = true; status.show('Marking your answers...');
      try {
        const res = await ctx.api('POST', '/api/assessments/' + att.id + '/submit', { answers, studentName: learnerName() || undefined, timeSpentSec: Math.round((Date.now() - t0) / 1000) });
        if (res.evidence) ctx.db.evidence.put(res.evidence);
        ctx.db.learn.markQuiz(cid, mid, res.score, res.evidence && res.evidence.id); status.clear(); renderResult(att, res);
      } catch (e) { status.fail(errText(e) + (e.status === 503 ? ' Your answers are still here: press Submit again in a moment.' : '')); submit.disabled = false; }
    });
  }
  function renderResult(att, res) {
    window.scrollTo(0, 0);
    body.replaceChildren(
      h('section', { class: 'card' }, h('div', { class: 'row', style: { marginTop: 0 } }, h('span', { class: 'score ' + (res.passed ? 'pass' : 'fail') }, res.score + '%'), h('div', null, h('b', null, res.passed ? 'Passed' : 'Not yet'), h('div', { class: 'small dim' }, 'Pass mark ' + res.passMark + '%'))),
        res.evidence ? h('div', { class: 'notice good' }, 'Signed evidence issued. ', h('a', { href: '/verify/' + res.evidence.id }, 'View it')) : null, res.note ? h('div', { class: 'notice info' }, res.note) : null,
        !res.passed ? h('div', { class: 'notice info' }, 'Read the feedback below, review the lessons, then try again. You will get new questions.') : null,
        res.eligible ? h('div', { class: 'notice good' }, h('b', null, 'You have passed everything. '), h('a', { href: '/#/course/' + cid }, 'Claim your certificate')) : (res.passed && res.missing && res.missing.length ? h('div', { class: 'notice info' }, 'Still to do: ' + res.missing.join('; ') + '.') : null),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '/#/course/' + cid }, 'Back to the course'), h('button', { class: 'alt', type: 'button', onclick: () => pageQuiz(cid, mid) }, 'Retake with new questions'))),
      ...res.results.map((r, i) => { const q = att.questions[i]; return h('article', { class: 'card ' + (r.score >= 0.999 ? 'right' : 'wrong') }, h('div', { class: 'small dim' }, 'Question ' + (i + 1) + ' · ' + Math.round(r.score * 100) + '%'), h('p', null, h('b', null, q.question)),
        r.type === 'mcq' ? h('p', { class: 'small' }, 'You chose: ' + q.options[r.chosen] + (r.score >= 0.999 ? '' : '  |  Best answer: ' + q.options[r.correct])) : null, h('p', { class: 'small' }, r.feedback), r.rubric ? ctx.rubricView(r.rubric) : null); }));
  }
  ctx.mount('learn', h('p', null, h('a', { href: '/#/course/' + cid }, '← ' + course.title)), h('h1', null, title),
    best != null ? h('p', { class: 'dim' }, 'Your best score so far: ' + best + '%') : null,
    h('div', { class: 'card' }, h('p', null, course.static ? (isFinal ? 'The final exam covers every module. Questions are drawn from a fixed bank and shuffled each time.' : 'A short quiz on this module, drawn from a fixed question bank and shuffled each time. Pass with 70% to earn signed evidence.')
      : (isFinal ? 'The final exam covers every module. The questions are written fresh by AI each time, so retakes are different.' : 'A short quiz on this module with fresh AI-written questions. Pass with 70% to earn signed evidence.')),
      h('div', { class: 'row' }, startBtn, h('a', { class: 'btn alt', href: '/#/course/' + cid }, 'Back')), status.el), body);
}

/* ---------------------------------------------------------------- certificate */
async function pageCertificate(id) {
  const { h } = ctx; ctx.mount('learn', ctx.loading('Opening the certificate...'));
  let cert = ctx.db.certs.get(id), serverValid = null;
  try { const r = await ctx.api('GET', '/api/verify/' + encodeURIComponent(id)); cert = r.evidence; serverValid = r.valid; }
  catch (e) { if (!cert) return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'Certificate not found'), h('p', null, ctx.isNetworkError(e) ? 'You appear to be offline and this certificate is not saved on this device.' : e.message), h('a', { href: '/#/learn' }, 'Back to courses'))); }
  if (!cert || cert.kind !== 'certificate') return ctx.mount('learn', h('div', { class: 'card' }, h('h2', null, 'This is not a certificate'), h('a', { href: '/#/learn' }, 'Back to courses')));
  let local = null; try { local = await ctx.Verifier.verify(cert, ctx.state.keys); } catch (e) { /* no keys yet */ }
  const ok = serverValid !== false && local !== false, link = location.origin + '/verify/' + cert.id;
  if (cert.certType === 'simulation') return window.Sim.renderCertificate(cert, ok, local, serverValid);   // work-simulation certificates have their own design
  ctx.mount('learn',
    h('div', { class: 'noprint' }, h('p', null, h('a', { href: '/#/learn' }, '← All courses')),
      h('div', { class: 'valid-box ' + (ok ? 'ok' : 'bad') }, h('b', null, ok ? 'Authentic and unaltered' : 'FAILED: this certificate does not match its signature'), 'Signature ' + (local === true ? 'checked in your browser with the issuer\'s public key' + (serverValid ? ' and by the issuer\'s registry.' : '.') : local === null ? 'checked by the issuer\'s registry.' : 'did not match.'))),
    h('section', { class: 'certificate' },
      h('div', { class: 'cert-brand' }, 'SkillBridge'), h('div', { class: 'cert-kicker' }, 'Certificate of completion'),
      h('p', { class: 'cert-line' }, 'This certifies that'), h('h1', { class: 'cert-name' }, cert.studentName), h('p', { class: 'cert-line' }, 'has successfully completed the course'),
      h('h2', { class: 'cert-course' }, cert.courseTitle), h('p', { class: 'cert-line' }, (LEVEL_LABEL[cert.courseLevel] || cert.courseLevel) + ' level · ' + cert.grade + ' · overall score ' + cert.overallScore + '%'),
      h('div', { class: 'cert-modules' }, cert.modules.map(m => h('div', null, h('span', null, m.title), h('b', null, m.score + '%'))), h('div', { class: 'final' }, h('span', null, 'Final exam'), h('b', null, cert.finalScore + '%'))),
      h('p', { class: 'cert-date' }, 'Issued ' + ctx.fmtDate(cert.issuedAt)),
      h('p', { class: 'cert-small' }, cert.statement), h('p', { class: 'cert-small' }, 'Verify at ', h('code', null, link), ' · Certificate ID ', h('code', null, cert.id))),
    h('div', { class: 'row noprint' }, h('button', { type: 'button', onclick: () => window.print() }, 'Print or save as PDF'), h('button', { class: 'alt', type: 'button', onclick: () => ctx.copyText(link, 'Verification link') }, 'Copy verification link'),
      h('button', { class: 'alt', type: 'button', onclick: () => ctx.download('skillbridge-certificate-' + cert.id + '.json', JSON.stringify(cert, null, 2)) }, 'Download signed file')),
    h('p', { class: 'small dim noprint' }, 'Employers can paste the link or ID on the Verify page. The signed file can be checked without trusting this page.'));
}

/* a certificate shown on the public Verify page */
function certificateSummary(cert, valid) {
  const { h } = ctx;
  return h('div', { class: 'card' }, h('h2', null, 'Certificate: ' + cert.courseTitle), h('p', null, h('b', null, cert.studentName), ' · ' + (LEVEL_LABEL[cert.courseLevel] || cert.courseLevel) + ' · ' + cert.grade),
    h('div', { class: 'row', style: { marginTop: 0 } }, h('span', { class: 'score ' + (valid ? 'pass' : 'fail') }, cert.overallScore + '%'), h('span', { class: 'dim' }, 'Issued ' + ctx.fmtDate(cert.issuedAt))),
    h('p', { class: 'small dim' }, cert.statement), h('ul', { class: 'small' }, cert.modules.map(m => h('li', null, m.title + ': ' + m.score + '%')), h('li', null, 'Final exam: ' + cert.finalScore + '%')),
    h('details', null, h('summary', null, 'Technical details'), h('p', { class: 'small' }, 'Certificate ID: ', h('code', { class: 'id' }, cert.id)), h('p', { class: 'small' }, 'Signed evidence IDs: ', h('code', { class: 'id' }, (cert.evidenceIds || []).join(', '))), h('p', { class: 'small' }, 'Signature (' + (cert.alg || 'Ed25519') + '): ', h('code', { class: 'id' }, cert.signature))));
}

/* ---------------------------------------------------------------- routing */
function route(hash) {
  let m;
  if (hash === '#/learn') { pageCatalog(); return true; }
  if ((m = /^#\/course\/(crs_[a-f0-9]{10})$/.exec(hash))) { pageCourse(m[1]); return true; }
  if ((m = /^#\/lesson\/(crs_[a-f0-9]{10})\/(l\d+-\d+)$/.exec(hash))) { pageLesson(m[1], m[2]); return true; }
  if ((m = /^#\/quiz\/(crs_[a-f0-9]{10})\/(m\d+|final)$/.exec(hash))) { pageQuiz(m[1], m[2]); return true; }
  if ((m = /^#\/certificate\/(cert_[a-f0-9]+)$/.exec(hash))) { pageCertificate(m[1]); return true; }
  return false;
}
window.Learn = { init, route, certificateSummary };
})();
