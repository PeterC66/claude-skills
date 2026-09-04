#!/usr/bin/env node
/*
 * prove-red-schematic-crossings.js — break the self-crossing detector on
 * purpose, and check its suite notices (buses-data OA-240, 2026-09-04).
 *
 * Run it from make-bus-leaflet:
 *     npm run test:prove-red-schematic-crossings
 *     node tools/prove-red-schematic-crossings.js --keep    keep the scratch copy
 *
 * There are no other arguments and no placeholders.
 *
 * WHY THIS FILE RATHER THAN A BLOCK IN prove-red.js. Nothing but the shared
 * checkout: `tools/prove-red.js` is edited by more than one session at a time on
 * this laptop, and this repository's own rule is to stage by name and commit by
 * pathspec, which takes the WORKING TREE content of the paths it names. Adding
 * mutations to a file a neighbour is mid-edit in is how another session's change
 * rides into a commit describing none of it. A per-subject harness is also the
 * idiom here — there are twenty of them beside this one.
 *
 * WHAT IS BEING FALSIFIED, and why a crossing detector needs falsifying at all.
 * The easy half — does it find an X — is the half that was never in doubt: the
 * detector found the reported Wisbech fault on its first run. The three ways it
 * could be quietly useless are each a way of answering a slightly different
 * question and looking exactly like an answer to the right one:
 *
 *   - report the schematic's crossings instead of the DIFFERENCE, and every real
 *     flyover in the town is charged to the schematizer;
 *   - measure the separation on the schematic instead of the ground, and every
 *     finding scores zero, because at a crossing the two strands meet;
 *   - drop the clustering, and one X reads as thirty-one findings.
 *
 * None of the three shows up as an error. All three produce a full-looking
 * report. So each is broken here on purpose and the suite has to object.
 *
 * AND ONE MUTATION THAT MUST NOT BE CAUGHT. `equivalent: true` marks an edit
 * that changes the source and cannot change any answer — reordering the four
 * arguments of a `Math.min`. A suite that reddens on it is pinning the shape of
 * the code rather than its behaviour, and would fight every future refactor for
 * no gain. Falsifying in both directions is this project's standing rule for a
 * checker (`prove-red-doc-links.mjs` does the same for its declaration forms),
 * and it is the direction that produces a FALSE PASS rather than a false
 * finding that is worth the extra case.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir, keepScratch } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const SUITE = 'schematic_crossings.test.js';
const SUBJECT = 'schematic_crossings.js';
/* The second half: the check is only worth having if something RUNS it, and the
 * census that says so needs falsifying exactly as much as the detector does. A
 * mutation may name its own `file` and `suite`; both default to the pair above. */
const WIRING = 'rollout_crossings.test.js';
const KEEP = process.argv.includes('--keep');
if (KEEP) keepScratch();

/* Each mutation names the exact text it replaces and what it replaces it with.
 * `find` must appear exactly once — an anchor that matches twice or not at all
 * is a mutation that did not do what it says, and it would report a false green
 * just as loudly as the bug it is hunting. */
const MUTATIONS = [
  { what: 'a shared endpoint counts as a crossing, so every closed loop self-crosses',
    find: '  return t > 0 && t < 1 && u > 0 && u < 1;',
    to: '  return t >= 0 && t <= 1 && u >= 0 && u <= 1;' },

  { what: 'a collinear retrace counts as a crossing, so every out-and-back is a finding',
    find: '  if (den === 0) return false;',
    to: '  if (den === 0) return true;' },

  { what: 'the geographic crossings are not subtracted, so a real flyover is blamed on the schematizer',
    find: '  const fresh = selfCrossings(sch).filter((k) => !had.has(k))',
    to: '  const fresh = selfCrossings(sch)' },

  { what: 'the separation is measured on the SCHEMATIC, where the two strands meet by definition',
    find: '      return { i, j, sepM: segSepM(geo[i], geo[i + 1], geo[j], geo[j + 1]) };',
    to: '      return { i, j, sepM: segSepM(sch[i], sch[i + 1], sch[j], sch[j + 1]) };' },

  { what: 'closeness on EITHER strand joins a cluster, so two distinct crossings merge into one',
    find: '      if (Math.abs(pairs[a].i - pairs[b].i) <= CLUSTER && Math.abs(pairs[a].j - pairs[b].j) <= CLUSTER) {',
    to: '      if (Math.abs(pairs[a].i - pairs[b].i) <= CLUSTER || Math.abs(pairs[a].j - pairs[b].j) <= CLUSTER) {' },

  { what: 'a cluster is scored by its FIRST pair rather than its widest, so a Class A crossing hides behind a near one',
    find: '    const worst = g.reduce((m, p) => (p.sepM > m.sepM ? p : m), g[0]);',
    to: '    const worst = g[0];' },

  { what: 'the separation is vertex-to-vertex, so two strands that run alongside each other read as far apart',
    find: '  return Math.min(ptSegM(A, C, D), ptSegM(B, C, D), ptSegM(C, A, B), ptSegM(D, A, B));',
    to: '  return Math.hypot(A[0] - C[0], A[1] - C[1]);' },

  { what: 'two segments that MEET score their endpoint distance instead of nothing',
    find: '  if (properCross(a, b, c, d)) return 0;',
    to: '  if (false) return 0;' },

  { what: 'a length mismatch is skipped instead of reported, so the index-for-index premise fails silently',
    find: "      out.push({ route: r, error: `index-for-index comparison is off: geographic ${g.pts.length} points, schematic ${s.pts.length}` });",
    to: '      // the premise is no longer checked' },

  { what: 'analyseRun applies the threshold itself, so nobody can ask what it threw away',
    find: '    const found = newCrossings(g.pts, s.pts);',
    to: '    const found = newCrossings(g.pts, s.pts).filter((c) => c.sepM > DEFAULT_SEP_M);' },

  { what: 'the run always exits 0, so a finding cannot fail anything that calls it',
    find: '  process.exit(errors.length || over.length ? 1 : 0);',
    to: '  process.exit(0);' },

  { what: 'the edgeWay key is tried one way round only, so half the roads lose their name',
    find: "  const w = edgeWay[a + '|' + b] || edgeWay[b + '|' + a];",
    to: "  const w = edgeWay[a + '|' + b];" },

  { what: 'the detector grows its own argv parser back, and drops off the shared one',
    find: "const { parseArgs, die, resolveBuses } = require('./cli');",
    to: "const { die, resolveBuses } = require('./cli');" + String.fromCharCode(10)
      + "function parseArgs(a) { return { _: a }; }" },

  // ---- the WIRING. Nothing above notices if no rollout ever calls the detector.
  { file: 'rollout.js', suite: WIRING,
    what: 'the town rollout stops checking the real S4 it is about to commit',
    find: "realSaid.push({ source: 'crossings', stderr: crossingWarnings(s4Dir).join('" + String.fromCharCode(92) + "n'), ok: true });",
    to: '' },

  { file: 'rollout_places.js', suite: WIRING,
    what: 'the PLACE rollout stops checking, and only towns stay covered',
    find: "    realSaid.push({ source: 'crossings', stderr: crossingWarnings(s4Dir).join('" + String.fromCharCode(92) + "n'), ok: true });"
      + String.fromCharCode(10),
    to: '' },

  { file: 'rollout_places.js', suite: WIRING,
    what: 'the place rollout grows its own copy of the geometry beside the shared one',
    find: "const { crossingWarnings } = require('./schematic_crossings');",
    to: "const { crossingWarnings } = require('./schematic_crossings');" + String.fromCharCode(10)
      + 'function segSepM() { return 0; }' },

  { file: SUBJECT, suite: WIRING,
    what: 'the warning is reworded into a refusal, so it silently BLOCKS three published maps',
    find: '      out.push(`crossings: route ${r.route} is drawn crossing itself at ${c.atI} x ${c.atJ}, `',
    to: '      out.push(`crossings: route ${r.route} was not drawn correctly at ${c.atI} x ${c.atJ}, `' },

  { file: SUBJECT, suite: WIRING,
    what: 'an unreadable run throws instead of reporting, and takes the rollout down with it',
    find: '  try { res = analyseRun(runDir); } catch (e) { return [',
    to: '  if (true) { res = analyseRun(runDir); } else { return [' },

  { file: SUBJECT, suite: WIRING,
    what: 'the threshold stops applying, so every bus doubling back reaches the build log',
    find: '      if (c.sepM <= sepM) continue;',
    to: '      if (false) continue;' },

  // THE CONTROL. Same arithmetic, different order. It must stay GREEN.
  { equivalent: true,
    what: 'the four endpoint distances are minimised in a different order — the same answer',
    find: '  return Math.min(ptSegM(A, C, D), ptSegM(B, C, D), ptSegM(C, A, B), ptSegM(D, A, B));',
    to: '  return Math.min(ptSegM(D, A, B), ptSegM(C, A, B), ptSegM(B, C, D), ptSegM(A, C, D));' },
];

const scratch = scratchDir('prove-red-schematic-crossings-');
const engine = path.join(scratch, 'assets');
fs.cpSync(ASSETS, engine, { recursive: true });

const runSuite = (suite) => spawnSync(process.execPath, ['--test', '--test-reporter=spec', path.join(SK, 'test', suite)],
  { cwd: SK, env: { ...process.env, ENGINE_DIR: engine }, encoding: 'utf8' });

/* The baseline. Without it, every "the suite noticed" below could be the COPY
 * failing rather than the mutation — which is the shape of a harness that
 * reports a clean sweep while proving nothing at all. */
for (const suite of [...new Set(MUTATIONS.map((m) => m.suite || SUITE))]) {
  const base = runSuite(suite);
  if (base.status !== 0) {
    console.error(`BASELINE FAILED: ${suite} is red against an unmutated copy of the engine.`);
    console.error(base.stdout || base.stderr);
    if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  }
}

const rows = [];
let survived = 0, broken = 0;

for (const m of MUTATIONS) {
  const p = path.join(engine, m.file || SUBJECT);
  const suite = m.suite || SUITE;
  const original = fs.readFileSync(p, 'utf8');
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) {
    rows.push(['ANCHOR', m.what, `${m.file || SUBJECT}: the text to replace appears ${hits} times, not once`]);
    broken++;
    continue;
  }
  fs.writeFileSync(p, original.replace(m.find, m.to));
  const r = runSuite(suite);
  fs.writeFileSync(p, original);
  const green = r.status === 0;
  const first = green ? '' : (r.stdout.match(/^✖ (.+?) \(/m) || [, '(a test)'])[1];
  if (m.equivalent) {
    if (green) rows.push(['ok', m.what, 'stayed green, as an equivalent mutant must']);
    else { rows.push(['OVER-PINNED', m.what, `${suite} went red on a change that cannot alter an answer: ${first}`]); survived++; }
  } else if (green) {
    rows.push(['SURVIVED', m.what, `${suite} stayed green`]);
    survived++;
  } else {
    rows.push(['caught', m.what, first]);
  }
}

const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`\nMutation testing — the self-crossing detector and its wiring, one deliberate break at a time\n`);
console.log(w('verdict', 13) + w('what was broken', 88) + 'which test objected');
console.log('-'.repeat(160));
for (const [v, what, detail] of rows) console.log(w(v, 13) + w(what, 88) + detail);
console.log('-'.repeat(160));
const clean = rows.length - survived - broken;
console.log(`${rows.length} mutations, ${clean} behaved as expected, ${survived} did not, ${broken} anchors stale.\n`);
if (survived || broken) {
  console.log('A mutation that SURVIVED is a hole in the suite: the detector did something wrong and nothing');
  console.log('said so. OVER-PINNED is the other failure — the suite objected to a change that cannot alter an');
  console.log('answer, which is how a check ends up fighting every refactor. A stale ANCHOR means this file has');
  console.log('drifted from the code it edits.');
}
if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true });
else console.log('scratch copy left at ' + scratch);
process.exitCode = (survived || broken) ? 1 : 0;
