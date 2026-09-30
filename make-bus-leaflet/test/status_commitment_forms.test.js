'use strict';
// status.js: the human board and `--json` must give the SAME exit code for a
// commitment (buses-data adhoc board-status, 2026-09-30).
//
// A tick at 05:15 that day read the human form exit 1 and `--json` exit 0 on
// what it took to be one state, with an overdue commitment as the only fault.
// On the engine of the day both forms return the one expression at the foot of
// main(), and have since 5955f88 (2026-08-31); the reading most likely
// straddled buses-data 29bf1257, which re-dated that commitment at 05:30. So
// nothing needed fixing, and nothing pinned the agreement either: a refactor that
// gave the JSON branch its own verdict would have made CI (which runs `--json`)
// green for a fault the human board goes red for. This pins it.
//
// An empty scratch Buses tree holding only commitments.json, no portal, no
// quality ledger and no live site: nothing but the commitment can colour the
// board, which the future-dated control proves on every run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');

const STATUS = path.join(ENGINE_DIR, 'status.js');

function tree(by) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-commit-'));
  fs.mkdirSync(path.join(root, 'Development Docs'));
  fs.writeFileSync(path.join(root, 'Development Docs', 'commitments.json'),
    JSON.stringify({ commitments: [{ id: 'x', what: 'Do x', by }] }, null, 2));
  return root;
}

function exitCode(root, json) {
  const r = spawnSync(process.execPath, [STATUS, '--buses', root, '--portal', path.join(root, '__no-portal__'),
    '--no-quality', '--no-live', '--commitments-today', '2026-09-30', ...(json ? ['--json'] : [])],
    { encoding: 'utf8', timeout: 120000 });
  return r.status;
}

function both(by) {
  const root = tree(by);
  try { return { human: exitCode(root, false), json: exitCode(root, true) }; }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('control: a commitment not yet due leaves both forms green', () => {
  assert.deepStrictEqual(both('2026-12-31'), { human: 0, json: 0 });
});

test('an OVERDUE commitment reddens the human board AND --json, alike', () => {
  assert.deepStrictEqual(both('2026-09-01'), { human: 1, json: 1 });
});

test('an UNDATED commitment reddens both forms alike', () => {
  assert.deepStrictEqual(both('someday'), { human: 1, json: 1 });
});
