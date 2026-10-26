/* Skill maths shared by the server and the browser (UMD, no dependencies).
   - claimed: what the student's coursework suggests they have been exposed to (self-reported, unverified)
   - verified: what graded, signed evidence proves, weighted by how much evidence exists */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Skills = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Match free text (courses, projects, clubs) against each skill's hint words. Claimed is capped at 60:
     coursework suggests exposure, it does not prove capability. */
  function claimedFromCoursework(text, skills) {
    const t = String(text || '').toLowerCase(), out = {};
    skills.forEach(s => {
      const matches = [...new Set(s.hints.filter(h => t.includes(h)))];
      out[s.id] = { claimed: matches.length ? Math.min(60, 25 + 12 * (matches.length - 1)) : 0, matches };
    });
    return out;
  }

  /* Evidence list -> per-skill level. Only the best score per task counts.
     level = average score x evidence share. Evidence share is the weight of the tasks passed divided by the weight needed for
     full credit (6, or 80% of what exists for that skill). One lucky task can never prove a skill: two or three good ones can. */
  function levelsFromEvidence(evidence, tasks, skills) {
    const best = {};
    evidence.forEach(e => { if (!best[e.taskId] || e.score > best[e.taskId]) best[e.taskId] = e.score; });
    // evidence for tasks not in the list (AI-written ones, or any not loaded) still counts, using the skills signed into the record
    const known = new Set(tasks.map(t => t.id)), extra = {};
    evidence.forEach(e => { if (!known.has(e.taskId) && e.skills && !extra[e.taskId]) extra[e.taskId] = { id: e.taskId, skills: e.skills }; });
    tasks = tasks.concat(Object.values(extra));
    const out = {};
    skills.forEach(s => {
      let sum = 0, wsum = 0, done = 0, available = 0, availableWeight = 0;
      tasks.forEach(t => {
        const w = t.skills && t.skills[s.id]; if (!w) return;
        available++; availableWeight += w;
        if (best[t.id] != null) { sum += best[t.id] * w; wsum += w; done++; }
      });
      const avg = wsum ? sum / wsum : 0, full = Math.min(6, Math.max(2, availableWeight * 0.8)), share = Math.min(1, wsum / full);
      out[s.id] = { level: Math.round(avg * share), average: Math.round(avg), confidence: Math.round(share * 100), tasksDone: done, tasksAvailable: available };
    });
    return out;
  }

  /* Next best tasks: the ones that test the biggest gaps and have not been passed yet. */
  function recommend(levels, tasks, evidence, target, limit) {
    const done = new Set(evidence.map(e => e.taskId));
    return tasks.filter(t => !done.has(t.id)).map(t => {
      let gain = 0;
      Object.entries(t.skills).forEach(([id, w]) => { const gap = Math.max(0, target - (levels[id] ? levels[id].level : 0)); gain += gap * w; });
      return { task: t, gain: gain - t.difficulty * 2 };
    }).sort((a, b) => b.gain - a.gain).slice(0, limit || 4).map(x => x.task);
  }

  function levelName(score) { return score >= 85 ? 'Strong' : score >= 70 ? 'Proficient' : score >= 60 ? 'Developing' : 'Not yet'; }

  return { claimedFromCoursework, levelsFromEvidence, recommend, levelName };
});
