'use strict';
// portal_deps.js (buses-data OA-567): a missing portal node_modules is a chore with its repair.
// Real scratch folders, because the subject is a folder being ABSENT and a fake reader cannot be.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pd = require('./_engine.js').load('portal_deps.js');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'portal-deps-'));
const portalWith = (parts) => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  if (parts.includes('nm')) fs.mkdirSync(path.join(dir, 'node_modules'));
  if (parts.includes('sharp')) {
    fs.mkdirSync(path.join(dir, 'node_modules', 'sharp'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'sharp', 'package.json'), '{}');
  }
  return dir;
};

test('no checkout here (CI, a fresh clone, no path) is silent, not a fault', () => {
  assert.strictEqual(pd.read(null), null);
  assert.strictEqual(pd.read(path.join(scratch(), 'nowhere')), null);
  assert.strictEqual(pd.read(scratch()), null, 'a folder with no package.json is not a portal checkout');
  assert.strictEqual(pd.item(null), null);
});

test('node_modules absent: named, with npm ci as the repair', () => {
  const dir = portalWith([]);
  assert.deepStrictEqual(pd.read(dir), { portal: dir, ok: false, missing: ['node_modules'] });
  const it = pd.item(dir);
  assert.strictEqual(it.key, 'portal-deps');
  assert.strictEqual(it.rank, 8, 'a chore, never a red');
  assert.strictEqual(it.do[0].cmd, `npm --prefix "${dir}" ci`);
  assert.match(it.why, /Never a junction or symlink/);
});

test('node_modules present but sharp absent: still named — an emptied folder is the 3 Oct shape', () => {
  const dir = portalWith(['nm']);
  assert.deepStrictEqual(pd.read(dir).missing, ['node_modules/sharp']);
  assert.match(pd.item(dir).title, /no node_modules\/sharp/);
});

test('CONTROL — the repaired checkout raises nothing', () => {
  const dir = portalWith(['nm', 'sharp']);
  assert.strictEqual(pd.read(dir).ok, true);
  assert.strictEqual(pd.item(dir), null);
});

test('printSection prints only when something is missing', () => {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  try {
    pd.printSection(pd.read(portalWith(['nm', 'sharp'])));
    pd.printSection(null);
    assert.strictEqual(lines.length, 0);
    pd.printSection(pd.read(portalWith([])));
  } finally { console.log = orig; }
  assert.match(lines.join('\n'), /Portal dependencies \(a chore, not red/);
  assert.match(lines.join('\n'), /repair: {2}npm --prefix ".*" ci/);
});

test('the wires RUN: status.js reads, prints and reports it in --json; the worklist adds the row', () => {
  const live = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const status = live(path.join(__dirname, '..', 'assets', 'status.js'));
  assert.ok(status.some((l) => l.includes("portalDeps = require('./portal_deps').read(PORTAL)")), 'status.js reads it');
  assert.ok(status.some((l) => l.includes("require('./portal_deps').printSection(portalDeps)")), 'status.js prints it');
  assert.ok(status.some((l) => l.includes('processSize: procSize, portalDeps,')), 'status.js --json carries it');
  // Never in `bad`: the exit code is for a fault only.
  assert.ok(!status.some((l) => /\bbad\s*(\.push\(|=|\|\|)[^;]*portalDeps/.test(l)), 'portalDeps must not feed `bad`');
  const wl = live(path.join(__dirname, '..', '..', 'bus-work', 'assets', 'worklist.mjs'));
  assert.ok(wl.some((l) => l.includes("require(path.join(SK, 'portal_deps.js')).item(PORTAL)")), 'worklist.mjs adds the row');
});
