#!/usr/bin/env node
/* Prove the five routine numbers are each what routine_numbers.mjs says they are
 * (buses-data OA-402, R9 of the process review, 2026-09-18).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
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
import { readFacts, routineNumbers, promptBlock, parseRunName, RELAY_PATTERNS, DECISION_PATTERNS, DEFAULT_WINDOW_DAYS } from './routine_numbers.mjs';

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

console.log('\n1. Human touches: always unmeasured, and always says what would make it real');
{
  const n = routineNumbers(facts(), { now: NOW }).numbers.humanTouchesPerMapMonth;
  check('measured is false and value is null — never a number', n.measured === false && n.value === null, JSON.stringify(n.value));
  check('it names why the repository cannot answer', /cannot measure his time/.test(n.why), n.why);
  check('and it names the instrument that would change that, rather than only refusing', /manifest/.test(n.wouldNeed), n.wouldNeed);
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
  check('and an absent tree gives runNames null, prompt null, no pages', f.runNames === null && f.prompt === null && Object.values(f.pages).every((v) => v === null), JSON.stringify({ r: f.runNames, p: f.prompt }));
  const out = routineNumbers(f, { now: NOW });
  check('which the core turns into NOT MEASURED across the board and no exception', out.numbers.idleTicks.measured === false && out.numbers.ciRedRate.measured === false);
  check('a reader that throws is swallowed into null rather than killing the run', readFacts({ busesDir: 'C:/x', exists: () => true, reads: () => { throw new Error('boom'); }, readsDir: () => { throw new Error('boom'); }, ghRuns: () => null }).runNames === null);
}

console.log('\n7. The window default and the shape of the report');
{
  const out = routineNumbers(facts(), { now: NOW });
  check(`the default window is ${DEFAULT_WINDOW_DAYS} days and is reported back`, out.windowDays === DEFAULT_WINDOW_DAYS, String(out.windowDays));
  check('all five numbers are present under their own keys, so none can go missing silently',
    ['humanTouchesPerMapMonth', 'ciRedRate', 'idleTicks', 'relayedCommands', 'wordsBeforeActing'].every((k) => out.numbers[k]), JSON.stringify(Object.keys(out.numbers)));
  check('and every one carries a label and a target, so a pasted block explains itself',
    Object.values(out.numbers).every((v) => v.label && v.target), JSON.stringify(Object.values(out.numbers).map((v) => [v.label, v.target])));
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: the five numbers are not what routine_numbers.mjs says they are.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: two of the five refuse to be invented, a repository gh cannot answer for is not a red rate of zero, an uppercase feed is in the denominator, a decision only Peter can make is not a relayed command, and a tree that is not there reads as NOT MEASURED rather than as perfect.`);
}
