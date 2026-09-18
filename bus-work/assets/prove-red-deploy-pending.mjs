#!/usr/bin/env node
/* Prove the deploy-pending source can raise a row AND stay quiet (buses-data
 * OA-396, 2026-09-17).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-deploy-pending.mjs
 *
 * Written to the same shape as prove-red-commitments.mjs: each case is a pair,
 * because appearing is only half of it. A row that never fires is the failure
 * this source exists to prevent — the board stopped reddening on a pending
 * deploy the day this was written, so if this row does not fire nothing
 * chases a forgotten deploy at all. A row that never STOPS is the failure it
 * could introduce, and a row that nags about a site that is current is muted
 * inside a week, and then so is every row beside it.
 *
 * No portal, no site, no git: readDeployState() takes both edges as arguments,
 * so every verdict here is driven by stubs, and the one case that hands it a
 * real directory hands it one that does not exist and asserts the network was
 * never asked. The clock is injected too, so the grace cases are exact rather
 * than "run this before midnight".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeployState, deployPendingItems, DEFAULT_GRACE_HOURS } from './deploy_pending.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

const HOUR = 3600;
const NOW_S = 1_800_000_000;            // a fixed clock, seconds
const NOW = NOW_S * 1000;               // and in milliseconds, as the source takes it

/* A git stub keyed on the argv the source actually issues, so a wrong question
 * returns null rather than something plausible. */
function gitStub({ mainShort = 'abc1234', mainFull = 'abc1234deadbeef', resolves = true, backlog = [] }) {
  const calls = [];
  const git = (dir, argv) => {
    calls.push(argv.join(' '));
    const a = argv.join(' ');
    if (a === 'rev-parse --verify --quiet origin/main') return mainFull;
    if (a === 'rev-parse origin/main') return mainFull;
    if (a === 'rev-parse --short origin/main') return mainShort;
    if (/^rev-parse --verify --quiet \S+\^\{commit\}$/.test(a)) return resolves ? 'resolved' : null;
    if (/^log --format=%ct \S+\.\.origin\/main$/.test(a)) return backlog.map(String).join('\n');
    return null;
  };
  return { git, calls };
}
const liveStub = (version) => async () => ({ ok: true, version });
/* fileURLToPath, not new URL(...).pathname: this tree lives under
 * "C:\u3a St Ives\.claude\..." and the latter percent-encodes the space, so
 * existsSync() said no and every case read `no-portal` on the first run. */
const HERE_EXISTS = path.dirname(fileURLToPath(import.meta.url));   // this folder, which exists

console.log('\n1. Nothing to do: live IS main');
{
  const { git, calls } = gitStub({});
  const st = await readDeployState({ portalDir: HERE_EXISTS, git, liveVersion: liveStub('0.10.0-pilot+abc1234') });
  check('state is current', st.status === 'current', st.status);
  check('the backlog was never asked for', !calls.some((c) => c.startsWith('log ')), calls.join(' | '));
  const r = deployPendingItems(st, { now: NOW });
  check('no row, no warning', r.items.length === 0 && r.warnings.length === 0, JSON.stringify(r));
}

console.log('\n2. THE ROW: main is ahead of live, and the oldest undeployed commit is past the grace');
{
  const { git } = gitStub({ backlog: [NOW_S - 1 * HOUR, NOW_S - 40 * HOUR] });   // newest first, as git prints
  const st = await readDeployState({ portalDir: HERE_EXISTS, git, liveVersion: liveStub('0.10.0-pilot+0ldsha1') });
  check('state is behind with two commits', st.status === 'behind' && st.commitTimes.length === 2, JSON.stringify(st));
  const r = deployPendingItems(st, { now: NOW, portalDir: 'C:/portal' });
  const row = r.items[0] || { do: [{}] };   // a missing row fails the checks below rather than throwing past them
  check('exactly one row, key deploy-pending', r.items.length === 1 && row.key === 'deploy-pending', JSON.stringify(r.items.map((i) => i.key)));
  check('rank 5 — past the grace', row.rank === 5, String(row.rank));
  check('dated from the OLDEST commit, not the tip (40h, not 1h)', /oldest 40h/.test(row.title || ''), row.title);
  check('the step is a deploy from the portal checkout', row.do[0].kind === 'shell' && row.do[0].cmd === 'npm run deploy' && row.do[0].cwd === 'C:/portal', JSON.stringify(row.do[0]));
  check('and the why says it is a chore the board no longer reddens on', /chore, not a fault/.test(row.why || ''), row.why);
}

console.log('\n3. Inside the grace the row exists but ranks low, and at the boundary it moves');
{
  const st = { status: 'behind', main: 'abc1234', deployed: '0ldsha1', ref: 'origin/main', commitTimes: [NOW_S - 2 * HOUR] };
  const rankOf = (res) => (res.items[0] ? res.items[0].rank : '(no row)');
  const r = deployPendingItems(st, { now: NOW });
  check('2h old: rank 8', r.items.length === 1 && rankOf(r) === 8, JSON.stringify(r.items.map((i) => i.rank)));
  const edge = deployPendingItems({ ...st, commitTimes: [NOW_S - DEFAULT_GRACE_HOURS * HOUR] }, { now: NOW });
  check(`exactly ${DEFAULT_GRACE_HOURS}h old: rank 5 (the grace is inclusive, like the board's)`, rankOf(edge) === 5, String(rankOf(edge)));
  const custom = deployPendingItems(st, { now: NOW, graceHours: 1 });
  check('a 1h grace moves the same 2h backlog to rank 5', rankOf(custom) === 5, String(rankOf(custom)));
}

console.log('\n4. THE PAIR: the same state, deployed — the row is gone');
{
  const { git } = gitStub({ backlog: [NOW_S - 40 * HOUR] });
  const before = deployPendingItems(await readDeployState({ portalDir: HERE_EXISTS, git, liveVersion: liveStub('x+0ldsha1') }), { now: NOW });
  const after = deployPendingItems(await readDeployState({ portalDir: HERE_EXISTS, git, liveVersion: liveStub('x+abc1234') }), { now: NOW });
  check('row before, none after', before.items.length === 1 && after.items.length === 0, `${before.items.length} -> ${after.items.length}`);
}

console.log('\n5. Not this row\'s business, and each says so as a WARNING rather than a guess');
{
  const unreachable = deployPendingItems(await readDeployState({ portalDir: HERE_EXISTS, git: gitStub({}).git, liveVersion: async () => ({ ok: false, why: 'ECONNREFUSED' }) }), { now: NOW });
  check('unreachable: no row, one warning naming the uptime monitor', unreachable.items.length === 0 && unreachable.warnings.length === 1 && /uptime monitor/.test(unreachable.warnings[0]), JSON.stringify(unreachable));
  const noHeader = deployPendingItems(await readDeployState({ portalDir: HERE_EXISTS, git: gitStub({}).git, liveVersion: liveStub(null) }), { now: NOW });
  check('no header: no row, one warning', noHeader.items.length === 0 && noHeader.warnings.length === 1 && /predates/.test(noHeader.warnings[0]), JSON.stringify(noHeader));
  const { git } = gitStub({ resolves: false });
  const unres = deployPendingItems(await readDeployState({ portalDir: HERE_EXISTS, git, liveVersion: liveStub('x+n0where') }), { now: NOW });
  check('a live sha this checkout cannot resolve: no row, and the warning names the BOARD\'s red', unres.items.length === 0 && unres.warnings.length === 1 && /remaining RED/.test(unres.warnings[0]), JSON.stringify(unres));
  const ahead = gitStub({ backlog: [] });
  const la = await readDeployState({ portalDir: HERE_EXISTS, git: ahead.git, liveVersion: liveStub('x+n3wer00') });
  check('live ahead of main: state says so and nothing is raised', la.status === 'live ahead' && deployPendingItems(la, { now: NOW }).items.length === 0, JSON.stringify(la));
}

console.log('\n6. No portal checkout: nothing is asked of the network at all');
{
  let asked = 0;
  const st = await readDeployState({ portalDir: 'C:/definitely/not/a/checkout', git: gitStub({}).git, liveVersion: async () => { asked++; return { ok: true, version: 'x+abc1234' }; } });
  check('state is no-portal', st.status === 'no-portal', st.status);
  check('the site was never asked', asked === 0, String(asked));
  check('and the row is silent, with no warning — a harness tree is not an estate', deployPendingItems(st, { now: NOW }).items.length === 0 && deployPendingItems(st, { now: NOW }).warnings.length === 0);
}

console.log('\n7. The mutation arm: a source that forgot the grace would rank every fresh merge at 5');
{
  const st = { status: 'behind', main: 'abc1234', deployed: '0ldsha1', ref: 'origin/main', commitTimes: [NOW_S - 1 * HOUR] };
  const withGrace = (deployPendingItems(st, { now: NOW }).items[0] || {}).rank;
  const noGrace = (deployPendingItems(st, { now: NOW, graceHours: 0 }).items[0] || {}).rank;
  check('with the grace a 1h merge ranks 8; with none it ranks 5 — so the grace is what the rank reads', withGrace === 8 && noGrace === 5, `${withGrace} / ${noGrace}`);
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: the deploy-pending row is not what deploy_pending.mjs says it is.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: a forgotten deploy is a rank-5 row dated from its oldest commit, a fresh merge ranks 8, a current site raises nothing, and the three states that are not this row's business are warnings rather than guesses.`);
}
