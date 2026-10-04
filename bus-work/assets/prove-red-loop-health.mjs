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
const named = (refs) => ({ name: 'x-none.md', refs });
const base = (o = {}) => ({
  idleNaming: [named(['OA-001']), named(['OA-001']), named(['OA-001'])],
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
  const { analyse, bucketActions, parseAction, frontMatter, localDate, gather, classifyGate, classifyBusWork, promptScripts, parseResources, parseBusWork, passedOver, render } = m;

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
  const unnamed = analyse(base({ idleNaming: [named([]), named([]), named([])] }));
  check('three idle runs that name no passed-over row, with P2 free, are at risk', has(unnamed, 'idle-unnamed', 'AT RISK') && !has(unnamed, 'idle-free-lower'));
  check('naming the rows in the last idle run is only a note, and quotes them', analyse(base({ idleNaming: [named(['OA-250', 'OA-550']), named([]), named([])] })).findings.find((f) => f.key === 'idle-free-lower').text.includes('OA-250, OA-550'));
  check('fewer than three runs since the rule cannot be blamed', has(analyse(base({ idleNaming: [named([]), named([])] })), 'idle-free-lower', 'NOTE'));
  check('a P1 free still reads as idle-with-free, not idle-unnamed', has(analyse(base({ actions: [act('A', { priority: 'P1' })], idleNaming: [named([]), named([]), named([])] })), 'idle-with-free', 'AT RISK'));
  check('one idle tick is not idle', !analyse(base({ runs: [run('none', '0715')] })).findings.some((f) => /^idle/.test(f.key)));
  check('a missed run is at risk', has(analyse(base({ runs: [...idleRuns.slice(0, 5), run('missed', '0715')] })), 'missed', 'AT RISK'));
  check('the last tick\'s own words are quoted', analyse(base({ actions: [act('A', { priority: 'P1' })] })).findings.find((f) => f.key === 'idle-with-free').text.includes('Chose nothing.'));

  // 5. pushes
  const hoursAgo = (h) => NOW - h * 3600000;
  check('a push waiting 6 h is at risk', has(analyse(base({ ahead: { count: 3, oldestMs: hoursAgo(6) } })), 'push-stale', 'AT RISK'));
  check('a push waiting 1 h is a note', has(analyse(base({ ahead: { count: 3, oldestMs: hoursAgo(1) } })), 'push-waiting', 'NOTE'));
  // engine lag (OA-485 item 3): information only, and the ceiling is read from the probe, never restated
  const lagOver = analyse(base({ engineLag: { ceiling: 45, over: [{ name: 'March', days: 80 }], unknown: 0, measured: 25, error: null } }));
  check('a map past the ceiling is a NOTE naming it and the ceiling the probe reported', has(lagOver, 'engine-lag', 'NOTE') && /March 80d/.test(lagOver.findings.find((f) => f.key === 'engine-lag').text) && /45-day/.test(lagOver.findings.find((f) => f.key === 'engine-lag').text));
  check('engine lag is never BLOCKING or AT RISK', lagOver.findings.filter((f) => /^engine-lag/.test(f.key)).every((f) => f.level === 'NOTE'));
  check('no map over the ceiling raises nothing', !has(analyse(base({ engineLag: { ceiling: 60, over: [], unknown: 0, measured: 25, error: null } })), 'engine-lag'));
  check('a map whose lag could not be read is named as unknown, not passed', has(analyse(base({ engineLag: { ceiling: 60, over: [], unknown: 2, measured: 23, error: null } })), 'engine-lag-unknown', 'NOTE'));
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

  // 7b. can a tick DO work: the gate a tick names, as a kind
  const kind = (t) => classifyGate(t);
  check('a portal-write bar is the push, and clears by itself', kind('portal-write CHECK until buses-data pushes its 6 commits').kind === 'push' && kind('needs a portal write, CHECK FIRST').clears === true);
  check('a claim naming a portal write is still the push', kind('its claim from sched-0815 is live today, and the re-vendor is a portal write').kind === 'push');
  check('a waiting date is a date and clears by itself', kind('waiting to 2026-10-08').kind === 'date' && kind('WAITING to 2026-10-16 per `--waiting`').clears === true);
  check('a live claim clears by itself', kind('selected today under a live claim').kind === 'claim');
  check('editing the loop prompt is its own kind, and does not clear', kind("item 2 edits the scheduled task's own prompt").kind === 'own-prompt' && !kind("item 2 edits the scheduled task's own prompt").clears);
  check('an ESCALATE grade is a grade', kind('Beaconsfield graded ESCALATE, due 2026-10-13').kind === 'grade');
  check('a customer trigger is a trigger and does not clear', kind("gated on OA-086's named-customer trigger").kind === 'trigger' && !kind('a named customer asking').clears);
  check('a person at a keyboard is a person', kind('wants a signed-in editor').kind === 'person' && kind('decision: peter').kind === 'person');
  check('a gate nobody recognises is other and does not clear', kind('something odd').kind === 'other' && !kind('something odd').clears);

  // 7c. the bus-work feed by the prompt's own rules
  const bw = classifyBusWork({
    grades: { Beaconsfield: 'ESCALATE', March: 'NOTHING' }, fixtures: ['St Ives'],
    rows: [
      { key: 'refresh-a', kind: 'refresh', towns: [], unattended: true }, { key: 'refresh-b', kind: 'refresh', towns: [], unattended: false },
      { key: 'engine-rebuild-Beaconsfield', kind: 'rebuild', towns: ['Beaconsfield'] }, { key: 'engine-rebuild-March', kind: 'rebuild', towns: ['March'] },
      { key: 'engine-rebuild-St Ives', kind: 'rebuild', towns: ['St Ives'] },
    ],
  });
  check('a refresh row with an unattended recipe is finishable, one without is a person\'s', bw.finishable.includes('refresh-a') && bw.person.join() === 'refresh-b');
  check('a rebuild of an ESCALATE town is a person\'s and names the town', bw.escalate.join() === 'engine-rebuild-Beaconsfield' && bw.towns.join() === 'Beaconsfield');
  check('a rebuild of an un-escalated town is finishable', bw.finishable.includes('engine-rebuild-March'));
  check('a rebuild of a fixture map is never a tick\'s', bw.fixture.join() === 'engine-rebuild-St Ives' && !bw.finishable.includes('engine-rebuild-St Ives'));
  // OA-563: a no-rebuild review for the grades' scan answers the grade for that town only
  const bwRev = classifyBusWork({
    grades: { Soham: 'ESCALATE', Huntingdon: 'ESCALATE' }, fixtures: [], reviewed: ['Soham'],
    rows: [{ key: 'engine-rebuild-Soham', kind: 'rebuild', towns: ['Soham'] }, { key: 'engine-rebuild-Huntingdon', kind: 'rebuild', towns: ['Huntingdon'] }],
  });
  check('a rebuild of an ESCALATE town with a no-rebuild review is finishable', bwRev.finishable.join() === 'engine-rebuild-Soham');
  check('a rebuild of an ESCALATE town with no review stays a person\'s', bwRev.escalate.join() === 'engine-rebuild-Huntingdon' && bwRev.towns.join() === 'Huntingdon');
  const parsedBw = parseBusWork(JSON.stringify({ items: [{ key: 'refresh-x', unattended: { cmd: 'x' } }, { key: 'refresh-y' }, { key: 'engine-rebuild-Z', towns: ['Z'] }, { key: 'corr-unsent-1' }] }), { grades: { Z: 'ESCALATE' }, fixtures: [] });
  check('parseBusWork keeps refresh and rebuild rows only, with the unattended flag', parsedBw.rows.length === 3 && parsedBw.rows[0].unattended === true && parsedBw.rows[1].unattended === false && parsedBw.rows[2].towns[0] === 'Z');
  check('parseBusWork on garbage is null, never a pass', parseBusWork('not json') === null);

  // 7d. the prompt block, the conditions JSON and the run files' passed-over lines
  const readme = '# x\n\n```bash\nnode "C:/not/in/the/prompt.mjs"\n```\n\n## The task prompt\n\n```bash\nnode "C:/also/not.mjs"\n```\n\n```\nRun node "C:/a b/c.mjs" then node "Development Docs/open-actions/assemble.mjs" and --env-file="C:/p/.env", "C:/a b/c.mjs" again, never "C:/<x>/y.mjs".\n```\n';
  check('promptScripts reads quoted paths from the prompt block only, once each, skipping placeholders', promptScripts(readme).join() === 'C:/a b/c.mjs,C:/p/.env,Development Docs/open-actions/assemble.mjs');
  check('promptScripts reads a CRLF README', promptScripts(readme.replace(/\n/g, '\r\n')).length === 3);
  check('promptScripts with no prompt heading is null, never an empty pass', promptScripts('# x\n```\nnode "C:/a.mjs"\n```\n') === null);
  check('parseResources reads the resources block and nothing else', parseResources('{"conditions":{},"resources":{"engine":{"verdict":"safe","reasons":[]}}}').engine.verdict === 'safe' && parseResources('nope') === null && parseResources('{"conditions":{}}') === null);

  const pr = fs.mkdtempSync(path.join(tmp, 'runs-'));
  const put = (n, t) => fs.writeFileSync(path.join(pr, n), t);
  put('2026-10-03_1215-none.md', 'OA-900 (passed over: before the rule)\n');
  put('2026-10-03_1415-none.md', 'OA-250 (passed over: portal-write CHECK)\nOA-237, 302, 311 (passed over: WAITING to 2026-10-16)\n`zz-a.md` (not due: starts 2026-12-02)\n');
  put('2026-10-03_1515-none.md', '`OA-250` (passed over: decision: peter)\n');
  put('2026-10-03_1615-busy.md', 'OA-777 (passed over: a busy tick said so)\n');
  put('2026-10-03_1715-OA.md', 'OA-301 and OA-302 (passed over: a live claim)\n');
  const po = passedOver(pr);
  const gateOf = (ref) => (po.rows.find((r) => r.ref === ref) || {}).gate;
  check('passedOver: the newest tick that named a row decides its gate', gateOf('OA-250') === 'decision: peter');
  check('passedOver: a line naming several rows gives each of them the gate', gateOf('OA-237') === 'WAITING to 2026-10-16' && gateOf('OA-311') === 'WAITING to 2026-10-16' && gateOf('OA-301') === 'a live claim');
  check('passedOver: a row the newest tick named wins over the older line', gateOf('OA-302') === 'a live claim');
  check('passedOver: a run before the rule\'s stamp is not read', gateOf('OA-900') === undefined);
  check('passedOver: a stood-down (busy) run is not read', gateOf('OA-777') === undefined);
  check('passedOver: the files named not due are collected, and the ticks read counted', po.notDue.join() === 'zz-a.md' && po.runs === 3);
  check('passedOver: no folder is no rows, never a throw', passedOver(path.join(tmp, 'nowhere')).rows.length === 0);

  // 7e. can a tick work: the verdict, from facts the caller gathered
  const gated = (kinds) => ({ runs: 5, notDue: [], rows: ['OA-001', 'OA-002', 'OA-003', 'OA-004'].map((ref, i) => ({ ref, gate: kinds[i % kinds.length], run: '2026-10-03_0715-none' })) });
  const person = 'decision: peter';
  const cannot = analyse(base({ passedOver: gated([person]) }));
  check('every free row gated by a person, with nothing else to take, is CANNOT and at risk', cannot.capacity.work === 'CANNOT' && has(cannot, 'no-work-available', 'AT RISK'));
  const waiting = analyse(base({ passedOver: gated([person, person, person, 'portal-write CHECK']) }));
  check('a row that clears by itself makes it WAITING, a note and not a fault', waiting.capacity.work === 'WAITING' && has(waiting, 'work-waiting', 'NOTE') && !has(waiting, 'no-work-available'));
  const open = analyse(base({ passedOver: { runs: 5, notDue: [], rows: [{ ref: 'OA-001', gate: person, run: 'x' }] } }));
  check('rows no tick has gated mean the loop CAN WORK, and are named as open, not finishable', open.capacity.work === 'CAN WORK' && has(open, 'oa-open', 'NOTE') && open.findings.find((x) => x.key === 'oa-open').text.includes('not the same as finishable'));
  const adhocOnly = analyse(base({ passedOver: gated([person]), adhoc: { ready: ['a.md', 'b.md'], notDue: ['a.md'] } }));
  check('an ad-hoc file that is not named not due is work', adhocOnly.capacity.work === 'CAN WORK' && adhocOnly.capacity.adhoc.takeable === 1);
  check('ad-hoc files all named not due are not work', analyse(base({ passedOver: gated([person]), adhoc: { ready: ['a.md'], notDue: ['a.md'] } })).capacity.work === 'CANNOT');
  const deepWork = analyse(base({ passedOver: gated([person]), busWork: { grades: {}, fixtures: [], rows: [{ key: 'engine-rebuild-March', kind: 'rebuild', towns: ['March'] }] } }));
  check('a finishable bus-work row is work even when every OA row is gated', deepWork.capacity.work === 'CAN WORK');
  const barred = analyse(base({ stopFile: true, passedOver: gated([person]) }));
  check('a BLOCKING finding makes work BARRED, and no "nothing to take" fault is added on top', barred.capacity.work === 'BARRED' && !has(barred, 'no-work-available'));
  check('nothing measured says nothing: no capacity verdict, no capacity findings', analyse(base()).capacity.work === null && analyse(base()).capacity.levers.length === 0);

  const lockReason = { need: 'loop-lock', verdict: 'delay', why: 'sched-2315 holds loop/LOCK.d, taken 2m ago' };
  const lockOnly = analyse(base({ resources: { 'buses-tree': { verdict: 'delay', reasons: [lockReason] }, engine: { verdict: 'delay', reasons: [lockReason] } }, passedOver: gated([person]) }));
  check('a resource barred only by a tick\'s own lock is a run in progress, not a finding, and not BARRED', !lockOnly.findings.some((x) => /^resource-/.test(x.key)) && lockOnly.capacity.work !== 'BARRED' && lockOnly.capacity.resources.barred.every((b) => b.lockOnly));
  const treeReal = analyse(base({ resources: { 'buses-tree': { verdict: 'check', reasons: [lockReason, { need: 'buses-tree', verdict: 'check', why: '2 uncommitted file(s) here' }] } }, passedOver: gated([person]) }));
  check('a resource barred for a real reason is at risk, and the tree makes work BARRED', has(treeReal, 'resource-buses-tree', 'AT RISK') && treeReal.capacity.work === 'BARRED');
  const pushBar = analyse(base({ ahead: { count: 4, oldestMs: NOW - 3600000 }, resources: { 'portal-write': { verdict: 'check', reasons: [{ need: 'portal-write', verdict: 'check', why: 'buses-data has 4 unpushed commit(s)' }] } } }));
  check('portal-write barred by unpushed commits is a note, with the push as a lever', has(pushBar, 'resource-portal-write', 'NOTE') && pushBar.capacity.levers.some((v) => /portal-write/.test(v.text)));

  check('a stored prompt that differs from the README is at risk', has(analyse(base({ prereq: { drift: true, scripts: [] } })), 'prompt-drift', 'AT RISK') && !has(analyse(base({ prereq: { drift: false, scripts: [] } })), 'prompt-drift'));
  check('a prompt block that cannot be found is at risk, not a pass', has(analyse(base({ prereq: { drift: false, scripts: [], unreadable: true } })), 'prompt-unreadable', 'AT RISK'));
  check('a missing worklist or assemble script BLOCKS every tick', has(analyse(base({ prereq: { drift: false, scripts: [{ path: 'C:/x/worklist.mjs', exists: false }] } })), 'script-missing', 'BLOCKING'));
  check('any other missing script is at risk, and an existing one raises nothing', has(analyse(base({ prereq: { drift: false, scripts: [{ path: 'C:/x/pr_sweep.mjs', exists: false }] } })), 'script-missing', 'AT RISK') && !has(analyse(base({ prereq: { drift: false, scripts: [{ path: 'C:/x/ok.mjs', exists: true }] } })), 'script-missing'));

  // 7f. what you can do: the levers, most rows first
  const lev = analyse(base({
    actions: [act('OA-001'), act('OA-002'), act('OA-003'), act('OA-004'), act('OA-010', { decisionPeter: true, priority: 'P2' }), act('OA-011', { decisionPeter: true, priority: 'P1' }), act('OA-012', { waitingDate: '2026-10-08' })],
    passedOver: { runs: 5, notDue: [], rows: [{ ref: 'OA-001', gate: 'waiting to 2026-10-08', run: 'x' }, { ref: 'OA-002', gate: "gated on OA-086's named-customer trigger", run: 'x' }, { ref: 'OA-003', gate: 'needs a person', run: 'x' }, { ref: 'OA-004', gate: 'a live claim', run: 'x' }] },
  })).capacity.levers;
  check('the biggest lever is first: two decision: peter rows outrank a lone trigger row', lev[0].rows === 2 && /decision: peter/.test(lev[0].text) && lev[0].refs.join() === 'OA-011,OA-010');
  check('rows that come back by themselves are last and say there is nothing to do', lev[lev.length - 1].nothing === true && lev[lev.length - 1].move === null && lev[lev.length - 1].refs.length === 2);
  const lev2 = analyse(base({
    actions: [act('OA-001'), act('OA-002'), act('OA-003'), act('OA-004'), act('OA-005'), act('OA-010', { decisionPeter: true })],
    passedOver: { runs: 5, notDue: [], rows: [{ ref: 'OA-001', gate: 'needs a person', run: 'x' }, { ref: 'OA-002', gate: 'needs a person', run: 'x' }, { ref: 'OA-003', gate: 'waiting to 2026-10-08', run: 'x' }, { ref: 'OA-004', gate: 'waiting to 2026-10-08', run: 'x' }, { ref: 'OA-005', gate: 'waiting to 2026-10-08', run: 'x' }] },
  })).capacity.levers;
  check('levers run by rows, and a bigger "nothing to do" lever still comes last', lev2.map((v) => v.rows).join() === '2,1,3' && lev2[2].nothing === true);
  check('a trigger row is told to be Parked', lev.some((v) => /Parked/.test(v.move) && v.refs.join() === 'OA-002'));
  check('an empty ad-hoc feed with nothing open is a lever', analyse(base({ passedOver: gated([person]), adhoc: { ready: [], notDue: [] } })).capacity.levers.some((v) => /ad-hoc feed is empty/.test(v.text)));
  const text = render(cannot, NOW);
  check('the report carries the work verdict and the levers', /CAN A TICK DO WORK\? CANNOT/.test(text) && /What you can do, most rows first:/.test(text));

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

  fs.mkdirSync(path.join(root, 'loop', 'adhoc', 'ready'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loop', 'adhoc', 'ready', 'zz-a.md'), 'x');
  fs.writeFileSync(path.join(root, 'loop', 'runs', '2026-10-03_1415-none.md'), '`zz-a.md` (not due: later)\nOA-001 (passed over: waiting to 2026-10-08)\n');
  const f3 = gather(root, { now: NOW });
  check('gather: the ready/ files and the passed-over lines are read', f3.adhoc.ready.join() === 'zz-a.md' && f3.adhoc.notDue.join() === 'zz-a.md' && f3.passedOver.rows[0].ref === 'OA-001');
  check('gather: no probes means no prereq and no resources, never a made-up pass', f3.prereq === undefined && f3.resources === undefined);
  const checker = path.join(root, 'Documentation', 'check-task-prompt.mjs');
  fs.mkdirSync(path.dirname(checker), { recursive: true });
  fs.writeFileSync(path.join(root, 'loop', 'README.md'), `## The task prompt\n\n\`\`\`\nnode "${path.join(root, 'gone.mjs').replace(/\\/g, '/')}"\n\`\`\`\n`);
  check('gather: with no checker the drift is unknown, not clean', gather(root, { now: NOW, probes: { prereq: true } }).prereq.drift === null);
  fs.writeFileSync(checker, 'process.exit(1);\n');
  const f4 = gather(root, { now: NOW, probes: { prereq: true } });
  check('gather: a checker that exits 1 is drift, and a named file that is not there is missing', f4.prereq.drift === true && f4.prereq.scripts.some((s) => /gone\.mjs$/.test(s.path) && !s.exists) && f4.prereq.scripts.some((s) => /worklist\.mjs$/.test(s.path) && s.exists));
  fs.writeFileSync(checker, 'process.exit(0);\n');
  check('gather: a checker that exits 0 is no drift', gather(root, { now: NOW, probes: { prereq: true } }).prereq.drift === false);
  fs.rmSync(path.join(root, 'loop', 'README.md'));
  check('gather: no README prompt block is reported unreadable', gather(root, { now: NOW, probes: { prereq: true } }).prereq.unreadable === true);

  const cli = (args) => spawnSync(process.execPath, [m.__file, ...args, '--no-probes'], { encoding: 'utf8' });
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
  ['the unnamed-idle fault needs no three runs', 'f.idleNaming.length >= IDLE_NAMING_RUNS', 'f.idleNaming.length >= 0'],
  ['the unnamed-idle fault fires when any run names a row', 'f.idleNaming.every((n) => !n.refs.length)', 'f.idleNaming.some((n) => !n.refs.length)'],
  ['the free-P2 idle note becomes a fault', "add('NOTE', 'idle-free-lower'", "add('AT RISK', 'idle-free-lower'"],
  ['a stale push is no longer at risk', 'if (ageMs != null && ageMs > pushStaleMs) {', 'if (false) {'],
  ['low supply never warns', 'if (free < low) {', 'if (false) {'],
  ['the look-ahead window is ignored', 'if (d <= days) coming.push', 'if (true) coming.push'],
  ['commitments outside the window are listed', 'if (d <= days) dated.push', 'if (true) dated.push'],
  ['engine lag is never raised', "if (el.over.length) add('NOTE', 'engine-lag'", "if (false) add('NOTE', 'engine-lag'"],
  ['unknown lag is passed in silence', 'if (el.unknown) add(', 'if (false) add('],
  ['the ceiling is restated, not read', 'past the ${el.ceiling}-day engine-lag ceiling', 'past the 60-day engine-lag ceiling'],
  ['engine lag becomes a stop', "add('NOTE', 'engine-lag', ", "add('BLOCKING', 'engine-lag', "],
  ['a missed run is no longer raised', 'if (health.ran && health.missed > 0) {', 'if (false) {'],
  ['an old hold is no longer at risk', "add(oldest >= 7 ? 'AT RISK' : 'NOTE'", "add('NOTE'"],
  ['the exit code ignores BLOCKING', "process.exitCode = r.findings.some((x) => x.level === 'BLOCKING') ? 1 : 0;", 'process.exitCode = 0;'],
  ['a non-buses directory passes', 'process.exitCode = 2;\n    return;', 'process.exitCode = 0;\n    return;'],
  ['an untracked file counts as a dirty tree', "'--porcelain', '--untracked-files=no'", "'--porcelain'"],
  // can a tick do work
  ['the push gate stops clearing by itself', "{ kind: 'push', clears: true,", "{ kind: 'push', clears: false,"],
  ['a waiting date stops clearing by itself', "{ kind: 'date', clears: true,", "{ kind: 'date', clears: false,"],
  ['editing the prompt reads as a claim', "{ kind: 'own-prompt', clears: false, re: /own prompt|scheduled task/i }", "{ kind: 'own-prompt', clears: true, re: /own prompt|scheduled task/i }"],
  ['an unattended refresh row is no longer finishable', '(r.unattended ? out.finishable : out.person).push(r.key)', '(r.unattended ? out.person : out.finishable).push(r.key)'],
  ['an ESCALATE rebuild is finishable', 'else if (esc.length) {', 'else if (false) {'],
  ['a fixture rebuild is finishable', 'if (fixtures.has(name)) out.fixture.push(r.key);', 'if (false) out.fixture.push(r.key);'],
  ['the prompt block is found without its heading', "lastIndexOf('## The task prompt')", "lastIndexOf('## Nope')"],
  ['placeholders are read as scripts', '[^"<>]+?\\.(?:mjs|js|py|env))"', '[^"]+?\\.(?:mjs|js|py|env))"'],
  ['the oldest tick decides a row\'s gate', 'if (!seen.has(ref)) seen.set(ref,', 'seen.set(ref,'],
  ['a line naming several rows gates only the last', 'for (const num of m[1].match(/\\d+/g)) {', 'for (const num of [m[1].match(/\\d+/g).pop()]) {'],
  ['runs before the rule are read', 'x.slice(0, 15) >= RULE_FROM).sort().reverse().slice(0, n);\n    const seen', 'true).sort().reverse().slice(0, n);\n    const seen'],
  ['stood-down runs are read', '(?!busy|missed)', ''],
  ['no work is never raised', "if (cap.work === 'CANNOT') {", 'if (false) {'],
  ['time-gated rows read as CANNOT, not WAITING', "(cap.oa && cap.oa.clearing) ? 'WAITING'", "false ? 'WAITING'"],
  ['a BLOCKING finding no longer bars work', "const blocking = treeBarred || findings.some((x) => x.level === 'BLOCKING');", 'const blocking = false;'],
  ['ad-hoc files named not due count as work', 'takeable: ready.length - notDue.length', 'takeable: ready.length'],
  ['prompt drift is not raised', "if (p.drift === true) add(", "if (false) add("],
  ['a missing worklist no longer blocks', "add(critical ? 'BLOCKING' : 'AT RISK', 'script-missing'", "add('AT RISK', 'script-missing'"],
  ['a lock-only resource is reported as a finding', 'if (b.lockOnly) continue;', ''],
  ['a real tree bar no longer bars work', "if (b.name === 'buses-tree') treeBarred = true;", ''],
  ['the decision: peter lever is dropped', 'if (peter.length) lever(', 'if (false) lever('],
  ['levers are not ranked by rows', '(a.nothing - b.nothing) || (b.rows - a.rows)', '0'],
  ['a checker exit of 1 is no longer drift', 'drift.status === 1 ? true :', 'drift.status === 99 ? true :'],
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
