'use strict';
/* Tiny .env reader (no dependency) so a key can live in a file instead of a terminal session.
   By default real environment variables win; the server passes { override: true } so the project's own .env beats a stale
   variable left in the machine's environment. Only used when the server is started directly. */
const fs = require('node:fs');

function load(file, { override = false } = {}) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return 0; }
  let n = 0;
  text.replace(/^﻿/, '').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if ((override || process.env[m[1]] === undefined) && v) { process.env[m[1]] = v; n++; }
  });
  return n;
}
module.exports = { load };
