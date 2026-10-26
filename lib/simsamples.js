'use strict';
/* Hand-written sample simulations (from the OfficeLife prototype): two jobs at a fictional Lagos logistics startup, three days each.
   They need no AI at all: replies, decisions and the check-in are scored by key, and submitted work is reviewed by a transparent
   keyword checklist (or by the AI reviewer when one is available). Scores and keys stay on the server. */
const crypto = require('node:crypto');

const COMPANY = { name: 'Tembea Logistics', about: 'A Lagos startup that delivers parcels with a driver app and is about to ship version 2.0.' };
const COLORS = { chidi: '#5B2BC4', tunde: '#0B6E5B', amina: '#B4326E', bisi: '#A65A00' };
const PEOPLE = {
  chidi: { name: 'Chidi Eze', role: 'Head of Product', ini: 'CE' }, tunde: { name: 'Tunde Alabi', role: 'Engineering Lead', ini: 'TA' },
  amina: { name: 'Amina Bello', role: 'Product Designer', ini: 'AB' }, bisi: { name: 'Bisi Okon', role: 'QA Engineer', ini: 'BO' },
};
const kw = (...groups) => groups;
const R = (label, weight, keywords) => ({ label, weight, keywords });
const reply = (t, from, text, options) => ({ t, type: 'reply', from, text, options: options.map(([label, score, resp]) => ({ label, score, resp })) });
const msg = (t, from, text) => ({ t, type: 'msg', from, text });
const task = (t, title, brief, due, rubric, points) => ({ t, type: 'task', title, brief, due, rubric, points, minWords: 30 });
const decision = (t, q, a, b) => ({ t, type: 'decision', q, a: { title: a[0], detail: a[1], score: a[2], fb: a[3] }, b: { title: b[0], detail: b[1], score: b[2], fb: b[3] } });
const brk = { t: '13:00', type: 'break' };
const quiz = (t, q, options, correct, why) => ({ t, type: 'quiz', q, options, correct, why });

const JOBS = [
  {
    id: 'sim_5eed000001', title: 'Project Manager', manager: 'chidi', team: ['tunde', 'amina', 'bisi'],
    blurb: 'Run the launch of a delivery app for a Lagos logistics startup.',
    learn: ['Plan a project with clear milestones, owners and risks', 'Prioritise when two urgent things collide', 'Communicate with developers, designers and clients', 'Make a launch decision and defend it'],
    skills: ['Project planning', 'Prioritisation', 'Risk management', 'Stakeholder communication', 'Decision-making', 'Time management'],
    days: [
      { theme: 'Get the plan straight', goal: 'Your first day: the payments work is late and you need a plan.', steps: [
        msg('09:05', 'chidi', 'Good morning, and welcome to Tembea Logistics. We ship Driver App 2.0 in two weeks and I need you running the project. Standup is at 9:30.'),
        msg('09:30', 'tunde', 'Standup update: login and maps are done. The payments screen is 3 days behind because the bank API keeps timing out.'),
        msg('09:35', 'amina', 'Designs for the delivery summary are ready. I need feedback before noon or I cannot hand over to Tunde today.'),
        reply('09:45', 'chidi', 'Quick one. What is your read on the payments delay?', [['Ask Tunde for a revised date and what exactly is blocking him', 100, 'Good. Facts first, then we decide.'], ['Tell the team to work faster', 30, 'That will not unblock a bank API. Ask what is blocking him.'], ['Say nothing for now', 50, 'Silence hides risk. Raise it early next time.']]),
        task('10:00', 'Write a one-page project plan', 'Write a one-page plan for Driver App 2.0 with the goal, key milestones with dates, owners and the top 2 risks. Facts: launch is in 14 days; login and maps are done; payments is 3 days behind because the bank API times out; Amina (design) and Tunde (engineering) are the owners. Paste your plan below or attach a PDF or screenshot.', '11:15 AM', [R('Clear goal, milestones and owners', 2, kw(['goal', 'objective', 'launch'], ['milestone', 'phase', 'week'], ['owner', 'responsible', 'lead', 'tunde', 'amina'])), R('Realistic dates', 2, kw(['date', 'day', 'week', 'by '], ['payments', 'api', 'bank'], ['buffer', 'contingency', 'slack', 'delay'])), R('Top risks with owners and responses', 2, kw(['risk', 'blocker', 'issue'], ['mitigat', 'fallback', 'plan b', 'response', 'workaround'], ['owner', 'assigned', 'responsible']))], 'A one-page plan with a goal, dated milestones, a named owner for each, and the payments delay as a risk with a response and an owner.'),
        decision('11:30', 'Two urgent things, one hour', ['Join the unhappy client call', 'Zenith Stores says 40 parcels arrived late. The call starts at 12:00.', 100, 'Right call. The client call cannot move, and you can ask the CEO for 30 more minutes on the report.'], ['Finish the weekly CEO report', 'It is due at 12:30. The CEO reads it before the board meeting.', 60, 'Understandable, but a client escalation cannot wait. A quick message to the CEO would have bought you time.']),
        brk,
        quiz('14:30', 'Tunde says payments will take 3 more days. Launch is in 10 days. What do you do first?', ['Move the launch date by 3 days', 'Check which tasks can run in parallel and find the new critical path', 'Ask Amina to cut design work', 'Tell the CEO everything is fine'], 1, 'Understand the critical path before moving dates or scope. The delay may not affect launch at all.'),
      ] },
      { theme: 'Manage risk and people', goal: 'Changes keep arriving late and the team is feeling it.', steps: [
        msg('09:00', 'chidi', 'Day two. Tunde found a workaround for the payments API, but it needs one small design change from Amina.'),
        reply('09:20', 'amina', 'If changes keep coming this late I cannot hit my deadlines. This is the third one this week.', [['Acknowledge it and agree a simple change-request process', 100, 'Thanks, that helps. A process means fewer surprises.'], ['Tell her to just make the change', 30, 'Okay, I will do it, but this is not sustainable.'], ['Agree with her and blame the developers', 50, 'Fair, but that will not get the change done today.']]),
        task('10:00', 'Build a risk register', 'List the top 5 risks for Driver App 2.0. For each one add likelihood, impact, an owner and your response. Risks you know of: the payments API timing out, late design changes, a QA bug backlog, the client asking for extra features, and a driver-phone compatibility problem. Paste it below or attach a PDF or screenshot.', '11:15 AM', [R('Covers the main risks', 2, kw(['payment', 'api', 'bank'], ['design', 'change', 'scope', 'feature'], ['qa', 'test', 'bug', 'compatib'])), R('Likelihood, impact and a response for each', 3, kw(['likelihood', 'probab', 'chance'], ['impact', 'severity', 'effect'], ['mitigat', 'response', 'plan', 'action'])), R('A named owner for each risk', 2, kw(['owner', 'responsible', 'assigned'], ['tunde', 'amina', 'bisi', 'chidi']))], 'A register of five risks, each with likelihood, impact, a named owner and a concrete response.'),
        decision('11:30', 'The client wants a new feature', ['Say yes to live parcel photos', 'Zenith Stores asks for it before launch. It adds about 5 days.', 40, 'Saying yes without checking impact puts the launch at risk. Always show the trade-off first.'], ['Explain the impact and offer it for version 2.1', 'Ship on time, and schedule the feature right after launch.', 100, 'Good judgement. You protected the deadline and kept the client in the plan.']),
        brk,
        quiz('14:30', 'Which tool shows who is Responsible, Accountable, Consulted and Informed for each task?', ['Gantt chart', 'RACI matrix', 'Burndown chart', 'SWOT analysis'], 1, 'A RACI matrix makes roles clear so nothing falls between people.'),
      ] },
      { theme: 'Launch decision', goal: 'Launch is tomorrow and QA found a minor bug.', steps: [
        msg('09:00', 'chidi', 'Launch is tomorrow. QA found one minor bug: the driver profile photo only refreshes after a restart.'),
        reply('09:25', 'chidi', 'The CEO wants an update in the next hour. How do you write it?', [['Short and honest: status, the known bug, your plan and what you need', 100, 'Exactly what a CEO needs. Send it.'], ['Say all is green and mention the bug later', 20, 'That would damage trust the moment someone finds it.'], ['Send a long technical report', 55, 'Too much detail. Lead with the decision.']]),
        task('10:00', 'Write the go / no-go message', 'Write a short message to the CEO recommending go or no-go for launch. Include the known bug (driver profile photo refreshes only after a restart), the risk and your plan. Paste it below or attach a document or screenshot.', '11:15 AM', [R('A clear recommendation', 3, kw(['recommend', 'go ', 'no-go', 'launch'], ['tomorrow', 'date', 'timeline', 'today'])), R('Honest about the bug and the risk', 2, kw(['bug', 'photo', 'profile', 'restart'], ['risk', 'impact', 'minor', 'workaround'])), R('Professional, calm tone', 1, kw(['please', 'thanks', 'recommend', 'propose', 'happy to', 'confident']))], 'A short message that leads with the recommendation, states the bug and its limited impact honestly, and gives the plan.'),
        decision('11:30', 'Launch with a known bug?', ['Launch tomorrow with the fix planned for next week', 'Tell support, write the workaround, and monitor closely.', 100, 'Sound call. The bug is minor, a delay costs more, and you prepared support.'], ['Delay launch by one week', 'Fix everything first, then release.', 50, 'Safe, but a week of delay for a minor bug has real cost. Weigh impact against risk.']),
        brk,
        quiz('14:30', 'After launch, what is the best next step?', ['Close the project and move on', 'Hold a retrospective and track usage metrics', 'Start a new project straight away', 'Wait for complaints'], 1, 'Retrospectives and metrics turn one launch into lessons for the next.'),
      ] },
    ],
  },
  {
    id: 'sim_5eed000002', title: 'Junior Software Engineer', manager: 'tunde', team: ['chidi', 'amina', 'bisi'],
    blurb: 'Fix real bugs and ship code for a Lagos logistics startup.',
    learn: ['Reproduce, fix and test a real bug', 'Open a clear pull request and respond to review', 'Choose between a quick hotfix and the safe route', 'Ship a release and write a short post-mortem'],
    skills: ['Debugging', 'Git and pull requests', 'Unit testing', 'Code review', 'Incident response', 'Teamwork'],
    days: [
      { theme: 'Fix your first bug', goal: 'The Pay button sometimes charges drivers twice.', steps: [
        msg('09:05', 'tunde', 'Welcome to the team. Pull the latest from main. Your first ticket is TKT-214: the Pay button on the Driver App sometimes charges twice.'),
        msg('09:30', 'bisi', 'I can reproduce it. A double tap on Pay sends two requests. Screenshot is in the ticket.'),
        reply('09:45', 'tunde', 'How would you start?', [['Reproduce it locally, then find where the request is sent', 100, 'Good. Reproduce first, then fix.'], ['Add a random delay to the button', 30, 'That hides the bug instead of fixing it.'], ['Ask a senior to fix it', 50, 'Ask for help when stuck, but try first.']]),
        task('10:00', 'Fix TKT-214 and open a pull request', 'Stop the Pay button from sending a second request while the first is still running. Describe your fix and your pull request: what you changed, why, and how you tested it. Paste code and description below, or attach a screenshot of your pull request.', '11:15 AM', [R('Correct fix', 3, kw(['disable', 'lock', 'flag', 'debounce', 'pending', 'in-flight', 'inflight', 'idempot', 'loading'], ['button', 'tap', 'click', 'request', 'submit'])), R('Readable, simple change', 2, kw(['function', 'const', 'comment', 'name', 'clear', 'if '])), R('Clear pull request description', 2, kw(['pull request', 'pr ', 'description', 'summary', 'changes'], ['test', 'steps', 'verify', 'tested']))], 'A guard that ignores or disables further taps while a request is pending (or an idempotency key), a short readable change, and a description with how it was tested.'),
        decision('11:30', 'Two urgent things, one hour', ['Investigate the production alert', "Drivers cannot see today's route. Reported at 11:20.", 100, 'Right. A live outage beats a pending pull request. Tell Tunde your PR will be late.'], ['Finish your pull request for TKT-214', 'Tunde wants it before noon.', 50, 'Your PR matters, but drivers are blocked right now. Production issues come first.']),
        brk,
        quiz('14:30', 'In payments, what is an idempotency key used for?', ['Encrypting card numbers', 'Making sure the same payment is not processed twice', 'Speeding up the API', 'Logging users out'], 1, 'The server uses the key to recognise a repeated request and ignore it, which is exactly the double-charge problem.'),
      ] },
      { theme: 'Tests and code review', goal: 'The fix works but has no tests.', steps: [
        msg('09:00', 'tunde', 'Code review day. Your fix works, but Bisi noticed there are no tests for it.'),
        reply('09:20', 'bisi', 'Can we merge without tests? The release is close.', [['No. I will add tests now, it will take 30 minutes', 100, 'Great. That is the habit we want.'], ['Yes, we can add them later', 30, 'Later usually means never. Please add them now.'], ['Ask Tunde to decide', 55, 'Fine, but come with your own view next time.']]),
        task('10:00', 'Write 3 unit tests', 'Write 3 unit tests for the Pay button fix: a normal single tap, a double tap, and a failed request. Paste the test code below or attach a screenshot of the tests passing.', '11:15 AM', [R('Covers the three cases', 3, kw(['test', 'it(', 'expect', 'assert'], ['double', 'twice', 'two taps', 'second'])), R('Clear test names', 1, kw(['should', 'when', 'given', 'test_', 'it(', 'test(', 'describe'])), R('Handles the failure case', 2, kw(['fail', 'error', 'reject', 'timeout', 'throw'], ['normal', 'single', 'once', 'one tap']))], 'Three tests: one tap sends one request, a double tap sends one request, and a failed request re-enables the button.'),
        decision('11:30', 'A small fix is needed in production', ['Edit the file directly on main', 'Fastest. No review needed.', 30, 'Never edit main directly. Even a small change can break the build for everyone.'], ['Create a branch and open a pull request', 'Slightly slower, but reviewed and traceable.', 100, 'Correct. Branch, PR and review keeps the team safe.']),
        brk,
        quiz('14:30', 'Which HTTP status code means a resource was not found?', ['200', '500', '404', '401'], 2, '404 means not found. 500 is a server error and 401 means unauthorised.'),
      ] },
      { theme: 'Ship and learn', goal: 'Release day, then a post-mortem.', steps: [
        msg('09:00', 'tunde', 'Release day. Your fix is approved and ready to ship.'),
        reply('09:25', 'tunde', 'How do you want to handle the release?', [['Plan the deploy, tell the team and watch the logs after', 100, 'That is how a professional ships.'], ['Deploy and go for lunch', 20, 'Never leave a release unwatched.'], ['Ask someone else to deploy', 50, 'You should learn the deploy process yourself.']]),
        task('10:00', 'Write a short post-mortem', 'Write a half-page post-mortem on the double-charge bug: what happened, why, how you fixed it and how to prevent it. Keep the tone blameless. Paste it below or attach a document or screenshot.', '11:15 AM', [R('Finds the root cause', 3, kw(['root cause', 'caused', 'because', 'double tap', 'two requests', 'twice'], ['payment', 'charge', 'request', 'button'])), R('Prevention steps', 2, kw(['prevent', 'prevention', 'test', 'idempot', 'monitor', 'alert', 'review'])), R('Blameless tone', 1, kw(['we ', 'the system', 'the process', 'our ']))], 'What happened, the root cause (no guard against duplicate requests), the fix, and concrete prevention such as tests, idempotency keys and monitoring, without blaming a person.'),
        decision('11:30', 'It is Friday, 4:30 PM', ['Release now with one reviewer offline', 'The fix is ready and the team wants it done.', 40, 'A late Friday release with less coverage is risky. If it breaks, nobody is around to help.'], ['Release Monday morning', 'The whole team is online and can react quickly.', 100, 'Good judgement. Ship when you can support what you ship.']),
        brk,
        quiz('14:30', 'A new release breaks checkout. What is the fastest safe action?', ['Roll back to the last stable version', 'Debug directly on production', 'Ignore it until Monday', 'Restart the server and hope'], 0, 'Roll back first to stop the damage, then investigate calmly.'),
      ] },
    ],
  },
];

const shuffled = n => { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* turn the readable definitions above into stored simulations (person keys, shuffled options, rubric ids) */
function build(job) {
  const keyOf = { [job.manager]: 'mgr' }; job.team.forEach((k, i) => { keyOf[k] = 'p' + (i + 1); });
  const people = [job.manager].concat(job.team).map(k => ({ key: keyOf[k], name: PEOPLE[k].name, role: PEOPLE[k].role, ini: PEOPLE[k].ini, color: COLORS[k] }));
  const days = {};
  job.days.forEach((d, di) => {
    days[String(di + 1)] = { theme: d.theme, goal: d.goal, research: 'none', steps: d.steps.map(s => {
      const out = { ...s };
      if (s.from) out.from = keyOf[s.from];
      if (s.type === 'reply') out.options = shuffled(3).map(i => s.options[i]);
      if (s.type === 'task') out.rubric = s.rubric.map((r, i) => ({ id: 'c' + (i + 1), ...r }));
      if (s.type === 'decision' && crypto.randomInt(2)) { out.a = s.b; out.b = s.a; }
      if (s.type === 'quiz') { const order = shuffled(4); out.options = order.map(i => s.options[i]); out.correct = order.indexOf(s.correct); }
      return out;
    }) };
  });
  return { id: job.id, static: true, topic: job.title, title: job.title, company: COMPANY, blurb: job.blurb, level: 'beginner', learn: job.learn, skills: job.skills, people,
    dayThemes: job.days.map(d => ({ theme: d.theme, goal: d.goal })), disclaimer: '', sources: [], research: 'none', days, createdAt: '2026-01-01T00:00:00.000Z' };
}

function seed(db) {
  let n = 0;
  JOBS.forEach(job => { if (!db.simById(job.id)) { db.addSim(build(job), null, 1e9); n++; } });
  return n;
}

module.exports = { seed, build, JOBS, COMPANY };
