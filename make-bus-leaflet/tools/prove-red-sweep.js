#!/usr/bin/env node
/*
 * prove-red-sweep.js — put the orphan-river default BACK, on purpose, and check
 * that assets/render_sweep.js turns red for it.
 *
 * WHY. render_sweep.js was written on 2026-08-27 to answer a question no other
 * check in the estate asks: can a delivered map still be RE-RENDERED? Seven of
 * the eighteen live maps were REPORTED unable to (OA-137). They were not: the
 * report came from a harness that skipped the overrides composition the portal
 * performs, and all eighteen render through the portal's own previewFrom(). The
 * question is still real and no board was asking it. A sweep that reports "20 maps swept, 0 cannot be re-rendered" is
 * worth precisely nothing until it has been watched say the opposite, which is
 * this repository's oldest and most expensively-relearned rule.
 *
 * WHAT IT ASSERTS, and why it is four runs rather than one. The fix and the
 * check are entangled — the fix (gen_internal.js emits no feature when there is
 * neither a features[] nor any river geometry) is what makes the sweep green,
 * and the sweep is the only thing that can tell you the fix works. Four runs
 * pull them apart:
 *
 *   1  control, framing present     0 refusals   the estate is genuinely clean
 *   2  control, --drop-framing      0 refusals   THE FIX: a pack that loses its
 *                                                side file still renders
 *   3  mutant,  framing present     masked ONLY on the packs that still
 *                                                carry a side file. Was written as
 *                                                "0 refusals" and that premise has
 *                                                EXPIRED — see below
 *   4  mutant,  --drop-framing      7 refusals   what OA-137 actually measured —
 *                                                the composition left out
 *
 * Run 3 is the one worth staring at, and it has now been wrong twice for opposite
 * reasons. It was written on 2026-08-27 as a mutation the check does NOT catch,
 * asserted deliberately as a no-op, on the premise that "every live pack carries
 * its framing". **That premise expired on the day it was written, and the fix
 * this harness exists to certify is what expired it.** The OA-137 fix deleted
 * `suppressOrphanRiver` from build_internal_place.js — the code whose entire job
 * was WRITING that side file — because the engine no longer invents a river to
 * cancel. So a place pack rebuilt since then carries no framing at all, and for
 * it "framing present" and "--drop-framing" are the same run. Measured
 * 2026-08-28: five packs (Beaconsfield Simpson Centre, St Neots Tesco Extra, Ely
 * Co-op and both Godmanchesters) have neither an overrides.json nor a features[]
 * entry, and the mutant refuses on every one of them. **The estate is not broken
 * — run 1 is clean.** What was broken is this assertion, which had been red since
 * some time before 2026-08-28 with nothing watching, because `test:prove-red-sweep`
 * was the one falsification harness NOT wired into gates.yml. It is now.
 *
 * So run 3 no longer asserts a count. It DERIVES the set of packs that still carry
 * framing and requires the mutant to be masked on exactly those and to refuse on
 * the rest — a property that survives the next place rebuild, which a number
 * never could. Run 4 is still not "the bug": it is the dependency the fix
 * removes, and the exact configuration under which OA-137's harness produced its
 * seven. Do not quote run 4 as an incident.
 *
 * HOW THE MUTANT IS BUILT. Nothing under assets/ is touched — every file there
 * is vendored into the portal and hashed by status.js, so an edit in place would
 * surface as vendoring drift. assets/ is copied to a scratch folder that is a
 * SIBLING of it inside make-bus-leaflet/, which matters: gate_lib.js derives the
 * place-engine path as SK/../../make-place-bus-leaflet/assets, so a copy at the
 * wrong depth silently loses the place generators and every external sheet
 * reports NO-GEN. Same depth, same resolution, same answer.
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-red-sweep
 *     node tools/prove-red-sweep.js --buses "<path to the Buses repo>"
 * `--buses` defaults to C:\u3a St Ives\Using AI\Buses and is only needed if the
 * data repo is checked out somewhere else.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveBuses } = require('../assets/cli');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();
const bi = argv.indexOf('--buses');
const BUSES = resolveBuses({ buses: (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : undefined });

/*
 * The mutation: disable the guard clause added on 2026-08-27, so gen_internal.js
 * falls through to the legacy fallback and invents a "River Great Ouse" feature
 * with `geo: river` — which in that branch is empty. Exactly the pre-fix engine.
 *
 * The anchor must appear EXACTLY ONCE. An anchor that matches twice, or not at
 * all, is a mutation that did not do what it says and would report a false green
 * as loudly as the bug it is hunting.
 */
const ANCHOR = '} else if(!(river||[]).length){';
const MUTANT = '} else if(false){';

/* The seven, by name. Asserting the COUNT alone would pass if the sweep found
 * seven different maps for seven different reasons, which is the shape of every
 * miscounted finding in this project's history — including OA-137's own, which
 * named "the St Neots, Godmanchester and Ely places" when two of the seven are
 * nowhere near the Great Ouse. Name them. */
/*
 * What run 3 should expect, derived from run 4's own answer rather than
 * re-derived here.
 *
 * Run 4 renders every pack with its framing DROPPED, so the packs it names are
 * exactly those the mutant can reach when nothing protects them — whatever the
 * engine's protection rules happen to be today. Run 3 restores each pack's own
 * framing, so its refusing set must be run 4's set minus the packs that still
 * have a side file to restore. Nothing here needs to know that a features[]
 * entry protects a pack, or that real river geometry does: a second
 * implementation of a rule is a second chance to get it wrong, and the first
 * attempt at this proved it — it re-derived the rule from framing and features[]
 * alone and confidently listed March, which is protected by neither and has a
 * real river.
 */
function expectedWithFraming(dropFramingNames, framedPacks) {
  return dropFramingNames.filter((n) => !framedPacks.has(n)).sort();
}

/* Which packs still carry a framing side file, read from the sweep's own row. */
function framed(parsed) {
  const set = new Set();
  for (const m of parsed.results || []) if (m.framing) set.add(m.name);
  return set;
}

const EXPECT_SEVEN = [
  'Beaconsfield Simpson Centre',
  'Ely Co-op',
  'Godmanchester Co-op Cambridge Road',
  'Godmanchester Co-op Ermine Street',
  'St Ives Bus Station',
  'St Neots Co-op',
  'St Neots Tesco Extra',
];
const RIVER_MSG = 'has no geometry of its own on this sheet at all';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name);
    const d = path.join(to, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) { if (name !== '__pycache__' && name !== 'design-preview') copyDir(s, d); }
    else fs.copyFileSync(s, d);
  }
}

function runSweep(assetsDir, dropFraming) {
  const args = [path.join(assetsDir, 'render_sweep.js'), '--buses', BUSES, '--expect', '20', '--json'];
  if (dropFraming) args.push('--drop-framing');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 2) return { fatal: (r.stderr || '').trim() };
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch (e) { return { fatal: 'sweep produced no JSON: ' + (r.stderr || '').trim().slice(0, 300) }; }
  return { status: r.status, parsed };
}

/*
 * Maps that refused, how many refusals in total, and whether the river message
 * is present on every one of them.
 *
 * `total` comes from strict_guards.js's own banner and is the only exact number
 * here. It is asserted SEPARATELY from the map count because the two can come
 * apart in both directions — seven maps refusing once each, and one map refusing
 * seven times, are different faults that a map count alone cannot tell apart.
 *
 * What is deliberately NOT asserted is "one distinct cause". A refusing run's
 * stderr carries build notes that look exactly like refusals (St Neots Tesco
 * Extra prints five and refuses once), so counting distinct sentences would
 * assert the conflation this harness exists to disprove.
 */
function refusing(parsed) {
  const names = [];
  let total = 0;
  let everyOneOnTheRiver = true;
  for (const m of parsed.results) {
    const bad = m.rows.filter((x) => x.verdict === 'REFUSE' || x.verdict === 'ERROR');
    if (!bad.length) continue;
    names.push(m.name);
    for (const row of bad) {
      total += row.refused;
      if (!row.refusals.some((l) => l.includes(RIVER_MSG))) everyOneOnTheRiver = false;
    }
  }
  return { names: names.sort(), total, everyOneOnTheRiver };
}

const scratch = path.join(SK, '.prove-red-sweep-tmp');
fs.rmSync(scratch, { recursive: true, force: true });
const rows = [];
let failures = 0;

function check(label, ok, detail) {
  rows.push([ok ? 'ok' : 'FAILED', label, detail]);
  if (!ok) failures++;
}

try {
  // ---- the control: the real assets, exactly as they ship -------------------
  const c1 = runSweep(ASSETS, false);
  if (c1.fatal) check('1 control, framing present', false, c1.fatal);
  else {
    const r = refusing(c1.parsed);
    check('1 control, framing present', c1.status === 0 && r.names.length === 0,
      `${c1.parsed.maps} maps, ${r.names.length} refusing` + (r.names.length ? ` (${r.names.join(', ')})` : ''));
  }

  const c2 = runSweep(ASSETS, true);
  if (c2.fatal) check('2 control, --drop-framing', false, c2.fatal);
  else {
    const r = refusing(c2.parsed);
    check('2 control, --drop-framing  [THE FIX]', c2.status === 0 && r.names.length === 0,
      `${c2.parsed.maps} maps, ${r.names.length} refusing` + (r.names.length ? ` (${r.names.join(', ')})` : ''));
  }

  // ---- the mutant: put the invention back ----------------------------------
  copyDir(ASSETS, scratch);
  const genPath = path.join(scratch, 'gen_internal.js');
  const src = fs.readFileSync(genPath, 'utf8');
  const n = src.split(ANCHOR).length - 1;
  if (n !== 1) {
    check('mutation anchor', false, `anchor matched ${n} times, expected exactly 1: ${ANCHOR}`);
  } else {
    fs.writeFileSync(genPath, src.replace(ANCHOR, MUTANT));

    // Run 4 FIRST, because run 3's expectation is derived from it — see
    // expectedWithFraming() above. The reported order is unchanged.
    const m2 = runSweep(scratch, true);

    const m1 = runSweep(scratch, false);
    if (m1.fatal) check('3 mutant, framing present', false, m1.fatal);
    else if (m2.fatal) check('3 mutant, framing present', false, 'run 4 could not run, so there is nothing to derive from');
    else {
      const unprotected = expectedWithFraming(refusing(m2.parsed).names, framed(m1.parsed));
      const r = refusing(m1.parsed);
      const same = JSON.stringify(r.names) === JSON.stringify(unprotected);
      check('3 mutant, framing present  [masked only where there IS framing]',
        m1.status === (unprotected.length ? 1 : 0) && same,
        same
          ? (unprotected.length
              ? `masked on every pack that still carries framing; refuses on the ${unprotected.length} that carry none`
              : 'masked on every pack, as it was in production')
          : `refused on [${r.names.join(', ')}], expected exactly [${unprotected.join(', ')}]`);
    }

    if (m2.fatal) check('4 mutant, --drop-framing', false, m2.fatal);
    else {
      const r = refusing(m2.parsed);
      const sameMaps = JSON.stringify(r.names) === JSON.stringify(EXPECT_SEVEN);
      const ok = m2.status === 1 && sameMaps && r.total === 7 && r.everyOneOnTheRiver;
      check('4 mutant, --drop-framing  [what OA-137 measured]', ok,
        ok ? 'the named seven, 7 refusals in total \u2014 one each, all on the orphan river'
          : `got ${r.names.length} maps (${r.names.join(', ')}), ${r.total} refusals,`
            + ` river-on-every-map=${r.everyOneOnTheRiver}`);
    }
  }
} finally {
  if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true });
  else console.log('mutated engine left at ' + scratch);
}

const w = Math.max(...rows.map((r) => r[1].length));
console.log('');
for (const [v, label, detail] of rows) console.log(`${v.padEnd(7)} ${label.padEnd(w)}  ${detail}`);
console.log('');
console.log(failures
  ? `${failures} of ${rows.length} checks FAILED — render_sweep.js is not proven able to fail.`
  : `${rows.length} checks, all as expected: the sweep is green on the real corpus and red on the restored default.`);
process.exit(failures ? 1 : 0);
