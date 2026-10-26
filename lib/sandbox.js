'use strict';
/* Runs a student's code against tests in an isolated worker thread + a fresh vm context.
   - the context has no Node globals (no require, process, fs, network)
   - each call has a CPU timeout, and the whole worker is terminated after a hard limit
   - the worker has a memory cap
   NOTE: node:vm is not a hardened security boundary. For a public deployment run this inside a container or
   a separate low-privilege service. This is acceptable for a pilot where students run only their own code. */
const { Worker } = require('node:worker_threads');

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { code, fn, tests } = workerData;
const out = [];
try {
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code, ctx, { timeout: 1000 });
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fn)) throw new Error('Bad function name');
  if (vm.runInContext('typeof ' + fn, ctx) !== 'function') throw new Error('Define a function named ' + fn);
  for (const t of tests) {
    try {
      ctx.__args = JSON.stringify(t.args);
      const raw = vm.runInContext('JSON.stringify(' + fn + '.apply(null, JSON.parse(__args)))', ctx, { timeout: 1000 });
      const got = raw === undefined ? undefined : JSON.parse(raw);
      out.push({ ok: JSON.stringify(got) === JSON.stringify(t.expect), got });
    } catch (err) { out.push({ ok: false, err: String(err && err.message || err) }); }
  }
} catch (err) { out.length = 0; out.push({ ok: false, err: String(err && err.message || err) }); }
parentPort.postMessage(out);
`;

function runTests({ code, fn, tests, timeoutMs = 4000 }) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); worker.terminate(); resolve(r); } };
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { code: String(code).slice(0, 20000), fn, tests }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
    const timer = setTimeout(() => finish([{ ok: false, err: 'Your code took too long. Is there an endless loop?' }]), timeoutMs);
    worker.on('message', finish);
    worker.on('error', e => finish([{ ok: false, err: String(e && e.message || e) }]));
  });
}
module.exports = { runTests };
