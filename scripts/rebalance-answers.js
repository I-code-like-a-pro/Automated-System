'use strict';
/* One-off content tool: spreads the correct option evenly across positions so "always pick A/B" does not work.
   Deterministic (round-robin by question number), keeps every explanation attached to its own option. Run: node scripts/rebalance-answers.js */
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, '..', 'data', 'tasks.json');
const tasks = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
/* move the best option to `target`, keeping the others in their original relative order */
function reorder(len, best, target) {
  const rest = [...Array(len).keys()].filter(i => i !== best); rest.splice(target, 0, best); return rest;   // rest[newPos] = oldIndex
}
tasks.forEach(t => {
  if (t.mcq) {
    const order = reorder(t.mcq.options.length, t.mcq.correct, (n++ * 3 + 1) % t.mcq.options.length);
    t.mcq.options = order.map(i => t.mcq.options[i]); t.mcq.explain = order.map(i => t.mcq.explain[i]); t.mcq.correct = order.indexOf(t.mcq.correct);
  }
  if (t.scenario) t.scenario.steps.forEach(s => {
    const best = s.scores.indexOf(Math.max(...s.scores)), order = reorder(s.options.length, best, (n++ * 3 + 1) % s.options.length);
    s.options = order.map(i => s.options[i]); s.explain = order.map(i => s.explain[i]); s.scores = order.map(i => s.scores[i]);
  });
});
fs.writeFileSync(file, JSON.stringify(tasks, null, 2) + '\n');
const pos = {}; tasks.forEach(t => { if (t.mcq) pos[t.mcq.correct] = (pos[t.mcq.correct] || 0) + 1; if (t.scenario) t.scenario.steps.forEach(s => { const i = s.scores.indexOf(Math.max(...s.scores)); pos[i] = (pos[i] || 0) + 1; }); });
console.log('best-answer positions now:', pos);
