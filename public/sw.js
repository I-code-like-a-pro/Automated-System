/* Service worker: makes SkillBridge usable on slow, expensive or missing connections.
   - the app shell is cached on first load, so it opens instantly and offline
   - tasks and the skills framework are cached, so you can keep practising offline
   - API calls for your account and submissions always go to the network (answers are queued by the app when offline) */
const VERSION = 'sb-v6';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/skills.js', '/canonical.js', '/verifier.js', '/localdb.js', '/jobmatch.js', '/share.js', '/runner.js', '/manifest.webmanifest', '/icon.svg'];
const CACHEABLE_API = ['/api/tasks', '/api/roles', '/api/keys'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!CACHEABLE_API.includes(url.pathname)) return;                       // account data is never served from cache
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
    return;
  }
  if (req.mode === 'navigate') {                                              // app routes like /verify/ev_123 all open the same shell
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {                               // stale-while-revalidate for static files
    const net = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
