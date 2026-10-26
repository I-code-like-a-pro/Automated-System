'use strict';
/* The server's shared database: a tiny JSON file with atomic writes (no dependencies).
   It holds only what must be shared between people:
     evidence    issued, signed evidence records, so an employer can verify a short link
     portfolios  opt-in public portfolios
     cohorts     voluntary class groups (a code plus the owner hashes that joined), used only for anonymous aggregates
     generated   AI-written tasks with their answer keys, so they can be graded later
   Each record is tied to a random owner hash, never to a name, email or account.
   Everything personal (profile, coursework, drafts, queue) lives in the student's own browser (see public/localdb.js).
   Fine for a pilot with thousands of students and ONE server process; swap for SQLite/Postgres to scale. */
const fs = require('node:fs');
const path = require('node:path');

function open(file) {
  let data = { evidence: {}, portfolios: {}, cohorts: {}, generated: {}, meta: {} };
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* new database */ }
  let timer = null;
  const flushNow = () => {
    clearTimeout(timer); timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file);   // write then rename: a crash never leaves a half-written file
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
      save();
    },
  };
}
module.exports = { open };
