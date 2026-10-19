#!/usr/bin/env node
/* Prove the loop is handed exactly one stale S6, in the right order, by a recipe that
 * borrows before it buys and asks the budget before it writes (s6_next.mjs, buses-data
 * 17 October 2026), and that loop_health.mjs counts that row as a tick's work.
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no placeholders:
 *
 *   node prove-red-s6-next.mjs
 *
 * WHAT IS BEING FALSIFIED. Each rule is asked of invented rows and paired with its
 * opposite, because an order that puts everything first "passes" every one-row case.
 * Then the MUTATION arm: a scratch copy of this folder, one deliberate break each in
 * s6_next.mjs or loop_health.mjs, and the case that must object. Nothing in the real
 * tree is edited, and nothing touches the disk outside the scratch folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const SK = 'C:/E/make-bus-leaflet/assets';
const place = (name, o = {}) => ({ name, dir: `C:/B/Areas/Town/Places/${name}`, town: 'Town', standalone: false, built: true, s6Stale: true, s6: 'r', s6StaleSince: '2026-10-05', ...o });
const town = (name, o = {}) => ({ name, dir: `C:/B/Areas/${name}`, built: true, s6Stale: true, s6: 'r', s6StaleSince: '2026-10-05', ...o });

/* Each case returns null when it holds, or a reason when it does not, so the
 * mutation arm can run the same case against a broken copy. */
const CASES = {
  'a delivery-pending map goes ahead of one that has waited longer': ({ s6Queue }) => {
    const q = s6Queue({ places: [place('Old', { s6StaleSince: '2026-09-01' }), place('Wanted', { s6StaleSince: '2026-10-10' })], undelivered: [{ subject: 'Wanted' }] });
    return q.map((x) => x.name).join() === 'Wanted,Old' ? null : q.map((x) => x.name).join();
  },
  'CONTROL: with no delivery waiting, the longest-waiting map goes first': ({ s6Queue }) => {
    const q = s6Queue({ places: [place('Recent', { s6StaleSince: '2026-10-10' }), place('Old', { s6StaleSince: '2026-09-01' })] });
    return q.map((x) => x.name).join() === 'Old,Recent' ? null : q.map((x) => x.name).join();
  },
  'a map never verified counts as having waited longest of all': ({ s6Queue }) => {
    const q = s6Queue({ towns: [town('Old', { s6StaleSince: '2026-08-01' }), town('Never', { s6: null, s6StaleSince: null })] });
    return q[0] && q[0].name === 'Never' ? null : q.map((x) => x.name).join();
  },
  'a verified map whose stale date cannot be read sorts last, not first': ({ s6Queue }) => {
    const q = s6Queue({ towns: [town('Unknown', { s6StaleSince: null }), town('Dated', { s6StaleSince: '2026-10-10' })] });
    return q.map((x) => x.name).join() === 'Dated,Unknown' ? null : q.map((x) => x.name).join();
  },
  'a map whose newest S6 is BLOCKED is not queued; an action owns it': ({ s6Queue }) => {
    const q = s6Queue({ towns: [town('Held', { s6v: { verdict: 'blocked' } }), town('Free', { s6v: { verdict: 'pass' } })] });
    return q.map((x) => x.name).join() === 'Free' ? null : q.map((x) => x.name).join();
  },
  'a fresh or unbuilt map is not queued': ({ s6Queue }) => {
    const q = s6Queue({ towns: [town('Fresh', { s6Stale: false }), town('Unbuilt', { built: false }), town('Owed')] });
    return q.map((x) => x.name).join() === 'Owed' ? null : q.map((x) => x.name).join();
  },
  'a delivery row that is itself BLOCKED does not jump the queue': ({ s6Queue }) => {
    const q = s6Queue({ places: [place('Old', { s6StaleSince: '2026-09-01' }), place('Wanted', { s6StaleSince: '2026-10-10' })], undelivered: [{ subject: 'Wanted', s6Blocked: 'x' }] });
    return q.map((x) => x.name).join() === 'Old,Wanted' ? null : q.map((x) => x.name).join();
  },
  'a nested place borrows its town\'s answer first, by the town\'s folder': ({ s6Queue, s6Unattended }) => {
    const u = s6Unattended(s6Queue({ places: [place('Shop')] }), { assetsDir: SK });
    const first = u && u.steps[0];
    return first && first.includes('--build "C:/B/Areas/Town" --foreign-build') && first.includes('--dry-run') ? null : first;
  },
  'CONTROL: a standalone place asks only about its own answers': ({ s6Queue, s6Unattended }) => {
    const u = s6Unattended(s6Queue({ places: [place('Alone', { standalone: true, town: null, dir: 'C:/B/Places/_standalone/Alone' })] }), { assetsDir: SK });
    const first = u && u.steps[0];
    return first && !first.includes('--foreign-build') && first.includes('--dry-run') ? null : first;
  },
  'the recipe decides by a dry run BEFORE stage.js makes a folder': ({ s6Queue, s6Unattended }) => {
    const u = s6Unattended(s6Queue({ towns: [town('T')] }), { assetsDir: SK });
    const iDry = u.steps.findIndex((x) => x.includes('--dry-run')), iNew = u.steps.findIndex((x) => x.includes('stage.js" new S6'));
    return iDry >= 0 && iNew > iDry ? null : `dry run at ${iDry}, new S6 at ${iNew}`;
  },
  'a place\'s recipe adapts its S1; a town\'s does not': ({ s6Queue, s6Unattended }) => {
    const p = s6Unattended(s6Queue({ places: [place('Shop')] }), { assetsDir: SK });
    const t = s6Unattended(s6Queue({ towns: [town('T')] }), { assetsDir: SK });
    const has = (u) => u.steps.some((x) => x.includes('place_verified_services.js'));
    return has(p) && !has(t) ? null : `place ${has(p)}, town ${has(t)}`;
  },
  'the block names one map and queues the rest for a WAIT': ({ s6Queue, s6Unattended }) => {
    const u = s6Unattended(s6Queue({ towns: [town('A', { s6StaleSince: '2026-09-01' }), town('B'), town('C', { s6StaleSince: '2026-10-09' })] }), { assetsDir: SK });
    return u && u.map === 'A' && u.queue.join() === 'B,C' ? null : JSON.stringify(u && { map: u.map, queue: u.queue });
  },
  'the block lists every queued map with the day its wait began': ({ s6Queue, s6Unattended }) => {
    const u = s6Unattended(s6Queue({ towns: [town('A', { s6StaleSince: '2026-09-01' }), town('B', { s6StaleSince: '2026-10-09' })] }), { assetsDir: SK });
    const w = u && u.waiting;
    return w && w.map((x) => `${x.name}@${x.waitingSince}`).join() === 'A@2026-09-01,B@2026-10-09' ? null : JSON.stringify(w);
  },
  'no queue, or no engine folder, is no block rather than a broken command': ({ s6Unattended }) => {
    const a = s6Unattended([], { assetsDir: SK }), b = s6Unattended([{ name: 'A', dir: 'C:/x' }], { assetsDir: null });
    return a === null && b === null ? null : `${JSON.stringify(a)} / ${JSON.stringify(b)}`;
  },
  'loop health reads an S6 row with a recipe as a tick\'s work': ({ parseBusWork, classifyBusWork }) => {
    const bw = parseBusWork(JSON.stringify({ items: [{ key: 's6-stale-places', towns: ['Shop'], unattended: { map: 'Shop' } }] }));
    const c = classifyBusWork(bw);
    return c.finishable.join() === 's6-stale-places' ? null : JSON.stringify(c.finishable);
  },
  'CONTROL: an S6 row without one is not, and is never read as a rebuild': ({ parseBusWork, classifyBusWork }) => {
    const bw = parseBusWork(JSON.stringify({ items: [{ key: 's6-stale', towns: ['T'] }] }));
    const c = classifyBusWork(bw);
    return bw.rows.length === 1 && bw.rows[0].kind === 's6' && c.finishable.length === 0 ? null : JSON.stringify({ rows: bw.rows, fin: c.finishable });
  },
};

const load = async (dir, tag) => ({
  ...(await import(pathToFileURL(path.join(dir, 's6_next.mjs')).href + `?${tag}`)),
  ...(await import(pathToFileURL(path.join(dir, 'loop_health.mjs')).href + `?${tag}`)),
});

const real = await load(HERE, 'real');
for (const [name, fn] of Object.entries(CASES)) {
  let why; try { why = fn(real); } catch (e) { why = 'threw: ' + e.message; }
  check(name, why === null, why);
}

// ---- the mutation arm ----
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 's6-next-'));
try {
  for (const n of fs.readdirSync(HERE)) if (/\.(mjs|js|json)$/.test(n)) fs.copyFileSync(path.join(HERE, n), path.join(scratch, n));
  const MUTANTS = [
    { what: 'a waiting delivery no longer jumps the queue', file: 's6_next.mjs', find: '(b.deliveryPending - a.deliveryPending)', repl: '0', must: 'a delivery-pending map goes ahead of one that has waited longer' },
    { what: 'the newest-stale map goes first', file: 's6_next.mjs', find: 'String(a.waitingSince).localeCompare(String(b.waitingSince))', repl: 'String(b.waitingSince).localeCompare(String(a.waitingSince))', must: 'CONTROL: with no delivery waiting, the longest-waiting map goes first' },
    { what: 'a never-verified map is not marked as waiting longest', file: 's6_next.mjs', find: "waitingSince: row.s6 ? (row.s6StaleSince || null) : '',", repl: 'waitingSince: row.s6StaleSince || null,', must: 'a map never verified counts as having waited longest of all' },
    { what: 'an unreadable date sorts first', file: 's6_next.mjs', find: '|| (a.waitingSince === null) - (b.waitingSince === null)       //', repl: '|| (b.waitingSince === null) - (a.waitingSince === null)       //', must: 'a verified map whose stale date cannot be read sorts last, not first' },
    { what: 'a BLOCKED map is queued', file: 's6_next.mjs', find: "const blocked = (r) => !!(r.s6v && r.s6v.verdict === 'blocked');", repl: 'const blocked = () => false;', must: 'a map whose newest S6 is BLOCKED is not queued; an action owns it' },
    { what: 'a fresh map is queued', file: 's6_next.mjs', find: 'towns.filter((t) => t.built && t.s6Stale && !blocked(t))', repl: 'towns.filter((t) => t.built && !blocked(t))', must: 'a fresh or unbuilt map is not queued' },
    { what: 'a BLOCKED delivery counts as pending', file: 's6_next.mjs', find: 'undelivered.filter((u) => u && !u.s6Blocked && u.subject)', repl: 'undelivered.filter((u) => u && u.subject)', must: 'a delivery row that is itself BLOCKED does not jump the queue' },
    { what: 'a nested place never borrows', file: 's6_next.mjs', find: "const borrow = m.parent ? ` --build \"${posix(m.parent)}\" --foreign-build` : '';", repl: "const borrow = '';", must: 'a nested place borrows its town\'s answer first, by the town\'s folder' },
    { what: 'a standalone place is given a parent', file: 's6_next.mjs', find: "kind === 'place' && !row.standalone && row.dir ?", repl: "kind === 'place' && row.dir ?", must: 'CONTROL: a standalone place asks only about its own answers' },
    { what: 'the queue is dropped from the block', file: 's6_next.mjs', find: 'queue: queue.slice(1).map((q) => q.name),', repl: 'queue: [],', must: 'the block names one map and queues the rest for a WAIT' },
    { what: 'the waiting list loses its dates', file: 's6_next.mjs', find: 'waiting: queue.map((q) => ({ name: q.name, waitingSince: q.waitingSince,', repl: 'waiting: queue.map((q) => ({ name: q.name, waitingSince: null,', must: 'the block lists every queued map with the day its wait began' },
    { what: 'a missing engine folder still makes a block', file: 's6_next.mjs', find: 'if (!assetsDir || !queue || !queue.length) return null;', repl: 'if (!queue || !queue.length) return null;', must: 'no queue, or no engine folder, is no block rather than a broken command' },
    { what: 'loop health drops the S6 rows', file: 'loop_health.mjs', find: "      else if (/^s6-stale(-places)?$/.test(r.key)) rows.push({ key: r.key, kind: 's6', towns: r.towns || [], unattended: !!r.unattended });\n", repl: '', must: 'loop health reads an S6 row with a recipe as a tick\'s work' },
    { what: 'loop health reads an S6 row as a rebuild', file: 'loop_health.mjs', find: "    else if (r.kind === 's6') { if (r.unattended) out.finishable.push(r.key); }", repl: '    else if (false) {}', must: 'CONTROL: an S6 row without one is not, and is never read as a rebuild' },
  ];
  let i = 0;
  for (const m of MUTANTS) {
    const f = path.join(scratch, m.file);
    const orig = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    if (orig.split(m.find).length !== 2) { check(`anchor for "${m.what}" appears exactly once`, false, m.file); continue; }
    fs.writeFileSync(f, orig.replace(m.find, m.repl));
    let why;
    try { why = CASES[m.must](await load(scratch, `m${i++}`)); } catch (e) { why = 'threw: ' + e.message.split('\n')[0]; }
    fs.writeFileSync(f, orig);
    check(`RED on "${m.what}" (${m.must})`, why !== null, 'the case still passed — the mutant SURVIVED');
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(bad ? `\nprove-red-s6-next: ${bad} failure(s)` : '\nprove-red-s6-next: every case held and every mutant was caught');
process.exit(bad ? 1 : 0);
