#!/usr/bin/env node
/* Prove `worklist.mjs --local` refuses a portal database that is not there, and
 * creates nothing (buses-data OA-613, 2026-10-16).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-local-db.mjs
 *
 * WHAT IS BEING FALSIFIED. The portal's src/db/index.js mkdirSync's DATA_DIR and
 * opens and migrates DB_PATH when it is imported, so a stale DATA_DIR used to
 * CREATE an empty database and the worklist reported an empty portal — for five
 * days, from a laptop .env still naming the pre-OA-611 C:/Claude path. The guard
 * asks (through engine.mjs assertLocalPortalDb) the portal's side-effect-free src/db/paths.js where the file is and exits 2
 * naming that path before the import. END TO END: a fixture portal whose
 * db/index.js does what the real one does to a missing path (makes the folder and
 * the file), whose worklist answers one item, and whose paths.js resolves the way
 * the real one does. Each refusal is paired with a CONTROL in which the file exists
 * and the portal's item comes through, because a guard that refuses everything
 * also "passes" the refusal cases.
 *
 * Then the MUTATION arm: a scratch copy of bus-work, make-bus-leaflet and
 * make-place-bus-leaflet assets, one deliberate break each (in worklist.mjs or engine.mjs), and the case that must
 * object to it. Nothing in the real tree is edited. No network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.resolve(HERE, '..', '..');
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

// ---- the fixture: an empty map tree and a three-file portal ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-db-'));
const buses = path.join(root, 'buses');
fs.mkdirSync(path.join(buses, 'Areas'), { recursive: true });
const portal = path.join(root, 'portal');
fs.mkdirSync(path.join(portal, 'src', 'db'), { recursive: true });
fs.mkdirSync(path.join(portal, 'src', 'worklist'), { recursive: true });
// paths.js resolves exactly as community-bus-maps/src/db/paths.js does.
fs.writeFileSync(path.join(portal, 'src', 'db', 'paths.js'), `import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'portal.sqlite');
`);
// index.js has the side effect that did the damage: a missing path becomes an empty database.
fs.writeFileSync(path.join(portal, 'src', 'db', 'index.js'), `import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './paths.js';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '');
export const listMaps = () => [];
`);
fs.writeFileSync(path.join(portal, 'src', 'worklist', 'index.js'), `import '../db/index.js';
export const buildWorklist = () => ({ items: [{ key: 'fixture-portal-item', rank: 5, type: 'fixture', title: 'from the fixture portal', why: '', who: 'Peter', do: [] }] });
`);

const RUNS = path.join(root, 'runs');   // a fresh, missing folder per case
let n = 0;
const fresh = () => path.join(RUNS, `case-${++n}`, 'data');

/** Run a worklist.mjs (the real one, or a mutant) against the fixture portal with `env` and an optional .env body. */
function worklist(tool, env, dotenv) {
  const envFile = path.join(portal, '.env');
  if (dotenv) fs.writeFileSync(envFile, dotenv); else fs.rmSync(envFile, { force: true });
  const base = { ...process.env, BUS_SKILL_ASSETS: '' };
  delete base.DATA_DIR; delete base.DB_PATH; delete base.BUSMAPS_URL;
  const r = spawnSync('node', [tool, '--json', '--local', '--no-live', '--no-ci', '--buses', buses, '--portal', portal],
    { env: { ...base, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let keys = null;
  try { keys = JSON.parse(r.stdout).items.map((i) => i.key); } catch { /* a refusal prints nothing parseable, by design */ }
  return { code: r.status, err: r.stderr || '', portalItem: !!keys && keys.includes('fixture-portal-item') };
}

/* The cases, each returning null when it held. The mutation arm re-runs them by name. */
const CASES = {
  'DB_PATH names a missing file: exit 2, the path printed, nothing created'(tool) {
    const dir = fresh(), db = path.join(dir, 'portal.sqlite');
    const r = worklist(tool, { DB_PATH: db });
    return r.code === 2 && r.err.includes(db) && /REFUSED/.test(r.err) && !fs.existsSync(dir)
      ? null : JSON.stringify({ code: r.code, created: fs.existsSync(dir), err: r.err.slice(0, 300) });
  },
  'a stale DATA_DIR in the portal .env: exit 2, the resolved file printed, nothing created'(tool) {
    const dir = fresh(), db = path.join(dir, 'portal.sqlite');
    const r = worklist(tool, {}, `DATA_DIR=${dir.replace(/\\/g, '/')}\n`);
    return r.code === 2 && r.err.includes(db) && !fs.existsSync(dir)
      ? null : JSON.stringify({ code: r.code, created: fs.existsSync(dir), err: r.err.slice(0, 300) });
  },
  'CONTROL: the database exists, the run succeeds and the portal item comes through'(tool) {
    const dir = fresh(); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'portal.sqlite'), '');
    const r = worklist(tool, {}, `DATA_DIR=${dir.replace(/\\/g, '/')}\n`);
    return r.code === 0 && r.portalItem ? null : JSON.stringify({ code: r.code, portalItem: r.portalItem, err: r.err.slice(0, 300) });
  },
};

try {
  console.log('1. the real worklist.mjs');
  const REAL = path.join(HERE, 'worklist.mjs');
  for (const [name, fn] of Object.entries(CASES)) { const why = fn(REAL); check(name, why === null, why); }

  console.log('2. mutants — each must turn its case red');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'local-db-mutants-'));
  const copy = (rel) => fs.cpSync(path.join(SKILLS, rel), path.join(scratch, rel), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  for (const rel of ['bus-work/assets', 'make-bus-leaflet/assets', 'make-place-bus-leaflet/assets']) copy(rel);
  const MUTANTS = [
    { what: 'the existence check removed', file: 'bus-work/assets/engine.mjs',
      find: 'if (!existsSync(DB_PATH)) {', repl: 'if (false) {', must: 'DB_PATH names a missing file: exit 2, the path printed, nothing created' },
    { what: 'the path guessed from DB_PATH alone instead of asked of paths.js', file: 'bus-work/assets/engine.mjs',
      find: 'const { DB_PATH } = await import(pathToFileURL(pathsFile).href);', repl: 'const DB_PATH = process.env.DB_PATH || pathsFile;',
      must: 'a stale DATA_DIR in the portal .env: exit 2, the resolved file printed, nothing created' },
    { what: 'worklist.mjs no longer calls the guard', file: 'bus-work/assets/worklist.mjs',
      find: 'await assertLocalPortalDb(PORTAL);', repl: '',
      must: 'DB_PATH names a missing file: exit 2, the path printed, nothing created' },
    { what: 'the guard called after the import that creates the file', file: 'bus-work/assets/worklist.mjs',
      find: 'await assertLocalPortalDb(PORTAL);', repl: "await import(pathToFileURL(path.join(PORTAL, 'src', 'db', 'index.js')).href); await assertLocalPortalDb(PORTAL);",
      must: 'DB_PATH names a missing file: exit 2, the path printed, nothing created' },
  ];
  for (const m of MUTANTS) {
    const f = path.join(scratch, m.file);
    const orig = fs.readFileSync(f, 'utf8');
    if (orig.split(m.find).length !== 2) { check(`anchor for "${m.what}" appears exactly once`, false, m.file); continue; }
    fs.writeFileSync(f, orig.replace(m.find, m.repl));
    let why;
    try { why = CASES[m.must](path.join(scratch, 'bus-work/assets/worklist.mjs')); } catch (e) { why = 'threw: ' + e.message.split('\n')[0]; }
    fs.writeFileSync(f, orig);
    check(`RED on "${m.what}" (${m.must})`, why !== null, 'the case still passed — the mutant SURVIVED');
  }
  fs.rmSync(scratch, { recursive: true, force: true });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(bad ? `\nprove-red-local-db: ${bad} failure(s)` : '\nprove-red-local-db: every case held and every mutant was caught');
process.exit(bad ? 1 : 0);
