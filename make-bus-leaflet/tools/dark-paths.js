#!/usr/bin/env node
/*
 * dark-paths.js — compare the two things NO byte gate reads.
 *
 *   node tools/dark-paths.js --before <gen.js>          record
 *   node tools/dark-paths.js --after  <gen.js>          record
 *   node tools/dark-paths.js --diff                     compare the two
 *
 * Run from `make-bus-leaflet/`. `<gen.js>` is the path to the generator to run
 * — typically `assets/gen_internal.js` for the "after", and a copy of the same
 * file at the previous commit for the "before" (`git show HEAD:… > /tmp/x.js`).
 * `--buses` overrides the data tree; there are no other parameters.
 *
 * WHAT IT COMPARES, per map: the SHA-256 of the generated `internal.svg`, the
 * number of `data-kind` attributes in it, the process exit status, and the
 * NORMALISED stderr. It runs with `EDITOR_KEYS=1` and `STRICT_GUARDS=1`.
 *
 * WHY BOTH OF THOSE ARE DARK TO status.js. The byte gate deliberately runs with
 * EDITOR_KEYS unset — `gate_lib.runGenerator` deletes it — so `gk()` emits
 * nothing at all and the entire editor-key wrapper is uncertified by every map
 * on the board. 18 of the 20 maps DO emit `data-kind` attributes once it is
 * set, so it is a real code path with real coverage that nothing was checking.
 * And stderr is not part of any artefact, so a guard that changes what it warns
 * about moves no bytes: 19 of 20 maps write to it. Extracting the SVG
 * primitives touched both, which is why this exists.
 *
 * STDERR HAS TO BE NORMALISED OR IT IS ALL FALSE POSITIVES. Temp workspace
 * paths differ every run, and `at …:LINE:COL` stack frames move whenever a
 * file's length changes — which an extraction always does. Both are stripped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SK = path.join(__dirname, '..');
const GL = require(path.join(SK, 'assets/gate_lib.js'));
const { resolveBuses } = require('../assets/cli');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BUSES = resolveBuses({ buses: arg('buses') });
const OUT = (which) => path.join(SK, 'tools', `.dark-paths-${which}.json`);

const normErr = (e) => String(e)
  .split(/\r?\n/)
  .map((l) => l.replace(/[A-Za-z]:[\\/][^\s"']*/g, '<path>'))
  .filter((l) => !/^\s+at /.test(l))
  .join('\n')
  .trim();

function sweep(genPath) {
  if (!fs.existsSync(genPath)) { console.error(`no such generator: ${genPath}`); process.exit(2); }
  const towns = GL.findTowns(BUSES);
  const places = GL.findPlaces(towns, BUSES);
  const maps = [
    ...towns.map((t) => ({ name: t.name, dir: t.dir })),
    ...places.map((p) => ({ name: `${p.town || '(standalone)'}/${p.name}`, dir: p.dir })),
  ];
  const result = {};
  for (const m of maps) {
    let mani;
    try { mani = JSON.parse(fs.readFileSync(path.join(m.dir, 'manifest.json'), 'utf8')); } catch (e) { continue; }
    const s4 = GL.latestRunDir(mani, m.dir, 'S4');
    if (!s4) { result[m.name] = { skip: 'no S4 run' }; continue; }
    if (!fs.existsSync(path.join(s4.dir, 'internal.svg'))) { result[m.name] = { skip: 'no internal sheet' }; continue; }
    const r = GL.runGenerator(genPath, s4.dir, { extraEnv: { EDITOR_KEYS: '1', STRICT_GUARDS: '1' } });
    const svgPath = path.join(r.tmpDir, 'internal.svg');
    const svg = fs.existsSync(svgPath) ? fs.readFileSync(svgPath) : null;
    result[m.name] = {
      ok: r.ok,
      svg: svg ? crypto.createHash('sha256').update(svg).digest('hex').slice(0, 16) : null,
      dataKeys: svg ? (svg.toString('utf8').match(/data-kind="/g) || []).length : 0,
      stderr: normErr(r.stderr),
    };
    GL.rmTmp(r.tmpDir);
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  return result;
}

const which = process.argv.includes('--before') ? 'before' : process.argv.includes('--after') ? 'after' : null;
if (which) {
  const gen = arg(which);
  const res = sweep(gen);
  fs.writeFileSync(OUT(which), JSON.stringify(res, null, 1) + '\n');
  const rendered = Object.values(res).filter((v) => v.svg).length;
  const keyed = Object.values(res).filter((v) => v.dataKeys > 0).length;
  const err = Object.values(res).filter((v) => v.stderr).length;
  const refused = Object.values(res).filter((v) => v.ok === false).length;
  console.log(`${which}: ${Object.keys(res).length} maps, ${rendered} rendered, ${keyed} emitted data-kind attrs, ${err} wrote to stderr, ${refused} refused under STRICT_GUARDS`);
  // A run where nothing exercises the editor-key path is not a clean comparison,
  // it is a comparison of nothing — same trap as a fixture that predates a change.
  if (!keyed) console.log('⚠ NO map emitted a data-kind attribute: the EDITOR_KEYS path did not run, so this proves nothing about it.');
  process.exit(0);
}

if (!process.argv.includes('--diff')) {
  console.error('usage: dark-paths.js --before <gen.js> | --after <gen.js> | --diff');
  process.exit(2);
}
for (const w of ['before', 'after']) {
  if (!fs.existsSync(OUT(w))) { console.error(`missing the "${w}" sweep — run --${w} first.`); process.exit(2); }
}
const a = JSON.parse(fs.readFileSync(OUT('before'), 'utf8'));
const b = JSON.parse(fs.readFileSync(OUT('after'), 'utf8'));
const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
let bad = 0;
for (const k of keys) {
  const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
  if (x === y) continue;
  bad++;
  console.log(`DIFF ${k}`);
  console.log(`  before ${x}`);
  console.log(`  after  ${y}`);
}
if (bad) { console.log(`${bad} of ${keys.length} maps differ on a path no byte gate reads.`); process.exit(1); }
console.log(`IDENTICAL across all ${keys.length} maps — SVG hash, data-kind count, exit status and stderr.`);
