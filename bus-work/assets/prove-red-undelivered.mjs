#!/usr/bin/env node
/* Prove a map rendered here since the portal last received it raises an
 * `undelivered-<slug>` row, and that every way of not knowing raises none
 * (buses-data, 2026-10-16; undelivered.mjs says why the row exists).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-undelivered.mjs
 *
 * WHAT IS BEING FALSIFIED. END TO END through worklist.mjs: a fixture tree holding
 * one map, Alpha, whose newest S5 render is dated 2026-10-01 09:00 UTC, and a fake
 * portal on 127.0.0.1 answering /api/admin/worklist, /api/maps and /api/public/maps
 * with whatever each case says. The row is raised only when the portal's
 * `lastDeliveryAt` is older than that render, and each case is paired with its
 * opposite, because a join that never raises a row "passes" every quiet case.
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

// ---- the fixture: one built map, rendered 2026-10-01 09:00 UTC ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'undelivered-'));
const dir = path.join(root, 'Areas', 'Alpha');
const S5 = 'v1.1_2026-10-01_1000';
fs.mkdirSync(path.join(dir, 'S4-generate', S5), { recursive: true });
fs.mkdirSync(path.join(dir, 'S5-render', S5), { recursive: true });
fs.writeFileSync(path.join(dir, 'S4-generate', S5, 'routes.json'), JSON.stringify({ engine: '0000000000' }));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stages: {
  S4: { latest: S5, runs: [{ id: S5, dir: `S4-generate/${S5}`, at: '2026-10-01T09:00', version: '1.1' }] },
  S5: { latest: S5, runs: [{ id: S5, dir: `S5-render/${S5}`, at: '2026-10-01T09:00', version: '1.1' }] },
} }));

// ---- the fake portal: `portal` is what /api/maps says of Alpha, `listed` what the live site lists ----
let portal = {}, listed = true;
const server = http.createServer((req, res) => {
  // `connection: close` because this one server is the remote portal AND the live site:
  // the worklist's earlier reads leave keep-alive sockets that the listing fetch can
  // reuse as the server closes them, and "fetch failed" then reads as an unread list.
  const send = (o) => { res.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/admin/worklist') return send({ ok: true, worklist: { items: [] } });
  if (req.url === '/api/maps') return send({ ok: true, maps: [{ id: 1, slug: 'alpha', name: 'Alpha', kind: 'area', subject: 'Alpha', currentVersion: 'v1.0', customer: { name: 'Test Council' }, ...portal }] });
  if (req.url === '/api/public/maps') return send({ ok: true, maps: listed ? [{ name: 'Alpha', slug: 'alpha' }] : [] });
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/** Run a worklist.mjs (the real one, or a mutant) against the fixture; the undelivered keys, the two warnings, offPortal. */
async function worklist(tool) {
  const args = [tool, '--json', '--no-ci', '--url', BASE, '--token', 't', '--live', BASE, '--buses', root, '--portal', path.join(root, 'no-portal-here')];
  const { stdout } = await run('node', args, { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, BUS_SKILL_ASSETS: '', BUSMAPS_URL: '', BUSMAPS_TOKEN: '' } });
  const j = JSON.parse(stdout);
  const w = j.meta.warnings || [];
  return {
    keys: j.items.filter((i) => /^undelivered-/.test(i.key)).map((i) => i.key).join(','),
    predates: w.some((x) => /does not report lastDeliveryAt/.test(x)),
    unreadable: w.some((x) => /could not read a build or delivery time/.test(x)),
    off: (j.meta.undeliveredOffPortal || []).join(','),
  };
}
const quiet = (r) => !r.predates && !r.unreadable && r.off === '';

const CASES = {
  async 'delivered BEFORE the render: the row is raised'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true;
    const r = await worklist(tool);
    return r.keys === 'undelivered-alpha' && quiet(r) ? null : JSON.stringify(r);
  },
  async 'CONTROL: delivered AFTER the render: no row'(tool) {
    portal = { lastDeliveryAt: '2026-10-01 09:30:00' }; listed = true;
    const r = await worklist(tool);
    return r.keys === '' && quiet(r) ? null : JSON.stringify(r);
  },
  async 'a portal that predates the field: no row, and it says it could not ask'(tool) {
    portal = {}; listed = true;
    const r = await worklist(tool);
    return r.keys === '' && r.predates && !r.unreadable ? null : JSON.stringify(r);
  },
  async 'never built on the portal (null): no row and no warning'(tool) {
    portal = { lastDeliveryAt: null }; listed = true;
    const r = await worklist(tool);
    return r.keys === '' && quiet(r) ? null : JSON.stringify(r);
  },
  async 'unlisted on the live site: no row, and it is named off the portal'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = false;
    const r = await worklist(tool);
    return r.keys === '' && r.off === 'Alpha' && !r.predates ? null : JSON.stringify(r);
  },
};

try {
  console.log('1. the real worklist.mjs');
  const REAL = path.join(HERE, 'worklist.mjs');
  for (const [name, fn] of Object.entries(CASES)) { const why = await fn(REAL); check(name, why === null, why); }

  console.log('2. mutants — each must turn its case red');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'undelivered-mutants-'));
  const copy = (rel) => fs.cpSync(path.join(SKILLS, rel), path.join(scratch, rel), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  for (const rel of ['bus-work/assets', 'make-bus-leaflet/assets', 'make-place-bus-leaflet/assets']) copy(rel);
  const MUTANTS = [
    { what: 'a delivery after the render no longer clears the row', file: 'bus-work/assets/undelivered.mjs',
      find: 'if (built <= sent) { upToDate++; continue; }', repl: 'if (false) { upToDate++; continue; }', must: 'CONTROL: delivered AFTER the render: no row' },
    { what: 'a portal with no field is not recognised as one', file: 'bus-work/assets/undelivered.mjs',
      find: 'p.map.lastDeliveryAt === undefined)', repl: "p.map.lastDeliveryAt === 'never')", must: 'a portal that predates the field: no row, and it says it could not ask' },
    { what: 'a map never built on the portal is read as a time', file: 'bus-work/assets/undelivered.mjs',
      find: 'if (m.lastDeliveryAt === null || !local.s5) continue;', repl: 'if (!local.s5) continue;', must: 'never built on the portal (null): no row and no warning' },
    { what: 'the join skips the live-site listing', file: 'bus-work/assets/undelivered.mjs',
      find: 'const { on, off } = listingLib.split(pairs, lst, (p) => p.map.name);', repl: 'const on = pairs, off = [];', must: 'unlisted on the live site: no row, and it is named off the portal' },
    { what: 'worklist.mjs never reads a town\'s S5', file: 'bus-work/assets/worklist.mjs',
      find: "row.s5 = s5Row(latestRunDir(m, t.dir, 'S5'));", repl: 'row.s5 = null;', must: 'delivered BEFORE the render: the row is raised' },
    { what: 'worklist.mjs drops the field from the remote portal\'s maps', file: 'bus-work/assets/worklist.mjs',
      find: 'lastDeliveryAt: m.lastDeliveryAt,', repl: '', must: 'delivered BEFORE the render: the row is raised' },
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

console.log(bad ? `\nprove-red-undelivered: ${bad} failure(s)` : '\nprove-red-undelivered: every case held and every mutant was caught');
process.exit(bad ? 1 : 0);
