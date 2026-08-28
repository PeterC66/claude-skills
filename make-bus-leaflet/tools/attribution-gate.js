#!/usr/bin/env node
/*
 * attribution-gate.js — a sheet must CREDIT every source it DRAWS (OA-068).
 *
 * WHY THIS EXISTS. Attribution is per-caller in this engine and always has been:
 * each generator hardcodes its own `notes` array and `footer.js` prints whatever
 * it is handed. A shared footer component is not a shared attribution, and on
 * 2026-08-25 that gap shipped — the boarding sheet drew several hundred OSM
 * building footprints and printed OSM-only landmark names (Coral, Ivo Lounge,
 * The Octagon) while crediting OpenStreetMap nowhere, because only
 * gen_internal.js's notes array named it. Attribution is owed under ODbL 4.3.
 * Nothing was red, because nothing was looking.
 *
 * WHAT IT CHECKS, and why it is two questions rather than one.
 *
 *   1. SOURCE. For each of the five generators that draw a footer band: which
 *      attribution-bearing input files does it read, and does the notes array it
 *      hands to footer.js carry the matching credit? This catches a SIXTH
 *      generator, or a new input, before any sheet is built — the cheap half.
 *
 *   2. ARTEFACT. For every sheet committed under `ci-reference/`: does the SVG
 *      that actually shipped contain the credit its generator owes? This is the
 *      half that would have caught 2026-08-25, because that fault was not a
 *      missing check on new code — the sheets were built, rendered, verified and
 *      published without it.
 *
 * They can disagree, and the disagreement is the interesting case. A generator
 * whose source is correct but whose SHIPPED sheet lacks the credit is a sheet
 * built by an older engine and never re-rolled; a sheet that is correct while the
 * source is not is a regression that has not reached the artwork yet. Reporting
 * one number for both would hide exactly the distinction worth having.
 *
 *   3. COVERAGE, asserted rather than assumed. Every distinct sheet basename
 *      found under ci-reference must appear in the table below. Coverage is the
 *      failure this project keeps paying for — `check-tables.mjs` was checking 78
 *      fewer rows than it claimed, `quality_metrics.js` walked a population three
 *      maps short — and a verdict alone cannot express it. A sheet kind nobody
 *      listed is not a pass; it is a question nobody asked.
 *
 * WHY IT IS A TOOL AND NOT A test/ FILE, which is where OA-068 said to put it.
 * The artefact half has to find the Buses repo, and the one existing test that
 * does (`sheet_registry.test.js`) has to SKIP when it cannot — reasonably, since
 * the relative path differs between the laptop and CI. A gate that can skip
 * itself is the precise failure this row is about, so the path is passed in
 * explicitly here, exactly as `prove-red-gates.js` and `check-design-keys.js` do,
 * and CI names it. The source half needs no repo and runs either way.
 *
 * Run it from make-bus-leaflet (no placeholders beyond the repo path):
 *     npm run gate:attribution
 *     node tools/attribution-gate.js --buses "<path to the Buses repo>"
 *     node tools/attribution-gate.js --source-only     skip the artefact half
 *     node tools/attribution-gate.js --assets <dir> --place-assets <dir>
 *                                                      read the generators from
 *                                                      elsewhere (the falsifier)
 * `--buses` defaults to the Buses repo on Peter's laptop; it is only needed if
 * that repo is checked out somewhere else, which in CI it is.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SK = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const SOURCE_ONLY = argv.includes('--source-only');
const flag = (name, dflt) => { const i = argv.indexOf('--' + name); return (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[i + 1] : dflt; };
const BUSES = flag('buses', 'C:/u3a St Ives/Using AI/Buses');
/* --assets / --place-assets exist so prove-red-attribution.js can point this at
 * MUTATED COPIES of the five generators without touching assets/. Every file
 * under assets/ is vendored into the portal and hashed by status.js, so a
 * harness that edited one in place would surface as vendoring drift — and a
 * falsification that has to damage the real engine to run is one nobody runs. */
const ASSETS = flag('assets', path.join(SK, 'assets'));
const PLACE_ASSETS = flag('place-assets', path.join(SK, '..', 'make-place-bus-leaflet', 'assets'));

/* ---- the sources that carry an obligation --------------------------------
 *
 * `inputs` is the list of FILENAMES whose contents come from that source. It is
 * the discriminator the whole gate rests on, so it is filenames rather than
 * concepts: a generator naming `roads_geo.json` is drawing OSM ways, and that is
 * checkable without anybody having to have understood the pipeline.
 *
 * BODS is deliberately absent. Every sheet draws service data and every notes
 * array already names it, so a check on it can never be anything but green — and
 * a check that cannot fail is the thing this file exists to stop shipping. */
const SOURCES = [
  {
    id: 'OSM',
    why: 'ODbL 4.3 — geometry, buildings, landmark names and river/road ways pulled from OpenStreetMap',
    inputs: ['locator_geo.json', 'roads_geo.json', 'river_geo.json', 'features_geo.json', 'osm.json', 'osm2.json', 'routes_paths.json', 'pois.json'],
    credit: /OpenStreetMap/,
    creditText: '© OpenStreetMap contributors (ODbL)',
  },
  {
    id: 'NaPTAN',
    why: 'OGL v3.0 — stop names, bay numbers and bearings from the national stop register',
    inputs: ['stands.json'],
    credit: /NaPTAN/,
    creditText: 'NaPTAN (Open Government Licence v3.0)',
  },
];

/* ---- the five generators that draw a footer band --------------------------
 *
 * `notesAnchor` must appear EXACTLY ONCE in the file. An anchor matching twice,
 * or not at all, is an extraction that did not do what it says and would report
 * a false green as loudly as the fault it hunts — the same rule prove-red-gates.js
 * applies to its mutation anchors, and for the same reason.
 *
 * `sheets` is what each generator's output is committed as. gen_internal.js owns
 * THREE basenames, not one: schematize_internal.js and diagram_internal.js do not
 * draw a footer of their own — they build a workspace and then RUN gen_internal.js
 * over it — so the schematic and the diagram inherit its notes array exactly. */
const GENERATORS = [
  { file: path.join(ASSETS, 'gen_internal.js'), notesAnchor: 'const INTERNAL_FOOTER_NOTES = [', open: '[',
    sheets: ['internal.svg', 'internal-schematic.svg', 'internal-diagram.svg'] },
  { file: path.join(ASSETS, 'gen_external_radial.js'), notesAnchor: 'const EXTERNAL_FOOTER_NOTES = [', open: '[',
    sheets: ['external.svg'] },
  { file: path.join(ASSETS, 'gen_external_busway.js'), notesAnchor: 'out(footerBand({', open: '{',
    sheets: ['external.svg'] },
  { file: path.join(ASSETS, 'gen_boarding.js'), notesAnchor: 'const FOOTER_OPTS = {', open: '{',
    sheets: ['boarding.svg'] },
  { file: path.join(PLACE_ASSETS, 'gen_external_places.js'), notesAnchor: 'const FOOTER_NOTES = ', open: 'line',
    sheets: ['external.svg'] },
];

/* Take the text from the anchor to the close of the bracket it opens, so the
 * credit is read out of the value that reaches footer.js rather than out of the
 * file at large. That distinction is not pedantry: gen_boarding.js names
 * OpenStreetMap five times in the COMMENT explaining why the credit is there, so
 * a whole-file grep would have passed on the very sheet that shipped uncredited. */
function notesText(g) {
  const src = fs.readFileSync(g.file, 'utf8');
  const hits = src.split(g.notesAnchor).length - 1;
  if (hits !== 1) throw new Error(`${path.basename(g.file)}: notes anchor "${g.notesAnchor}" matched ${hits} times, wanted exactly 1 — the extraction is not reading what it claims to`);
  const from = src.indexOf(g.notesAnchor) + g.notesAnchor.length - (g.open === 'line' ? 0 : 1);
  if (g.open === 'line') {
    const end = src.indexOf('\n', from);
    return src.slice(from, end < 0 ? src.length : end);
  }
  const close = g.open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === g.open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return src.slice(from, i + 1); }
  }
  throw new Error(`${path.basename(g.file)}: notes block opened at "${g.notesAnchor}" never closes`);
}

/* Which SOURCES does this generator read? Filename literals, found anywhere in
 * the file. Deliberately generous: a filename mentioned only in a comment still
 * counts, because the cost of a spurious credit is a line of small print and the
 * cost of a missing one is a licence breach. */
function sourcesRead(g) {
  const src = fs.readFileSync(g.file, 'utf8');
  return SOURCES.filter(s => s.inputs.some(f => src.includes(f)));
}

function findSheets(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const d = path.join(dir, e.name);
      if (e.name === 'ci-reference') {
        for (const f of fs.readdirSync(d)) if (f.endsWith('.svg')) out.push({ map: path.relative(root, dir), sheet: f, path: path.join(d, f) });
      } else if (!e.name.startsWith('.') && !e.name.startsWith('S4-') && !e.name.startsWith('S5-') && !e.name.startsWith('S6-')) {
        walk(d, depth + 1);
      }
    }
  };
  for (const top of ['Areas', 'Places']) walk(path.join(root, top), 0);
  return out;
}

const failures = [];
const notes = [];

// ---- 1. SOURCE ------------------------------------------------------------
const owed = new Map();   // sheet basename -> Set of source ids owed by any generator drawing it
console.log('=== Source: does each generator credit what it reads? ===');
for (const g of GENERATORS) {
  const name = path.basename(g.file);
  let text;
  try { text = notesText(g); } catch (e) { failures.push(e.message); console.log('  ERROR     ' + name + ' — ' + e.message); continue; }
  const read = sourcesRead(g);
  for (const sh of g.sheets) {
    if (!owed.has(sh)) owed.set(sh, new Set());
    for (const s of read) owed.get(sh).add(s.id);
  }
  const missing = read.filter(s => !s.credit.test(text));
  if (missing.length) {
    for (const s of missing) failures.push(`${name} reads ${s.inputs.filter(f => fs.readFileSync(g.file, 'utf8').includes(f)).join(', ')} but its footer notes never say "${s.id}" — owed: ${s.creditText} (${s.why})`);
    console.log('  MISSING   ' + name.padEnd(24) + 'reads ' + read.map(s => s.id).join('+') + ', credits ' + (read.filter(s => s.credit.test(text)).map(s => s.id).join('+') || 'neither'));
  } else {
    console.log('  ok        ' + name.padEnd(24) + (read.length ? 'reads and credits ' + read.map(s => s.id).join('+') : 'reads no attribution-bearing input'));
  }
}

// ---- 2. ARTEFACT + 3. COVERAGE -------------------------------------------
if (!SOURCE_ONLY) {
  const sheets = findSheets(BUSES);
  if (!sheets.length) {
    failures.push(`no ci-reference sheets found under ${BUSES} — the artefact half checked nothing, which is not a pass`);
  } else {
    console.log(`\n=== Artefact: does each SHIPPED sheet carry the credit? (${sheets.length} sheets under ${BUSES}) ===`);
    const kinds = new Map();
    let clean = 0;
    for (const s of sheets) {
      const need = owed.get(s.sheet);
      if (!need) {
        // COVERAGE. A sheet kind no generator in the table claims to draw.
        kinds.set(s.sheet, (kinds.get(s.sheet) || 0) + 1);
        continue;
      }
      const svg = fs.readFileSync(s.path, 'utf8');
      const short = [...need].filter(id => !SOURCES.find(x => x.id === id).credit.test(svg));
      if (short.length) failures.push(`${s.map} / ${s.sheet} draws ${[...need].join('+')} data and the shipped sheet credits ${short.map(x => 'no ' + x).join(' and ')}`);
      else clean++;
    }
    console.log(`  ${clean} of ${sheets.length} shipped sheets carry every credit their generator owes`);
    for (const [kind, n] of kinds) {
      failures.push(`${n} committed sheet(s) named "${kind}" are drawn by no generator in this file's table — add it, or this gate is silently smaller than the estate`);
    }
  }
}

console.log('');
if (failures.length) {
  for (const f of failures) console.error('  FAIL  ' + f);
  console.error(`\n${failures.length} attribution problem(s). A sheet that draws a source and does not name it is a licence breach, not a cosmetic gap.`);
  process.exitCode = 1;
} else {
  console.log('Every generator credits what it reads, and every shipped sheet carries it.');
}
