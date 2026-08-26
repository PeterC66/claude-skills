/*
 * gate_lib.js — the comparison helpers every byte gate is built from.
 *
 * Three faults in this project's history live in this file's contract. A
 * committed fixture rewritten by autocrlf on checkout, which is green on one
 * machine and red on the next. A rollout diff that reported a false LOST/GAINED
 * pair on the version stamp alone, because the stamp legitimately changes on
 * every release. And "absent is not different" — a gate that reports a file it
 * could not read as a DIFFERENCE tells you something is wrong with the map when
 * what is wrong is the gate's own inputs.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('./_engine.js').load('gate_lib.js');

const tmp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatelib-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const put = (dir, name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };

const SVG = ['<svg viewBox="0 0 297 210">',
  '<text x="8" y="16">Buses within St Ives</text>',
  '<text x="20" y="40">Needingworth</text>',
  '<text x="8" y="208">Valid from Summer 2026</text>',
  '</svg>'].join('\n');

test('the same content with Windows line endings is the same content', () => tmp(dir => {
  // .gitattributes exists in buses-data for exactly this: autocrlf rewrites a
  // committed fixture on checkout, and the drift table would then report every
  // vendored file as different on a fresh clone.
  const a = put(dir, 'a.js', 'one\ntwo\nthree\n');
  const b = put(dir, 'b.js', 'one\r\ntwo\r\nthree\r\n');
  assert.strictEqual(G.sameIgnoringLineEndings(a, b), true);
}));

test('different content is different', () => tmp(dir => {
  assert.strictEqual(G.sameIgnoringLineEndings(put(dir, 'a.js', 'one\n'), put(dir, 'b.js', 'two\n')), false);
}));

test('a file that is not there returns null — "cannot compare", not "differs"', () => tmp(dir => {
  // A vendored file that DIFFERS is stale output; a vendored file that is ABSENT
  // is a require that throws. Collapsing the two hid which one had happened.
  const a = put(dir, 'a.js', 'one\n');
  assert.strictEqual(G.sameIgnoringLineEndings(a, path.join(dir, 'nope.js')), null);
  assert.strictEqual(G.sameIgnoringLineEndings(path.join(dir, 'nope.js'), a), null);
}));

test('labelSet is the sorted set of text a sheet actually prints', () => {
  const set = G.labelSet(SVG);
  assert.deepStrictEqual(set, ['Buses within St Ives', 'Needingworth', 'Valid from Summer 2026']);
});

test('the version stamp never counts as content lost or gained', () => tmp(dir => {
  // The stamp changes on every rollout by design. Judging it as content loss is
  // what made a scratch build report a false LOST/GAINED pair on 2026-08-09.
  const older = put(dir, 'old.svg', SVG.replace('Valid from Summer 2026', 'Valid from Spring 2026'));
  const newer = put(dir, 'new.svg', SVG);
  assert.deepStrictEqual(G.labelDiff(older, newer), { lost: [], gained: [] });
  assert.ok(G.VERSION_STAMP_RE.test('Map v2.1 · 2026-08-10'), 'the pre-2026-08-10 stamp format is still recognised');
}));

test('design.sheetVersion is a stamp too, in every form footer.js prints it', () => {
  // The gap that made rollout_places.js report a lost label on all four
  // boarding places, 2026-08-25: the filter knew `Valid from ...` and the old
  // `Map v...` and not the sheet version, which by design carries the run's own
  // number and therefore CANNOT survive a rollout. A stamp that must change is
  // never evidence that content was dropped.
  for (const stamp of ['build 2.8 · 25 Aug 2026', 'Draft 5.0 · 19 Aug 2026 14:02',
                       'Preview 5.0 · 19 Aug 2026', 'Map version 5.0', 'Map version v5.0']) {
    assert.ok(G.VERSION_STAMP_RE.test(stamp), stamp + ' must be filtered as a stamp');
  }
});

test('a real label that merely begins like a stamp is still a label', () => {
  // The filter must key on the version NUMBER, not the word. A street called
  // "Draft Lane" disappearing from a sheet is content loss.
  for (const label of ['build up the High Street', 'Draft Lane', 'Preview Cinema', 'Map version']) {
    assert.strictEqual(G.VERSION_STAMP_RE.test(label), false, label + ' must survive as a label');
  }
});

test('a name that stopped being printed IS reported', () => tmp(dir => {
  const older = put(dir, 'old.svg', SVG);
  const newer = put(dir, 'new.svg', SVG.replace('<text x="20" y="40">Needingworth</text>\n', ''));
  const d = G.labelDiff(older, newer);
  assert.deepStrictEqual(d.lost, ['Needingworth']);
  assert.deepStrictEqual(d.gained, []);
}));

test('a missing side of a label diff is empty, not a wholesale loss', () => tmp(dir => {
  const only = put(dir, 'new.svg', SVG);
  assert.deepStrictEqual(G.labelDiff(path.join(dir, 'nope.svg'), only), { lost: [], gained: [] });
}));

test('diffSvg names the first line that moved, and says which file was missing', () => tmp(dir => {
  const a = put(dir, 'a.svg', 'one\ntwo\nthree\n');
  const b = put(dir, 'b.svg', 'one\nTWO\nthree\n');
  const d = G.diffSvg(a, b);
  assert.strictEqual(d.same, false);
  assert.strictEqual(d.diffs[0].line, 2);
  assert.strictEqual(G.diffSvg(a, a).same, true);
  const miss = G.diffSvg(path.join(dir, 'nope.svg'), b);
  assert.strictEqual(miss.same, false);
  assert.match(miss.reason, /^missing:/);
}));

test('the place fixture ignore rule drops exactly the two lines it is meant to', () => tmp(dir => {
  // The place fixtures legitimately differ on the title (y="16") and the stamp
  // (y="208"); anything else differing is a real regression.
  const a = put(dir, 'a.svg', SVG);
  const b = put(dir, 'b.svg', SVG.replace('Buses within St Ives', 'Buses serving Tesco Extra')
                                 .replace('Valid from Summer 2026', 'Valid from Spring 2026'));
  assert.strictEqual(G.diffSvg(a, b).same, false, 'unfiltered, those two lines must still show as different');
  assert.strictEqual(G.diffSvg(a, b, { ignoreLineRe: G.PLACE_IGNORE }).same, true);
  const c = put(dir, 'c.svg', b.length ? fs.readFileSync(b, 'utf8').replace('Needingworth', 'Nowhere') : '');
  assert.strictEqual(G.diffSvg(a, c, { ignoreLineRe: G.PLACE_IGNORE }).same, false,
    'the ignore rule swallowed a real content change');
}));

test('--set-path refuses a path that does not exist rather than inventing it', () => {
  // A typo that silently creates design.printSaf would be a key the engine never
  // reads and a sheet that quietly ignores the instruction it was given.
  const obj = { design: { printSafe: 5 }, routes: [{ colour: '#123456' }] };
  assert.throws(() => G.applySetPath(obj, G.parseSetPath('design.printSaf=3')), /no such path/);
  assert.throws(() => G.applySetPath(obj, G.parseSetPath('nope.deeper=3')), /no such path/);
  assert.strictEqual(obj.design.printSafe, 5);
});

test('--set-path reports what it changed, and stays quiet when nothing moved', () => {
  const obj = { design: { printSafe: 5 }, routes: [{ colour: '#123456' }] };
  assert.match(G.applySetPath(obj, G.parseSetPath('design.printSafe=3')), /design\.printSafe: 5 -> 3/);
  assert.strictEqual(obj.design.printSafe, 3);
  assert.strictEqual(G.applySetPath(obj, G.parseSetPath('design.printSafe=3')), null);
  // An array index is a path segment like any other.
  assert.match(G.applySetPath(obj, G.parseSetPath('routes.0.colour="#abcdef"')), /-> "#abcdef"/);
});

test('--set-path parses a bare word as a string and JSON as JSON', () => {
  assert.deepStrictEqual(G.parseSetPath('a.b=north'), { path: 'a.b', value: 'north' });
  assert.deepStrictEqual(G.parseSetPath('a.b=false'), { path: 'a.b', value: false });
  assert.deepStrictEqual(G.parseSetPath('a.b=-66'), { path: 'a.b', value: -66 });
  assert.throws(() => G.parseSetPath('nothing-to-set'), /wants/);
});
