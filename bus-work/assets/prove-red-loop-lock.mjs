#!/usr/bin/env node
/* Prove the `loop-lock` verdict can go red — and, harder, that it goes green in
 * the four places it MUST, because each of those is a way this rule could
 * quietly break something that works today. buses-data OA-287.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-loop-lock.mjs
 *
 * No placeholders; it builds throwaway lock directories under the OS temp
 * directory and never looks at the real `loop/LOCK.d`.
 *
 * THE FOUR GREENS ARE THE POINT, and they are why this is a separate harness
 * rather than four more lines in prove-red-concurrency.mjs:
 *
 *   1. HELD BY ME IS SAFE. Without this the rule blocks its own holder for
 *      ever, and would pass every red case below while being useless. This is
 *      the same shape the estate-sweep rule was caught in on the day
 *      prove-red-concurrency.mjs was written.
 *
 *   2. A STALE TICK LOCK IS SAFE. The loop's stored prompt runs the conditions
 *      check at step 2 and takes the lock at step 3, and step 3 is where the
 *      steal rule lives. If a crashed tick's lock reported CHECK FIRST here,
 *      the next tick would stop at step 2 and never reach the line that is
 *      entitled to steal it — so this rule would have DISABLED the loop's own
 *      crash recovery. Reporting SAFE leaves the steal rule the only place the
 *      decision is made, which is where loop/README.md puts it.
 *
 *   3. A ROW THAT NEEDS NOTHING STILL NEEDS NOTHING. `ci-red-` rows and
 *      OA-283's `loop-blocked-` rows return [] from needsOf() on purpose, so
 *      that --safe-only can never hide the row saying the repository is broken
 *      or that the loop has stopped. A guard bolted onto assess() is exactly
 *      how that would get undone by accident.
 *
 *   4. NO `loop/` AT ALL IS SAFE. This reader runs in harness fixtures, in a
 *      fresh clone and in CI, none of which have a `loop/` folder — and
 *      `conditions.loopLock` is absent from every synthetic world built by
 *      prove-red-concurrency.mjs. A rule that threw or delayed on `undefined`
 *      would take the whole worklist down everywhere but this laptop.
 *
 * A FIFTH GROUP WAS ADDED ON 2026-09-10 and it is about green 1 rather than a
 * new verdict. `mine` is false until somebody passes `--session`, so green 1
 * protects only a caller who remembered a flag — and the loop's own task prompt
 * has never mentioned it. sched-2215 took the lock at step 3, re-read the board
 * at step 4 as the prompt requires, and was told by five rows to wait for
 * sched-2215. The rule cannot know it is being read by its own holder; what it
 * can do is name the flag in the reason. Section 2b pins that the hint appears,
 * that it carries the holder's own name, and — the harder half — that it stays
 * quiet whenever it would be false.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as conc from './concurrency.mjs';
import { readLoopLock, fmtMin, DEFAULT_LEASE_MIN } from './loop_lock.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'looplock-'));
let bad = 0;

function ok(pass, label, detail) {
  console.log(`  ${pass ? 'ok   ' : 'MISS '} ${label}`);
  if (!pass) { bad++; if (detail) console.log(`        ${detail}`); }
}
const want = (got, expected, label) => ok(got.verdict === expected, label, `wanted ${expected}, got ${got.verdict}${got.reasons.length ? ` (${got.reasons.map((r) => r.need).join(', ')})` : ''}`);
const says = (got, re, label) => ok(got.reasons.some((r) => re.test(r.why)), label, `no reason matched ${re}; saw: ${got.reasons.map((r) => r.why).join(' | ') || '(none)'}`);

const NOW = Date.parse('2026-09-08T22:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/* Build a throwaway buses tree with a lock in whatever state the case needs.
 * `holder: null` means the directory exists with no holder file in it. */
let n = 0;
function tree({ lock = false, holder = undefined } = {}) {
  const dir = path.join(root, `t${++n}`);
  fs.mkdirSync(path.join(dir, 'loop'), { recursive: true });
  if (lock) {
    fs.mkdirSync(path.join(dir, 'loop', 'LOCK.d'), { recursive: true });
    if (holder !== undefined && holder !== null) fs.writeFileSync(path.join(dir, 'loop', 'LOCK.d', 'holder'), holder, 'utf8');
  }
  return dir;
}
const held = (name, takenMs, expiresMs) =>
  `${name} ${iso(takenMs)} — taking the lock for one unit of work\n` +
  (expiresMs === null ? '' : `expires: ${iso(expiresMs)}\n`);

// ---------------------------------------------------------------------------
// 1. THE OBSERVATION — does readLoopLock see what is actually on the disk?
// ---------------------------------------------------------------------------
console.log('\n== reading a real lock directory ==');

const noLoop = path.join(root, 'noloop');
fs.mkdirSync(noLoop, { recursive: true });
ok(readLoopLock(noLoop, { now: NOW }).present === false, 'a tree with no loop/ at all: not held');
ok(readLoopLock(tree(), { now: NOW }).present === false, 'loop/ with no LOCK.d: not held');
ok(readLoopLock(null, { now: NOW }).present === false, 'no buses dir given: not held, and no throw');

const bare = readLoopLock(tree({ lock: true, holder: null }), { now: NOW });
ok(bare.present === true && bare.readable === false, 'LOCK.d with no holder file: held but unreadable');
ok(bare.name === null, 'and it does not invent a name');

const tick = readLoopLock(tree({ lock: true, holder: held('sched-2115', NOW - 20 * 60000, NOW + 70 * 60000) }), { now: NOW });
ok(tick.name === 'sched-2115', 'the name is the first token of the first line');
ok(tick.isTick === true, 'a sched- name is recognised as a tick');
ok(tick.takenSource === 'holder' && tick.ageMin === 20, 'the taken time is read off the holder, and the age is right');
ok(tick.expiresSource === 'holder' && tick.expired === false, 'a live lease read off the holder is not expired');

const noExp = readLoopLock(tree({ lock: true, holder: held('sched-1900', NOW - 100 * 60000, null) }), { now: NOW });
ok(noExp.expiresSource === 'fallback', 'a holder with no expires: falls back rather than becoming immortal');
ok(noExp.expires === noExp.takenAt + DEFAULT_LEASE_MIN * 60000, `and the fallback is taken + ${DEFAULT_LEASE_MIN} minutes`);
ok(noExp.expired === true && noExp.overdueMin === 10, 'and 100 minutes in, a 90-minute fallback lease has expired by 10');

const garbled = readLoopLock(tree({ lock: true, holder: 'buses-04 some time yesterday\nexpires: soon\n' }), { now: NOW });
ok(garbled.name === 'buses-04' && garbled.isTick === false, 'a name that is not a tick is not treated as one');

/* THE POPULATION IS THE POINT, NOT THE VERDICT. Until 2026-09-09 the single
 * case above passed for a reason unrelated to the property it names:
 * `parseWhen` fell through to `Date.parse` on the WHOLE first line, and the
 * three words `some time yesterday` are what defeated V8's legacy date parser
 * — not the absence of a timestamp. A bare `buses-04` parsed as 2001-03-31,
 * and the real holder line of 2026-09-09, `buses-85 (interactive session,
 * Peter at the keyboard)`, as 1985-01-01. The worklist then told Peter that a
 * lock taken nine minutes earlier had been held for 365434h and that he should
 * delete it. So the fixture is now the POPULATION — every shape a holder's
 * first line actually takes on this disk — rather than the one shape that
 * happened to be safe. */
const garbledFirstLines = [
  ['buses-04 some time yesterday', 'trailing prose that defeats Date.parse'],
  ['buses-04', 'a bare session name — Date.parse read this as 2001-03-31'],
  ['buses-85 (interactive session, Peter at the keyboard)', 'the real 2026-09-09 line — Date.parse read this as 1985-01-01'],
  ['buses-73 working on OA-289', 'a name plus what the session is doing'],
  ['buses-8b: reply SENT', 'a name with a colon and a status'],
];
for (const [first, what] of garbledFirstLines) {
  const g = readLoopLock(tree({ lock: true, holder: `${first}\nexpires: soon\n` }), { now: NOW });
  ok(g.takenSource === 'mtime', `no parseable time (${what}): falls back to the directory mtime, which the atomic mkdir set`,
    `takenSource=${g.takenSource}, takenAt=${g.takenAt === null ? 'null' : iso(g.takenAt)}`);
  ok(g.expiresSource === 'fallback', `and an unparseable expires: falls back too (${what})`);
}

/* THE CONTROL, and it is why the fix is a narrowing rather than a deletion.
 * Every real holder line puts the NAME first and the timestamp after it, so
 * refusing to parse a line that carries no ISO match must not also refuse the
 * one that carries an ISO match mid-line. */
const midline = readLoopLock(tree({ lock: true, holder: `sched-1215 (scheduled tick) taken ${iso(NOW - 9 * 60000)}\nexpires: ${iso(NOW + 81 * 60000)}\n` }), { now: NOW });
ok(midline.takenSource === 'holder' && midline.ageMin === 9, 'a timestamp written AFTER the name and some prose is still read off the holder',
  `takenSource=${midline.takenSource}, ageMin=${midline.ageMin}`);
ok(midline.expiresSource === 'holder' && midline.expired === false, 'and its expires: line is read off the holder too');

const mine = readLoopLock(tree({ lock: true, holder: held('buses-73', NOW - 5 * 60000, NOW + 85 * 60000) }), { selfSession: 'buses-73', now: NOW });
ok(mine.mine === true, 'a holder naming this session is recognised as mine');
const theirs = readLoopLock(tree({ lock: true, holder: held('buses-04', NOW - 5 * 60000, NOW + 85 * 60000) }), { selfSession: 'buses-73', now: NOW });
ok(theirs.mine === false, 'and a holder naming another session is not');

ok(fmtMin(45) === '45m' && fmtMin(60) === '1h' && fmtMin(95) === '1h 35m', 'minutes render as something a person reads');
ok(fmtMin(null) === 'an unknown time', 'and an unknown age says so rather than printing null');

// ---------------------------------------------------------------------------
// 2. THE JUDGEMENT — the rule, over synthetic conditions
// ---------------------------------------------------------------------------
console.log('\n== the rule, each verdict paired with the state that clears it ==');

const repo = (over = {}) => ({
  present: true, readable: true, branch: 'main', expect: 'main',
  staged: [], modified: [], untracked: [], unpushed: 0, touchedTop: [], touchesMapData: false,
  dirty: false, offMain: false, ...over,
});
const world = (loopLock) => ({
  at: '', selfSession: null, claims: [], peers: { ok: false },
  repos: { buses: repo(), engine: repo(), portal: repo() },
  ...(loopLock === undefined ? {} : { loopLock }),
});
const lockState = (over) => ({
  present: true, readable: true, name: 'sched-2115', isTick: true, mine: false,
  takenAt: NOW - 20 * 60000, takenSource: 'holder', ageMin: 20,
  expires: NOW + 70 * 60000, expiresSource: 'holder', expired: false, overdueMin: 0,
  leaseMin: DEFAULT_LEASE_MIN, ...over,
});

// --- green 4: nothing there, and nothing KNOWN about there ---
want(conc.assess(['buses-tree'], world(undefined)), conc.SAFE, 'a world with no loopLock field at all: SAFE NOW');
want(conc.assess(['buses-tree'], world({ present: false })), conc.SAFE, 'no lock held: SAFE NOW');

// --- red: a tick is running right now ---
const live = world(lockState());
want(conc.assess(['buses-tree'], live), conc.DELAY, 'a live tick holds the lock: BETTER TO DELAY');
says(conc.assess(['buses-tree'], live), /sched-2115/, 'and it names the holder');
says(conc.assess(['buses-tree'], live), /20m/, 'and how long it has held it');
want(conc.assess(['engine'], live), conc.DELAY, 'the engine row is caught by it too');
want(conc.assess(['estate-sweep'], live), conc.DELAY, 'and so is an estate sweep');

// --- green 2: a crashed tick must NOT stop the next tick at step 2 ---
const staleTick = world(lockState({ expired: true, overdueMin: 15, expires: NOW - 15 * 60000, takenAt: NOW - 105 * 60000, ageMin: 105 }));
want(conc.assess(['buses-tree'], staleTick), conc.SAFE, "a tick's lock past its lease: SAFE NOW, because step 3's steal rule owns that decision");

// --- red: a person's lock, live and stale, and the two differ ---
const person = world(lockState({ name: 'buses-04', isTick: false }));
want(conc.assess(['buses-tree'], person), conc.DELAY, "another session's live lock: BETTER TO DELAY");
says(conc.assess(['buses-tree'], person), /buses-04/, 'and it names them');
const stalePerson = world(lockState({ name: 'buses-04', isTick: false, expired: true, overdueMin: 200, expires: NOW - 200 * 60000, takenAt: NOW - 290 * 60000, ageMin: 290 }));
want(conc.assess(['buses-tree'], stalePerson), conc.CHECK, "a person's lock past its lease: CHECK FIRST — never stolen, so go and look");
says(conc.assess(['buses-tree'], stalePerson), /never stolen|abandoned/, 'and it says why nothing will clear it for you');

// --- red: held, and nobody said who ---
const anon = world(lockState({ readable: false, name: null }));
want(conc.assess(['buses-tree'], anon), conc.CHECK, 'held with an unreadable holder: CHECK FIRST');

// --- green 1: THE CONTROL. Held by me is safe, or the rule blocks its own holder ---
const own = world(lockState({ name: 'buses-73', isTick: false, mine: true }));
want(conc.assess(['buses-tree'], own), conc.SAFE, 'held by ME: SAFE NOW — the control that stops this rule blocking its own holder');
want(conc.assess(['buses-tree', 'engine', 'estate-sweep'], own), conc.SAFE, 'and it stays safe across every resource it is attached to');

// --- green 3: a row that needs nothing is untouched by any of it ---
want(conc.assess([], live), conc.SAFE, 'a row that needs nothing: SAFE NOW even while a tick runs');
want(conc.assess(conc.needsOf({ key: 'ci-red-claude-skills', type: 'gate-red' }), live), conc.SAFE, 'a ci-red- row is never hidden by the lock');
want(conc.assess(conc.needsOf({ key: 'loop-blocked-st-ives', type: 'loop-blocked' }), live), conc.SAFE, 'nor is an OA-283 loop-blocked- row');
want(conc.assess(conc.needsOf({ key: 'corr-unsent-001', type: 'correspondence' }), live), conc.SAFE, 'nor a drafted reply Peter has to send');

// ---------------------------------------------------------------------------
// 2b. THE HINT — because green 1 above is conditional on a flag nobody is
// obliged to pass, and until 2026-09-10 nothing said so.
//
// `mine` is only ever true when the caller passed `--session`. sched-2215 took
// the lock at step 3 of the task prompt, re-read the board at step 4 because
// the prompt requires it, and was told by five rows that `sched-2115 holds
// loop/LOCK.d ... a run in progress on the shared trees` — its own name, as a
// reason to wait. Nothing in the reason said the flag existed. The claims block
// in formatConditions has carried exactly that hint since it was written; this
// rule did not, and the asymmetry is what these cases pin.
//
// THE HINT MUST ALSO BE ABLE TO STAY QUIET, which is the harder half: a reader
// who HAS given a name is being told about a genuine third party, and telling
// them it might be themselves would be false.
// ---------------------------------------------------------------------------
console.log('\n== the reason is not a dead end for the holder reading it ==');

const withSelf = (w, name) => ({ ...w, selfSession: name });
const hints = (got) => got.reasons.some((r) => /--session/.test(r.why));

says(conc.assess(['buses-tree'], live), /--session sched-2115/, 'a live tick lock names the flag AND the holder, so a tick reading its own name can act on it');
says(conc.assess(['buses-tree'], stalePerson), /--session buses-04/, "and so does a person's lock past its lease");
ok(!hints(conc.assess(['buses-tree'], withSelf(live, 'buses-73'))),
  'but NOT once a name was given and the holder is somebody else — the hint would be a lie',
  conc.assess(['buses-tree'], withSelf(live, 'buses-73')).reasons.map((r) => r.why).join(' | '));
/* AND THE NAMELESS CASE IS THE ONE THE `L.name` GUARD IS ACTUALLY FOR, which
 * the first draft of this block got wrong: it asserted the hint stays quiet for
 * `anon`, whose holder file is UNREADABLE — and that branch returns two lines
 * before the hint is computed, so the case passed without the guard existing.
 * A readable holder file whose first line is blank is the reachable shape:
 * readLoopLock sets `readable: true` and leaves `name` null, which is what a
 * tick killed between creating the file and writing into it leaves behind.
 * Without `&& L.name` the reason would tell the reader to `pass --session
 * null`. */
const nameless = world(lockState({ readable: true, name: null, isTick: false }));
ok(!hints(conc.assess(['buses-tree'], nameless)),
  'nor when the holder file is readable but names nobody — there is no name to pass, and the hint must not say "null"',
  conc.assess(['buses-tree'], nameless).reasons.map((r) => r.why).join(' | '));
ok(!hints(conc.assess(['buses-tree'], anon)),
  'and an unreadable holder never reaches the hint at all — this one passes on an earlier return, not on the guard',
  conc.assess(['buses-tree'], anon).reasons.map((r) => r.why).join(' | '));
ok(conc.assess(['buses-tree'], own).reasons.length === 0,
  'and a row held by ME carries no reason at all, so the hint cannot appear on a safe row');

/* THE COUNTERFACTUAL THE FINDING WAS MEASURED AS, pinned so it cannot come
 * back. On the afternoon it was found the real tree was dirty, so `buses-tree`
 * was already hiding the same rows and the lock changed no count — the fault
 * was masked by an unrelated one. These worlds are CLEAN, which is where it
 * shows: the DELAY has exactly one reason and that reason is the reader's own
 * lock. If `--safe-only` is ever asked of a board in this state, every
 * contending row disappears and the banner reads that nothing is contended. */
ok(conc.assess(['buses-tree'], world({ present: false })).verdict === conc.SAFE,
  'control: with no lock, a clean tree says a buses-tree row is SAFE NOW');
const solely = conc.assess(['buses-tree'], live);
ok(solely.reasons.length === 1 && solely.reasons[0].need === 'loop-lock',
  'so on a clean tree the DELAY comes SOLELY from the lock — one reason, and it is loop-lock',
  `${solely.reasons.length} reason(s): ${solely.reasons.map((r) => r.need).join(', ')}`);

// --- the attachment itself: which rows get the lock, and which do not ---
console.log('\n== which work the lock is attached to ==');
const needsLock = (needs) => conc.assess(needs, live).reasons.some((r) => r.need === 'loop-lock');
ok(needsLock(conc.needsOf({ key: 's6-stale-ely', type: 'housekeeping' })), 'an S6 build carries the lock');
ok(needsLock(conc.needsOf({ key: 'engine-stale-x', type: 'housekeeping' })), 'an engine rollout carries it');
ok(needsLock(conc.needsOf({ key: 'x', type: 'build' })), 'a map build carries it');
ok(!needsLock([]), 'a decision in a browser does not');
const standing = (what) => conc.STANDING_TOOLS.find((t) => t.what === what);
ok(needsLock(standing('Run a map build (S1–S6)').needs), 'the standing "Run a map build" command carries it');
ok(needsLock(standing('Full byte gate sweep').needs), 'so does the byte gate sweep');
ok(!needsLock(standing('Print this worklist').needs), 'and printing the worklist does not');
/* The portal rows deliberately do NOT carry it, and the reason is a fact about
 * the loop rather than a judgement: a tick never pushes — that is a deny rule in
 * buses-data's settings, observed refusing — so it can neither deliver a map nor
 * deploy the portal, and cannot contend for either. If the loop is ever allowed
 * to push, this assertion is the thing that should go red. */
ok(!needsLock(standing('Deploy the portal').needs), 'a portal deploy does not, because a tick can never push');

fs.rmSync(root, { recursive: true, force: true });
console.log(bad === 0 ? '\nAll loop-lock cases pass.\n' : `\n${bad} case(s) MISSED.\n`);
process.exit(bad === 0 ? 0 : 1);
