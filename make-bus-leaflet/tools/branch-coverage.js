#!/usr/bin/env node
/*
 * branch-coverage.js — which branches of a module do the committed maps
 * actually take? Answered by INSTRUMENTING the module and running every map,
 * not by reading their config.
 *
 *   node tools/branch-coverage.js <spec.js>
 *
 * Run from `make-bus-leaflet/`. `<spec.js>` is a small file you write per
 * module (see the shape below); `--buses` overrides the data tree; there are no
 * other parameters. Nothing under `assets/` is touched — the whole engine is
 * copied to a scratch directory and the copy is instrumented.
 *
 * THE SPEC. A CommonJS module exporting:
 *
 *   module.exports = {
 *     module: 'linear_features.js',    // the file under assets/ to instrument
 *     generator: 'gen_internal.js',    // the entry point to run per map
 *     sheet: 'internal.svg',           // only run maps whose S4 holds this
 *     marks: [
 *       // Each `find` must appear EXACTLY ONCE in the module, or the run
 *       // aborts. `insert` is JavaScript spliced in immediately BEFORE it, and
 *       // calls _hit('<label>') for each branch you want counted.
 *       { find: "    if(featOv(f).hide) return;",
 *         insert: "    _hit(featOv(f).hide ? 'drawFeature: HIDDEN' : 'drawFeature: drawn');" },
 *     ],
 *     labels: ['drawFeature: HIDDEN', 'drawFeature: drawn'],   // reported in this order
 *   };
 *
 * WHY NOT JUST READ THE CONFIG. Because that was tried first, on 2026-08-27,
 * and it was wrong by seven maps. Counting `routes.json` said no map exercised
 * the linear-feature `hide` override; instrumenting said seven do, because a
 * town with no `features[]` still gets a river from the legacy fallback, so a
 * `hide` for a feature nobody declared is not the no-op it looks like. A
 * default, a fallback or a derived value sitting between the file and the
 * branch is exactly where a config-reading count goes wrong — and that is
 * exactly where the interesting branches live.
 *
 * WHAT THE ANSWER IS FOR. Coverage after an extraction is wildly uneven, and
 * the uneven part is not guessable from reading the code. Put the unit tests
 * where the count is ZERO or ONE; where every map takes the branch, the byte
 * gate has it covered and a test only repeats it — write one there only for
 * what the maps cannot express (ordering, precedence, a round trip).
 *
 * ANCHOR A MARK ON THE BRANCH'S OWN LINE, NOT ON THE STATEMENT AFTER IT. The
 * `insert` is spliced in immediately BEFORE the `find`, so a mark anchored on the
 * next statement runs only when control reaches that statement — and if the
 * branch you are counting `return`s, `continue`s or throws, it never does. That
 * mark then reports ZERO whatever the maps do, which is indistinguishable from a
 * genuinely dark branch and reads as a finished answer. It has cost three specs
 * on 2026-08-27 alone: three of feature_labels.js's guard refusals were anchored
 * on the NEXT guard's `if`, past the `return` they were meant to observe, and
 * label_placer.js's v2 mark sat after the `if(LAB){ … return true; }` block, so
 * the branch EVERY map takes reported zero. The tell is a row that is dark when
 * you would expect it to be universal — but the reverse case, a fault path that
 * is dark for a good reason, has no tell at all. Anchor on the `if`.
 *
 * IT NORMALISES LINE ENDINGS BEFORE MATCHING, and that is not housekeeping: an
 * extracted module can be genuinely mixed on disk (an LF header written by the
 * extraction script over a CRLF body moved out of the generator), and matching
 * against the wrong ending makes EVERY mark miss silently — which reads as
 * "every branch is dark" rather than as a broken probe.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SK = path.join(__dirname, '..');
const A = path.join(SK, 'assets');
const GL = require(path.join(A, 'gate_lib.js'));
const { scratchDir } = require('../assets/scratch');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BUSES = arg('buses', 'C:/u3a St Ives/Using AI/Buses');

const specPath = process.argv[2];
if (!specPath || specPath.startsWith('--')) {
  console.error('usage: branch-coverage.js <spec.js>   (see the header for the spec shape)');
  process.exit(2);
}
const spec = require(path.resolve(specPath));
for (const k of ['module', 'generator', 'marks', 'labels']) {
  if (!spec[k]) { console.error(`spec is missing "${k}"`); process.exit(2); }
}
const SHEET = spec.sheet || 'internal.svg';

const tmp = scratchDir('branchcov-');
try {
  fs.cpSync(A, tmp, { recursive: true });
  const HITS = path.join(tmp, 'hits.log').split(path.sep).join('/');
  const P = path.join(tmp, spec.module);
  if (!fs.existsSync(P)) { console.error(`no such module in assets/: ${spec.module}`); process.exit(2); }

  // Normalise before matching — see the header.
  let s = fs.readFileSync(P, 'utf8').replace(/\r\n/g, '\n');
  const HIT = `const _hit=(k)=>{try{require('fs').appendFileSync(${JSON.stringify(HITS)},k+'\\n');}catch(e){}};\n`;
  if (s.split("'use strict';\n").length !== 2) {
    console.error(`${spec.module} has no unique "'use strict';" line to hang the counter on.`);
    process.exit(2);
  }
  s = s.replace("'use strict';\n", "'use strict';\n" + HIT);

  for (const { find, insert } of spec.marks) {
    const n = s.split(find).length - 1;
    if (n !== 1) { console.error(`mark anchor appears ${n} times, needs exactly 1:\n  ${find}`); process.exit(2); }
    s = s.replace(find, insert + '\n' + find);
  }
  fs.writeFileSync(P, s);
  execFileSync(process.execPath, ['-c', P]);   // refuse to run instrumented code that will not parse

  const towns = GL.findTowns(BUSES);
  const places = GL.findPlaces(towns, BUSES);
  const maps = [
    ...towns.map((t) => ({ n: t.name, d: t.dir })),
    ...places.map((p) => ({ n: `${p.town || '(standalone)'}/${p.name}`, d: p.dir })),
  ];

  const perMap = {};
  for (const m of maps) {
    let mani;
    try { mani = JSON.parse(fs.readFileSync(path.join(m.d, 'manifest.json'), 'utf8')); } catch (e) { continue; }
    const s4 = GL.latestRunDir(mani, m.d, 'S4');
    if (!s4 || !fs.existsSync(path.join(s4.dir, SHEET))) continue;
    try { fs.unlinkSync(HITS); } catch (e) {}
    const r = GL.runGenerator(path.join(tmp, spec.generator), s4.dir, { extraEnv: { SKILL_ASSETS: tmp } });
    GL.rmTmp(r.tmpDir);
    const hits = fs.existsSync(HITS) ? fs.readFileSync(HITS, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
    perMap[m.n] = {};
    for (const h of hits) perMap[m.n][h] = (perMap[m.n][h] || 0) + 1;
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  const all = {};
  for (const [name, hs] of Object.entries(perMap)) {
    for (const k of Object.keys(hs)) (all[k] = all[k] || []).push(`${name}(${hs[k]})`);
  }
  console.log(`${Object.keys(perMap).length} maps run against ${spec.module}\n`);
  let dark = 0;
  for (const k of spec.labels) {
    const who = all[k] || [];
    if (!who.length) dark++;
    console.log(String(who.length).padStart(3) + '  ' + k.padEnd(46)
      + (who.length ? who.slice(0, 6).join(' ') + (who.length > 6 ? ' …' : '') : '*** DARK — no committed map takes this ***'));
  }
  const unlisted = Object.keys(all).filter((k) => !spec.labels.includes(k));
  if (unlisted.length) console.log(`\n(labels the spec did not list: ${unlisted.join(', ')})`);
  // Every label dark means the probe missed, not that the module is unreachable
  // — the same uniform-failure tell as a checker that cannot say "no answer".
  if (dark === spec.labels.length) {
    console.log('\n⚠ EVERY label is dark. Suspect the probe before the module: check the anchors match, and that the generator actually loads this copy.');
    process.exit(1);
  }
  console.log(`\n${dark} of ${spec.labels.length} labelled branches are dark — that is where the unit tests belong.`);
} finally {
  GL.rmTmp(tmp);
}
