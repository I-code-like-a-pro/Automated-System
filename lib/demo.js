'use strict';
/* Demo and seeding helpers. Reference answers live HERE, on the server, never in the files served to browsers.
   They are used to (1) seed a realistic demo class so the university dashboard has data and (2) give a one-click demo student
   so a judge or teacher can see every screen in under a minute. Everything still goes through the real grading and signing code. */
const GOOD_TEXT = {
  'review-password-pr': "Thanks for the PR! One concern: passwords are stored in plain text, so if the database ever leaks an attacker gets every user's password, which is a serious security risk. Could we hash them with bcrypt and a per-user salt before inserting? Happy to pair on it if that helps.",
  'incident-update': "Sorry for the disruption this morning. Login was down for about 40 minutes and affected customers trying to sign in. A deploy changed the login query and caused the errors; we rolled it back at 9:55 and service is restored. Next we will add a test for this query, review how the change shipped, and monitor login closely today.",
  'clarify-vague-ticket': "Thanks! Before I start, can we agree what 'faster' means? Which page is slow and how slow is it now (a load time in seconds as a baseline)? Who is affected and what is the priority or deadline? My plan: first I would measure and profile to reproduce the problem, then fix the biggest cause. I will assume success means a target load time we agree, and confirm scope with you before changing anything.",
  'write-test-cases': "Happy path: a valid strong password with letters and numbers returns true. Empty string and null/undefined input must return false. Boundary: exactly 8 characters passes, 7 characters fails (one short, too short). Only letters returns false, only numbers returns false. Odd input: spaces, unicode and emoji, a very long password, and a non-string number input should not crash.",
  'estimate-feature': "I would break this into tasks: design the endpoint, implement the CSV export, add the button in the UI, then testing and review before release. Estimate: 3 to 5 days. Assumptions: only the data on the account page is needed. Risks: large exports could be slow, there are privacy and permission questions, and design may change the wording. I would add tests and monitor after deploy.",
  'status-update': "Today I fixed the checkout bug, which is done and merged. The CSV export is about half finished. I am waiting for design to confirm the button wording, which is a blocker for the last step. Next I will finish the export tomorrow and plan the tests.",
};
const GOOD_CODE = {
  fizzbuzz: "function fizzbuzz(n){ if(n%15===0) return 'FizzBuzz'; if(n%3===0) return 'Fizz'; if(n%5===0) return 'Buzz'; return String(n); }",
  average: 'function average(a){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }',
  slugify: "function slugify(s){ return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }",
  unique: 'function unique(a){ return [...new Set(a)]; }',
  groupByLength: 'function groupByLength(w){ const o={}; for(const x of w){ (o[x.length]=o[x.length]||[]).push(x); } return o; }',
};
const POOR_CODE = {
  fizzbuzz: "function fizzbuzz(n){ return n===3?'Fizz':n===5?'Buzz':String(n); }",
  average: 'function average(a){ return a.reduce((x,y)=>x+y,0)/a.length; }',
  slugify: "function slugify(s){ return s.toLowerCase().replace(/ /g,'-'); }",
  unique: 'function unique(a){ return a; }',
  groupByLength: 'function groupByLength(w){ return {}; }',
};

/* quality: 'good' passes, 'poor' usually fails */
function answerFor(task, quality) {
  if (task.type === 'mcq') return { choice: quality === 'good' ? task.mcq.correct : (task.mcq.correct + 1) % task.mcq.options.length };
  if (task.type === 'scenario') return { choices: task.scenario.steps.map(s => { const sc = s.scores, want = quality === 'good' ? Math.max(...sc) : Math.min(...sc); return sc.indexOf(want); }) };
  if (task.type === 'code') return { code: (quality === 'good' ? GOOD_CODE : POOR_CODE)[task.code.fn] };
  return { text: quality === 'good' ? GOOD_TEXT[task.id] : 'Looks fine to me, nothing to add here really, thanks everyone for the update on this one.' };
}

/* Student types for the synthetic class: how likely they are to attempt each task, by its PRIMARY skill. */
const ARCHETYPES = [
  { name: 'builder', love: ['problem-solving', 'debugging'], skip: ['security', 'code-review', 'requirements', 'testing'], rate: 0.8 },
  { name: 'communicator', love: ['communication', 'teamwork', 'requirements'], skip: ['testing', 'security', 'problem-solving'], rate: 0.75 },
  { name: 'balanced', love: ['debugging'], skip: ['security', 'testing', 'code-review'], rate: 0.55 },
  { name: 'beginner', love: [], skip: ['code-review', 'security', 'testing', 'requirements', 'version-control'], rate: 0.35 },
];
const NAMES = ['Amara', 'Kofi', 'Zainab', 'Tunde', 'Lerato', 'Nia', 'Omar', 'Fatima', 'Sipho', 'Chidi', 'Aisha', 'Mateo', 'Priya', 'Hao', 'Sara', 'Ravi'];

/* deterministic pseudo-random so the demo class looks the same every time */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const primarySkill = task => Object.entries(task.skills).sort((x, y) => y[1] - x[1])[0][0];
function plan(tasks, archetype, rand) {
  return tasks.filter(t => {
    const main = primarySkill(t);
    if (archetype.skip.includes(main)) return rand() < 0.06;           // rarely practise the skills their type avoids
    const boost = archetype.love.includes(main) ? 0.2 : 0;
    return rand() < Math.min(0.95, archetype.rate + boost);
  }).map(t => ({ task: t, quality: rand() < Math.min(0.95, archetype.rate + 0.25) ? 'good' : 'poor' }));
}
module.exports = { answerFor, ARCHETYPES, NAMES, rng, plan };
