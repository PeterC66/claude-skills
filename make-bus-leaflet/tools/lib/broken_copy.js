/*
 * broken_copy.js — write a deliberately broken copy of an engine script to the temp
 * folder, for a prove-red harness's last case, with its relative requires still
 * resolving.
 *
 * WHY. The harnesses break a copy of match_routes.js and require the fix case to
 * FAIL — and they count a throw as a failure. When match_routes.js grew its first
 * `require('./journey_drop')` (buses-data OA-452), every copy in the temp folder
 * threw on that line before reaching the lever, and prove-red-via-chain and
 * prove-red-edge-snap both went on printing PASS for case 5 without ever testing
 * it. So a copy rewrites each `require('./x')` to the original's own folder, and a
 * case 5 that throws is back to meaning the lever broke something.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function writeBrokenCopy(original, anchor, replacement, label) {
  const dir = path.dirname(original);
  const src = fs.readFileSync(original, 'utf8')
    .replace(/require\((['"])\.\/([^'"]+)\1\)/g, (m, q, rel) => 'require(' + JSON.stringify(path.join(dir, rel)) + ')');
  const out = path.join(os.tmpdir(), label + '_' + process.pid + '.js');
  fs.writeFileSync(out, src.replace(anchor, replacement));
  return out;
}

module.exports = { writeBrokenCopy };
