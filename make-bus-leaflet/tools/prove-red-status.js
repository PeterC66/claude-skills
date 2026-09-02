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
 * THE CASES, and why none of them is padding. (There were four when this was
 * written; the count in the summary line is computed, and this sentence is not.
 * Two more arrived with OA-170 -- a control and a mutation for the place
 * SCHEMATIC column, which had no gate above it at all until 2026-08-29.) The exception added with
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
const { scratchDir } = require('../assets/scratch');
const { resolveBuses } = require('../assets/cli');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const STATUS = path.join(ASSETS, 'status.js');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();
const bi = argv.indexOf('--buses');
const BUSES = resolveBuses({ buses: (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : undefined });
const pi = argv.indexOf('--portal');
const PORTAL = (pi >= 0 && argv[pi + 1]) ? argv[pi + 1] : 'C:/Claude/community-bus-maps';

/* The donor town. It must be one whose engine stamp is CURRENT, or the control is
 * red before anything is mutated and the whole run proves nothing.
 *
 * IT IS NOW DERIVED, AND IT USED TO BE A NAME. It was 'Ramsey' until 2026-08-28,
 * when Ramsey was rebuilt and the case that depended on its staleness broke; the
 * remedy was to name a different town, 'Wisbech'. On 2026-08-31 Wisbech was given a
 * dated staleness exception of its own — portal proposed-update #139 is with the
 * customer — and the two fixture-freshness cases went red on a fact about Wisbech
 * rather than about the gate. The same trap twice, moved one town along each time,
 * with a comment above it saying exactly what the requirement was.
 *
 * So ASK, rather than remember: the donor is the first town, in name order, whose
 * committed `engine` stamp equals the engine on disk right now. That is a claim
 * written down at both ends and it cannot go stale. A run with no current town at
 * all refuses loudly, because in that state every control here is red for the
 * room's reason and reporting the cases would be worse than not running.
 */
const { computeEngineVersion } = require('../assets/engine_version');
function pickDonor() {
  const areas = path.join(BUSES, 'Areas');
  const current = computeEngineVersion();
  const tried = [];
  for (const name of fs.readdirSync(areas).sort()) {
    const rjp = path.join(areas, name, 'ci-reference', 'routes.json');
    const mfp = path.join(areas, name, 'manifest.json');
    if (!fs.existsSync(rjp) || !fs.existsSync(mfp)) continue;
    let rj = null, mf = null;
    try { rj = JSON.parse(fs.readFileSync(rjp, 'utf8')); mf = JSON.parse(fs.readFileSync(mfp, 'utf8')); } catch (e) { continue; }
    // A latest S5 run as well: the areaFixture cases name their scratch render
    // folder out of the manifest, and a town with no S5 cannot supply one.
    const s5 = mf.stages && mf.stages.S5;
    const hasS5 = !!(s5 && s5.latest && (s5.runs || []).some(r => r.id === s5.latest));
    tried.push(`${name} @ ${rj.engine || '(none)'}${hasS5 ? '' : ' (no S5)'}`);
    if (rj.engine === current && hasS5) return name;
  }
  throw new Error('prove-red-status: no town carries the current engine stamp ' + current
    + ' AND a committed S5 run, so every control here would be red for the room\'s reason'
    + ' rather than for the gate\'s.\n  Towns seen: ' + tried.join(', ')
    + '\n  Rebuild a town onto the current engine, or run this after the next rollout.');
}
const DONOR = pickDonor();

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
/* `stripKeys` exists because the OA-057 fixture used to be free (2026-08-29).
 * The case borrowed a REAL place that happened to be short of all four
 * completeness keys, and on the day the rebuild round gave every place its keys
 * the fixture stopped being short -- so the case reported SURVIVED and read as a
 * gate that does not work, when what had actually happened is that the estate got
 * better underneath it. A fixture built out of whatever the estate happens to look
 * like today tests the estate, not the code. This one now MAKES the place short. */
function scratchTree({ town = DONOR, engine = null, withPlace = null, stripKeys = false, withTownPlace = null, mutateSchematic = false, ageIndex = null, areaFixture = null, portalFixture = null, feedInfo = null }) {
  const root = scratchDir('prove-red-status-');
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
    if (stripKeys) {
      const rjPath = path.join(pd, 'ci-reference', 'routes.json');
      const rj = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
      delete rj.frequency; delete rj.panelGroups;
      if (rj.design) delete rj.design.frequencyTiers;
      if (rj.internalRoads) delete rj.internalRoads.termini;
      fs.writeFileSync(rjPath, JSON.stringify(rj, null, 2));
    }
  }
  /* A PLACE THAT LIVES UNDER A TOWN, which `withPlace` above cannot express -- it
   * only knows Places/_standalone. The schematic column (OA-170) has exactly one
   * subject on the whole estate, High Wycombe Aldi, and it is town-nested. It is
   * copied under the DONOR town rather than under a scratch High Wycombe, because a
   * second town would need a town manifest of its own and the gate being tested does
   * not read one; the Town column reads the donor's name and nothing judges it. */
  if (withTownPlace) {
    const pd = path.join(dst, 'Places', withTownPlace.place);
    const ps = path.join(BUSES, 'Areas', withTownPlace.town, 'Places', withTownPlace.place);
    fs.mkdirSync(pd, { recursive: true });
    fs.copyFileSync(path.join(ps, 'manifest.json'), path.join(pd, 'manifest.json'));
    copyDir(path.join(ps, 'ci-reference'), path.join(pd, 'ci-reference'));
    /* OA-188 -- age the STORED DATA rather than the sheet. `boarding_index.json` is
     * derived by `boarding_index.py` and stamped with the version that wrote it, and
     * a sheet drawn from a two-versions-old index still reproduces byte-for-byte
     * because the generator is fed that same file. Rewriting the stamp is exactly
     * what three of the four boarding places actually looked like on 2026-08-30. */
    if (ageIndex) {
      const ip = path.join(pd, 'ci-reference', 'boarding_index.json');
      if (!fs.existsSync(ip)) throw new Error('fixture has no boarding_index.json -- pick a place with a boarding plan');
      const j = JSON.parse(fs.readFileSync(ip, 'utf8'));
      if (!/ v[\d.]+$/.test(String(j.generatedBy || '')))
        throw new Error('fixture boarding_index.json carries no "<script> v<n.n>" stamp: ' + j.generatedBy);
      j.generatedBy = String(j.generatedBy).replace(/ v[\d.]+$/, ' v' + ageIndex);
      fs.writeFileSync(ip, JSON.stringify(j, null, 2));
    }
    if (mutateSchematic) {
      /* One attribute on one label. NOT a line PLACE_IGNORE drops (it drops y="16"
       * and y="208" -- the title and the version stamp), or this would mutate the
       * sheet, the gate would rightly stay green, and the case would read as a gate
       * failure when it was the fixture's fault. */
      const sv = path.join(pd, 'ci-reference', 'internal-schematic.svg');
      const txt = fs.readFileSync(sv, 'utf8');
      const find = 'font-size="2.5"';
      if (txt.split(find).length - 1 < 1) throw new Error('fixture no longer contains ' + find + ' -- pick another mutation');
      fs.writeFileSync(sv, txt.replace(find, 'font-size="2.6"'));
    }
  }
  /* THE PORTAL PLACE FIXTURE (OA-188's remaining half, 2026-08-31). gatePortalFixture()
   * reads `Places/_portal-fixture/<name>` out of the Buses tree and runs the PORTAL's
   * vendored engine against it, so a scratch case needs a real fixture folder copied
   * whole — the portal side is the live one and is not mutated.
   *
   * `portalFixture: { name, ageIndex }`. Ageing the stored index rather than the sheet
   * is the whole point: the sheet still redraws byte-for-byte, because the generator is
   * fed that same file, which is exactly why the byte gate and the portal's own
   * refresh-place-fixture.mjs both said nothing while a fixture was 924 bytes behind. */
  if (portalFixture) {
    const fs_ = path.join(BUSES, 'Places', '_portal-fixture', portalFixture.name);
    const fd = path.join(root, 'Places', '_portal-fixture', portalFixture.name);
    if (!fs.existsSync(fs_)) throw new Error('prove-red-status: no portal fixture named ' + portalFixture.name);
    copyDir(fs_, fd);
    if (portalFixture.ageIndex) {
      const ip = path.join(fd, 'boarding_index.json');
      if (!fs.existsSync(ip)) throw new Error('prove-red-status: that fixture has no boarding_index.json -- pick one with a boarding plan');
      const j = JSON.parse(fs.readFileSync(ip, 'utf8'));
      if (!/ v[\d.]+$/.test(String(j.generatedBy || '')))
        throw new Error('prove-red-status: fixture boarding_index.json carries no "<script> v<n.n>" stamp: ' + j.generatedBy);
      j.generatedBy = String(j.generatedBy).replace(/ v[\d.]+$/, ' v' + portalFixture.ageIndex);
      fs.writeFileSync(ip, JSON.stringify(j, null, 2));
    }
  }
  /* THE COMMITTED AREA FIXTURE (OA-182, 2026-08-30). fixtureFreshness() compares
   * `Areas/_portal-fixture/St Ives`'s SVGs with the newest S5 render of
   * `Areas/St Ives`, so a case for it needs both — and neither exists in a fresh
   * clone, which is exactly why the gate is laptop-only and why this harness has
   * to MAKE them rather than borrow them. `areaFixture: 'same' | 'differs'`.
   *
   * The render folder is NAMED FROM THE TOWN'S OWN MANIFEST, not invented: the
   * check asks the manifest which S5 run is latest — a directory listing sorted
   * as strings puts `v1.9` after `v1.23`, which is how the first cut of the check
   * called a ten-minute-old fixture stale — so a scratch folder under any other
   * name would be invisible to it and this case would report SURVIVED about a
   * gate that works. */
  if (areaFixture) {
    const man = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
    const s5 = man.stages && man.stages.S5;
    const rec = s5 && (s5.runs || []).find(r => r.id === s5.latest);
    if (!rec) throw new Error('prove-red-status: the donor manifest has no latest S5 run to name the scratch render after');
    const runDir = path.join(dst, rec.dir);
    fs.mkdirSync(runDir, { recursive: true });
    const NEWEST = '<svg><!-- the newest render --></svg>';
    fs.writeFileSync(path.join(runDir, 'internal.svg'), NEWEST);
    const fix = path.join(root, 'Areas', '_portal-fixture', 'St Ives');
    fs.mkdirSync(fix, { recursive: true });
    fs.writeFileSync(path.join(fix, 'internal.svg'),
      areaFixture === 'same' ? NEWEST : '<svg><!-- an OLDER render, frozen --></svg>');
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
  // LAST, so it sees every boarding index the tree ended up with, from whichever
  // branch above put it there (OA-210).
  if (feedInfo) writeFeedInfo(root, feedInfo);
  return root;
}

/* Run the board and return its exit code. --no-quality and --no-live keep this
 * about the one gate: the quality ledger lives in the real Buses repo (a scratch
 * tree has none) and the deployment row asks the live site a question that has
 * nothing to do with engine stamps. The PORTAL is the real one and is only read
 * — the vendoring-drift rows are part of `bad`, so a green control here is also
 * a statement that the portal is in sync, which is the honest reading of it. */
function board(busesDir, statusPath = STATUS, portalDir = PORTAL) {
  let out, code = 0;
  try {
    out = execFileSync(process.execPath,
      [statusPath, '--buses', busesDir, '--portal', portalDir, '--no-quality', '--no-live', '--json'],
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

/* A scratch copy of the engine whose ENGINE_STALE_ALLOWED carries exactly one
 * entry. The list is EMPTY in the real status.js and should normally stay that
 * way -- an exception excuses a town from the staleness gate, so a live one is a
 * hole somebody has to justify. This case used to depend on the live Ramsey
 * entry, and when that entry was retired on 2026-08-28 (OA-072 answered, Ramsey
 * rebuilt onto the current engine) the control went red: the harness was
 * asserting a fact about today's config rather than about the mechanism.
 *
 * Building the exception here proves the mechanism whether or not any real one
 * exists, and means retiring the last live exception can never again break the
 * proof that exceptions work. assets/ itself is not touched -- the whole folder
 * is copied first, the same way tools/prove-red.js does it. */
function statusWithException(town, engine) {
  const root = scratchDir('prove-red-status-engine-');
  copyDir(ASSETS, path.join(root, 'assets'));
  const f = path.join(root, 'assets', 'status.js');
  const src = fs.readFileSync(f, 'utf8');
  /*
   * THE ANCHOR MADE THE SAME MISTAKE THE CASE ALREADY LEARNED, one level up.
   *
   * The paragraph above says this case used to depend on a LIVE exception and
   * broke when that exception was retired, and that building its own is what
   * makes it a claim about the mechanism. True — but the anchor it built with was
   * the literal string `const ENGINE_STALE_ALLOWED = [];`, which is a claim that
   * the live list is EMPTY. On 2026-08-31 a real dated exception was added for
   * Wisbech (portal proposed-update #139 with the customer), the anchor stopped
   * matching, and this harness threw on every buses-data CI run — correctly
   * refusing rather than reporting a case it could not inject, and red for a
   * reason that had nothing to do with the gate under test.
   *
   * Replace the whole DECLARATION instead of a particular value of it, so the
   * injected list is exactly one entry whatever the real one holds. The match is
   * asserted to be unique: an anchor that silently matched twice would leave a
   * second copy of the array and the mutation would not be what it says it is.
   */
  const DECL = /const ENGINE_STALE_ALLOWED = \[[^\]]*\];/g;
  const hits = src.match(DECL) || [];
  if (hits.length !== 1) {
    throw new Error('prove-red-status: expected exactly one `const ENGINE_STALE_ALLOWED = [...];` '
      + 'declaration in status.js, found ' + hits.length + '. This case injects its own exception by '
      + 'replacing that whole declaration; re-point it at whatever replaced it.');
  }
  const one = "const ENGINE_STALE_ALLOWED = [{ town: '" + town + "', engine: '" + engine
    + "', since: '2026-08-28', why: 'injected by prove-red-status.js' }];";
  fs.writeFileSync(f, src.replace(DECL, one));
  return { statusPath: f, root };
}

/* THE BODS FEED THE SCRATCH TREE IS SUPPOSED TO HAVE (OA-210).
 *
 * dataFeedDrift() compares `boarding_index.json.feed` against
 * `_gtfs/feed_info_<region>.json`, and a scratch tree has no `_gtfs/` at all —
 * so without this every case here would be a check sited where its subject
 * cannot exist, returning "cannot tell" for ever and reporting green about a
 * mechanism nothing had run. That is a shape this project has already paid for.
 *
 * The feed_version is taken FROM the index the tree actually holds rather than
 * written as a literal, so 'match' is by construction a match and cannot rot when
 * the estate is next refreshed. 'stale' bumps it, which is exactly what a feed
 * rebuilt in place does. Passing nothing writes no `_gtfs/` and is the third
 * case: absent must read as cannot-tell, never as a finding.
 */
function writeFeedInfo(root, mode) {
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'boarding_index.json') found.push(p);
    }
  })(root);
  if (!found.length) throw new Error('prove-red-status: feedInfo asked for, but the scratch tree holds no boarding_index.json');
  const gtfs = path.join(root, '_gtfs');
  fs.mkdirSync(gtfs, { recursive: true });
  let wrote = 0;
  for (const p of found) {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j.feed || !j.region) throw new Error('prove-red-status: ' + p + ' carries no feed/region stamp — pick an index written by boarding_index.py v1.4 or later');
    const region = String(j.region).replace(/\.sqlite$/i, '');
    const version = mode === 'stale' ? String(j.feed).replace(/^\d{8}/, d => String(Number(d) + 1)) : String(j.feed);
    if (mode === 'stale' && version === String(j.feed)) throw new Error('prove-red-status: could not bump the feed version ' + j.feed + ' — the mutation would be a no-op');
    fs.writeFileSync(path.join(gtfs, 'feed_info_' + region + '.json'),
      JSON.stringify({ built: '2026-09-01 00:00', feed_info: { feed_version: version } }, null, 1));
    wrote++;
  }
  return wrote;
}

/* The one place on the estate with a boarding plan under a town, which is what
 * `withTownPlace` can express. Named once so the four OA-210 cases below cannot
 * drift apart from each other. */
const FEED_PLACE = { town: 'St Ives', place: 'St Ives Bus Station' };

const CASES = [
  {
    /* OA-182, GATED from the day it landed (2026-08-30). Two cases and not one,
     * because the interesting failure of a freshness check is not that it misses
     * a stale fixture — it is that it fires on a FRESH one and gets muted inside
     * the week. The first cut of this check did precisely that: it sorted version
     * folders as strings, so `v1.9_2026-08-18` beat `v1.23_2026-08-30` and a
     * fixture recut ten minutes earlier was reported stale. The control below is
     * the case that would have caught it.
     *
     * The town is named 'St Ives' because the check names that fixture by name;
     * the CONTENT is the donor's, which nothing in this gate reads. */
    label: 'the committed area fixture matches the newest render',
    make: { town: 'St Ives', areaFixture: 'same' },
    expect: 0,
    /* A green exit is also what a board that never LOOKED would return, and a
     * freshness check that silently finds nothing is the exact failure this one
     * had on its first run (it took latestRunDir's {dir, rec} for a path and
     * returned no rows at all). So the control asserts the row exists. */
    also: (json) => {
      const rows = json.fixtureFreshness || [];
      if (!rows.length) return 'the board reported no fixture-freshness row at all';
      if (rows[0].stale.length) return 'it called a matching fixture stale: ' + rows[0].stale.join(', ');
      return null;
    },
    what: 'a freshness check that cries wolf on a fresh fixture is muted in a week',
  },
  {
    label: 'the committed area fixture is a version behind',
    make: { town: 'St Ives', areaFixture: 'differs' },
    expect: 1,
    cause: 'fixture',
    also: (json) => {
      const rows = json.fixtureFreshness || [];
      if (!rows.length) return 'the board went red without reporting a fixture row';
      if (!rows[0].stale.includes('internal.svg')) return 'red, but not about internal.svg: ' + JSON.stringify(rows[0]);
      return null;
    },
    what: 'OA-182 - a gate against a frozen fixture PASSes about code that never shipped',
  },
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
    label: 'an INJECTED exception excuses its own town-and-hash pair',
    make: { town: 'Ramsey', engine: 'd8eb6961c7' },
    engineException: { town: 'Ramsey', engine: 'd8eb6961c7' },
    expect: 0,
    what: 'the mechanism still works, with no live exception needed to show it',
  },
  {
    /* OA-057, FLIPPED 2026-08-29, which is what the previous version of this
     * comment said the honest edit would be. It read: the column is REPORTED and
     * deliberately not in `bad`, because seven of the ten places that draw an
     * internal sheet were short and gating would put seven permanent reds on a
     * board a real failure has to be spotted through -- and "tidy up the last one
     * while we are here" is how such a rule gets lost, because it looks like
     * housekeeping in review. The case existed to fail the day somebody folded it
     * in early. OA-019's round two ran on 2026-08-29 and closed all seven, so the
     * board is 10 of 10 and the reason to hold it out has gone. The case is kept
     * rather than deleted, with its expectation inverted, so the column is now
     * pinned the other way: it fails the day somebody quietly takes the gate back
     * out. The [also] assertion is unchanged and still does the real work -- a
     * green exit is also what a board that never FOUND the place would return, so
     * it asserts the board saw the place and judged it short of all four keys. */
    label: 'a place short of every completeness key now goes RED',
    make: { withPlace: 'Godmanchester Co-op Cambridge Road', stripKeys: true },
    expect: 1,
    cause: 'keys',
    also: (json) => {
      const p = (json.places || []).find(r => r.name === 'Godmanchester Co-op Cambridge Road');
      if (!p) return 'the board never saw the place at all';
      if (!p.keys || p.keys.state !== 'short') return 'the board saw it but did not judge it short: ' + JSON.stringify(p.keys);
      if (p.keys.missing.length !== 4) return 'expected all four keys missing, got ' + p.keys.missing.join('+');
      return null;
    },
    what: 'OA-057 is GATED now the rebuild round has run -- and stays gated',
  },
  {
    /* OA-170. The place schematic joined the board on 2026-08-29, and it is the only
     * sheet kind that was ever committed to ci-reference with no gate above it: High
     * Wycombe Aldi's had drifted to the TOWN's title and had lost a forced POI, on a
     * map published on busmaps.uk, and the correction arrived as a side effect of a
     * round about something else entirely.
     *
     * THE CONTROL IS NOT PADDING HERE. The column was red the first time it was
     * added, and not because the sheet was wrong -- status.js regenerated it WITHOUT
     * OVERRIDES_FILE while rollout_places.js builds it WITH one, so the two were
     * running different procedures and calling the difference drift. This case is
     * green only while they agree. */
    label: 'control: a place schematic reproduces byte-for-byte',
    make: { withTownPlace: { town: 'High Wycombe', place: 'High Wycombe Aldi' } },
    expect: 0,
    also: (json) => {
      const p = (json.places || []).find(r => r.name === 'High Wycombe Aldi');
      if (!p) return 'the board never saw the place at all';
      if (p.schematic !== 'PASS') return 'the board saw it but its schematic read ' + p.schematic;
      return null;
    },
    what: 'green here means the gate and the rollout build the sheet the same way',
  },
  {
    label: 'a place schematic that no longer reproduces goes RED',
    make: { withTownPlace: { town: 'High Wycombe', place: 'High Wycombe Aldi' }, mutateSchematic: true },
    expect: 1,
    cause: 'schematic',
    also: (json) => {
      const p = (json.places || []).find(r => r.name === 'High Wycombe Aldi');
      if (!p) return 'the board never saw the place at all';
      if (p.schematic !== 'DIFF') return 'the board saw it but its schematic read ' + p.schematic;
      return null;
    },
    what: 'THE GATE ITSELF - this column exited 0 whatever the sheet said, until OA-170',
  },
  {
    /* OA-188. The boarding sheet is drawn from `boarding_index.json`, which is
     * DERIVED by `boarding_index.py` and only ever copied forward by `seedPrevS4`
     * -- so no rollout has ever re-derived it. The byte gate above cannot see that:
     * it asks whether the current GENERATOR redraws the sheet from that file, and
     * the answer is yes however old the file is. On 2026-08-30 three of the four
     * boarding sheets held an index a script version behind, 27 destinations across
     * them had trip counts the current script computes differently, and status.js
     * said PASS and rollout_places.js said UP-TO-DATE, both correctly.
     *
     * THE CONTROL IS THE HALF THAT KEEPS THE GATE ALIVE. Every boarding place on
     * the estate is current today, which is the silence this gate has to keep; one
     * that reddened a clean place would be muted inside the week, and the whole
     * reason it could be added at all is that the arrears were cleared first. */
    label: 'control: a boarding index written by the script on disk',
    make: { withTownPlace: { town: 'St Ives', place: 'St Ives Bus Station' } },
    expect: 0,
    also: (json) => {
      const p = (json.places || []).find(r => r.name === 'St Ives Bus Station');
      if (!p) return 'the board never saw the place at all';
      if (p.boarding !== 'PASS') return 'the board saw it but its boarding read ' + p.boarding;
      if (p.indexDrift && p.indexDrift.length) return 'the board reported drift on a clean fixture: ' + JSON.stringify(p.indexDrift);
      return null;
    },
    what: 'green here means the gate is quiet on the estate as it actually stands',
  },
  {
    label: 'a boarding index two script versions behind goes RED',
    make: { withTownPlace: { town: 'St Ives', place: 'St Ives Bus Station' }, ageIndex: '0.9' },
    expect: 1,
    cause: 'index',
    also: (json) => {
      const p = (json.places || []).find(r => r.name === 'St Ives Bus Station');
      if (!p) return 'the board never saw the place at all';
      // The SHEET still reproduces -- that is the entire point of the row, so a
      // case that reddened the byte gate instead would be testing the wrong thing.
      if (p.boarding !== 'INDEX-STALE') return 'the board saw it but its boarding read ' + p.boarding;
      if (!p.indexDrift || !p.indexDrift.length) return 'the cell said INDEX-STALE with no drift recorded behind it';
      if (p.indexDrift[0].saidBy !== '0.9') return 'the drift names version ' + p.indexDrift[0].saidBy + ', not the one the fixture wrote';
      return null;
    },
    what: 'THE GATE ITSELF - the sheet still redraws byte-for-byte, and the DATA is stale',
  },
  {
    /* OA-188's remaining half. The CONTROL comes first for the reason the whole file
     * is built around: this gate is being added to a table whose every row is already
     * green, so "it stayed green" has to be shown to mean something before "it went
     * red" is worth anything. */
    label: 'control: a portal fixture whose stored index is current',
    make: { portalFixture: { name: 'High Wycombe High Street' } },
    expect: 0,
    also: (json) => {
      const f = (json.portalFixtures || []).find(r => r.name === 'High Wycombe High Street');
      if (!f) return 'the board never saw the fixture at all';
      if (f.boarding !== 'PASS') return 'the fixture boarding read ' + f.boarding + ', so this control proves nothing';
      return null;
    },
    what: 'green here means the gate is quiet on the fixtures as they actually stand',
  },
  {
    label: 'a portal fixture with a two-versions-behind index goes RED',
    make: { portalFixture: { name: 'High Wycombe High Street', ageIndex: '0.9' } },
    expect: 1,
    cause: 'index',
    also: (json) => {
      const f = (json.portalFixtures || []).find(r => r.name === 'High Wycombe High Street');
      if (!f) return 'the board never saw the fixture at all';
      if (f.boarding !== 'INDEX-STALE') return 'the fixture boarding read ' + f.boarding + ', not INDEX-STALE';
      if (!f.indexDrift || !f.indexDrift.length) return 'the cell said INDEX-STALE with no drift recorded behind it';
      if (f.indexDrift[0].saidBy !== '0.9') return 'the drift names version ' + f.indexDrift[0].saidBy + ', not the one the fixture wrote';
      return null;
    },
    what: 'THE GATE ITSELF - the portal fixture redraws byte-for-byte and its DATA is stale, which is what refresh-place-fixture.mjs called unchanged',
  },
  /* OA-210 — THE FEED HALF. dataScriptDrift() versions the derivation SCRIPT;
   * these four are about the DATA. On the morning of 2026-08-31 three of the four
   * boarding indexes were built at 05:07 and the Buckinghamshire feed was rebuilt
   * in place at 10:01, and High Wycombe High Street shipped eleven destinations
   * whose trip counts today's feed does not reproduce. Every check in the estate
   * was green and every one of them was right — the byte gates redraw the sheet
   * from the stored index, and dataScriptDrift() read v1.3 on both sides because
   * the SCRIPT had not moved.
   *
   * ALL FOUR EXPECT EXIT 0, and that is the claim rather than a weakening of it:
   * FEED-STALE is REPORTED and does not gate, because clearing it costs a
   * re-count plus a rebuild and a monthly feed refresh (OA-091) would fire it on
   * every boarding place every month. So the case cannot lean on the exit code
   * at all, and `also` carries the whole weight — which is why the red one
   * asserts the two VERSIONS as well as the cell. */
  {
    label: 'control: a boarding index counted from the feed that is on disk',
    make: { withTownPlace: FEED_PLACE, feedInfo: 'match' },
    expect: 0,
    also: (json) => {
      const p = (json.places || []).find(r => r.name === FEED_PLACE.place);
      if (!p) return 'the board never saw the place at all';
      if (p.boarding !== 'PASS') return 'the place boarding read ' + p.boarding + ', so this control proves nothing';
      if (!p.feedDrift || p.feedDrift.length) return 'a matching feed was reported as drift';
      return null;
    },
    what: 'green here means the check is quiet when the index counted the feed on disk',
  },
  {
    label: 'a boarding index counted from a feed since rebuilt reads FEED-STALE',
    make: { withTownPlace: FEED_PLACE, feedInfo: 'stale' },
    expect: 0,
    also: (json) => {
      const p = (json.places || []).find(r => r.name === FEED_PLACE.place);
      if (!p) return 'the board never saw the place at all';
      // The SHEET still reproduces and the SCRIPT has not moved -- that is the
      // whole row, so a case that reddened the byte gate or INDEX-STALE instead
      // would be testing something else.
      if (p.boarding !== 'FEED-STALE') return 'the board saw it but its boarding read ' + p.boarding;
      if (!p.feedDrift || !p.feedDrift.length) return 'the cell said FEED-STALE with no drift recorded behind it';
      const d = p.feedDrift[0];
      if (d.said === d.current) return 'the drift names the same version on both sides, so the mutation did nothing';
      return null;
    },
    what: 'THE CHECK ITSELF - the sheet redraws byte-for-byte, the script is current, and the DATA is of a feed that is gone',
  },
  {
    label: 'no feed_info on disk reads as cannot-tell, not as a finding',
    make: { withTownPlace: FEED_PLACE },                       // no feedInfo: the tree has no _gtfs at all
    expect: 0,
    also: (json) => {
      const p = (json.places || []).find(r => r.name === FEED_PLACE.place);
      if (!p) return 'the board never saw the place at all';
      if (p.boarding !== 'PASS') return 'an unanswerable question became a finding: boarding read ' + p.boarding;
      if (!p.feedDrift || p.feedDrift.length) return 'a feed nobody can read was reported as drift';
      return null;
    },
    what: 'the same rule dataScriptDrift() adopted for an absent stamp - a board red for a fact nobody can act on is muted in a week',
  },
  {
    label: 'a PORTAL FIXTURE whose index counted a feed since rebuilt reads FEED-STALE',
    make: { portalFixture: { name: 'High Wycombe High Street' }, feedInfo: 'stale' },
    expect: 0,
    also: (json) => {
      const f = (json.portalFixtures || []).find(r => r.name === 'High Wycombe High Street');
      if (!f) return 'the board never saw the fixture at all';
      if (f.boarding !== 'FEED-STALE') return 'the fixture boarding read ' + f.boarding + ', not FEED-STALE';
      if (!f.feedDrift || !f.feedDrift.length) return 'the cell said FEED-STALE with no drift recorded behind it';
      return null;
    },
    what: 'OA-210 asked what the PORTAL answer is - refresh-place-fixture.mjs regenerates from the fixture\'s own data and cannot see this; the buses tree asks it for both',
  },
  {
    label: 'Ramsey at some OTHER stale hash',
    make: { town: 'Ramsey', engine: 'deadbeef00' },
    expect: 1,
    what: 'keyed to the hash too, so a rebuilt Ramsey gates like any other town',
  },
];

/* ---- PREFLIGHT: is the ROOM green before any case runs? (OA-200) -----------
 *
 * Every case here judges an EXIT CODE, and the board's exit code answers about
 * everything it can see — including the real portal, which this harness reads and
 * does not own. Anything red out there reddens every case whose `expect` is 0,
 * and `CONTROL RED` and `caught` are the same exit code seen from two different
 * expectations. That is not hypothetical: on 2026-08-31 three of nine controls
 * were red because the local portal checkout sat on a feature branch, the harness
 * printed CONTROL RED in a column nobody read, and against a tree pinned at
 * origin/main the same code was 11 of 11 green. A harness whose controls are red
 * for an ambient reason is one whose FINDINGS cannot be trusted either.
 *
 * So the room is measured first, on a scratch Buses tree holding NO maps at all:
 * nothing but the environment can colour that board, and a non-zero exit from it
 * is a statement about the room and nothing else. It ABORTS rather than reporting,
 * because the one thing already proved not to work is saying it in a column. Exit
 * 2, not 1: "this harness could not run" is a different claim from "a gate does
 * not work", and a caller that cannot tell them apart learns the wrong thing. */
function preflight() {
  const empty = scratchDir('prove-red-status-preflight-');
  const { code, json } = board(empty);
  if (!KEEP) fs.rmSync(empty, { recursive: true, force: true });
  if (code === 0) return;

  console.error('prove-red-status: the board is already red on an EMPTY tree, so nothing this harness');
  console.error('reports would be about the gate it points at. Clear the room first, then re-run.\n');
  const src = json && json.portalDriftSource;
  if (src) {
    console.error('  vendoring rows read from ' + (src.ref ? src.ref + ' ' + src.sha : 'THE WORKING TREE at ' + src.dir)
      + ' · checkout on ' + (src.branch || '?') + ' @ ' + (src.head || '?'));
  }
  const drift = ((json && json.portalDrift) || []).filter(r => r.same === false || r.same === null);
  for (const r of drift) console.error('  ' + (r.status || (r.same === null ? 'MISSING' : 'DRIFTED')).padEnd(10) + r.file + (r.note ? '  — ' + r.note : ''));
  if (!drift.length) console.error('  (the vendoring rows are clean — read the board itself: node assets/status.js --no-quality --no-live)');
  process.exit(2);
}
preflight();

const rows = [];
const kept = [];
let failed = 0;
for (const c of CASES) {
  const root = scratchTree(c.make);
  kept.push(root);
  const inj = c.engineException ? statusWithException(c.engineException.town, c.engineException.engine) : null;
  if (inj) kept.push(inj.root);
  /* The injected case runs a COPY of status.js, and portalDrift() derives the
   * skill root from its own location -- so from a scratch folder every vendored
   * file reads MISSING and the board goes red for a reason this case is not
   * about. Point it at no portal at all: portalDrift() returns [] for a path
   * that does not exist, which leaves exactly the towns section this case
   * exists to judge. The other four cases still run against the real portal. */
  const portalFor = inj ? path.join(root, '__no-portal__') : PORTAL;
  const { code, json } = board(root, inj ? inj.statusPath : STATUS, portalFor);
  const stale = json && Array.isArray(json.engineStale) ? json.engineStale.map(r => r.town) : null;
  const wantRed = c.expect !== 0;
  const colourOk = (code !== 0) === wantRed;
  /* A green case must name NO stale town; a red case must name exactly the one
   * it mutated. Either way the cause is checked, not just the colour. */
  /* `cause: '<anything>'` says this case expects a DIFFERENT gate to fire, and
   * the discrimination is kept either way: such a case must still name NO stale
   * town, so it cannot pass by tripping the staleness gate instead, and its
   * `also` says which gate it DID mean. 'keys' was the first (2026-08-29) and
   * 'fixture' the second (2026-08-30, OA-182).
   *
   * `cause: 'keys'` says this case expects a DIFFERENT gate to fire (2026-08-29).
   * Every case here used to be about engine staleness, so a red exit that named
   * no stale town could only be a wrong-cause red. The OA-057 completeness column
   * became a gate on 2026-08-29 and its case now expects a red that names no
   * stale town at all -- which the old test scored as RED, WRONG CAUSE. The
   * discrimination is the point and is kept either way: a keys case must name NO
   * stale town, so it still cannot pass by tripping the staleness gate instead. */
  const causeOk = stale === null ? false
    : c.cause ? stale.length === 0
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
  if (!KEEP) { fs.rmSync(root, { recursive: true, force: true });
    if (inj) fs.rmSync(inj.root, { recursive: true, force: true }); }
}

const w = [18, 52, 40];
for (const r of rows) console.log(r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]);
if (KEEP) for (const k of kept) console.log('kept  ' + k);

if (failed) {
  console.error('\n' + failed + ' of ' + CASES.length + ' cases did not behave as claimed - the engine-staleness gate is not what status.js says it is.');
  process.exitCode = 1;
} else {
  console.log('\nall ' + CASES.length + ' cases behaved as claimed: the gate goes red on a stale stamp, an injected exception is exactly one town-and-hash pair wide, the OA-057 completeness column is gated, and the OA-170 place-schematic column is gated -- each of the last two red for its own fault, and naming no stale town while it does it.');
}
