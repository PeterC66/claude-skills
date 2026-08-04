#!/usr/bin/env node
/*
 * status.js — reports whether every built town/place/portal-fixture still
 * matches what the CURRENT engine template would draw, and how stale each
 * town's independent (S6) verification is.
 *
 * This replaces the hand-maintained gate table and §4 vendoring table in
 * references/changing-the-engine.md with something that reads the filesystem
 * instead of asserting a date. Run it whenever you open that doc, and always
 * after an engine change, per its own advice.
 *
 * Usage:
 *   node status.js [--buses "<Buses dir>"] [--portal "<portal repo dir>"] [--md] [--json]
 *
 * Defaults (Peter's machine): --buses "C:\u3a St Ives\Using AI\Buses"
 *                              --portal "C:\Claude\community-bus-maps"
 *
 * Zero dependencies (Node core only).
 */
const fs = require('fs');
const path = require('path');
const { SK, gate, sameIgnoringLineEndings, findTowns, findPlaces, readJson, latestRunDir, detectExternalStyle } = require('./gate_lib');

const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) f[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');
const PORTAL = path.resolve(args.portal || 'C:/Claude/community-bus-maps');
const AS_MD = !!args.md;
const AS_JSON = !!args.json;

function exists(p) { return fs.existsSync(p); }

function daysSince(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

// ---- gate a single town -----------------------------------------------------
function gateTown(t) {
  const m = readJson(path.join(t.dir, 'manifest.json'));
  const s4 = latestRunDir(m, t.dir, 'S4');
  const row = { name: t.name, version: s4 ? s4.rec.version : null };
  if (!s4) { row.internal = 'NO-BUILD'; row.external = '-'; return row; }

  row.internal = gate(path.join(SK, 'gen_internal.js'), s4.dir, 'internal.svg', path.join(s4.dir, 'internal.svg')).status;

  const style = detectExternalStyle(s4.dir);
  row.externalStyle = style;
  row.external = gate(path.join(SK, `gen_external_${style}.js`), s4.dir, 'external.svg', path.join(s4.dir, 'external.svg')).status;

  // Optional pre-stage outputs, only gated if routes.json opted in.
  let routesJson = {};
  try { routesJson = readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  if (routesJson.internalSchematic && exists(path.join(s4.dir, 'internal-schematic.svg'))) {
    row.schematic = gate(path.join(SK, 'schematize_internal.js'), s4.dir, 'internal-schematic.svg', path.join(s4.dir, 'internal-schematic.svg')).status;
  } else row.schematic = '-';
  if (routesJson.internalDiagram && exists(path.join(s4.dir, 'internal-diagram.svg'))) {
    row.diagram = gate(path.join(SK, 'diagram_internal.js'), s4.dir, 'internal-diagram.svg', path.join(s4.dir, 'internal-diagram.svg')).status;
  } else row.diagram = '-';

  // S6 staleness: flag if S1/S2/S3 has moved on since the latest S6 run.
  const s6 = latestRunDir(m, t.dir, 'S6');
  const latestData = ['S1', 'S2', 'S3'].map(k => m.stages[k] && m.stages[k].runs.find(r => r.id === m.stages[k].latest)).filter(Boolean);
  const newestDataAt = latestData.reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);
  if (!s6) { row.s6 = 'NEVER'; row.s6Age = null; }
  else {
    row.s6 = s6.rec.id;
    row.s6Age = daysSince(s6.rec.at);
    row.s6Stale = newestDataAt && s6.rec.at < newestDataAt;
  }
  return row;
}

// ---- gate a single place ----------------------------------------------------
const PLACE_IGNORE = /y="16"|y="208"/; // title + "· Map v…" stamp, post-edited by build_internal_place.js
function gatePlace(p) {
  const m = readJson(path.join(p.dir, 'manifest.json'));
  const s4 = latestRunDir(m, p.dir, 'S4');
  const row = { name: p.name, town: p.town, version: s4 ? s4.rec.version : null };
  if (!s4) { row.internal = 'NO-BUILD'; row.external = '-'; return row; }
  row.internal = gate(path.join(SK, 'gen_internal.js'), s4.dir, 'internal.svg', path.join(s4.dir, 'internal.svg'), { ignoreLineRe: PLACE_IGNORE }).status;
  const genExt = path.join(PSK, 'gen_external_places.js');
  row.external = exists(genExt)
    ? gate(genExt, s4.dir, 'external.svg', path.join(s4.dir, 'external.svg')).status
    : 'no-gen';
  return row;
}

// ---- portal fixture reproduction (uses the PORTAL's own vendored engine) --
function gatePortalFixture() {
  const fixDir = path.join(BUSES, 'Places', '_portal-fixture');
  if (!exists(fixDir) || !exists(PORTAL)) return [];
  const out = [];
  for (const name of fs.readdirSync(fixDir)) {
    const dataDir = path.join(fixDir, name);
    if (!fs.statSync(dataDir).isDirectory()) continue;
    const genInt = path.join(PORTAL, 'engine', 'place', 'gen_internal.js');
    const genExt = path.join(PORTAL, 'engine', 'place', 'gen_external_places.js');
    const row = { name };
    // The portal's flat fixture dirs carry customer edits as base-overrides.json,
    // not the staged skill's overrides.json — pass it through explicitly so the
    // gate reproduces what the portal actually renders, not the un-overridden base.
    const baseOverrides = path.join(dataDir, 'base-overrides.json');
    const extraEnv = exists(baseOverrides) ? { OVERRIDES_FILE: baseOverrides } : {};
    row.internal = exists(genInt)
      ? gate(genInt, dataDir, 'internal.svg', path.join(dataDir, 'internal.svg'), { ignoreLineRe: PLACE_IGNORE, extraEnv }).status
      : 'no-gen';
    row.external = exists(genExt)
      ? gate(genExt, dataDir, 'external.svg', path.join(dataDir, 'external.svg'), { extraEnv }).status
      : 'no-gen';
    out.push(row);
  }
  return out;
}

// ---- portal vendoring drift (§4 table in changing-the-engine.md) -----------
function portalDrift() {
  if (!exists(PORTAL)) return [];
  const rows = [
    [path.join(SK, 'icons.js'), path.join(PORTAL, 'engine', 'icons.js')],
    [path.join(SK, 'render.js'), path.join(PORTAL, 'engine', 'render.js')],
    [path.join(SK, 'gen_internal.js'), path.join(PORTAL, 'engine', 'place', 'gen_internal.js')],
    [path.join(PSK, 'gen_external_places.js'), path.join(PORTAL, 'engine', 'place', 'gen_external_places.js')],
    [path.join(SK, 'schematize_internal.js'), path.join(PORTAL, 'engine', 'expert', 'schematize_internal.js')],
    [path.join(SK, 'diagram_internal.js'), path.join(PORTAL, 'engine', 'expert', 'diagram_internal.js')],
  ];
  return rows.map(([skillFile, portalFile]) => ({
    file: path.basename(skillFile) + ' -> ' + path.relative(PORTAL, portalFile),
    same: sameIgnoringLineEndings(skillFile, portalFile),
  }));
}

// ---- run ---------------------------------------------------------------
const towns = findTowns(BUSES);
const places = findPlaces(towns);
const townRows = towns.map(gateTown);
const placeRows = places.map(gatePlace);
const portalFixtureRows = gatePortalFixture();
const driftRows = portalDrift();

if (AS_JSON) {
  console.log(JSON.stringify({ towns: townRows, places: placeRows, portalFixtures: portalFixtureRows, portalDrift: driftRows }, null, 2));
  process.exit(0);
}

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function line(cells, widths) { return cells.map((c, i) => pad(c, widths[i])).join(AS_MD ? ' | ' : '  '); }

console.log('=== Towns (' + towns.length + ') ===');
if (AS_MD) console.log('| Town | Ver | Internal | External | Schematic | Diagram | S6 | S6 age |\n|---|---|---|---|---|---|---|---|');
const tw = [16, 6, 9, 16, 10, 8, 20, 8];
if (!AS_MD) console.log(line(['Town', 'Ver', 'Internal', 'External', 'Schematic', 'Diagram', 'S6 latest', 'S6 age'], tw));
for (const r of townRows) {
  const ext = r.external + (r.externalStyle ? ` (${r.externalStyle})` : '');
  const s6age = r.s6Age == null ? '' : `${r.s6Age}d${r.s6Stale ? ' STALE' : ''}`;
  const cells = [r.name, r.version || '-', r.internal, ext, r.schematic, r.diagram, r.s6, s6age];
  console.log(line(cells, tw));
}

console.log('\n=== Places (' + places.length + ') ===');
const pw = [24, 18, 6, 9, 9];
if (!AS_MD) console.log(line(['Place', 'Town', 'Ver', 'Internal', 'External'], pw));
for (const r of placeRows) console.log(line([r.name, r.town, r.version || '-', r.internal, r.external], pw));

if (portalFixtureRows.length) {
  console.log('\n=== Portal fixtures (vendored engine, ' + PORTAL + ') ===');
  const fw = [24, 9, 9];
  console.log(line(['Fixture', 'Internal', 'External'], fw));
  for (const r of portalFixtureRows) console.log(line([r.name, r.internal, r.external], fw));
}

if (driftRows.length) {
  console.log('\n=== Portal vendoring drift (skill -> portal, CRLF-safe) ===');
  for (const r of driftRows) console.log('  ' + (r.same === null ? 'MISSING  ' : r.same ? 'in sync  ' : 'DRIFTED  ') + r.file);
}

// Exit non-zero if anything needs attention, so this can gate CI.
const bad = townRows.some(r => ['DIFF', 'FAIL', 'NO-BUILD'].includes(r.internal) || String(r.external).startsWith('DIFF') || String(r.external).startsWith('FAIL'))
  || placeRows.some(r => ['DIFF', 'FAIL', 'NO-BUILD'].includes(r.internal) || ['DIFF', 'FAIL'].includes(r.external))
  || driftRows.some(r => r.same === false);
process.exit(bad ? 1 : 0);
