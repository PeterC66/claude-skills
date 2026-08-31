/*
 * stray_outputs.js — the sweep for a run folder holding a file a LATER stage declares.
 *
 * The interesting assertion is not that it FINDS things: it is that it finds only
 * the dangerous direction. A downstream folder holding an upstream file is
 * ordinary and everywhere -- every S4 holds the S2 geometry it was built from --
 * and reporting that would bury the eight real ones in about seven hundred lines,
 * which is how a check gets muted in its first week.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const TOOL = path.join(__dirname, '..', 'assets', 'stray_outputs.js');

function estate() {
  return scratchDir('strays-');
}
function unit(root, rel, stages) {
  const dir = path.join(root, rel);
  const m = { town: path.basename(rel), stages: {} };
  const DIRN = { S1: 'S1-services', S2: 'S2-geometry', S3: 'S3-config', S4: 'S4-generate', S5: 'S5-render' };
  for (const [st, spec] of Object.entries(stages)) {
    const id = spec.id || '2026-08-01_0000';
    const rd = path.join(DIRN[st], id);
    fs.mkdirSync(path.join(dir, rd), { recursive: true });
    for (const f of spec.files) fs.writeFileSync(path.join(dir, rd, f), '{}');
    m.stages[st] = { name: st, latest: id, runs: [{ id, dir: rd.split(path.sep).join('/'), outputs: spec.outputs }] };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 1));
  return dir;
}
function run(root) {
  const r = spawnSync(process.execPath, [TOOL, '--buses', root, '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'reported, not gated — it must exit 0: ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('CONTROL — a clean estate reports nothing', () => {
  const root = estate();
  unit(root, path.join('Areas', 'Tidyton'), {
    S2: { files: ['osm.json'], outputs: ['osm.json'] },
    S3: { files: ['routes.json'], outputs: ['routes.json'] },
  });
  assert.deepStrictEqual(run(root), []);
});

test('CONTROL — a DOWNSTREAM folder holding an upstream file is ordinary and is not reported', () => {
  const root = estate();
  unit(root, path.join('Areas', 'Normalton'), {
    S2: { files: ['osm.json'], outputs: ['osm.json'] },
    S4: { files: ['internal.svg', 'osm.json'], outputs: ['internal.svg'] },
  });
  assert.deepStrictEqual(run(root), [], 'every S4 on the estate holds the S2 geometry it was built from');
});

test('CONTROL — a file the stage DECLARES is its own output, not a stray', () => {
  const root = estate();
  unit(root, path.join('Areas', 'Declareton'), {
    S2: { files: ['routes.json'], outputs: ['routes.json'] },
    S3: { files: ['routes.json'], outputs: ['routes.json'] },
  });
  assert.deepStrictEqual(run(root), []);
});

test('an EARLY folder holding a file a LATER stage declares is reported', () => {
  const root = estate();
  unit(root, path.join('Areas', 'Beaconsfieldish'), {
    S2: { files: ['osm.json', 'routes.json'], outputs: ['osm.json'] },
    S3: { files: ['routes.json'], outputs: ['routes.json'] },
  });
  const rows = run(root);
  assert.strictEqual(rows.length, 1, 'exactly the July-draft shape that cost Beaconsfield Waitrose its config');
  assert.strictEqual(rows[0].stage, 'S2');
  assert.strictEqual(rows[0].file, 'routes.json');
  assert.deepStrictEqual(rows[0].declaredBy, ['S3']);
});

test('a standalone place under Places/ is enumerated too, not only Areas/', () => {
  const root = estate();
  unit(root, path.join('Places', '_standalone', 'Loneton Co-op'), {
    S1: { files: ['place.json', 'atco2ll.json'], outputs: ['place.json'] },
    S2: { files: ['atco2ll.json'], outputs: ['atco2ll.json'] },
  });
  const rows = run(root);
  assert.strictEqual(rows.length, 1, 'an enumeration that walks past a map is this project\'s most-repeated bug');
  assert.strictEqual(rows[0].file, 'atco2ll.json');
});

test('--strict exits 1 on a find and 0 on a clean estate', () => {
  const dirty = estate();
  unit(dirty, path.join('Areas', 'Dirtyton'), {
    S2: { files: ['osm.json', 'routes.json'], outputs: ['osm.json'] },
    S3: { files: ['routes.json'], outputs: ['routes.json'] },
  });
  const clean = estate();
  unit(clean, path.join('Areas', 'Cleanton'), { S3: { files: ['routes.json'], outputs: ['routes.json'] } });
  const go = (root) => spawnSync(process.execPath, [TOOL, '--buses', root, '--strict'], { encoding: 'utf8' }).status;
  assert.strictEqual(go(dirty), 1);
  assert.strictEqual(go(clean), 0);
});
