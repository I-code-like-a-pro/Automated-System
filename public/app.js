/* SkillBridge web app: vanilla JS, no dependencies, offline-first.
   Data model:
     - the person's own database is LocalDB (localStorage): profile, coursework, evidence copy, drafts, offline queue
     - the server holds only the shared registry of signed evidence + opt-in public portfolios
   All user-provided text is inserted with textContent (never innerHTML), and the server's CSP forbids inline scripts. */
(() => {
'use strict';
const Sk = window.Skills, db = window.LocalDB.open(), Share = window.Share, Verifier = window.Verifier, JobMatch = window.JobMatch;

/* ---------------------------------------------------------------- small helpers */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);          // CSSOM is allowed by our CSP, inline style attributes are not
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach(c => { if (c == null || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
const $app = () => document.getElementById('app');
const kids = (...n) => n.flat(Infinity).filter(x => x != null && x !== false);   // replaceChildren() would print null/false as text
const stars = n => '●'.repeat(n) + '○'.repeat(3 - n);
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return iso; } };
const pct = n => Math.max(0, Math.min(100, Math.round(n)));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
function toast(msg) { const box = document.getElementById('toasts'), t = h('div', { class: 'toast' }, msg); box.append(t); setTimeout(() => t.remove(), 5000); }
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast((label || 'Text') + ' copied'); } catch (e) { window.prompt('Copy this:', text); }
}
function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------- state + server API */
const state = { tasks: db.cache.get('tasks', []), roles: db.cache.get('roles', null), health: db.cache.get('health', { ai: false }), keys: db.cache.get('keys', null), portfolio: null };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-owner-key': db.meta.ownerKey() }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || 'Request failed (' + res.status + ')'); e.status = res.status; throw e; }
  return json;
}
const isNetworkError = e => !e.status;   // fetch() rejects with a TypeError when there is no connection

/* AI-written tasks live on the server (with their answer keys) and as a stripped copy in LocalDB, merged into the task list */
function mergeGenerated(extra) {
  let gen = db.cache.get('gen', []) || [];
  (extra || []).forEach(t => { if (!gen.some(g => g.id === t.id)) gen.unshift(t); });
  gen = gen.slice(0, 40); if (extra && extra.length) db.cache.set('gen', gen);
  state.tasks = state.tasks.filter(t => !t.generated).concat(gen);
}
mergeGenerated();

const profile = () => db.profile.get();
function role() {
  const p = profile(), id = p && state.roles && state.roles[p.role] ? p.role : 'software-engineer', r = (state.roles && state.roles[id]) || { title: 'Junior Software Engineer', skills: [], targetLevel: 70 };
  return { id, ...r };
}
function computed() {
  const r = role(), list = state.tasks.filter(t => t.role === r.id), ev = db.evidence.list(), p = profile() || {};
  const levels = Sk.levelsFromEvidence(ev, list, r.skills);
  return { r, list, ev, levels, claimed: Sk.claimedFromCoursework(p.coursework, r.skills), recommended: Sk.recommend(levels, list, ev, r.targetLevel, 4) };
}
const taskTitle = id => (state.tasks.find(t => t.id === id) || { title: id }).title;

/* ---------------------------------------------------------------- syncing with the shared registry */
async function syncFromServer() {
  if (!navigator.onLine || !profile()) return;
  try {
    const mine = await api('GET', '/api/mine');
    let added = 0; mine.evidence.forEach(e => { if (db.evidence.put(e) !== 'kept') added++; });
    state.portfolio = mine.portfolio; mergeGenerated(mine.tasks);
    if (added) toast('Restored ' + plural(added, 'piece') + ' of evidence from the server');
  } catch (e) { /* offline or no records yet */ }
}

/* restore a backup file: keep only records whose signature is genuine, then re-sync with the server */
async function restoreFromFile(file) {
  if (!file) { toast('Choose a backup file first'); return false; }
  try {
    const b = db.parseBackup(JSON.parse(await file.text()));
    let records = b.evidence;
    if (records.length) {
      const res = await api('POST', '/api/verify', { records: records.slice(0, 60) }), ok = new Set(res.results.filter(r => r.valid).map(r => r.id));
      records = records.filter(r => ok.has(r.id));
    }
    const n = db.restore({ ownerKey: b.ownerKey, profile: b.profile, evidence: records });
    await syncFromServer(); toast('Restored ' + plural(n, 'piece') + ' of evidence'); return true;
  } catch (e) { toast(isNetworkError(e) ? 'Restoring checks signatures online. Connect and try again.' : e.message); return false; }
}
async function flushQueue() {
  const q = db.queue.list();
  if (!q.length || !navigator.onLine) return;
  const rest = [];
  for (const item of q) {
    try {
      const res = await api('POST', '/api/submit', item);
      if (res.evidence) db.evidence.put(res.evidence);
      toast('Synced "' + taskTitle(item.taskId) + '": ' + res.score + '%' + (res.evidence ? ' (evidence issued)' : ''));
    } catch (e) {
      if (isNetworkError(e) || e.status >= 500 || e.status === 429) rest.push(item); else toast('A saved answer could not be submitted: ' + e.message);
    }
  }
  db.queue.setAll(rest);
  if (!rest.length) route();
}

/* ---------------------------------------------------------------- chrome */
function topbar(current) {
  const nav = [['/#/', 'Dashboard', 'home'], ['/#/jobs', 'Job match', 'jobs'], ['/#/tasks', 'Practice', 'tasks'], ['/#/portfolio', 'Portfolio', 'portfolio'], ['/verify', 'Verify', 'verify']], p = profile();
  document.getElementById('topbar').replaceChildren(
    h('a', { class: 'brand', href: '/#/' }, h('img', { src: '/icon.svg', alt: '', width: 26, height: 26 }), 'SkillBridge'),
    h('nav', { class: 'main', 'aria-label': 'Main' }, nav.map(([href, label, key]) => h('a', { href, 'aria-current': key === current ? 'page' : null }, label))),
    h('span', { class: 'spacer' }),
    h('span', { class: 'badge ' + (navigator.onLine ? 'on' : 'off'), title: navigator.onLine ? 'Connected' : 'Your work is saved on this device and syncs later' }, navigator.onLine ? 'Online' : 'Offline: saving locally'),
    h('span', { class: 'badge', title: 'Written tasks are graded by AI when the server has a key, otherwise by a checklist' }, state.health.ai ? 'AI feedback on' : 'Checklist feedback'),
    p ? h('a', { href: '/#/profile', class: 'badge' }, p.name) : h('a', { href: '/#/', class: 'badge' }, 'Get started'));
  document.getElementById('foot').replaceChildren(h('p', null, 'SkillBridge verifies that evidence was graded and issued by this system and has not been altered. It does not prove who did the work or that it was done unaided. Your profile and coursework stay in this browser. Only your signed evidence and, if you choose, a public portfolio are kept on the server.'));
}
function mount(current, ...nodes) { topbar(current); $app().replaceChildren(...kids(nodes)); $app().focus({ preventScroll: true }); window.scrollTo(0, 0); }
const loading = msg => h('p', { class: 'loading' }, msg || 'Loading...');

/* ---------------------------------------------------------------- pieces */
function skillMap(levels, claimed, target, showClaimed = true) {
  return h('div', null,
    role().skills.map(s => {
      const v = levels && levels[s.id] ? levels[s.id] : { level: 0, tasksDone: 0, tasksAvailable: 0 }, c = showClaimed && claimed && claimed[s.id] ? claimed[s.id].claimed : 0;
      return h('div', { class: 'skill' },
        h('div', { class: 'skill-head' }, h('b', null, s.name), h('span', { class: 'dim' }, 'Verified ' + v.level + (showClaimed ? ' · Coursework suggests ' + c : '') + ' · ' + v.tasksDone + '/' + v.tasksAvailable + ' tasks')),
        h('div', { class: 'bar', role: 'img', 'aria-label': s.name + ': verified ' + v.level + ' out of 100, target ' + target }, showClaimed ? h('i', { class: 'claimed', style: { width: pct(c) + '%' } }) : null, h('i', { class: 'verified', style: { width: pct(v.level) + '%' } }), h('u', { class: 'target', style: { left: pct(target) + '%' } })),
        h('p', { class: 'small dim', style: { margin: '2px 0 0' } }, s.desc));
    }),
    h('div', { class: 'legend' }, showClaimed ? h('span', { class: 'l-claimed' }, 'Suggested by your coursework (not proof)') : null, h('span', { class: 'l-verified' }, 'Verified by graded evidence'), h('span', { class: 'l-target' }, 'Level employers expect (' + target + ')')));
}
const skillChips = skills => Object.keys(skills).map(id => { const s = role().skills.find(x => x.id === id); return h('span', { class: 'chip' }, s ? s.name : id); });
function taskCard(t, best) {
  const done = best[t.id] != null;
  return h('article', { class: 'card task' },
    h('h3', null, h('a', { href: '/#/task/' + t.id }, t.title)),
    h('div', { class: 'meta' }, h('span', { title: 'Difficulty' }, stars(t.difficulty)), h('span', null, t.minutes + ' min'), h('span', null, { mcq: 'Debug it', scenario: 'Decisions', code: 'Write code', written: 'Write it up' }[t.type]), t.generated ? h('span', { class: 'pill' }, 'AI-written') : null,
      done ? h('span', { class: 'pill ' + Sk.levelName(best[t.id]) }, 'Best ' + best[t.id] + '%') : null),
    h('div', { class: 'chips' }, skillChips(t.skills)),
    h('a', { class: 'btn alt', href: '/#/task/' + t.id, style: { alignSelf: 'flex-start' } }, done ? 'Practise again' : 'Start'));
}
function rubricView(rubric) { return h('div', null, rubric.map(r => h('div', { class: 'rub' }, h('span', null, r.label), h('b', null, Math.round(r.score * 100) + '%'), r.comment ? h('small', null, r.comment) : null))); }
function evidenceCard(e, opts = {}) {
  const url = location.origin + '/verify/' + e.id;
  return h('article', { class: 'card evidence' },
    h('div', { class: 'top' }, h('h3', { style: { margin: 0 } }, e.taskTitle), h('span', null, h('span', { class: 'pill ' + e.level }, e.level), ' ', h('b', null, e.score + '%'))),
    h('div', { class: 'meta' }, h('span', null, fmtDate(e.issuedAt)), h('span', null, { ai: 'AI-assessed', rubric: 'Checklist-assessed', auto: 'Auto-graded' }[e.graderMode] || ''), e.timeSpentSec ? h('span', null, Math.max(1, Math.round(e.timeSpentSec / 60)) + ' min') : null),
    h('div', { class: 'chips' }, skillChips(e.skills)),
    h('details', null, h('summary', null, 'What was assessed'), e.rubric.map(r => h('div', { class: 'rub' }, h('span', null, r.label), h('b', null, Math.round(r.score * 100) + '%'))), e.feedback ? h('p', { class: 'small dim' }, e.feedback) : null),
    h('div', { class: 'row noprint', style: { marginTop: '4px' } }, h('a', { class: 'btn alt', href: '/verify/' + e.id }, 'Verify'), opts.copy === false ? null : h('button', { class: 'alt', onclick: () => copyText(url, 'Verification link') }, 'Copy link')));
}
function storageWarning() { return db.persistent ? null : h('div', { class: 'notice bad' }, 'Your browser is blocking storage (private mode?). Your progress will be lost when you close this tab. Use a normal window, and download a backup from Profile.'); }

/* ---------------------------------------------------------------- pages */
function pageOnboard() {
  const claimedBox = h('div', { class: 'chips', 'aria-live': 'polite' }), roles = state.roles || {};
  const form = h('form', { class: 'card', onsubmit: ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    if (!db.profile.set({ name: String(d.name || '').trim().slice(0, 80), major: String(d.major || '').trim().slice(0, 100), year: String(d.year || '').trim().slice(0, 10), role: d.role || 'software-engineer', coursework: String(d.coursework || '').slice(0, 4000) })) { toast(db.lastError || 'Could not save on this device'); return; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // ask the browser not to evict our data
    syncFromServer(); pageWelcome();
  } },
    h('h2', null, 'Create your profile'), h('p', { class: 'small dim' }, 'It is saved only in this browser. No account, no password, nothing sent to a server.'),
    h('label', { for: 'f-name' }, 'Your name'), h('input', { id: 'f-name', name: 'name', type: 'text', required: true, maxlength: 80, autocomplete: 'name' }),
    h('div', { class: 'grid two' },
      h('div', null, h('label', { for: 'f-major' }, 'Degree or major'), h('input', { id: 'f-major', name: 'major', type: 'text', maxlength: 100, placeholder: 'e.g. Computer Science' })),
      h('div', null, h('label', { for: 'f-year' }, 'Graduation year'), h('input', { id: 'f-year', name: 'year', type: 'text', maxlength: 10, placeholder: '2026' }))),
    h('label', { for: 'f-role' }, 'The job you are aiming for'), h('select', { id: 'f-role', name: 'role' }, Object.entries(roles).map(([id, r]) => h('option', { value: id }, r.title))),
    h('label', { for: 'f-course' }, 'What you have studied and built ', h('span', { class: 'hint' }, '(courses, projects, clubs, internships: one per line)')),
    h('textarea', { id: 'f-course', name: 'coursework', maxlength: 4000, placeholder: 'Data Structures and Algorithms\nSoftware Engineering group project\nGit and GitHub workshop\nHackathon team', oninput: e => {
      const c = Sk.claimedFromCoursework(e.target.value, role().skills), found = role().skills.filter(s => c[s.id].claimed > 0);
      claimedBox.replaceChildren(...kids(found.length ? [h('span', { class: 'small dim' }, 'Skills your coursework suggests: ')].concat(found.map(s => h('span', { class: 'chip' }, s.name))) : []));
    } }),
    claimedBox, h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Show me my skill gaps')));
  const backupInput = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a backup file' });
  const restoreCard = h('div', { class: 'card' }, h('h3', null, 'Already used SkillBridge?'), h('p', { class: 'small dim' }, 'Restore your profile and evidence from a backup file you downloaded earlier.'),
    h('div', { class: 'row' }, backupInput, h('button', { class: 'alt', type: 'button', onclick: async () => { if (await restoreFromFile(backupInput.files[0])) route(); } }, 'Restore from backup')));
  mount('home', storageWarning(),
    h('section', { class: 'hero' }, h('h1', null, 'Turn what you studied into proof you can do the job.'),
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { onclick: startDemo }, 'Try the 60-second demo'), h('a', { class: 'btn alt', href: '/verify' }, 'I am an employer: verify a credential')),
      h('p', null, 'Employers want experience and evidence. SkillBridge shows which skills your degree gives you, lets you practise real workplace tasks, and issues tamper-proof evidence an employer can check in seconds.')),
    h('div', { class: 'steps' },
      h('div', { class: 'step' }, h('b', null, 'See your gaps'), h('p', { class: 'small dim' }, 'Your coursework is mapped to the skills a junior software engineer needs.')),
      h('div', { class: 'step' }, h('b', null, 'Do real tasks'), h('p', { class: 'small dim' }, 'Fix bugs, review code, write incident updates: briefs from a manager, graded for real.')),
      h('div', { class: 'step' }, h('b', null, 'Share verified evidence'), h('p', { class: 'small dim' }, 'Every pass is signed. Send employers a link; they verify it without an account.')),
      h('div', { class: 'step' }, h('b', null, 'Works on weak internet'), h('p', { class: 'small dim' }, 'Tiny download, works offline, saves your answers and syncs later.'))),
    h('div', { class: 'grid three', style: { margin: '10px 0' } },
      h('div', { class: 'card' }, h('h3', null, 'For students'), h('p', { class: 'small dim' }, 'See your skill gaps, practise real tasks, check any job ad against what you have proven, and build a tailored application pack.')),
      h('div', { class: 'card' }, h('h3', null, 'For employers'), h('p', { class: 'small dim' }, 'Verify evidence in seconds, even offline: every record is signed with a public key you can check yourself. See what was actually graded.')),
      h('div', { class: 'card' }, h('h3', null, 'For universities'), h('p', { class: 'small dim' }, 'A privacy-safe class dashboard shows which skills your graduates lack, with ready-made exercises to close the gap.'))),
    form, restoreCard);
}
function pageWelcome() {
  mount('home', h('div', { class: 'card' }, h('h1', null, 'Welcome, ' + profile().name + '!'),
    h('p', null, 'Your profile lives in this browser, so you can start practising straight away.'),
    h('div', { class: 'notice warn' }, h('b', null, 'Back it up. '), 'If you clear your browser data or switch device, your profile is gone unless you saved a backup file. You can do it any time from Profile. The backup also carries your private key, which keeps your shared evidence linked to you.'),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: '/#/' }, 'Go to my dashboard'), h('a', { class: 'btn alt', href: '/#/profile' }, 'Open Profile'))));
}

function pageDashboard() {
  const p = profile(), { r, list, ev, levels, claimed, recommended } = computed(), best = db.evidence.bestByTask();
  const atTarget = r.skills.filter(s => (levels[s.id] || { level: 0 }).level >= r.targetLevel).length, q = db.queue.list().length, done = Object.keys(best).length;
  const lastBackup = db.meta.get().lastBackup, backupDue = ev.length && (!lastBackup || Date.now() - Date.parse(lastBackup) > 14 * 864e5);
  mount('home', storageWarning(),
    demoBanner(), h('h1', null, 'Hi ' + p.name.split(' ')[0] + ', here is your path to ' + r.title),
    q ? h('div', { class: 'notice warn' }, plural(q, 'saved answer') + ' will be submitted automatically when you are back online.') : null,
    backupDue ? h('div', { class: 'notice info' }, 'Your evidence is stored in this browser. ', h('a', { href: '/#/profile' }, 'Download a backup'), ' so you never lose it.') : null,
    h('div', { class: 'grid three' },
      h('div', { class: 'card stat' }, h('b', null, ev.length), 'pieces of verified evidence'), h('div', { class: 'card stat' }, h('b', null, atTarget + '/' + r.skills.length), 'skills at employer level'), h('div', { class: 'card stat' }, h('b', null, done + '/' + list.length), 'practice tasks passed')),
    h('section', { class: 'card' }, h('h2', null, 'Your skill map'), h('p', { class: 'dim' }, 'Employers trust proof, not course titles. Grey shows what your coursework suggests. Teal shows what you have actually proven.'), skillMap(levels, claimed, r.targetLevel)),
    h('section', null, h('h2', null, done ? 'Best next tasks to close your gaps' : 'Start here'), h('div', { class: 'grid two' }, recommended.map(t => taskCard(t, best)))),
    h('section', { class: 'card' }, h('h2', null, 'Share your evidence'), ev.length ? h('p', null, 'Your portfolio lets an employer verify every claim. You decide whether it is public.') : h('p', { class: 'dim' }, 'Pass a task to earn your first signed evidence.'), h('a', { class: 'btn', href: '/#/portfolio' }, 'Open my portfolio')));
}

/* "Write me a new task": the AI writes a fresh task for the chosen skill; the server checks it before we ever see it */
function generatorPanel(r) {
  if (!state.health.ai) return h('div', { class: 'card' }, h('h2', null, 'Fresh tasks written by AI'), h('p', { class: 'small dim' }, 'Switches on when this server has an AI key. Until then, practise the built-in tasks below.'));
  const skill = h('select', { 'aria-label': 'Skill to practise' }, r.skills.map(s => h('option', { value: s.id }, s.name)));
  const type = h('select', { 'aria-label': 'Task type' }, [['', 'Any type'], ['mcq', 'Debug it'], ['scenario', 'Decisions'], ['code', 'Write code'], ['written', 'Write it up']].map(([v, l]) => h('option', { value: v }, l)));
  const level = h('select', { 'aria-label': 'Difficulty' }, [['1', 'Easy'], ['2', 'Medium'], ['3', 'Hard']].map(([v, l]) => h('option', { value: v, selected: v === '2' }, l)));
  const status = h('div', { 'aria-live': 'polite' }), btn = h('button', { type: 'button' }, 'Write me a new task');
  btn.addEventListener('click', async () => {
    if (!navigator.onLine) { status.replaceChildren(h('div', { class: 'notice warn' }, 'Writing a new task needs a connection.')); return; }
    btn.disabled = true; status.replaceChildren(h('p', { class: 'dim' }, 'Your colleague is writing a task... this can take up to a minute.'));
    try {
      const res = await api('POST', '/api/generate', { skillId: skill.value, type: type.value || undefined, difficulty: Number(level.value) });
      mergeGenerated([res.task]); location.href = '/#/task/' + res.task.id;
    } catch (e) { status.replaceChildren(h('div', { class: 'notice bad' }, isNetworkError(e) ? 'Could not reach the server.' : e.message)); btn.disabled = false; }
  });
  return h('div', { class: 'card' }, h('h2', null, 'Fresh tasks written by AI'),
    h('p', { class: 'small dim' }, 'Pick a skill and get a brand-new task on it. An AI writes it and marks it; the answer key stays on the server, and code tasks are only offered after a reference solution passed every test. Evidence from these is labelled as AI-written.'),
    h('div', { class: 'row' }, skill, type, level, btn), status);
}

function pageTasks() {
  const best = db.evidence.bestByTask(), r = role();
  let skill = '', type = '', text = '';
  const list = h('div', { class: 'grid two' }), chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by skill' });
  const draw = () => {
    const items = state.tasks.filter(t => (!skill || t.skills[skill]) && (!type || t.type === type) && (!text || (t.title + t.brief).toLowerCase().includes(text.toLowerCase())));
    list.replaceChildren(...(items.length ? items.map(t => taskCard(t, best)) : [h('p', { class: 'dim' }, 'No tasks match. Try clearing the filters.')]));
  };
  const chipBtn = (id, name) => h('button', { class: 'chip btnish', 'aria-pressed': String(skill === id), onclick: () => { skill = id; chips.replaceChildren(...mk()); draw(); } }, name);
  const mk = () => [chipBtn('', 'All skills')].concat(r.skills.map(s => chipBtn(s.id, s.name)));
  chips.replaceChildren(...mk());
  mount('tasks', h('h1', null, 'Practice like it is your first week'),
    h('p', { class: 'dim' }, 'Each task comes as a brief from a colleague. Passing one (60% or more) earns signed evidence for your portfolio. No time limit, and you can retry.'),
    generatorPanel(r),
    h('div', { class: 'card' }, chips, h('div', { class: 'row' },
      h('select', { 'aria-label': 'Task type', onchange: e => { type = e.target.value; draw(); } }, [['', 'All types'], ['mcq', 'Debug it'], ['scenario', 'Decisions'], ['code', 'Write code'], ['written', 'Write it up']].map(([v, l]) => h('option', { value: v }, l))),
      h('input', { type: 'search', placeholder: 'Search tasks', 'aria-label': 'Search tasks', style: { maxWidth: '260px' }, oninput: e => { text = e.target.value; draw(); } }))), list);
  draw();
}

/* ----- a single task ----- */
function pageTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return mount('tasks', h('div', { class: 'card' }, h('h2', null, 'Task not found'), h('a', { href: '/#/tasks' }, 'Back to tasks')));
  const best = db.evidence.bestByTask()[id], startedAt = Date.now(), resultBox = h('div', { 'aria-live': 'polite' });
  let getAnswer, workspace;

  if (task.type === 'mcq') {
    const sel = { v: -1 };
    workspace = h('div', null, h('pre', { class: 'codeblock' }, task.mcq.code), h('fieldset', { style: { border: 0, padding: 0, margin: 0 } }, h('legend', { class: 'small dim' }, 'Choose the best answer'),
      task.mcq.options.map((o, i) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'opt', value: i, onchange: () => { sel.v = i; } }), h('span', null, o)))));
    getAnswer = () => sel.v < 0 ? null : { choice: sel.v };
  } else if (task.type === 'scenario') {
    const picks = task.scenario.steps.map(() => -1);
    workspace = h('div', null, task.scenario.steps.map((s, i) => h('fieldset', { class: 'card' }, h('legend', { class: 'small dim' }, 'Step ' + (i + 1) + ' of ' + task.scenario.steps.length), h('p', null, h('b', null, s.prompt)),
      s.options.map((o, k) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'step' + i, value: k, onchange: () => { picks[i] = k; } }), h('span', null, o))))));
    getAnswer = () => picks.includes(-1) ? null : { choices: picks };
  } else if (task.type === 'code') {
    const box = h('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Your code', value: db.drafts.get(id) || task.code.starter, oninput: e => db.drafts.set(id, e.target.value) });
    box.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); box.setRangeText('  ', box.selectionStart, box.selectionEnd, 'end'); } });
    const out = h('div', { 'aria-live': 'polite' }), runBtn = h('button', { class: 'alt', type: 'button' }, 'Run sample tests');
    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true; out.replaceChildren(h('p', { class: 'dim' }, 'Running...'));
      const res = await runLocal(box.value, task.code.fn, task.code.samples);
      out.replaceChildren(...res.map((r, i) => h('div', { class: r.ok ? 'test-ok' : 'test-bad' }, (r.ok ? '✓ ' : '✗ ') + (task.code.samples[i] ? task.code.fn + '(' + task.code.samples[i].args.map(a => JSON.stringify(a)).join(', ') + ') should be ' + JSON.stringify(task.code.samples[i].expect) : '') + (r.ok ? '' : ' (' + (r.err || 'got ' + JSON.stringify(r.got)) + ')'))),
        h('p', { class: 'small dim' }, task.code.hiddenCount + ' more hidden tests run when you submit, including edge cases.'));
      runBtn.disabled = false;
    });
    workspace = h('div', null, box, h('div', { class: 'row' }, runBtn), out);
    getAnswer = () => box.value.trim().length >= 10 ? { code: box.value } : null;
  } else {
    const w = task.written, wc = s => (s.trim().match(/\S+/g) || []).length, count = h('p', { class: 'small dim' });
    const box = h('textarea', { 'aria-label': 'Your answer', value: db.drafts.get(id), oninput: e => { db.drafts.set(id, e.target.value); count.textContent = wc(e.target.value) + ' words (aim for ' + w.minWords + '+)'; } });
    count.textContent = wc(box.value) + ' words (aim for ' + w.minWords + '+)';
    workspace = h('div', null, w.code ? h('pre', { class: 'codeblock' }, w.code) : null, h('p', null, h('b', null, w.prompt)), box, count, h('details', null, h('summary', null, 'How this will be assessed'), h('ul', null, w.rubric.map(r => h('li', null, r.label)))));
    getAnswer = () => box.value.trim().length >= 10 ? { text: box.value } : null;
  }

  const submitBtn = h('button', { type: 'button' }, 'Submit for verified evidence');
  submitBtn.addEventListener('click', async () => {
    const answer = getAnswer();
    if (!answer) { toast(task.type === 'code' || task.type === 'written' ? 'Write your answer first.' : 'Choose an answer for every question.'); return; }
    if (!profile()) { toast('Create your profile first. It takes a minute and stays on this device.'); location.href = '/#/'; return; }
    const payload = { taskId: id, answer, studentName: profile().name, timeSpentSec: Math.round((Date.now() - startedAt) / 1000) };
    submitBtn.disabled = true;
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const res = await api('POST', '/api/submit', payload);
      if (res.evidence) db.evidence.put(res.evidence);
      db.drafts.clear(id); topbar('tasks'); showResult(res);
    } catch (e) {
      if (isNetworkError(e)) {
        db.queue.push(payload);
        resultBox.replaceChildren(h('div', { class: 'notice warn' }, h('b', null, 'Saved on this device. '), 'You are offline. Your answer will be submitted and graded automatically the next time you are connected.'));
      } else resultBox.replaceChildren(h('div', { class: 'notice bad' }, e.message));
      submitBtn.disabled = false;
    }
  });
  function showResult(res) {
    const modeNote = { ai: 'Feedback written by AI against the rubric.', rubric: 'Automatic checklist review. It looks for key points and cannot judge writing like a person.', auto: 'Graded automatically against hidden tests / the answer key.' }[res.mode];
    resultBox.replaceChildren(h('section', { class: 'card' },
      h('div', { class: 'row', style: { marginTop: 0 } }, h('span', { class: 'score ' + (res.passed ? 'pass' : 'fail') }, res.score + '%'), h('div', null, h('b', null, res.passed ? 'Passed: ' + res.level : 'Not yet'), h('div', { class: 'small dim' }, modeNote))),
      h('p', null, res.feedback), rubricView(res.rubric),
      res.evidence ? h('div', { class: 'notice good' }, h('b', null, 'Signed evidence issued and saved to your portfolio. '), h('a', { href: '/verify/' + res.evidence.id }, 'View the verification page')) : null,
      res.note ? h('div', { class: 'notice info' }, res.note) : null,
      !res.passed ? h('div', { class: 'notice info' }, 'You need 60% to earn evidence. Read the notes above, adjust and try again.') : null,
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '/#/tasks' }, 'Next task'), h('a', { class: 'btn alt', href: '/#/' }, 'See my skill map'), h('button', { class: 'alt', type: 'button', onclick: () => { resultBox.replaceChildren(); submitBtn.disabled = false; window.scrollTo(0, 0); } }, 'Try again'))));
    submitBtn.disabled = false; resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  mount('tasks', h('p', null, h('a', { href: '/#/tasks' }, '← All tasks')), h('h1', null, task.title),
    h('div', { class: 'meta' }, h('span', null, 'Difficulty ' + stars(task.difficulty)), h('span', null, 'about ' + task.minutes + ' min'), best != null ? h('span', { class: 'pill ' + Sk.levelName(best) }, 'Your best: ' + best + '%') : null),
    h('div', { class: 'chips' }, skillChips(task.skills)),
    h('div', { class: 'brief' }, h('span', { class: 'from' }, 'From ' + task.from.name + ', ' + task.from.title), task.brief),
    task.generated ? h('div', { class: 'notice info' }, 'This task was written by AI for you and is marked by AI or by its answer key. Evidence earned here is labelled "AI-written task".') : null,
    !navigator.onLine ? h('div', { class: 'notice warn' }, 'You are offline. You can still work: answers are saved here and graded when you reconnect.') : null,
    h('div', { class: 'card' }, workspace, h('div', { class: 'row' }, submitBtn, h('span', { class: 'small dim' }, 'Passing earns signed evidence.'))), resultBox);
}
function runLocal(code, fn, tests) {
  return new Promise(resolve => {
    let w; try { w = new Worker('/runner.js'); } catch (e) { return resolve([{ ok: false, err: 'Test runner is not available offline yet. Reload once while connected.' }]); }
    const timer = setTimeout(() => { w.terminate(); resolve([{ ok: false, err: 'Took too long. Is there an endless loop?' }]); }, 2500);
    w.onmessage = e => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    w.onerror = e => { clearTimeout(timer); w.terminate(); resolve([{ ok: false, err: e.message || 'Error' }]); };
    w.postMessage({ code, fn, tests });
  });
}

/* ----- portfolio ----- */
function pagePortfolio() {
  if (!profile()) return pageOnboard();
  const p = profile(), { r, ev, levels } = computed(), shareBox = h('div');
  const shareUrl = () => state.portfolio && state.portfolio.publicId ? location.origin + '/p/' + state.portfolio.publicId : '';
  const drawShare = () => { const isPublic = !!(state.portfolio && state.portfolio.isPublic); shareBox.replaceChildren(...kids(
    h('p', null, isPublic ? 'Your portfolio is public: anyone with the link sees the name, degree, skill levels and evidence below. Nothing else (no coursework) is published.' : 'Your portfolio is private. Employers can still verify any single evidence link you send them.'),
    isPublic ? h('p', null, h('code', { class: 'id' }, shareUrl())) : null,
    h('div', { class: 'row' }, h('button', { onclick: async () => {
      try { const res = await api('POST', '/api/publish', { public: !isPublic, name: p.name, major: p.major, year: p.year, role: p.role }); state.portfolio = { ...(state.portfolio || {}), ...res }; drawShare(); toast(res.isPublic ? 'Portfolio is now public' : 'Portfolio is private again'); }
      catch (e) { toast(isNetworkError(e) ? 'Sharing needs an internet connection' : e.message); }
    } }, isPublic ? 'Make private' : 'Make public'), isPublic ? h('button', { class: 'alt', onclick: () => copyText(shareUrl(), 'Portfolio link') }, 'Copy link') : null))); };
  drawShare();
  mount('portfolio', h('h1', null, 'Your skill passport'),
    h('div', { class: 'card' }, h('h2', null, p.name), h('p', { class: 'dim' }, [p.major, p.year, r.title].filter(Boolean).join(' · ')), skillMap(levels, null, r.targetLevel, false)),
    h('div', { class: 'card noprint' }, h('h2', null, 'Sharing'), shareBox, h('div', { class: 'row' }, h('button', { class: 'alt', onclick: () => window.print() }, 'Print or save as PDF'),
      h('button', { class: 'alt', onclick: () => { download('skillbridge-portfolio.json', Share.fileJson(ev, { name: p.name, major: p.major, year: p.year })); toast('Portfolio file downloaded'); } }, 'Download portfolio file'))),
    h('h2', null, 'Evidence (' + ev.length + ')'),
    ev.length ? h('div', { class: 'grid two' }, ev.map(e => evidenceCard(e))) : h('div', { class: 'card' }, h('p', null, 'No evidence yet. Pass a practice task and it will appear here, signed and ready to share.'), h('a', { class: 'btn', href: '/#/tasks' }, 'Browse tasks')));
}


/* ----- job match ----- */
function skillRequirementBar(f) {
  return h('div', { class: 'skill' }, h('div', { class: 'skill-head' }, h('b', null, f.name), h('span', { class: 'dim' }, 'Ad asks for ~' + f.requirement + ' · you have proven ' + f.level + (f.met ? ' ✓' : ''))),
    h('div', { class: 'bar', role: 'img', 'aria-label': f.name + ': proven ' + f.level + ' of ' + f.requirement + ' required' }, h('i', { class: f.met ? 'verified' : 'claimed', style: { width: pct(f.level) + '%' } }), h('u', { class: 'target', style: { left: pct(f.requirement) + '%' } })));
}
function pageJobs() {
  if (!profile()) return pageOnboard();
  const { r, list, ev, levels } = computed(), best = db.evidence.bestByTask(), out = h('div', { 'aria-live': 'polite' });
  const ta = h('textarea', { id: 'job-text', 'aria-label': 'Job ad text', placeholder: 'Paste a job ad here: responsibilities, requirements, everything...', style: { minHeight: '180px' } });
  let title = '';
  const run = () => {
    const res = JobMatch.analyse(ta.value, r, levels, list, ev);
    if (res.error) { out.replaceChildren(h('div', { class: 'notice warn' }, res.error)); return; }
    db.cache.set('lastJob', { title: title || 'this role', at: new Date().toISOString(), result: res });
    showResult(res, title || 'this role');
  };
  function showResult(res, name) {
    const deg = Math.round(res.readiness * 3.6);
    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': res.readiness + ' percent ready' }, h('span', null, res.readiness + '%'));
    ring.style.background = 'conic-gradient(var(--accent) ' + deg + 'deg, var(--line) 0)';
    out.replaceChildren(...kids(
      h('section', { class: 'card' },
        h('div', { class: 'row', style: { marginTop: 0, alignItems: 'center' } }, ring, h('div', null, h('h2', { style: { margin: 0 } }, res.readiness >= 80 ? 'You are well prepared for ' + name : res.readiness >= 50 ? 'You are part of the way there for ' + name : 'Here is how to get ready for ' + name),
          h('p', { class: 'dim', style: { margin: '4px 0 0' } }, 'Readiness compares what the ad asks for with what you have proven with signed evidence. It is guidance, not a hiring prediction.'))),
        res.found.length ? null : h('div', { class: 'notice warn' }, 'No skills SkillBridge assesses were found in this ad.')),
      res.found.length ? h('section', { class: 'card' }, h('h2', null, 'What this ad asks for'), res.found.map(skillRequirementBar), h('div', { class: 'legend' }, h('span', { class: 'l-verified' }, 'Requirement met'), h('span', { class: 'l-claimed' }, 'Proven so far'), h('span', { class: 'l-target' }, 'What the ad needs'))) : null,
      res.gaps.length ? h('section', { class: 'card' }, h('h2', null, 'Close the gap: about ' + res.planMinutes + ' minutes of practice'), h('p', { class: 'dim' }, 'These tasks target the skills this ad needs most that you have not yet proven.'), h('div', { class: 'grid two' }, res.plan.map(tk => taskCard(tk, best)))) : null,
      res.strengths.length ? h('section', { class: 'card' }, h('h2', null, 'Your strengths for this role'), h('div', { class: 'chips' }, res.strengths.map(s => h('span', { class: 'chip' }, s.name))), h('p', { class: 'small dim' }, 'Lead with these in your application, and link the evidence.')) : null,
      res.notAssessed.length ? h('section', { class: 'card' }, h('h2', null, 'Also in the ad (not assessed here)'), h('div', { class: 'chips' }, res.notAssessed.map(x => h('span', { class: 'chip', style: { background: 'var(--warn-soft)', color: 'var(--warn)' } }, x))), h('p', { class: 'small dim' }, 'SkillBridge does not test these yet. Build a small project with them and put it on your CV so the gap is not a surprise.')) : null,
      h('div', { class: 'row noprint' }, h('a', { class: 'btn', href: '/#/pack' }, 'Build my application pack'), h('button', { class: 'alt', onclick: () => { ta.value = ''; out.replaceChildren(); title = ''; window.scrollTo(0, 0); } }, 'Analyse another ad'))));
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const last = db.cache.get('lastJob');
  mount('jobs', h('h1', null, 'Are you ready for this job?'),
    h('p', { class: 'dim' }, 'Paste a real job ad. You will see which skills it asks for, how ready you are, and the quickest practice to close the gaps. The ad text stays on this device.'),
    h('div', { class: 'card' }, h('p', { class: 'small dim', style: { margin: '0 0 6px' } }, 'No ad handy? Try an example:'),
      h('div', { class: 'chips' }, JobMatch.SAMPLES.map(s => h('button', { class: 'chip btnish', type: 'button', onclick: () => { ta.value = s.text; title = s.title; run(); } }, s.title))),
      h('label', { for: 'job-text' }, 'Job ad'), ta, h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => { title = (ta.value.split('\n')[0] || '').trim().slice(0, 60); run(); } }, 'Check my readiness'))),
    out, last ? h('p', { class: 'small dim' }, 'Last analysed: ' + last.title + '. ', h('a', { href: '/#/pack' }, 'Open that application pack')) : null);
}
function pagePack() {
  if (!profile()) return pageOnboard();
  const p = profile(), last = db.cache.get('lastJob'), { r } = computed(), ev = db.evidence.list();
  if (!last) return mount('jobs', h('div', { class: 'card' }, h('h2', null, 'Analyse a job ad first'), h('p', null, 'Your application pack is built from the skills a specific job asks for.'), h('a', { class: 'btn', href: '/#/jobs' }, 'Check my readiness')));
  const res = last.result, chosen = JobMatch.pack(res, ev), others = ev.length - chosen.length;
  mount('jobs',
    h('div', { class: 'card' }, h('h1', null, 'Application pack'), h('p', { class: 'dim' }, 'For: ' + last.title), h('h2', null, p.name), h('p', { class: 'dim' }, [p.major, p.year, r.title].filter(Boolean).join(' · ')),
      h('p', null, 'Readiness for this role: ', h('b', null, res.readiness + '%'), '. Skills this role asks for that are already proven: ', h('b', null, res.strengths.map(s => s.name).join(', ') || 'none yet'), '.'),
      res.gaps.length ? h('p', { class: 'small dim' }, 'Still building: ' + res.gaps.map(g => g.name).join(', ') + '.') : null,
      h('div', { class: 'row noprint' }, h('button', { onclick: () => window.print() }, 'Print or save as PDF'),
        h('button', { class: 'alt', onclick: () => { download('skillbridge-application-pack.json', Share.fileJson(chosen, { name: p.name, major: p.major, year: p.year, appliedFor: last.title })); toast('Pack file downloaded. Employers can check it offline at /verify.'); } }, 'Download verifiable file'))),
    h('h2', null, 'Evidence relevant to this job (' + chosen.length + ')'),
    chosen.length ? h('div', { class: 'grid two' }, chosen.map(e => evidenceCard(e))) : h('div', { class: 'card' }, h('p', null, 'You have no evidence yet for the skills this job asks for.'), h('a', { class: 'btn', href: '/#/jobs' }, 'See your practice plan')),
    others > 0 ? h('p', { class: 'small dim noprint' }, others + ' other piece' + (others === 1 ? '' : 's') + ' of evidence left out because they are not relevant to this ad.') : null);
}


/* ----- university cohort dashboard (anonymous, aggregate-only) ----- */
async function pageCohort(code) {
  mount('cohort', loading('Loading class dashboard...'));
  try {
    const d = await api('GET', '/api/cohort/' + encodeURIComponent(code));
    if (d.locked) return mount('cohort', h('div', { class: 'card' }, h('h1', null, 'Class ' + d.code), h('div', { class: 'notice info' }, d.size + ' of ' + d.need + ' students have joined.'),
      h('p', null, 'To protect every student\'s privacy, this dashboard stays empty until at least ' + d.need + ' students have joined. Only class-wide averages are ever shown: never names, never individual scores.'),
      h('p', { class: 'small dim' }, 'Students join from their Profile page by entering this class code.')));
    const gapSet = new Set(d.gaps), url = location.origin + '/#/cohort/' + d.code;
    mount('cohort',
      h('h1', null, 'Class skills dashboard'), h('p', { class: 'dim' }, 'Class ' + d.code + ' · ' + d.roleTitle + ' track · updated ' + fmtDate(d.generatedAt)),
      h('div', { class: 'grid three' }, h('div', { class: 'card stat' }, h('b', null, d.size), 'students in the class'), h('div', { class: 'card stat' }, h('b', null, d.active), 'have earned evidence'), h('div', { class: 'card stat' }, h('b', null, d.avgEvidence), 'average pieces of evidence')),
      h('section', { class: 'card' }, h('h2', null, 'Where the class is strong and where it needs support'),
        h('p', { class: 'dim' }, 'Class average of verified skill level (not self-reported). The tick marks the level employers expect (' + d.targetLevel + ').'),
        d.skills.map(s => h('div', { class: 'skill' }, h('div', { class: 'skill-head' }, h('b', null, s.name, gapSet.has(s.id) ? h('span', { class: 'pill Developing', style: { marginLeft: '8px' } }, 'Biggest gap') : null), h('span', { class: 'dim' }, 'Average ' + s.mean + ' · ' + s.atTargetPct + '% at employer level · ' + s.startedPct + '% have started')),
          h('div', { class: 'bar', role: 'img', 'aria-label': s.name + ': class average ' + s.mean }, h('i', { class: 'verified', style: { width: pct(s.mean) + '%' } }), h('u', { class: 'target', style: { left: pct(d.targetLevel) + '%' } })))),
        h('div', { class: 'legend' }, h('span', { class: 'l-verified' }, 'Class average (verified)'), h('span', { class: 'l-target' }, 'Employer level'))),
      h('section', { class: 'card' }, h('h2', null, 'Suggested focus for the next term'), h('p', { class: 'dim' }, 'The three weakest skills are ' + d.gaps.map(id => (d.skills.find(s => s.id === id) || {}).name).join(', ') + '. These ready-made workplace exercises target them and could be set as coursework:'),
        h('ul', null, d.suggested.map(x => h('li', null, h('a', { href: '/#/task/' + x.id }, x.title))))),
      h('section', { class: 'card' }, h('h2', null, 'How privacy is protected'),
        h('ul', { class: 'small' }, h('li', null, 'Joining is voluntary and uses a class code the university shares. Students can leave any time.'), h('li', null, 'Nothing appears until at least ' + d.min + ' students have joined, so no one can be singled out.'), h('li', null, 'Only class-wide aggregates are shown, with percentages rounded to the nearest 5. No names, no identifiers, no individual scores.')),
        h('div', { class: 'row noprint' }, h('button', { class: 'alt', onclick: () => copyText(url, 'Dashboard link') }, 'Copy dashboard link'), h('button', { class: 'alt', onclick: () => window.print() }, 'Print or save as PDF'))));
  } catch (e) { mount('cohort', h('div', { class: 'card' }, h('h2', null, 'Class not found'), h('p', null, isNetworkError(e) ? 'You appear to be offline.' : e.message), h('p', { class: 'small dim' }, 'Check the class code, or ask your university for it.'))); }
}

/* ----- one-click demo ----- */
async function startDemo() {
  if (profile() && db.evidence.list().length && !db.cache.get('demo') && !window.confirm('The demo replaces the profile and evidence stored in this browser. Download a backup first if you want to keep it. Continue?')) return;
  try {
    const res = await api('POST', '/api/demo');
    db.profile.set({ name: res.studentName, major: 'Computer Science', year: '2026', role: 'software-engineer', coursework: 'Data Structures and Algorithms\nSoftware Engineering group project\nGit and GitHub workshop\nUniversity hackathon team\nWeb Security elective' });
    db.evidence.replaceAll(res.evidence); db.cache.set('demo', { cohort: res.cohort, at: new Date().toISOString() });
    toast('Demo loaded: a student with real, signed evidence'); location.href = '/#/'; route();
  } catch (e) { toast(isNetworkError(e) ? 'The demo needs a connection to the server.' : e.message); }
}
function demoBanner() {
  const d = db.cache.get('demo'); if (!d) return null;
  return h('div', { class: 'card', style: { borderColor: 'var(--accent)' } }, h('h3', { style: { marginTop: 0 } }, 'You are viewing a demo student'),
    h('p', { class: 'small dim' }, 'Everything here is real: the tasks were graded and the evidence is cryptographically signed. Take the 60-second tour:'),
    h('div', { class: 'row', style: { marginTop: 0 } }, h('a', { class: 'btn alt', href: '/#/jobs' }, '1. Check a job ad'), h('a', { class: 'btn alt', href: '/#/portfolio' }, '2. Share the portfolio'),
      h('a', { class: 'btn alt', href: '/verify' }, '3. Verify as an employer'), h('a', { class: 'btn alt', href: '/#/cohort/' + d.cohort }, '4. Class dashboard'),
      h('button', { class: 'danger', onclick: () => { if (window.confirm('Exit the demo and erase the demo data from this browser?')) { api('DELETE', '/api/mine').catch(() => {}); db.wipe(); state.portfolio = null; location.href = '/#/'; route(); } } }, 'Exit demo')));
}


function cohortCard() {
  const box = h('div'), input = h('input', { type: 'text', id: 'cohort-code', placeholder: 'e.g. UNI-CS-2026', maxlength: 32, 'aria-label': 'Class code', style: { maxWidth: '260px' } });
  const draw = (c) => box.replaceChildren(...kids(
    c && c.code ? h('p', null, 'You are in class ', h('b', null, c.code), ' (' + plural(c.size, 'student') + '). Your university only ever sees class averages.') : h('p', { class: 'dim' }, 'Not in a class. Joining is optional.'),
    h('div', { class: 'row' }, input, h('button', { onclick: async () => { try { const r = await api('POST', '/api/cohort/join', { code: input.value }); draw(r); toast('Joined class ' + r.code); } catch (e) { toast(isNetworkError(e) ? 'Joining needs a connection.' : e.message); } } }, 'Join'),
      c && c.code ? h('button', { class: 'alt', onclick: async () => { try { await api('POST', '/api/cohort/leave'); draw(null); toast('You left the class'); } catch (e) { toast(e.message); } } }, 'Leave') : null,
      c && c.code ? h('a', { class: 'btn alt', href: '/#/cohort/' + c.code }, 'View class dashboard') : null)));
  api('GET', '/api/cohort/mine').then(draw).catch(() => draw(null));
  return h('div', { class: 'card' }, h('h2', null, 'University class (optional)'), h('p', { class: 'small dim' }, 'If your university gave you a class code, join to help them see where the whole class needs more support. Only anonymous class averages are shared, and only once at least 5 students have joined.'), box);
}

/* ----- profile + backup ----- */
function pageProfile() {
  if (!profile()) return pageOnboard();
  const p = profile(), lastBackup = db.meta.get().lastBackup;
  const form = h('form', { class: 'card', onsubmit: ev => { ev.preventDefault(); const d = Object.fromEntries(new FormData(form).entries()); db.profile.set({ name: (d.name || 'Student').trim().slice(0, 80), major: d.major.trim().slice(0, 100), year: d.year.trim().slice(0, 10), coursework: d.coursework.slice(0, 4000) }); toast('Saved on this device'); topbar('profile'); } },
    h('h2', null, 'Your details'), h('p', { class: 'small dim' }, 'Saved only in this browser.'),
    h('label', { for: 'p-name' }, 'Name'), h('input', { id: 'p-name', name: 'name', type: 'text', value: p.name, maxlength: 80 }),
    h('div', { class: 'grid two' }, h('div', null, h('label', { for: 'p-major' }, 'Degree or major'), h('input', { id: 'p-major', name: 'major', type: 'text', value: p.major || '', maxlength: 100 })), h('div', null, h('label', { for: 'p-year' }, 'Graduation year'), h('input', { id: 'p-year', name: 'year', type: 'text', value: p.year || '', maxlength: 10 }))),
    h('label', { for: 'p-course' }, 'What you have studied and built'), h('textarea', { id: 'p-course', name: 'coursework', maxlength: 4000 }, p.coursework || ''),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Save changes')));

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'noprint', 'aria-label': 'Choose a backup file' });
  const restore = async () => { if (await restoreFromFile(fileInput.files[0])) route(); };
  mount('profile', h('h1', null, 'Profile'), storageWarning(), form,
    h('div', { class: 'card' }, h('h2', null, 'Backup and restore'),
      h('p', { class: 'dim' }, 'Your data lives in this browser. A backup file holds your profile, evidence and private key, so you can move to a new device or recover after clearing your browser. ' + (lastBackup ? 'Last backup: ' + fmtDate(lastBackup) + '.' : 'You have not made a backup yet.')),
      h('div', { class: 'row' }, h('button', { onclick: () => { download('skillbridge-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(db.export(), null, 2)); db.meta.markBackup(); toast('Backup downloaded. Keep it somewhere safe.'); } }, 'Download backup')),
      h('div', { class: 'row' }, fileInput, h('button', { class: 'alt', onclick: restore }, 'Restore from backup')),
      h('p', { class: 'small dim' }, 'Keep backups private: they include the key that links you to your shared evidence. Restoring checks every signature, so edited records are rejected.')),
    cohortCard(),
    h('div', { class: 'card' }, h('h2', null, 'Where your data lives'),
      h('ul', { class: 'small' }, h('li', null, h('b', null, 'This browser (localStorage): '), 'profile, coursework, drafts, offline queue and your copy of your evidence. About ' + (db.usageBytes() / 1024).toFixed(1) + ' KB.'),
        h('li', null, h('b', null, 'The server: '), 'only your signed evidence and, if you made it public, your portfolio. They are tied to a random key, never to an email or account.')),
      h('div', { class: 'row' }, h('button', { class: 'danger', onclick: async () => {
        if (!window.confirm('Erase everything on this device and delete your evidence and portfolio on the server? This cannot be undone.')) return;
        try { if (navigator.onLine) await api('DELETE', '/api/mine'); } catch (e) { if (!window.confirm('The server could not be reached, so your shared evidence would remain there. Erase this device anyway?')) return; }
        db.wipe(); state.portfolio = null; toast('Everything was erased'); location.href = '/#/'; route();
      } }, 'Erase my data'))));
}

/* ----- employer-facing pages (no account needed) ----- */
const SCORE_NOTE = { ai: 'Assessed by AI against a published rubric.', rubric: 'Assessed by automatic checklist against a published rubric.', auto: 'Graded automatically (answer key or hidden tests).' };
function recordCard(e, valid) {
  return h('div', { class: 'card' }, h('h2', null, e.taskTitle), h('p', null, h('b', null, e.studentName), ' · ', e.role === 'software-engineer' ? 'Junior Software Engineer track' : e.role),
    h('div', { class: 'row', style: { marginTop: 0 } }, h('span', { class: 'score ' + (valid ? 'pass' : 'fail') }, e.score + '%'), h('span', { class: 'pill ' + e.level }, e.level), h('span', { class: 'dim' }, 'Issued ' + fmtDate(e.issuedAt))),
    h('p', { class: 'small dim' }, (SCORE_NOTE[e.graderMode] || '') + (e.aiGeneratedTask ? ' The task itself was written by AI and checked automatically before it was offered.' : '')), h('div', { class: 'chips' }, skillChips(e.skills)), rubricView(e.rubric), e.feedback ? h('p', { class: 'small dim' }, e.feedback) : null,
    h('details', null, h('summary', null, 'Technical details'), h('p', { class: 'small' }, 'Evidence ID: ', h('code', { class: 'id' }, e.id)), h('p', { class: 'small' }, 'Submission SHA-256: ', h('code', { class: 'id' }, e.submissionHash)), h('p', { class: 'small' }, 'Signature (HMAC-SHA256): ', h('code', { class: 'id' }, e.signature))));
}
function pageVerify(id) {
  const out = h('div'), input = h('input', { type: 'text', id: 'vid', placeholder: 'ev_... or a verification link', value: id || '', 'aria-label': 'Evidence ID or link' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a portfolio file' });
  /* Two independent checks: (1) the signature, verified in THIS browser with the issuer's public key (works offline), and
     (2) the issuer's registry, asked over the network. Either one alone is meaningful; together they are strongest. */
  const localCheck = records => Promise.all(records.map(r => Verifier.verify(r, state.keys).catch(() => null)));
  const badge = (label, ok) => h('span', { class: 'pill ' + (ok === true ? 'Strong' : ok === false ? '' : 'Developing'), style: ok === false ? { background: 'var(--bad-soft)', color: 'var(--bad)' } : {} }, label + ': ' + (ok === true ? 'valid' : ok === false ? 'INVALID' : 'not checked'));
  const runId = async raw => {
    const m = /(ev_[0-9a-f]+)/i.exec(raw || input.value); if (!m) { toast('Paste an evidence link or ID that starts with ev_'); return; }
    out.replaceChildren(loading('Checking the signature...'));
    try {
      const res = await api('GET', '/api/verify/' + encodeURIComponent(m[1])), e = res.evidence, [local] = await localCheck([e]);
      const ok = res.valid && local !== false;
      out.replaceChildren(h('div', { class: 'valid-box ' + (ok ? 'ok' : 'bad') }, h('b', null, ok ? 'Authentic and unaltered' : 'FAILED: this record does not match its signature'), ok ? 'Issued by SkillBridge. The details below are exactly what was graded.' : 'Do not rely on this record.'),
        h('div', { class: 'chips' }, badge('Checked in your browser (public key)', local), badge('Issuer registry', res.valid)),
        recordCard(e, ok), res.portfolioUrl ? h('p', null, h('a', { href: res.portfolioUrl }, 'See the full public portfolio')) : null,
        h('p', { class: 'small dim' }, 'The browser check uses the issuer\'s published public key (' + e.keyId + '), so it needs no secret and can run offline. It confirms the record was graded and issued by this system and has not been changed. It does not prove who did the work or that it was done unaided.'));
    } catch (err) {
      out.replaceChildren(h('div', { class: 'valid-box bad' }, h('b', null, isNetworkError(err) ? 'No connection' : 'Not found'), isNetworkError(err) ? 'Looking up an ID needs a connection. A portfolio file can be checked offline below.' : err.message));
    }
  };
  const runFile = async () => {
    const f = fileInput.files[0]; if (!f) { toast('Choose a portfolio or backup file'); return; }
    out.replaceChildren(loading('Checking every signature...'));
    try {
      const records = (await Share.decode(await f.text())).slice(0, 60), local = await localCheck(records);
      let server = null;
      if (navigator.onLine) { try { const res = await api('POST', '/api/verify', { records }), okIds = new Set(res.results.filter(r => r.valid).map(r => r.id)); server = records.map(r => okIds.has(r.id)); } catch (e) { /* offline: the browser check still works */ } }
      const verdict = records.map((r, i) => local[i] === false ? false : server && server[i] === false ? false : local[i] === true || (server && server[i] === true));
      if (local.every(x => x === null) && !server) { out.replaceChildren(h('div', { class: 'valid-box bad' }, h('b', null, 'Cannot check this file right now'), 'This browser cannot verify signatures offline. Connect to the internet and try again.')); return; }
      const good = verdict.filter(Boolean).length;
      out.replaceChildren(h('div', { class: 'valid-box ' + (good === records.length ? 'ok' : 'bad') }, h('b', null, good + ' of ' + records.length + ' records authentic'), good === records.length ? 'Every record in this file is genuine and unaltered.' : 'Some records failed the signature check. Ignore those.'),
        h('p', { class: 'small dim' }, (local.some(x => x !== null) ? 'Signatures checked in your browser with the issuer\'s public key' + (server ? ' and confirmed with the issuer\'s server.' : (navigator.onLine ? '.' : ' (you are offline, so this is fully local).')) : 'Checked by the issuer\'s server.')),
        ...records.map((r, i) => h('div', null, h('div', { class: 'notice ' + (verdict[i] ? 'good' : 'bad') }, verdict[i] ? 'Authentic' : 'FAILED signature'), recordCard(r, verdict[i]))));
    } catch (e) { out.replaceChildren(h('div', { class: 'valid-box bad' }, h('b', null, 'Could not check this file'), e.message)); }
  };
  mount('verify', h('h1', null, 'Verify a SkillBridge credential'), h('p', { class: 'dim' }, 'For employers and universities. No account needed.'),
    h('form', { class: 'card', onsubmit: ev => { ev.preventDefault(); runId(); } }, h('label', { for: 'vid' }, 'Evidence link or ID'), input, h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Verify'))),
    h('div', { class: 'card' }, h('h3', null, 'Or check a portfolio file'), h('p', { class: 'small dim' }, 'A candidate can send you the file from their Portfolio page. Every signature in it is checked.'), h('div', { class: 'row' }, fileInput, h('button', { class: 'alt', onclick: runFile }, 'Check file'))), out);
  if (id) runId(id);
}
async function pagePublic(pid) {
  mount('portfolio', loading('Loading portfolio...'));
  try {
    const pf = await api('GET', '/api/portfolio/' + encodeURIComponent(pid));
    mount('portfolio',
      h('div', { class: 'card' }, h('h1', null, pf.student.name), h('p', { class: 'dim' }, [pf.student.major, pf.student.year, pf.student.roleTitle].filter(Boolean).join(' · ')),
        h('p', { class: 'small dim' }, 'Verified skills only. Each item links to an independently checkable credential.'),
        pf.skills.map(s => { const v = pf.levels[s.id] || { level: 0, tasksDone: 0 };
          return h('div', { class: 'skill' }, h('div', { class: 'skill-head' }, h('b', null, s.name), h('span', { class: 'dim' }, v.level + ' · ' + plural(v.tasksDone, 'task'))), h('div', { class: 'bar' }, h('i', { class: 'verified', style: { width: pct(v.level) + '%' } }), h('u', { class: 'target', style: { left: pct(pf.targetLevel) + '%' } }))); }),
        h('div', { class: 'row noprint' }, h('button', { class: 'alt', onclick: () => window.print() }, 'Print or save as PDF'))),
      h('h2', null, 'Evidence (' + pf.evidence.length + ')'), h('div', { class: 'grid two' }, pf.evidence.map(e => evidenceCard(e, { copy: false }))));
  } catch (e) { mount('portfolio', h('div', { class: 'card' }, h('h2', null, 'Portfolio not available'), h('p', null, isNetworkError(e) ? 'You appear to be offline.' : e.message))); }
}

/* ---------------------------------------------------------------- loading + routing */
async function loadStatic() {
  const tryGet = async (url, key, set) => { try { const v = await api('GET', url); set(v); db.cache.set(key, v); } catch (e) { /* offline: keep the cached copy */ } };
  await Promise.all([tryGet('/api/roles', 'roles', v => { state.roles = v; }), tryGet('/api/tasks', 'tasks', v => { state.tasks = v; }), tryGet('/api/health', 'health', v => { state.health = v; }), tryGet('/api/keys', 'keys', v => { state.keys = v; })]);
  mergeGenerated();
}
function route() {
  let m;
  if ((m = /^\/verify\/([\w-]+)$/.exec(location.pathname))) return pageVerify(m[1]);
  if (location.pathname === '/verify') return pageVerify('');
  if ((m = /^\/p\/([\w-]+)$/.exec(location.pathname))) return pagePublic(m[1]);
  const hash = location.hash || '#/';
  if (hash === '#/verify') return pageVerify('');
  if ((m = /^#\/cohort\/([\w-]+)$/.exec(hash))) return pageCohort(m[1]);
  if (hash === '#/demo') { startDemo(); return; }
  if (hash === '#/tasks') return pageTasks();
  if ((m = /^#\/task\/([\w-]+)$/.exec(hash))) return pageTask(m[1]);
  if (!profile()) return pageOnboard();
  if (hash === '#/jobs') return pageJobs();
  if (hash === '#/pack') return pagePack();
  if (hash === '#/portfolio') return pagePortfolio();
  if (hash === '#/profile') return pageProfile();
  return pageDashboard();
}
addEventListener('hashchange', route);
addEventListener('online', () => { toast('Back online'); topbar(); flushQueue(); syncFromServer(); });
addEventListener('offline', () => { toast('You are offline. Your work is saved on this device.'); route(); });

(async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works without it */ });
  mount('home', loading());
  await loadStatic();
  route();
  syncFromServer().then(() => { if (profile() && !/^\/(verify|p)/.test(location.pathname)) route(); });
  flushQueue();
})();
})();
