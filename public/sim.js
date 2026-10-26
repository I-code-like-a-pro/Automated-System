/* SkillBridge Simulations: a virtual workday for any job. Pick a job, enrol for 1 to 3 days, clock in at your shift time, chat with
   a manager and teammates, make judgement calls, hand in real work for review, answer an afternoon check-in, clock out, and earn a
   signed certificate with a skill breakdown. The browser only plays the script: the server holds every score and answer key.
   All text is inserted with textContent (never innerHTML). app.js hands this file its helpers through Sim.init(ctx). */
(function () {
'use strict';
let ctx = null, activeToken = null;
const CANCEL = { cancelled: true };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const init = c => { ctx = c; };
const COLORS = ['#0B1E4D', '#5B2BC4', '#0B6E5B', '#B4326E', '#A65A00', '#0056D2'];
const DAY_PLAN = [['9:00 AM', 'Clock in', 'Your arrival is logged as early, on time or late.'], ['9:30 AM', 'Team chat', 'Messages from your manager and teammates arrive.'], ['10:00 AM', 'Main task', 'Do the work, then paste it or attach a screenshot or PDF for review.'],
  ['11:30 AM', 'Urgent decision', 'Two things need you at once. Pick one and say why.'], ['2:30 PM', 'Afternoon check-in', 'A short question tests your thinking.'], ['5:00 PM', 'Clock out', 'Your day report counts toward your certificate.']];
const SUGGESTIONS = ['Data analyst', 'Marketing associate', 'Customer support agent', 'Accountant', 'UI/UX designer', 'Nurse', 'Primary school teacher', 'Electrician apprentice'];
const SHIFT_LENGTHS = [[1, '1 day', 'About 12 minutes'], [2, '2 days', 'About 25 minutes in total'], [3, '3 days', 'About 40 minutes in total']];

/* ---------------------------------------------------------------- helpers */
const colorOf = s => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = s => String(s).split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtMin = m => { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0'); return ((h + 11) % 12 + 1) + ':' + mm + ' ' + (h >= 12 ? 'PM' : 'AM'); };
const learnerName = () => { const p = ctx.db.profile.get(); return (p && p.name) || ctx.db.cache.get('learnerName', '') || ''; };
const errText = e => (ctx.isNetworkError(e) ? 'Could not reach the server. Check your connection and try again.' : e.message);
const wrap = (...kids) => ctx.h('div', { class: 'sim' }, ...kids);
const orgTile = (name, big) => ctx.h('div', { class: 'org', style: { background: colorOf(name), width: big ? '44px' : '28px', height: big ? '44px' : '28px', fontSize: big ? '15px' : '11px' } }, initials(name));
const chip = (text, cls) => ctx.h('span', { class: 'chip' + (cls ? ' ' + cls : '') }, text);

/* start something the AI writes: the server answers at once (200 if ready, 202 with a job) and we check back every 2 seconds, so no
   connection is held open for a minute. A brief network hiccup while waiting does not lose the work. */
async function runJob(method, url, body, onTick) {
  const start = await ctx.api(method, url, body);
  if (!start.job) return start;
  const t0 = Date.now(); let misses = 0;
  for (;;) {
    await sleep(2000);
    let j;
    try { j = await ctx.api('GET', '/api/jobs/' + start.job); misses = 0; } catch (e) { if (!ctx.isNetworkError(e) || ++misses > 8) throw e; if (onTick) onTick(Date.now() - t0, true); continue; }
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw Object.assign(new Error(j.error), { status: 502 });
    if (Date.now() - t0 > 240000) throw Object.assign(new Error('This is taking too long. Please try again.'), { status: 504 });
    if (onTick) onTick(Date.now() - t0, false);
  }
}
function statusBox() {
  const box = ctx.h('div', { 'aria-live': 'polite' });
  return { el: box, show: t => box.replaceChildren(ctx.h('p', { class: 'small muted' }, t)), fail: t => box.replaceChildren(ctx.h('div', { class: 'notice bad' }, t)), clear: () => box.replaceChildren(),
    tick: label => (ms, slow) => box.replaceChildren(ctx.h('p', { class: 'small muted' }, (slow ? 'Connection is slow, still trying... ' : label + ' ') + Math.round(ms / 1000) + 's (usually under a minute)')) };
}
const crumbs = (...parts) => ctx.h('div', { class: 'crumbs' }, parts.flatMap((p, i) => (i ? [' › ', p] : [p])));
const rail = () => ctx.h('div', { class: 'rail' }, DAY_PLAN.map(p => ctx.h('div', { class: 'step' }, ctx.h('div', { class: 'tm' }, p[0]), ctx.h('div', { class: 'tx' }, ctx.h('b', null, p[1]), ctx.h('span', { class: 'small muted' }, p[2])))));
const link = (href, ...kids) => ctx.h('a', { href, class: 'btn out' }, ...kids);

/* ---------------------------------------------------------------- home */
function simCard(s) {
  const { h } = ctx;
  return h('a', { class: 'course', href: '/#/sim/' + s.id }, orgTile(s.company.name, true),
    h('div', null, h('div', { class: 'o' }, s.company.name + (s.sample ? ' · hand-written sample' : '')), h('div', { class: 'n' }, s.title), h('div', { class: 'm' }, 'Career simulation · 1 to 3 workdays · Certificate')));
}
async function pageHome() {
  const { h } = ctx, grid = h('div', { class: 'cards' }), mine = h('div'), create = statusBox();
  const input = h('input', { type: 'text', id: 'job', maxlength: '80', placeholder: 'e.g. Nurse, Accountant, Electrician apprentice', 'aria-label': 'Job to try' });
  const btn = h('button', { class: 'btn pri', type: 'submit' }, 'Create my simulation');
  let aiOn = ctx.state.health.ai;
  const make = async ev => {
    ev.preventDefault();
    if (input.value.trim().length < 3) { create.fail('Type the job you want to try first.'); return; }
    if (!navigator.onLine) { create.fail('Creating a simulation needs a connection.'); return; }
    btn.disabled = true; create.show('Building your company, team and first day... (usually under a minute)');
    try { const r = await runJob('POST', '/api/sims', { job: input.value.trim() }, create.tick('Building your company and team...')); location.href = '/#/sim/' + r.sim.id; }
    catch (e) { create.fail(errText(e)); btn.disabled = false; }
  };
  ctx.mount('home', wrap(
    h('section', { class: 'hero' }, h('div', null, h('h1', null, 'Get work experience before your first job'), h('p', null, 'Clock in, handle real tasks, make tough calls and clock out. Earn a certificate that shows what you can actually do.'),
        h('button', { class: 'btn white', type: 'button', onclick: () => document.getElementById('sims').scrollIntoView({ behavior: 'smooth' }) }, 'Explore simulations')),
      h('div', { class: 'widget', 'aria-hidden': 'true' }, h('div', { class: 'xs', style: { color: '#c9d6ff' } }, 'Monday · Your new workplace'), h('div', { class: 't' }, '8:52 AM'),
        h('div', { class: 'l' }, h('span', { class: 'dot' }), 'Clocked in · 8 minutes early'), h('div', { class: 'l' }, h('span', { class: 'dot b' }), '9:30 Team chat with your manager'), h('div', { class: 'l' }, h('span', { class: 'dot a' }), '11:30 Decision needed'))),
    mine,
    h('section', { class: 'sect', id: 'sims' }, h('div', { class: 'panel' }, h('div', { class: 'head' }, h('h2', null, 'Start a simulation'), h('span', { class: 'small muted', id: 'simcount' }, '')), grid)),
    h('section', { class: 'sect' }, h('div', { class: 'card' }, h('h2', { style: { fontSize: '20px' } }, 'Try any job'),
      h('p', { class: 'small muted', style: { margin: '4px 0 12px' } }, 'Type a job and the AI invents a company, a manager and a team, then writes your workdays with the real tasks and tools of that job.'),
      aiOn ? null : h('div', { class: 'notice warn' }, 'Creating new simulations needs the AI, which is not set up on this server. The samples below still work.'),
      h('form', { onsubmit: make }, h('div', { class: 'field', style: { marginTop: '0' } }, input), h('div', { class: 'chips', style: { marginTop: '12px' } }, SUGGESTIONS.map(s => h('button', { type: 'button', class: 'pill', onclick: () => { input.value = s; input.focus(); } }, s))), h('div', { style: { marginTop: '14px' } }, btn)), create.el)),
    h('section', { class: 'sect' }, h('h2', null, 'A workday in 10 to 15 minutes'), h('div', { style: { height: '12px' } }), rail())));
  const draw = sims => { grid.replaceChildren(...(sims.length ? sims.map(simCard) : [h('p', { class: 'muted' }, 'No simulations yet. Create the first one below.')])); const c = document.getElementById('simcount'); if (c) c.textContent = sims.length + ' available'; };
  try { const r = await ctx.api('GET', '/api/sims'); ctx.db.cache.set('simList', r.sims); draw(r.sims); } catch (e) { draw(ctx.db.cache.get('simList', [])); }
  try {   // my simulations in progress
    const r = await ctx.api('GET', '/api/runs');
    if (r.runs.length) mine.replaceChildren(h('section', { class: 'sect' }, h('h2', null, 'My simulations'), h('div', { style: { height: '12px' } }), h('div', { class: 'cards' }, r.runs.map(run => {
      const done = run.days.filter(d => d.completed).length, nextDay = Math.min(done + 1, run.daysTotal);
      return h('div', { class: 'card' }, h('div', { class: 'runrow' }, h('div', null, h('div', { class: 'small muted' }, run.company), h('b', null, run.title), h('div', { class: 'small muted' }, run.certificateId ? 'Certificate earned' : run.completed ? 'All days done' : 'Day ' + nextDay + ' of ' + run.daysTotal + ' · ' + done + ' completed')),
        run.certificateId ? h('a', { class: 'btn out sm', href: '/#/certificate/' + run.certificateId }, 'View certificate') : h('a', { class: 'btn pri sm', href: '/#/run/' + run.id }, run.completed ? 'Get certificate' : done || run.days[0].clockedIn ? 'Continue' : 'Start')));
    }))));
  } catch (e) { /* offline or not started: no list */ }
}

/* ---------------------------------------------------------------- one job */
async function pageDetail(id) {
  const { h } = ctx; ctx.mount('home', ctx.loading('Opening the simulation...'));
  let s; try { s = (await ctx.api('GET', '/api/sims/' + id)).sim; } catch (e) { return ctx.mount('home', wrap(h('div', { class: 'card' }, h('h2', null, 'Simulation not found'), h('p', null, errText(e)), h('a', { href: '/#/' }, 'Back to simulations')))); }
  let days = 1; const name = h('input', { id: 'nm', maxlength: '80', placeholder: 'e.g. Ada Okafor', autocomplete: 'name', value: learnerName() }), status = statusBox();
  const radios = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Simulation length', style: { display: 'grid', gap: '10px' } });
  const drawRadios = () => radios.replaceChildren(...SHIFT_LENGTHS.map(l => h('button', { class: 'opt', type: 'button', role: 'radio', 'aria-checked': String(days === l[0]), onclick: () => { days = l[0]; drawRadios(); } }, h('span', { class: 'radio' }), h('div', null, h('b', null, l[1]), h('span', null, l[2])))));
  drawRadios();
  const enroll = async () => {
    if (name.value.trim().length < 2) { status.fail('Enter the name to print on your certificate.'); return; }
    status.show('Enrolling...');
    try { const r = await ctx.api('POST', '/api/sims/' + s.id + '/runs', { days, name: name.value.trim() }); ctx.db.cache.set('learnerName', name.value.trim()); location.href = '/#/run/' + r.run.id; }
    catch (e) { status.fail(errText(e)); }
  };
  const mgr = s.people[0];
  ctx.mount('home', wrap(
    h('section', { class: 'wash', style: { margin: '-20px -16px 0', padding: '16px 16px 24px' } }, h('div', { class: 'wrap', style: { padding: '0' } }, crumbs(h('a', { href: '/#/' }, 'Home'), 'Simulations', s.title), h('h1', null, s.title + ' Simulation'), h('p', { class: 'muted', style: { marginTop: '8px' } }, s.blurb),
      h('p', { class: 'small', style: { marginTop: '12px' } }, 'at ', h('b', null, s.company.name), ' · ', s.company.about),
      h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } }, orgTile(s.company.name), h('span', { class: 'small' }, 'Manager: ', h('b', null, mgr.name), ' (AI)'), chip(s.sample ? 'Hand-written sample' : 'AI-built', 'blue')))),
    h('div', { class: 'wrap', style: { padding: '0' } },
      h('div', { class: 'facts' }, [['Real workdays', 'Chat, decide, deliver and clock out'], ['Beginner level', 'No prior experience required'], ['Flexible schedule', '10 to 15 minutes per workday, at your own pace'], ['Shareable certificate', 'Signed, with a link anyone can verify']].map(f => h('div', { class: 'fact' }, h('b', null, f[0]), h('span', null, f[1])))),
      s.disclaimer ? h('div', { class: 'notice warn', style: { marginTop: '16px' } }, s.disclaimer) : null,
      h('section', { class: 'sect' }, h('div', { class: 'card' }, h('h2', { style: { fontSize: '20px' } }, 'Set up your simulation'), h('p', { class: 'small muted', style: { margin: '4px 0 14px' } }, 'Choose how long you want to work.'), radios,
        h('div', { class: 'field' }, h('label', { for: 'nm' }, 'Name on your certificate'), name), h('button', { class: 'btn pri block', type: 'button', style: { marginTop: '18px' }, onclick: enroll }, 'Enroll for free'), status.el,
        h('p', { class: 'xs muted', style: { marginTop: '8px', textAlign: 'center' } }, 'You pick your shift start time on each day. Clock-in uses your device clock.'))),
      h('section', { class: 'sect' }, h('h2', null, 'What you\'ll learn'), h('div', { style: { height: '12px' } }), h('ul', { class: 'checks' }, s.learn.map(x => h('li', null, ctx.icon(['M5 12.5l4.5 4.5L19 7.5'], 20), h('span', null, x))))),
      h('section', { class: 'sect' }, h('h2', null, 'Skills you\'ll gain'), h('div', { style: { height: '12px' } }), h('div', { class: 'chips' }, s.skills.map(x => chip(x)))),
      h('section', { class: 'sect' }, h('h2', null, 'Your team'), h('div', { style: { height: '12px' } }), h('div', { class: 'card' }, s.people.map(p => h('div', { class: 'msg', style: { padding: '6px 0' } }, h('div', { class: 'av', style: { background: p.color } }, p.ini), h('div', { class: 'mb' }, h('div', { class: 'mh' }, h('b', null, p.name)), h('div', { class: 'small muted' }, p.role + (p.key === 'mgr' ? ' · your manager' : ''))))))),
      h('section', { class: 'sect' }, h('h2', null, 'How each day runs'), h('div', { style: { height: '12px' } }), rail()),
      h('section', { class: 'sect' }, h('h2', null, 'Details to know'), h('div', { style: { height: '12px' } }), h('div', { class: 'kv card' },
        [['Assessments', s.sample ? 'Reviewed by AI, or a checklist when AI is off' : 'Reviewed by AI'], ['Check-ins', 'Clock in and out logged'], ['Company', 'Fictional: no real firm or person'], ['Certificate', 'Verified link, signed']].map(r => h('div', null, h('span', { class: 'k' }, r[0]), h('span', { class: 'v' }, r[1]))))),
      s.sources && s.sources.length ? h('section', { class: 'sect' }, h('h2', { style: { fontSize: '18px' } }, 'Research behind this job'), h('ul', { class: 'small', style: { margin: '8px 0 0 18px' } }, s.sources.filter(x => /^https?:/.test(x.url)).map(x => h('li', null, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title))))) : null)));
}

/* ---------------------------------------------------------------- resume: send the learner to wherever they left off */
async function pageResume(rid) {
  ctx.mount('home', ctx.loading('Opening your simulation...'));
  let r; try { r = (await ctx.api('GET', '/api/runs/' + rid)).run; } catch (e) { return ctx.mount('home', wrap(ctx.h('div', { class: 'card' }, ctx.h('h2', null, 'Simulation not found'), ctx.h('p', null, errText(e)), ctx.h('a', { href: '/#/' }, 'Back to simulations')))); }
  if (r.certificateId) return location.replace('/#/certificate/' + r.certificateId);
  const open = r.days.find(d => !d.completed);
  if (!open) return location.replace('/#/run/' + rid + '/certificate');
  location.replace('/#/run/' + rid + '/day/' + open.n + (open.clockedIn ? '/work' : ''));
}

/* ---------------------------------------------------------------- clock in */
async function pageClockin(rid, n) {
  const { h } = ctx; ctx.mount('home', ctx.loading('Opening your office...'));
  let run, sim; try { const r = await ctx.api('GET', '/api/runs/' + rid); run = r.run; sim = r.sim; } catch (e) { return ctx.mount('home', wrap(h('div', { class: 'card' }, h('h2', null, 'Simulation not found'), h('p', null, errText(e)), h('a', { href: '/#/' }, 'Back to simulations')))); }
  if (n > run.daysTotal) return location.replace('/#/run/' + rid);
  if (run.days[n - 1].clockedIn) return location.replace('/#/run/' + rid + '/day/' + n + (run.days[n - 1].completed ? '/summary' : '/work'));
  const now = new Date(), rounded = now.getHours() * 60 + now.getMinutes() - (now.getMinutes() % 5), pad = x => String(x).padStart(2, '0');
  const saved = ctx.db.cache.get('shift:' + rid, null), startDef = n === 1 || saved == null ? rounded : saved;
  const timeInput = h('input', { type: 'time', value: pad(Math.floor(startDef / 60)) + ':' + pad(startDef % 60), 'aria-label': 'When your shift starts' }), clockEl = h('div', { class: 'bigtime' });
  const status = statusBox(), result = h('div'), goBtn = h('button', { class: 'btn pri block', type: 'button', style: { marginTop: '16px' }, disabled: true }, 'Clock in');
  const tick = () => { const d = new Date(); clockEl.replaceChildren(String(d.getHours() % 12 || 12) + ':' + pad(d.getMinutes()), h('span', null, d.getHours() >= 12 ? 'PM' : 'AM')); };
  tick(); const timer = setInterval(() => { if (!document.body.contains(clockEl)) { clearInterval(timer); return; } tick(); }, 1000);
  ctx.mount('home', wrap(h('div', { class: 'center', style: { padding: '8px 0 24px' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '12px' } }, chip('Day ' + n + ' of ' + run.daysTotal, 'blue'), h('span', { class: 'small muted' }, run.title)),
    h('div', { class: 'card shiftcard' }, h('div', { class: 'row', style: { justifyContent: 'center', gap: '10px' } }, orgTile(run.company, true), h('b', null, run.company)),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Day ' + n + ': ' + (run.days[n - 1].theme || '')), h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Current time'), clockEl,
      h('div', { class: 'field', style: { textAlign: 'left' } }, h('label', null, 'Your shift starts at'), timeInput), h('p', { class: 'xs muted', style: { marginTop: '8px' } }, 'Clock in on time or early to score full punctuality. It is measured against this start time and your device clock.'),
      goBtn, status.el, result))));
  // make sure the day's script exists (written the first time anyone needs it)
  (async () => {
    try { status.show('Setting up your office...'); await runJob('POST', '/api/runs/' + rid + '/days/' + n + '/prepare', null, status.tick('Setting up your office...')); status.clear(); goBtn.disabled = false; }
    catch (e) { status.fail(errText(e)); goBtn.textContent = 'Try again'; goBtn.disabled = false; goBtn.onclick = () => pageClockin(rid, n); }
  })();
  goBtn.addEventListener('click', async () => {
    if (goBtn.textContent === 'Try again') return;
    const [hh, mm] = timeInput.value.split(':').map(Number); if (!Number.isFinite(hh)) { status.fail('Choose your shift start time.'); return; }
    goBtn.disabled = true;
    try {
      const r = await ctx.api('POST', '/api/runs/' + rid + '/days/' + n + '/clockin', { startMin: hh * 60 + mm, tzOffset: new Date().getTimezoneOffset() }); ctx.db.cache.set('shift:' + rid, hh * 60 + mm);
      const st = r.state, late = st.status === 'late';
      result.replaceChildren(h('div', { class: 'status ' + (late ? 'warn' : 'ok') }, ctx.icon(late ? ['c:12,12,9', 'M12 8v5m0 3.5v.01'] : ['M5 12.5l4.5 4.5L19 7.5'], 22), h('div', null, h('b', null, st.status === 'early' ? 'You clocked in ' + Math.abs(st.delta) + ' minutes early' : st.status === 'on' ? 'You clocked in on time' : 'You are ' + st.delta + ' minutes late'),
        h('span', null, late ? run.company + ' noticed. This is logged on your certificate.' : 'Great start. This is logged on your certificate.'))),
        h('a', { class: 'btn pri block', href: '/#/run/' + rid + '/day/' + n + '/work', style: { marginTop: '16px' } }, 'Enter the office'));
      goBtn.remove();
    } catch (e) { status.fail(errText(e)); goBtn.disabled = false; }
  });
}

/* ---------------------------------------------------------------- the workday */
function modal(...kids) {
  closeModal();
  const m = ctx.h('div', { class: 'scrim sim', id: 'modal' }, ctx.h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, ...kids));
  document.body.append(m); const first = m.querySelector('button, input'); if (first) first.focus();
}
function closeModal() { const m = document.getElementById('modal'); if (m) m.remove(); }

async function pageWork(rid, n) {
  const { h } = ctx, token = Symbol('work'); activeToken = token;
  ctx.mount('work', wrap(ctx.loading('Opening your office...')));
  let data, run; try { data = await ctx.api('GET', '/api/runs/' + rid + '/days/' + n); run = (await ctx.api('GET', '/api/runs/' + rid)).run; }
  catch (e) { if (e.status === 404) return location.replace('/#/run/' + rid + '/day/' + n); ctx.mount('home', wrap(h('div', { class: 'card' }, h('h2', null, 'Could not open the day'), h('p', null, errText(e)), h('a', { href: '/#/run/' + rid }, 'Back')))); return; }
  if (data.state.completed) return location.replace('/#/run/' + rid + '/day/' + n + '/summary');
  const people = Object.fromEntries(data.people.map(p => [p.key, p])), steps = data.day.steps, results = data.state.results || {}, mgr = data.people[0];
  const clk = h('span', { class: 'clockpill' }, '9:00 AM'), prog = h('i'), feed = h('div', { class: 'feed' });
  let cur = 540;
  const alive = () => { if (token !== activeToken) throw CANCEL; };
  const wait = async ms => { await sleep(ms); alive(); };
  const paint = m => { clk.textContent = fmtMin(m); prog.style.width = Math.max(0, Math.min(100, (m - 540) / 480 * 100)) + '%'; };
  async function setClock(t, snap) {
    const target = typeof t === 'number' ? t : toMin(t), from = cur; cur = target;
    if (snap || matchMedia('(prefers-reduced-motion: reduce)').matches || from === target) return paint(target);   // snap: replaying steps you already did
    const t0 = performance.now(); await new Promise(res => { (function step(now) { if (token !== activeToken) return res(); const p = Math.min(1, (now - t0) / 700); paint(Math.round(from + (target - from) * p)); if (p < 1) requestAnimationFrame(step); else res(); })(t0); });
  }
  const put = (node, cls) => { const d = h('div', { class: cls || '' }, node); feed.append(d); d.scrollIntoView({ behavior: 'smooth', block: 'end' }); return d; };
  const say = (key, text, time) => { const p = people[key]; return put([h('div', { class: 'av', style: { background: p.color }, 'aria-hidden': 'true' }, p.ini), h('div', { class: 'mb' }, h('div', { class: 'mh' }, h('b', null, p.name), h('span', { class: 'r' }, p.role), h('time', null, time || fmtMin(cur))), h('div', { class: 'txt' }, text))], 'msg'); };
  const me = text => put(h('div', { class: 'mb' }, h('div', { class: 'mh' }, h('b', null, 'You'), h('time', null, fmtMin(cur))), h('div', { class: 'txt' }, text)), 'msg me');
  const sys = text => put(typeof text === 'string' ? text : text, 'sys');
  const typing = key => { const p = people[key]; return put([h('div', { class: 'av', style: { background: p.color } }, p.ini), h('div', { class: 'typing', 'aria-label': p.name + ' is typing' }, h('i'), h('i'), h('i'))], 'msg'); };
  const typeThen = async (key, fn, instant) => { if (instant) return fn(); const ty = typing(key); await wait(1000); ty.remove(); return fn(); };
  const post = async (i, body) => { try { return await ctx.api('POST', '/api/runs/' + rid + '/days/' + n + '/steps/' + i, body); } catch (e) { ctx.toast(errText(e)); throw e; } };
  const fmtT = t => fmtMin(toMin(t));

  ctx.mount('work', wrap(
    h('div', { class: 'wtop' }, h('div', { class: 'wrap' }, h('div', { class: 'row' }, h('button', { class: 'icon', type: 'button', 'aria-label': 'Leave the workday (your progress is saved)', onclick: () => { activeToken = null; location.href = '/#/'; } }, ctx.icon(['M15 6l-6 6 6 6'])),
      h('div', { class: 'wtitle' }, run.title, h('small', null, 'Day ' + n + ' of ' + run.daysTotal + ' · ' + data.day.theme)), h('span', { class: 'sp' }), clk), h('div', { class: 'track' }, h('span', null, '9 AM'), h('div', { class: 'bar' }, prog), h('span', null, '5 PM')))),
    h('div', { class: 'wrap' }, h('div', { class: 'chan' }, '# ' + data.company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-team · Today'), feed)));
  paint(540);

  /* the work-upload card: paste text or attach a screenshot / PDF, get a review, revise once */
  function taskCard(st, i, res) {
    return new Promise(resolve => {
      const card = put(null, 'task'), body = h('div', { class: 'tbody' }); let attached = null;
      card.replaceChildren(chip('New task · due ' + st.due, 'blue'), h('h3', null, st.title), h('p', null, st.brief), body);
      const showReview = r => {
        const ok = !r.needsRevision, good = r.score >= 80;
        const fbEl = h('div', { class: 'fb ' + (good ? 'ok' : 'warn') }, h('h4', null, ctx.icon(['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'], 18), ' ' + (good ? 'Well done' : ok ? 'Reviewed' : 'Fix this') + ' · ' + r.score + '%'), h('p', null, r.feedback),
          r.fixes && r.fixes.length ? h('ul', null, r.fixes.map(x => h('li', null, x))) : null,
          h('div', { class: 'chips' }, r.rubric.map(x => chip(x.label + ' ' + Math.round(x.score * 100) + '%', x.score >= 0.7 ? 'ok' : 'warn'))),
          r.mode === 'rubric' ? h('p', { class: 'xs muted', style: { marginTop: '8px' } }, 'Checklist review (the AI reviewer was not available): it looks for key points and cannot judge quality like a person.') : null);
        body.replaceChildren(fbEl);
        card.scrollIntoView({ behavior: 'smooth', block: 'end' });
        if (ok) resolve(); else editor('Revise your work using the notes above, then resubmit.', lastText, fbEl);   // keep the feedback visible above the editor
      };
      let lastText = '';
      function editor(note, prefill, keep) {
        const box = h('textarea', { 'aria-label': 'Your work', placeholder: 'Paste your work here, or attach a PNG, JPG or PDF below', value: prefill || '' }), fileIn = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.pdf,.txt,.md', hidden: true, 'aria-label': 'Attach a file' }), chipBox = h('div'), msgBox = statusBox();
        const sub = h('button', { class: 'btn pri sm', type: 'button' }, 'Submit for review');
        fileIn.addEventListener('change', () => {
          const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
          if (/\.(txt|md)$/i.test(f.name)) { f.text().then(t => { box.value = (box.value ? box.value + '\n\n' : '') + t.slice(0, 7000); }); return; }
          const mime = /\.pdf$/i.test(f.name) ? 'application/pdf' : /\.png$/i.test(f.name) ? 'image/png' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : null;
          if (!mime) { msgBox.fail('Word files cannot be read. Paste the text, or save it as a PDF.'); return; }
          if (f.size > 1.5 * 1024 * 1024) { msgBox.fail('That file is over 1.5 MB. Use a smaller screenshot or paste the text.'); return; }
          const rd = new FileReader(); rd.onload = () => { attached = { name: f.name, mime, data: String(rd.result).split(',')[1] }; msgBox.clear(); chipBox.replaceChildren(h('div', { class: 'file' }, ctx.icon(['M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z', 'M14 3v5h5'], 18), h('span', null, f.name), h('button', { type: 'button', class: 'link', onclick: () => { attached = null; chipBox.replaceChildren(); } }, 'Remove'))); }; rd.readAsDataURL(f);
        });
        sub.addEventListener('click', async () => {
          lastText = box.value; if (lastText.trim().length < 20 && !attached) { msgBox.fail('Write or paste your work first (at least a few sentences), or attach a file.'); return; }
          sub.disabled = true; body.replaceChildren(attached ? h('div', { class: 'file' }, ctx.icon(['M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z', 'M14 3v5h5'], 18), h('span', null, attached.name)) : null, h('div', { class: 'review' }, h('div', { class: 'spin' }), mgr.name + ' is reading your work...'));
          try { const r = await post(i, { text: lastText, files: attached ? [{ mime: attached.mime, data: attached.data }] : [] }); attached = null; showReview(r); }
          catch (e) { editor('', lastText); body.prepend(h('div', { class: 'notice bad', style: { marginBottom: '8px' } }, errText(e))); }
        });
        body.replaceChildren(keep || null, note ? h('p', { class: 'small', style: { marginTop: '10px' } }, note) : null, box, h('div', { class: 'upl' }, h('button', { class: 'btn out sm', type: 'button', onclick: () => fileIn.click() }, ctx.icon(['M12 16V4m0 0L7 9m5-5l5 5M5 20h14'], 18), 'Attach a file'), sub), fileIn, chipBox, msgBox.el,
          h('p', { class: 'xs muted', style: { marginTop: '8px' } }, 'Paste text, or attach a PNG, JPG or PDF (under 1.5 MB). Word files: paste the text.'));
      }
      if (res) { lastText = ''; showReview(res); } else editor('', '');
    });
  }

  async function play() {
    await setClock('09:00', true); sys('You clocked in at ' + data.state.clockIn + ' · ' + ({ early: 'Early', on: 'On time', late: 'Late' }[data.state.status])); await wait(400);
    // coming back mid-day: everything before your first unanswered step appears instantly, then the day carries on normally
    const open = steps.findIndex((s, k) => ['reply', 'task', 'decision', 'quiz'].includes(s.type) && !(results[k] && (s.type !== 'task' || results[k].final)));
    for (let i = 0; i < steps.length; i++) {
      alive(); const st = steps[i], res = results[i], instant = open < 0 || i < open || !!res;
      if (st.type === 'msg') { await setClock(st.t, instant); await typeThen(st.from, () => say(st.from, st.text, fmtT(st.t)), instant); if (!instant) await wait(700); }
      else if (st.type === 'reply') {
        await setClock(st.t, instant);
        await typeThen(st.from, () => say(st.from, st.text, fmtT(st.t)), instant);
        if (res) { me(st.options[res.choice]); say(st.from, res.resp); continue; }
        const choice = await new Promise(resolve => { const q = put(st.options.map((o, k) => h('button', { type: 'button', onclick: () => { q.remove(); resolve(k); } }, o)), 'quick'); });
        const r = await post(i, { choice }); me(st.options[choice]); await typeThen(st.from, () => say(st.from, r.resp), false); await wait(700);
      } else if (st.type === 'task') {
        await setClock(st.t, instant); await taskCard(st, i, res); if (!instant) await wait(1000);
      } else if (st.type === 'decision') {
        await setClock(st.t, instant); sys(h('span', null, chip('Decision needed', 'warn'), ' ', h('span', { class: 'small' }, st.q)));
        if (res) { me("I'll start with: " + res.title + '.' + (res.why ? ' ' + res.why : '')); say('mgr', res.fb); continue; }
        const picked = await new Promise(resolve => {
          const why = h('input', { placeholder: 'One line explaining your choice', 'aria-label': 'Why? (optional)' });
          modal(h('div', { class: 'hd', style: { display: 'flex', justifyContent: 'space-between', marginBottom: '10px' } }, chip('Decision needed', 'warn'), h('span', { class: 'small muted' }, fmtT(st.t))), h('h2', { style: { fontSize: '21px', marginBottom: '6px' } }, st.q), h('p', { class: 'muted small' }, 'You cannot do both. Choose what you start with.'),
            h('div', { class: 'choices' }, ['a', 'b'].map(k => h('button', { class: 'choice', type: 'button', onclick: () => resolve({ k, why: why.value }) }, h('b', null, st[k].title), h('span', { class: 'small muted' }, st[k].detail)))), h('div', { class: 'field' }, h('label', null, 'Why? (optional)'), why));
        });
        let r; try { r = await post(i, { k: picked.k, why: picked.why }); } finally { closeModal(); }
        me("I'll start with: " + r.title + '.' + (picked.why ? ' ' + picked.why : '')); await typeThen('mgr', () => say('mgr', r.fb), false); await wait(800);
      } else if (st.type === 'break') { sys('Lunch break · 1:00 to 2:00 PM'); await setClock(14 * 60, instant); if (!instant) await wait(900); }
      else if (st.type === 'quiz') {
        await setClock(st.t, instant);
        if (res) { sys('Afternoon check-in · ' + (res.correct ? 'correct' : 'missed')); continue; }
        await new Promise(resolve => {
          const opts = st.options.map((o, k) => h('button', { class: 'choice', type: 'button', onclick: async () => {
            opts.forEach(b => { b.disabled = true; });
            try { const r = await post(i, { choice: k }); opts.forEach((b, j) => { if (j === r.answer) b.classList.add('right'); else if (j === k) b.classList.add('wrong'); });
              fb.replaceChildren(h('p', { class: 'why' }, h('b', null, r.correct ? 'Correct. ' : 'Not quite. '), r.why), h('button', { class: 'btn pri block', type: 'button', style: { marginTop: '14px' }, onclick: () => { closeModal(); resolve(); } }, 'Continue')); }
            catch (e) { opts.forEach(b => { b.disabled = false; }); }
          } }, h('b', null, o)));
          const fb = h('div'); modal(h('div', { class: 'hd', style: { display: 'flex', justifyContent: 'space-between', marginBottom: '10px' } }, chip('Afternoon check-in', 'blue'), h('span', { class: 'small muted' }, fmtT(st.t))), h('h2', { style: { fontSize: '21px' } }, st.q), h('div', { class: 'choices' }, opts), fb);
        });
        sys('Back to work'); await wait(600);
      }
    }
    await setClock('16:45'); await typeThen('mgr', () => say('mgr', n >= run.daysTotal ? 'That is a wrap on the simulation. Well done, thank you for the hard work.' : 'Good work today. Finish up and I will see you tomorrow.', fmtMin(cur)), false); await wait(600);
    await setClock('17:00');
    const out = h('button', { class: 'btn pri block', type: 'button' }, 'Clock out');
    put(h('div', { class: 'card' }, h('b', null, 'It is 5:00 PM'), h('p', { class: 'small muted', style: { margin: '4px 0 12px' } }, "Clock out to save today's report."), out), 'clockout');
    out.addEventListener('click', async () => { out.disabled = true; try { await ctx.api('POST', '/api/runs/' + rid + '/days/' + n + '/clockout'); activeToken = null; location.href = '/#/run/' + rid + '/day/' + n + '/summary'; } catch (e) { ctx.toast(errText(e)); out.disabled = false; } });
  }
  play().catch(e => { if (e !== CANCEL && token === activeToken) put(h('div', { class: 'notice bad' }, 'Something went wrong: ' + errText(e) + ' Your progress is saved. '), 'sys'); });
}

/* ---------------------------------------------------------------- day summary */
async function pageSummary(rid, n) {
  const { h } = ctx; activeToken = null; ctx.mount('home', ctx.loading('Saving your day report...'));
  let r; try { r = (await ctx.api('POST', '/api/runs/' + rid + '/days/' + n + '/clockout')).summary; } catch (e) { return ctx.mount('home', wrap(h('div', { class: 'card' }, h('h2', null, 'Not finished yet'), h('p', null, errText(e)), h('a', { class: 'btn pri', href: '/#/run/' + rid }, 'Back to work')))); }
  const m = r.manager, lbl = { early: 'Early', on: 'On time', late: 'Late' }[r.status];
  ctx.mount('home', wrap(h('div', { class: 'center', style: { padding: '8px 0 24px' } }, chip('Day ' + n + ' complete', 'ok'), h('h1', { style: { margin: '10px 0 4px' } }, 'Good work today'), h('p', { class: 'muted' }, r.theme),
    h('div', { class: 'card', style: { marginTop: '18px' } }, h('div', { class: 'kv' }, [
      ['Clocked in', h('span', null, r.clockIn + ' ', chip(lbl, r.status === 'late' ? 'warn' : 'ok'))], ['Clocked out', '5:00 PM'], ['Task', r.task + '%' + (r.improved ? ' (after feedback)' : '')],
      ['Urgent decision', r.decision >= 80 ? 'Strong call' : 'Could be better'], ['Afternoon check-in', r.quiz ? 'Correct' : 'Missed'], ['Teamwork reply', r.reply >= 80 ? 'Clear and constructive' : 'Needs work']].map(x => h('div', null, h('span', { class: 'k' }, x[0]), h('span', { class: 'v' }, x[1]))))),
    h('div', { class: 'msg', style: { marginTop: '18px' } }, h('div', { class: 'av', style: { background: m.color } }, m.ini), h('div', { class: 'mb' }, h('div', { class: 'mh' }, h('b', null, m.name), h('span', { class: 'r' }, m.role)), h('div', { class: 'txt' }, r.note))),
    h('a', { class: 'btn pri block', style: { marginTop: '22px' }, href: '/#/run/' + rid + (r.last ? '/certificate' : '/day/' + (n + 1)) }, r.last ? 'Get your certificate' : 'Start Day ' + (n + 1)),
    r.last ? null : h('p', { class: 'xs muted', style: { textAlign: 'center', marginTop: '8px' } }, 'Come back when you are ready for Day ' + (n + 1) + '. You choose your shift start time.'))));
}

/* ---------------------------------------------------------------- certificate */
async function pageRunCertificate(rid) {
  const { h } = ctx; ctx.mount('home', ctx.loading('Preparing your certificate...'));
  try {
    const r = await ctx.api('POST', '/api/runs/' + rid + '/certificate', { studentName: learnerName() || undefined });
    ctx.db.certs.put(r.certificate); location.replace('/#/certificate/' + r.certificate.id);
  } catch (e) {
    const name = h('input', { value: learnerName(), maxlength: '80', placeholder: 'Your full name', 'aria-label': 'Name on the certificate' }), s = statusBox();
    ctx.mount('home', wrap(h('div', { class: 'center', style: { padding: '8px 0 24px' } }, h('h1', null, 'Your certificate'), h('p', { class: 'muted', style: { margin: '6px 0 14px' } }, e.status === 403 ? e.message : e.status === 400 ? 'Enter the name to print on the certificate.' : errText(e)),
      e.status === 403 ? h('a', { class: 'btn pri', href: '/#/run/' + rid }, 'Back to work') : h('div', { class: 'card' }, h('div', { class: 'field', style: { marginTop: '0' } }, h('label', null, 'Name on the certificate'), name), h('button', { class: 'btn pri block', type: 'button', style: { marginTop: '14px' }, onclick: async () => {
        try { const r = await ctx.api('POST', '/api/runs/' + rid + '/certificate', { studentName: name.value.trim() }); ctx.db.cache.set('learnerName', name.value.trim()); ctx.db.certs.put(r.certificate); location.replace('/#/certificate/' + r.certificate.id); } catch (er) { s.fail(errText(er)); } } }, 'Get my certificate'), s.el))));
  }
}
function linkedInUrl(c, link) {
  const d = new Date(c.issuedAt);
  return 'https://www.linkedin.com/profile/add?' + new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name: c.jobTitle + ' Career Simulation', organizationName: 'SkillBridge', issueYear: String(d.getFullYear()), issueMonth: String(d.getMonth() + 1), certUrl: link, certId: c.id });
}
function renderCertificate(cert, ok, local, serverValid) {
  const { h } = ctx, link = location.origin + '/verify/' + cert.id, first = cert.studentName.split(/\s+/)[0], n = cert.workLog.length;
  ctx.mount('home', wrap(
    h('div', { class: 'noprint' }, h('div', { class: 'valid-box ' + (ok ? 'ok' : 'bad'), style: { marginBottom: '14px' } }, h('b', null, ok ? 'Authentic and unaltered' : 'FAILED: this certificate does not match its signature'),
      'Signature ' + (local === true ? 'checked in your browser with the issuer\'s public key' + (serverValid ? ' and by the issuer\'s registry.' : '.') : local === null ? 'checked by the issuer\'s registry.' : 'did not match.'))),
    chip('Simulation complete', 'ok'), h('h1', { style: { margin: '10px 0 4px' } }, 'Congratulations, ' + first), h('p', { class: 'muted' }, 'Your certificate is ready to share with employers.'),
    h('div', { class: 'paper', style: { marginTop: '20px' } }, h('span', { class: 'logo' }, 'skillbridge'), h('div', { class: 'kicker' }, 'Career Simulation Certificate'), h('div', { class: 'name' }, cert.studentName),
      h('div', { class: 'kicker' }, 'has completed a ' + n + '-day work simulation as'), h('div', { class: 'role' }, cert.jobTitle), h('div', { class: 'kicker' }, 'at ' + cert.company + ' (simulated workplace)'),
      h('div', { class: 'pstats' }, [[n, n > 1 ? 'workdays' : 'workday'], [cert.onTime + '/' + n, 'on-time check-ins'], [cert.overallScore + '%', cert.grade]].map(x => h('div', null, h('b', null, x[0]), h('span', null, x[1])))),
      h('div', { class: 'sign' }, h('div', null, h('span', { class: 'sg' }, cert.manager.name), h('small', null, cert.manager.role + ', ' + cert.company), h('small', null, 'Simulated manager, ' + (cert.aiDesigned ? 'AI-built scenario' : 'hand-written scenario'))), h('div', { class: 'seal' }, 'VERIFIED', h('br'), 'BY', h('br'), 'SKILLBRIDGE')),
      h('div', { class: 'code' }, 'Issued ' + ctx.fmtDate(cert.issuedAt) + ' · Verify at ' + link)),
    h('div', { class: 'row noprint', style: { marginTop: '16px', flexWrap: 'wrap' } }, h('a', { class: 'btn pri', style: { flex: '1 1 150px' }, href: linkedInUrl(cert, link), target: '_blank', rel: 'noopener noreferrer' }, 'Add to LinkedIn'),
      h('button', { class: 'btn out', type: 'button', style: { flex: '1 1 150px' }, onclick: () => window.print() }, 'Print or save PDF'), h('button', { class: 'btn out', type: 'button', style: { flex: '1 1 150px' }, onclick: () => ctx.copyText(link, 'Verification link') }, 'Copy link'),
      h('button', { class: 'btn out', type: 'button', style: { flex: '1 1 150px' }, onclick: () => ctx.download('skillbridge-certificate-' + cert.id + '.json', JSON.stringify(cert, null, 2)) }, 'Download signed file')),
    h('section', { class: 'sect' }, h('h2', null, 'What this certificate proves'), h('div', { class: 'card', style: { marginTop: '12px' } }, cert.rows.map(r => h('div', { class: 'skill' }, h('div', { class: 'sh' }, h('span', null, r.label), h('span', null, r.score + '%')), h('div', { class: 'bar' }, h('i', { style: { width: ctx.pct(r.score) + '%' } })), h('p', null, r.note))))),
    h('section', { class: 'sect' }, h('h2', null, 'Work log'), h('div', { class: 'card', style: { marginTop: '12px' } }, cert.workLog.map(l => h('div', { class: 'logrow' }, h('div', { class: 'lr' }, h('b', null, 'Day ' + l.day + ': ' + l.theme), chip({ early: 'Early', on: 'On time', late: 'Late' }[l.status], l.status === 'late' ? 'warn' : 'ok')), h('div', { class: 'lr muted' }, h('span', null, 'In ' + l.clockIn + ' · Out 5:00 PM'), h('span', null, 'Task ' + l.task + '% · Decision ' + l.decision + '%')))))),
    h('p', { class: 'small muted', style: { marginTop: '18px' } }, cert.statement), h('p', { class: 'xs muted', style: { marginTop: '6px' } }, 'Certificate ID ', h('code', { class: 'id' }, cert.id)),
    h('a', { class: 'btn out block noprint', style: { marginTop: '24px' }, href: '/#/' }, 'Try another simulation')));
}
function certificateSummary(cert, valid) {
  const { h } = ctx;
  return h('div', { class: 'card' }, h('h2', null, 'Simulation certificate: ' + cert.jobTitle), h('p', null, h('b', null, cert.studentName), ' · ' + cert.company + ' (simulated workplace) · ' + cert.days + ' workday' + (cert.days > 1 ? 's' : '') + ' · ' + cert.grade),
    h('div', { class: 'row', style: { marginTop: '0' } }, h('span', { class: 'score ' + (valid ? 'pass' : 'fail') }, cert.overallScore + '%'), h('span', { class: 'dim' }, 'Issued ' + ctx.fmtDate(cert.issuedAt))),
    h('ul', { class: 'small' }, cert.rows.map(r => h('li', null, r.label + ': ' + r.score + '% (' + r.note + ')'))), h('p', { class: 'small dim' }, cert.statement),
    h('details', null, h('summary', null, 'Technical details'), h('p', { class: 'small' }, 'Certificate ID: ', h('code', { class: 'id' }, cert.id)), h('p', { class: 'small' }, 'Signature (' + (cert.alg || 'Ed25519') + '): ', h('code', { class: 'id' }, cert.signature))));
}

/* ---------------------------------------------------------------- routing */
function route(hash) {
  let m;
  if (hash === '#/' || hash === '' || hash === '#') { activeToken = null; pageHome(); return true; }
  if ((m = /^#\/sim\/(sim_[a-f0-9]{10})$/.exec(hash))) { activeToken = null; pageDetail(m[1]); return true; }
  if ((m = /^#\/run\/(run_[a-f0-9]{12})$/.exec(hash))) { activeToken = null; pageResume(m[1]); return true; }
  if ((m = /^#\/run\/(run_[a-f0-9]{12})\/day\/([123])$/.exec(hash))) { activeToken = null; pageClockin(m[1], Number(m[2])); return true; }
  if ((m = /^#\/run\/(run_[a-f0-9]{12})\/day\/([123])\/work$/.exec(hash))) { pageWork(m[1], Number(m[2])); return true; }
  if ((m = /^#\/run\/(run_[a-f0-9]{12})\/day\/([123])\/summary$/.exec(hash))) { pageSummary(m[1], Number(m[2])); return true; }
  if ((m = /^#\/run\/(run_[a-f0-9]{12})\/certificate$/.exec(hash))) { activeToken = null; pageRunCertificate(m[1]); return true; }
  return false;
}
window.Sim = { init, route, renderCertificate, certificateSummary };
})();
