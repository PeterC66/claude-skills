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
const { gate, PLACE_IGNORE, portalFixtureEnv } = require(path.join(ASSETS, 'gate_lib.js'));
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

/* One target per SHEET TYPE, because the five sheet types are drawn by five
 * different generators and a gate proven red on one says nothing about the
 * others. `map` is relative to the Buses repo; `data` is always the tracked
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
    map: 'Areas/St Ives',
    what: 'every point-of-interest icon is drawn a third larger',
    find: 'const POI_HALF=2.1;',
    to: 'const POI_HALF=2.8;',
  },
  {
    sheet: 'internal.svg (place)',
    gen: 'gen_internal.js',
    map: 'Places/_standalone/Ely Co-op',
    opts: { ignoreLineRe: PLACE_IGNORE },
    what: 'every point-of-interest icon is drawn a third larger',
    find: 'const POI_HALF=2.1;',
    to: 'const POI_HALF=2.8;',
  },
  {
    sheet: 'external.svg',
    gen: 'gen_external_radial.js',
    map: 'Areas/St Ives',
    what: 'each town hub box loses a millimetre of height per line',
    find: 'const HUB_H = 12 + (HUB_LINES.length-1)*4.0;',
    to: 'const HUB_H = 12 + (HUB_LINES.length-1)*3.0;',
  },
  {
    sheet: 'internal-schematic.svg',
    gen: 'schematize_internal.js',
    map: 'Areas/Huntingdon',
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
    map: 'Areas/High Wycombe/Places/High Wycombe Aldi',
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
    map: 'Areas/St Ives',
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
    map: 'Areas/St Ives/Places/St Ives Bus Station',
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

for (const t of TARGETS) {
  const genPath = path.join(ASSETS, t.gen);
  const data = path.join(BUSES, t.map, 'ci-reference');
  const committed = path.join(data, outName(t));
  const label = `${t.sheet.padEnd(24)} ${path.basename(t.map)}`;

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
  const dataDir = path.join(BUSES, 'Areas/High Wycombe/Places/High Wycombe Aldi', 'ci-reference');
  const committed = path.join(dataDir, 'internal-schematic.svg');
  const label = 'overrides are load-bearing High Wycombe Aldi';
  if (!fs.existsSync(committed)) {
    rows.push([label, 'NO REFERENCE', `${committed} is not on disk`]);
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
let portalRan = 0;
const portalEngine = path.join(PORTAL, 'engine');
if (!fs.existsSync(portalEngine)) {
  rows.push(['portal fixtures (all)'.padEnd(24) + ' -', 'SKIPPED',
    `no engine/ at ${PORTAL} — pass --portal <path to community-bus-maps>`]);
} else {
  for (const t of PORTAL_TARGETS) {
    const dataDir = path.join(BUSES, 'Places', '_portal-fixture', t.fixture);
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

console.log('\nByte-gate falsification — control must PASS, mutation must not\n');
for (const [label, verdict, detail] of rows) {
  const mark = /caught/.test(verdict) ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${label}  ${verdict}`);
  console.log(`       ${detail}`);
}

if (KEEP) console.log(`\nmutated copies kept in ${scratch}`);
else fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${rows.length - failures}/${rows.length} byte gates proven able to go red`
  + ` — ${TARGETS.length} local sheet types, 1 load-bearing-option control, ${portalRan} portal-fixture gates.`);
process.exit(failures ? 1 : 0);
