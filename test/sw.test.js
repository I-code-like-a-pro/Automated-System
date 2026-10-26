'use strict';
/* The service worker cannot be exercised in every test browser, so its logic is tested here against a small simulated
   worker environment (fake caches, fake network that can go offline). It checks the promises the app makes about offline use. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeWorker() {
  const handlers = {}, store = new Map();                 // cacheName -> Map(url -> Response)
  const net = { online: true, calls: [], files: {} };
  const key = r => (typeof r === 'string' ? new URL(r, 'http://app.test').href : r.url);
  const cacheApi = {
    open: async name => { if (!store.has(name)) store.set(name, new Map()); const m = store.get(name);
      return { put: async (req, res) => { m.set(key(req), res); }, addAll: async urls => { for (const u of urls) { const res = await fetchImpl(new Request(new URL(u, 'http://app.test').href)); m.set(key(u), res); } }, match: async req => m.get(key(req)), keys: async () => [...m.keys()].map(u => new Request(u)) }; },
    match: async req => { for (const m of store.values()) if (m.has(key(req))) return m.get(key(req)).clone(); return undefined; },
    keys: async () => [...store.keys()], delete: async n => store.delete(n),
  };
  async function fetchImpl(req) {
    net.calls.push(new URL(req.url).pathname);
    if (!net.online) throw new TypeError('network down');
    const p = new URL(req.url).pathname, body = net.files[p];
    if (body == null) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200 });
  }
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} }, location: { origin: 'http://app.test' } };
  const ctx = vm.createContext({ self, caches: cacheApi, fetch: fetchImpl, Request, Response, URL, Promise, location: self.location, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), ctx);
  const run = async (type, extra = {}) => { let pending = Promise.resolve(), responded; handlers[type]({ waitUntil: p => { pending = p; }, respondWith: p => { responded = p; }, ...extra }); await pending; return responded ? await responded : undefined; };
  /* returns undefined when the worker ignores the request (the browser then uses the network directly) */
  const get = async (urlPath, mode) => { const request = Object.assign(new Request('http://app.test' + urlPath), {}); Object.defineProperty(request, 'mode', { value: mode || 'cors' }); let responded = false, res;
    handlers.fetch({ request, respondWith: p => { responded = true; res = p; } }); return responded ? await res : undefined; };
  return { net, store, run, get, handlers, shellFiles: () => Object.fromEntries(['/', '/index.html', '/style.css', '/app.js', '/skills.js', '/canonical.js', '/verifier.js', '/localdb.js', '/jobmatch.js', '/share.js', '/runner.js', '/manifest.webmanifest', '/icon.svg'].map(f => [f, 'file:' + f])) };
}

test('install caches the whole app shell so the app opens offline', async () => {
  const w = makeWorker(); Object.assign(w.net.files, w.shellFiles());
  await w.run('install');
  const names = [...w.store.keys()]; assert.equal(names.length, 1);
  const cached = [...w.store.get(names[0]).keys()].map(u => new URL(u).pathname);
  ['/index.html', '/app.js', '/localdb.js', '/verifier.js', '/jobmatch.js', '/runner.js', '/style.css'].forEach(f => assert.ok(cached.includes(f), f + ' is cached'));
});

test('every script the page loads is in the offline shell', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  [...html.matchAll(/src="(\/[^"]+)"/g)].map(m => m[1]).forEach(src => assert.ok(sw.includes("'" + src + "'"), src + ' must be listed in sw.js SHELL, or the app breaks offline'));
});

test('tasks, roles and the public key keep working offline (network first, cache as fallback)', async () => {
  const w = makeWorker(); Object.assign(w.net.files, { '/api/tasks': '[{"id":"t1"}]', '/api/roles': '{}', '/api/keys': '{"keys":[]}' });
  for (const u of ['/api/tasks', '/api/roles', '/api/keys']) assert.equal(await (await w.get(u)).text(), w.net.files[u], 'online: from the network');
  w.net.online = false;
  for (const u of ['/api/tasks', '/api/roles', '/api/keys']) assert.equal(await (await w.get(u)).text(), w.net.files[u], u + ' offline: from the cache');
  w.net.files['/api/tasks'] = '[{"id":"t2"}]'; w.net.online = true;
  assert.equal(await (await w.get('/api/tasks')).text(), '[{"id":"t2"}]', 'back online: fresh content wins');
});

test('personal and write requests are never cached or intercepted', async () => {
  const w = makeWorker(); Object.assign(w.net.files, { '/api/mine': 'secret', '/api/verify/ev_1': 'x', '/api/cohort/UNI-1': 'x', '/api/portfolio/abc': 'x' });
  for (const u of ['/api/mine', '/api/verify/ev_1', '/api/cohort/UNI-1', '/api/portfolio/abc', '/api/submit']) assert.equal(await w.get(u), undefined, u + ' is left to the network');
  const post = new Request('http://app.test/api/tasks', { method: 'POST' }); let touched = false; w.handlers.fetch({ request: post, respondWith: () => { touched = true; } });
  assert.equal(touched, false, 'POST is never intercepted');
  assert.equal([...w.store.values()].reduce((n, m) => n + m.size, 0), 0, 'nothing personal ended up in the cache');
});

test('app routes like /verify/ev_123 open the cached shell when offline', async () => {
  const w = makeWorker(); Object.assign(w.net.files, w.shellFiles()); await w.run('install'); w.net.online = false;
  const res = await w.get('/verify/ev_123', 'navigate'); assert.equal(await res.text(), 'file:/index.html');
  assert.equal(await (await w.get('/p/abc', 'navigate')).text(), 'file:/index.html');
});

test('static files load from the cache instantly and refresh in the background', async () => {
  const w = makeWorker(); Object.assign(w.net.files, w.shellFiles()); await w.run('install');
  w.net.files['/app.js'] = 'file:/app.js v2';
  assert.equal(await (await w.get('/app.js')).text(), 'file:/app.js', 'cached copy is served at once');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(await (await w.get('/app.js')).text(), 'file:/app.js v2', 'the refreshed copy is used next time');
  w.net.online = false; assert.equal(await (await w.get('/style.css')).text(), 'file:/style.css', 'works fully offline');
});

test('activating a new version removes old caches', async () => {
  const w = makeWorker(); await w.run('install').catch(() => {}); const stale = await (async () => { const c = await w.store; c.set('sb-v0', new Map()); return 'sb-v0'; })();
  await w.run('activate'); assert.ok(!w.store.has(stale), 'old cache deleted');
});
