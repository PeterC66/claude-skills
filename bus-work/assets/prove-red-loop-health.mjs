#!/usr/bin/env node
/*
 * prove-red-loop-health.mjs — falsification harness for loop_health.mjs
 * (buses-data OA-554).
 *
 * TWO HALVES, BECAUSE A GREEN SUITE THAT HAS NEVER BEEN SEEN RED PROVES NOTHING.
 * Part 1 runs the assertions against the real module. Part 2 breaks the module on
 * purpose — one line at a time, in a throwaway copy beside it — and requires the
 * SAME assertions to fail for each break. A mutation that leaves the suite green
 * names an assertion that cannot go red, and fails this harness.
 *
 * The pure `analyse()` is driven with built facts so each rule is pinned on its
 * own; `gather()` and the CLI are driven over real temporary directories with a
 * real git repository, because a fake reader cannot be absent or dirty.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'loop_health.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-loop-health-'));

const NOW = new Date(2026, 9, 3, 8, 0).getTime();   // Sat 3 Oct 2026, 08:00 local
const run = (feed, hhmm, day = 3) => ({ name: `2026-10-${String(day).padStart(2, '0')}_${hhmm}-${feed}.md`, feed, at: new Date(2026, 9, day, +hhmm.slice(0, 2), +hhmm.slice(2)).getTime() });
const idleRuns = ['0215', '0315', '0415', '0515', '0615', '0715'].map((t) => run('none', t));
const act = (ref, o = {}) => ({ ref, priority: 'P2', decisionPeter: false, waitingDate: null, waitingWhy: null, selectedDate: null, ...o });
const base = (o = {}) => ({
  now: NOW, runs: idleRuns, lastRun: { name: '2026-10-03_0715-none.md', headline: 'Chose nothing.' },
  stopFile: false, lock: { present: false }, dirty: [], holdPaths: [], holds: [], drafts: 0,
  ahead: { count: 0, oldestMs: null }, actions: [act('OA-001'), act('OA-002'), act('OA-003'), act('OA-004')], commitments: [], ...o,
});
const lock = (o) => ({ present: true, name: 'buses-12', isTick: false, expired: false, overdueMin: 0, remainMin: 40, stampSuspect: false, ...o });
const has = (r, key, level) => r.findings.some((f) => f.key === key && (!level || f.level === level));

/** Every assertion, run against `m`. Returns the number that FAILED. */
async function suite(m, label, verbose) {
  let bad = 0;
  const check = (name, cond) => { if (cond) { if (verbose) console.log(`  ok  ${name}`); } else { bad++; if (verbose) console.error(`  ✗   ${name}`); } };
  const { analyse, bucketActions, parseAction, frontMatter, localDate, gather } = m;

  // 1. the buckets, and the date edge that decides whether a row is free
  const b = bucketActions([
    act('P', { priority: 'Parked' }), act('D', { decisionPeter: true }),
    act('H1', { waitingDate: '2026-10-04' }), act('H0', { waitingDate: '2026-10-03' }), act('HX', { waitingDate: '2026-10-01' }),
    act('C1', { selectedDate: '2026-10-03' }), act('C0', { selectedDate: '2026-10-02' }), act('F'),
  ], '2026-10-03');
  check('Parked is parked', b.parked.map((a) => a.ref).join() === 'P');
  check('decision: peter is Peter\'s', b.peter.map((a) => a.ref).join() === 'D');
  check('a waiting date tomorrow is still held', b.held.map((a) => a.ref).join() === 'H1');
  check('a waiting date TODAY or past is free (expired)', ['H0', 'HX'].every((r) => b.free.some((a) => a.ref === r)));
  check('a claim dated today is live', b.claimed.map((a) => a.ref).join() === 'C1');
  check('a claim dated yesterday is expired and free', ['C0', 'F'].every((r) => b.free.some((a) => a.ref === r)));
  check('Parked beats decision: peter', bucketActions([act('X', { priority: 'Parked', decisionPeter: true })], '2026-10-03').parked.length === 1);

  // 2. front matter
  const fm = parseAction('---\nref: OA-9\npriority: P1\ndecision: peter\nwaiting: 2026-10-16 Huntingdon rebuild\nselected: 2026-09-27, sched-0809, x\n---\nbody');
  check('front matter parsed', fm.ref === 'OA-9' && fm.priority === 'P1' && fm.decisionPeter && fm.waitingDate === '2026-10-16' && fm.waitingWhy === 'Huntingdon rebuild' && fm.selectedDate === '2026-09-27');
  check('a file with no front matter has no ref', parseAction('no front matter').ref === null && Object.keys(frontMatter('x')).length === 0);
  check('localDate is local', localDate(NOW) === '2026-10-03');

  // 3. blocking findings
  const clean = analyse(base({ runs: [run('bus-work', '0715')] }));
  check('a clean, working loop is CLEAR', clean.verdict === 'CLEAR' && clean.findings.length === 0);
  check('STOP blocks', analyse(base({ stopFile: true })).verdict === 'BLOCKED' && has(analyse(base({ stopFile: true })), 'stop', 'BLOCKING'));
  check('a person\'s expired lock blocks', has(analyse(base({ lock: lock({ expired: true, overdueMin: 30 }) })), 'lock-person-expired', 'BLOCKING'));
  check('a person\'s live lock is only a note', has(analyse(base({ lock: lock() })), 'lock-person', 'NOTE') && analyse(base({ lock: lock() })).verdict !== 'BLOCKED');
  check('a tick\'s expired lock is only a note (the next tick steals it)', has(analyse(base({ lock: lock({ name: 'sched-0615', isTick: true, expired: true, overdueMin: 5 }) })), 'lock-tick-expired', 'NOTE'));
  check('a suspect lock stamp is at risk', has(analyse(base({ lock: lock({ stampSuspect: true, stampWhy: 'in the future' }) })), 'lock-stamp', 'AT RISK'));
  check('a stray modified file blocks', has(analyse(base({ dirty: ['Development Docs/x.md'] })), 'tree-dirty', 'BLOCKING'));
  check('a path a live hold names is accounted for', !has(analyse(base({ dirty: ['Correspondence/CORR-001/008.md'], holdPaths: [{ path: 'Correspondence/CORR-001/008.md', ref: 'h' }] })), 'tree-dirty'));
  check('an unreadable tree is at risk, not clean', has(analyse(base({ dirty: null })), 'tree-unreadable', 'AT RISK'));

  // 4. why the loop is idle
  const blocked = analyse(base({ stopFile: true }));
  check('idle with a blocker is explained by it', has(blocked, 'idle-explained', 'NOTE'));
  check('idle with nothing free is idle-for-want-of-work', has(analyse(base({ actions: [act('A', { priority: 'Parked' })] })), 'idle-supply', 'NOTE'));
  check('idle while a P1 is free is at risk', has(analyse(base({ actions: [act('A', { priority: 'P1' }), ...base().actions] })), 'idle-with-free', 'AT RISK'));
  check('idle while only P2 is free is a note, not a fault', has(analyse(base()), 'idle-free-lower', 'NOTE') && !has(analyse(base()), 'idle-with-free'));
  check('one idle tick is not idle', !analyse(base({ runs: [run('none', '0715')] })).findings.some((f) => /^idle/.test(f.key)));
  check('a missed run is at risk', has(analyse(base({ runs: [...idleRuns.slice(0, 5), run('missed', '0715')] })), 'missed', 'AT RISK'));
  check('the last tick\'s own words are quoted', analyse(base({ actions: [act('A', { priority: 'P1' })] })).findings.find((f) => f.key === 'idle-with-free').text.includes('Chose nothing.'));

  // 5. pushes
  const hoursAgo = (h) => NOW - h * 3600000;
  check('a push waiting 6 h is at risk', has(analyse(base({ ahead: { count: 3, oldestMs: hoursAgo(6) } })), 'push-stale', 'AT RISK'));
  check('a push waiting 1 h is a note', has(analyse(base({ ahead: { count: 3, oldestMs: hoursAgo(1) } })), 'push-waiting', 'NOTE'));
  check('nothing ahead raises nothing', !analyse(base()).findings.some((f) => /^push/.test(f.key)));

  // 6. holds
  check('a hold under a week old is a note', has(analyse(base({ holds: [{ ref: 'h1', ageDays: 1 }] })), 'holds', 'NOTE'));
  check('a hold a week old is at risk', has(analyse(base({ holds: [{ ref: 'h1', ageDays: 8 }] })), 'holds', 'AT RISK'));

  // 7. supply and the look-ahead
  const lowFacts = base({ runs: [run('bus-work', '0715')], actions: [act('A'), act('B', { waitingDate: '2026-10-06' }), act('C', { waitingDate: '2026-10-07' }), act('D', { waitingDate: '2026-10-30' })] });
  const low = analyse(lowFacts);
  check('low supply warns', has(low, 'supply-low', 'AT RISK') && low.supply.free === 1);
  check('the look-ahead counts rows coming back inside the window only', low.lookahead.coming.map((c) => c.ref).join() === 'B,C');
  check('the supply path steps up on the right dates', low.lookahead.supplyPath.map((p) => p.free).join() === '1,2,3');
  check('the warning names the date supply recovers', low.findings.find((f) => f.key === 'supply-low').text.includes('2026-10-07'));
  check('supply at the threshold does not warn', !has(analyse(base({ runs: [run('bus-work', '0715')], actions: [act('A'), act('B'), act('C')] })), 'supply-low'));
  check('a held row 8 days out is outside a 7-day window', analyse(base({ actions: [act('H', { waitingDate: '2026-10-11' })] })).lookahead.coming.length === 0);
  check('--days widens the window', analyse(base({ days: 14, actions: [act('H', { waitingDate: '2026-10-11' })] })).lookahead.coming.length === 1);
  check('claims made today are reported as expiring at midnight', has(analyse(base({ actions: [act('A', { selectedDate: '2026-10-03' })] })), 'claims-midnight', 'NOTE'));
  const dated = analyse(base({ commitments: [{ id: 'c1', what: 'x', by: '2026-10-05' }, { id: 'c2', what: 'y', by: '2026-12-01' }, { id: 'c3', what: 'z', by: 'garbage' }] }));
  check('commitments inside the window are listed, others are not', dated.lookahead.dated.map((c) => c.id).join() === 'c1');

  // 8. real directories: gather() and the CLI
  const root = fs.mkdtempSync(path.join(tmp, 'buses-'));
  const oa = path.join(root, 'Development Docs', 'open-actions'); fs.mkdirSync(oa, { recursive: true });
  fs.writeFileSync(path.join(oa, 'OA-001.md'), '---\nref: OA-001\npriority: P1\nstatus: open\n---\nbody\n');
  fs.writeFileSync(path.join(oa, 'README.md'), '---\nref: NOT-AN-ACTION\n---\n');
  const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'h@x'); g('config', 'user.name', 'h'); g('config', 'commit.gpgsign', 'false');
  g('add', '-A'); g('commit', '-q', '-m', 'one');
  const facts = gather(root, { now: NOW });
  check('gather reads the action files and skips non-actions', facts.actions.length === 1 && facts.actions[0].ref === 'OA-001');
  check('gather: an absent loop/ folder is no run, no STOP, no holds, no throw', facts.runs.length === 0 && !facts.stopFile && facts.holds.length === 0 && facts.lastRun === null);
  check('gather: a clean tree is []', Array.isArray(facts.dirty) && facts.dirty.length === 0);
  fs.appendFileSync(path.join(oa, 'OA-001.md'), 'edited\n');
  check('gather: a tracked modification is seen', gather(root, { now: NOW }).dirty.join() === 'Development Docs/open-actions/OA-001.md');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'x');
  check('gather: an untracked file is not a dirty tree', gather(root, { now: NOW }).dirty.length === 1);
  fs.mkdirSync(path.join(root, 'loop', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loop', 'runs', '2026-10-03_0715-none.md'), '# Run sched-0715 — none\n\n**Chose nothing: nothing was due.**\n');
  fs.writeFileSync(path.join(root, 'loop', 'STOP'), '');
  const f2 = gather(root, { now: NOW });
  check('gather: STOP and the newest run headline are read', f2.stopFile && f2.runs.length === 1 && f2.lastRun.headline === 'Chose nothing: nothing was due.');

  const cli = (args) => spawnSync(process.execPath, [m.__file, ...args], { encoding: 'utf8' });
  const blockedRun = cli(['--buses', root]);
  check('CLI: a BLOCKING finding exits 1 and prints the verdict', blockedRun.status === 1 && /VERDICT: BLOCKED/.test(blockedRun.stdout));
  fs.rmSync(path.join(root, 'loop', 'STOP')); g('checkout', '-q', '--', '.');
  const okRun = cli(['--buses', root, '--json']);
  check('CLI: nothing blocking exits 0 and --json parses', okRun.status === 0 && JSON.parse(okRun.stdout).verdict !== 'BLOCKED');
  const notBuses = cli(['--buses', fs.mkdtempSync(path.join(tmp, 'empty-'))]);
  check('CLI: a directory that is not buses-data exits 2, never a pass', notBuses.status === 2 && /not a buses-data checkout/.test(notBuses.stderr));

  return bad;
}

async function load(file) {
  const m = await import(`file://${file.replace(/\\/g, '/')}?v=${Math.random()}`);
  return { ...m, __file: file };
}

console.log('\n1. the real module');
const real = await load(SRC);
const badReal = await suite(real, 'real', true);
let failed = badReal;
if (badReal) console.error(`\n${badReal} assertion(s) failed against the real module`);

console.log('\n2. each mutation must turn the suite red');
const source = fs.readFileSync(SRC, 'utf8');
// Each `from` must occur EXACTLY once, or the mutation is not the line it claims to be.
const MUTANTS = [
  ['STOP no longer blocks', "if (f.stopFile) {\n    add('BLOCKING'", "if (false) {\n    add('BLOCKING'"],
  ['a person\'s expired lock stops blocking', "} else if (lock.expired) {\n      add('BLOCKING'", "} else if (false) {\n      add('BLOCKING'"],
  ['a hold-named path no longer accounts for a dirty file', "const stray = f.dirty.filter((p) => !accounted.has(p.replace(/\\\\/g, '/')));", 'const stray = f.dirty;'],
  ['a waiting date TODAY stays held', 'daysBetween(today, a.waitingDate) > 0', 'daysBetween(today, a.waitingDate) >= 0'],
  ['a claim dated yesterday stays live', 'a.selectedDate === today', 'a.selectedDate <= today'],
  ['Parked rows count as free', "if (/^parked$/i.test(a.priority || '')) b.parked.push(a);\n    else if", 'if (false) b.parked.push(a);\n    else if'],
  ['idle with a free P1 is no longer at risk', "else if (urgent.length) add('AT RISK'", "else if (false) add('AT RISK'"],
  ['the free-P2 idle note becomes a fault', "add('NOTE', 'idle-free-lower'", "add('AT RISK', 'idle-free-lower'"],
  ['a stale push is no longer at risk', 'if (ageMs != null && ageMs > pushStaleMs) {', 'if (false) {'],
  ['low supply never warns', 'if (free < low) {', 'if (false) {'],
  ['the look-ahead window is ignored', 'if (d <= days) coming.push', 'if (true) coming.push'],
  ['commitments outside the window are listed', 'if (d <= days) dated.push', 'if (true) dated.push'],
  ['a missed run is no longer raised', 'if (health.ran && health.missed > 0) {', 'if (false) {'],
  ['an old hold is no longer at risk', "add(oldest >= 7 ? 'AT RISK' : 'NOTE'", "add('NOTE'"],
  ['the exit code ignores BLOCKING', "process.exitCode = r.findings.some((x) => x.level === 'BLOCKING') ? 1 : 0;", 'process.exitCode = 0;'],
  ['a non-buses directory passes', 'process.exitCode = 2;\n    return;', 'process.exitCode = 0;\n    return;'],
  ['an untracked file counts as a dirty tree', "'--porcelain', '--untracked-files=no'", "'--porcelain'"],
];
for (const [name, from, to] of MUTANTS) {
  const n = source.split(from).length - 1;
  if (n !== 1) { failed++; console.error(`  ✗   mutation "${name}": its target occurs ${n} times, not once, so it tests nothing`); continue; }
  const file = path.join(HERE, `.loop_health.mutant-${process.pid}.mjs`);
  fs.writeFileSync(file, source.replace(from, to));
  let bad = 0;
  try { bad = await suite(await load(file), name, false); } catch { bad = 1; } finally { fs.rmSync(file, { force: true }); }
  if (bad > 0) console.log(`  ok  "${name}" turns ${bad} assertion(s) red`);
  else { failed++; console.error(`  ✗   mutation "${name}" left the suite green: an assertion that cannot go red`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nFAILED (${failed})` : '\nall loop_health assertions hold, and every mutation is caught');
process.exitCode = failed ? 1 : 0;
