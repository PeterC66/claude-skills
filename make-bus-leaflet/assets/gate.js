#!/usr/bin/env node
/*
 * gate.js — gate ONE candidate generator against ONE data folder, by hand.
 *
 *   node "%SK%\gate.js" <genfile> <S4-datadir> <internal|external|…> <committed_svg>
 *
 * Runs <genfile> in a temp copy of <S4-datadir>, and compares the sheet it writes
 * against <committed_svg>. Exit 0 PASS, 1 DIFF, 2 could not produce a sheet, 3 the
 * arguments name something that is not there. Nothing is written outside the temp
 * copy; on a DIFF or a FAIL the temp copy is LEFT so it can be inspected, and its
 * path is printed.
 *
 * THIS REPLACED `gate.sh` ON 2026-09-03 (OA-224 Tier 5, engine-pipeline F19), and
 * the reason is not that a shell script is untidy.
 *
 *   1. It hard-coded `C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets` on
 *      line 7 — the laptop as a dependency, in a file whose whole purpose is to
 *      be run against an arbitrary checkout.
 *   2. IT COMPARED WITH A RAW `diff -q`, while every other gate in this engine
 *      compares through `gate_lib`, which ignores line endings — deliberately,
 *      because a fresh clone with `core.autocrlf=true` and no `.gitattributes`
 *      writes CRLF into the working tree. So the two gates could give OPPOSITE
 *      verdicts on the same pair of files, and the one the documents told a
 *      newcomer to run by hand was the one that was wrong.
 *
 * A SECOND OPINION THAT IS NOT THE SAME OPINION IS NOT A SECOND OPINION. There is
 * one comparison in this engine now, in `gate_lib.gate`, and this file is a way of
 * calling it with four arguments; `status.js` calls the same function over the
 * whole estate. It is deliberately NOT a reimplementation: the value of a hand
 * gate is that it agrees with the board, and the only way to guarantee that is for
 * there to be nothing here to disagree with.
 *
 * `runGenerator` copies the data `*.json` and the engine's `icons.js` into the temp
 * directory, so this reproduces a sheet FROM ITS DATA FOLDER AND NOTHING ELSE —
 * the property `sheet_stamps.js` and `rollout.js` are both written around.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const G = require('./gate_lib.js');

const USAGE = 'usage: node gate.js <genfile> <S4-datadir> <internal|external|internal-schematic|boarding> <committed_svg>';

function main(argv) {
  const [gen, data, name, ref] = argv;
  if (!gen || !data || !name || !ref) { console.error(USAGE); return 3; }

  for (const [what, p] of [['generator', gen], ['data directory', data], ['committed sheet', ref]]) {
    if (!fs.existsSync(p)) { console.error(`no such ${what}: ${p}`); return 3; }
  }
  const out = name.endsWith('.svg') ? name : name + '.svg';

  const r = G.gate(path.resolve(gen), path.resolve(data), out, path.resolve(ref));
  const label = `${path.basename(gen)} + ${path.basename(data)} -> ${path.basename(ref)}`;

  if (r.status === 'PASS') {
    const bytes = fs.statSync(path.resolve(ref)).size;
    console.log(`PASS: ${label}  (${bytes} bytes${r.filtered ? ', ignoring the filtered lines' : ''})`);
    return 0;
  }
  if (r.status === 'DIFF') {
    console.log(`DIFF: ${label}   ${r.lineCountA} lines produced against ${r.lineCountB} committed`);
    for (const d of r.diffs) {
      console.log(`  line ${d.line}`);
      console.log(`    produced: ${String(d.a).slice(0, 160)}`);
      console.log(`    committed: ${String(d.b).slice(0, 160)}`);
    }
    console.log(`  (temp kept: ${r.tmpDir})`);
    return 1;
  }
  /* NO-SHEET is not a pass and not a diff: the generator ran and there is nothing
   * committed to compare it against. status.js judges that against the S4 manifest;
   * a person running this by hand is told the fact and left to judge it. */
  if (r.status === 'NO-SHEET') { console.log(`NO SHEET: ${label} — ${r.detail}`); return 2; }
  if (r.status === 'SKIP') { console.error(`${r.detail}`); return 3; }

  console.log(`FAIL(no svg): ${label}`);
  console.log('  ' + String(r.detail).split(' / ').join('\n  '));
  if (r.tmpDir) console.log(`  (temp kept: ${r.tmpDir})`);
  return 2;
}

/* Behind require.main, like every generator since Tier 4.1, so requiring this file
 * asks a question rather than running a gate — which is what lets a test load it. */
if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
