'use strict';
/* The server's shared database: a tiny JSON file with atomic writes (no dependencies).
   It holds only what must be shared between people:
     evidence    issued, signed evidence records, so an employer can verify a short link
     portfolios  opt-in public portfolios
     cohorts     voluntary class groups (a code plus the owner hashes that joined), used only for anonymous aggregates
     generated   AI-written tasks with their answer keys, so they can be graded later
     courses     AI-designed courses (outline + sources); lessons holds the written lessons; no personal data, shared by everyone
     attempts    quizzes in progress, with their answer keys (server only, short-lived)
     certs       signed certificates (courses and work simulations)
     sims        AI-designed (or hand-written) work simulations with their scripted days, scores and keys; shared, no personal data
     runs        each learner's progress through a simulation (clock-ins, choices, scores), tied to the owner hash
   Each record is tied to a random owner hash, never to a name, email or account.
   Everything personal (profile, coursework, drafts, queue) lives in the student's own browser (see public/localdb.js).
   Fine for a pilot with thousands of students and ONE server process; swap for SQLite/Postgres to scale. */
const fs = require('node:fs');
const path = require('node:path');

function open(file) {
  let data = { evidence: {}, portfolios: {}, cohorts: {}, generated: {}, courses: {}, lessons: {}, attempts: {}, certs: {}, sims: {}, runs: {}, meta: {} };
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* new database */ }
  let timer = null;
  const flushNow = () => {
    clearTimeout(timer); timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp', text = JSON.stringify(data);
    fs.writeFileSync(tmp, text);
    /* write then rename: a crash never leaves a half-written file. Windows (virus scanners, indexers) sometimes refuses the rename
       for a moment (EPERM/EBUSY/EACCES), so retry briefly and, as a last resort, write the file directly. */
    for (let i = 0; i < 5; i++) {
      try { fs.renameSync(tmp, file); return; }
      catch (e) {
        if (!/^(EPERM|EBUSY|EACCES)$/.test(e.code)) throw e;
        if (i === 4) { fs.writeFileSync(file, text); try { fs.unlinkSync(tmp); } catch (e2) { /* leave it */ } return; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1));
      }
    }
  };
  const save = () => { if (!timer) { timer = setTimeout(flushNow, 150); timer.unref && timer.unref(); } };
  return {
    get data() { return data; },
    save, flushNow,
    evidenceById(id) { return data.evidence[id] || null; },
    evidenceForOwner(ownerHash) { return Object.values(data.evidence).filter(e => e.ownerHash === ownerHash).map(e => e.record).sort((a, b) => (b.issuedAt > a.issuedAt ? 1 : -1)); },
    portfolioByOwner(ownerHash) { return Object.values(data.portfolios).find(p => p.ownerHash === ownerHash) || null; },
    portfolioByPublicId(pid) { return Object.values(data.portfolios).find(p => p.publicId === pid && p.isPublic) || null; },
    generatedById(id) { return data.generated[id] || null; },
    generatedForOwner(ownerHash) { return Object.values(data.generated).filter(g => g.ownerHash === ownerHash).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).map(g => g.task); },
    addGenerated(ownerHash, task, perOwner, total) {
      data.generated[task.id] = { task, ownerHash, createdAt: new Date().toISOString() };
      const trim = (list, keep) => list.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)).slice(0, Math.max(0, list.length - keep)).forEach(g => { delete data.generated[g.task.id]; });
      trim(Object.values(data.generated).filter(g => g.ownerHash === ownerHash), perOwner);
      trim(Object.values(data.generated), total);
      save();
    },
    /* ---- courses: shared content, so one person's AI work serves everyone ---- */
    courseById(id) { return data.courses[id] || null; },
    addCourse(course, ownerHash, max) {
      data.courses[course.id] = { ...course, ownerHash };
      const all = Object.values(data.courses).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      all.slice(0, Math.max(0, all.length - max)).forEach(c => { delete data.courses[c.id]; delete data.lessons[c.id]; });
      save();
    },
    listCourses(query, limit) {
      const q = String(query || '').toLowerCase().trim();
      return Object.values(data.courses).filter(c => !q || (c.title + ' ' + c.topic + ' ' + c.summary).toLowerCase().includes(q))
        .sort((a, b) => (a.static === b.static ? (b.createdAt > a.createdAt ? 1 : -1) : (a.static ? -1 : 1))).slice(0, limit || 60);   // the hand-written sample course first, then newest
    },
    lessonsOf(courseId) { return data.lessons[courseId] || {}; },
    lessonOf(courseId, lessonId) { return (data.lessons[courseId] || {})[lessonId] || null; },
    putLesson(courseId, lesson) { (data.lessons[courseId] || (data.lessons[courseId] = {}))[lesson.id] = lesson; save(); },
    /* quizzes in progress keep their answer keys here until submitted or stale */
    attemptById(id) { return data.attempts[id] || null; },
    putAttempt(attempt, ownerHash, maxPerOwner) {
      const cutoff = new Date(Date.now() - 6 * 3600e3).toISOString();
      Object.keys(data.attempts).forEach(id => { if (data.attempts[id].createdAt < cutoff) delete data.attempts[id]; });
      const mine = Object.values(data.attempts).filter(a => a.ownerHash === ownerHash).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      mine.slice(0, Math.max(0, mine.length - maxPerOwner + 1)).forEach(a => { delete data.attempts[a.id]; });
      data.attempts[attempt.id] = { ...attempt, ownerHash }; save();
    },
    deleteAttempt(id) { delete data.attempts[id]; save(); },
    openAttempt(ownerHash, courseId, moduleId) {
      const cutoff = new Date(Date.now() - 2 * 3600e3).toISOString();
      return Object.values(data.attempts).find(a => a.ownerHash === ownerHash && a.courseId === courseId && a.moduleId === moduleId && a.createdAt >= cutoff) || null;
    },
    /* ---- work simulations ---- */
    simById(id) { return data.sims[id] || null; },
    addSim(sim, ownerHash, max) {
      data.sims[sim.id] = { ...sim, ownerHash };
      const all = Object.values(data.sims).filter(s => !s.static).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      all.slice(0, Math.max(0, all.length - max)).forEach(s => { delete data.sims[s.id]; });
      save();
    },
    listSims(query, limit) {
      const q = String(query || '').toLowerCase().trim();
      return Object.values(data.sims).filter(s => !q || (s.title + ' ' + s.topic + ' ' + s.blurb + ' ' + s.company.name).toLowerCase().includes(q))
        .sort((a, b) => (!!a.static === !!b.static ? (b.createdAt > a.createdAt ? 1 : -1) : (a.static ? -1 : 1))).slice(0, limit || 60);
    },
    putSimDay(simId, n, day) { const s = data.sims[simId]; if (s) { s.days[String(n)] = day; save(); } },
    runById(id) { return data.runs[id] || null; },
    putRun(run) { data.runs[run.id] = run; save(); },
    runsForOwner(ownerHash) { return Object.values(data.runs).filter(r => r.ownerHash === ownerHash).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)); },
    certForRun(ownerHash, runId) { return Object.values(data.certs).find(c => c.ownerHash === ownerHash && c.record.runId === runId) || null; },
    certById(id) { return data.certs[id] || null; },
    certFor(ownerHash, courseId) { return Object.values(data.certs).find(c => c.ownerHash === ownerHash && c.record.courseId === courseId) || null; },
    certsForOwner(ownerHash) { return Object.values(data.certs).filter(c => c.ownerHash === ownerHash).map(c => c.record); },
    putCert(record, ownerHash) { data.certs[record.id] = { record, ownerHash }; save(); },
    cohortOf(ownerHash) { return Object.values(data.cohorts).find(c => c.members.includes(ownerHash)) || null; },
    leaveCohort(ownerHash) { Object.values(data.cohorts).forEach(c => { c.members = c.members.filter(h => h !== ownerHash); if (!c.members.length) delete data.cohorts[c.code]; }); save(); },
    joinCohort(ownerHash, code) {
      Object.values(data.cohorts).forEach(c => { if (c.code !== code) c.members = c.members.filter(h => h !== ownerHash); });   // one cohort at a time
      const c = data.cohorts[code] || (data.cohorts[code] = { code, members: [], createdAt: new Date().toISOString() });
      if (!c.members.includes(ownerHash)) c.members.push(ownerHash);
      Object.values(data.cohorts).forEach(x => { if (!x.members.length) delete data.cohorts[x.code]; });
      save(); return c;
    },
    removeOwner(ownerHash) {
      Object.values(data.cohorts).forEach(c => { c.members = c.members.filter(h => h !== ownerHash); if (!c.members.length) delete data.cohorts[c.code]; });
      Object.keys(data.evidence).forEach(id => { if (data.evidence[id].ownerHash === ownerHash) delete data.evidence[id]; });
      Object.keys(data.portfolios).forEach(id => { if (data.portfolios[id].ownerHash === ownerHash) delete data.portfolios[id]; });
      Object.keys(data.generated).forEach(id => { if (data.generated[id].ownerHash === ownerHash) delete data.generated[id]; });
      Object.keys(data.attempts).forEach(id => { if (data.attempts[id].ownerHash === ownerHash) delete data.attempts[id]; });
      Object.keys(data.certs).forEach(id => { if (data.certs[id].ownerHash === ownerHash) delete data.certs[id]; });
      Object.keys(data.runs).forEach(id => { if (data.runs[id].ownerHash === ownerHash) delete data.runs[id]; });
      Object.values(data.sims).forEach(s => { if (s.ownerHash === ownerHash) s.ownerHash = null; });
      Object.values(data.courses).forEach(c => { if (c.ownerHash === ownerHash) c.ownerHash = null; });   // course content is shared and holds no personal data: keep it, drop the link to the person
      save();
    },
  };
}
module.exports = { open };
