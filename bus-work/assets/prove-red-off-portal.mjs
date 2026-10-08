#!/usr/bin/env node
/* Prove a map off the portal owes no engine-rebuild row, and that a list nobody read
 * drops nothing (buses-data OA-607 change 1).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-off-portal.mjs
 *
 * WHAT IS BEING FALSIFIED. worklist.mjs raises `engine-rebuild-<map>` only for a map
 * the live site's /api/public/maps lists, and a list that could not be read raises
 * every row as before. END TO END: a fixture tree with two maps drawn by an old
 * engine, Alpha and Beta, and a fake site on 127.0.0.1 that lists what each case
 * says. Each case is a pair with its opposite — the row dropped, and the row kept —
 * because a filter that drops everything also "passes" the first half.
 *
 * Then the MUTATION arm: a scratch copy of bus-work, make-bus-leaflet and
 * make-place-bus-leaflet assets, one deliberate break each, and the case that must
 * object to it. Nothing in the real tree is edited. No network beyond 127.0.0.1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.resolve(HERE, '..', '..');
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

// ---- the fixture: two built maps, both drawn by an engine that is nobody's today ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'off-portal-'));
for (const name of ['Alpha', 'Beta']) {
  const dir = path.join(root, 'Areas', name);
  fs.mkdirSync(path.join(dir, 'S4-generate', 'r1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stages: { S4: { latest: 'r1', runs: [{ id: 'r1', dir: 'S4-generate/r1', at: '2026-09-01T00:00:00Z', version: '1.0' }] } } }));
  fs.writeFileSync(path.join(dir, 'S4-generate', 'r1', 'routes.json'), JSON.stringify({ engine: '0000000000' }));
}

// ---- the fake site: GET /api/public/maps answers whatever `site` holds ----
let site = { status: 200, maps: [] };
const server = http.createServer((req, res) => {
  if (req.url !== '/api/public/maps') { res.writeHead(404); return res.end(); }
  res.writeHead(site.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: site.status === 200, maps: site.maps }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const LIVE = `http://127.0.0.1:${server.address().port}`;

/** Run a worklist.mjs (the real one, or a mutant) against the fixture; the rebuild keys, offPortal and the OA-607 warning. */
async function worklist(tool, live) {
  const args = [tool, '--json', '--local', '--buses', root, '--portal', path.join(root, 'no-portal-here'), ...(live ? ['--live', live] : ['--no-live'])];
  const { stdout } = await run('node', args, { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, BUS_SKILL_ASSETS: '' } });
  const j = JSON.parse(stdout);
  return {
    keys: j.items.filter((i) => /^engine-rebuild-/.test(i.key)).map((i) => i.key).sort().join(','),
    off: (j.meta.offPortal || []).join(','),
    warned: (j.meta.warnings || []).some((w) => /portal listing not read .*OA-607/.test(w)),
  };
}
const BOTH = 'engine-rebuild-Alpha,engine-rebuild-Beta';

/* The cases, each returning whether it held. The mutation arm re-runs them by name. */
const CASES = {
  async 'a listed map keeps its row and an unlisted one loses it'(tool) {
    site = { status: 200, maps: [{ name: 'Alpha', slug: 'alpha' }] };
    const r = await worklist(tool, LIVE);
    return r.keys === 'engine-rebuild-Alpha' && r.off === 'Beta' && !r.warned ? null : JSON.stringify(r);
  },
  async 'CONTROL: both listed, both keep their rows, nothing named off the portal'(tool) {
    site = { status: 200, maps: [{ name: 'Alpha', slug: 'alpha' }, { name: 'Somewhere else', slug: 'beta' }] };
    const r = await worklist(tool, LIVE);
    return r.keys === BOTH && r.off === '' && !r.warned ? null : JSON.stringify(r);
  },
  async 'a site that cannot be reached raises every row, and warns'(tool) {
    const r = await worklist(tool, 'http://127.0.0.1:9');
    return r.keys === BOTH && r.off === '' && r.warned ? null : JSON.stringify(r);
  },
  async 'a site answering 500 raises every row, and warns'(tool) {
    site = { status: 500, maps: [] };   // a list in the body, so only the status can say it is not the answer
    const r = await worklist(tool, LIVE);
    return r.keys === BOTH && r.off === '' && r.warned ? null : JSON.stringify(r);
  },
  async '--no-live raises every row, and warns'(tool) {
    const r = await worklist(tool, null);
    return r.keys === BOTH && r.off === '' && r.warned ? null : JSON.stringify(r);
  },
};

try {
  console.log('1. the real worklist.mjs');
  const REAL = path.join(HERE, 'worklist.mjs');
  for (const [name, fn] of Object.entries(CASES)) { const why = await fn(REAL); check(name, why === null, why); }

  console.log('2. mutants — each must turn its case red');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'off-portal-mutants-'));
  const copy = (rel) => fs.cpSync(path.join(SKILLS, rel), path.join(scratch, rel), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  for (const rel of ['bus-work/assets', 'make-bus-leaflet/assets', 'make-place-bus-leaflet/assets']) copy(rel);
  const MUTANTS = [
    { what: 'the filter dropped: every behind map is "on" the portal', file: 'make-bus-leaflet/assets/portal_listing.js',
      find: '(isListed(listing, nameOf(r)) === false ? off : on).push(r);', repl: 'on.push(r);', must: 'a listed map keeps its row and an unlisted one loses it' },
    { what: 'a list nobody read counted as "off the portal"', file: 'make-bus-leaflet/assets/portal_listing.js',
      find: '(isListed(listing, nameOf(r)) === false ? off : on).push(r);', repl: '(isListed(listing, nameOf(r)) !== true ? off : on).push(r);', must: 'a site that cannot be reached raises every row, and warns' },
    { what: 'a non-200 answer read as an empty list', file: 'make-bus-leaflet/assets/portal_listing.js',
      find: 'if (!res.ok || !Array.isArray(list))', repl: 'if (!Array.isArray(list) && res.ok)', must: 'a site answering 500 raises every row, and warns' },
    { what: 'worklist.mjs loops over every behind map, not the split', file: 'bus-work/assets/worklist.mjs',
      find: 'for (const { row: mapRow, place } of engineStale) {', repl: 'for (const { row: mapRow, place } of behindMaps) {', must: 'a listed map keeps its row and an unlisted one loses it' },
    { what: 'worklist.mjs stops warning when the list was not read', file: 'bus-work/assets/worklist.mjs',
      find: 'if (listed && !listed.listed) warnings.push(', repl: 'if (false) warnings.push(', must: '--no-live raises every row, and warns' },
  ];
  for (const m of MUTANTS) {
    const f = path.join(scratch, m.file);
    const orig = fs.readFileSync(f, 'utf8');
    if (orig.split(m.find).length !== 2) { check(`anchor for "${m.what}" appears exactly once`, false, m.file); continue; }
    fs.writeFileSync(f, orig.replace(m.find, m.repl));
    let why;
    try { why = await CASES[m.must](path.join(scratch, 'bus-work/assets/worklist.mjs')); } catch (e) { why = 'threw: ' + e.message.split('\n')[0]; }
    fs.writeFileSync(f, orig);
    check(`RED on "${m.what}" (${m.must})`, why !== null, 'the case still passed — the mutant SURVIVED');
  }
  fs.rmSync(scratch, { recursive: true, force: true });
} finally {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(bad ? `\nprove-red-off-portal: ${bad} failure(s)` : '\nprove-red-off-portal: every case held and every mutant was caught');
process.exit(bad ? 1 : 0);
