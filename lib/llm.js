'use strict';
/* One place that talks to a language model, so grading and task writing do not care which company is behind it.
   Provider: AI_PROVIDER=gemini|anthropic, otherwise whichever key is set (Anthropic first).
   Keys: GEMINI_API_KEY or ANTHROPIC_API_KEY (server-side only, never sent to the browser).
   Models: AI_MODEL (marking, quick) and AI_GEN_MODEL (writing tasks); each may be a comma-separated list. Gemini tries them in
   order and moves to the next on an overload (503), a withdrawn model (404) or a timeout, because Google's capacity is patchy. */
const DEFAULTS = {
  gemini: {   // chosen by timing real task prompts; Google retires and overloads models quickly, so override with AI_MODEL / AI_GEN_MODEL when needed
    mark: ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'],
    write: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'],
  },
  anthropic: { mark: ['claude-haiku-5-5'], write: ['claude-sonnet-5-5'] },
};

function provider() {
  const want = (process.env.AI_PROVIDER || '').toLowerCase();
  if (want === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (want === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}
const enabled = () => !!provider();
/* "AI HTTP 400: reason" so a misconfiguration is easy to diagnose; the key is never part of the message */
async function httpError(res) {
  let why = ''; try { const j = await res.json(); why = String((j.error && (j.error.message || j.error)) || '').replace(/\s+/g, ' ').slice(0, 200); } catch (e) { /* no body */ }
  return new Error('AI HTTP ' + res.status + (why ? ': ' + why : ''));
}
function models(purpose) {
  const p = provider(); if (!p) return [];
  const write = purpose === 'write', set = write ? process.env.AI_GEN_MODEL || (p === 'anthropic' && process.env.ANTHROPIC_GEN_MODEL) : process.env.AI_MODEL || (p === 'anthropic' && process.env.ANTHROPIC_MODEL);
  return set ? String(set).split(',').map(s => s.trim()).filter(Boolean) : DEFAULTS[p][write ? 'write' : 'mark'];
}
const model = purpose => models(purpose)[0] || null;
const retryable = e => /AI HTTP (404|429|500|502|503|504)|timeout|aborted|no candidates/i.test(e.message);

/* Send one system+user prompt, get plain text back. `json: true` asks the model for JSON where the provider supports it. */
async function complete({ system, user, maxTokens = 700, timeoutMs = 20000, json = false, purpose = 'mark', fetch: fetchImpl = fetch }) {
  const p = provider(); if (!p) throw new Error('AI is not configured');
  if (p === 'anthropic') {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model(purpose), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw await httpError(res);
    return ((await res.json()).content || []).map(b => b.text || '').join('');
  }
  // Gemini. Thinking models spend part of the output budget on reasoning, so leave generous headroom.
  let lastErr; const started = Date.now();
  for (const name of models(purpose)) {
    if (lastErr && Date.now() - started > timeoutMs * 2) break;   // overall budget: about two attempts, so a slow Google never stalls a student for minutes
    try {
      const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(name) + ':generateContent', {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens * 6, ...(json ? { responseMimeType: 'application/json' } : {}) },
        }),
      });
      if (!res.ok) throw await httpError(res);
      const j = await res.json(), cand = (j.candidates || [])[0];
      if (!cand) throw new Error('AI returned no candidates' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (' + j.promptFeedback.blockReason + ')' : ''));
      return ((cand.content && cand.content.parts) || []).filter(x => !x.thought).map(x => x.text || '').join('');
    } catch (e) { lastErr = e; if (!retryable(e)) throw e; }   // a bad key or a refused prompt will not improve with another model
  }
  throw lastErr;
}

module.exports = { enabled, provider, model, models, complete, DEFAULTS };
