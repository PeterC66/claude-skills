#!/usr/bin/env node
/*
 * prove-red-fixture-estate.js — falsify `estate-fixture.js --check`.
 *
 * Run from make-bus-leaflet, no placeholders:
 *     npm run test:prove-red-fixture-estate
 *
 * WHY. `test/fixtures/estate/` is what this repository's whole `status` job gates
 * against since OA-398. If `--check` could not go red, an engine change that
 * moved ink would land with a fixture describing the engine before it, every byte
 * gate would still say PASS — because the fixture and the engine would have
 * drifted together in the reader's mind and not in fact — and the first thing to
 * notice would be buses-data's estate failing to reproduce, days later, in
 * another repository. That is the exact shape this estate keeps paying for: a
 * check that has only ever been seen green.
 *
 * THE CASES, and each names a way the check could be wrong.
 *
 *   0  an untouched copy of the fixture         -> exit 0, "in step"   (the control)
 *   1  a committed sheet altered                -> exit 1, `redrawn`   (the finding)
 *   2  a pack's engine stamp moved backwards    -> exit 1, `stamp`     (the donor finding)
 *   3  a declared sheet deleted                 -> exit 1, `MISSING`
 *   4  an UNDECLARED sheet absent               -> exit 0              (a control that must stay green)
 *   5  `--apply` on case 1's damage             -> exit 0, and a re-check is clean
 *   6  an empty estate                          -> exit 2, not 0 and not 1
 *
 * 2 IS THE ONE THE ORDERING TRAP TURNS ON. `prove-red-held-back` needs a donor
 * pack whose stamp IS the current engine; a stale stamp makes the harness exit 1
 * over the whole estate before a case runs, which is how an engine pull request
 * came to open red with only a commit in another repository able to clear it
 * (OA-341). This check is what turns that into a message naming the remedy.
 *
 * 4 IS NOT PADDING. High Wycombe High Street carries a boarding plan AND NOTHING
 * ELSE, and the first version of the check reported two findings about it because
 * it assumed every place has an internal sheet. A rule that cannot tell *this map
 * has no such sheet* from *this map's sheet has gone* is one somebody mutes in
 * its first week.
 *
 * 6 IS THE HOUSE EXIT-CODE RULE: 2 for could-not-look, 1 for a finding. An empty
 * estate exiting 1 would read, on a board and in a workflow log, exactly like a
 * fixture that had gone stale.
 *
 * NOTHING UNDER test/fixtures/estate/ IS TOUCHED. Every case copies the fixture
 * into a scratch tree and damages the copy, and the tool is pointed at it with
 * `--estate`.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'estate-fixture.js');
const ESTATE = path.join(ROOT, 'test', 'fixtures', 'estate');

let failures = 0;
const fail = (m) => { console.error('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

if (!fs.existsSync(ESTATE)) {
  console.error('prove-red-fixture-estate: no fixture estate at ' + ESTATE + '. There is nothing to falsify against;');
  console.error('  seed one with `node tools/estate-fixture.js --seed --map "Areas/<Town>" --from "<buses-data checkout>"`.');
  process.exit(1);
}

/** A scratch copy of the whole fixture estate, ready to be damaged. */
function copy() {
  const root = scratchDir('prove-fixture-estate-');
  fs.cpSync(ESTATE, root, { recursive: true });
  return root;
}

function run(root, extra = []) {
  const r = spawnSync(process.execPath, [TOOL, '--estate', root, ...extra], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

/* The first AREA pack in the copy — asked of the tree rather than named, for the
 * same reason every other constant in these harnesses has been removed. */
function firstArea(root) {
  const areas = path.join(root, 'Areas');
  for (const n of fs.readdirSync(areas).sort()) {
    const ci = path.join(areas, n, 'ci-reference');
    if (fs.existsSync(path.join(ci, 'internal.svg'))) return { name: n, ci };
  }
  throw new Error('no area pack with an internal.svg in the fixture estate');
}

/* ---- 0: the control ----------------------------------------------------- */
console.log('\n0  an untouched copy — the control');
{
  const root = copy();
  const { out, code } = run(root);
  if (code !== 0) fail(`exit ${code} on an untouched copy. Nothing below can be trusted.\n${out}`);
  else pass('exit 0');
  if (!/in step/.test(out)) fail('does not say the fixture is in step');
  else pass('says "in step"');
}

/* ---- 1: a sheet altered ------------------------------------------------- */
console.log('\n1  a committed sheet altered — the finding');
{
  const root = copy();
  const a = firstArea(root);
  const f = path.join(a.ci, 'internal.svg');
  const src = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, src.replace('</svg>', '<!-- prove-red-fixture-estate --></svg>'));
  const { out, code } = run(root);
  if (code !== 1) fail(`exit ${code}, expected 1 — a fixture the engine no longer redraws is a finding`);
  else pass('exit 1');
  if (!new RegExp('redrawn\\s+' + a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' . internal\\.svg').test(out)) fail(`does not name the sheet as redrawn:\n${out}`);
  else pass('names the sheet');
  if (!/--apply/.test(out)) fail('does not say how to fix it');
  else pass('names the remedy');
}

/* ---- 2: the engine stamp ------------------------------------------------ */
console.log('\n2  a pack stamped with an older engine — the donor finding');
{
  const root = copy();
  const a = firstArea(root);
  const rp = path.join(a.ci, 'routes.json');
  const j = JSON.parse(fs.readFileSync(rp, 'utf8'));
  j.engine = '0000000000';
  fs.writeFileSync(rp, JSON.stringify(j, null, 2) + '\n');
  const { out, code } = run(root);
  if (code !== 1) fail(`exit ${code}, expected 1 — a non-current stamp empties prove-red-held-back's donor set`);
  else pass('exit 1');
  if (!/stamp\s/.test(out)) fail(`does not report the stamp:\n${out}`);
  else pass('reports the stamp');
  if (!/donor/.test(out)) fail('does not say WHY a stale stamp matters — the message is what stops the next reader re-deriving OA-341 from first principles');
  else pass('says what a stale stamp costs');
}

/* ---- 3: a declared sheet deleted ---------------------------------------- */
console.log('\n3  a declared sheet deleted');
{
  const root = copy();
  const a = firstArea(root);
  fs.rmSync(path.join(a.ci, 'internal.svg'));
  const { out, code } = run(root);
  if (code !== 1) fail(`exit ${code}, expected 1`);
  else pass('exit 1');
  if (!/MISSING/.test(out)) fail(`does not report it MISSING:\n${out}`);
  else pass('MISSING');
}

/* ---- 4: an UNDECLARED sheet, which must stay quiet ---------------------- */
console.log('\n4  a map whose manifest declares no internal sheet — a control that must stay GREEN');
{
  const root = copy();
  // Build the case rather than hope the estate supplies it: take the first area,
  // strip internal.svg from its latest S4 record AND from disk. A map that never
  // made the sheet is not a map that lost it.
  const a = firstArea(root);
  const mp = path.join(root, 'Areas', a.name, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const s4 = m.stages.S4;
  const rec = s4.runs.find((r) => r.id === s4.latest);
  const had = Array.isArray(rec.outputs) && rec.outputs.includes('internal.svg');
  rec.outputs = (rec.outputs || []).filter((o) => o !== 'internal.svg');
  fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  fs.rmSync(path.join(a.ci, 'internal.svg'));
  if (!had) fail(`${a.name}'s latest S4 record does not declare internal.svg, so case 3 above proved nothing and this case is not the control it claims to be`);
  else pass('the fixture really did declare it, so case 3 measured something');
  const { out, code } = run(root);
  if (code !== 0) fail(`exit ${code}, expected 0 — an undeclared sheet is not a missing one:\n${out}`);
  else pass('exit 0');
  if (/MISSING/.test(out)) fail('reported MISSING about a sheet the map never made');
  else pass('quiet');
}

/* ---- 5: --apply ---------------------------------------------------------- */
console.log('\n5  --apply on case 1\'s damage — the remedy really is the remedy');
{
  const root = copy();
  const a = firstArea(root);
  const f = path.join(a.ci, 'internal.svg');
  const before = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, before.replace('</svg>', '<!-- prove-red-fixture-estate --></svg>'));
  const applied = run(root, ['--apply']);
  if (applied.code !== 0) fail(`--apply exited ${applied.code}\n${applied.out}`);
  else pass('--apply exits 0');
  const again = run(root);
  if (again.code !== 0) fail(`a re-check after --apply still exits ${again.code} — the tool reports a fault it cannot fix:\n${again.out}`);
  else pass('the re-check is clean');
  if (fs.readFileSync(f, 'utf8') !== before) fail('--apply did not restore the sheet the current engine draws');
  else pass('the sheet is byte-identical to what the engine draws');
}

/* ---- 6: nothing to look at ---------------------------------------------- */
console.log('\n6  an empty estate — could not look, which is neither pass nor finding');
{
  const root = scratchDir('prove-fixture-estate-empty-');
  const { out, code } = run(root);
  if (code !== 2) fail(`exit ${code}, expected 2. Exit 1 here would read exactly like a stale fixture.`);
  else pass('exit 2');
  if (!/no map under/.test(out)) fail(`does not say what it could not find:\n${out}`);
  else pass('says what it could not find');
}

if (failures) {
  console.error(`\nprove-red-fixture-estate: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nprove-red-fixture-estate: three drift shapes go red, the undeclared-sheet control stays green, --apply'
  + ' really clears what --check reports, and an empty estate is exit 2 rather than a finding'
  + ' (7 scratch copies, nothing under test/fixtures/estate touched).');
