/*
 * sheet_registry.js — the one list of sheets, and the consumer check (OA-098).
 *
 * The list itself is data, so testing that it contains five strings would only
 * assert what was typed. What is worth asserting is the CONTRACT the consumers
 * lean on: that a sheet is declared by the map rather than by what is on disk,
 * that boarding is place-only because gen_boarding.js reads place.json, and that
 * the consumer check fires on each way a consumer can fall behind.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GEN = require('../assets/sheet_registry.js');

/*
 * collect-maps.ps1 lives in the OTHER repository, and the two are laid out
 * differently on the laptop and in CI: here it is ../../../../Using AI/Buses,
 * there the workflow checks buses-data out beside skills/. Hard-coding either one
 * is the shape "a harness as local as its subject", which has turned this repo's
 * CI red before. So: try both, honour BUSES_DIR, and SKIP loudly rather than fail
 * when neither is there — a cross-repo fixture that is absent is not a defect in
 * the registry, and a suite that goes red for the wrong reason teaches nobody.
 */
// BUSES_DIR, when set, is AUTHORITATIVE — a wrong value skips rather than quietly
// falling back to whichever other tree happens to be on this disk. Answering about
// a repository the caller did not name is how a check comes to describe the
// neighbour instead of its subject.
const PS1 = (process.env.BUSES_DIR
  ? [path.join(process.env.BUSES_DIR, 'collect-maps.ps1')]
  : [path.join(__dirname, '..', '..', '..', '..', 'Using AI', 'Buses', 'collect-maps.ps1'),
     path.join(__dirname, '..', '..', '..', 'buses-data', 'collect-maps.ps1')]
).find(p => fs.existsSync(p));

const needsPs1 = { skip: PS1 ? false : 'collect-maps.ps1 not found beside this repo (set BUSES_DIR to point at buses-data)' };

test('a sheet with no opt-in key is drawn for every map', () => {
  const always = GEN.SHEETS.filter(s => !s.optIn).map(s => s.key);
  assert.deepStrictEqual(always, ['internal', 'external']);
});

test('declaredBy reads the map DECLARATION, not the disk', () => {
  // The distinction status.js spells out as MISSING vs '-'. A map that asks for a
  // schematic still declares it when the file is absent, because a failed build
  // must not read as a sheet nobody wanted.
  const outs = GEN.declaredBy({ internalSchematic: true }, 'svg').map(s => s.out);
  assert.deepStrictEqual(outs, ['internal.svg', 'external.svg', 'internal-schematic.svg']);
});

test('a map that declares nothing still gets the two unconditional sheets', () => {
  assert.deepStrictEqual(GEN.declaredBy({}, 'svg').map(s => s.out), ['internal.svg', 'external.svg']);
});

test('declaredBy tolerates a missing routes.json object rather than throwing', () => {
  assert.deepStrictEqual(GEN.declaredBy(null, 'svg').map(s => s.key), ['internal', 'external']);
});

test('the extension is the caller\'s choice — the delivery path wants jpg', () => {
  assert.ok(GEN.basenames('jpg').includes('boarding.jpg'));
  assert.ok(GEN.basenames('svg').includes('boarding.svg'));
});

test('boarding is place-only, because gen_boarding.js reads place.json', () => {
  const boarding = GEN.SHEETS.find(s => s.key === 'boarding');
  assert.strictEqual(boarding.level, 'place');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'gen_boarding.js'), 'utf8');
  assert.match(src, /rd\('place\.json'\)/,
    'if gen_boarding.js stops reading place.json, re-measure whether boarding is still place-only');
});

test('every sheet declares a level, so the consumer check can never skip one silently', () => {
  for (const s of GEN.SHEETS) {
    assert.ok(['both', 'place'].includes(s.level), `${s.key} has no usable level`);
  }
});

// ---- the consumer check ----------------------------------------------------

function withPs1(mutate) {
  const src = fs.readFileSync(PS1, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-reg-'));
  const p = path.join(dir, 'collect-maps.ps1');
  fs.writeFileSync(p, mutate(src));
  return p;
}

test('CONTROL — the real collect-maps.ps1 agrees with the registry', needsPs1, () => {
  assert.deepStrictEqual(GEN.checkPowershellConsumer(PS1), [],
    'the control must stay green: a check only ever seen to complain has not been shown to pass');
});

test('a sheet dropped from the ValidateSet is caught', needsPs1, () => {
  const p = withPs1(s => s.replace("'internal-diagram','boarding'", "'internal-diagram'"));
  const f = GEN.checkPowershellConsumer(p);
  assert.ok(f.some(x => /ValidateSet is missing "boarding"/.test(x)), f.join(' | '));
});

test('a sheet dropped from the -All path is caught, for the right level', needsPs1, () => {
  const p = withPs1(s => s.replace(/\s*Sync-MapSet\s+-Level\s+place\s+-Type\s+boarding/, ''));
  const f = GEN.checkPowershellConsumer(p);
  assert.ok(f.some(x => /never collects "boarding" for level "place"/.test(x)), f.join(' | '));
});

test('a sheet collected for a level that cannot have it is caught too', needsPs1, () => {
  // The check has to fire in BOTH directions, or "add the line to make it green"
  // becomes the fix for a finding that was never a fault.
  const p = withPs1(s => s.replace('    Sync-MapSet -Level area  -Type external',
    '    Sync-MapSet -Level area  -Type boarding\n    Sync-MapSet -Level area  -Type external'));
  const f = GEN.checkPowershellConsumer(p);
  assert.ok(f.some(x => /collects "boarding" for level "area", which cannot have one/.test(x)), f.join(' | '));
});

test('a ValidateSet the check can no longer find is a finding, not a silent pass', needsPs1, () => {
  // The failure that matters most: the check losing sight of its subject and
  // reporting nothing. It used to anchor on the FIRST ValidateSet in the file,
  // which was -Level's, and reported all five sheets missing plus two invented.
  const p = withPs1(s => s.replace(/\[string\]\$Type/, '[string]$Kind'));
  const f = GEN.checkPowershellConsumer(p);
  assert.ok(f.some(x => /can no longer see the list/.test(x)), f.join(' | '));
});
