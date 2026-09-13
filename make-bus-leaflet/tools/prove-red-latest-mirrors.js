#!/usr/bin/env node
/*
 * prove-red-latest-mirrors.js — falsify the `_latest` mirror gate (OA-329).
 *
 * Run from make-bus-leaflet:  node tools/prove-red-latest-mirrors.js
 * There are no arguments and no placeholders.
 *
 * WHY A FIXTURE AND NOT THE REAL TREE. The estate is CLEAN — 19 mirrors current,
 * one map with no S6 — which is the state this gate must stay silent in, and a
 * gate that fires on nothing and a gate that is correct look identical from the
 * board. The fault it was written for has already been repaired, so the only way
 * to watch it go red is to build the fault again. That is also why the real tree
 * is left alone: reverting a tracked mirror in place to prove a point leaves a
 * dirty repository if anything throws between the revert and the restore.
 *
 * THE CASE THAT IS NOT ABOUT GOING RED IS THE ONE WORTH KEEPING. `Ermine Street`
 * below is a map with no S6 run at all, and it must stay SILENT: Godmanchester
 * Co-op Ermine Street is deliberately without one (Peter, 2026-09-07), so a gate
 * that read *no mirror* as a finding would redden the estate over a decision
 * somebody has already taken — and it would go green again only when somebody
 * spent 89k-137k tokens to shut it up. The same goes for `Nested`: a narrowing
 * that stopped grading places inside towns would be silent in exactly the way
 * fault B was.
 *
 *   A  every mirror current                        -> exit 0   (control)
 *   B  a town's mirror is an OLDER run of its own   -> STALE
 *   C  a town's mirror is a PLACE's report          -> WRONG-MAP, naming the place
 *   D  a map with no S6 at all                      -> silent  (control)
 *   E  an S6 report exists and the mirror does not  -> MISSING
 *   F  a nested place is graded on its own report   -> STALE on the place
 *
 * B AND C ARE SEPARATE BECAUSE THE TWO FAULTS WANT DIFFERENT FIXES. A stale
 * mirror is a refresh nobody ran; a foreign one was `newestUnder()` descending
 * into `Places/`. A single verdict covering both would hide the worse fault
 * inside the commoner one, which is how fault B stood unnoticed for days with
 * every gate green.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const GATE = path.join(__dirname, 'latest-mirror-gate.js');
let failures = 0;
const fail = (m) => { console.error('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

/* ---- fixture ---------------------------------------------------------- */
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const manifest = (runs, latest) => JSON.stringify({
  stages: { S6: { name: 'verify', latest, runs: runs.map(id => ({ id, dir: `S6-verify/${id}` })) } },
}, null, 1);

/*
 * Builds a whole throwaway estate and returns its root. `mutate` is where each
 * case breaks exactly one thing, so every case starts from the same green tree
 * and the difference between green and red is the mutation and nothing else.
 */
function estate(mutate) {
  const root = scratchDir('latest-mirrors-');
  const town = path.join(root, 'Areas', 'Fixtown');
  write(path.join(town, 'manifest.json'), manifest(['2026-01-01_0100', '2026-06-06_0600'], '2026-06-06_0600'));
  write(path.join(town, 'S6-verify', '2026-01-01_0100', 'verification.docx'), 'TOWN-OLD-REPORT');
  write(path.join(town, 'S6-verify', '2026-06-06_0600', 'verification.docx'), 'TOWN-OWN-REPORT');
  write(path.join(town, '_latest', 'verification.docx'), 'TOWN-OWN-REPORT');

  const place = path.join(town, 'Places', 'Fixtown Nested');
  write(path.join(place, 'manifest.json'), manifest(['2026-09-09_0900'], '2026-09-09_0900'));
  write(path.join(place, 'S6-verify', '2026-09-09_0900', 'verification.docx'), 'PLACE-REPORT');
  write(path.join(place, '_latest', 'verification.docx'), 'PLACE-REPORT');

  // A map that has never had an S6: no run, no mirror, and no finding owed.
  const none = path.join(root, 'Places', '_standalone', 'Ermine Street');
  write(path.join(none, 'manifest.json'), JSON.stringify({ stages: {} }, null, 1));

  mutate({ root, town, place, none });
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GATE, '--buses', root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* ---- A: the control --------------------------------------------------- */
{
  const { code, out } = run(estate(() => {}));
  if (code === 0) pass('A  a clean estate is green'); else fail(`A  clean estate exited ${code}:\n${out}`);
  if (/3 map\(s\)/.test(out) || /— 3 map/.test(out)) pass('A  all three maps are in the population');
  else fail(`A  the population is not 3 maps:\n${out}`);
  if (/Ermine Street — no S6/.test(out)) pass('D  a map with no S6 is named and is not a finding');
  else fail(`D  the no-S6 map was not reported as such:\n${out}`);
  if (/0 finding/.test(out)) pass('D  a map with no S6 raises no finding'); else fail(`D  it raised one:\n${out}`);
}

/* ---- B: a town's mirror is an older run of its own --------------------- */
{
  const { code, out } = run(estate(({ town }) => {
    fs.writeFileSync(path.join(town, '_latest', 'verification.docx'), 'TOWN-OLD-REPORT');
  }));
  if (code === 1) pass('B  a superseded mirror is red'); else fail(`B  exited ${code}, expected 1:\n${out}`);
  if (/Fixtown — STALE/.test(out)) pass('B  it is called STALE'); else fail(`B  wrong verdict:\n${out}`);
  if (/2026-01-01_0100/.test(out) && /2026-06-06_0600/.test(out)) pass('B  it names the run it holds and the run it owes');
  else fail(`B  the two runs are not both named:\n${out}`);
}

/* ---- C: a town's mirror is a PLACE's report ---------------------------- */
{
  const { code, out } = run(estate(({ town }) => {
    fs.writeFileSync(path.join(town, '_latest', 'verification.docx'), 'PLACE-REPORT');
  }));
  if (code === 1) pass('C  a foreign mirror is red'); else fail(`C  exited ${code}, expected 1:\n${out}`);
  if (/Fixtown — WRONG-MAP/.test(out)) pass('C  it is called WRONG-MAP, not STALE'); else fail(`C  wrong verdict:\n${out}`);
  if (/Fixtown Nested/.test(out)) pass('C  it names the map whose report it actually is');
  else fail(`C  the owning map is not named:\n${out}`);
}

/* ---- E: an S6 report exists and the mirror does not -------------------- */
{
  const { code, out } = run(estate(({ town }) => {
    fs.rmSync(path.join(town, '_latest', 'verification.docx'));
  }));
  if (code === 1) pass('E  a missing mirror is red'); else fail(`E  exited ${code}, expected 1:\n${out}`);
  if (/Fixtown — MISSING/.test(out)) pass('E  it is called MISSING'); else fail(`E  wrong verdict:\n${out}`);
}

/* ---- F: a nested place is graded on its OWN report ---------------------- */
{
  const { code, out } = run(estate(({ place }) => {
    fs.writeFileSync(path.join(place, '_latest', 'verification.docx'), 'TOWN-OWN-REPORT');
  }));
  if (code === 1) pass('F  a nested place with a wrong mirror is red'); else fail(`F  exited ${code}, expected 1:\n${out}`);
  if (/Fixtown Nested — WRONG-MAP/.test(out)) pass('F  the place is graded, not skipped as part of its town');
  else fail(`F  the nested place was not graded:\n${out}`);
}

/* ---- the unknown-flag refusal ------------------------------------------ */
{
  const r = spawnSync(process.execPath, [GATE, '--tree', 'x'], { encoding: 'utf8' });
  if (r.status === 2) pass('an unknown flag is refused, exit 2');
  else fail(`an unknown flag exited ${r.status}, expected 2:\n${r.stdout}${r.stderr}`);
}

console.log(failures ? `\n${failures} case(s) failed` : '\nall cases behaved as required');
process.exit(failures ? 1 : 0);
