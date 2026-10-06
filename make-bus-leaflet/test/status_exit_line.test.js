'use strict';
// status.js: the LAST line of the board says why it exited as it did.
//
// 2026-10-06: the morning brief and another session read a truncated board that had
// exited 1 and could not tell which line was the fault. It was one OVERDUE commitment
// row, r2-r4-week-after-the-audit-fix. The board now ends `EXIT 1 BECAUSE: [section] ...`
// for each fault and `EXIT 0: nothing red` otherwise, and a CHORE is never named.
//
// Two layers, because the whole board needs a portal, a quality ledger and a live site
// to be fully exercised: the real board against a scratch tree holding only a
// commitments.json (as status_commitment_forms.test.js does), and the pure module
// against the chores that must stay out of the line.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');
const { faultsOf, exitLines } = require(path.join(ENGINE_DIR, 'exit_reasons.js'));

const STATUS = path.join(ENGINE_DIR, 'status.js');
const ID = 'r2-r4-week-after-the-audit-fix';

function board(by) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-exit-line-'));
  try {
    fs.mkdirSync(path.join(root, 'Development Docs'));
    fs.writeFileSync(path.join(root, 'Development Docs', 'commitments.json'),
      JSON.stringify({ commitments: [{ id: ID, what: 'Re-date r2-r4', by }] }, null, 2));
    const r = spawnSync(process.execPath, [STATUS, '--buses', root, '--portal', path.join(root, '__no-portal__'),
      '--no-quality', '--no-live', '--commitments-today', '2026-10-06'], { encoding: 'utf8', timeout: 120000 });
    return { code: r.status, lines: r.stdout.split(/\r?\n/).filter(l => l !== '') };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('an OVERDUE commitment: exit 1, and the last line names its section and id', () => {
  const b = board('2026-10-05');
  assert.strictEqual(b.code, 1);
  const last = b.lines[b.lines.length - 1];
  assert.match(last, /^EXIT 1 BECAUSE: \[Commitments\] /);
  assert.ok(last.includes(ID), last);
  assert.ok(!b.lines.some(l => l.startsWith('EXIT 0')), 'a red board must not also say EXIT 0');
});

test('control: nothing overdue, exit 0, last line is "EXIT 0: nothing red"', () => {
  const b = board('2026-12-31');
  assert.strictEqual(b.code, 0);
  assert.strictEqual(b.lines[b.lines.length - 1], 'EXIT 0: nothing red');
});

test('chores alone print EXIT 0 and are never named', () => {
  const chores = {
    // a map drawn by an older engine, reproducing byte for byte
    townRows: [{ name: 'Ely', engine: 'old', engineCurrent: false, internal: 'PASS', external: 'PASS', schematic: '-', diagram: '-', s6Stale: true }],
    placeRows: [{ name: 'Tesco', engine: 'old', engineCurrent: false, internal: 'PASS', external: 'PASS', boarding: 'PASS', keys: { state: 'complete' }, s6Stale: true }],
    driftRows: [{ file: 'a.js', same: false, pinBehind: true }],
    deploy: { status: 'BEHIND', undateable: false },
    commit: { status: 'read', rows: [{ id: 'later', state: 'due soon', days: 3, by: '2026-10-09' }] },
    s6Limit: { checked: true, overdue: [], rows: [] },
  };
  assert.deepStrictEqual(faultsOf(chores), []);
  assert.deepStrictEqual(exitLines(false, faultsOf(chores)), ['EXIT 0: nothing red']);
});

test('a fault among chores is listed alone, one line each, with its section', () => {
  const ctx = {
    townRows: [{ name: 'Ely', engineCurrent: false, internal: 'PASS', external: 'PASS', s6Stale: true },
               { name: 'March', internal: 'DIFF', external: 'PASS' }],
    deploy: { status: 'BEHIND', undateable: false },
    commit: { status: 'read', rows: [{ id: ID, state: 'OVERDUE', days: -1, by: '2026-10-05' }] },
  };
  const lines = exitLines(true, faultsOf(ctx));
  assert.deepStrictEqual(lines, [
    'EXIT 1 BECAUSE: [Towns] March internal sheet DIFF',
    'EXIT 1 BECAUSE: [Commitments] ' + ID + ' OVERDUE by 1d (due 2026-10-05)',
  ]);
});

test('a red verdict no section claims says so rather than printing nothing', () => {
  const lines = exitLines(true, faultsOf({}));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^EXIT 1 BECAUSE: \[UNATTRIBUTED\] /);
});
