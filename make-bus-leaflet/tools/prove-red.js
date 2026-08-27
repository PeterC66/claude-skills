#!/usr/bin/env node
/*
 * prove-red.js — break the engine on purpose, and check the tests notice.
 *
 * WHY THIS FILE EXISTS. "A green check that has never been seen to go red proves
 * nothing" is written into this project's own memory, and it has been paid for
 * more than once: a drift gate that could not run for six weeks, a verify job
 * blind to its own fixture, a board that printed every row correctly and exited
 * 127. A brand-new test suite is exactly the thing that looks like proof and is
 * not. So the suite ships with the falsification alongside it.
 *
 * WHAT IT DOES. Copies assets/ to a scratch directory, then for each mutation
 * below: applies one deliberate edit, runs one test file against the mutated
 * copy (via ENGINE_DIR — see test/_engine.js), and expects that run to FAIL.
 * A mutation the suite does not notice is reported as SURVIVED and exits 1.
 *
 * Nothing under assets/ is touched. Every file there is vendored into the portal
 * and compared by status.js, so an edit in place would surface as portal drift.
 *
 * Run it from make-bus-leaflet:
 *     npm run test:prove-red
 *     node tools/prove-red.js --keep      leave the scratch copy for inspection
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const KEEP = process.argv.includes('--keep');

/* Each mutation names the file it breaks, the exact text it replaces, what it
 * replaces it with, and the test file that is supposed to object. `find` must
 * appear exactly once in the file — an anchor that matches twice or not at all
 * is a mutation that did not do what it says, which would report a false green
 * just as loudly as the bug it is hunting. */
const MUTATIONS = [
  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'the sheet-version stamp goes back to counting as a lost label',
    find: '  /^(Valid from .*|Map v[\\d.]+(?: · .*)?|Map version v?[\\d.]+|(?:build|Draft|Preview) v?[\\d.]+(?: · .*)?)$/;',
    to: '  /^(Valid from .*|Map v[\\d.]+(?: · .*)?)$/;' },

  // lane_normals.js - four of these six are repairs that were actually tried
  // and measured on the board before the right one was found, so a suite that
  // survives them is a suite that would have let the wrong fix through.
  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'a corridor forgets that two lines can face opposite ways',
    find: '  if (Math.abs(a.ux * b.ux + a.uy * b.uy) < cosAngle) return false;',
    to: '  if ((a.ux * b.ux + a.uy * b.uy) < cosAngle) return false;' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'chain edges go back to walking array positions, and vanish when routes interleave',
    find: '  for (const idx of byRoute.values()) {',
    to: '  for (const idx of [Array.from(segs.keys())]) {' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'a chain edge is allowed to close a cycle and contradict the lateral structure',
    find: '    if (find(i).root === find(j).root) continue;      // bridges only, never a cycle',
    to: '    if (false) continue;      // bridges only, never a cycle' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'components stop being anchored, so a clean corridor can come out mirrored',
    find: '    if (!anchorParity.has(f.root)) anchorParity.set(f.root, f.parity);',
    to: '    if (!anchorParity.has(f.root)) anchorParity.set(f.root, 1);' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'the key-off path starts applying an orientation it was never given',
    find: '    const sg = (sign && bSeg >= 0) ? (sign[bSeg] || 1) : 1;',
    to: '    const sg = (bSeg >= 0 && sign) ? (sign[bSeg] || 1) : -1;' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'an unorientable corridor reports itself as clean',
    find: "    if (union(i, j, rel(segs[i], segs[j])) === 'conflict') conflicts++;",
    to: '    union(i, j, rel(segs[i], segs[j]));' },

  { suite: 'font_metrics.test.js', file: 'font_metrics.js',
    what: 'an unmapped glyph costs nothing',
    find: 'const FALLBACK = 0.556;', to: 'const FALLBACK = 0;' },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'ink drawn off the page is only a WARN again',
    find: "const OVERFLOWED = /\\bunder the footer plate\\b|\\btoo long for this panel\\b|\\bpast the frame edge\\b/i;",
    to: 'const OVERFLOWED = /$^/;' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'the label floor stops being checked',
    find: 'if (now.labels < was.labels)', to: 'if (false && now.labels < was.labels)' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'an unknown drop count is read as zero',
    find: 'if (now.drop !== null && was.drop !== null && now.drop < was.drop)',
    to: 'if ((now.drop || 0) < (was.drop || 0))' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'a board-wide total sums an uncounted sheet as zero',
    find: 'if (v === null || v === undefined) unknown += 1; else total += v;',
    to: 'total += (v || 0);' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'a deadline that has gone by takes the target with it',
    find: 'const next = sorted.find(m => m.by >= today) || sorted[sorted.length - 1];',
    to: 'const next = sorted.find(m => m.by >= today) || sorted[0];' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: '--accept discards the target on the run that moved towards it',
    find: '  if (prev.targets) out.targets = prev.targets;',
    to: '  if (false) out.targets = prev.targets;' },

  { suite: 'labeller.test.js', file: 'labeller.js',
    what: 'mustPlace loses its second, relaxed pass',
    find: 'for (const relax of (it.mustPlace ? [false, true] : [false]))',
    to: 'for (const relax of [false])' },

  { suite: 'labeller.test.js', file: 'labeller.js',
    what: 'a label may be placed over one already placed',
    find: 'if (boxesHit(b, pb.b)) return null;', to: 'if (false) return null;' },

  { suite: 'footer.test.js', file: 'footer.js',
    what: 'the note wraps to the full band again, under the right-hand block',
    find: 'const NOTE_GUTTER = 6;', to: 'const NOTE_GUTTER = -80;' },

  { suite: 'geometry.test.js', file: 'quality_metrics.js',
    what: 'middle-anchored text is measured from its left edge',
    find: "const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;",
    to: 'const x0 = t.x;' },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'the file NAME drops out of the engine hash',
    find: "h.update(name + '\\0');", to: 'h.update("");' },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'line endings are compared literally',
    find: "const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\\r\\n/g, '\\n');",
    to: "const norm = (p) => fs.readFileSync(p, 'utf8');" },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'a file that cannot be read reports "different" instead of "cannot compare"',
    find: 'if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return null; // can\'t compare',
    to: 'if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return false;' },

  { suite: 'icons.test.js', file: 'icons.js',
    what: 'a pale backing plate is recoloured charcoal',
    find: "if (lum > 0.75) return `${k}=\"#ffffff\"`;", to: 'if (false) return k;' },

  // quality_metrics.js - the first of these three IS the bug of 2026-08-27,
  // restored exactly. It shipped for eleven days, hid 14 sheets' worth of
  // honest zeroes behind the word UNKNOWN, and no test in this folder objected
  // because no test in this folder read a sidecar.
  { suite: 'quality_metrics.test.js', file: 'quality_metrics.js',
    what: 'an absent sidecar reads as UNKNOWN again on every sheet but the internal one',
    find: '    } else unplaced = [];      // every writer unlinks its sidecar when nothing dropped',
    to: "    } else if (base === 'internal') unplaced = [];" },

  { suite: 'quality_metrics.test.js', file: 'quality_metrics.js',
    what: 'the schematic goes back to having no sidecar of its own',
    find: "    'internal-schematic': 'unplaced-schematic.json',",
    to: '' },

  { suite: 'quality_metrics.test.js', file: 'quality_metrics.js',
    what: 'a corrupt sidecar is filed under the same word as a sheet type nobody reports',
    find: "    if (unplaced === null) dropState = 'unreadable';   // the file was there and would not parse",
    to: "    if (unplaced === null) dropState = 'no-reporter';" },
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-'));
const engine = path.join(scratch, 'assets');
fs.cpSync(ASSETS, engine, { recursive: true });

const runSuite = (suite) => spawnSync(process.execPath, ['--test', path.join(SK, 'test', suite)],
  { cwd: SK, env: { ...process.env, ENGINE_DIR: engine }, encoding: 'utf8' });

let survived = 0, broken = 0;
const rows = [];

// A baseline first: the copied engine, unmutated, must be green. Otherwise every
// "the suite noticed" below could be the copy failing rather than the mutation.
const suites = [...new Set(MUTATIONS.map(m => m.suite))];
for (const suite of suites) {
  const r = runSuite(suite);
  if (r.status !== 0) {
    console.error(`BASELINE FAILED: ${suite} is red against an unmutated copy of the engine.`);
    console.error(r.stdout || r.stderr);
    process.exitCode = 1;
  }
}
if (process.exitCode === 1) { if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true }); return; }

for (const m of MUTATIONS) {
  const p = path.join(engine, m.file);
  const original = fs.readFileSync(p, 'utf8');
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) {
    rows.push(['ANCHOR', m.file, m.what, `the text to replace appears ${hits} times, not once`]);
    broken++;
    continue;
  }
  fs.writeFileSync(p, original.replace(m.find, m.to));
  const r = runSuite(m.suite);
  fs.writeFileSync(p, original);
  if (r.status === 0) {
    rows.push(['SURVIVED', m.file, m.what, `${m.suite} stayed green`]);
    survived++;
  } else {
    const first = (r.stdout.match(/^✖ (.+?) \(/m) || [, '(a test)'])[1];
    rows.push(['caught', m.file, m.what, `${m.suite}: ${first}`]);
  }
}

const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('\nMutation testing — one deliberate break at a time, against a scratch copy of assets/\n');
console.log(w('verdict', 9) + w('file', 22) + w('what was broken', 52) + 'which test objected');
console.log('-'.repeat(140));
for (const [v, f, what, detail] of rows) console.log(w(v, 9) + w(f, 22) + w(what, 52) + detail);
console.log('-'.repeat(140));
console.log(`${rows.length} mutations, ${rows.length - survived - broken} caught, ${survived} survived, ${broken} anchors stale.\n`);
if (survived || broken) {
  console.log('A mutation that SURVIVED is a hole in the suite: the engine did something wrong and');
  console.log('nothing said so. A stale ANCHOR means this file has drifted from the engine it edits.');
}
if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true });
else console.log('scratch copy left at ' + scratch);
process.exitCode = (survived || broken) ? 1 : 0;
