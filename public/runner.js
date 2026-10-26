/* Runs a student's sample tests inside the browser (a Web Worker, so it works offline and can be stopped).
   The real, verified grading happens on the server with hidden tests. This is instant practice feedback only. */
self.onmessage = e => {
  const d = e.data;
  let res;
  try {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(d.fn)) throw new Error('Bad function name');
    const f = new Function(d.code + '\nreturn typeof ' + d.fn + ' === "function" ? ' + d.fn + ' : null;')();
    if (!f) throw new Error('Define a function named ' + d.fn);
    res = d.tests.map(t => {
      try { const out = f(...JSON.parse(JSON.stringify(t.args))); return { ok: JSON.stringify(out) === JSON.stringify(t.expect), got: out }; }
      catch (err) { return { ok: false, err: String(err && err.message || err) }; }
    });
  } catch (err) { res = [{ ok: false, err: String(err && err.message || err) }]; }
  self.postMessage(res);
};
