'use strict';
/* University cohort dashboard: anonymous, aggregate-only skill gaps for a class.
   Privacy rules (enforced here, covered by tests):
     - nothing is shown until the cohort has at least K members (default 5), so no individual can be singled out
     - only aggregates are returned: no names, no ids, no hashes, no individual scores
     - percentages are rounded to the nearest 5 so small groups do not reveal exact membership effects
   Joining is voluntary and uses a code the university shares with its students; a person belongs to one cohort at a time. */
const Skills = require('../public/skills.js');

const MIN_COHORT = Math.max(2, Number(process.env.COHORT_MIN) || 5);
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;
const normalise = code => String(code || '').trim().toUpperCase().replace(/\s+/g, '-');
const round5 = n => Math.round(n / 5) * 5;

function aggregate(db, code, roles, tasks, min = MIN_COHORT) {
  const cohort = db.data.cohorts[code];
  if (!cohort) return null;
  const size = cohort.members.length;
  if (size < min) return { code, size, locked: true, need: min };
  const roleId = 'software-engineer', role = roles[roleId], list = tasks.filter(t => t.role === roleId);
  const people = cohort.members.map(hash => {
    const best = {}; db.evidenceForOwner(hash).forEach(e => { if (!best[e.taskId] || e.score > best[e.taskId].score) best[e.taskId] = e; });
    const ev = Object.values(best);
    return { ev, levels: Skills.levelsFromEvidence(ev, list, role.skills) };
  });
  const active = people.filter(p => p.ev.length).length;
  const skills = role.skills.map(s => {
    const lv = people.map(p => p.levels[s.id].level), mean = lv.reduce((a, b) => a + b, 0) / lv.length;
    return { id: s.id, name: s.name, mean: Math.round(mean), atTargetPct: round5(lv.filter(x => x >= role.targetLevel).length / lv.length * 100), startedPct: round5(people.filter(p => p.levels[s.id].tasksDone > 0).length / people.length * 100) };
  });
  const gaps = [...skills].sort((a, b) => a.mean - b.mean).slice(0, 3).map(s => s.id);
  const suggested = list.filter(t => gaps.some(g => t.skills[g])).sort((a, b) => Object.keys(b.skills).filter(k => gaps.includes(k)).length - Object.keys(a.skills).filter(k => gaps.includes(k)).length).slice(0, 4).map(t => ({ id: t.id, title: t.title }));
  return { code, size, locked: false, min, active, targetLevel: role.targetLevel, roleTitle: role.title, skills, gaps, suggested, avgEvidence: Math.round(people.reduce((a, p) => a + p.ev.length, 0) / people.length * 10) / 10, generatedAt: new Date().toISOString() };
}
module.exports = { aggregate, normalise, CODE_RE, MIN_COHORT };
