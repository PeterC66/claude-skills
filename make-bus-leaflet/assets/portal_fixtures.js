/*
 * portal_fixtures.js — one section of the board: has the portal's copy of
 * buses-data's GATE FIXTURES fallen behind buses-data?
 *
 * It is a module and not a block in status.js because the line ratchet refused
 * the growth and was right to: `portalDrift()` next door is the thing this is
 * the sibling of, and a board section that owns its own comparison, its own
 * verdict and its own printing is exactly what `deployment.js` and `s6_claims.js`
 * already are. status.js keeps the wiring and nothing else.
 *
 * Everything it needs is passed in — the two directories, the portal's source
 * ref, and the two git readers — so nothing here reaches for a global and the
 * whole of it can be run against a synthetic portal by
 * tools/prove-red-portal-drift.js.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sameBytesIgnoringLineEndings } = require('./line_endings');

// buses-data OA-419. `portalDrift()` in status.js asks whether the portal's copy
// of the ENGINE has fallen behind this skill tree. It has the portal checkout
// open and it did not ask the other half of the same join: whether the portal's
// copy of buses-data's GATE FIXTURES has fallen behind buses-data.
//
// One join, asked in two places, and until 2026-09-21 only the expensive one
// asked both halves. buses-data's `gates.yml` runs the portal's own
// `npm run fixtures:vendor -- --buses <buses-data>` on every push; nothing on the
// laptop did. So the nine-town re-stamp that recut `Areas/_portal-fixture/St Ives`
// was caught here for the engine half, satisfied by `refresh_area_fixture.js
// --apply`, and then this board read exit 0 while the portal's copy of the same
// six files was still behind. The push went red on that step alone (run
// 35557148385) and cost a portal pull request and a re-run to clear. This is the
// repository that BILLS, so a red that could have been predicted for free is the
// expensive kind. The shape is *No ink moved, so nothing moved*: the artwork was
// right, every ink instrument said so, and the build stamp is itself a byte that
// every fixture and every vendored copy of one carries.
//
// A CHORE, NEVER A FAULT, and it is not in `bad` below. The artwork is right
// either way; what is blocked is a push. That is OA-396's rule applied straight,
// and it is the same verdict `engine-stale` gets one section up.
//
// WHICH TREE THIS READS, AND WHY IT IS NOT THE DISK. The same reason as
// portalSource() above, learned again the hard way the same morning: the bare
// `fixtures:vendor` on this laptop reported `in step` while CI reported six files
// BEHIND, minutes apart, about the same two commits. Both were right about
// different questions — the script compares WORKING TREE against WORKING TREE, and
// an interactive session had already applied the re-vendor on a branch. CI checks
// the portal out at its default branch, so the join CI makes is against
// `origin/main`, and that is the ref this asks. A branch with the fix on it is not
// an answer to "will the next push go red".
//
// THE COMPARISON IS vendor-fixtures.mjs's, deliberately including its edges: the
// `.jpg`/`.md` exclusion (rasterisation is platform-dependent and the fixture
// README's relative links climb out of buses-data), line endings normalised on
// both sides, and a file present in the portal that buses-data no longer writes
// reported `stale` rather than ignored. If the two ever disagree, this one is
// wrong by definition — the other is the thing CI runs.
const FIXTURE_KINDS = ['Areas', 'Places'];
const VENDORED_FIXTURE_ROOT = 'gate-fixtures';
const skipFixture = (rel) => /\.jpe?g$/i.test(rel) || /\.md$/i.test(rel);

/** Every file under `dir`, relative to it, '/'-separated and sorted. */
function walkFixtures(dir, base = dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    const p = path.join(dir, n);
    let s;
    try { s = fs.statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...walkFixtures(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function fixtureVendoring({ portal: PORTAL, buses: BUSES, source, gitIn, gitShow }) {
  const exists = (p) => fs.existsSync(p);
  if (!PORTAL || !exists(PORTAL)) return null;
  const ref = source && source.ref;   // the ref CI checks out, never this laptop's disk
  const kinds = FIXTURE_KINDS.filter((k) => exists(path.join(BUSES, k, '_portal-fixture')));
  // NOTHING TO COMPARE IS NOT "in step". buses-data holding neither fixture folder
  // means this board cannot answer the question, and a check that says nothing
  // must say so rather than fall through to the green branch — the
  // *refusal read as an absence* shape, which this estate has met three times.
  if (!kinds.length) {
    return { source, status: 'NO-SOURCE', behind: [],
      why: 'no Areas/_portal-fixture or Places/_portal-fixture under ' + BUSES
        + ' — nothing here can say whether the portal\'s copy is in step' };
  }
  const behind = [];
  for (const kind of kinds) {
    const src = path.join(BUSES, kind, '_portal-fixture');
    const prefix = VENDORED_FIXTURE_ROOT + '/' + kind + '/_portal-fixture/';
    const want = walkFixtures(src).filter((r) => !skipFixture(r));

    for (const rel of want) {
      const from = fs.readFileSync(path.join(src, rel));
      const diskFile = path.join(PORTAL, VENDORED_FIXTURE_ROOT, kind, '_portal-fixture', rel);
      const against = ref ? gitShow(PORTAL, ref, prefix + rel)
        : (exists(diskFile) ? fs.readFileSync(diskFile) : null);
      if (!against) behind.push({ state: 'missing', file: prefix + rel });
      else if (!sameBytesIgnoringLineEndings(from, against)) behind.push({ state: 'differs', file: prefix + rel });
    }

    // Enumerated from the REF for the same reason the engine population above is:
    // walking the disk would name a file a feature branch had just added.
    const tree = ref ? gitIn(PORTAL, ['ls-tree', '-r', '--name-only', ref, '--', prefix.replace(/\/$/, '')]) : null;
    const have = tree !== null
      ? String(tree).split('\n').map((s) => s.trim()).filter(Boolean).map((p) => p.slice(prefix.length))
      : walkFixtures(path.join(PORTAL, VENDORED_FIXTURE_ROOT, kind, '_portal-fixture'));
    const wanted = new Set(want);
    for (const rel of have) {
      if (!rel || wanted.has(rel)) continue;
      behind.push({ state: 'stale', file: prefix + rel });
    }
  }
  return { source, status: behind.length ? 'BEHIND' : 'in step', behind, kinds };
}

/* Printed whether or not anything is behind, for the reason the vendoring table
 * prints its source line: a verdict nobody ever sees green is one nobody learns
 * to read. `sourceLine` is status.js's driftSourceLine(), passed in so the two
 * sections cannot drift apart in how they name the tree they read. */
function printFixtureVendoring(v, sourceLine, remedyDir) {
  if (!v) return;
  console.log('\n=== Portal vendored fixtures (buses-data -> portal gate-fixtures/, CRLF-safe) ===');
  if (sourceLine) console.log('  ' + sourceLine);
  if (v.status === 'NO-SOURCE') {
    console.log('  NOT ASKED  ' + v.why);
    return;
  }
  if (v.status === 'in step') {
    console.log('  in step  every fixture file the portal vendors is byte-identical to buses-data\'s ('
      + v.kinds.map((k) => k + '/_portal-fixture').join(', ') + ')');
    return;
  }
  for (const b of v.behind) console.log('  ' + b.state.padEnd(9) + b.file);
  console.log('  BEHIND   ' + v.behind.length + ' file(s). A CHORE, not a fault -- the artwork is'
    + ' right and only the next push to buses-data is blocked, on gates.yml\'s step'
    + '\n           "The portal\'s vendored fixtures are in step with this repository".'
    + '\n           Remedy, from ' + remedyDir + ':   npm run fixtures:vendor -- --apply');
}

module.exports = { fixtureVendoring, printFixtureVendoring, VENDORED_FIXTURE_ROOT };
