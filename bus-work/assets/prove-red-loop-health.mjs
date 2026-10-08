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
const act = (ref, o = {}) => ({ ref, priority: 'P2', decisionPeter: false, waitingDate: null, waitingWhy: null, ...o });
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
  const { analyse, bucketActions, parseAction, frontMatter, localDate, gather, classifyBusWork, promptScripts, parseResources, parseBusWork, passedOver, render } = m;

  // 1. the buckets, and the date edge that decides whether a row is free
  const b = bucketActions([
    act('P', { priority: 'Parked' }), act('D', { decisionPeter: true }),
    act('H1', { waitingDate: '2026-10-04' }), act('H0', { waitingDate: '2026-10-03' }), act('HX', { waitingDate: '2026-10-01' }),
    act('F'),
  ], '2026-10-03');
  check('Parked is parked', b.parked.map((a) => a.ref).join() === 'P');
  check('decision: peter is Peter\'s', b.peter.map((a) => a.ref).join() === 'D');
  check('a waiting date tomorrow is still held', b.held.map((a) => a.ref).join() === 'H1');
  check('a waiting date TODAY or past is free (expired)', ['H0', 'HX'].every((r) => b.free.some((a) => a.ref === r)));
  check('a row with no marker is free', b.free.some((a) => a.ref === 'F'));
  check('Parked beats decision: peter', bucketActions([act('X', { priority: 'Parked', decisionPeter: true })], '2026-10-03').parked.length === 1);

  // 2. front matter
  const fm = parseAction('---\nref: OA-9\npriority: P1\ndecision: peter\nwaiting: 2026-10-16 Huntingdon rebuild\nselected: 2026-09-27, sched-0809, x\n---\nbody');
  check('front matter parsed', fm.ref === 'OA-9' && fm.priority === 'P1' && fm.decisionPeter && fm.waitingDate === '2026-10-16' && fm.waitingWhy === 'Huntingdon rebuild');
  // OA-578: claims are retired, so a leftover `selected:` line is read as nothing and holds no row.
  check('a selected: line holds no row (claims retired, OA-578)', !('selectedDate' in fm) && bucketActions([parseAction('---\nref: OA-8\nselected: 2026-10-03, s, x\n---\n')], '2026-10-03').free.length === 1);
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
  check('a path a live hold names is accounted for', !has(analyse(base({ dirty: ['Development Docs/x.md'], holdPaths: [{ path: 'Development Docs/x.md', ref: 'h' }] })), 'tree-dirty'));
  const tickLock = { present: true, isTick: true, expired: false, name: 'sched-2014', remainMin: 80 };
  const own560 = analyse(base({ lock: tickLock, dirty: ['Development Docs/open-actions.md', 'Development Docs/open-actions/OA-560.md'] }));
  check('a live tick\'s own backlog edits are a note, not a block', !has(own560, 'tree-dirty') && has(own560, 'tree-tick-own', 'NOTE') && own560.level !== 'BLOCKED');
  check('a live tick does not excuse any other modified file', has(analyse(base({ lock: tickLock, dirty: ['Development Docs/open-actions/OA-560.md', 'Development Docs/x.md'] })), 'tree-dirty', 'BLOCKING'));
  check('backlog edits are still a block when no tick holds a live lock', has(analyse(base({ dirty: ['Development Docs/open-actions/OA-560.md'] })), 'tree-dirty', 'BLOCKING') && has(analyse(base({ lock: { ...tickLock, expired: true, overdueMin: 5 }, dirty: ['Development Docs/open-actions/OA-560.md'] })), 'tree-dirty', 'BLOCKING'));
  const fz = analyse(base({ dirty: ['Correspondence/CORR-003/013-x.md'] }));
  check('dirt fenced inside one letter folder is a note, not a block', !has(fz, 'tree-dirty') && has(fz, 'tree-fenced', 'NOTE') && fz.level !== 'BLOCKED');
  check('fenced dirt inside a map folder is a note too', has(analyse(base({ dirty: ['Areas/Wisbech/config.json'] })), 'tree-fenced', 'NOTE'));
  check('a STAGED path in a fenced folder still blocks', has(analyse(base({ dirty: ['Correspondence/CORR-003/013-x.md'], staged: ['Correspondence/CORR-003/013-x.md'] })), 'tree-dirty', 'BLOCKING'));
  check('ci-reference dirt is never fenced', has(analyse(base({ dirty: ['Areas/Wisbech/ci-reference/a.svg'] })), 'tree-dirty', 'BLOCKING'));
  check('a bare file under a root is never fenced', has(analyse(base({ dirty: ['Correspondence/README.md'] })), 'tree-dirty', 'BLOCKING'));
  check('fenced dirt does not excuse an unfenced file beside it', has(analyse(base({ dirty: ['Correspondence/CORR-003/013-x.md', 'Development Docs/x.md'] })), 'tree-dirty', 'BLOCKING'));
  check('an unreadable tree is at risk, not clean', has(analyse(base({ dirty: null })), 'tree-unreadable', 'AT RISK'));

  // 4. why the loop is idle
  const blocked = analyse(base({ stopFile: true }));
  check('idle with a blocker is explained by it', has(blocked, 'idle-explained', 'NOTE'));
  check('stopped ticks with a person\'s live lock are explained by it', has(analyse(base({ lock: lock() })), 'idle-explained', 'NOTE') && !has(analyse(base({ lock: lock() })), 'idle-stopped'));
  check('stopped ticks with nothing to explain them are at risk', has(analyse(base()), 'idle-stopped', 'AT RISK'));
  check('the backlog plays no part: no free rows changes nothing', has(analyse(base({ actions: [] })), 'idle-stopped', 'AT RISK'));
  const dispatchedIdle = analyse(base({ runs: ['0215', '0315', '0415', '0515', '0615', '0715'].map((t) => run('idle', t)) }));
  check('ticks that dispatched and found nothing (-idle) raise no idle finding', !dispatchedIdle.findings.some((f) => /^idle/.test(f.key)));
  check('one idle tick is not idle', !analyse(base({ runs: [run('none', '0715')] })).findings.some((f) => /^idle/.test(f.key)));
  check('a missed run is at risk', has(analyse(base({ runs: [...idleRuns.slice(0, 5), run('missed', '0715')] })), 'missed', 'AT RISK'));
  check('the last tick\'s own words are quoted', analyse(base()).findings.find((f) => f.key === 'idle-stopped').text.includes('Chose nothing.'));

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
  check('a small backlog is not a loop fault (OA-576)', !low.findings.some((f) => /^supply/.test(f.key)) && low.supply.free === 1);
  check('the look-ahead counts rows coming back inside the window only', low.lookahead.coming.map((c) => c.ref).join() === 'B,C');
  check('the supply path steps up on the right dates', low.lookahead.supplyPath.map((p) => p.free).join() === '1,2,3');
  check('a held row 8 days out is outside a 7-day window', analyse(base({ actions: [act('H', { waitingDate: '2026-10-11' })] })).lookahead.coming.length === 0);
  check('--days widens the window', analyse(base({ days: 14, actions: [act('H', { waitingDate: '2026-10-11' })] })).lookahead.coming.length === 1);
  const dated = analyse(base({ commitments: [{ id: 'c1', what: 'x', by: '2026-10-05' }, { id: 'c2', what: 'y', by: '2026-12-01' }, { id: 'c3', what: 'z', by: 'garbage' }] }));
  check('commitments inside the window are listed, others are not', dated.lookahead.dated.map((c) => c.id).join() === 'c1');

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
  // OA-610: a bus tick takes no ad-hoc file, so its `(not due: ...)` lines are no longer collected here.
  check('passedOver: the ticks read are counted, and no ad-hoc not-due list is returned', po.runs === 3 && !('notDue' in po));
  check('passedOver: no folder is no rows, never a throw', passedOver(path.join(tmp, 'nowhere')).rows.length === 0);

  // 7e. can a tick work: the verdict, from facts the caller gathered
  const noRows = { grades: {}, fixtures: [], rows: [] };
  const nothing = analyse(base({ busWork: noRows }));
  check('nothing to take is NOTHING TO DO, a note and never a fault', nothing.capacity.work === 'NOTHING TO DO' && has(nothing, 'no-work', 'NOTE') && !nothing.findings.some((x) => x.key === 'no-work' && x.level !== 'NOTE'));
  check('the OA feed is not measured at all', !('oa' in nothing.capacity));
  // OA-610: the ad-hoc queue has its own loop, so a ready/ file is no tick's work, even if a caller passes one in.
  const adhocOnly = analyse(base({ busWork: noRows, adhoc: { ready: ['a.md', 'b.md'], notDue: [] } }));
  check('an ad-hoc file is not a tick\'s work: the bus loop has no ad-hoc feed', adhocOnly.capacity.work === 'NOTHING TO DO' && !('adhoc' in adhocOnly.capacity));
  check('the nothing-to-do note says where ad-hoc work went', nothing.findings.some((x) => x.key === 'no-work' && /adhoc\/ready\//.test(x.text) && !/loop\/adhoc/.test(x.text)));
  const deepWork = analyse(base({ busWork: { grades: {}, fixtures: [], rows: [{ key: 'engine-rebuild-March', kind: 'rebuild', towns: ['March'] }] } }));
  check('a finishable bus-work row is work', deepWork.capacity.work === 'CAN WORK');
  check('a bus-work feed with nothing finishable is nothing to do', analyse(base({ busWork: { grades: {}, fixtures: [], rows: [] } })).capacity.work === 'NOTHING TO DO');
  const barred = analyse(base({ stopFile: true }));
  check('a BLOCKING finding makes work BARRED even without --deep', barred.capacity.work === 'BARRED');
  const barredDeep = analyse(base({ stopFile: true, busWork: noRows }));
  check('a BLOCKING finding makes work BARRED, and no "nothing to take" note is added on top', barredDeep.capacity.work === 'BARRED' && !has(barredDeep, 'no-work'));
  check('nothing measured says nothing: no capacity verdict, no capacity findings', analyse(base()).capacity.work === null && analyse(base()).capacity.levers.length === 0);

  const lockReason = { need: 'loop-lock', verdict: 'delay', why: 'sched-2315 holds loop/LOCK.d, taken 2m ago' };
  const lockOnly = analyse(base({ resources: { 'buses-tree': { verdict: 'delay', reasons: [lockReason] }, engine: { verdict: 'delay', reasons: [lockReason] } } }));
  check('a resource barred only by a tick\'s own lock is a run in progress, not a finding, and not BARRED', !lockOnly.findings.some((x) => /^resource-/.test(x.key)) && lockOnly.capacity.work !== 'BARRED' && lockOnly.capacity.resources.barred.every((b) => b.lockOnly));
  const treeReal = analyse(base({ resources: { 'buses-tree': { verdict: 'check', reasons: [lockReason, { need: 'buses-tree', verdict: 'check', why: '2 uncommitted file(s) here' }] } } }));
  check('a resource barred for a real reason is at risk, and the tree makes work BARRED', has(treeReal, 'resource-buses-tree', 'AT RISK') && treeReal.capacity.work === 'BARRED');
  const pushBar = analyse(base({ ahead: { count: 4, oldestMs: NOW - 3600000 }, resources: { 'portal-write': { verdict: 'check', reasons: [{ need: 'portal-write', verdict: 'check', why: 'buses-data has 4 unpushed commit(s)' }] } } }));
  check('portal-write barred by unpushed commits is a note, with the push as a lever', has(pushBar, 'resource-portal-write', 'NOTE') && pushBar.capacity.levers.some((v) => /portal-write/.test(v.text)));

  check('a stored prompt that differs from the README is at risk', has(analyse(base({ prereq: { drift: true, scripts: [] } })), 'prompt-drift', 'AT RISK') && !has(analyse(base({ prereq: { drift: false, scripts: [] } })), 'prompt-drift'));
  check('a prompt block that cannot be found is at risk, not a pass', has(analyse(base({ prereq: { drift: false, scripts: [], unreadable: true } })), 'prompt-unreadable', 'AT RISK'));
  check('a missing worklist or assemble script BLOCKS every tick', has(analyse(base({ prereq: { drift: false, scripts: [{ path: 'C:/x/worklist.mjs', exists: false }] } })), 'script-missing', 'BLOCKING'));
  check('any other missing script is at risk, and an existing one raises nothing', has(analyse(base({ prereq: { drift: false, scripts: [{ path: 'C:/x/pr_sweep.mjs', exists: false }] } })), 'script-missing', 'AT RISK') && !has(analyse(base({ prereq: { drift: false, scripts: [{ path: 'C:/x/ok.mjs', exists: true }] } })), 'script-missing'));

  // 7f. what you can do: the levers, most rows first
  const lev = analyse(base({
    holds: [{ ref: 'h1', ageDays: 1 }, { ref: 'h2', ageDays: 2 }],
    busWork: { grades: { Beaconsfield: 'ESCALATE' }, fixtures: [], rows: [{ key: 'engine-rebuild-Beaconsfield', kind: 'rebuild', towns: ['Beaconsfield'] }] },
  })).capacity.levers;
  check('the biggest lever is first: two holds outrank one ESCALATE row', lev[0].rows === 2 && /hold/.test(lev[0].text) && /ESCALATE/.test(lev[1].text));
  check('no lever is about the ad-hoc queue, which is another loop\'s since OA-610', !lev.some((v) => /ad-hoc|adhoc/i.test(`${v.text} ${v.move}`)));
  check('no lever is about open actions', !lev.some((v) => /decision: peter|Parked|\/oa /.test(`${v.text} ${v.move}`)));
  // OA-610: with the ad-hoc lever gone, a lever has to come from somewhere, so this case carries a hold.
  const text = render(analyse(base({ busWork: noRows, holds: [{ ref: 'h1', ageDays: 1 }] })), NOW);
  check('the report carries the work verdict and the levers', /CAN A TICK DO WORK\? NOTHING TO DO/.test(text) && /What you can do, most rows first:/.test(text));
  check('the report calls the backlog what it is, not the loop\'s supply', /Backlog \(not the loop's feed/.test(text) && !/free to take/.test(text));

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

  // OA-610: a file in either ad-hoc ready/ folder, the old or the new, is not gathered as bus-loop work.
  for (const d of [['loop', 'adhoc', 'ready'], ['adhoc', 'ready']]) { fs.mkdirSync(path.join(root, ...d), { recursive: true }); fs.writeFileSync(path.join(root, ...d, 'zz-a.md'), 'x'); }
  fs.writeFileSync(path.join(root, 'loop', 'runs', '2026-10-03_1415-none.md'), '`zz-a.md` (not due: later)\nOA-001 (passed over: waiting to 2026-10-08)\n');
  const f3 = gather(root, { now: NOW });
  check('gather: the passed-over lines are read, and no ad-hoc feed is gathered', !('adhoc' in f3) && f3.passedOver.rows[0].ref === 'OA-001');
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
  ['a hold-named path no longer accounts for a dirty file', "const dirtyAll = f.dirty.filter((p) => !accounted.has(p.replace(/\\\\/g, '/')));", 'const dirtyAll = f.dirty;'],
  ['a live tick\'s own backlog edit blocks again', "const tickOwn = !!(lock.present && lock.isTick && !lock.expired);", 'const tickOwn = false;'],
  ['any file a tick lock is held reads as the tick\'s own', "const own = tickOwn ? dirtyAll.filter((p) => /^Development Docs\\/open-actions(\\.md$|\\/)/.test(p.replace(/\\\\/g, '/'))) : [];", 'const own = tickOwn ? dirtyAll : [];'],
  ['fenced dirt blocks again', "fenceOf(p.replace(/\\\\/g, '/')));", "false);"],
  ['a staged path in a fenced folder is fenced', "!staged.has(p.replace(/\\\\/g, '/')) && fenceOf", "fenceOf"],
  ['a waiting date TODAY stays held', 'daysBetween(today, a.waitingDate) > 0', 'daysBetween(today, a.waitingDate) >= 0'],
  ['Parked rows count as free', "if (/^parked$/i.test(a.priority || '')) b.parked.push(a);\n    else if", 'if (false) b.parked.push(a);\n    else if'],
  ['unexplained stopped ticks are no longer at risk', "else add('AT RISK', 'idle-stopped'", "else add('NOTE', 'idle-stopped'"],
  ['a person\'s lock no longer explains stopped ticks', "else if (lock.present && !lock.isTick) add('NOTE', 'idle-explained'", "else if (false) add('NOTE', 'idle-explained'"],
  ['a stale push is no longer at risk', 'if (ageMs != null && ageMs > pushStaleMs) {', 'if (false) {'],
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
  ['an unattended refresh row is no longer finishable', '(r.unattended ? out.finishable : out.person).push(r.key)', '(r.unattended ? out.person : out.finishable).push(r.key)'],
  ['an ESCALATE rebuild is finishable', 'else if (esc.length) {', 'else if (false) {'],
  ['a fixture rebuild is finishable', 'if (fixtures.has(name)) out.fixture.push(r.key);', 'if (false) out.fixture.push(r.key);'],
  ['the prompt block is found without its heading', "lastIndexOf('## The task prompt')", "lastIndexOf('## Nope')"],
  ['placeholders are read as scripts', '[^"<>]+?\\.(?:mjs|js|py|env))"', '[^"]+?\\.(?:mjs|js|py|env))"'],
  ['the oldest tick decides a row\'s gate', 'if (!seen.has(ref)) seen.set(ref,', 'seen.set(ref,'],
  ['a line naming several rows gates only the last', 'for (const num of m[1].match(/\\d+/g)) {', 'for (const num of [m[1].match(/\\d+/g).pop()]) {'],
  ['runs before the rule are read', 'x.slice(0, 15) >= RULE_FROM).sort().reverse().slice(0, n);\n    const seen', 'true).sort().reverse().slice(0, n);\n    const seen'],
  ['stood-down runs are read', '(?!busy|missed)', ''],
  ['nothing to do is never said', "if (cap.work === 'NOTHING TO DO') {", 'if (false) {'],
  ['nothing to do becomes a fault', "add('NOTE', 'no-work',", "add('AT RISK', 'no-work',"],
  ['finishable bus-work is not work', "cap.busWork.finishable.length ? 'CAN WORK'", "false ? 'CAN WORK'"],
  ['a bar needs --deep to be reported', "if (blocking) cap.work = 'BARRED';", "if (blocking && cap.busWork) cap.work = 'BARRED';"],
  ['a BLOCKING finding no longer bars work', "const blocking = treeBarred || findings.some((x) => x.level === 'BLOCKING');", 'const blocking = false;'],
  ['prompt drift is not raised', "if (p.drift === true) add(", "if (false) add("],
  ['a missing worklist no longer blocks', "add(critical ? 'BLOCKING' : 'AT RISK', 'script-missing'", "add('AT RISK', 'script-missing'"],
  ['a lock-only resource is reported as a finding', 'if (b.lockOnly) continue;', ''],
  ['a real tree bar no longer bars work', "if (b.name === 'buses-tree') treeBarred = true;", ''],
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
