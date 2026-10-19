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
 * portal on 127.0.0.1 answering /api/admin/worklist, /api/maps, /api/public/maps and
 * Alpha's public sheet with whatever each case says. The row is raised only when the
 * portal's `lastDeliveryAt` is older than that render AND the live sheet's ink differs
 * from the local S5's (pilot wrapper and version stamp aside), or no live sheet could
 * be read; and each case is paired with its opposite, because a join that never raises
 * a row "passes" every quiet case. A blocked S6 an action owns, and a map a
 * loop/your-move/ hold names, fold the row away; each fold has its control too.
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
// The local sheet, and the live one built from it the way the portal does: the pilot
// wrapper round it and "Map version" in place of the build stamp (Aldi v1.44 against
// live v9.1, 2026-10-19). SAME differs from the local sheet by nothing but those two.
const LOCAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210">\n<text x="1" y="2">Route 1 to Beta</text>\n<text x="262" y="201">build 1.1 · 1 Oct 2026</text>\n</svg>\n';
fs.writeFileSync(path.join(dir, 'S5-render', S5, 'internal.svg'), LOCAL_SVG);
const wrap = (svg) => svg.replace(/(<svg[^>]*>)/, '$1\n<rect id="pilot-bg" x="0" y="0" width="297" height="210" fill="#ffffff"/>\n<g id="pilot-content" transform="translate(6.237,8.820) scale(0.958000)">')
  .replace('build 1.1 · 1 Oct 2026', 'Map version 1.0')
  .replace('</svg>', '</g>\n<g id="pilot-band">\n<rect x="0" y="0" width="297" height="8.820" fill="#b30000"/>\n<text x="3" y="5.82"><tspan font-weight="bold">PILOT — SAMPLE MAP</tspan> · Made to test the system.</text>\n</g>\n</svg>');
const SAME = wrap(LOCAL_SVG), DIFF = wrap(LOCAL_SVG.replace('Route 1 to Beta', 'Route 2 to Gamma'));
// A hold the fold case writes, naming Alpha in its headline (or, as its control, Alphaville).
const HOLDS = path.join(root, 'loop', 'your-move');
fs.mkdirSync(HOLDS, { recursive: true });
const writeHold = (who) => fs.writeFileSync(path.join(HOLDS, 'some-hold.md'), `# ${who} v1.1 waits for you to look at the crops\n\n**Raised by:** test, 2026-10-01.\n\n## What is needed from you\n\nLook at the crops.\n`);
const clearHold = () => fs.rmSync(path.join(HOLDS, 'some-hold.md'), { force: true });
// …and an S6 run whose verdict each case sets, plus one open action naming Alpha and
// that run, which a BLOCKED row must point at (buses-data OA-636, Wisbech v5.0).
const S6 = '2026-10-01_1100';
fs.mkdirSync(path.join(dir, 'S6-verify', S6), { recursive: true });
const setVerdict = (verdict) => fs.writeFileSync(path.join(dir, 'S6-verify', S6, 'verification.json'), JSON.stringify({ summary: { verdict, hard: verdict === 'blocked' ? 3 : 0 } }));
setVerdict('pass');
const OAS = path.join(root, 'Development Docs', 'open-actions');
fs.mkdirSync(OAS, { recursive: true });
fs.writeFileSync(path.join(OAS, 'OA-900.md'), `**Alpha:** the S6 of ${S6} went HARD on two via places.\n`);
fs.writeFileSync(path.join(OAS, 'OA-901.md'), 'Alpha is mentioned here, but no S6 run is.\n');
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stages: {
  S4: { latest: S5, runs: [{ id: S5, dir: `S4-generate/${S5}`, at: '2026-10-01T09:00', version: '1.1' }] },
  S5: { latest: S5, runs: [{ id: S5, dir: `S5-render/${S5}`, at: '2026-10-01T09:00', version: '1.1' }] },
  S6: { latest: S6, runs: [{ id: S6, dir: `S6-verify/${S6}`, at: '2026-10-01T10:00' }] },
} }));

// ---- the fake portal: `portal` is what /api/maps says of Alpha, `listed` what the live site lists,
// `sheet` Alpha's live internal sheet (null: the public map answers 404) ----
let portal = {}, listed = true, sheet = DIFF;
const server = http.createServer((req, res) => {
  // `connection: close` because this one server is the remote portal AND the live site:
  // the worklist's earlier reads leave keep-alive sockets that the listing fetch can
  // reuse as the server closes them, and "fetch failed" then reads as an unread list.
  const send = (o) => { res.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/admin/worklist') return send({ ok: true, worklist: { items: [] } });
  if (req.url === '/api/maps') return send({ ok: true, maps: [{ id: 1, slug: 'alpha', name: 'Alpha', kind: 'area', subject: 'Alpha', currentVersion: 'v1.0', customer: { name: 'Test Council' }, ...portal }] });
  if (req.url === '/api/public/maps') return send({ ok: true, maps: listed ? [{ name: 'Alpha', slug: 'alpha' }] : [] });
  if (req.url === '/api/public/maps/alpha' && sheet !== null) return send({ ok: true, map: { slug: 'alpha', outputs: [{ key: 'internal_geographic', base: 'internal', svgUrl: '/api/public/maps/alpha/internal.svg' }] } });
  if (req.url === '/api/public/maps/alpha/internal.svg' && sheet !== null) { res.writeHead(200, { 'content-type': 'image/svg+xml', connection: 'close' }); return res.end(sheet); }
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
  const rows = j.items.filter((i) => /^undelivered-/.test(i.key));
  return {
    keys: rows.map((i) => i.key).join(','),
    // what the row says of the newest S6, whether it offers a delivery, and which actions it points at
    blocked: rows.some((i) => /BLOCKED/.test(i.title)),
    deliver: rows.some((i) => (i.do || []).some((d) => d.kind === 'shell' && /deliver|propose-update/.test(d.cmd))),
    owners: rows.flatMap((i) => i.owners || []).join(','),
    why: rows.map((i) => i.why).join(' | '),
    folded: (j.meta.folded || []).filter((f) => /^undelivered-/.test(f.key)).map((f) => `${f.key}>${f.into}`).join(','),
    predates: w.some((x) => /does not report lastDeliveryAt/.test(x)),
    unreadable: w.some((x) => /could not read a build or delivery time/.test(x)),
    off: (j.meta.undeliveredOffPortal || []).join(','),
  };
}
const quiet = (r) => !r.predates && !r.unreadable && r.off === '';

const CASES = {
  async 'delivered BEFORE the render, live ink differs: the row is raised and names the line'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; sheet = DIFF;
    const r = await worklist(tool);
    return r.keys === 'undelivered-alpha' && /Route 2 to Gamma/.test(r.why) && /Route 1 to Beta/.test(r.why) && quiet(r) ? null : JSON.stringify(r);
  },
  async 'CONTROL: delivered before the render, live ink the SAME bar wrapper and stamp: no row'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; sheet = SAME;
    try {
      const r = await worklist(tool);
      return r.keys === '' && r.folded === '' && quiet(r) ? null : JSON.stringify(r);
    } finally { sheet = DIFF; }
  },
  async 'no public sheet (404): the time test raises the row and says it could not compare'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; sheet = null;
    try {
      const r = await worklist(tool);
      return r.keys === 'undelivered-alpha' && /could not be compared/.test(r.why) && quiet(r) ? null : JSON.stringify(r);
    } finally { sheet = DIFF; }
  },
  async 'a hold naming Alpha: the row is folded into it'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; sheet = DIFF; writeHold('Alpha');
    try {
      const r = await worklist(tool);
      return r.keys === '' && r.folded === 'undelivered-alpha>loop-hold-some-hold' ? null : JSON.stringify(r);
    } finally { clearHold(); }
  },
  async 'CONTROL: a hold naming Alphaville: the row stays'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; sheet = DIFF; writeHold('Alphaville');
    try {
      const r = await worklist(tool);
      return r.keys === 'undelivered-alpha' && r.folded === '' ? null : JSON.stringify(r);
    } finally { clearHold(); }
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
  async 'newest S6 BLOCKED and OA-900 owns it: the row is folded into OA-900 alone'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; setVerdict('blocked');
    try {
      const r = await worklist(tool);
      return r.keys === '' && r.folded === 'undelivered-alpha>OA-900' && quiet(r) ? null : JSON.stringify(r);
    } finally { setVerdict('pass'); }
  },
  async 'newest S6 BLOCKED and no action owns it: the row says so, offers no delivery, and asks for one'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; setVerdict('blocked');
    const oa = path.join(OAS, 'OA-900.md'), kept = fs.readFileSync(oa, 'utf8');
    fs.rmSync(oa);
    try {
      const r = await worklist(tool);
      return r.keys === 'undelivered-alpha' && r.blocked && !r.deliver && r.owners === '' && r.folded === '' && /file one/.test(r.why) && quiet(r) ? null : JSON.stringify(r);
    } finally { setVerdict('pass'); fs.writeFileSync(oa, kept); }
  },
  async 'CONTROL: newest S6 PASS: the row offers the delivery and says nothing of BLOCKED'(tool) {
    portal = { lastDeliveryAt: '2026-09-20 12:00:00' }; listed = true; setVerdict('pass');
    const r = await worklist(tool);
    return r.keys === 'undelivered-alpha' && !r.blocked && r.deliver && r.owners === '' && quiet(r) ? null : JSON.stringify(r);
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
      find: "row.s5 = s5Row(latestRunDir(m, t.dir, 'S5'));", repl: 'row.s5 = null;', must: 'delivered BEFORE the render, live ink differs: the row is raised and names the line' },
    { what: 'worklist.mjs drops the field from the remote portal\'s maps', file: 'bus-work/assets/worklist.mjs',
      find: 'lastDeliveryAt: m.lastDeliveryAt,', repl: '', must: 'delivered BEFORE the render, live ink differs: the row is raised and names the line' },
    { what: 'the S6 verdict is never read', file: 'bus-work/assets/undelivered.mjs',
      find: 'verdict: s.verdict || null,', repl: 'verdict: null,', must: 'newest S6 BLOCKED and OA-900 owns it: the row is folded into OA-900 alone' },
    { what: 'worklist.mjs never reads a town\'s S6 verdict', file: 'bus-work/assets/worklist.mjs',
      find: 'row.s6v = s6Verdict(s6); // undelivered.mjs: a town', repl: 'row.s6v = null; // a town', must: 'newest S6 BLOCKED and OA-900 owns it: the row is folded into OA-900 alone' },
    { what: 'an action naming the map but not the S6 run is taken as its owner', file: 'bus-work/assets/undelivered.mjs',
      find: 'return t.includes(name) && t.includes(s6Id);', repl: 'return t.includes(name);', must: 'newest S6 BLOCKED and OA-900 owns it: the row is folded into OA-900 alone' },
    { what: 'every verdict is read as blocked', file: 'bus-work/assets/undelivered.mjs',
      find: "const s6 = local.s6v && local.s6v.verdict === 'blocked' ? local.s6v : null;", repl: 'const s6 = local.s6v || null;', must: 'CONTROL: newest S6 PASS: the row offers the delivery and says nothing of BLOCKED' },
    // the ink compare (buses-data, 2026-10-19)
    { what: 'two identical sheets are never read as the same', file: 'bus-work/assets/undelivered.mjs',
      find: 'if (a.length === b.length && a.every((x, i) => x === b[i])) return { same: true, lines: [] };', repl: '', must: 'CONTROL: delivered before the render, live ink the SAME bar wrapper and stamp: no row' },
    { what: 'the pilot-content group\'s close is left in', file: 'bus-work/assets/undelivered.mjs',
      find: 'const wrapped = /<g id="pilot-content"[^>]*>/.test(s);', repl: 'const wrapped = false;', must: 'CONTROL: delivered before the render, live ink the SAME bar wrapper and stamp: no row' },
    { what: 'the version stamp is compared as ink', file: 'bus-work/assets/undelivered.mjs',
      find: "'>STAMP<'", repl: "'>$1<'", must: 'CONTROL: delivered before the render, live ink the SAME bar wrapper and stamp: no row' },
    { what: 'the live sheets are never fetched', file: 'bus-work/assets/undelivered.mjs',
      find: "p.ink = noLive ? { compared: false, why: '--no-live' } : await compare(", repl: 'p.ink = null && (', must: 'CONTROL: delivered before the render, live ink the SAME bar wrapper and stamp: no row' },
    { what: 'a failed read of the live sheet is taken as the same ink', file: 'bus-work/assets/undelivered.mjs',
      find: 'if (ink && ink.compared && !ink.differs.length)', repl: 'if (ink && !(ink.differs || []).length)', must: 'no public sheet (404): the time test raises the row and says it could not compare' },
    { what: 'worklist.mjs never folds a row under a hold naming its map', file: 'bus-work/assets/worklist.mjs',
      find: 'foldUnderHolds(items); // undelivered.mjs', repl: '// undelivered.mjs', must: 'a hold naming Alpha: the row is folded into it' },
    { what: 'a hold folds every map whose name it merely contains', file: 'bus-work/assets/undelivered.mjs',
      find: '(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)', repl: '${esc}', must: 'CONTROL: a hold naming Alphaville: the row stays' },
    { what: 'a blocked row with an owner is not folded into the action', file: 'bus-work/assets/undelivered.mjs',
      find: 'if (!(it.s6Blocked && it.owners && it.owners.length)) return true;', repl: 'return true;', must: 'newest S6 BLOCKED and OA-900 owns it: the row is folded into OA-900 alone' },
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
