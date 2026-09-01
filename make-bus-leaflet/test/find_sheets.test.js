/*
 * The sheet enumeration, in the two files that each keep their own copy.
 *
 * THIS TEST EXISTS BECAUSE THE SAME BUG HAPPENED THREE TIMES. A walk that
 * searched `Areas/` alone made the three maps under `Places/_standalone/`
 * invisible to whatever did the walking. gate_lib's findPlaces() had it;
 * quality_gate.js fixed its own copy on 2026-08-23 and wrote "same shape as the
 * gap in gate_lib's findPlaces(), in a second file" in the comment; and the
 * third copy — quality_metrics.js's, the one the `--all` CLI uses — was still
 * short on 2026-08-28, so every board-wide figure that tool ever printed was
 * taken over a population three maps smaller than the board.
 *
 * An enumeration is a silent filter. It does not fail; it answers a smaller
 * question and looks exactly like an answer to the whole one. So the invariant
 * worth pinning is not "each walk is right" — that is what everyone believed
 * three times — it is that the two walks AGREE, which is checkable without
 * anybody having to remember the standalone layout exists.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const QM = require('./_engine.js').load('quality_metrics.js');
const QG = require('./_engine.js').load('quality_gate.js');
const { scratchDir } = require('../assets/scratch');

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

test('quality_metrics walks Places/_standalone, not Areas alone', () => {
  const root = tree();
  const got = rel(root, QM.findSheets(root));
  assert.ok(got.includes('Places/_standalone/Ely Co-op/ci-reference/internal.svg'),
    'the standalone maps are on the board and must be counted: ' + got.join(', '));
  assert.strictEqual(got.length, 4);
});

test('the two enumerations agree, which is the invariant that failed three times', () => {
  const root = tree();
  assert.deepStrictEqual(rel(root, QM.findSheets(root)), rel(root, QG.findSheets(root)));
});

test('both skip _portal-fixture, which is reproduced byte-for-byte and read by nobody', () => {
  const root = tree();
  for (const found of [QM.findSheets(root), QG.findSheets(root)])
    assert.ok(!rel(root, found).some(p => p.includes('_portal-fixture')));
});

test('only .svg files inside a folder actually named ci-reference count', () => {
  const root = tree();
  const got = rel(root, QM.findSheets(root));
  assert.ok(!got.some(p => p.endsWith('.json')), 'a sidecar is not a sheet');
  assert.ok(!got.some(p => p.includes('S4-generate')), 'a run folder is not the tracked mirror');
});

// A THIRD consumer, and this one keeps NO copy. contact_sheet.js is a top-to-bottom
// script (it runs at load, so it cannot be required here); until 2026-09-02 it
// carried its own findSheets() that walked `Areas/` alone and did not skip the
// fixture — the fourth instance of the bug this file exists for. The invariant
// for a script that cannot be loaded is a SOURCE one: it must import the shared
// enumeration and must not define its own (OA-224 Tier 1.3).
test('contact_sheet.js imports findSheets from quality_metrics and defines no copy of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'contact_sheet.js'), 'utf8');
  assert.ok(/\{[^}]*\bfindSheets\b[^}]*\}\s*=\s*require\('\.\/quality_metrics'\)/.test(src),
    'contact_sheet.js must destructure findSheets from ./quality_metrics');
  assert.ok(!/function\s+findSheets\s*\(/.test(src), 'contact_sheet.js must not define its own findSheets()');
  assert.ok(!/readdirSync\([^)]*'Areas'/.test(src) && !/path\.join\(busesDir, 'Areas'\)/.test(src),
    'contact_sheet.js must not walk Areas/ itself');
});
