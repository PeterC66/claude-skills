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
 * THE SOURCE-LEVEL HALF, for the consumers that cannot be required.
 * `contact_sheet.js`, `attribution-gate.js` and `prove-lane-mirror.js` all run
 * top-to-bottom at load, so the only way to ask whether one has grown its own
 * walk back is to read it. Each of the three had its own copy before Tier 1.3
 * and Tier 3.2; two of the copies filtered differently from the shared one.
 */
const IMPORTERS = [
  { file: path.join(ASSETS, 'contact_sheet.js'), from: /require\('\.\/quality_metrics'\)/ },
  { file: path.join(TOOLS, 'attribution-gate.js'), from: /require\('\.\.\/assets\/gate_lib'\)/ },
  { file: path.join(TOOLS, 'prove-lane-mirror.js'), from: /require\('\.\.\/assets\/gate_lib\.js'\)/ },
];

test('the three script consumers import the walk and define no walk of their own', () => {
  for (const { file, from } of IMPORTERS) {
    const src = fs.readFileSync(file, 'utf8');
    const name = path.basename(file);
    assert.ok(from.test(src), `${name} no longer imports the module that owns findSheets`);
    assert.ok(/\bfindSheets\b/.test(src), `${name} does not mention findSheets at all`);
    // A `function findSheets(` of its own is the copy; a projection of the
    // shared list (attribution-gate needs a map name beside each path) is not,
    // so what is banned is the readdir walk, not the wrapper.
    assert.ok(!/readdirSync\([^)]*'Areas'/.test(src) && !/path\.join\([A-Za-z]+, 'Areas'\)/.test(src),
      `${name} walks Areas/ itself again`);
  }
});
