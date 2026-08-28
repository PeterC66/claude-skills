#!/usr/bin/env node
/*
 * prove-red-status.js — break the STATUS BOARD's engine-staleness gate on
 * purpose, and check that the board's exit code notices.
 *
 * WHY THIS FILE EXISTS. OA-151 folded `row.engineCurrent` into `status.js`'s
 * `bad` on 2026-08-28. Until then the Engine column was decoration: computed,
 * printed, and dropped — and decoration in the one place it mattered most,
 * because a Linux checkout used to compute a different engine hash from the
 * laptop that stamped the maps, so every town printed `f83987f11b STALE` in CI
 * while CI exited 0. Nothing ever went red, so nobody was wrong to miss it.
 *
 * That is precisely the state a new gate must not be left in. This project's
 * standing rule is that a green check nobody has watched go red proves nothing,
 * and OA-151 wrote the falsification into the row itself: "whichever is chosen,
 * prove it can go red by stamping one map with a wrong hash and watching the
 * board fail." This is that.
 *
 * ITS SIBLINGS AND WHAT IT ADDS. `prove-red.js` falsifies the unit suite and
 * `prove-red-gates.js` falsifies the five BYTE gates. Neither can reach this,
 * because the byte gate and the staleness check answer different questions about
 * the same map: the byte gate asks "does the current engine still draw these
 * exact bytes", the staleness check asks "was this map drawn by the current
 * engine at all". A map can pass one and fail the other — Ramsey does, today —
 * so a mutation that reddens the byte gate says nothing about this.
 *
 * NOTHING UNDER Areas/ OR Places/ IS TOUCHED. Every case builds a scratch Buses
 * tree in the OS temp dir holding one town — its `manifest.json` and its tracked
 * `ci-reference/` — and mutates the copy. `ci-reference/` is what a fresh CI
 * clone actually has (S4-generate is gitignored), so the copy is also the form
 * the gate really runs against in CI.
 *
 * THE FOUR CASES, and why the last two are not padding. The exception added with
 * the gate is keyed to a town AND an exact hash, so that it expires by itself
 * when Ramsey is rebuilt and cannot silently widen into "Ramsey is never
 * checked". That is a claim about behaviour, so it is tested like one: case 3
 * proves the exception actually excuses its own pair, and case 4 proves it stops
 * excusing the moment the hash changes. An exception nobody has watched stop
 * applying is the same failure as a gate nobody has watched go red.
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-red-status
 *     node tools/prove-red-status.js --buses "<path to the Buses repo>"
 *     node tools/prove-red-status.js --portal "<path to community-bus-maps>"
 *     node tools/prove-red-status.js --keep     leave the scratch trees on disk
 * `--buses` defaults to the Buses repo on Peter's laptop and `--portal` to
 * community-bus-maps beside it; both are only needed if that repo is checked out
 * somewhere else, which in CI it is.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const STATUS = path.join(ASSETS, 'status.js');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const bi = argv.indexOf('--buses');
const BUSES = (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : 'C:/u3a St Ives/Using AI/Buses';
const pi = argv.indexOf('--portal');
const PORTAL = (pi >= 0 && argv[pi + 1]) ? argv[pi + 1] : 'C:/Claude/community-bus-maps';

/* The donor town. It must be one whose engine stamp is CURRENT, or the control
 * is red before anything is mutated and the whole run proves nothing. Ramsey is
 * deliberately NOT the donor for that reason — it is the one town that is
 * legitimately stale, and it is the subject of cases 3 and 4 instead. */
const DONOR = 'Wisbech';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

/* Build a one-town scratch Buses tree and, optionally, rename the town and
 * re-stamp its engine hash. `engine: null` leaves the donor's own stamp alone,
 * which is what makes case 1 a control rather than a fifth mutation. */
function scratchTree({ town = DONOR, engine = null, withPlace = null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-status-'));
  const dst = path.join(root, 'Areas', town);
  const src = path.join(BUSES, 'Areas', DONOR);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
  copyDir(path.join(src, 'ci-reference'), path.join(dst, 'ci-reference'));
  if (withPlace) {
    const pd = path.join(root, 'Places', '_standalone', withPlace);
    const ps = path.join(BUSES, 'Places', '_standalone', withPlace);
    fs.mkdirSync(pd, { recursive: true });
    fs.copyFileSync(path.join(ps, 'manifest.json'), path.join(pd, 'manifest.json'));
    copyDir(path.join(ps, 'ci-reference'), path.join(pd, 'ci-reference'));
  }
  if (engine) {
    const rjPath = path.join(dst, 'ci-reference', 'routes.json');
    const rj = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
    rj.engine = engine;
    /* Written back with the SAME two-space indent the real files carry. Only the
     * `engine` field is read here and the byte gate reads the parsed object
     * rather than the bytes, but a scratch file that does not look like the real
     * one is how a harness quietly stops testing the real thing. */
    fs.writeFileSync(rjPath, JSON.stringify(rj, null, 2));
  }
  return root;
}

/* Run the board and return its exit code. --no-quality and --no-live keep this
 * about the one gate: the quality ledger lives in the real Buses repo (a scratch
 * tree has none) and the deployment row asks the live site a question that has
 * nothing to do with engine stamps. The PORTAL is the real one and is only read
 * — the vendoring-drift rows are part of `bad`, so a green control here is also
 * a statement that the portal is in sync, which is the honest reading of it. */
function board(busesDir) {
  let out, code = 0;
  try {
    out = execFileSync(process.execPath,
      [STATUS, '--buses', busesDir, '--portal', PORTAL, '--no-quality', '--no-live', '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    if (typeof e.status !== 'number') throw e;
    code = e.status;
    out = e.stdout;
  }
  /* The board prints its JSON and THEN sets the exit code, so a red run still
   * has a parseable body. Reading it is not decoration: without it a case that
   * goes red for a completely different reason -- a drifted portal row, a byte
   * gate that started failing -- scores as "caught" and this harness reports a
   * false green about the very gate it exists to falsify. "It went red" and
   * "it went red for this reason" are different claims, and only the second one
   * is what a mutation test is entitled to make. */
  let json = null;
  try { json = JSON.parse(out); } catch (e) { json = null; }
  return { code, json };
}

const CASES = [
  {
    label: 'control: donor town, its own current stamp',
    make: {},
    expect: 0,
    what: 'an unmutated board must be green, or a red one below proves nothing',
  },
  {
    label: 'a town stamped with a hash that is not current',
    make: { engine: 'deadbeef00' },
    expect: 1,
    what: 'THE GATE ITSELF - this exited 0 for as long as the hash existed',
  },
  {
    label: 'Ramsey at d8eb6961c7 - the dated exception',
    make: { town: 'Ramsey', engine: 'd8eb6961c7' },
    expect: 0,
    what: 'the exception must excuse its own town-and-hash pair',
  },
  {
    /* OA-057. The place-completeness column is REPORTED and deliberately not in
     * `bad`: seven of the ten places that draw an internal sheet are short today,
     * and gating on it would put seven permanent reds on a board a real failure
     * has to be spotted through. That is a contract, not a coincidence, and
     * "tidy up the last one while we are here" is exactly how such a rule is
     * lost -- it looks like housekeeping in review. This case fails the day
     * somebody folds it in early, the same way quality_metrics_ink.test.js
     * guards `labelsOverBadge`. When the rebuild round HAS run, the honest edit
     * is to flip this case's expectation and say why. */
    label: 'a place short of every completeness key stays GREEN',
    make: { withPlace: 'Godmanchester Co-op Cambridge Road' },
    expect: 0,
    also: (json) => {
      const p = (json.places || []).find(r => r.name === 'Godmanchester Co-op Cambridge Road');
      if (!p) return 'the board never saw the place at all';
      if (!p.keys || p.keys.state !== 'short') return 'the board saw it but did not judge it short: ' + JSON.stringify(p.keys);
      if (p.keys.missing.length !== 4) return 'expected all four keys missing, got ' + p.keys.missing.join('+');
      return null;
    },
    what: 'OA-057 is reported, not gated, until the rebuild round has run',
  },
  {
    label: 'Ramsey at some OTHER stale hash',
    make: { town: 'Ramsey', engine: 'deadbeef00' },
    expect: 1,
    what: 'keyed to the hash too, so a rebuilt Ramsey gates like any other town',
  },
];

const rows = [];
const kept = [];
let failed = 0;
for (const c of CASES) {
  const root = scratchTree(c.make);
  kept.push(root);
  const { code, json } = board(root);
  const stale = json && Array.isArray(json.engineStale) ? json.engineStale.map(r => r.town) : null;
  const wantRed = c.expect !== 0;
  const colourOk = (code !== 0) === wantRed;
  /* A green case must name NO stale town; a red case must name exactly the one
   * it mutated. Either way the cause is checked, not just the colour. */
  const causeOk = stale === null ? false
    : wantRed ? (stale.length === 1 && stale[0] === (c.make.town || DONOR))
              : stale.length === 0;
  /* A GREEN case needs more than a green exit: a map the board never FOUND is
   * green too, and an enumeration that quietly walks past a map is this
   * project's most-repeated bug. `also` is where a case says what the board must
   * have actually seen for its green to mean anything. */
  const alsoWhy = (c.also && json) ? c.also(json) : null;
  const ok = colourOk && causeOk && !alsoWhy;
  if (!ok) failed++;
  const verdict = !colourOk ? (wantRed ? 'SURVIVED' : 'CONTROL RED')
    : !causeOk ? 'RED, WRONG CAUSE'
    : alsoWhy ? 'VACUOUS'
    : wantRed ? 'caught' : 'green';
  rows.push([
    verdict,
    c.label,
    alsoWhy ? 'exit ' + code + ' BUT ' + alsoWhy
            : 'exit ' + code + ', stale ' + (stale === null ? '(unparseable)' : '[' + stale.join(',') + ']'),
    c.what,
  ]);
  if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
}

const w = [18, 52, 40];
for (const r of rows) console.log(r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]);
if (KEEP) for (const k of kept) console.log('kept  ' + k);

if (failed) {
  console.error('\n' + failed + ' of ' + CASES.length + ' cases did not behave as claimed - the engine-staleness gate is not what status.js says it is.');
  process.exitCode = 1;
} else {
  console.log('\nall ' + CASES.length + ' cases behaved as claimed: the gate goes red on a stale stamp, the Ramsey exception is exactly one town-and-hash pair wide, and the OA-057 completeness column is still reported rather than gated.');
}
