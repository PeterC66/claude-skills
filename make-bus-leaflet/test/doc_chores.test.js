'use strict';
// doc_chores.js (buses-data OA-597): the two documentation checks are chores, and a chore is never an exit code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chores = require('./_engine.js').load('doc_chores.js');

/** A buses root whose two checkers exit with the given codes and print one line each. */
function tree(coverageExit, indexedExit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docchores-'));
  fs.mkdirSync(path.join(root, 'Documentation'));
  fs.writeFileSync(path.join(root, 'Documentation', 'check-doc-coverage.mjs'), `console.log('orphan.md is held by nothing'); process.exit(${coverageExit});\n`);
  fs.writeFileSync(path.join(root, 'Documentation', 'check-scripts-indexed.mjs'), `console.log('args ' + process.argv.slice(2).join(' ')); process.exit(${indexedExit});\n`);
  return root;
}

test('exit 0 is ok, exit 1 is a chore carrying the checker\'s own words', () => {
  const rows = chores.ask({ buses: tree(1, 0), skills: '/skills' });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].state, 'chore');
  assert.deepStrictEqual(rows[0].lines, ['orphan.md is held by nothing']);
  assert.strictEqual(rows[1].state, 'ok');
  assert.deepStrictEqual(chores.chores(rows).map((r) => r.id), ['doc-coverage']);
});

test('exit 2 is could-not-look, never a chore and never a pass', () => {
  const rows = chores.ask({ buses: tree(2, 2) });
  assert.deepStrictEqual(rows.map((r) => r.state), ['could-not-look', 'could-not-look']);
  assert.deepStrictEqual(chores.chores(rows), []);
});

test('the scripts-page check is handed the skills root', () => {
  const rows = chores.ask({ buses: tree(0, 1), skills: '/the/skills' });
  assert.ok(rows[1].lines[0].includes('--skills /the/skills'), rows[1].lines[0]);
});

test('a tree without the scripts is not asked, and says so', () => {
  const rows = chores.ask({ buses: fs.mkdtempSync(path.join(os.tmpdir(), 'docchores-empty-')) });
  assert.deepStrictEqual(rows.map((r) => r.state), ['not-asked', 'not-asked']);
  assert.ok(chores.lines(rows).join('\n').includes('not asked'));
});
