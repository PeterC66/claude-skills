#!/usr/bin/env node
/*
 * prove-known-off-parity.js — the JOIN between two implementations of one rule (OA-259).
 *
 * Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:
 *
 *     node tools/prove-known-off-parity.js
 *
 * WHAT THIS EXISTS FOR. A town's `verified-services.json` has FOUR ways to say "we know
 * about this route and deliberately do not draw it", and the two checkers that must
 * understand them cannot share a runtime: `verify_report.js` is JavaScript and
 * `gtfs_refresh_report.py` is Python. So the rule is written twice — `assets/known_off.js`
 * and `known_off_routes()` in `assets/gtfs_refresh_report.py` — which is exactly OA-135's
 * shape, four implementations of colour luminance that are not the same function.
 *
 * A comment saying "these two agree" is a claim about a JOIN, and only the JOIN can check
 * it. This is the join: one fixture through both, and the answers compared field for
 * field. It is the check the whole round was about — the original fault was two readers
 * disagreeing about what a town had written, and fixing that by writing a second reader
 * would have bought the same fault a year later.
 *
 * THE FIXTURES ARE BOTH KINDS. The synthetic ones carry every edge the two could differ
 * on: precedence between fields, a bare string entry, an entry naming no route, the
 * `servesTown:false` exclusion, `note` versus `reason` versus `reason`+`detail`, and a
 * field that is not an array at all. The REAL ones are every town on the estate, when
 * buses-data is beside this repository — because a rule that agrees on invented data and
 * disagrees on High Wycombe's eighteen entries has not been checked at all. The real half
 * is skipped, loudly, when the sibling repository is absent, and the synthetic half is
 * never skipped: a CI runner without buses-data still gets the edges.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { knownOff, CANONICAL_FIELD, DEPRECATED_FIELDS } = require('../assets/known_off');

const SK = path.join(__dirname, '..');
let failures = 0, ran = 0;

function check(name, ok, detail) {
  ran++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!ok) failures++;
}

/* The Python side, asked the same question through its own module. Spawned rather than
 * reimplemented, for the obvious reason: a harness that reimplements one of the two
 * things it is comparing is comparing the third. `python3`, not `python` — the
 * conventions page's rule, and the only one that resolves on a CI runner. */
function pythonAnswer(verified) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'known-off-parity-')), 'vs.json');
  fs.writeFileSync(f, JSON.stringify(verified));
  const code = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(path.join(SK, 'assets'))})`,
    'import gtfs_refresh_report as rr',
    `vs = json.load(open(${JSON.stringify(f)}, encoding="utf-8"))`,
    'found, skipped = rr.known_off_routes(vs)',
    'print(json.dumps({"found": {k: [v[0], v[1], v[2]] for k, v in found.items()},',
    '                  "skipped": sorted([s[0], s[2]] for s in skipped),',
    '                  "canonical": rr.KNOWN_OFF_CANONICAL,',
    '                  "deprecated": list(rr.KNOWN_OFF_DEPRECATED)}, sort_keys=True))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('python side failed:\n' + (r.stdout || '') + (r.stderr || ''));
  return JSON.parse(r.stdout);
}

/* The JavaScript side, flattened to the same shape so the two are compared as data and
 * not as two differently-shaped objects one of us happened to normalise. */
function jsAnswer(verified) {
  const { found, skipped } = knownOff(verified);
  const out = {
    found: {},
    skipped: skipped.map(s => [s.field, s.deprecated]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    canonical: CANONICAL_FIELD,
    deprecated: DEPRECATED_FIELDS,
  };
  for (const [route, rec] of found) out.found[route] = [rec.field, rec.reason, rec.deprecated];
  return out;
}

function compare(label, verified) {
  const js = jsAnswer(verified);
  let py;
  try { py = pythonAnswer(verified); } catch (e) { check(label, false, String(e.message).slice(0, 160)); return; }
  const jsKeys = Object.keys(js.found).sort(), pyKeys = Object.keys(py.found).sort();
  const same = JSON.stringify(jsKeys) === JSON.stringify(pyKeys)
    // field, reason AND the deprecated flag, because the whole point of the flag is that
    // a gate acts on it: two readers disagreeing about which field is canonical would
    // make that gate fire in one repository and not the other.
    && jsKeys.every(k => JSON.stringify(js.found[k]) === JSON.stringify(py.found[k]))
    && JSON.stringify(js.skipped) === JSON.stringify(py.skipped)
    && js.canonical === py.canonical
    && JSON.stringify(js.deprecated) === JSON.stringify(py.deprecated);
  check(label, same, same ? `${jsKeys.length} route(s), ${js.skipped.length} skipped`
    : `js ${JSON.stringify(js)}\n         py ${JSON.stringify(py)}`);
}

console.log('The JOIN: assets/known_off.js against known_off_routes() in gtfs_refresh_report.py\n');

console.log('1. Synthetic fixtures — every edge the two could differ on');
compare('an empty file yields nothing at all', { services: [] });
compare('one plain entry per field, all four read', {
  notOnLeaflet: [{ route: '101', note: 'seasonal weekend coach' }],
  verifiedNotDisplayed: [{ route: '1S', reason: 'school', detail: 'variant of 1' }],
  notDisplayed: [{ route: 'W9', reason: 'occasional excursion' }],
  excluded: [{ route: 'X32', reason: 'does not reach the town' }],
});
compare('precedence: the FIRST field to name a route wins', {
  notOnLeaflet: [{ route: '46', note: 'from notOnLeaflet' }],
  verifiedNotDisplayed: [{ route: '46', reason: 'from verifiedNotDisplayed' }],
  notDisplayed: [{ route: '46', reason: 'from notDisplayed' }],
  excluded: [{ route: '46', reason: 'from excluded' }],
});
compare('servesTown:false in notOnLeaflet is NOT known-off — it has a louder reader', {
  notOnLeaflet: [{ route: '400', servesTown: false, note: 'school contract' },
                 { route: '101', servesTown: true, note: 'seasonal' }],
});
compare("Huntingdon's older bare-string notDisplayed", { notDisplayed: ['400', '101', 'AW1'] });
compare('a numeric bare entry is the same as its string', { excluded: [415] });
compare("Beaconsfield's group entry names a class, not a route", {
  notDisplayed: [{ route: '604', reason: 'three dates only' },
                 { group: 'Dedicated school services', reason: 'not drawn' }],
});
compare('reason + detail are joined, and a bare reason is not doubled', {
  verifiedNotDisplayed: [{ route: '20', reason: 'withdrawn', detail: 'operator network review' },
                         { route: '36S', reason: 'school' },
                         { route: '644', reason: 'school', detail: 'school' }],
});
compare('an entry with an empty route is skipped, not keyed on ""', {
  excluded: [{ route: '', reason: 'nothing' }, { route: '415', reason: 'real' }],
});
compare('a field that is not an array is ignored rather than thrown on', {
  notDisplayed: { route: '9', reason: 'a dict where a list belongs' },
  excluded: [{ route: '415', reason: 'real' }],
});
compare('services[] is deliberately NOT one of the four', {
  services: [{ route: 'X46', servesTown: false, note: 'adjudicated off' }],
});

/*
 * 2. THE REAL ESTATE. Invented fixtures agree by construction — they were written by one
 * person thinking about one rule. The eight town files were not, and they are where the
 * conventions actually live: High Wycombe's eighteen `verifiedNotDisplayed` entries,
 * Beaconsfield's group block, Ramsey's `excluded`, Huntingdon's `notOnLeaflet`.
 */
console.log('\n2. Every town on the estate — the data the rule was written from');
/* BUSES_DIR set is a PROMISE that the real half will run, so a wrong value fails rather
 * than falling through to the skip. A harness that quietly does half its work when the
 * caller asked for all of it is the shape this whole round is about. */
if (process.env.BUSES_DIR && !fs.existsSync(path.join(process.env.BUSES_DIR, 'Areas'))) {
  check('BUSES_DIR was set, so the real half must run', false,
    `no Areas/ under ${process.env.BUSES_DIR} — the real town files were asked for and are not there`);
}
const BUSES = (process.env.BUSES_DIR && fs.existsSync(path.join(process.env.BUSES_DIR, 'Areas')) ? process.env.BUSES_DIR : null)
  || (process.env.BUSES_DIR ? null
      : [path.join(SK, '..', '..', '..', 'Using AI', 'Buses'), path.join(SK, '..', '..', 'buses-data')]
          .find(p => fs.existsSync(path.join(p, 'Areas'))));
if (!BUSES) {
  console.log('  SKIP  buses-data is not beside this repository — set BUSES_DIR to include the real half.');
  console.log('        The synthetic half above is never skipped, so the edges are still checked.');
} else {
  const areas = path.join(BUSES, 'Areas');
  const towns = fs.readdirSync(areas).filter(t => !t.startsWith('_')
    && fs.existsSync(path.join(areas, t, 'S1-services')));
  check('the estate really has towns to check', towns.length > 0, `${towns.length} found in ${areas}`);
  for (const town of towns) {
    const runs = fs.readdirSync(path.join(areas, town, 'S1-services')).sort()
      .filter(r => fs.existsSync(path.join(areas, town, 'S1-services', r, 'verified-services.json')));
    if (!runs.length) { check(`${town} has a verified-services.json`, false, 'no S1 run carries one'); continue; }
    const f = path.join(areas, town, 'S1-services', runs[runs.length - 1], 'verified-services.json');
    compare(town, JSON.parse(fs.readFileSync(f, 'utf8')));
  }
}

console.log('\n' + '='.repeat(78));
if (failures) {
  console.log(`FAILED — ${failures} of ${ran} check(s) did not hold. A failed COMPARISON means the two readers disagree about what a town wrote; a failed precondition means the harness could not ask the question it was told to.`);
  process.exit(1);
}
console.log(`OK — all ${ran} comparisons held: both checkers read the same four conventions the same way`);
