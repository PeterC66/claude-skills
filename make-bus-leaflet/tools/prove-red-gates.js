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
 * `--buses` defaults to C:\u3a St Ives\Using AI\Buses and is only needed if the
 * data repo is checked out somewhere else.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const { gate, PLACE_IGNORE } = require(path.join(ASSETS, 'gate_lib.js'));

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const bi = argv.indexOf('--buses');
const BUSES = (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : 'C:/u3a St Ives/Using AI/Buses';

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
    what: 'the geometry bounding box is padded ten times as far',
    find: 'const pad = 0.0006;',
    to: 'const pad = 0.006;',
  },
  {
    sheet: 'internal-diagram.svg',
    gen: 'diagram_internal.js',
    map: 'Areas/St Ives',
    what: 'the geometry bounding box is padded ten times as far',
    find: 'const pad = 0.0006;',
    to: 'const pad = 0.006;',
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

const outName = t => t.sheet.split(' ')[0];

function mutate(genPath, find, to, scratch) {
  const src = fs.readFileSync(genPath, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) return { err: `anchor matched ${n} times, expected exactly 1: ${find}` };
  const dest = path.join(scratch, path.basename(genPath));
  fs.writeFileSync(dest, src.replace(find, to));
  return { dest };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-gates-'));
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

console.log('\nByte-gate falsification — control must PASS, mutation must not\n');
for (const [label, verdict, detail] of rows) {
  const mark = /caught/.test(verdict) ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${label}  ${verdict}`);
  console.log(`       ${detail}`);
}

if (KEEP) console.log(`\nmutated copies kept in ${scratch}`);
else fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${rows.length - failures}/${rows.length} sheet types have a byte gate proven able to go red.`);
process.exit(failures ? 1 : 0);
