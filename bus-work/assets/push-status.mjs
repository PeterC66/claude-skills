#!/usr/bin/env node
/*
 * push-status.mjs — send status.js's byte-identical gate + engine/S6
 * staleness to the portal, so it shows at ranks 0/8 of the SAME worklist as
 * the portal's own queues (`/api/admin/worklist`, the admin console's To-do
 * tab) instead of only being visible by running `worklist.mjs --gates` on
 * this laptop. Item 3 of the fool-proofing plan.
 *
 * status.js is the EXPENSIVE proof (regenerate every town/place and diff the
 * SVG) — this script always runs the full thing, unlike worklist.mjs's own
 * cheap manifest-hash check which only covers engine/S6 age, not gate PASS.
 * Worth a minute or two after an engine change or before a batch of
 * deliveries; not something to run on every worklist glance.
 *
 * Local portal (default): written straight to <DATA_DIR>/status-snapshot.json.
 * Cheaper and more honest than a loopback HTTP call to a server that might
 * not be running.
 *
 * Remote portal (--url): POSTed to POST /api/admin/status with a bearer
 * token (STATUS_TOKEN — the same pattern as METRICS_TOKEN).
 *
 * Usage:
 *   node push-status.mjs [--portal DIR] [--buses DIR]
 *   node push-status.mjs --url https://busmaps.uk --token <STATUS_TOKEN>
 *
 * Zero dependencies (Node core only), matching worklist.mjs / status.js.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    f[k] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));

const PORTAL = path.resolve(args.portal || process.env.BUSMAPS_PORTAL || 'C:/Claude/community-bus-maps');
const BUSES = path.resolve(args.buses || process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses');

// The portal's own .env is the authority on DATA_DIR / STATUS_TOKEN — read it
// the same way worklist.mjs does, so this always targets the same database
// the server does. Real environment wins, so an explicit override still works.
function loadPortalEnv(dir) {
  const f = path.join(dir, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env) && v) process.env[m[1]] = v;
  }
}
loadPortalEnv(PORTAL);
// Read AFTER the .env load, not before it. Until 2026-09-02 URL_BASE was
// computed above loadPortalEnv, so BUSMAPS_URL set only in the portal's .env
// was never seen: with no --url this script silently took the LOCAL path and
// wrote the snapshot into the dev DATA_DIR while SKILL.md promised the
// .env-driven remote. worklist.mjs always had the order right (OA-224, Tier 1.1).
const URL_BASE = (args.url || process.env.BUSMAPS_URL || '').replace(/\/$/, '');
const REMOTE = !!URL_BASE;
const TOKEN = args.token || process.env.STATUS_TOKEN || '';

function findSkillAssets() {
  const cands = [
    process.env.BUS_SKILL_ASSETS,
    path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets'),
    'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets',
    path.join(process.env.USERPROFILE || '', '.claude', 'skills', 'make-bus-leaflet', 'assets'),
  ].filter(Boolean);
  return cands.find((c) => existsSync(path.join(c, 'status.js'))) || null;
}
const SK = findSkillAssets();
if (!SK) {
  console.error('make-bus-leaflet assets (status.js) not found — nothing to push. Set BUS_SKILL_ASSETS if the skills tree lives somewhere non-standard.');
  process.exit(1);
}

const modeLabel = REMOTE ? `REMOTE — LIVE PORTAL (${URL_BASE})` : `LOCAL — dev checkout (${PORTAL})`;
const bannerRule = '='.repeat(Math.max(modeLabel.length + 4, 40));
console.log(`\n${bannerRule}`);
console.log(`  ${modeLabel}`);
console.log(bannerRule);

console.log(`Running status.js --json (this regenerates + diffs every town/place — a minute or two)...`);
const r = spawnSync(process.execPath, [path.join(SK, 'status.js'), '--json', '--buses', BUSES, '--portal', PORTAL],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let gates;
try { gates = JSON.parse(r.stdout); } catch {
  console.error('status.js --json did not produce parseable output:');
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

const payload = {
  engine: gates.towns.find((t) => t.engineCurrent)?.engine || null,
  towns: gates.towns,
  places: gates.places,
  portalDrift: gates.portalDrift || [],
};

if (REMOTE) {
  if (!TOKEN) {
    console.error('--url given but no --token / STATUS_TOKEN — cannot authenticate to the remote portal.');
    process.exit(1);
  }
  const res = await fetch(`${URL_BASE}/api/admin/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`POST /api/admin/status -> ${res.status}: ${await res.text().catch(() => '')}`);
    process.exit(1);
  }
  console.log(`Pushed to ${URL_BASE} — ${payload.towns.length} town(s), ${payload.places.length} place(s).`);
} else {
  const dataDir = path.resolve(PORTAL, process.env.DATA_DIR || 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'status-snapshot.json'), JSON.stringify({ receivedAt: new Date().toISOString(), ...payload }, null, 2));
  console.log(`Written to ${path.join(dataDir, 'status-snapshot.json')} — ${payload.towns.length} town(s), ${payload.places.length} place(s).`);
}

const bad = payload.towns.filter((t) => t.internal === 'DIFF' || t.internal === 'FAIL' || /^(DIFF|FAIL)/.test(String(t.external || '')))
  .concat(payload.places.filter((p) => p.internal === 'DIFF' || p.internal === 'FAIL' || p.external === 'DIFF' || p.external === 'FAIL'))
  .concat((payload.portalDrift || []).filter((d) => d.same === false));
if (bad.length) console.log(`${bad.length} gate failure(s) will show at rank 0 of the worklist.`);
