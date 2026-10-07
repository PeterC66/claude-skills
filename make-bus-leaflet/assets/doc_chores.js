/*
 * doc_chores.js — the two documentation checks that used to redden `main`, asked as
 * CHORES (buses-data OA-597, D9 of the 2026-10-06 simplification review).
 *
 * `Documentation/check-doc-coverage.mjs` (is every working document reachable from live
 * work) and `Documentation/check-scripts-indexed.mjs` (does the scripts page name every
 * script) each turned `main` red within a day of a routine act: a retirement, and three
 * new engine scripts. A page that does not name a script is housekeeping, not a fault in
 * anything that ships, and September's rule was no red for a chore. They are asked here
 * instead, printed on the board and carried by the bus-work worklist as one row.
 *
 * NOTHING HERE IS IN THE BOARD'S `bad`. A check that exits 1 is a CHORE; one that exits 2
 * (or cannot be run) is COULD NOT LOOK, printed apart and still not red; a script the
 * buses root does not carry (a fixture estate) is NOT ASKED. The board proves this:
 * prove-red-status breaks coverage on purpose and requires exit 0 with the chore printed.
 *
 * THIS FILE IS OUTSIDE BOTH ENGINE HASHES and must stay there: no generator requires it.
 * Zero dependencies (Node core only).
 *
 *   node assets/doc_chores.js --buses "<buses-data root>" [--skills "<claude-skills root>"] [--json]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECKS = [
  { id: 'doc-coverage', label: 'every working document is reachable from live work', script: 'check-doc-coverage.mjs', args: () => [] },
  { id: 'scripts-indexed', label: 'every script is named on the scripts page', script: 'check-scripts-indexed.mjs', args: (o) => (o.skills ? ['--skills', o.skills] : []) },
];

/* Ask both. Returns [{ id, label, state: 'ok' | 'chore' | 'could-not-look' | 'not-asked', lines }]. */
function ask(opts) {
  const o = opts || {};
  return CHECKS.map((c) => {
    const file = path.join(o.buses || '', 'Documentation', c.script);
    if (!o.buses || !fs.existsSync(file)) return { id: c.id, label: c.label, state: 'not-asked', lines: ['Documentation/' + c.script + ' is not in this tree'] };
    const r = spawnSync(process.execPath, [file, ...c.args(o)], { cwd: o.buses, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const text = ((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').map((l) => l.trim()).filter(Boolean);
    if (r.error || r.status === null) return { id: c.id, label: c.label, state: 'could-not-look', lines: [r.error ? r.error.message : 'killed by ' + r.signal] };
    if (r.status === 0) return { id: c.id, label: c.label, state: 'ok', lines: [] };
    return { id: c.id, label: c.label, state: r.status === 1 ? 'chore' : 'could-not-look', lines: text };
  });
}

const chores = (rows) => rows.filter((r) => r.state === 'chore');

function lines(rows) {
  const L = ['', '=== Document chores (a page not naming a thing is housekeeping: printed here and on the worklist, never red) ==='];
  for (const r of rows) {
    const mark = { ok: 'ok   ', chore: 'CHORE', 'could-not-look': '??   ', 'not-asked': '-    ' }[r.state];
    L.push('  ' + mark + ' ' + r.id + ' — ' + r.label + (r.state === 'not-asked' ? ' (not asked: ' + r.lines[0] + ')' : ''));
    if (r.state !== 'ok' && r.state !== 'not-asked') for (const l of r.lines.slice(0, 12)) L.push('         ' + l);
    if (r.state !== 'ok' && r.state !== 'not-asked' && r.lines.length > 12) L.push('         … ' + (r.lines.length - 12) + ' more lines; run node Documentation/check-' + (r.id === 'doc-coverage' ? 'doc-coverage' : 'scripts-indexed') + '.mjs');
  }
  return L;
}
function printSection(rows) { for (const l of lines(rows)) console.log(l); }

module.exports = { CHECKS, ask, chores, lines, printSection };

if (require.main === module) {
  const a = process.argv.slice(2);
  const v = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : null; };
  if (!v('buses')) { console.error('usage: node doc_chores.js --buses "<buses-data root>" [--skills "<claude-skills root>"] [--json]'); process.exit(2); }
  const rows = ask({ buses: path.resolve(v('buses')), skills: v('skills') ? path.resolve(v('skills')) : null });
  if (a.includes('--json')) console.log(JSON.stringify(rows, null, 2)); else printSection(rows);
  process.exit(0);
}
