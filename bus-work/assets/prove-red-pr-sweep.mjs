#!/usr/bin/env node
/* Prove the pull-request sweep's rows appear, say WHY, and go away — and that
 * the reader can never open a socket (buses-data OA-326 item 1, 2026-09-21).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-pr-sweep.mjs
 *
 * WHAT IS BEING FALSIFIED. Two rows that are NEGATIVE most of the time — no
 * pull request has been open a week, and every pushed branch has one — and a
 * negative is exactly what a check that does nothing also reports. So the cases
 * below are paired throughout: make the state and see the row, clear it and see
 * the row go. Sections 5 and 9 are the ones that matter most. A board that
 * nagged about a pull request opened yesterday, or about two drafts whose own
 * titles say DO NOT MERGE, would be muted inside a week and would take the
 * other rows with it.
 *
 * SECTION 8 IS THE ONE THIS FILE WAS WRITTEN FOR. On 2026-09-19 a tick reported
 * that `worklist-demo-applications` had never had a pull request; #170 had been
 * open on it for nineteen days, and the claim was repeated to Peter two days
 * later before anybody checked. The cause was inference: absence derived from a
 * list that had already been filtered to OPEN. So section 8 asserts, against a
 * stubbed GitHub, that the per-branch query is `--state all`, that a MERGED
 * pull request answers it, and — the control that catches the real mutation —
 * that swapping `all` for `open` puts that assertion red.
 *
 * AND SECTION 11 ASSERTS THE PROPERTY THE WHOLE SHAPE EXISTS FOR: the half of
 * pr_sweep.mjs that worklist.mjs imports contains no call that can reach the
 * network. The `gh` calls live below the writer's divider, under an
 * entry-point guard. Without that assertion nothing stops somebody "tidying"
 * the sweep into the board, which is the one change OA-326 argues hardest
 * against — a board opening a socket per branch is a board that fails on a
 * train.
 *
 * THE CLOCK IS INJECTED, never read. `prSweepItems` takes `now`, so every
 * boundary below is an assertion rather than something that happens to be true
 * today, and nothing here can start failing on a calendar.
 *
 * TWO HARNESS LESSONS INHERITED FROM prove-red-loop-your-move.mjs AND
 * prove-red-unpushed-branches.mjs. A source assertion asks whether the line
 * RUNS, not whether the file contains the text, because `includes()` is
 * satisfied by the line commented out. And a row's NUMBER is asserted, never
 * the sentence carrying it: `/open .* days/` is in the title whatever the age
 * is, including when the age is wrong.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPrSweep, prSweepItems, buildSweepRecord, sweepRepo, STALE_DAYS, CADENCE_HOURS,
} from './pr_sweep.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-pr-sweep-'));
const NOW = Date.UTC(2026, 8, 21, 12, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const hoursAgo = (n) => new Date(NOW - n * 3600000).toISOString();

/** Build a buses tree's loop/ folder. `record === undefined` means never swept. */
const mkLoop = (label, { loop = true, record = undefined } = {}) => {
  const busesDir = path.join(tmp, label);
  const loopDir = path.join(busesDir, 'loop');
  fs.mkdirSync(loop ? loopDir : busesDir, { recursive: true });
  if (record !== undefined) {
    fs.writeFileSync(path.join(loopDir, 'pr-sweep.json'),
      typeof record === 'string' ? record : JSON.stringify(record, null, 2), 'utf8');
  }
  return loopDir;
};

const pr = (number, over, extra = {}) => ({
  number, title: `PR ${number}`, headRefName: `b/${number}`,
  createdAt: daysAgo(over), updatedAt: daysAgo(over), isDraft: false,
  mergeStateStatus: 'CLEAN', reviewDecision: null, author: 'PeterC66', ...extra,
});
/** A record swept `ageHours` ago against one repository. */
const rec = (ageHours, { open = [], noPr = [], error = null, name = 'community-bus-maps' } = {}) => ({
  checkedAt: hoursAgo(ageHours), tool: 'pr_sweep.mjs',
  repos: [{ key: 'portal', name, slug: `PeterC66/${name}`, dir: 'C:/Claude/community-bus-maps', error, open, branchesAsked: 4, noPr }],
});
const rows = (loopDir, now = NOW) => prSweepItems({ state: readPrSweep(loopDir), now, assetsDir: HERE });
const byKey = (r, key) => r.items.find((x) => x.key === key);
/* A missing row must FAIL the assertion that names it, not throw on the line
 * after it. The mutation sweep found this the hard way: widening STALE_DAYS
 * emptied section 4, and the harness died on `r.items[0].rank` with a stack
 * trace instead of naming the control it had just broken. Red is red, but a
 * red that names nothing is a red somebody has to debug before they can read
 * it. */
const one = (r) => r.items[0] || { key: null, rank: null, title: '', why: '', detail: '', do: [] };

console.log('\n1. no buses tree here at all — silence, and the control that proves it is not silence everywhere');
{
  check('a folder with no loop/ raises nothing', rows(mkLoop('noloop', { loop: false })).items.length === 0);
  check('a path that does not exist raises nothing', rows(path.join(tmp, 'nope')).items.length === 0);
  // THE CONTROL. Without it every assertion in this file is satisfied by a
  // function that returns []. The only difference between the two trees is
  // loop/, which is exactly the trigger the module claims to key on.
  check('MUTATION CONTROL — the same tree WITH loop/ raises one', rows(mkLoop('trigger')).items.length === 1);
  check('…and it is the never-swept row', byKey(rows(mkLoop('trigger2')), 'pr-sweep-due') !== undefined);
}

console.log('\n2. the loop folder is here and the sweep has never run');
{
  const r = rows(mkLoop('never'));
  const it = one(r);
  check('exactly one row', r.items.length === 1, String(r.items.length));
  check('rank 8 — nobody is blocked by it', it.rank === 8, String(it.rank));
  check('the title says nothing has ever asked', /Nothing has ever asked GitHub/.test(it.title), it.title);
  check('the why names where the other instrument stops', /stops at the remote/.test(it.why));
  check('and it offers the sweep, in the assets folder', it.do.some((d) => d.kind === 'shell' && d.cmd === 'node pr_sweep.mjs' && d.cwd === HERE));
}

console.log('\n3. the record is there and cannot be believed');
{
  const r = rows(mkLoop('garbage', { record: '{not json' }));
  const it = one(r);
  check('one row, and it is LOUD rather than silent', r.items.length === 1, String(r.items.length));
  check('it is the record row', it.key === 'pr-sweep-record');
  check('the why says what is unwatched while it is broken', /open for weeks/.test(it.why));
  // The parse error is quoted, so the fix does not start with a guess.
  check('and it quotes the parse failure', /is not JSON \(/.test(it.why), it.why);
  // A record that parses but carries no date is the writer/reader join going
  // wrong, and from anywhere but here it looks exactly like health.
  const r2 = rows(mkLoop('undated', { record: { repos: [] } }));
  check('a record with no checkedAt also raises', r2.items.length === 1 && one(r2).key === 'pr-sweep-record');
  check('…and says so in the title', /does not say when it ran/.test(one(r2).title), one(r2).title);
  check('…and names the function that should have written it', one(r2).do.some((d) => /buildSweepRecord/.test(d.what || '')));
}

console.log('\n4. a pull request that has been open too long');
{
  const r = rows(mkLoop('stalled', { record: rec(1, { open: [pr(170, 21)] }) }));
  const it = one(r);
  check('one row', r.items.length === 1, String(r.items.length));
  check('rank 3 — the SOMEONE IS BLOCKED band', it.rank === 3, String(it.rank));
  // THE NUMBER, not the sentence around it. `/open .* days/` is satisfied
  // whatever the age is; 21 is the assertion.
  check('the title carries the AGE IN DAYS, not just the word days', /has been open 21 days/.test(it.title), it.title);
  check('the title carries the pull request NUMBER', /#170/.test(it.title), it.title);
  check('ageDays is set, so the board can sort on it', it.ageDays === 21, String(it.ageDays));
  check('the key is per pull request, so two do not collide', it.key === 'pr-sweep-stalled-portal-170');
  check('the detail names the branch', /branch b\/170/.test(it.detail), it.detail);
  check('the detail dates the sweep, so the row is read as a statement about then', /swept 2026-09-21/.test(it.detail));
  check('the do offers a self-contained gh command naming the repository', it.do.some((d) => d.cmd === 'gh pr view 170 --repo PeterC66/community-bus-maps --web'));
  check('and asks for a decision, not just a look', it.do.some((d) => /Merge it, close it, or say/.test(d.what || '')));
  // Two at once are two rows, because each is its own decision with its own age.
  const r2 = rows(mkLoop('two', { record: rec(1, { open: [pr(170, 21), pr(64, 31)] }) }));
  check('two stalled pull requests are two rows', r2.items.length === 2, String(r2.items.length));
  check('…with different keys', new Set(r2.items.map((x) => x.key)).size === 2);
}

console.log(`\n5. THE CONTROL THAT MATTERS MOST — a fresh pull request says nothing (the cadence is ${STALE_DAYS} days)`);
{
  check('opened today, nothing', rows(mkLoop('today', { record: rec(1, { open: [pr(1, 0)] }) })).items.length === 0);
  check('opened 2 days ago, nothing', rows(mkLoop('two-days', { record: rec(1, { open: [pr(1, 2)] }) })).items.length === 0);
  // The boundary, both sides. A week is the threshold; six days must be quiet
  // or "a week" is a word rather than a number.
  check(`${STALE_DAYS - 1} days — still quiet`, rows(mkLoop('day6', { record: rec(1, { open: [pr(1, STALE_DAYS - 1)] }) })).items.length === 0);
  check(`${STALE_DAYS} days — raises`, rows(mkLoop('day7', { record: rec(1, { open: [pr(1, STALE_DAYS)] }) })).items.length === 1);
  check('the threshold is the module\'s constant, not a literal here', STALE_DAYS === 7, String(STALE_DAYS));
  // And the caller can move it without the module reading the clock itself.
  const st = readPrSweep(mkLoop('override', { record: rec(1, { open: [pr(1, 10)] }) }));
  check('a 30-day threshold would leave the same record quiet', prSweepItems({ state: st, now: NOW, staleDays: 30 }).items.length === 0);
  check('a 3-day threshold would raise it', prSweepItems({ state: st, now: NOW, staleDays: 3 }).items.length === 1);
  // And a fresh one is NAMED in a warning, so "nothing raised" is distinguishable
  // from "nothing looked".
  const fresh = rows(mkLoop('fresh-note', { record: rec(1, { open: [pr(9, 1)] }) }));
  check('a young pull request is carried in a note, not silently dropped', fresh.notes.some((n) => /#9 \(1d\)/.test(n)), fresh.notes.join(' | '));
}

console.log('\n6. STALENESS IS MEASURED FROM createdAt, NOT updatedAt — measured on #64, which read 31 days open and 10 days quiet');
{
  // A bot comment, a base push or a CI re-run moves updatedAt. A pull request
  // nobody intends to merge would evade an updatedAt test for ever while
  // looking busy, which is precisely dependabot #64's shape.
  const busy = rows(mkLoop('busy', { record: rec(1, { open: [pr(64, 31, { updatedAt: daysAgo(0) })] }) }));
  const it = one(busy);
  check('open 31 days, touched today — STILL raised', busy.items.length === 1, String(busy.items.length));
  check('…and the title reports the 31, not the 0', /open 31 days/.test(it.title), it.title);
  check('…while the detail carries the last-activity age, where a reader can see it', /last activity 0 day\(s\) ago/.test(it.detail), it.detail);
  // MUTATION CONTROL, the other way: a pull request opened today but untouched
  // for a month is impossible, so the inverse case is the one that proves the
  // trigger is not secretly updatedAt.
  const quiet = rows(mkLoop('quiet', { record: rec(1, { open: [pr(65, 2, { updatedAt: daysAgo(2) })] }) }));
  check('open 2 days — quiet, whatever updatedAt says', quiet.items.length === 0, String(quiet.items.length));
}

console.log('\n7. A DRAFT RAISES NOTHING AND IS COUNTED — claude-skills #3 and #4 forbid their own merge in their titles');
{
  const d = rows(mkLoop('draft', { record: rec(1, { open: [pr(3, 40, { isDraft: true, title: '[DO NOT MERGE] dpPinned' })] }) }));
  check('a 40-day-old DRAFT raises no row', d.items.length === 0, JSON.stringify(d.items.map((x) => x.key)));
  check('…and is named in a note, so the narrowing is visible rather than silent', d.notes.some((n) => /1 DRAFT pull request/.test(n)), d.notes.join(' | '));
  check('…the note carries its number and title', d.notes.some((n) => /#3 \[DO NOT MERGE\] dpPinned/.test(n)));
  // MUTATION CONTROL. The only difference is the isDraft flag; without this,
  // "drafts are silent" is satisfied by a source that is silent about
  // everything.
  const live = rows(mkLoop('draft-control', { record: rec(1, { open: [pr(3, 40, { isDraft: false, title: '[DO NOT MERGE] dpPinned' })] }) }));
  check('MUTATION CONTROL — the same pull request NOT a draft raises', live.items.length === 1, String(live.items.length));
}

console.log('\n8. THE SHAPE THIS FILE WAS WRITTEN FOR — has this branch EVER had a pull request, asked over every state');
{
  const branches = [{ branch: 'worklist-demo-applications', committedAt: daysAgo(21), subject: 'Split seeded applications out', insertions: 88 }];
  const asked = [];
  /* A stubbed GitHub. It RECORDS every argv, which is what lets the assertions
   * below be about the query rather than about the answer. */
  const ghWith = (headAnswer) => (dir, argv) => {
    asked.push(argv.join(' '));
    if (argv[1] === 'view') return 'PeterC66/community-bus-maps\n';
    if (argv.includes('--head')) return headAnswer;
    return '[]';
  };

  const merged = sweepRepo({
    repo: { key: 'portal', name: 'community-bus-maps', dir: '/x' }, branches,
    gh: ghWith(JSON.stringify([{ number: 170, state: 'MERGED' }])),
  });
  check('a branch whose only pull request is MERGED is NOT reported as never having had one', merged.noPr.length === 0, JSON.stringify(merged.noPr));
  check('…and the branch was asked about at all', merged.branchesAsked === 1, String(merged.branchesAsked));
  // THE QUERY ITSELF. This is the assertion that would have caught 2026-09-19:
  // `--state all`, per branch, not a filtered list scanned for an absence.
  const headQuery = asked.find((a) => a.includes('--head'));
  check('the per-branch query names the branch', /--head worklist-demo-applications/.test(headQuery || ''), headQuery);
  check('MUTATION CONTROL — and it asks --state all, never --state open', /--state all/.test(headQuery || '') && !/--state open --head/.test(headQuery || ''), headQuery);

  // A branch that genuinely has none.
  const none = sweepRepo({ repo: { key: 'portal', name: 'community-bus-maps', dir: '/x' }, branches, gh: ghWith('[]') });
  check('MUTATION CONTROL — a branch with NO pull request in any state is reported', none.noPr.length === 1, JSON.stringify(none.noPr));
  check('…carrying its insertion count', none.noPr[0].insertions === 88, String(none.noPr[0].insertions));

  // A REFUSAL IS NOT AN ABSENCE. gh failing, or answering something that is not
  // a list, must leave the branch unmentioned — the silent direction, because
  // the loud one would invent a finding out of a network error.
  const refused = sweepRepo({ repo: { key: 'portal', name: 'community-bus-maps', dir: '/x' }, branches, gh: ghWith(null) });
  check('gh REFUSING the per-branch question raises nothing about that branch', refused.noPr.length === 0, JSON.stringify(refused.noPr));
  const garbled = sweepRepo({ repo: { key: 'portal', name: 'community-bus-maps', dir: '/x' }, branches, gh: ghWith('not json') });
  check('…and neither does an answer that will not parse', garbled.noPr.length === 0);

  // And the whole repository refusing is an ERROR carried in the record, never
  // an empty result that reads as health.
  const dead = sweepRepo({ repo: { key: 'portal', name: 'community-bus-maps', dir: '/x' }, branches, gh: () => null });
  check('a repository gh cannot name is recorded as an error, not as zero findings', !!dead.error, JSON.stringify(dead));
}

console.log('\n9. the no-pull-request ROW, and the control that it goes away');
{
  const noPr = [{ branch: 'test/ci-invisible-arms', committedAt: daysAgo(4), subject: 'The arms CI cannot see', insertions: 212 }];
  const r = rows(mkLoop('nopr', { record: rec(1, { noPr }) }));
  check('one row', r.items.length === 1, String(r.items.length));
  check('rank 3', r.items[0].rank === 3, String(r.items[0].rank));
  check('the title names the branch', /test\/ci-invisible-arms/.test(r.items[0].title));
  check('the why carries the SIZE, so the row says how much work is sitting there', /212 insertion/.test(r.items[0].why), r.items[0].why);
  check('the why says the question was asked over every state', /--state all --head test\/ci-invisible-arms/.test(r.items[0].why), r.items[0].why);
  check('the why says why the stranded row does not raise it', /IS on the remote/.test(r.items[0].why));
  check('the do offers gh pr create for that branch', r.items[0].do.some((d) => /gh pr create --repo PeterC66\/community-bus-maps --head test\/ci-invisible-arms/.test(d.cmd || '')));
  check('…and the other answer, deleting an abandoned branch', r.items[0].do.some((d) => /delete it from the remote/.test(d.what || '')));
  check('the key is per branch and slug-safe', r.items[0].key === 'pr-sweep-no-pr-portal-test-ci-invisible-arms', r.items[0].key);
  // THE CONTROL. Same record, empty noPr.
  check('MUTATION CONTROL — an empty noPr raises nothing', rows(mkLoop('nopr-none', { record: rec(1, { noPr: [] }) })).items.length === 0);
}

console.log(`\n10. the cadence row — the record itself going stale (${CADENCE_HOURS} hours)`);
{
  check('swept an hour ago, nothing', rows(mkLoop('h1', { record: rec(1) })).items.length === 0);
  check(`${CADENCE_HOURS - 1} hours — still quiet`, rows(mkLoop('h47', { record: rec(CADENCE_HOURS - 1) })).items.length === 0);
  const due = rows(mkLoop('h48', { record: rec(CADENCE_HOURS) }));
  check(`${CADENCE_HOURS} hours — raises`, due.items.length === 1, String(due.items.length));
  check('…the due row, at rank 8', one(due).key === 'pr-sweep-due' && one(due).rank === 8);
  check('…and the title carries the HOURS, not just the word', new RegExp(`last ran ${CADENCE_HOURS} hours ago`).test(one(due).title), one(due).title);
  check('the cadence is the module\'s constant, not a literal here', CADENCE_HOURS === 48, String(CADENCE_HOURS));
  // The relation the header argues for: the cadence must be INSIDE the stale
  // threshold, or a stall can be missed by longer than the gap.
  check('the cadence is inside the stale threshold, so a stall cannot be missed by more than it', CADENCE_HOURS / 24 < STALE_DAYS,
    `${CADENCE_HOURS}h vs ${STALE_DAYS}d`);
  // A stale record does not silence the rows it carries — they are still the
  // best answer anybody has, and the due row says how old they are.
  const both = rows(mkLoop('h48-open', { record: rec(CADENCE_HOURS, { open: [pr(170, 21)] }) }));
  check('a stale record still reports its stalled pull request, and adds the due row', both.items.length === 2, JSON.stringify(both.items.map((x) => x.key)));
  // A repository the sweep could not ask about is a note, never silence.
  const err = rows(mkLoop('err', { record: rec(1, { error: 'gh is not authenticated' }) }));
  check('a repository gh could not be asked about is named in a warning', err.notes.some((n) => /could not be asked — gh is not authenticated/.test(n)), err.notes.join(' | '));
  check('…and says that is a statement about the sweep, not about that repository', err.notes.some((n) => /statement about the sweep/.test(n)));
}

console.log('\n11. THE PROPERTY THE WHOLE SHAPE EXISTS FOR — the half the board imports cannot reach the network');
{
  const src = fs.readFileSync(path.join(HERE, 'pr_sweep.mjs'), 'utf8');
  const marker = 'THE WRITER. Everything below this line touches the network';
  const at = src.indexOf(marker);
  check('pr_sweep.mjs still has its writer divider', at > 0, 'the divider naming the network boundary is gone');
  const readerHalf = src.slice(0, at);
  // Not "does the file contain gh" — the writer does, and must. The question is
  // whether the READER does, because worklist.mjs imports the reader.
  const liveCall = (half, re) => half.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .some((l) => re.test(l));
  check('the reader half runs no execFileSync', !liveCall(readerHalf, /execFileSync\s*\(/), 'a socket moved above the divider');
  check('the reader half runs no gh call', !liveCall(readerHalf, /\bgh\s*\(/), 'a socket moved above the divider');
  check('the writer is behind an entry-point guard', /process\.argv\[1\].*fileURLToPath\(import\.meta\.url\)/.test(src), 'main() would run on import');
  // And the guard must use fileURLToPath, not a hand-peeled URL: on Windows
  // `new URL(import.meta.url).pathname` is `/C:/…` and the comparison silently
  // fails, which makes the sweep unrunnable with no error to read.
  check('…and the guard compares paths, not a raw URL pathname', !/new URL\(import\.meta\.url\)\.pathname/.test(src));
}

console.log('\n12. THE JOIN ITSELF — the real writer\'s record, read by the real reader');
{
  // Both halves live in this file, so unlike the directory sweep this join can
  // always be asked. It is still worth asking: buildSweepRecord renames every
  // field it copies, and a reader and a writer that each pass their own tests
  // while disagreeing about a field name is the standing fault this catches.
  const gh = (dir, argv) => {
    if (argv[1] === 'view') return 'PeterC66/community-bus-maps\n';
    if (argv.includes('--head')) return '[]';
    return JSON.stringify([
      { number: 170, title: 'Split seeded applications', headRefName: 'worklist-demo-applications',
        createdAt: daysAgo(21), updatedAt: daysAgo(21), isDraft: false,
        mergeStateStatus: 'BEHIND', reviewDecision: null, author: { login: 'PeterC66' } },
    ]);
  };
  const result = sweepRepo({
    repo: { key: 'portal', name: 'community-bus-maps', dir: 'C:/Claude/community-bus-maps' },
    branches: [{ branch: 'stray/thing', committedAt: daysAgo(3), subject: 'a stray', insertions: 12 }],
    gh,
  });
  const record = buildSweepRecord({ results: [result], now: new Date(NOW - 3600000) });
  check('the writer dates the record in a form the reader can parse', Number.isFinite(Date.parse(record.checkedAt)));
  check('the writer flattens the author object to a login', record.repos[0].open[0].author === 'PeterC66', JSON.stringify(record.repos[0].open[0].author));
  const dir = mkLoop('join');
  fs.writeFileSync(path.join(dir, 'pr-sweep.json'), JSON.stringify(record, null, 2), 'utf8');
  const r = rows(dir);
  check('the real record drives BOTH rows', r.items.length === 2, JSON.stringify(r.items.map((x) => x.key)));
  const stalled = byKey(r, 'pr-sweep-stalled-portal-170');
  check('the stalled row survives the round trip, with its age', stalled && /open 21 days/.test(stalled.title), stalled && stalled.title);
  check('…and names the author the writer flattened', stalled && /by PeterC66/.test(stalled.detail), stalled && stalled.detail);
  check('…and, because GitHub calls it BEHIND, says it cannot merge until it is brought forward', stalled && stalled.do.some((d) => /BEHIND/.test(d.what || '')));
  check('the no-pull-request row survives too', byKey(r, 'pr-sweep-no-pr-portal-stray-thing') !== undefined, JSON.stringify(r.items.map((x) => x.key)));
}

console.log('\n13. the concurrency verdict');
{
  // EMPTY, and load-bearing: --safe-only hides every non-SAFE row, and these
  // two must never be the ones hidden from a session looking for something safe
  // to do. Same argument as ci-red-, loop-hold- and unpushed-branch-.
  check('a stalled pull request needs no working tree', needsOf({ key: 'pr-sweep-stalled-portal-170', type: 'pr-sweep' }).length === 0);
  check('nor does a branch with no pull request', needsOf({ key: 'pr-sweep-no-pr-portal-x', type: 'pr-sweep' }).length === 0);
  // The housekeeping pair DO write — the sweep writes loop/pr-sweep.json into
  // the buses tree — so they are answered explicitly rather than left to fall
  // through the default.
  check('the due row claims the buses tree, because the sweep writes into it', needsOf({ key: 'pr-sweep-due', type: 'pr-sweep' }).join() === 'buses-tree');
  check('the record row says the same', needsOf({ key: 'pr-sweep-record', type: 'pr-sweep' }).join() === 'buses-tree');
  check('neither claims the engine', !needsOf({ key: 'pr-sweep-due', type: 'pr-sweep' }).includes('engine'));
  // MUTATION CONTROL — without this, "returns []" is satisfied by a needsOf
  // that returns [] for everything of this type.
  check('MUTATION CONTROL — an unknown key of the same type falls to the default, not to empty',
    needsOf({ key: 'pr-sweep-zzz', type: 'pr-sweep' }).join() === 'buses-tree');
}

console.log('\n14. the wire in worklist.mjs — literal strings, and they must RUN');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  // NOT src.includes(). A mutation sweep on prove-red-loop-your-move.mjs
  // commented a wire out and every assertion stayed green, because a commented
  // line still contains the string.
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { readPrSweep, prSweepItems } from './pr_sweep.mjs';",
    "state: readPrSweep(path.join(BUSES, 'loop')),",
    'for (const it of prSweep.items) add(it);',
    'for (const n of prSweep.notes) warnings.push(n);',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 58)}`, liveLine(lit), 'absent, or commented out');
  // The detail line is what makes the branch, the author and the BEHIND verdict
  // visible to a person at all; three row types wrote one and nothing printed
  // it until 2026-09-11.
  check('worklist.mjs PRINTS it.detail', liveLine('if (it.detail) for (const l of String(it.detail).split'), 'the branch and the age would be invisible outside --json');
  // And the board must not be the thing that opens the socket.
  check('worklist.mjs does NOT import the writer half', !liveLine('sweepRepo') && !liveLine('buildSweepRecord'), 'the board would be able to reach GitHub');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
