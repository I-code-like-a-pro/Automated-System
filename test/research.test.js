'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../lib/research');
const llm = require('../lib/llm');

test('isPublicIp: private, loopback, metadata and reserved ranges are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip'])
    assert.equal(research.isPublicIp(ip), false, ip + ' must be refused');
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(research.isPublicIp(ip), true, ip + ' is public');
});

test('readPage refuses unsafe addresses before connecting', async () => {
  const never = async () => { throw new Error('must not connect'); };
  const deps = { request: never, lookup: async h => (h === 'evil.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '8.8.8.8', family: 4 }]) };
  for (const [u, why] of [['http://localhost/x', /public/], ['http://127.0.0.1/', /public/], ['http://169.254.169.254/latest/meta-data/', /public/], ['http://[::1]/', /public/], ['http://evil.example/', /public/],
    ['ftp://example.com/', /http/], ['file:///etc/passwd', /http/], ['http://example.com:8080/', /ports/], ['http://user:pw@example.com/', /login/], ['not a url', /valid/]])
    await assert.rejects(research.readPage(u, { ...deps, lookup: u.includes('localhost') ? async () => [{ address: '127.0.0.1', family: 4 }] : deps.lookup }), why, u);
});

test('readPage reads public pages, strips scripts, re-checks every redirect', async () => {
  const page = '<html><head><title>Compound   interest</title><script>alert(1)</script></head><body><nav>menu</nav><h1>Compound interest</h1><p>Interest earned on interest. A deposit of $1,000 at 5% grows to $1,628.89 after ten years, because each year\'s interest is added to the balance.</p><style>p{}</style></body></html>';
  const ok = await research.readPage('https://example.com/a', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(page) }) });
  assert.equal(ok.title, 'Compound interest'); assert.match(ok.text, /1,628\.89/); assert.ok(!/alert|menu|p\{\}/.test(ok.text));

  // a public page that redirects to a private address must be stopped at the second hop
  let hops = 0;
  const redirecting = { lookup: async h => (h === 'internal.example' ? [{ address: '192.168.0.9', family: 4 }] : [{ address: '8.8.8.8', family: 4 }]), request: async () => { hops++; return { status: 302, headers: { location: 'http://internal.example/admin' }, body: Buffer.alloc(0) }; } };
  await assert.rejects(research.readPage('https://example.com/r', redirecting), /public/); assert.equal(hops, 1, 'never connected to the private target');
  await assert.rejects(research.readPage('https://example.com/loop', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 302, headers: { location: '/loop' }, body: Buffer.alloc(0) }) }), /redirects/);
  await assert.rejects(research.readPage('https://example.com/b', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('x') }) }), /not readable/);
  await assert.rejects(research.readPage('https://example.com/c', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }) }), /404/);
});

test('readPage genuinely reads from a real socket when the address check is relaxed for localhost', async t => {
  // exercises the real pinned HTTP request code; the loopback address is allowed only here through an injected lookup override
  const http = require('node:http');
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Local</title><p>' + 'Photosynthesis turns light into chemical energy. '.repeat(6) + '</p>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); t.after(() => srv.close());
  const port = srv.address().port, pinned = require('../lib/research');
  // call the real request path by bypassing only the public-IP policy and the port policy
  const real = (url, ip, family, opts) => {
    const u = new URL(url.href); return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: u.pathname, headers: {} }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }).on('error', reject));
  };
  const out = await pinned.readPage('http://example.com/x', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: real });
  assert.match(out.text, /Photosynthesis/);
});

test('htmlToText keeps readable text only', () => {
  const r = research.htmlToText('<title>T</title><div>One &amp; two</div><script>x=1</script><ul><li>a</li><li>b</li></ul>');
  assert.equal(r.title, 'T'); assert.match(r.text, /One & two/); assert.match(r.text, /a\nb/); assert.ok(!r.text.includes('x=1'));
});

test('gather: model decides whether to search; results are cached; budget and fallbacks hold', async () => {
  research.clearCache();
  let calls = 0;
  const searched = async o => { calls++; assert.equal(o.search, true, 'asks the model to search only if needed'); assert.match(o.system, /ONLY when it is needed/); return { text: '- Compound interest: $1,000 at 5% for 10 years is $1,628.89 (Investor.gov).\n- Misconception: interest is not simple.', sources: [{ title: 'Investor.gov', url: 'https://www.investor.gov/x' }], searches: 1 }; };
  const a = await research.gather({ topic: 'Compound interest', focus: 'examples' }, { run: searched });
  assert.equal(a.via, 'web-search'); assert.equal(a.sources[0].title, 'Investor.gov'); assert.equal(a.cached, false);
  const b = await research.gather({ topic: ' compound   interest ', focus: 'EXAMPLES' }, { run: searched });
  assert.equal(b.cached, true); assert.equal(calls, 1, 'second ask for the same thing costs nothing');

  const timeless = await research.gather({ topic: 'Pythagorean theorem' }, { run: async () => ({ text: '- In a right triangle a squared plus b squared equals c squared. Example: 3-4-5 triangle.', sources: [], searches: 0 }) });
  assert.equal(timeless.via, 'knowledge', 'no search was needed, none was made');

  research.clearCache();
  let taken = 0; const budget = { take: () => ++taken <= 1 };
  assert.equal((await research.gather({ topic: 'topic one' }, { run: searched, budget })).via, 'web-search');
  const over = await research.gather({ topic: 'topic two' }, { run: searched, budget });
  assert.equal(over.via, 'none'); assert.match(over.skipped, /limit/);

  research.clearCache();
  const wiki = async () => ({ ok: true, json: async () => ({ query: { pages: { 1: { index: 1, title: 'Photosynthesis', extract: 'Photosynthesis is a process used by plants to convert light energy into chemical energy.', fullurl: 'https://en.wikipedia.org/wiki/Photosynthesis' } } } }) });
  const fb = await research.gather({ topic: 'Photosynthesis' }, { run: async () => { throw new Error('AI HTTP 503'); }, fetch: wiki });
  assert.equal(fb.via, 'wikipedia'); assert.equal(fb.sources[0].url, 'https://en.wikipedia.org/wiki/Photosynthesis'); assert.match(fb.notes, /chemical energy/);

  research.clearCache();
  const none = await research.gather({ topic: 'x1' }, { run: async () => { throw new Error('down'); }, fetch: async () => { throw new Error('offline'); } });
  assert.equal(none.via, 'none'); assert.equal(none.notes, '', 'research failure never blocks the course');
  assert.deepEqual(await research.gather({ topic: '' }, {}), { notes: '', sources: [], via: 'none', cached: false });
});

test('wikipedia fallback drops hits that are not about the topic', async () => {
  const pages = { 1: { index: 1, title: 'Meditation', extract: 'Meditation is a practice in which an individual uses a technique to train attention and awareness.', fullurl: 'https://en.wikipedia.org/wiki/Meditation' },
    2: { index: 2, title: 'Therapeutic communication', extract: 'Therapeutic communication is a form of nurse and patient interaction used in nursing care.', fullurl: 'https://en.wikipedia.org/wiki/Therapeutic_communication' },
    3: { index: 3, title: 'Hospital', extract: 'A hospital is a health care institution providing patient treatment with specialized staff, including nursing care.', fullurl: 'https://en.wikipedia.org/wiki/Hospital' },
    4: { index: 4, title: 'List of Latin phrases', extract: 'This page lists direct English translations of common Latin phrases.', fullurl: 'https://en.wikipedia.org/wiki/List_of_Latin_phrases' } };
  const f = async () => ({ ok: true, json: async () => ({ query: { pages } }) });
  const w = await research.wikipedia('Introduction to Nursing: patient communication', { fetch: f });
  assert.deepEqual(w.sources.map(s => s.title), ['Therapeutic communication (Wikipedia)', 'Hospital (Wikipedia)'], 'only pages about nursing / patient communication are kept');
  const none = await research.wikipedia('Quantum cooking', { fetch: f });
  assert.equal(none.sources.length, 0); assert.equal(none.notes, '', 'better no sources than wrong ones');
  research.clearCache();
  const g = await research.gather({ topic: 'Quantum cooking' }, { run: async () => { throw new Error('down'); }, fetch: f });
  assert.equal(g.via, 'none');
});

test('llm.run: reports the sources Gemini and Claude used for a search', async t => {
  const keep = { ...process.env }; t.after(() => { for (const k of ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } });
  for (const k of ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) delete process.env[k];

  process.env.GEMINI_API_KEY = 'AQ.test'; let sent;
  const gem = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'notes' }] }, groundingMetadata: { webSearchQueries: ['q1', 'q2'], groundingChunks: [{ web: { uri: 'https://a.example/x', title: 'a.example' } }, { web: { uri: 'https://a.example/x', title: 'dup' } }, { web: { uri: 'javascript:alert(1)', title: 'bad' } }, { web: { uri: 'https://b.example/y' } }] } }] }) }; };
  const g = await llm.run({ system: 's', user: 'u', search: true, json: true, fetch: gem });
  assert.deepEqual(sent.tools, [{ google_search: {} }]); assert.ok(!sent.generationConfig.responseMimeType, 'JSON mode cannot be combined with search on Gemini');
  assert.equal(g.searches, 2); assert.deepEqual(g.sources.map(s => s.url), ['https://a.example/x', 'https://b.example/y']); assert.equal(g.sources[1].title, 'b.example');

  delete process.env.GEMINI_API_KEY; process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const claude = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: 'https://c.example/z', title: 'C' }] }, { type: 'text', text: 'answer', citations: [{ url: 'https://d.example/q', title: 'D' }] }] }) }; };
  const c = await llm.run({ system: 's', user: 'u', search: true, fetch: claude });
  assert.equal(sent.tools[0].type, 'web_search_20250305'); assert.equal(c.text, 'answer'); assert.equal(c.searches, 1); assert.deepEqual(c.sources.map(s => s.url), ['https://c.example/z', 'https://d.example/q']);
  const plain = await llm.run({ system: 's', user: 'u', fetch: async () => ({ ok: true, json: async () => ({ content: [{ text: 'old style' }] }) }) });
  assert.equal(plain.text, 'old style'); assert.deepEqual(plain.sources, []);
});
