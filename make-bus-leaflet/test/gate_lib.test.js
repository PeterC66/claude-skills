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
  assert.deepStrictEqual(G.labelDiff(older, newer), { lost: [], gained: [], rewrapped: [] });
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

test('a label that merely RE-WRAPS is not a lost label', () => tmp(dir => {
  /* OA-171, and this is the real Godmanchester Co-op Ermine Street case reduced to
   * its bones. The name was on the sheet twice -- once over two lines, once on one --
   * and after the round both copies wrap. Nothing left the sheet, no reader lost
   * anything, and rollout_places.js refused to render.
   *
   * Note what is NOT here: nothing was GAINED. `Wood Green` was already in the old
   * set and went from one copy to two, which a SET cannot see. A rule written
   * against the gained labels -- which is the rule the backlog row proposed -- reads
   * this case as a loss exactly as the old one did. */
  const before = ['<text x="10" y="20">Wood Green Animal Shelter</text>',
                  '<text x="10" y="30">Wood Green</text>',
                  '<text x="10" y="40">Animal Shelter</text>',
                  '<text x="10" y="50">Huntingdon</text>'].join('\n');
  const after = ['<text x="10" y="20">Wood Green</text>',
                 '<text x="10" y="30">Animal Shelter</text>',
                 '<text x="10" y="50">Huntingdon</text>'].join('\n');
  const d = G.labelDiff(put(dir, 'old.svg', before), put(dir, 'new.svg', after));
  assert.deepStrictEqual(d.lost, [], 'a re-wrap must not stop the rollout');
  assert.deepStrictEqual(d.rewrapped, [{ label: 'Wood Green Animal Shelter', as: ['Wood Green', 'Animal Shelter'] }],
    'and it must still be REPORTED -- a check that forgives silently is the next --force habit');
}));

test('a destination that genuinely disappears still stops the rollout', () => tmp(dir => {
  /* The other half of OA-171: a softened check nobody has watched refuse anything is
   * worse than the noisy one it replaced. Half the name surviving is a real loss --
   * `Wood Green` alone reconstructs nothing -- and so is a whole name going. */
  const before = ['<text x="10" y="20">Wood Green Animal Shelter</text>',
                  '<text x="10" y="30">Uxbridge</text>'].join('\n');
  const after = ['<text x="10" y="20">Wood Green</text>'].join('\n');
  const d = G.labelDiff(put(dir, 'old.svg', before), put(dir, 'new.svg', after));
  assert.deepStrictEqual(d.lost.sort(), ['Uxbridge', 'Wood Green Animal Shelter']);
  assert.deepStrictEqual(d.rewrapped, []);
}));

test('a re-wrap must RECONSTRUCT the name, not merely reuse its words', () => {
  /* The rule is deliberately narrower than "the words are all still there
   * somewhere", which would call a lost `High Street` benign on a sheet that happens
   * to hold `High Wycombe` and `Green Street`. Concatenation in order, on word
   * boundaries, or it is a loss. */
  assert.deepStrictEqual(G.rewrapOf('Wood Green Animal Shelter', ['Wood Green', 'Animal Shelter']),
    ['Wood Green', 'Animal Shelter']);
  assert.strictEqual(G.rewrapOf('High Street', ['High Wycombe', 'Green Street']), null);
  assert.strictEqual(G.rewrapOf('Uxbridge', ['Uxbridge Road', 'Wood Green']), null,
    'a single word has no parts to be re-wrapped into');
  assert.strictEqual(G.rewrapOf('Wood Green Animal Shelter', ['Wood Green']), null,
    'half the name surviving is a loss, not a re-wrap');
  assert.deepStrictEqual(G.rewrapOf('St Ives  Bus Station', ['St Ives', 'Bus Station']),
    ['St Ives', 'Bus Station'], 'run-together whitespace is normalised on both sides');
});

test('a missing side of a label diff is empty, not a wholesale loss', () => tmp(dir => {
  const only = put(dir, 'new.svg', SVG);
  assert.deepStrictEqual(G.labelDiff(path.join(dir, 'nope.svg'), only), { lost: [], gained: [], rewrapped: [] });
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
  // `create` joined the shape on 2026-08-30 (OA-181) and this is a deep-equal, so
  // the third field is stated rather than tolerated: a spec object that grows a
  // key nobody named is how two tools end up disagreeing about the same string.
  assert.deepStrictEqual(G.parseSetPath('a.b=north'), { path: 'a.b', value: 'north', create: false });
  assert.deepStrictEqual(G.parseSetPath('a.b=false'), { path: 'a.b', value: false, create: false });
  assert.deepStrictEqual(G.parseSetPath('a.b=-66'), { path: 'a.b', value: -66, create: false });
  assert.deepStrictEqual(G.parseSetPath('+a.b=-66'), { path: 'a.b', value: -66, create: true });
  assert.throws(() => G.parseSetPath('nothing-to-set'), /wants/);
  assert.throws(() => G.parseSetPath('+nothing-to-set'), /wants/);
});

/* ---- --set-path, and the '+' that adds a leaf (2026-08-30, OA-181) ---------
 *
 * The refusal to create a missing path is the guard that turns a typo into an
 * error. What it also did was make a NEW key inside an array element
 * unreachable: mapNotes[] is an array, --set/--patch cannot descend into one,
 * and --set-path was the only route in — so `mapNotes.0.w`, added the same day,
 * could be written by nothing but a hand edit to a committed S3.
 *
 * Four clauses and four fixtures, and the third is the one that matters: the
 * guard has to keep biting in the middle of the path, because a mistyped PARENT
 * is the mistake it was written for and '+' must not buy silence about it.
 */
test("--set-path refuses an unknown leaf, and says how to mean it", () => {
  const o = { mapNotes: [{ text: 'x', y: 185 }] };
  assert.throws(() => G.applySetPath(o, G.parseSetPath('mapNotes.0.w=110')),
    /no such path: mapNotes\.0\.w.*'\+'/s);
  assert.deepStrictEqual(o, { mapNotes: [{ text: 'x', y: 185 }] }, 'it wrote anyway');
});

test("...and a leading '+' ADDS the last segment", () => {
  const o = { mapNotes: [{ text: 'x', y: 185 }] };
  const said = G.applySetPath(o, G.parseSetPath('+mapNotes.0.w=110'));
  assert.strictEqual(o.mapNotes[0].w, 110);
  assert.match(said, /^mapNotes\.0\.w: /, 'the change was not described');
});

test("...but only the LAST segment: a mistyped parent is still an error", () => {
  const o = { mapNotes: [{ text: 'x' }] };
  assert.throws(() => G.applySetPath(o, G.parseSetPath('+mapNotez.0.w=110')), /no such path: mapNotez/);
  assert.throws(() => G.applySetPath(o, G.parseSetPath('+mapNotes.7.w=110')), /no such path: mapNotes\.7/);
  assert.deepStrictEqual(o, { mapNotes: [{ text: 'x' }] }, 'a bad parent was created');
});

test("an existing leaf is unchanged by the '+', and a no-op still reports null", () => {
  const o = { design: { placeIndex: false } };
  assert.strictEqual(G.applySetPath(o, G.parseSetPath('+design.placeIndex=false')), null);
  assert.strictEqual(G.applySetPath(o, G.parseSetPath('design.placeIndex=true')), 'design.placeIndex: false -> true');
  assert.strictEqual(o.design.placeIndex, true);
});


/* unrenderedS4 — a committed S4 with no S5 render (OA-198) -------------------
 *
 * The state is produced by both rollout tools' own blocking-warning stop, which
 * sits between `stage commit S4` and `stage new S5`. Everything about it reads
 * healthy: the manifest advertises the new S4, the current generator redraws its
 * stored sheets byte-for-byte, every gate PASSES, and there is no JPG anywhere
 * for the version being named. The next ordinary run then returns UP-TO-DATE and
 * skips it, for ever.
 *
 * The assertion that matters is the NEGATIVE one. A helper that answered "not
 * rendered" for everything would satisfy every case below but the first, and the
 * first is the state all twelve places and all eight towns are actually in.
 */
const mani = (s4runs, s4latest, s5runs) => ({
  stages: {
    S4: s4runs === null ? undefined : { latest: s4latest, runs: s4runs },
    S5: s5runs === null ? undefined : { latest: (s5runs.at(-1) || {}).id, runs: s5runs },
  },
});
const run = (v) => ({ id: `v${v}_2026-08-31_0507`, version: v });

test('a rendered S4 is not reported — the case every real map is in', () => {
  const m = mani([run('1.16'), run('1.17')], 'v1.17_2026-08-31_0507', [run('1.16'), run('1.17')]);
  assert.strictEqual(G.unrenderedS4(m), null);
});

test('an S4 committed with no S5 for it is reported, by version', () => {
  const m = mani([run('1.16'), run('1.17')], 'v1.17_2026-08-31_0507', [run('1.16')]);
  assert.strictEqual(G.unrenderedS4(m), '1.17');
});

test('...and it is the LATEST S4 that is asked about, not any of them', () => {
  // 1.16 was rendered and 1.17 is the head. An older gap is somebody else's
  // problem: the question is whether what the manifest advertises has a JPG.
  const m = mani([run('1.15'), run('1.16'), run('1.17')], 'v1.16_2026-08-31_0507', [run('1.16')]);
  assert.strictEqual(G.unrenderedS4(m), null);
});

test('no S5 stage at all is the same finding, not a crash', () => {
  const m = mani([run('2.1')], 'v2.1_2026-08-31_0507', null);
  assert.strictEqual(G.unrenderedS4(m), '2.1');
});

test('a place that has never built an S4 is not a finding', () => {
  assert.strictEqual(G.unrenderedS4(mani(null, null, null)), null);
  assert.strictEqual(G.unrenderedS4({}), null);
  assert.strictEqual(G.unrenderedS4(null), null);
});

test('an S4 run with no version recorded is not a finding — it cannot answer', () => {
  // Guessing the version out of the run id is exactly the reasoning this helper
  // exists to avoid; a run that predates versioning is unanswerable, not broken.
  const m = { stages: { S4: { latest: 'old', runs: [{ id: 'old' }] }, S5: { runs: [] } } };
  assert.strictEqual(G.unrenderedS4(m), null);
});

test('the versions are compared as strings, so 1.10 is not 1.1', () => {
  const m = mani([run('1.10')], 'v1.10_2026-08-31_0507', [run('1.1')]);
  assert.strictEqual(G.unrenderedS4(m), '1.10');
});


/* dataScriptDrift — the stored data vs the script that derives it (OA-188) ----
 *
 * The byte gate asks whether the current GENERATOR redraws a boarding sheet from
 * its stored index, and answers yes however old that index is. Three of the four
 * boarding sheets carried an index two script versions behind on 2026-08-30, with
 * 27 destinations whose trip counts the current script computes differently, and
 * every check in the system was correctly green.
 *
 * The controls matter more than the finding here. This runs over every place on
 * every board, and the estate is currently clean — so a helper that answered
 * "drifted" for an absent file, an unstamped file, or a place with no boarding
 * plan at all would turn eight towns and twelve places red on the day it landed,
 * which is how a gate gets muted in its first week.
 */
const drifted = (dir, assets, opts = {}) => {
  const put2 = (d, name, text) => fs.writeFileSync(path.join(d, name), text);
  if (opts.index !== null) put2(dir, 'boarding_index.json', JSON.stringify({ generatedBy: opts.index }));
  if (opts.stands !== undefined && opts.stands !== null) put2(dir, 'stands.json', JSON.stringify({ generatedBy: opts.stands }));
  if (opts.script !== null) put2(assets, 'boarding_index.py', `SCRIPT_VERSION = "${opts.script}"\n`);
  if (opts.standsScript) put2(assets, 'naptan_stands.py', `SCRIPT_VERSION = "${opts.standsScript}"\n`);
  return G.dataScriptDrift(dir, assets);
};
const twoDirs = (fn) => tmp((d) => {
  const data = path.join(d, 'data'), assets = path.join(d, 'assets');
  fs.mkdirSync(data); fs.mkdirSync(assets);
  return fn(data, assets);
});

test('an index written by the script on disk is not a finding', () => {
  twoDirs((data, assets) => {
    assert.deepStrictEqual(drifted(data, assets, { index: 'boarding_index.py v1.3', script: '1.3' }), []);
  });
});

test('an index written by an OLDER script version is the finding', () => {
  twoDirs((data, assets) => {
    const d = drifted(data, assets, { index: 'boarding_index.py v1.2', script: '1.3' });
    assert.strictEqual(d.length, 1);
    assert.strictEqual(d[0].file, 'boarding_index.json');
    assert.strictEqual(d[0].saidBy, '1.2');
    assert.strictEqual(d[0].current, '1.3');
  });
});

test('a NEWER stamp than the script is also a finding — the question is agreement', () => {
  // It happens when a checkout is behind, and reading it as "fine, it is ahead"
  // would be a gate that only looks one way down a road with traffic both ways.
  twoDirs((data, assets) => {
    assert.strictEqual(drifted(data, assets, { index: 'boarding_index.py v1.4', script: '1.3' }).length, 1);
  });
});

test('a place with no boarding index is not a finding', () => {
  twoDirs((data, assets) => {
    assert.deepStrictEqual(drifted(data, assets, { index: null, script: '1.3' }), []);
  });
});

test('an index with no generatedBy stamp is not a finding — it cannot answer', () => {
  twoDirs((data, assets) => {
    fs.writeFileSync(path.join(data, 'boarding_index.json'), JSON.stringify({ place: 'X' }));
    fs.writeFileSync(path.join(assets, 'boarding_index.py'), 'SCRIPT_VERSION = "1.3"\n');
    assert.deepStrictEqual(G.dataScriptDrift(data, assets), []);
  });
});

test('an unparseable index is not a finding — that is a different fault', () => {
  twoDirs((data, assets) => {
    fs.writeFileSync(path.join(data, 'boarding_index.json'), '{ not json');
    fs.writeFileSync(path.join(assets, 'boarding_index.py'), 'SCRIPT_VERSION = "1.3"\n');
    assert.deepStrictEqual(G.dataScriptDrift(data, assets), []);
  });
});

test('a missing script is not a finding — the question cannot be asked', () => {
  twoDirs((data, assets) => {
    assert.deepStrictEqual(drifted(data, assets, { index: 'boarding_index.py v1.2', script: null }), []);
  });
});

test('stands.json is asked the same question, and both can drift at once', () => {
  twoDirs((data, assets) => {
    const d = drifted(data, assets, {
      index: 'boarding_index.py v1.2', script: '1.3',
      stands: 'naptan_stands.py v1.1', standsScript: '1.2',
    });
    assert.strictEqual(d.length, 2);
    assert.deepStrictEqual(d.map((x) => x.file).sort(), ['boarding_index.json', 'stands.json']);
  });
});

test('the real assets directory and the real committed indexes agree', () => {
  // The control that cannot be faked by a fixture: every boarding place on the
  // estate as it stands must be clean, or this gate is red on the day it lands.
  const buses = 'C:/u3a St Ives/Using AI/Buses';
  if (!fs.existsSync(buses)) return;                 // CI checks this via prove-red-status
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name === 'ci-reference') { found.push(p); continue; }
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p);
    }
  };
  for (const top of ['Areas', 'Places']) {
    const p = path.join(buses, top);
    if (fs.existsSync(p)) walk(p);
  }
  for (const ref of found) {
    assert.deepStrictEqual(G.dataScriptDrift(ref), [], `${ref} has drifted`);
  }
});
