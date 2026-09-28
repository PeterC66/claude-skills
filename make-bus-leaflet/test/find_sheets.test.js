/*
 * The sheet enumeration — now ONE function, and this file's job changed with it.
 *
 * THIS TEST EXISTS BECAUSE THE SAME BUG HAPPENED THREE TIMES. A walk that
 * searched `Areas/` alone made the three maps under `Places/_standalone/`
 * invisible to whatever did the walking. gate_lib's findPlaces() had it;
 * quality_gate.js fixed its own copy on 2026-08-23 and wrote "same shape as the
 * gap in gate_lib's findPlaces(), in a second file" in the comment; and the
 * third copy — quality_metrics.js's, the one the `--all` CLI uses — was still
 * short on 2026-08-28, so every board-wide figure that tool ever printed was
 * taken over a population three maps smaller than the board. contact_sheet.js
 * was a fourth (OA-224 Tier 1.3) and `prove-lane-mirror.js` a fifth.
 *
 * An enumeration is a silent filter. It does not fail; it answers a smaller
 * question and looks exactly like an answer to the whole one.
 *
 * UNTIL 2026-09-02 THE INVARIANT HERE WAS THAT THE TWO WALKS *AGREE*, which was
 * the best available claim while there were two of them. OA-224 Tier 3.2 made
 * there be one, in `gate_lib`, so the claim is now IDENTITY — `QM.findSheets ===
 * QG.findSheets === G.findSheets` — which is a strictly stronger statement and
 * one that cannot drift between runs. Agreement has to be re-established every
 * time either copy is edited; identity cannot be lost without deleting the
 * assignment. The behaviour cases below still run against the shared function,
 * because identity between two wrong walks would also pass.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const G = require('./_engine.js').load('gate_lib.js');
const QM = require('./_engine.js').load('quality_metrics.js');
const QG = require('./_engine.js').load('quality_gate.js');
const { scratchDir } = require('../assets/scratch');

const ASSETS = path.join(__dirname, '..', 'assets');
const TOOLS = path.join(__dirname, '..', 'tools');

// A miniature Buses tree carrying BOTH place layouts and the one directory that
// is deliberately excluded.
function tree() {
  const root = scratchDir('sheets-');
  const put = (rel) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '<svg/>');
  };
  put(path.join('Areas', 'Wisbech', 'ci-reference', 'internal.svg'));
  put(path.join('Areas', 'St Ives', 'Places', 'St Ives Bus Station', 'ci-reference', 'internal.svg'));
  put(path.join('Places', '_standalone', 'Ely Co-op', 'ci-reference', 'internal.svg'));
  put(path.join('Places', '_standalone', 'Ely Co-op', 'ci-reference', 'external.svg'));
  put(path.join('Areas', '_portal-fixture', 'ci-reference', 'internal.svg'));
  put(path.join('Areas', 'Wisbech', 'ci-reference', 'routes.json'));   // not an svg
  put(path.join('Areas', 'Wisbech', 'S4-generate', 'internal.svg'));   // not ci-reference
  return root;
}
const rel = (root, list) => list.map(p => path.relative(root, p).split(path.sep).join('/')).sort();

test('there is ONE enumeration, and both former owners re-export it', () => {
  assert.strictEqual(QM.findSheets, G.findSheets, 'quality_metrics.js has a copy again');
  assert.strictEqual(QG.findSheets, G.findSheets, 'quality_gate.js has a copy again');
});

test('it walks Places/_standalone, not Areas alone', () => {
  const root = tree();
  const got = rel(root, G.findSheets(root));
  assert.ok(got.includes('Places/_standalone/Ely Co-op/ci-reference/internal.svg'),
    'the standalone maps are on the board and must be counted: ' + got.join(', '));
  assert.ok(got.includes('Areas/St Ives/Places/St Ives Bus Station/ci-reference/internal.svg'),
    'the nested place layout too: ' + got.join(', '));
  // The TOTAL is asserted in the last case rather than here, so that each of the
  // three prove-red mutations reddens the assertion that names it. A count in
  // the first case catches every break and tells you nothing about which.
});

test('it skips _portal-fixture, which is reproduced byte-for-byte and read by nobody', () => {
  const root = tree();
  assert.ok(!rel(root, G.findSheets(root)).some(p => p.includes('_portal-fixture')));
});

test('only .svg files inside a folder actually named ci-reference count', () => {
  const root = tree();
  const got = rel(root, G.findSheets(root));
  assert.ok(!got.some(p => p.endsWith('.json')), 'a sidecar is not a sheet');
  assert.ok(!got.some(p => p.includes('S4-generate')), 'a run folder is not the tracked mirror');
  assert.strictEqual(got.length, 4, 'four sheets in this tree and no more: ' + got.join(', '));
});

/*
 * THE SOURCE-LEVEL HALF, AS A CENSUS (codebase review 2026-09-28, R2 N41).
 * Until that day this was a list of three named importers — contact_sheet.js,
 * attribution-gate.js and prove-lane-mirror.js — and a list of named files is
 * exactly what let the walk be written again somewhere nobody had named:
 * font_metrics_build.js harvested glyphs from Areas/ alone, and redteam_budget.js
 * counted decision records one folder deep, missing 7 of September's 18.
 *
 * So it now reads EVERY .js and .mjs in assets/ and tools/ and asks one question:
 * does it join or read `Areas` or `Places` under a root for itself? The owner of
 * the walk is gate_lib.js. Anything else that does must be on the allowlist below
 * WITH A REASON, and the reasons are all the same kind: a donor pick or a fixture
 * builder, which chooses ONE map to borrow or makes an empty tree, and never
 * reports a figure over the estate. A file that reports a figure over the estate
 * and walks for itself is the bug this test exists for.
 *
 * The allowlist is held to the disk both ways: an entry that no longer matches is
 * stale and must go, so the list cannot fill up with names that excuse nothing.
 */
const OWNER = 'assets/gate_lib.js';
const WALKS_ITSELF = [
  /readdirSync\([^)]*'(Areas|Places)'/,
  /path\.join\([A-Za-z_.]+, '(Areas|Places)'\)/,
  // redteam_budget.js's own walk, before 2026-09-28: `for (const top of ['Areas', 'Places'])`.
  /\[\s*'Areas',\s*'Places'\s*\]/,
];
const ALLOWED = {
  'tools/prove-known-off-parity.js': 'locates the buses-data checkout by its Areas/ folder, then reads each town\'s own routes.json for a parity probe; it reports no estate figure',
  'tools/prove-red-deploy-grace.js': 'builds an EMPTY Areas/ and Places/ as a fixture; it walks nothing',
  'tools/prove-red-fixture-estate.js': 'picks the first town with a ci-reference as a donor for a mutation; one map, not a population',
  'tools/prove-red-held-back.js': 'picks a donor town and a donor place for its mutations; one map each, not a population',
  'tools/prove-red-status.js': 'picks a donor town whose routes.json it can re-stamp; one map, not a population',
  'tools/prove-red.js': 'the text of a mutation against gate_lib\'s own findSheets line, not a walk',
  /* Three walks of their own over BOTH roots, so none has the Areas-only bug; they
   * walk for something gate_lib does not enumerate (a POI config, a run folder, a
   * fixture file). Converging them is Tier 3 of the 2026-09-28 review ("the seven
   * estate walkers", R2 F1), which asked for this census first. */
  'assets/poi_worksheet.js': 'walks both roots for every map\'s S3 config; carried to Tier 3 of the 2026-09-28 review (R2 F1)',
  'assets/stray_outputs.js': 'walks both roots for stage run folders, which gate_lib does not enumerate; carried to Tier 3 (R2 F1)',
  'assets/portal_fixtures.js': 'names the two FIXTURE roots it vendors to the portal, not the estate; it reads _portal-fixture, which every estate walk excludes',
};

function sources() {
  const out = [];
  for (const dir of [ASSETS, TOOLS]) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.m?js$/.test(f)) continue;
      out.push({ rel: `${path.basename(dir)}/${f}`, src: fs.readFileSync(path.join(dir, f), 'utf8') });
    }
  }
  return out;
}

test('no file in assets/ or tools/ walks Areas/ or Places/ for itself, bar the owner and a reasoned allowlist', () => {
  const walkers = sources().filter(({ src }) => WALKS_ITSELF.some((re) => re.test(src))).map(({ rel }) => rel);
  assert.ok(walkers.includes(OWNER), 'the census pattern no longer finds gate_lib\'s own walk, so it would find nobody else\'s either');
  const unexplained = walkers.filter((r) => r !== OWNER && !(r in ALLOWED));
  assert.deepStrictEqual(unexplained, [],
    'these files walk the estate for themselves; send them through gate_lib.findSheets/findTowns/findPlaces, or add them to ALLOWED with a reason');
  const stale = Object.keys(ALLOWED).filter((r) => !walkers.includes(r));
  assert.deepStrictEqual(stale, [], 'these ALLOWED entries no longer walk anything; remove them');
});

test('the former hand-listed consumers still import the walk', () => {
  for (const [rel, from] of [
    ['assets/contact_sheet.js', /require\('\.\/quality_metrics'\)/],
    ['tools/attribution-gate.js', /require\('\.\.\/assets\/gate_lib'\)/],
    ['tools/prove-lane-mirror.js', /require\('\.\.\/assets\/gate_lib\.js'\)/],
    ['assets/font_metrics_build.js', /require\('\.\/gate_lib'\)\.findSheets/],
    ['assets/redteam_budget.js', /require\('\.\/gate_lib'\)/],
  ]) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(from.test(src), `${rel} no longer imports the module that owns the walk`);
  }
});
