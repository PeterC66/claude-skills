/*
 * complexity_score.js reports by default and writes complexity.json only under
 * --apply (buses-data OA-493, 2026-09-28).
 *
 * complexity.json is a TRACKED S2 output. Until this change every run wrote it,
 * --json included, so on 2026-09-27 a session that scored Beaconsfield and
 * St Neots only to read their candidate families rewrote both towns' committed
 * files; they were restored with `git checkout`, and a `git add -A` would have
 * shipped them. The scorer is run here, as a process, on a copy of March's
 * committed S2 inputs, because the property is about the disk and not about a
 * function's return value.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');

const SCORER = path.join(ENGINE_DIR, 'complexity_score.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'estate', 'Areas', 'March', 'ci-reference');
const INPUTS = ['routes_intown_atco.json', 'routes_atco.json', 'atco2ll.json', 'routes_paths.json',
                'intown_cfg.json', 'osm.json', 'osm2.json'];

function s2Copy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complexity-apply-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of INPUTS) fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
  return dir;
}
const score = (dir, ...flags) =>
  spawnSync(process.execPath, [SCORER, '--dir', dir, '--no-fail', ...flags], { encoding: 'utf8' });

test('a bare run reports and writes nothing', (t) => {
  const dir = s2Copy(t);
  const r = score(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /COMPLEXITY TRIAGE/);
  assert.match(r.stdout, /report only/);
  assert.ok(!fs.existsSync(path.join(dir, 'complexity.json')), 'a bare run wrote complexity.json');
});

test('--json prints the score to stdout and writes nothing', (t) => {
  const dir = s2Copy(t);
  const r = score(dir, '--json');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).band, 'no band in the --json output');
  assert.ok(!fs.existsSync(path.join(dir, 'complexity.json')), '--json wrote complexity.json');
});

test('a bare run leaves an existing complexity.json byte-identical', (t) => {
  const dir = s2Copy(t);
  const committed = '{"band":"the committed answer"}\n';
  fs.writeFileSync(path.join(dir, 'complexity.json'), committed);
  assert.strictEqual(score(dir, '--json').status, 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'complexity.json'), 'utf8'), committed);
});

test('--apply writes complexity.json, and it is the score the run printed', (t) => {
  const dir = s2Copy(t);
  const r = score(dir, '--json', '--apply');
  assert.strictEqual(r.status, 0, r.stderr);
  const file = path.join(dir, 'complexity.json');
  assert.ok(fs.existsSync(file), '--apply did not write complexity.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(r.stdout));
});
