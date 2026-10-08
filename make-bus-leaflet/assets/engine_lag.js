#!/usr/bin/env node
/*
 * engine_lag.js — HOW LONG a map has been drawn by an engine that is not today's
 * (buses-data OA-485 item 3, Peter's ruling of 2026-10-04: a ceiling of 60 days).
 *
 * THE CEILING IS ONE CONSTANT, `CEILING_DAYS`, read by the board (`status.js`) and by
 * `bus-work/assets/loop_health.mjs`, so the two cannot disagree about it.
 *
 * WHAT IS MEASURED. A map's `routes.json` records `engineCommit`, the claude-skills
 * commit that drew it. The map has been LAGGING since the first commit AFTER that one
 * that changed a file of the engine's hashed closure (`engine_version.js`
 * `engineFiles()` for a town, `placeEngineFiles()` for a place) — not since the map
 * was built, and not since the newest commit of the repository, because most commits
 * to claude-skills draw no ink and a map is not behind over a change to a test. Lag is
 * the days from that commit to now. A map whose engine has not moved since is 0.
 *
 * "COULD NOT LOOK" IS NEVER ZERO. A map with no `engineCommit`, or one this clone does
 * not have, is `unknown` and is listed as such, exactly as `shadow_count.js` never
 * counts an unmeasured map clean.
 *
 * INFORMATION, NEVER RED. Being behind is one rebuild ROW per map (OA-430), carried by
 * the worklist; nothing here is in the board's `bad`, and `loop_health` reports it as
 * a NOTE. The ceiling decides when a note is raised, not when anything stops.
 *
 * A MAP OFF THE PORTAL IS HELD TO NO CEILING (OA-607). Given a `listing` from
 * portal_listing.js, a map the live site does not list leaves `over` for `offPortal`:
 * the public cannot see it, so it is rebuilt when it is next activated (a refresh, a
 * publish, a letter), not on the clock. A listing that was not read counts every map
 * as on the portal, and says so — a failed read never quietly drops a map.
 *
 * THIS FILE IS OUTSIDE BOTH ENGINE HASHES and must stay there: no generator requires
 * it, so adding it moves no ink. Zero dependencies (Node core only).
 *
 *   node assets/engine_lag.js --buses "<buses-data root>" [--json] [--live <base url>] [--no-live]
 */
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CEILING_DAYS = 60;
const DAY_MS = 86400000;

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim() };
}

/** The repository holding `dir`, or null. */
function repoRoot(dir) {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  return r.ok && r.out ? path.resolve(r.out) : null;
}

/**
 * When did the engine first move past `commit`? One of
 *   { status: 'current' }                 no commit since has touched `files`
 *   { status: 'moved', at: <ISO date> }   the first one that did
 *   { status: 'unknown', why }            git could not answer
 */
function firstMovedAt(root, commit, files) {
  if (!commit) return { status: 'unknown', why: 'its routes.json records no `engineCommit`' };
  if (!git(root, ['cat-file', '-e', commit + '^{commit}']).ok) return { status: 'unknown', why: 'commit ' + commit + ' is not in this clone' };
  const rel = files.map((f) => path.relative(root, f).split(path.sep).join('/'));
  const r = git(root, ['log', '--reverse', '--format=%cI', commit + '..HEAD', '--', ...rel]);
  if (!r.ok) return { status: 'unknown', why: 'git log failed' };
  const first = r.out.split('\n').filter(Boolean)[0];
  return first ? { status: 'moved', at: first } : { status: 'current' };
}

/**
 * Measure a list of maps `{ name, engineCommit, place }`. `files` is `{ town: [...], place: [...] }`,
 * absolute paths of each closure. Returns `{ ceiling, measured, over, unknown, offPortal, listing, rows }`,
 * `over` sorted worst first. `listing` is portal_listing.read()'s answer, or absent.
 */
function measure(maps, { skillsRoot, files, nowMs = Date.now(), ceiling = CEILING_DAYS, listing }) {
  const pl = require('./portal_listing.js');
  const cache = new Map();
  const rows = maps.map((m) => {
    const kind = m.place ? 'place' : 'town';
    const key = kind + ':' + m.engineCommit;
    if (!cache.has(key)) cache.set(key, firstMovedAt(skillsRoot, m.engineCommit, files[kind]));
    const f = cache.get(key), onPortal = pl.isListed(listing, m.name);
    if (f.status === 'unknown') return { name: m.name, onPortal, days: null, why: f.why };
    if (f.status === 'current') return { name: m.name, onPortal, days: 0 };
    const t = Date.parse(f.at);
    return Number.isFinite(t) ? { name: m.name, onPortal, days: Math.max(0, Math.floor((nowMs - t) / DAY_MS)), since: f.at.slice(0, 10) }
      : { name: m.name, onPortal, days: null, why: 'unreadable commit date ' + f.at };
  });
  return {
    ceiling,
    measured: rows.filter((r) => r.days !== null).length,
    over: rows.filter((r) => r.days !== null && r.days > ceiling && r.onPortal !== false).sort((a, b) => b.days - a.days),
    unknown: rows.filter((r) => r.days === null),
    offPortal: rows.filter((r) => r.onPortal === false && r.days !== 0),
    listing: listing ? { measured: pl.split([], listing).measured, why: listing.why || null } : null,
    rows,
  };
}

/** Every map under a buses-data tree as `{ name, engineCommit, place }`, from its latest S4 `routes.json`. */
function collect(busesDir) {
  const gl = require('./gate_lib');
  const fs = require('node:fs');
  const towns = gl.findTowns(busesDir);
  const places = gl.findPlaces(towns, busesDir);
  const one = (t, place) => {
    let engineCommit = null;
    try {
      const m = gl.readJson(path.join(t.dir, 'manifest.json'));
      const s4 = gl.latestRunDir(m, t.dir, 'S4');
      if (!s4) return null;                                   // never built: no engine to lag
      const rj = path.join(s4.dir, 'routes.json');
      if (fs.existsSync(rj)) engineCommit = gl.readJson(rj).engineCommit || null;
    } catch (e) { /* unreadable: engineCommit stays null, and the map is "unknown" */ }
    return { name: t.name, engineCommit, place };
  };
  return [...towns.map((t) => one(t, false)), ...places.map((p) => one(p, true))].filter(Boolean);
}

/**
 * The closures of today's engine, as ABSOLUTE paths. `engineFiles()` and friends return
 * names relative to the folder they were read from, and a relative path handed to git
 * from the wrong directory matches nothing — which reads as "no commit has moved the
 * engine", the quiet answer. So each is resolved against its own folder and must exist.
 * A place is drawn by the town closure, the place-local files and the boarding generator.
 */
function engineClosures() {
  const fs = require('node:fs');
  const ev = require('./engine_version');
  const abs = (dir, names) => names.map((n) => {
    const p = path.resolve(dir, n);
    if (!fs.existsSync(p)) throw new Error('engine_lag: ' + p + ' is in an engine closure but does not exist');
    return p;
  });
  const town = abs(__dirname, ev.engineFiles());
  const place = [...new Set([...town, ...abs(ev.placeAssetsDir(), ev.placeEngineFiles()), ...abs(__dirname, ev.boardingEngineFiles())])];
  return { town, place };
}

/** Measure a whole buses-data tree against the claude-skills clone holding this file. */
function measureTree(busesDir, opts = {}) {
  const skillsRoot = opts.skillsRoot || repoRoot(__dirname);
  if (!skillsRoot) return { ceiling: CEILING_DAYS, measured: 0, over: [], unknown: [], rows: [], error: 'no git repository holds the engine' };
  return measure(collect(busesDir), { skillsRoot, files: engineClosures(), ...opts });
}

function lines(r) {
  if (r.error) return ['  engine lag not measured: ' + r.error];
  const out = [];
  out.push(r.over.length
    ? '  ' + r.over.length + ' of ' + r.rows.length + ' maps are past the ' + r.ceiling + '-day engine-lag ceiling (look, not red; a rebuild row each): '
      + r.over.map((m) => m.name + ' ' + m.days + 'd').join(', ')
    : '  no map is past the ' + r.ceiling + '-day engine-lag ceiling (' + r.measured + ' of ' + r.rows.length + ' measured)');
  if (r.offPortal && r.offPortal.length) out.push('  ' + r.offPortal.length + ' off the portal, so held to no ceiling and owed no rebuild until next activated (OA-607): '
    + r.offPortal.map((m) => m.name + (m.days === null ? ' ?' : ' ' + m.days + 'd')).join(', '));
  if (r.listing && !r.listing.measured) out.push('  portal listing not read (' + r.listing.why + ') — every map is held to the ceiling, on the portal or not');
  if (r.unknown.length) out.push('  lag unknown for ' + r.unknown.length + ' (not counted as inside the ceiling): ' + r.unknown.map((m) => m.name + ' — ' + m.why).join('; '));
  return out;
}

function printSection(r) { for (const l of lines(r)) console.log(l); }

module.exports = { CEILING_DAYS, firstMovedAt, measure, collect, measureTree, engineClosures, repoRoot, lines, printSection };

if (require.main === module) (async () => {
  const a = process.argv.slice(2);
  const i = a.indexOf('--buses'), l = a.indexOf('--live');
  if (i < 0 || !a[i + 1]) { console.error('usage: node engine_lag.js --buses "<buses-data root>" [--json] [--live <base url>] [--no-live]'); process.exit(2); }
  const listing = await require('./portal_listing.js').read({ liveUrl: l >= 0 ? a[l + 1] : undefined, noLive: a.includes('--no-live') });
  const r = measureTree(path.resolve(a[i + 1]), { listing });
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 2)); else printSection(r);
})();
