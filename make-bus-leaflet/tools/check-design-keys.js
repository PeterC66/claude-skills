#!/usr/bin/env node
/*
 * check-design-keys.js — the `design.*` register must name every key the
 * engine reads, and no key it does not.
 *
 *   node tools/check-design-keys.js
 *
 * Run from `make-bus-leaflet/`. No arguments are needed; `--assets <dir>` and
 * `--doc <file>` exist only so `prove-red-design-keys.js` can point it at a
 * mutated copy, and nothing else should pass them.
 *
 * WHY THIS EXISTS. `references/design-quality.md` opens with a table of key /
 * default / what it does, and that table is the only thing in the system
 * shaped like a complete list of the `design` opt-ins. It was not one.
 * Measured 2026-08-28: the engine read 33 keys and the table held 19 rows.
 * Six of the missing fourteen were discussed further down the same document
 * and eight appeared nowhere in it, so a reader who trusted the register
 * concluded that `design.laneOrientation` — promoted to a DEFAULT the day
 * before — did not exist. Nothing could have caught that, because a table
 * with a Default column asserts completeness by construction: there is no
 * count to disagree with, and no check read it. Opened as OA-142.
 *
 * WHAT IT COMPARES. The set of `design.<key>` / `DESIGN.<key>` reads across
 * `assets/*.js`, against the first column of the table under the `## \`design\``
 * heading. A key on one side only fails the run, in both directions: an
 * undocumented key is the bug this was built for, and a documented key the
 * engine no longer reads is the same document going stale from the other end.
 *
 * IT SCANS RAW SOURCE, COMMENTS INCLUDED, AND THAT IS DELIBERATE. Stripping
 * comments needs a JS parser or a regex that will one day eat a string
 * containing `//` — and a mangled strip can only LOSE keys, which would
 * surface as a false "documented but not read" and send someone to delete a
 * real row. Scanning raw can only gain them, which surfaces as "document
 * this", and a key named in the engine's own comments but read nowhere is
 * worth surfacing anyway. The stripped set is computed too and reported as a
 * NOTE, never as a failure, so the difference stays visible without being
 * trusted. Today the two sets are identical.
 *
 * IT PRINTS THE COUNTS ON SUCCESS. A verdict alone cannot express coverage,
 * which was this family's actual bug — `check-tables.mjs` in `buses-data`
 * reported "362 rows, all well-formed" while it was blind to 78 of them.
 * `prove-red-design-keys.js` asserts the printed counts, not just the exit
 * code, for the same reason.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SK = path.join(__dirname, '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const ASSETS = path.resolve(arg('assets', path.join(SK, 'assets')));
const DOC = path.resolve(arg('doc', path.join(SK, 'references/design-quality.md')));

const KEY_RE = /\b(?:design|DESIGN)\.([A-Za-z][A-Za-z0-9]*)/g;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ---- what the engine reads ------------------------------------------- */
function scanEngine() {
  const raw = new Map();          // key -> Set of files
  const code = new Set();
  const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
    for (const m of src.matchAll(KEY_RE)) {
      if (!raw.has(m[1])) raw.set(m[1], new Set());
      raw.get(m[1]).add(f);
    }
    for (const m of stripComments(src).matchAll(KEY_RE)) code.add(m[1]);
  }
  return { raw, code, files: files.length };
}

/* ---- what the register documents ------------------------------------- */
function scanRegister() {
  const lines = fs.readFileSync(DOC, 'utf8').split(/\r?\n/);
  const rows = new Map();         // key -> 1-based line number
  let inTable = false;
  let sawHeading = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      inTable = /^##\s+`design`\s*$/.test(lines[i]);
      if (inTable) sawHeading = true;
    }
    if (!inTable) continue;
    const m = lines[i].match(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/);
    if (m) rows.set(m[1], i + 1);
  }
  return { rows, sawHeading };
}

/* ---- run -------------------------------------------------------------- */
const eng = scanEngine();
const reg = scanRegister();
const rel = (p) => {
  const r = path.relative(SK, p).split(path.sep).join('/');
  return (r && !r.startsWith('..')) ? r : p;   // a fixture outside the skill keeps its own path
};
const fail = [];

// Guard the checker before its verdict: a uniform result usually means the
// scan missed its target, not that everything is wrong at once.
if (eng.raw.size === 0) fail.push(`the engine scan found no design.* reads at all in ${rel(ASSETS)} (${eng.files} .js files) — check the checker, not the engine`);
if (!reg.sawHeading) fail.push(`no "## \`design\`" heading in ${rel(DOC)} — the register moved or was renamed; every key would read as undocumented`);
if (reg.sawHeading && reg.rows.size === 0) fail.push(`the "## \`design\`" heading in ${rel(DOC)} is followed by no table rows — check the checker`);

if (!fail.length) {
  const undocumented = [...eng.raw.keys()].filter((k) => !reg.rows.has(k)).sort();
  const phantom = [...reg.rows.keys()].filter((k) => !eng.raw.has(k)).sort();

  for (const k of undocumented) fail.push(`design.${k} is read by the engine (${[...eng.raw.get(k)].sort().join(', ')}) and has no row in the register`);
  for (const k of phantom) fail.push(`design.${k} has a register row (${rel(DOC)}:${reg.rows.get(k)}) and is read nowhere in ${rel(ASSETS)} — retired from the engine, or a typo`);
}

const commentOnly = [...eng.raw.keys()].filter((k) => !eng.code.has(k)).sort();
if (commentOnly.length) console.log(`NOTE — named only in comments, not in code: ${commentOnly.map((k) => 'design.' + k).join(', ')}. Not a failure; documented keys are expected to survive a strip.`);

if (fail.length) {
  for (const f of fail) console.error(`  ${f}`);
  console.error(`\n${fail.length} problem${fail.length > 1 ? 's' : ''} — ${eng.raw.size} design.* key${eng.raw.size === 1 ? '' : 's'} read across ${eng.files} engine files, ${reg.rows.size} row${reg.rows.size === 1 ? '' : 's'} in the register.`);
  process.exit(1);
}

console.log(`${eng.raw.size} design.* keys read across ${eng.files} engine files, ${reg.rows.size} rows in the register — every key documented, every row live.`);
