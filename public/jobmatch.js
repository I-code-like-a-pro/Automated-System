/* Job match: paste a real job ad, see how ready you are, what the gaps are, and which tasks close them.
   Runs entirely on the device (the ad text is never sent anywhere). It is a transparent keyword analysis, not a hiring prediction:
   it counts how often the ad asks for each skill, sets a requirement from that, and compares it with what you have PROVEN. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.JobMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Realistic but invented example ads, so anyone can try it in one click. */
  const SAMPLES = [
    { id: 'fintech', title: 'Junior Software Engineer: payments startup', text:
      'Junior Software Engineer\nWe are a small payments team building APIs used by merchants every day.\n\nYou will:\n- Write clean, tested code in Python or JavaScript and own features end to end\n- Debug and troubleshoot production issues, finding the root cause and writing it up for the team\n- Use Git and GitHub daily, open pull requests and take part in code review\n- Write unit tests and help us improve test coverage\n- Work with product to turn user stories into small, estimated tasks in an agile sprint\n\nYou have:\n- A degree in Computer Science or similar, with strong data structures and algorithm fundamentals\n- Clear written communication: documentation, incident updates, short status notes\n- An awareness of security basics (authentication, SQL injection, secure coding)\n- A collaborative attitude: you ask for help early and share what you learn\nNice to have: SQL, Docker, AWS.' },
    { id: 'retail', title: 'Graduate Developer: retail platform', text:
      'Graduate Developer\nJoin our cross-functional team improving an online retail platform.\n\nResponsibilities\n- Build and maintain web features with JavaScript and TypeScript\n- Fix bugs reported by customers and support, using logs and debugging tools\n- Collaborate with designers and testers, taking part in stand-ups and pair programming\n- Keep documentation up to date and explain your work clearly to non-technical stakeholders\n- Estimate your work and break requirements into tasks (Jira, Scrum)\n\nRequirements\n- Programming fundamentals and problem solving\n- Familiarity with Git and version control, branching and merge conflicts\n- Good communication skills and a team player\nBonus: React, Node, PostgreSQL.' },
    { id: 'security', title: 'Associate Engineer: security-focused SaaS', text:
      'Associate Software Engineer (Security Platform)\nOur product helps companies protect user data, so security is part of every change we ship.\n\nWhat you will do\n- Write secure code and fix vulnerabilities (OWASP Top 10, SQL injection, XSS)\n- Review pull requests carefully and give kind, specific feedback during code review\n- Write automated tests (unit test and integration test) for every change\n- Use Git, GitLab and CI/CD pipelines\n- Troubleshoot incidents and take part in an on-call rota\n\nAbout you\n- Strong problem solving and logic, with Python or Java\n- Excellent written communication, including documentation\n- Comfortable working in a team and mentoring interns\nNice to have: Kubernetes, Linux, Terraform.' },
  ];

  /* common tools and languages that SkillBridge does not assess yet. Shown honestly so nobody thinks "100% ready" means "hired". */
  const TOOLS = ['sql', 'postgresql', 'mysql', 'mongodb', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'linux', 'react', 'angular', 'vue', 'node', 'django', 'flask', 'spring', 'graphql', 'rest api', 'redis', 'kafka', 'figma', 'tableau', 'excel', 'power bi', 'machine learning', 'swift', 'kotlin', 'php', 'ruby'];

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const count = (text, term) => { const m = text.match(new RegExp((/^[a-z0-9]/.test(term) ? '\\b' : '') + esc(term.trim()) + (/[a-z0-9]$/.test(term.trim()) && term.endsWith(' ') ? '\\b' : ''), 'g')); return m ? m.length : 0; };
  const EMPHASIS = /\b(required|requirements?|must|essential|strong|excellent|proven|you have)\b/;

  /* the requirement the ad sets for a skill, from how strongly it asks for it (60 to 85) */
  const requirementFor = (mentions, emphasised) => Math.min(85, 55 + 8 * Math.min(mentions, 3) + (emphasised ? 6 : 0));

  function analyse(text, role, levels, tasks, evidence) {
    const lower = String(text || '').toLowerCase();
    if (lower.replace(/\s+/g, ' ').trim().length < 40) return { error: 'Paste more of the job ad (at least a few lines) so there is something to analyse.' };
    const lines = lower.split(/\n+/);
    const found = [];
    role.skills.forEach(s => {
      let mentions = 0, emphasised = false;
      lines.forEach(line => { let c = 0; (s.jobHints || []).forEach(h => { c += count(line, h); }); if (c) { mentions += Math.min(c, 2); if (EMPHASIS.test(line)) emphasised = true; } });
      if (!mentions) return;
      const req = requirementFor(mentions, emphasised), level = (levels[s.id] || { level: 0 }).level;
      found.push({ skillId: s.id, name: s.name, mentions, requirement: req, level, gap: Math.max(0, req - level), met: level >= req });
    });
    found.sort((a, b) => b.mentions - a.mentions);
    const weight = f => Math.min(f.mentions, 4);
    const total = found.reduce((a, f) => a + weight(f), 0);
    const readiness = total ? Math.round(found.reduce((a, f) => a + weight(f) * Math.min(1, f.level / f.requirement), 0) / total * 100) : 0;

    /* what to practise next: tasks that test the biggest gaps this ad cares about */
    const gapOf = Object.fromEntries(found.map(f => [f.skillId, f.gap * weight(f)]));
    const done = new Set((evidence || []).map(e => e.taskId));
    const plan = tasks.filter(t => !done.has(t.id)).map(t => ({ task: t, gain: Object.entries(t.skills).reduce((a, [id, w]) => a + (gapOf[id] || 0) * w, 0) - t.difficulty })).filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 4);

    const notAssessed = TOOLS.filter(term => count(lower, term) > 0 && !found.some(f => (role.skills.find(s => s.id === f.skillId).jobHints || []).includes(term)));
    return { found, readiness, strengths: found.filter(f => f.met), gaps: found.filter(f => !f.met).sort((a, b) => b.gap * weight(b) - a.gap * weight(a)), plan: plan.map(x => x.task), planMinutes: plan.reduce((a, x) => a + x.task.minutes, 0), notAssessed: [...new Set(notAssessed)].slice(0, 10), skillIds: found.map(f => f.skillId) };
  }

  /* evidence ordered by how relevant it is to this ad (more matching skills and a higher score first) */
  function pack(result, evidence) {
    const wanted = new Set(result.skillIds || []);
    return evidence.map(e => ({ e, rel: Object.keys(e.skills).filter(id => wanted.has(id)).length })).filter(x => x.rel > 0).sort((a, b) => b.rel - a.rel || b.e.score - a.e.score).map(x => x.e);
  }
  return { analyse, pack, SAMPLES, TOOLS };
});
