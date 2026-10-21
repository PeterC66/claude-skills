#!/usr/bin/env node
/*
 * design_key_check.js — a routes.json `design` key that no engine file reads.
 *
 *   node assets/design_key_check.js "<path to a routes.json>" [--place]
 *
 * Run from `make-bus-leaflet/`. The first argument is the routes.json to read;
 * `--place` adds the place engine's folder to the read set, as a place map's S4
 * does. Exit 0 when every key is read, 1 when any is not, 2 on a usage error.
 * stdout carries the messages, one per line.
 *
 * WHY THIS EXISTS (buses-data OA-652, the unfinished half of OA-632). A key under
 * `design` that the engine does not read draws the default and says nothing: a
 * typo, a key that belongs at the top level (`legendAt`, which OA-632 caught by
 * name), or a key the engine has retired. OA-632 could not ask this of the
 * external generator alone, because `design` is shared with `gen_internal.js`;
 * asked against the UNION of every engine file's reads it is easy.
 *
 * THE READ SET IS THE SAME SCAN `tools/check-design-keys.js` USES, not a third
 * copy: that checker requires `scanDesignReads` from here and gates the result
 * equal to the register in `references/design-quality.md`. So a key the engine
 * starts reading is in this set the moment it is in the register, and the two
 * cannot drift. The scan reads raw source, comments included (the checker's
 * header says why), so it can only over-count, and an over-count here means a
 * warning not given, never a false one.
 *
 * "MOVE IT UP". A key the engine reads at the TOP level of routes.json gets a
 * message saying so. The generators read the top level through `D` (both
 * external generators) and `RJ` (both internal ones); a top-level read under any
 * other name is not seen, and that key gets the general message instead.
 *
 * A key beginning `_` is a note to the reader, never a setting, and is not asked.
 *
 * WHY HERE AND NOT IN A GENERATOR: the same reason as external_config_check.js.
 * `build_s4.js` calls this once per build and files what it says in the run
 * folder's `build-warnings.txt` as WARN. It is in no generator's require graph,
 * so it is in no hash and moves no byte of any sheet. Keep it that way. And this
 * file is itself scanned by check-design-keys.js, so never write a design key
 * here in its dotted form: the checker would register it as one the engine reads.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KEY_RE = /\b(?:design|DESIGN)\.([A-Za-z][A-Za-z0-9]*)/g;
const TOP_RE = /\b(?:D|RJ)\.([A-Za-z][A-Za-z0-9]*)/g;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SK = __dirname;
const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');

/**
 * Every `design` key read across one folder's `*.js`. `raw` maps each key to the
 * files naming it, comments included; `code` is the same scan with comments
 * stripped; `top` is every top-level routes.json key read through `D` or `RJ`.
 */
function scanDesignReads(dir) {
  const raw = new Map();
  const code = new Set();
  const top = new Set();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(KEY_RE)) {
      if (!raw.has(m[1])) raw.set(m[1], new Set());
      raw.get(m[1]).add(f);
    }
    for (const m of stripComments(src).matchAll(KEY_RE)) code.add(m[1]);
    for (const m of src.matchAll(TOP_RE)) if (m[1] !== 'design') top.add(m[1]);
  }
  return { raw, code, top, files: files.length };
}

/**
 * The read set for one map: the town engine, and the place engine too for a place.
 * A folder that is not there is passed over: the place engine is beside the town
 * engine in the repository but not in a mutation run's scratch copy, and a smaller
 * set can only add warnings, never hide one.
 */
function engineReadSet({ place = false, dirs } = {}) {
  const read = new Set();
  const top = new Set();
  for (const dir of dirs || (place ? [SK, PSK] : [SK])) {
    if (!fs.existsSync(dir)) continue;
    const s = scanDesignReads(dir);
    for (const k of s.raw.keys()) read.add(k);
    for (const k of s.top) top.add(k);
  }
  return { read, top };
}

/**
 * Every message for one parsed routes.json, in key order. Each begins with the
 * `designKey:` prefix so build_log.js reads it as one entry, and none uses a
 * phrase that file classifies as BLOCKING: a key drawn as its default is worth
 * reading and never worth stopping a build over. `set` is for tests.
 */
function designKeyWarnings(D, { place = false, set } = {}) {
  const d = (D && D.design) || {};
  if (typeof d !== 'object' || Array.isArray(d)) return [];
  const { read, top } = set || engineReadSet({ place });
  const out = [];
  for (const k of Object.keys(d)) {
    if (k.startsWith('_') || read.has(k)) continue;
    if (top.has(k)) {
      out.push(`designKey: ${k} under design is ignored. ${k} is a top-level routes.json key; `
        + 'move it up out of design, or the sheet draws as if it were not set.');
    } else {
      out.push(`designKey: ${k} under design is read by no engine file, so the sheet draws as if it `
        + 'were not set. Check its spelling against the design register in '
        + 'make-bus-leaflet/references/design-quality.md, or remove it.');
    }
  }
  return out;
}

function main(argv) {
  const place = argv.includes('--place');
  const rest = argv.filter((a) => a !== '--place');
  const file = rest[0];
  if (!file || rest.length > 1) {
    console.error('usage: node assets/design_key_check.js "<path to a routes.json>" [--place]');
    return 2;
  }
  let D;
  try { D = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error(`design_key_check: cannot read ${file}: ${e.message}`);
    return 2;
  }
  const msgs = designKeyWarnings(D, { place });
  for (const m of msgs) console.log(m);
  return msgs.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { scanDesignReads, engineReadSet, designKeyWarnings, KEY_RE };
