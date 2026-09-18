#!/usr/bin/env node
/*
 * prove-red-gates.js — break each generator on purpose, and check the BYTE GATE
 * notices.
 *
 * WHY THIS FILE EXISTS, and how it differs from its sibling. `prove-red.js`
 * falsifies the UNIT SUITE: it mutates the small requireable modules and checks
 * that `node --test` objects. It cannot reach the five big generators at all,
 * because they are top-to-bottom scripts that read their inputs and exit at load
 * (open action OA-001). What actually guards those five is the byte gate — run
 * the generator against a map's committed inputs and diff the SVG against the
 * committed reference — and on 2026-08-27 that gate had never been watched go
 * red for any sheet type. Twenty maps all reported PASS, and a check nobody has
 * seen fail proves nothing, which is written into this project's memory and has
 * been paid for repeatedly.
 *
 * This matters most for the refactor recorded as OA-129, whose whole method is
 * "extract a module, prove all twenty maps byte-identical, commit". That method
 * rests entirely on the byte gate being able to say no.
 *
 * WHAT IT DOES. For each target below: runs the UNMUTATED generator against the
 * map's tracked `ci-reference/` and expects PASS (the control — a mutation that
 * "fails" a gate which was already failing proves nothing either), then applies
 * one anchored mutation to a scratch copy of the generator and expects DIFF.
 * A mutation the gate does not notice is reported SURVIVED and exits 1.
 *
 * NOTHING UNDER assets/ IS TOUCHED. The mutated copy is written to a temp file
 * and passed to gate() by path. Every file in assets/ is vendored into the
 * portal and hashed by status.js, so an edit in place would surface as drift.
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-red-gates
 *     node tools/prove-red-gates.js --keep     leave the mutated copies on disk
 *     node tools/prove-red-gates.js --buses "<path to the Buses repo>"
 *     node tools/prove-red-gates.js --portal "<path to community-bus-maps>"
 * `--buses` defaults to C:\u3a St Ives\Using AI\Buses and `--portal` to
 * C:\Claude\community-bus-maps; both are only needed if that repo is checked out
 * somewhere else, which in CI it is. Without a portal the four portal-fixture
 * targets are reported SKIPPED rather than silently dropped.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const { gate, PLACE_IGNORE, portalFixtureEnv, findSheets } = require(path.join(ASSETS, 'gate_lib.js'));
const { scratchDir } = require('../assets/scratch');
const { resolveBuses } = require('../assets/cli');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();
const bi = argv.indexOf('--buses');
const BUSES = resolveBuses({ buses: (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : undefined });
const pi = argv.indexOf('--portal');
const PORTAL = (pi >= 0 && argv[pi + 1]) ? argv[pi + 1] : 'C:/Claude/community-bus-maps';

/* WHICH MAP EACH TARGET USES IS NOW A DESCRIPTION, NOT A NAME (OA-398,
 * 2026-09-18). Every target carried a `map:` literal — `Areas/St Ives`,
 * `Areas/Huntingdon`, `Places/_standalone/Ely Co-op`,
 * `Areas/High Wycombe/Places/High Wycombe Aldi`,
 * `Areas/St Ives/Places/St Ives Bus Station` — five paths into another
 * repository, describing a tree this file cannot see. That was survivable while
 * there was exactly one estate. There are two now: the small fixture estate this
 * repository owns, which is what the engine's own CI gates, and buses-data's real
 * one, which this same harness runs against from that repository's workflow. A
 * constant cannot be right in both.
 *
 * So a target says WHAT IT NEEDS — `level` and the files that must be in the
 * map's `ci-reference` — and `pickMap()` answers, in name order so the answer is
 * stable and a red is reproducible. `needs` is expressive enough to carry the
 * property each target was really chosen for: the place schematic needs an
 * `overrides.json`, which is the whole point of that target and of the
 * load-bearing control below it, and it used to be true only because somebody
 * had typed *Aldi*.
 *
 * A target that finds no map is a FAILURE, listed by name, never a skip.
 *
 * One target per SHEET TYPE, because the five sheet types are drawn by five
 * different generators and a gate proven red on one says nothing about the
 * others. `data` is always the tracked
 * ci-reference folder rather than the local S4 run dir, because ci-reference is
 * what a fresh CI clone actually has — gating against a run dir that only
 * exists on this laptop would prove the gate works in the one place it is never
 * needed.
 *
 * `find` must appear EXACTLY ONCE in the generator. An anchor that matches
 * twice, or not at all, is a mutation that did not do what it says, and would
 * report a false green exactly as loudly as the bug it is hunting. */
const TARGETS = [
  {
    sheet: 'internal.svg (town)',
    gen: 'gen_internal.js',
    level: 'area', needs: ['internal.svg'],
    what: 'every point-of-interest icon is drawn a third larger',
    find: 'const POI_HALF=2.1;',
    to: 'const POI_HALF=2.8;',
  },
  {
    sheet: 'internal.svg (place)',
    gen: 'gen_internal.js',
    level: 'place', needs: ['internal.svg'],
    opts: { ignoreLineRe: PLACE_IGNORE },
    what: 'every point-of-interest icon is drawn a third larger',
    find: 'const POI_HALF=2.1;',
    to: 'const POI_HALF=2.8;',
  },
  {
    sheet: 'external.svg',
    gen: 'gen_external_radial.js',
    level: 'area', needs: ['external.svg'],
    /* RE-ANCHORED 2026-09-18 (OA-398), and it is the OA-230 lesson arriving a
     * second time. The mutation was `(HUB_LINES.length-1)*4.0` -> `*3.0`, which
     * moves nothing at all on a town whose every hub box is ONE line: the
     * multiplier is applied to zero. It was invisible while this target named St
     * Ives, which has multi-line hubs, and it SURVIVED the moment the target
     * began choosing its own map and chose Beaconsfield, which does not. So the
     * mutation was not about the generator, it was about a property of one town's
     * data that nothing stated. The constant term moves every hub box on every
     * map, whatever its hubs look like. */
    what: 'each town hub box loses a millimetre of height',
    find: 'const HUB_H = 12 + (HUB_LINES.length-1)*4.0;',
    to: 'const HUB_H = 11 + (HUB_LINES.length-1)*4.0;',
  },
  {
    sheet: 'internal-schematic.svg',
    gen: 'schematize_internal.js',
    level: 'area', needs: ['internal-schematic.svg'],
    /* Re-anchored 2026-09-02 (OA-230): the pre-stage's projection is projection.js
     * now, so `pad` is no longer in this file. The first re-anchor tried the
     * ADOPTION -- flipping LEGACY_FRAME to the footer-safe frame -- and it SURVIVED
     * on all three sheets: a shorter frame changes only the vertical offset when
     * the fit is width-bound, the solver is translation-invariant, and INV takes
     * the same offset back out. An equivalent mutant, and a measurement OA-230's
     * second half needed. This one stretches the pseudo-longitude the workspace is
     * written in, which no refit can undo. */
    what: 'the inverse projection stretches the pseudo-longitude by one percent, so every leg leaves its octant',
    find: 'const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];',
    to: 'const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc * 1.01];',
  },
  {
    /* THE PLACE SCHEMATIC IS A DIFFERENT PATH FROM THE TOWN ONE ABOVE, and until
     * 2026-08-29 status.js did not gate it at all (OA-170). It reaches the same
     * generator through PLACE_IGNORE and, crucially, through OVERRIDES_FILE — High
     * Wycombe Aldi forces two POIs, and the schematiser's nested workspace drops
     * overrides.json unless it is passed explicitly. The control step below is what
     * makes this target worth having: it fails if that stops being passed. */
    sheet: 'internal-schematic.svg (place)',
    gen: 'schematize_internal.js',
    level: 'place', needs: ['internal-schematic.svg', 'overrides.json'],
    opts: { ignoreLineRe: PLACE_IGNORE, overridesFromWorkspace: true },
    /* Re-anchored 2026-09-02 (OA-230): the pre-stage's projection is projection.js
     * now, so `pad` is no longer in this file. The first re-anchor tried the
     * ADOPTION -- flipping LEGACY_FRAME to the footer-safe frame -- and it SURVIVED
     * on all three sheets: a shorter frame changes only the vertical offset when
     * the fit is width-bound, the solver is translation-invariant, and INV takes
     * the same offset back out. An equivalent mutant, and a measurement OA-230's
     * second half needed. This one stretches the pseudo-longitude the workspace is
     * written in, which no refit can undo. */
    what: 'the inverse projection stretches the pseudo-longitude by one percent, so every leg leaves its octant',
    find: 'const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];',
    to: 'const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc * 1.01];',
  },
  {
    sheet: 'internal-diagram.svg',
    gen: 'diagram_internal.js',
    level: 'area', needs: ['internal-diagram.svg'],
    /* PARKED 2026-09-10 (buses-data OA-297). No map draws the tube-map diagram any
     * more, so no `ci-reference/` on the estate holds this sheet and there is
     * nothing for the control to reproduce. The target is KEPT rather than
     * deleted — the generator is untouched, vendored and still load-tested, and
     * OA-298 is the written return path — and `parked` is checked in BOTH
     * directions: while the estate draws no such sheet the row reads `parked` and
     * costs nothing, and the moment any map's ci-reference holds one again the row
     * goes RED asking for this line to be removed. A target deleted on the day a
     * sheet is parked is a target nobody re-adds when it comes back; a flag that
     * reddens when its own premise expires is one nobody has to remember.
     *
     * This harness is how the parking announced itself: `gates.yml` went red at
     * 17:16 on the day with NO REFERENCE, because the rollout that parked the
     * sheet reached the four towns, `ci-reference/`, the extraction baseline and
     * the portal fixture — and not the harness that falsifies the gate over them.
     * Ask of any rollout that DROPS something what still asserts it exists. */
    parked: 'the tube-map diagram is parked (buses-data OA-297); OA-298 is the return path',
    /* Re-anchored 2026-09-02 (OA-230): the pre-stage's projection is projection.js
     * now, so `pad` is no longer in this file. The first re-anchor tried the
     * ADOPTION -- flipping LEGACY_FRAME to the footer-safe frame -- and it SURVIVED
     * on all three sheets: a shorter frame changes only the vertical offset when
     * the fit is width-bound, the solver is translation-invariant, and INV takes
     * the same offset back out. An equivalent mutant, and a measurement OA-230's
     * second half needed. This one stretches the pseudo-longitude the workspace is
     * written in, which no refit can undo. */
    what: 'the inverse projection stretches the pseudo-longitude by one percent, so every leg leaves its octant',
    find: 'const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];',
    to: 'const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc * 1.01];',
  },
  {
    sheet: 'boarding.svg',
    gen: 'gen_boarding.js',
    level: 'place', needs: ['boarding.svg'],
    what: 'the legend gap closes by a millimetre',
    find: 'const LG_GAP = 3.2;',
    to: 'const LG_GAP = 2.2;',
  },
];

/* THE PORTAL ARM (2026-08-28, OA-132). Everything above falsifies the byte gate
 * over maps in buses-data, run with the SKILL's generators. status.js also gates
 * two PORTAL FIXTURES through gatePortalFixture(), and those are supposed to be
 * the copies the live site renders — a different generator, a different
 * resolution order, a different extraEnv — and nothing had ever proved that arm
 * could go red.
 *
 * Proving it found something worse than an unproven check. gate_lib's
 * runGenerator sets SKILL_ASSETS to the SKILL's assets, and gatePortalFixture did
 * not override it, so the arm ran the portal's ENTRY generator against the
 * SKILL's shared modules — a combination that exists in no deployment. MEASURED
 * by making four portal modules throw on load: the board still said PASS.
 * renderMap.js passes SKILL_ASSETS = engine/, so live it is the portal's own
 * modules that draw, and the gate had never executed one of them.
 *
 * THE SECOND TARGET BELOW IS THE ONE THAT WOULD HAVE CAUGHT IT: it mutates a
 * SHARED module rather than an entry generator, which is exactly the class that
 * was invisible. A target list made only of entry generators would have gone
 * green against the same bug.
 *
 * Nothing under the portal's engine/ is written to. The whole directory is copied
 * into the scratch tree per target, the mutation is applied to the copy, and
 * SKILL_ASSETS points at the copy — the same discipline the local arm uses for
 * assets/. */
const PORTAL_TARGETS = [
  {
    sheet: 'internal.svg', fixture: 'High Wycombe Aldi', out: 'internal.svg',
    gen: 'place/gen_internal.js', mutFile: 'place/gen_internal.js',
    opts: { ignoreLineRe: PLACE_IGNORE },
    what: 'every point-of-interest icon is drawn a third larger',
    find: 'const POI_HALF=2.1;',
    to: 'const POI_HALF=2.8;',
  },
  {
    sheet: 'internal.svg [SHARED]', fixture: 'High Wycombe Aldi', out: 'internal.svg',
    gen: 'place/gen_internal.js', mutFile: 'svg_primitives.js',
    opts: { ignoreLineRe: PLACE_IGNORE },
    what: 'a SHARED module moves every route badge label — the class this arm could not see at all until 2026-08-28',
    find: 'dominant-baseline="central"',
    to: 'dominant-baseline="middle"',
  },
  {
    sheet: 'external.svg', fixture: 'High Wycombe Aldi', out: 'external.svg',
    gen: 'place/gen_external_places.js', mutFile: 'place/gen_external_places.js',
    what: 'every destination hub box loses a millimetre of height',
    find: 'const HUB_H = 13;',
    to: 'const HUB_H = 12;',
  },
  {
    sheet: 'boarding.svg', fixture: 'High Wycombe High Street', out: 'boarding.svg',
    gen: 'expert/gen_boarding.js', mutFile: 'expert/gen_boarding.js',
    what: 'the legend gap closes by a millimetre',
    find: 'const LG_GAP = 3.2;',
    to: 'const LG_GAP = 2.2;',
  },
];

const outName = t => t.sheet.split(' ')[0];

function mutate(genPath, find, to, scratch) {
  const src = fs.readFileSync(genPath, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) return { err: `anchor matched ${n} times, expected exactly 1: ${find}` };
  const dest = path.join(scratch, path.basename(genPath));
  fs.writeFileSync(dest, src.replace(find, to));
  return { dest };
}

const scratch = scratchDir('prove-red-gates-');
let failures = 0;
const rows = [];

/* Every sheet the ESTATE actually holds a reference for, by basename — the one
 * walk (gate_lib.findSheets), not a sixth copy of it, and asked of the whole
 * tree rather than of the target's own map: a `parked` target claims that NO map
 * draws that sheet, so the only evidence that can falsify it is estate-wide. */
const ESTATE_SHEETS = new Set(findSheets(BUSES).map(p => path.basename(p)));

/* Every map, area then place, in name order within each — the same two walks
 * status.js uses, so this harness and the board cannot disagree about what a map
 * is (the three place LAYOUTS in particular: a list built by hand here would have
 * missed the standalone ones exactly as every consumer did before 2026-08-21). */
const { findTowns, findPlaces } = require(path.join(ASSETS, 'gate_lib.js'));
const ALL_MAPS = (() => {
  const towns = findTowns(BUSES).sort((a, b) => a.name.localeCompare(b.name));
  const places = findPlaces(towns, BUSES).sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...towns.map((t) => ({ level: 'area', name: t.name, dir: t.dir })),
    ...places.map((p) => ({ level: 'place', name: p.name, dir: p.dir })),
  ];
})();

/** The first map of this level whose ci-reference holds everything `needs` names. */
function pickMap(t) {
  return ALL_MAPS.find((m) => m.level === t.level
    && (t.needs || []).every((f) => fs.existsSync(path.join(m.dir, 'ci-reference', f)))) || null;
}

for (const t of TARGETS) {
  const genPath = path.join(ASSETS, t.gen);
  const picked = pickMap(t);
  const data = picked && path.join(picked.dir, 'ci-reference');
  const committed = data && path.join(data, outName(t));
  const label = `${t.sheet.padEnd(24)} ${picked ? picked.name : '(no map)'}`;
  /* NO MAP AT ALL is a different fact from a parked sheet, and only the target's
   * own `parked` line may excuse it — so the parked branch below gets first
   * refusal, and anything else is a failure naming what it looked for. */
  if (!picked && !t.parked) {
    rows.push([label, 'NO MAP', `no ${t.level} under ${BUSES} has ${(t.needs || []).join(' + ')} in its ci-reference`]);
    failures++;
    continue;
  }

  /* A parked sheet, checked both ways — see the `parked` note on the target. */
  if (t.parked) {
    if (ESTATE_SHEETS.has(outName(t))) {
      rows.push([label, 'NO LONGER PARKED',
        `a ci-reference on the estate holds ${outName(t)} again, so this target can and must `
        + `run: delete its \`parked\` line. It says: ${t.parked}`]);
      failures++;
    } else {
      rows.push([label, 'parked', `${t.parked} — no ci-reference on the estate holds ${outName(t)}, so there is nothing to gate`, 'note']);
    }
    continue;
  }

  if (!fs.existsSync(committed)) {
    rows.push([label, 'NO REFERENCE', `${committed} is not on disk`]);
    failures++;
    continue;
  }

  // Control: the real generator must reproduce the committed sheet.
  const ctl = gate(genPath, data, outName(t), committed, t.opts || {});
  if (ctl.status !== 'PASS') {
    rows.push([label, 'CONTROL ' + ctl.status,
      'the unmutated generator does not reproduce this sheet, so a red from the '
      + 'mutation would prove nothing']);
    failures++;
    continue;
  }

  // Mutation: the gate must object.
  const m = mutate(genPath, t.find, t.to, scratch);
  if (m.err) {
    rows.push([label, 'BAD ANCHOR', m.err]);
    failures++;
    continue;
  }
  const mut = gate(m.dest, data, outName(t), committed, t.opts || {});
  if (mut.status === 'PASS') {
    rows.push([label, 'SURVIVED', `gate stayed green while ${t.what}`]);
    failures++;
  } else {
    rows.push([label, 'caught (' + mut.status + ')', t.what]);
  }
}

// ---- is the fix load-bearing, or is it decoration? -------------------------
//
// The target above proves the gate can go RED when the generator changes. It does
// NOT prove that `overridesFromWorkspace` is doing anything — a no-op option would
// pass the control and the mutation both, and the place schematic would go on being
// gated by luck. So ask the opposite question once: WITHOUT the option, the same
// unmutated generator must FAIL to reproduce the committed sheet.
//
// This is the whole of OA-170's finding stated as an assertion. The reference was
// built by rollout_places.js, which passes OVERRIDES_FILE; a gate that does not is
// regenerating by a different procedure and calling the difference drift. If this
// row ever goes quiet, either the schematiser learned to carry overrides.json into
// its own workspace — in which case delete this and the option together — or Aldi
// stopped forcing a POI, and the gate has gone back to proving nothing.
{
  /* THE SAME MAP THE PLACE-SCHEMATIC TARGET CHOSE, asked for the same way rather
   * than typed a second time (OA-398). It read `Areas/High Wycombe/Places/High
   * Wycombe Aldi` — the same literal as that target, in a second place, which is
   * the *two lists that must agree* shape: repoint one and this control goes on
   * asking about a different map, and would keep passing. */
  const OVERRIDE_TARGET = { level: 'place', needs: ['internal-schematic.svg', 'overrides.json'] };
  const picked = pickMap(OVERRIDE_TARGET);
  const dataDir = picked && path.join(picked.dir, 'ci-reference');
  const committed = dataDir && path.join(dataDir, 'internal-schematic.svg');
  const label = `overrides are load-bearing ${picked ? picked.name : '(no map)'}`;
  if (!picked || !fs.existsSync(committed)) {
    rows.push([label, 'NO REFERENCE', picked ? `${committed} is not on disk`
      : `no place under ${BUSES} carries both an internal-schematic.svg and an overrides.json, so nothing here asks whether OVERRIDES_FILE is load-bearing`]);
    failures++;
  } else {
    const without = gate(path.join(ASSETS, 'schematize_internal.js'), dataDir, 'internal-schematic.svg', committed, { ignoreLineRe: PLACE_IGNORE });
    if (without.status === 'PASS') {
      rows.push([label, 'SURVIVED', 'the gate reproduces the sheet with OVERRIDES_FILE unset, so passing it proves nothing']);
      failures++;
    } else {
      rows.push([label, 'caught (' + without.status + ')', 'without OVERRIDES_FILE the forced POI is dropped and the sheet does not reproduce']);
    }
  }
}

// ---- the portal arm --------------------------------------------------------
//
// THE DATA COMES FROM THE PORTAL NOW, NOT FROM buses-data (OA-398, 2026-09-18).
// This arm mutates the PORTAL's engine and draws the PORTAL's fixtures, and until
// that day the code came from one repository and the data from a third — so an
// arm entirely about the portal could not run without a token for a private
// repository that has nothing to do with it. The portal vendored those packs into
// its own `gate-fixtures/` on the same day and for the same reason, so code and
// data are now one checkout and this whole file runs with no credential.
const PORTAL_FIXTURES = path.join(PORTAL, 'gate-fixtures', 'Places', '_portal-fixture');
let portalRan = 0;
const portalEngine = path.join(PORTAL, 'engine');
if (!fs.existsSync(portalEngine)) {
  rows.push(['portal fixtures (all)'.padEnd(24) + ' -', 'SKIPPED',
    `no engine/ at ${PORTAL} — pass --portal <path to community-bus-maps>`, 'note']);
} else {
  for (const t of PORTAL_TARGETS) {
    const dataDir = path.join(PORTAL_FIXTURES, t.fixture);
    const committed = path.join(dataDir, t.out);
    const label = `${(t.sheet + ' (portal)').padEnd(24)} ${t.fixture}`;
    portalRan++;
    if (!fs.existsSync(committed)) {
      rows.push([label, 'NO REFERENCE', `${committed} is not on disk`]);
      failures++;
      continue;
    }
    // A fresh copy of the WHOLE vendored engine per target, so one mutation
    // cannot leak into the next and nothing under the portal is written to. It is
    // copied to <scratch>/portal-N/engine — the same SHAPE as the portal repo —
    // precisely so portalFixtureEnv can be handed that root and asked the same
    // question status.js asks it. Overriding SKILL_ASSETS here afterwards would
    // have been simpler and would have made this harness blind to the one thing
    // it is here to protect: if the builder ever goes back to pointing at the
    // SKILL's assets, the mutation below stops biting and this goes red.
    const portalCopy = path.join(scratch, 'portal-' + portalRan);
    const engCopy = path.join(portalCopy, 'engine');
    fs.cpSync(portalEngine, engCopy, { recursive: true });
    // THE SAME env builder status.js uses, pointed at the scratch portal — so
    // this falsifies the gate the board runs, not a second implementation of it.
    const opts = { ...(t.opts || {}), extraEnv: portalFixtureEnv(portalCopy, dataDir) };
    const genCopy = path.join(engCopy, t.gen);

    // Control: the unmutated vendored engine must reproduce the shipped fixture.
    const ctl = gate(genCopy, dataDir, t.out, committed, opts);
    if (ctl.status !== 'PASS') {
      rows.push([label, 'CONTROL ' + ctl.status,
        'the unmutated vendored engine does not reproduce this fixture, so a red '
        + 'from the mutation would prove nothing']);
      failures++;
      continue;
    }

    const mutPath = path.join(engCopy, t.mutFile);
    const src = fs.readFileSync(mutPath, 'utf8');
    const n = src.split(t.find).length - 1;
    if (n !== 1) {
      rows.push([label, 'BAD ANCHOR',
        `anchor matched ${n} times in ${t.mutFile}, expected exactly 1: ${t.find}`]);
      failures++;
      continue;
    }
    fs.writeFileSync(mutPath, src.replace(t.find, t.to));
    const mut = gate(genCopy, dataDir, t.out, committed, opts);
    if (mut.status === 'PASS') {
      rows.push([label, 'SURVIVED', `gate stayed green while ${t.what}`]);
      failures++;
    } else {
      rows.push([label, 'caught (' + mut.status + ')', t.what]);
    }
  }
}

/* THE MARK COMES FROM THE ROW'S KIND, NOT FROM A REGEX OVER ITS WORDS. It used to
 * be `/caught/.test(verdict) ? 'ok' : 'FAIL'`, which printed a red `FAIL` beside
 * every row that was neither — the portal arm's SKIPPED has read FAIL in every CI
 * log this harness has ever written, while contributing nothing to the exit code.
 * A reader then has to know which of the FAILs is real, and a harness whose own
 * output has to be interpreted is one nobody trusts at a glance. */
console.log('\nByte-gate falsification — control must PASS, mutation must not\n');
for (const [label, verdict, detail, kind] of rows) {
  const mark = kind === 'note' ? ' .. ' : (/caught/.test(verdict) ? 'ok  ' : 'FAIL');
  console.log(`  ${mark} ${label}  ${verdict}`);
  console.log(`       ${detail}`);
}

if (KEEP) console.log(`\nmutated copies kept in ${scratch}`);
else fs.rmSync(scratch, { recursive: true, force: true });

/* Count only the rows that were ASKED the question. A parked target and a skipped
 * portal arm are not gates proven able to go red, and folding them into the
 * numerator would make this line climb as coverage fell. */
const notes = rows.filter(r => r[3] === 'note').length;
const asked = rows.length - notes;
/* From the ROWS, not from the flags: a target carrying `parked` whose sheet has
 * come back was asked the question and failed, and counting the flag would print
 * "(1 parked)" on the same run whose row above says NO LONGER PARKED. */
const parkedCount = rows.filter(r => r[1] === 'parked').length;
console.log(`\n${asked - failures}/${asked} byte gates proven able to go red`
  + ` — ${TARGETS.length - parkedCount} of ${TARGETS.length} local sheet types`
  + (parkedCount ? ` (${parkedCount} parked)` : '')
  + `, 1 load-bearing-option control, ${portalRan} portal-fixture gates`
  + (notes ? `; ${notes} row(s) not run, listed above.` : '.'));
process.exit(failures ? 1 : 0);
