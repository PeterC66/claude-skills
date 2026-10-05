/*
 * workspace_inputs — every input the run folder holds reaches the schematic and
 * diagram workspaces, with no edit to either pre-stage (buses-data OA-491).
 *
 * schematize_internal.js and diagram_internal.js run gen_internal.js one folder
 * down, in a workspace they write, and until 2026-09-28 they copied the rest of
 * its inputs from a hand-kept list. A file gen_internal.js started reading was
 * absent there until someone added it to both lists, and nothing failed: the
 * generator reads a missing optional input as "not configured" and draws a
 * quieter sheet. It happened three times — overrides.json, unplaced.json coming
 * back out, and journey_weights.json (OA-452), whose minority note vanished from
 * the schematic of High Wycombe and St Neots.
 *
 * So this suite hands each pre-stage a run folder carrying a file no engine
 * reads yet and asserts it arrives byte for byte, which is the claim a list can
 * never make. It also pins the two ways the inversion could go wrong: a stale
 * OUTPUT of the last build copied in and passed off as this run's, and a
 * straight copy clobbering a file the pre-stage warps. The estate half — that
 * all 22 ci-references draw byte-identically before and after — was measured
 * once, at the change, and is the byte gate's job from then on.
 *
 * Both pre-stages run top to bottom on load, so they are spawned, with
 * SCHEMATIZE_ONLY / DIAGRAM_ONLY set: the workspace is the subject, and the
 * render after it is gen_internal.js's business.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');

const MARCH = path.join(__dirname, 'fixtures', 'estate', 'Areas', 'March', 'ci-reference');
const NEW_INPUT = { name: 'zz_input_no_engine_reads_yet.json', body: '{"oa491":"arrives by default"}' };

function runFolder(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa491-' + tag + '-'));
  for (const f of fs.readdirSync(MARCH)) if (f.endsWith('.json')) fs.copyFileSync(path.join(MARCH, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, NEW_INPUT.name), NEW_INPUT.body);
  // A geographic overrides.json the workspace has never read, and a stale drop report.
  fs.writeFileSync(path.join(dir, 'overrides.json'), '{"internal":{"stale":"geographic"}}');
  fs.writeFileSync(path.join(dir, 'unplaced.json'), '[{"text":"a label from the LAST build"}]');
  return dir;
}

function workspace(script, dir, env) {
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, script)],
    { cwd: dir, env: { ...process.env, LEAFLET_DIR: dir, SKILL_ASSETS: ENGINE_DIR, OVERRIDES_FILE: '', ...env }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, script + ' failed: ' + r.stderr.slice(-400));
  return r;
}

for (const [script, sub, env, optIn] of [
  ['schematize_internal.js', 'schematic', { SCHEMATIZE_ONLY: '1' }, null],
  ['diagram_internal.js', 'diagram', { DIAGRAM_ONLY: '1' }, 'internalDiagram'],
]) {
  test(script + ': a json input no pre-stage names reaches the workspace byte for byte', () => {
    const dir = runFolder(sub);
    if (optIn) {
      const rj = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
      rj[optIn] = true;
      fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj));
    }
    workspace(script, dir, env);
    const wd = path.join(dir, sub);
    assert.strictEqual(fs.readFileSync(path.join(wd, NEW_INPUT.name), 'utf8'), NEW_INPUT.body);
    // intown_cfg.json and atco2name.json were on the old list; they must still arrive.
    for (const f of ['atco2name.json', 'intown_cfg.json', 'routes_intown_atco.json'])
      assert.ok(fs.readFileSync(path.join(wd, f)).equals(fs.readFileSync(path.join(dir, f))), f + ' did not arrive intact');
  });

  test(script + ': the last build\'s outputs and the geographic overrides stay out', () => {
    const dir = runFolder(sub + '-out');
    if (optIn) {
      const rj = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
      rj[optIn] = true;
      fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj));
    }
    workspace(script, dir, env);
    const wd = path.join(dir, sub);
    for (const f of ['unplaced.json', 'indexed.json', 'build-meta.json', 'minority.json'])
      assert.ok(!fs.existsSync(path.join(wd, f)), f + ' was copied into the workspace, where it reads as this run\'s');
    // The diagram puts its OWN diagram-overrides.json there when it has one; March has none.
    assert.ok(!fs.existsSync(path.join(wd, 'overrides.json')), 'the geographic overrides.json reached the ' + sub + ' workspace');
  });

  test(script + ': a file the pre-stage warps is its warped version, not the straight copy', () => {
    const dir = runFolder(sub + '-warp');
    if (optIn) {
      const rj = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
      rj[optIn] = true;
      fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj));
    }
    workspace(script, dir, env);
    const wd = path.join(dir, sub);
    for (const f of ['routes_paths.json', 'atco2ll.json', 'roads_geo.json', 'routes.json', 'osm.json'])
      assert.ok(!fs.readFileSync(path.join(wd, f)).equals(fs.readFileSync(path.join(dir, f))), f + ' in the workspace is the unwarped run-folder copy');
  });
}
