/* Canonical JSON: keys sorted, no whitespace, so the same record always produces the same bytes.
   The server signs these bytes and the browser verifies them, so both sides MUST use this exact function. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Canonical = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return canonical;
});
