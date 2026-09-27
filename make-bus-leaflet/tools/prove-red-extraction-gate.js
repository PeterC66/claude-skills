#!/usr/bin/env node
/*
 * prove-red-extraction-gate.js — watch the refactor gate go red for an edit to a
 * template while every map is held back (buses-data OA-486).
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-red-extraction-gate
 *     node tools/prove-red-extraction-gate.js --buses "<path to a buses tree>" --portal "<path to community-bus-maps>"
 * `--buses` defaults to this skill's own fixture estate, test/fixtures/estate,
 * because the question is about the gate and not about any map; pointing it at
 * the real buses-data tree works and takes about five times as long. `--portal`
 * defaults to C:\Claude\community-bus-maps and is passed through to status.js.
 *
 * WHY. On 2026-09-27 `extraction-gate.js` printed "all 119 sheet verdicts
 * identical" with gen_internal.js forced to smooth every casing, an edit that
 * turned a 39.4 mm casing segment into 5.8 mm on High Wycombe. Its only question
 * was status.js's verdicts, and since OA-430 those gate a behind map against the
 * engine that drew it, so no verdict involves the working template. The gate
 * now also redraws every gated sheet with the working templates; this file
 * proves that half can say no.
 *
 * THE CASES, and each names a way it could be wrong:
 *
 *   A  nothing changed                               -> exit 0, GATE GREEN  (the control)
 *   B  gen_internal.js draws every POI icon larger   -> exit 1, an internal sheet "drawn"
 *   C  the radial draws every hub box a mm shorter   -> exit 1, an external sheet "drawn"
 *   D  no baseline at all                            -> exit 2
 *   E  a baseline from before the template half      -> exit 2, not a quiet compare of half
 *
 * The mutations are written to scratch copies and handed to the gate with
 * --swap, so nothing under assets/ is touched: every file there is vendored into
 * the portal and hashed by status.js. Each anchor must match EXACTLY ONCE, or the
 * case is refused — an anchor that matches nothing is a mutation that did
 * nothing, and would look like a survived mutant rather than a broken harness.
 * B and C are the same two anchors prove-red-gates.js uses, for the reasons its
 * TARGETS table records.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const GATE = path.join(__dirname, 'extraction-gate.js');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BUSES = path.resolve(arg('buses', path.join(SK, 'test', 'fixtures', 'estate')));
const PORTAL = arg('portal', 'C:/Claude/community-bus-maps');

const tmp = scratchDir('prove-red-extraction-gate-');
const baseFile = path.join(tmp, 'baseline.json');

function gate(extra) {
  const r = spawnSync(process.execPath, [GATE, '--buses', BUSES, '--portal', PORTAL, '--file', baseFile, ...extra],
    { cwd: SK, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function mutant(gen, find, to) {
  const src = fs.readFileSync(path.join(ASSETS, gen), 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) return { err: `anchor matched ${n} times in ${gen}, expected exactly 1: ${find}` };
  const p = path.join(tmp, gen);
  fs.writeFileSync(p, src.replace(find, to));
  return { swap: `${gen}=${p}` };
}

const results = [];
const check = (id, what, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}  ${what}${ok ? '' : `\n       ${String(detail).trim().split('\n').slice(0, 8).join('\n       ')}`}`);
};

console.log(`extraction gate against ${BUSES}`);
const b = gate(['--baseline']);
if (b.code !== 0) {
  console.log(`could not take the baseline (exit ${b.code}) — nothing below would mean anything:\n${b.out}`);
  process.exit(2);
}

const a = gate([]);
check('A', 'nothing changed -> GATE GREEN, exit 0', a.code === 0 && /GATE GREEN/.test(a.out), a.out);

for (const [id, what, gen, find, to, sheet] of [
  ['B', 'every POI icon a third larger -> an internal sheet drawn differently, exit 1',
    'gen_internal.js', 'const POI_HALF=2.1;', 'const POI_HALF=2.8;', 'internal'],
  ['C', 'every hub box a millimetre shorter -> an external sheet drawn differently, exit 1',
    'gen_external_radial.js', 'const HUB_H = 12 + (HUB_LINES.length-1)*4.0;', 'const HUB_H = 11 + (HUB_LINES.length-1)*4.0;', 'external'],
]) {
  const m = mutant(gen, find, to);
  if (m.err) { check(id, what, false, m.err); continue; }
  const r = gate(['--swap', m.swap]);
  check(id, what, r.code === 1 && new RegExp(`drawn +[^\\n]*/${sheet}:`).test(r.out), r.out);
}

fs.rmSync(baseFile);
const d = gate([]);
check('D', 'no baseline -> exit 2', d.code === 2 && /no baseline/.test(d.out), d.out);

fs.writeFileSync(baseFile, JSON.stringify({ 'St Ives/internal': 'PASS' }) + '\n');
const e = gate([]);
check('E', 'a verdicts-only baseline -> exit 2', e.code === 2 && /predates the template comparison/.test(e.out), e.out);

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n${bad.length} of ${results.length} case(s) failed: ${bad.map((r) => r.id).join(', ')}`
  : `\nall ${results.length} cases hold — the extraction gate can go red for a template edit`);
process.exit(bad.length ? 1 : 0);
