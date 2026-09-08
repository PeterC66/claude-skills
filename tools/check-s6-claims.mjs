#!/usr/bin/env node
/*
 * check-s6-claims.mjs — every S6 claim has a home, and the register contradicts no town.
 *
 * Run it from the ROOT OF THE REPOSITORY YOU WANT CHECKED (buses-data), with no
 * placeholders — it reads the repository it is run FROM, never the one it lives in:
 *
 *     node "C:/u3a St Ives/.claude/skills/tools/check-s6-claims.mjs"
 *
 * Flags: --root <dir>         check that repository instead of the cwd
 *        --json               print the verdict as one JSON object instead of prose
 *        --require-reports    a run that finds NO S6 report on disk is red, not quiet
 *        --register-only      skip the coverage half (what CI runs — see below)
 *
 * WHAT A CLAIM IS. An S6 run raises two kinds of finding. One kind is about the
 * ARTWORK — a terminus name, a direction, a colour clash — and the runbook handles
 * it. The other is about a SERVICE: the blind red team says a bus serves the town
 * and our verified set does not carry it (`missing-service`), or it says a bus we
 * carry does not serve (`serves-town`), or our own file says a route does not serve
 * and the red team says it does (`serves-town-conflict`). Those are claims. Each one
 * cost part of an 89k–137k-token answer, and until 2026-09-08 (buses-data OA-273)
 * nothing said where its outcome had to be written, so it was written in the prose
 * of an open action and nothing counted the ones nobody had looked at. Measured that
 * day: 100 claims on the latest S6 of 20 maps, 72 of them one fact repeated on a
 * place after the parent town had already decided it.
 *
 * THE COVERAGE HALF asks, of every claim on every map's LATEST S6 report: does it
 * have a home? In this order, a claim is covered by
 *   1. the map's own `notOnLeaflet[]` (a town's in its latest S1, a place's in its
 *      latest S3) — including the deprecated spellings `known_off.js` still reads,
 *      and including a `servesTown:false` entry, which that reader deliberately
 *      leaves out because S6 has a louder arm for it;
 *   2. the map's own `redteamRejected[]` in its latest S3;
 *   3. the PARENT TOWN's file — a route the town carries in `services[]` or has
 *      declared off. This is OA-004 decision 4, "the FACT is central, the DRAWING
 *      is local", as a mechanism: a place asking about route 604 after High Wycombe
 *      has declared it a closed-door school service is not a new question;
 *   4. an entry in `service-facts.json` whose scope names the map, its parent town,
 *      or `*` — QUEUED or decided. A claim has a home the moment it is written there;
 *      the queue IS the entries with no decision.
 * Anything else is UNCOVERED, and that is red.
 *
 * WHY THIS HALF CANNOT RUN IN CI. It reads `verification.json`, which is gitignored
 * because our own code rebuilds it for free. `actions/checkout` therefore produces a
 * tree in which no map has an S6 report, and a check over zero reports is green for
 * ever — the shape buses-data's CLAUDE.md names as "the subject that does not
 * survive actions/checkout". So this half runs on the laptop, from `status.js` and
 * the `bus-work` worklist; `--require-reports` is how the worklist makes "we found
 * nothing to check" red rather than quiet, and the board deliberately omits it (see
 * make-bus-leaflet/assets/s6_claims.js — it also runs over harness fixtures). CI passes `--register-only` and its
 * step name says so.
 *
 * THE REGISTER HALF runs everywhere. `service-facts.json` parses; every entry
 * carries what its status requires (a queued claim has a question, a decided one
 * has a date, a decider, an outcome, a reason and a re-check date); no two decided
 * entries assert opposite facts about one (route, operator); and — the VL14 shape —
 * no town in a decided entry's scope is SILENT about it, carrying the route neither
 * in `services[]` nor in `notOnLeaflet[]`. On 6 September 2026 one reader could hold
 * a St Ives sheet and a Huntingdon sheet that disagreed about whether VL14 was a
 * bus, and it was not two decisions: it was one decision and one silence.
 *
 * FROM `git ls-files` FOR THE TRACKED INPUTS, from the disk for the reports. The
 * manifests, S1 files and S3 files are what the repository carries; the reports are
 * a property of this working tree, which is the whole point of the split above.
 *
 * Exit 0 clean, 1 with findings, 2 on a usage error. Findings go to stdout; the
 * summary lines always print, so "nothing found" can never read as "all clean".
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enclosingRepoRoot } from './lib/repo-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const KNOWN = ['--root', '--json', '--require-reports', '--register-only'];
for (const a of argv) {
  if (a.startsWith('--') && !KNOWN.includes(a)) {
    console.error(`check-s6-claims: unknown flag ${a} (known: ${KNOWN.join(', ')})`);
    process.exit(2);
  }
}
const rootIdx = argv.indexOf('--root');
/* WITH NO `--root`, THE SUBJECT IS THE ENCLOSING REPOSITORY (buses-data OA-275
 * step 2). This checker is the one that proved the point: run from
 * `Areas/Beaconsfield` — where every stage-engine call leaves the shell — it
 * reported `2 map(s) tracked; 11 claim(s) — UNCOVERED 11`, and from the
 * repository root, same commit, `20 map(s) tracked … every claim has a home`.
 * Both name a real directory and count real maps. See lib/repo-root.mjs. */
const ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : enclosingRepoRoot();
if (rootIdx >= 0 && (!ROOT || ROOT.startsWith('--'))) { console.error('check-s6-claims: --root needs a directory'); process.exit(2); }
const AS_JSON = argv.includes('--json');
const REQUIRE_REPORTS = argv.includes('--require-reports');
const REGISTER_ONLY = argv.includes('--register-only');

const REGISTER_NAME = 'service-facts.json';
const CLAIM_CATEGORIES = new Set(['missing-service', 'serves-town', 'serves-town-conflict']);
const OUTCOMES = new Set(['include', 'off', 'nothing']);

/*
 * The same normalisation `verify_report.js` keys its findings on, copied rather than
 * imported because that file draws no map but does read its cwd at load. A claim's
 * `route` is already normalised by the time it is in a report; what has to agree is
 * how a town file's spelling is folded to meet it.
 */
const norm = (r) => String(r == null ? '' : r).toUpperCase().replace(/\s+/g, '');
const base = (r) => { const n = norm(r); return n.replace(/\(.*\)$/, '') || n; };
/** Every key a route spelling can be met under: itself, its bracket-stripped base, and either side of a slash. */
function keysOf(r) {
  const n = norm(r); if (!n) return [];
  const out = new Set([n, base(n)]);
  for (const half of base(n).split('/')) if (half) out.add(half);
  return [...out];
}

// known_off.js is the estate's one reader of the four exclusion spellings. Reached
// relative to this file, because the tools folder and the engine are one repository.
let knownOff = null;
try { ({ knownOff } = require(path.join(HERE, '..', 'make-bus-leaflet', 'assets', 'known_off.js'))); }
catch (e) { console.error(`check-s6-claims: cannot load make-bus-leaflet/assets/known_off.js beside this tool — ${e.message}`); process.exit(2); }

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function tryJson(p) { try { return existsSync(p) ? readJson(p) : null; } catch { return { __unreadable: true }; } }

// ---- the maps the repository carries ---------------------------------------
let tracked;
try {
  tracked = execFileSync('git', ['ls-files', '-z', '*manifest.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
} catch (e) {
  // A usage error, exit 2 — but under --json it is also an ANSWER the board can read:
  // status.js runs over harness fixtures and scratch trees that are not repositories,
  // and "this is not a repository" must be distinguishable from "the checker crashed".
  if (AS_JSON) console.log(JSON.stringify({ root: path.resolve(ROOT), notARepository: true, maps: 0, reports: 0, claims: 0, uncovered: [], queued: [], coveredBy: {}, register: { present: false, facts: 0, queued: 0, decided: 0, findings: [], silences: [] }, red: false, why: `could not list tracked files in ${ROOT} — ${e.message.split('\n')[0]}` }, null, 2));
  console.error(`check-s6-claims: could not list tracked files in ${ROOT} — ${e.message}`);
  console.error('  Run it from the root of a git repository, or pass --root <dir>.');
  process.exit(2);
}
/** {name, kind: town|place, parent, dir(rel)} for every tracked manifest in the estate's layout. */
const maps = [];
for (const rel of tracked) {
  const parts = rel.split('/');
  if (parts[parts.length - 1] !== 'manifest.json') continue;
  const dir = parts.slice(0, -1).join('/');
  if (parts[0] === 'Areas' && parts.length === 3) maps.push({ name: parts[1], kind: 'town', parent: null, dir });
  else if (parts[0] === 'Areas' && parts.length === 5 && parts[2] === 'Places') maps.push({ name: parts[3], kind: 'place', parent: parts[1], dir });
  else if (parts[0] === 'Places' && parts.length === 4 && parts[1] === '_standalone') maps.push({ name: parts[2], kind: 'place', parent: null, dir });
  else if (parts[0] === 'Places' && parts.length === 3 && !parts[1].startsWith('_')) maps.push({ name: parts[1], kind: 'place', parent: null, dir });
}
maps.sort((a, b) => a.dir.localeCompare(b.dir));
const townByName = new Map(maps.filter(m => m.kind === 'town').map(m => [m.name, m]));
const mapByName = new Map(maps.map(m => [m.name, m]));

function latest(manifest, stage) {
  const s = manifest && manifest.stages && manifest.stages[stage];
  if (!s || !s.latest || !Array.isArray(s.runs)) return null;
  return s.runs.find(r => r.id === s.latest) || null;
}

/** What a map has WRITTEN about its services: its verified set, its exclusions, its rejections. Tracked files only. */
function loadDeclarations(m) {
  const d = { services: new Set(), off: new Map(), rejected: new Map(), routeOrder: new Set(), unreadable: [] };
  const manifest = tryJson(path.join(ROOT, m.dir, 'manifest.json'));
  if (!manifest || manifest.__unreadable) { d.unreadable.push(`${m.dir}/manifest.json`); return d; }
  const s1 = latest(manifest, 'S1'), s3 = latest(manifest, 'S3');
  const takeOff = (obj, where) => {
    if (!obj) return;
    const k = knownOff(obj);
    for (const [route, rec] of k.found) for (const key of keysOf(route)) if (!d.off.has(key)) d.off.set(key, { where, field: rec.field, entry: rec.entry });
    // known_off.js leaves a servesTown:false entry out on purpose (S6 has a louder arm
    // for it). For "does this claim have a home" it is the strongest home there is.
    for (const e of (Array.isArray(obj.notOnLeaflet) ? obj.notOnLeaflet : [])) {
      if (e && typeof e === 'object' && e.servesTown === false && e.route != null)
        for (const key of keysOf(e.route)) if (!d.off.has(key)) d.off.set(key, { where, field: 'notOnLeaflet', entry: e });
    }
  };
  if (m.kind === 'town' && s1) {
    const p = path.join(m.dir, s1.dir || `S1-services/${s1.id}`, 'verified-services.json');
    const v = tryJson(path.join(ROOT, p));
    if (v && v.__unreadable) d.unreadable.push(p);
    else if (v) {
      for (const s of (v.services || [])) for (const key of keysOf(s.key || s.route)) d.services.add(key);
      takeOff(v, p);
    }
  }
  if (s3) {
    const p = path.join(m.dir, s3.dir || `S3-config/${s3.id}`, 'routes.json');
    const r = tryJson(path.join(ROOT, p));
    if (r && r.__unreadable) d.unreadable.push(p);
    else if (r) {
      for (const k of (r.routeOrder || [])) for (const key of keysOf(k)) d.routeOrder.add(key);
      for (const e of (Array.isArray(r.redteamRejected) ? r.redteamRejected : [])) if (e && e.route != null) for (const key of keysOf(e.route)) if (!d.rejected.has(key)) d.rejected.set(key, { where: p, entry: e });
      // A PLACE declares its exclusions in S3 (its S1 is regenerated from BODS on every
      // pull and would overwrite them) — buses-data OA-262 item 3.
      if (m.kind === 'place') takeOff(r, p);
    }
  }
  return d;
}
const decl = new Map(maps.map(m => [m.name, loadDeclarations(m)]));

// ---- the register -------------------------------------------------------------
const registerFindings = [];
let register = null;
{
  const p = path.join(ROOT, REGISTER_NAME);
  if (!existsSync(p)) registerFindings.push({ kind: 'missing', text: `${REGISTER_NAME} is not at the repository root — nothing can have a home in a register that does not exist.` });
  else {
    try { register = readJson(p); } catch (e) { registerFindings.push({ kind: 'unreadable', text: `${REGISTER_NAME} could not be parsed as JSON — ${e.message}` }); }
  }
}
const facts = (register && Array.isArray(register.facts)) ? register.facts : [];
if (register && !Array.isArray(register.facts)) registerFindings.push({ kind: 'shape', text: `${REGISTER_NAME} has no \`facts\` array.` });

const ids = new Set();
for (const [i, f] of facts.entries()) {
  const at = `facts[${i}]${f && f.id ? ` ${f.id}` : ''}`;
  if (!f || typeof f !== 'object') { registerFindings.push({ kind: 'shape', text: `${at} is not an object.` }); continue; }
  const missing = [];
  for (const k of ['id', 'route', 'operator', 'scope', 'fact', 'status']) if (f[k] === undefined || f[k] === null || f[k] === '') missing.push(k);
  if (f.id) { if (ids.has(f.id)) registerFindings.push({ kind: 'shape', text: `${at}: id ${f.id} is used twice.` }); ids.add(f.id); }
  if (f.scope !== undefined && !Array.isArray(f.scope)) missing.push('scope (must be an array of map names, or ["*"])');
  if (f.status === 'queued') { if (!f.question) missing.push('question'); }
  else if (f.status === 'decided') {
    for (const k of ['decidedOn', 'decidedBy', 'outcome', 'reason', 'recheckBy']) if (!f[k]) missing.push(k);
    if (f.outcome && !OUTCOMES.has(f.outcome)) registerFindings.push({ kind: 'shape', text: `${at}: outcome "${f.outcome}" is not one of ${[...OUTCOMES].join(', ')}.` });
  } else if (f.status !== undefined) registerFindings.push({ kind: 'shape', text: `${at}: status "${f.status}" is not queued or decided.` });
  if (missing.length) registerFindings.push({ kind: 'shape', text: `${at} is missing ${missing.join(', ')}.` });
}

// Contradiction: two decided entries about one (route, operator) asserting opposite facts.
{
  const byKey = new Map();
  for (const f of facts) {
    if (!f || f.status !== 'decided' || !f.fact || typeof f.fact !== 'object') continue;
    const key = `${base(f.route)}|${norm(f.operator)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  for (const [key, list] of byKey) {
    for (const prop of ['runs', 'public']) {
      const vals = new Set(list.map(f => f.fact[prop]).filter(v => v === true || v === false));
      if (vals.size > 1) registerFindings.push({ kind: 'contradiction', text: `${list.map(f => f.id).join(' and ')} disagree about whether ${key.split('|')[0]} (${list[0].operator}) \`${prop}\` — a fact about a service has one answer estate-wide (OA-004 decision 4).` });
    }
  }
}

// Silence: a town in a decided entry's scope that neither carries the route nor declares it off.
const silences = [];
for (const f of facts) {
  if (!f || f.status !== 'decided' || !Array.isArray(f.scope)) continue;
  for (const name of f.scope) {
    if (name === '*') continue;
    const m = mapByName.get(name);
    if (!m) { registerFindings.push({ kind: 'scope', text: `${f.id}: scope names "${name}", which is no tracked map.` }); continue; }
    const d = decl.get(name);
    const keys = [...keysOf(f.route), ...(Array.isArray(f.aliases) ? f.aliases.flatMap(keysOf) : [])];
    const carried = keys.some(k => d.services.has(k) || d.off.has(k) || d.rejected.has(k) || d.routeOrder.has(k));
    if (!carried) silences.push({ id: f.id, map: name, route: f.route, text: `${f.id} decided "${f.outcome}" for ${f.route} (${f.operator}) and names ${name} in its scope, but ${name}'s own file is SILENT — the route is in neither its verified set, its routeOrder, its notOnLeaflet nor its redteamRejected. Write the map's own field; a decision only in the register is the VL14 shape.` });
  }
}

// ---- the coverage half ---------------------------------------------------------
const claims = [];          // every claim, with how it is covered or that it is not
let reports = 0, mapsWithoutReport = [], unreadableReports = [];
if (!REGISTER_ONLY) {
  for (const m of maps) {
    const manifest = tryJson(path.join(ROOT, m.dir, 'manifest.json'));
    const s6 = latest(manifest, 'S6');
    if (!s6) { mapsWithoutReport.push({ map: m.name, why: 'no S6 run' }); continue; }
    const p = path.join(ROOT, m.dir, s6.dir || `S6-verify/${s6.id}`, 'verification.json');
    const v = tryJson(p);
    if (!v) { mapsWithoutReport.push({ map: m.name, why: `S6 ${s6.id} has no verification.json on this disk` }); continue; }
    if (v.__unreadable) { unreadableReports.push(p); continue; }
    reports++;
    const own = decl.get(m.name);
    const parent = m.parent ? decl.get(m.parent) : null;
    for (const f of (v.findings || [])) {
      if (!CLAIM_CATEGORIES.has(f.category)) continue;
      const keys = keysOf(f.route);
      const claim = { map: m.name, kind: m.kind, parent: m.parent, run: s6.id, id: f.id, category: f.category, severity: f.severity, route: f.route,
        operator: (f.evidence && f.evidence.redteam && f.evidence.redteam.operator) || null,
        superset: !!(f.evidence && f.evidence.supersetArtefactPossible), covered: null };
      const hit = (map, k) => keys.find(x => map.has(x));
      let k;
      if ((k = hit(own.off, keys))) claim.covered = { by: 'own-exclusion', where: own.off.get(k).where, field: own.off.get(k).field };
      else if ((k = hit(own.rejected, keys))) claim.covered = { by: 'own-rejection', where: own.rejected.get(k).where };
      // A `missing-service` about a route this map's OWN verified set carries is a
      // pairing failure, not a claim — St Neots' `18/18A` on a run that predates the
      // slashed-key fix. The home is the town file itself; the remedy is the next S6.
      else if (f.category === 'missing-service' && ((k = hit(own.services, keys)) || (k = hit(own.routeOrder, keys)))) claim.covered = { by: 'own-carries' };
      else if (parent && (k = hit(parent.services, keys))) claim.covered = { by: 'parent-carries', town: m.parent };
      else if (parent && (k = hit(parent.off, keys))) claim.covered = { by: 'parent-exclusion', town: m.parent, where: parent.off.get(k).where };
      else if (parent && (k = hit(parent.rejected, keys))) claim.covered = { by: 'parent-rejection', town: m.parent };
      else {
        const inScope = (f2) => Array.isArray(f2.scope) && (f2.scope.includes('*') || f2.scope.includes(m.name) || (m.parent && f2.scope.includes(m.parent)));
        const fact = facts.find(f2 => f2 && inScope(f2) && [...keysOf(f2.route), ...(Array.isArray(f2.aliases) ? f2.aliases.flatMap(keysOf) : [])].some(x => keys.includes(x)));
        if (fact) claim.covered = { by: fact.status === 'decided' ? 'register-decided' : 'register-queued', id: fact.id, outcome: fact.outcome || null };
      }
      claims.push(claim);
    }
  }
}
const uncovered = claims.filter(l => !l.covered);
const queued = claims.filter(l => l.covered && l.covered.by === 'register-queued');
const unreadableDecls = maps.flatMap(m => decl.get(m.name).unreadable);

// ---- verdict ------------------------------------------------------------------
const red = uncovered.length > 0 || registerFindings.length > 0 || silences.length > 0 || unreadableReports.length > 0 || unreadableDecls.length > 0
  || (REQUIRE_REPORTS && reports === 0);

if (AS_JSON) {
  console.log(JSON.stringify({
    root: path.resolve(ROOT), maps: maps.length, reports, mapsWithoutReport, unreadableReports, unreadableDecls,
    claims: claims.length, uncovered, queued: queued.map(l => ({ map: l.map, route: l.route, id: l.covered.id })),
    coveredBy: claims.reduce((acc, l) => { const k = l.covered ? l.covered.by : 'UNCOVERED'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
    register: { present: !!register, facts: facts.length, queued: facts.filter(f => f && f.status === 'queued').length, decided: facts.filter(f => f && f.status === 'decided').length, findings: registerFindings, silences },
    registerOnly: REGISTER_ONLY, requireReports: REQUIRE_REPORTS, red,
  }, null, 2));
} else {
  for (const p of unreadableDecls) console.log(`  ${p}\n      could not be parsed as JSON — nothing in it could be read as a home for anything`);
  for (const p of unreadableReports) console.log(`  ${p}\n      could not be parsed as JSON — its claims could not be counted`);
  for (const f of registerFindings) console.log(`  ${REGISTER_NAME}: ${f.text}`);
  for (const s of silences) console.log(`  ${REGISTER_NAME}: ${s.text}`);
  for (const l of uncovered) {
    console.log(`  ${l.map}  S6 ${l.run} ${l.id}  ${l.category}  ${l.route}${l.operator ? ` (${l.operator})` : ''}${l.superset ? '  [borrowed answer — may be a superset artefact]' : ''}`);
    console.log(`      UNCOVERED — no notOnLeaflet, no redteamRejected, ${l.parent ? `nothing in ${l.parent}'s file, ` : ''}no ${REGISTER_NAME} entry in scope. Write the register entry (queued is enough to give it a home).`);
  }
  console.log(`\ncheck-s6-claims — ${path.resolve(ROOT)}`);
  console.log(`  ${maps.length} map(s) tracked; register: ${register ? `${facts.length} fact(s), ${facts.filter(f => f && f.status === 'queued').length} queued, ${facts.filter(f => f && f.status === 'decided').length} decided` : 'ABSENT'}`);
  if (REGISTER_ONLY) console.log('  coverage half NOT RUN (--register-only): S6 reports are a property of a working tree and this run did not look for them.');
  else {
    console.log(`  ${reports} map(s) had an S6 report on this disk${mapsWithoutReport.length ? `; ${mapsWithoutReport.length} had none (${mapsWithoutReport.map(x => `${x.map}: ${x.why}`).join('; ')})` : ''}`);
    const by = claims.reduce((acc, l) => { const k = l.covered ? l.covered.by : 'UNCOVERED'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    console.log(`  ${claims.length} claim(s) on those reports — ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    if (queued.length) console.log(`  ${queued.length} claim(s) have a home only as a QUEUED register entry — a question written down, not yet answered: ${[...new Set(queued.map(l => l.covered.id))].join(', ')}`);
    if (REQUIRE_REPORTS && reports === 0) console.log('  RED: --require-reports and no map had a verification.json to read. This is a laptop-only check; a run that finds nothing has checked nothing.');
  }
  if (red) console.log(`  ${uncovered.length} uncovered claim(s), ${registerFindings.length} register finding(s), ${silences.length} silence(s).`);
  else console.log('  every claim has a home, and the register contradicts no map.');
}
process.exit(red ? 1 : 0);
