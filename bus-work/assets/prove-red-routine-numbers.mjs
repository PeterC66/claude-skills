#!/usr/bin/env node
/* Prove the five routine numbers are each what routine_numbers.mjs says they are
 * (buses-data OA-402, R9 of the process review, 2026-09-18).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets):
 *
 *   node prove-red-routine-numbers.mjs
 *
 * A measurement harness has a different job from a row harness. `prove-red-bods-scan.mjs`
 * asks *does the row fire and does it stop*; this asks *is the number the thing its
 * label says*, which is the failure this project has paid for most often — a metric
 * computed over the wrong population, or a denominator that quietly dropped a class of
 * its own subject. Section 9 of the review is a list of numbers, and R9's whole worth
 * is judged on five of them, so a number here that is plausible and wrong is worse than
 * no number at all.
 *
 * TWO CASES BELOW ARE REGRESSIONS THIS FILE ACTUALLY CAUGHT, and they are marked. Both
 * were plausible: an idle rate of 36.4% against a baseline of 15%, and a relay count of
 * 1 against a review that found twenty in one round.
 *
 * No repository, no loop folder, no `gh`, no network: `readFacts()` takes every edge as
 * an argument and `routineNumbers()` takes its clock, so every window boundary here is
 * exact rather than "run this before the end of the month".
 */
import { readFacts, routineNumbers, render, promptBlock, parseRunName, RELAY_PATTERNS, DECISION_PATTERNS, REPEAT_PATTERNS, DEFAULT_WINDOW_DAYS } from './routine_numbers.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

const DAY = 86400000;
/* A fixed clock: 2026-10-05T12:00:00 local. No case in this file uses today's date. */
const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const stamp = (msAgo, feed) => {
  const d = new Date(NOW - msAgo);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}-${feed}.md`;
};
const facts = (over = {}) => ({ runNames: [], runTexts: [], yourMoveTexts: [], prompt: null, pages: {}, repos: [], ...over });

/* One manifest row, for section 1. `stage_actors.mjs` owns the counting and its own
 * harness falsifies it in forty ways; what is asserted HERE is only the join — that
 * this file's number changes when the manifests do, and refuses when they say
 * nothing. Two copies of the same assertions would be the duplication this project
 * has a shelf of lessons about. */
const mapWith = (name, ...runs) => ({
  name, kind: 'area', town: null, dir: `C:/fixture/${name}`,
  manifest: { town: name, stages: { S1: { name: 'services', latest: null, runs: runs.map(([at, by], i) => {
    const r = { id: `r${i}`, dir: `S1/r${i}`, at, outputs: ['x.json'] };
    if (by) r.by = by;
    return r;
  }) } } },
});
const AT = '2026-10-03T09:00';   // 2 days before NOW, inside the 30-day window

console.log('\n1. Human touches: measured off the manifests, and a refusal when they say nothing');
{
  /* THE DEFAULT CASE IS STILL A REFUSAL, and on 2026-09-22 it was the real one:
   * 1,211 stage runs in the window and not one recording who performed it, because
   * `--by` did not exist when any of them was committed. A facts object with no
   * manifests at all — every other stub in this file — must reach the same verdict
   * as an estate of unattributed runs, because both mean "nothing was consulted". */
  const n = routineNumbers(facts(), { now: NOW }).numbers.humanTouchesPerMapMonth;
  check('measured is false and value is null when no manifest was read', n.measured === false && n.value === null, JSON.stringify(n.value));
  check('it says no map tree could be read, rather than reporting zero touches', /not a count of zero/.test(n.why), n.why);
  check('and it names the flag that would change that, rather than only refusing', /--by/.test(n.wouldNeed), n.wouldNeed);

  const unattributed = routineNumbers(facts({ manifests: [mapWith('Alpha', [AT, null], [AT, null])] }), { now: NOW }).numbers.humanTouchesPerMapMonth;
  check('an estate of runs nobody named is ALSO a refusal, not a rate of zero', unattributed.measured === false && unattributed.value === null);
  check('but it now says how many runs it looked at — the whole gain over the sentence it replaced', unattributed.runs === 2 && /2 stage\(s\)/.test(unattributed.why), unattributed.why);

  const real = routineNumbers(facts({ manifests: [mapWith('Alpha', [AT, 'buses-29'], [AT, 'sched-1252'])] }), { now: NOW }).numbers.humanTouchesPerMapMonth;
  check('one attributed run makes it measured, which is the narrowest rule available', real.measured === true);
  check('and the person-started stage is the touch, while the tick is not', real.value === 1 && real.byPerson === 1 && real.byLoop === 1, JSON.stringify(real.value));

  /* THE COVERAGE MUST TRAVEL WITH THE VALUE. A rate over attributed runs reads
   * exactly like a rate over the estate, and the one that gets quoted into a round
   * record is whichever the output shows. */
  const thinFacts = facts({ manifests: [mapWith('Alpha', [AT, 'buses-29'], [AT, null], [AT, null], [AT, null])] });
  const thin = routineNumbers(thinFacts, { now: NOW }).numbers.humanTouchesPerMapMonth;
  check('coverage is reported beside the value, never omitted', thin.coverage === 0.25 && thin.attributed === 1 && thin.runs === 4, JSON.stringify(thin.coverage));
  const text = render(routineNumbers(thinFacts, { now: NOW }));
  check('and the printed block carries it on the line under the number', /coverage: 1 of 4 stage\(s\)/.test(text), text.split('\n').slice(2, 4).join(' | '));
}

console.log('\n2. CI red rate: a repo gh cannot answer for is NOT a rate of zero');
{
  const silent = routineNumbers(facts({ repos: [{ name: 'x', runs: null }] }), { now: NOW }).numbers.ciRedRate;
  check('an unanswerable repo is measured:false with a reason', silent.perRepo[0].measured === false && /not a red rate of zero/.test(silent.perRepo[0].why), JSON.stringify(silent.perRepo[0]));
  check('and it carries no rate at all, so nothing can average it in', silent.perRepo[0].rate === undefined, String(silent.perRepo[0].rate));

  const runs = [
    { conclusion: 'failure', createdAt: new Date(NOW - 2 * DAY).toISOString(), headBranch: 'main' },
    { conclusion: 'success', createdAt: new Date(NOW - 3 * DAY).toISOString(), headBranch: 'main' },
    { conclusion: 'success', createdAt: new Date(NOW - 4 * DAY).toISOString(), headBranch: 'main' },
    { conclusion: 'failure', createdAt: new Date(NOW - 99 * DAY).toISOString(), headBranch: 'main' },   // outside the window
    { conclusion: 'failure', createdAt: new Date(NOW - 2 * DAY).toISOString(), headBranch: 'a-branch' }, // not the default branch
    { conclusion: 'cancelled', createdAt: new Date(NOW - 2 * DAY).toISOString(), headBranch: 'main' },   // not a verdict
    { conclusion: null, createdAt: new Date(NOW - 1 * DAY).toISOString(), headBranch: 'main' },          // still running
  ];
  const r = routineNumbers(facts({ repos: [{ name: 'r', branch: 'main', runs }] }), { now: NOW }).numbers.ciRedRate.perRepo[0];
  check('1 red of 3 finished runs on main inside the window — 33.3%', r.red === 1 && r.runs === 3 && Math.abs(r.rate - 1 / 3) < 1e-9, JSON.stringify(r));
  check('an OLD red is outside the window', !JSON.stringify(r).includes('"red":2'), JSON.stringify(r));
  const wide = routineNumbers(facts({ repos: [{ name: 'r', branch: 'main', runs }] }), { now: NOW, windowDays: 365 }).numbers.ciRedRate.perRepo[0];
  check('and widening the window brings it back — so the window is what excluded it, not the branch filter', wide.red === 2 && wide.runs === 4, JSON.stringify(wide));
}

console.log('\n3. Idle ticks — and case (a) is a REGRESSION this harness caught');
{
  /* (a) The first draft re-implemented the run-name regex with a lowercase-only feed
   * group, so every `-OA.md` tick failed to parse and left the DENOMINATOR while the
   * `-none.md` files it is compared against all parsed. 43 idle of 118 read 36.4%
   * against a review baseline of 15%; the true figure over the same disk was 17.2%.
   * The parser is now imported from loop_runs.mjs rather than copied. */
  const names = [stamp(1 * DAY, 'OA'), stamp(2 * DAY, 'bus-work'), stamp(3 * DAY, 'none'), stamp(4 * DAY, 'around')];
  const n = routineNumbers(facts({ runNames: names }), { now: NOW }).numbers.idleTicks;
  check('(a) an uppercase OA feed is COUNTED, in the denominator', n.ticks === 4, JSON.stringify(n));
  check('    2 of 4 are idle — 50%, with none and around split out', n.idle === 2 && n.none === 1 && n.around === 1 && Math.abs(n.rate - 0.5) < 1e-9, JSON.stringify(n));
  check('    and parseRunName lowercases the feed, which is the rule this now borrows', parseRunName(stamp(0, 'OA')).feed === 'oa');

  // (b) OA-408: a `-missed` record is a scheduled run that left no file of its own.
  // It is idle, and counted apart; the set is loop_runs.mjs's, not a copy.
  const m = routineNumbers(facts({ runNames: [stamp(1 * DAY, 'OA'), stamp(2 * DAY, 'missed')] }), { now: NOW }).numbers.idleTicks;
  check('(b) a missed run is idle and counted as missed', m.ticks === 2 && m.idle === 1 && m.missed === 1 && m.none === 0, JSON.stringify(m));

  // (c) adhoc tick-counts, 2026-09-26: a `-busy` run stood down to another tick's
  // live lock, so the queue was being worked. It is out of the ratio entirely and
  // counted beside it — the set is loop_runs.mjs's DEFERRED, not a copy.
  const b = routineNumbers(facts({ runNames: [stamp(1 * DAY, 'OA'), stamp(2 * DAY, 'busy'), stamp(3 * DAY, 'busy'), stamp(4 * DAY, 'none')] }), { now: NOW }).numbers.idleTicks;
  check('(c) busy runs are in neither numerator nor denominator, and counted as busy', b.ticks === 2 && b.idle === 1 && b.busy === 2 && Math.abs(b.rate - 0.5) < 1e-9, JSON.stringify(b));

  // (d) buses-data status review 2026-10-19: an `-idle` run (OA-576) dispatched and
  // found nothing to do. loop_runs.mjs files it with `busy` as DEFERRED, which is
  // right for the loop-idle row, but this ratio is loop time that did not move the
  // queue, and an `-idle` tick is exactly that. Taking it out with `busy` read 16.7%
  // (1 of 6) over a window where 19 of 25 ticks were `-idle`.
  const i = routineNumbers(facts({ runNames: [stamp(1 * DAY, 'OA'), stamp(2 * DAY, 'idle'), stamp(3 * DAY, 'idle'), stamp(4 * DAY, 'busy')] }), { now: NOW }).numbers.idleTicks;
  check('(d) idle runs are IN the ratio — 2 of 3, with busy still out', i.ticks === 3 && i.idle === 2 && i.busy === 1 && Math.abs(i.rate - 2 / 3) < 1e-9, JSON.stringify(i));
  check('    and counted apart from none, around and missed', i.foundNothing === 2 && i.none === 0 && i.around === 0 && i.missed === 0, JSON.stringify(i));
  const line = render(routineNumbers(facts({ runNames: [stamp(1 * DAY, 'OA'), stamp(2 * DAY, 'idle'), stamp(4 * DAY, 'busy')] }), { now: NOW })).split('\n').find((l) => l.startsWith('3.'));
  check('    and the printed line names idle and busy separately', /1 of 2 ticks/.test(line) && /1 idle/.test(line) && /1 busy stand-down/.test(line), line);

  const old = routineNumbers(facts({ runNames: [stamp(90 * DAY, 'none'), stamp(1 * DAY, 'OA')] }), { now: NOW }).numbers.idleTicks;
  check('a tick outside the window is in neither the numerator nor the denominator', old.ticks === 1 && old.idle === 0, JSON.stringify(old));
  const absent = routineNumbers(facts({ runNames: null }), { now: NOW }).numbers.idleTicks;
  check('no loop/runs folder reads as NOT MEASURED, not as a perfect 0% idle', absent.measured === false && absent.rate === null, JSON.stringify(absent));
  const junk = routineNumbers(facts({ runNames: ['notes.txt', 'README.md'] }), { now: NOW }).numbers.idleTicks;
  check('files that are not run records are ignored rather than counted as ticks', junk.ticks === 0, JSON.stringify(junk));
}

console.log('\n4. Relayed commands — and this is the OTHER regression this harness caught');
{
  /* The first draft matched *only Peter can …* without saying what of, so *only Peter
   * can send an email* — a DECISION, and R9 working as designed — would have counted
   * as a relayed command. It went the other way in the end: the first patterns were so
   * narrow they found 1 hit in 267 files, which reads as success and was a dead regex. */
  const relay = 'The two portal branches only Peter can push, because the repo is protected.';
  const decide = 'CORR-004 reply drafted, NOT SENT. Only Peter can send an email.';
  const n = routineNumbers(facts({ runTexts: [relay, decide, 'a quiet tick'], yourMoveTexts: [decide] }), { now: NOW }).numbers.relayedCommands;
  check('a command Peter had to run counts as a relay', n.value === 1, JSON.stringify(n));
  check('a letter only Peter can send does NOT — it is the control, counted separately', n.decisions === 2, JSON.stringify(n));
  check('the two populations are different sizes over the same files, so one is not the other renamed', n.value !== n.decisions);
  check('it is flagged as a floor, so no round record can quote it as a total', n.floor === true);
  check('and the file count is carried, so the reader has a denominator', n.files === 4, String(n.files));
  // OA-610: the ad-hoc loop's run records are in adhoc/runs/, and a relay there counts.
  const na = routineNumbers(facts({ runTexts: ['a quiet tick'], adhocRunTexts: [relay] }), { now: NOW }).numbers.relayedCommands;
  check('a relay in an ad-hoc run record (adhoc/runs/) counts too', na.value === 1 && na.files === 2, JSON.stringify(na));

  check('no pattern in either set matches the other set\'s example — they are disjoint on the real phrasings',
    !DECISION_PATTERNS.some((re) => re.test(relay)) && !RELAY_PATTERNS.some((re) => re.test(decide)));
  check('and the relay set is not vacuous: it matches at least one shape', RELAY_PATTERNS.some((re) => re.test(relay)));
}

console.log('\n5. Words before acting, and the prompt block rule');
{
  const md = ['# x', 'prose', '## The task prompt', 'intro', '```', 'one two three', '```', 'more prose', '```bash', 'four five', '```'].join('\n');
  check('promptBlock takes the LAST fence under the heading, not the first', promptBlock(md) === 'four five', JSON.stringify(promptBlock(md)));
  check('and returns null when the heading is absent, rather than the first fence in the file', promptBlock('# x\n```\nnope\n```') === null);

  const n = routineNumbers(facts({ prompt: 'a b c d', pages: { 'CLAUDE.md': 'one two', 'loop/README.md': null } }), { now: NOW }).numbers.wordsBeforeActing;
  check('the prompt is counted in words', n.taskPrompt === 4, String(n.taskPrompt));
  check('a page that could not be read is left OUT rather than counted as zero words', n.pages.length === 1 && n.pages[0].name === 'CLAUDE.md' && n.pages[0].words === 2, JSON.stringify(n.pages));
  check('and a missing prompt reads null, not 0 — a tick that loads no words is not the win it would look like',
    routineNumbers(facts({ prompt: null }), { now: NOW }).numbers.wordsBeforeActing.taskPrompt === null);
  // OA-598: the review quotes the SUM, so the sum is printed, over the pages that were read.
  check('the total is the prompt plus every page that was read', n.total === 6, String(n.total));
  check('and nothing read at all is a null total, not 0', routineNumbers(facts(), { now: NOW }).numbers.wordsBeforeActing.total === null);
  check('the printed block carries the total', /total: 6 words/.test(render(routineNumbers(facts({ prompt: 'a b c d', pages: { 'CLAUDE.md': 'one two' } }), { now: NOW }))));
}

console.log('\n5b. Rules broken again (OA-598): a rule disobeyed counts, a shape that recurred does not');
{
  /* The hard-wraps memory says its rule "was already recorded once and still got
   * violated", and the first pattern set missed it on the real store on 2026-10-17. */
  const broken = { store: 'S', file: 'feedback_a.md', text: '**Why:** x. It has been violated twice after being recorded.' };
  const still = { store: 'S', file: 'feedback_b.md', text: '**Why:** y. This rule was already recorded once and still got violated on a fresh Write.' };
  const recurred = { store: 'S', file: 'feedback_c.md', text: '**Why:** z. It has now happened twice, both times after a build.' };
  const other = { store: 'T', file: 'feedback_d.md', text: 'He said "once again", so this was at least the second time.' };
  const n = routineNumbers(facts({ ruleTexts: [broken, still, recurred, other] }), { now: NOW }).numbers.rulesBrokenAgain;
  check('a rule recorded and broken again counts', n.measured === true && n.stores.find((s) => s.store === 'S').repeatFiles.includes('feedback_a.md'), JSON.stringify(n.stores));
  check('"already recorded once and still got violated" counts — the case the first patterns missed', n.stores.find((s) => s.store === 'S').repeatFiles.includes('feedback_b.md'), JSON.stringify(n.stores));
  check('a failure shape that merely "happened twice" does NOT — a bug seen twice is not a rule disobeyed', !n.stores.find((s) => s.store === 'S').repeatFiles.includes('feedback_c.md'));
  check('3 of 4 files, one hit per FILE, split by store', n.value === 3 && n.files === 4 && n.stores.length === 2, JSON.stringify({ v: n.value, f: n.files }));
  // Both counts are 3 here over DIFFERENT files: c records a rule and is no repeat, d is a repeat with no **Why:**.
  check('the control counts files that record a rule — a different population from the repeats', n.recorded === 3 && n.stores.find((s) => s.store === 'T').recorded === 0 && n.stores.find((s) => s.store === 'T').repeats === 1, JSON.stringify(n.stores));
  check('it is flagged as a floor', n.floor === true);
  check('the repeat set is not vacuous on its own example', REPEAT_PATTERNS.some((re) => re.test(broken.text)));
  check('a BUG "still broken after the fix" is not a rule broken again (two real files, 2026-10-17)', !REPEAT_PATTERNS.some((re) => re.test('the two sheets were still broken after the fix')));
  const none = routineNumbers(facts({ ruleTexts: null }), { now: NOW }).numbers.rulesBrokenAgain;
  check('no projects folder reads as NOT MEASURED, not as zero repeats', none.measured === false && none.value === null && /not a count of zero/.test(none.why), JSON.stringify(none));
  check('and the printed block says NOT MEASURED rather than a number', /6\. Rules broken again[^\n]*NOT MEASURED/.test(render(routineNumbers(facts({ ruleTexts: null }), { now: NOW }))));
  const f = readFacts({ busesDir: 'C:/x', home: 'C:/home', exists: (p) => /projects$|memory$|\.md$/.test(p), readsDir: (p) => (/projects$/.test(p) ? ['C--Store'] : ['MEMORY.md', 'feedback_x.md', 'notes.txt']), reads: (p) => (/feedback_x/.test(p) ? 'violated again' : 'user rules'), ghRuns: () => null, readManifests: () => [] });
  check('readFacts reads every memory store\'s .md files but not its MEMORY.md index', f.ruleTexts.some((r) => r.store === 'C--Store' && r.file === 'feedback_x.md') && !f.ruleTexts.some((r) => r.file === 'MEMORY.md' || r.file === 'notes.txt'), JSON.stringify(f.ruleTexts));
  check('and the user-scope CLAUDE.md is a store of its own', f.ruleTexts.some((r) => r.store === '~/.claude' && r.file === 'CLAUDE.md'), JSON.stringify(f.ruleTexts.map((r) => r.store)));
}

console.log('\n6. readFacts asks the disk once and never throws on a tree that is not there');
{
  const asked = [];
  const f = readFacts({
    busesDir: 'C:/nowhere',
    repos: [{ name: 'r', dir: 'C:/nowhere' }],
    exists: (p) => { asked.push(p); return false; },
    reads: () => { throw new Error('should not be reached'); },
    readsDir: () => { throw new Error('should not be reached'); },
    ghRuns: () => null,
  });
  check('every read is guarded by an exists() check', asked.length > 0, String(asked.length));
  check('every adhoc/runs/ read is guarded too: an absent folder is no texts', asked.some((p) => /adhoc[\\/]runs$/.test(p)) && Array.isArray(f.adhocRunTexts) && f.adhocRunTexts.length === 0, JSON.stringify(f.adhocRunTexts));
  check('and an absent tree gives runNames null, prompt null, no pages', f.runNames === null && f.prompt === null && Object.values(f.pages).every((v) => v === null), JSON.stringify({ r: f.runNames, p: f.prompt }));
  const out = routineNumbers(f, { now: NOW });
  check('which the core turns into NOT MEASURED across the board and no exception', out.numbers.idleTicks.measured === false && out.numbers.ciRedRate.measured === false);
  check('a reader that throws is swallowed into null rather than killing the run', readFacts({ busesDir: 'C:/x', exists: () => true, reads: () => { throw new Error('boom'); }, readsDir: () => { throw new Error('boom'); }, ghRuns: () => null }).runNames === null);
}

console.log('\n7. The window default and the shape of the report');
{
  const out = routineNumbers(facts(), { now: NOW });
  check(`the default window is ${DEFAULT_WINDOW_DAYS} days and is reported back`, out.windowDays === DEFAULT_WINDOW_DAYS, String(out.windowDays));
  check('all six numbers are present under their own keys, so none can go missing silently',
    ['humanTouchesPerMapMonth', 'ciRedRate', 'idleTicks', 'relayedCommands', 'wordsBeforeActing', 'rulesBrokenAgain'].every((k) => out.numbers[k]), JSON.stringify(Object.keys(out.numbers)));
  check('and every one carries a label and a target, so a pasted block explains itself',
    Object.values(out.numbers).every((v) => v.label && v.target), JSON.stringify(Object.values(out.numbers).map((v) => [v.label, v.target])));
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: the routine numbers are not what routine_numbers.mjs says they are.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: two of the five refuse to be invented, a repository gh cannot answer for is not a red rate of zero, an uppercase feed is in the denominator, a decision only Peter can make is not a relayed command, and a tree that is not there reads as NOT MEASURED rather than as perfect.`);
}
