'use strict';
/* Grading. Answers live only on the server: the browser receives tasks with the answers removed.
   Task types: mcq, scenario (multi-step decisions), code (hidden tests in a sandbox), written (rubric, AI or offline). */
const { runTests } = require('./sandbox');
const ai = require('./ai');

const PASS_MARK = 60;
const round = n => Math.round(n);
const words = text => (String(text).trim().match(/\S+/g) || []);

/* what the browser is allowed to see */
function publicTask(t) {
  const base = { id: t.id, role: t.role, type: t.type, difficulty: t.difficulty, minutes: t.minutes, title: t.title, skills: t.skills, from: t.from, brief: t.brief };
  if (t.generated) base.generated = true;
  if (t.mcq) base.mcq = { code: t.mcq.code, options: t.mcq.options };
  if (t.scenario) base.scenario = { steps: t.scenario.steps.map(s => ({ prompt: s.prompt, options: s.options })) };
  if (t.code) base.code = { fn: t.code.fn, starter: t.code.starter, samples: t.code.tests.filter(x => x.public).map(({ args, expect }) => ({ args, expect })), hiddenCount: t.code.tests.filter(x => !x.public).length };
  if (t.written) base.written = { code: t.written.code || '', prompt: t.written.prompt, minWords: t.written.minWords, rubric: t.written.rubric.map(r => ({ id: r.id, label: r.label, weight: r.weight })) };
  return base;
}

/* returns an error message if the answer shape is wrong */
function validate(task, answer) {
  if (!answer || typeof answer !== 'object') return 'Missing answer';
  if (task.type === 'mcq') return Number.isInteger(answer.choice) && answer.choice >= 0 && answer.choice < task.mcq.options.length ? null : 'Pick one option';
  if (task.type === 'scenario') return Array.isArray(answer.choices) && answer.choices.length === task.scenario.steps.length && answer.choices.every((c, i) => Number.isInteger(c) && c >= 0 && c < task.scenario.steps[i].options.length) ? null : 'Answer every step';
  if (task.type === 'code') return typeof answer.code === 'string' && answer.code.trim().length >= 10 && answer.code.length <= 20000 ? null : 'Write some code first (max 20,000 characters)';
  if (task.type === 'written') return typeof answer.text === 'string' && answer.text.trim().length >= 10 && answer.text.length <= 6000 ? null : 'Write your answer first (max 6,000 characters)';
  return 'Unknown task type';
}

/* offline rubric: each criterion has groups of keywords; score = share of groups hit */
function heuristicWritten(task, text) {
  const w = task.written, lower = String(text).toLowerCase(), n = words(text), unique = new Set(n.map(x => x.toLowerCase())).size;
  const rubric = w.rubric.map(r => {
    const hit = r.keywords.filter(group => group.some(k => lower.includes(k))).length, score = hit / r.keywords.length;
    return { id: r.id, label: r.label, weight: r.weight, score, comment: score >= 1 ? 'Covered.' : score > 0 ? 'Partly covered. Add more detail.' : 'Not found in your answer.' };
  });
  const notes = [];
  let penalty = 1;
  if (n.length < w.minWords) { penalty *= 0.8; notes.push('Add more detail (aim for at least ' + w.minWords + ' words).'); }
  if (n.length >= 15 && unique / n.length < 0.35) { penalty *= 0.4; notes.push('Your answer looks repetitive. Write in your own natural sentences.'); }
  const missing = rubric.filter(r => r.score < 1).map(r => r.label);
  const feedback = (missing.length ? 'To strengthen this: ' + missing.join('; ') + '. ' : 'Every point on the checklist is covered. ') + notes.join(' ') +
    ' (Automatic checklist review: it looks for key points, it cannot judge writing quality like a person.)';
  return { rubric, feedback: feedback.trim(), penalty };
}

async function grade(task, answer, deps = {}) {
  const err = validate(task, answer);
  if (err) return { error: err };

  if (task.type === 'mcq') {
    const ok = answer.choice === task.mcq.correct;
    return { score: ok ? 100 : 0, passed: ok, mode: 'auto', rubric: [{ id: 'answer', label: 'Chose the correct fix', weight: 1, score: ok ? 1 : 0, comment: task.mcq.explain[answer.choice] }], feedback: task.mcq.explain[answer.choice] + (ok ? '' : ' You can try again.') };
  }
  if (task.type === 'scenario') {
    const steps = task.scenario.steps.map((s, i) => ({ id: 'step' + (i + 1), label: s.prompt, weight: 1, score: s.scores[answer.choices[i]], comment: s.explain[answer.choices[i]] }));
    const score = round(steps.reduce((a, s) => a + s.score, 0) / steps.length * 100);
    return { score, passed: score >= PASS_MARK, mode: 'auto', rubric: steps, feedback: score >= PASS_MARK ? 'Good judgement. Read the notes on each step to see what else a senior colleague might do.' : 'Review the notes on each step and try again.' };
  }
  if (task.type === 'code') {
    const results = await (deps.runTests || runTests)({ code: answer.code, fn: task.code.fn, tests: task.code.tests.map(({ args, expect }) => ({ args, expect })) });
    const rubric = task.code.tests.map((t, i) => {
      const r = results[i] || results[0] || { ok: false, err: 'No result' };
      const label = t.public ? task.code.fn + '(' + t.args.map(a => JSON.stringify(a)).join(', ') + ') should be ' + JSON.stringify(t.expect) : 'Hidden test ' + (i + 1);
      return { id: 'test' + (i + 1), label, weight: 1, score: r.ok ? 1 : 0, comment: r.ok ? 'Passed.' : (r.err ? r.err : (t.public ? 'Got ' + JSON.stringify(r.got) : 'Did not pass.')) };
    });
    const score = round(rubric.reduce((a, r) => a + r.score, 0) / rubric.length * 100);
    let feedback = score === 100 ? 'All tests pass, including hidden edge cases.' : 'Some tests fail. Check the failing cases, especially empty and boundary inputs.';
    if (ai.enabled()) {   // the tests decide the score; the AI only adds a human-style review
      try { const note = await (deps.aiReview || ai.reviewCode)(task, answer.code, rubric.filter(r => r.score === 1).length, rubric.length); if (note) feedback += ' ' + note; } catch (e) { /* keep the plain feedback */ }
    }
    return { score, passed: score >= PASS_MARK, mode: 'auto', rubric, feedback };
  }
  if (task.type === 'written') {
    let rubric, feedback, mode = 'rubric', penalty = 1;
    if (ai.enabled() || deps.aiGrade) {
      try { const r = await (deps.aiGrade || ai.gradeWritten)(task, answer.text); rubric = r.rubric; feedback = r.feedback; mode = 'ai'; } catch (e) { /* fall back below */ }
    }
    // AI-written tasks have no keyword checklist, so without the AI grader they cannot be marked fairly: ask the student to retry
    if (!rubric && task.generated) return { error: 'The AI grader is not available right now. Your answer was not scored. Please try again in a moment.', status: 503 };
    if (!rubric) { const h = heuristicWritten(task, answer.text); rubric = h.rubric; feedback = h.feedback; penalty = h.penalty; }
    const total = rubric.reduce((a, r) => a + r.weight, 0);
    const score = round(rubric.reduce((a, r) => a + r.weight * r.score, 0) / total * 100 * penalty);
    return { score, passed: score >= PASS_MARK, mode, rubric, feedback };
  }
  return { error: 'Unknown task type' };
}

module.exports = { grade, publicTask, validate, heuristicWritten, PASS_MARK };
