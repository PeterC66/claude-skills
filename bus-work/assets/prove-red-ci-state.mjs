#!/usr/bin/env node
/* Prove the CI-red row can appear, can be excused, and can go away (buses-data OA-251).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with no
 * arguments and no placeholders:
 *
 *   node prove-red-ci-state.mjs
 *
 * IT ONCE SCANNED THE THREE REPOSITORIES' WORKFLOW FILES and no longer does,
 * which is worth a line because the deletion is the finding. A tenth section
 * asserted that every push-triggered workflow set `run-name` from the marker, so
 * that a predicted red would be visible in the failure email. It would have
 * been -- in the email's BODY. GitHub titles the notification from the
 * workflow's static `name:`, Peter's inbox list shows only that subject, and a
 * line he never sees is not a signal. The `run-name` expressions came out of all
 * six workflows on the day they went in, and the assertion about them with them.
 * The marker itself survives, read from the commit subject by ci_state.mjs.
 *
 * WHAT IS BEING FALSIFIED. Not "does gh work" -- that is GitHub's problem and it
 * is why every edge in ci_state.mjs is injected. What is falsified here is the
 * VERDICT: that a red repository produces a rank-0 row, that a green one produces
 * none, that a marked commit is excused only while it is fresh, and that a
 * streak is measured from the moment the repository stopped being green rather
 * than from the latest push. That last one is the entire point of the row -- an
 * email already tells you about the latest push, and telling you that again is
 * what made 25 emails a day worthless.
 *
 * A CANCELLED RUN IS NOT A VERDICT and has its own case, because 8 of the last
 * 60 buses-data runs were cancelled and either wrong reading -- red, or green --
 * would corrupt every streak that spans one.
 *
 * THE WIRE IS ASSERTED ON ITS SOURCE, as in prove-red-landmark-answers.mjs and
 * for the same reason: on 2026-09-05 a template literal ate a backslash in
 * exactly such a line while 23 module assertions stayed green. Every source
 * assertion below is a literal string, never a regex.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarise, ciRows, gatherCiState, isNotStarted, refusalReason, MARKER, GRACE_HOURS, MAX_PROBES } from './ci_state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const NOW = Date.parse('2026-09-05T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const run = (conclusion, h, title = 'a commit', extra = {}) =>
  ({ conclusion, status: 'completed', createdAt: ago(h), displayTitle: title, databaseId: 1000 + h, url: 'https://x/1', ...extra });

const rowsFor = (runs, steps = []) => ciRows([{ name: 'testrepo', dir: '/fake', slug: 'o/testrepo', branch: 'main', state: summarise(runs, { now: NOW }), steps }]);

console.log('\n1. green says nothing');
{
  const s = summarise([run('success', 1), run('failure', 5), run('success', 9)], { now: NOW });
  check('the newest conclusive run is a success: verdict green', s.verdict === 'green', s.verdict);
  check('…and no row is produced', rowsFor([run('success', 1), run('failure', 5)]).length === 0);
  check('an older failure does not make a green repository red', s.verdict === 'green');
}

console.log('\n2. red, unexplained — the shape that filled the inbox');
{
  const runs = [run('failure', 1), run('failure', 3), run('failure', 8), run('success', 20)];
  const s = summarise(runs, { now: NOW });
  check('verdict red', s.verdict === 'red', s.verdict);
  check('the streak is 3, not 1', s.streak === 3, String(s.streak));
  check('redSince is the OLDEST consecutive failure, not the latest push', s.redSince === ago(8), s.redSince);
  check('hoursRed measures from that moment', Math.round(s.hoursRed) === 8, String(s.hoursRed));
  check('lastGreen is reported', s.lastGreen && s.lastGreen.createdAt === ago(20));
  check('not truncated — a green run is in the window', s.truncated === false);
  const [row] = rowsFor(runs);
  check('one row, rank 0 BROKEN', row && row.rank === 0, row && String(row.rank));
  check('…titled CI RED', row.title.startsWith('CI RED:'), row.title);
  check('…and it says nothing expected it', row.why.includes('NOTHING says anybody expected it'), row.why);
  check('…and it names the inherited-mail shape', row.why.includes('inherited this and mailed Peter'));
  check('…and its first step is a READ of the failing run', row.do[0].cmd.startsWith('gh run view') && row.do[0].cmd.includes('--log-failed'), row.do[0].cmd);
  check('…and it warns that the buses-data gate hides findings in the step summary', row.do[1].what.includes('step SUMMARY'));
}

console.log('\n3. the failing step names reach the row');
{
  const [row] = rowsFor([run('failure', 1)], ['unit / Links, anchors', 'unit / Every gate is scheduled']);
  check('both failing steps are named in the row', row.why.includes('Links, anchors') && row.why.includes('Every gate is scheduled'), row.why);
  const [plain] = rowsFor([run('failure', 1)], []);
  check('a run whose steps could not be read still produces the row', plain && plain.rank === 0);
  check('…and says nothing about failing steps rather than an empty list', !plain.why.includes('Failing:'), plain.why);
}

console.log('\n4. a CANCELLED run is not a verdict');
{
  const s = summarise([run('cancelled', 1), run('failure', 4), run('failure', 9), run('success', 30)], { now: NOW });
  check('a cancelled newest run does not hide the red under it', s.verdict === 'red', s.verdict);
  check('…and the streak counts only the conclusive runs', s.streak === 2, String(s.streak));
  const g = summarise([run('cancelled', 1), run('success', 4)], { now: NOW });
  check('a cancelled run above a success does not invent a red', g.verdict === 'green', g.verdict);
  const only = summarise([run('cancelled', 1), run('cancelled', 2)], { now: NOW });
  check('nothing but cancelled runs is UNKNOWN, not green and not red', only.verdict === 'unknown', only.verdict);
  check('…and unknown produces no row', ciRows([{ name: 'x', slug: 'o/x', branch: 'main', state: only, steps: [] }]).length === 0);
}

console.log('\n5. a run still in flight decides nothing');
{
  const s = summarise([{ conclusion: null, status: 'in_progress', createdAt: ago(0.1), displayTitle: 'now' }, run('failure', 2)], { now: NOW });
  check('the in-flight run is not the verdict', s.verdict === 'red', s.verdict);
  check('…but it is reported, so a row can say a fix may already be running', s.inFlight === true);
}

console.log('\n6. the marker buys grace, not amnesty');
{
  const fresh = [run('failure', 1, `Recut the fixtures ${MARKER} portal lands next`), run('success', 6)];
  const s = summarise(fresh, { now: NOW });
  check('a marked newest commit is predicted', s.predicted === true);
  check(`…and excused while under ${GRACE_HOURS} h`, s.excused === true);
  const [row] = rowsFor(fresh);
  check('…so the row drops to rank 8 HOUSEKEEPING', row.rank === 8, String(row.rank));
  check('…and its title says predicted', row.title.includes('predicted'), row.title);
  check('…and it still tells you to clear it', row.why.includes('buys'), row.why);

  const stale = [run('failure', GRACE_HOURS + 2, `Recut the fixtures ${MARKER}`), run('success', 40)];
  const s2 = summarise(stale, { now: NOW });
  check(`a marked red older than ${GRACE_HOURS} h is still predicted…`, s2.predicted === true);
  check('…but NOT excused', s2.excused === false);
  check('…and is ranked 0 like any other red', rowsFor(stale)[0].rank === 0, String(rowsFor(stale)[0].rank));

  // HOLE (C), found 2026-09-14 (buses-data OA-341). The marker was on the right
  // commit, `summarise` read it correctly, and the row then printed the exact
  // opposite in the sentence a reader acts on. `why` branched on `excused`
  // alone, so the moment the grace expired the explanation flipped from "a
  // session marked this" to "NOTHING says anybody expected it" -- over a
  // `predicted` that is still true two lines up. The RANK is right and must not
  // move: a marker buys GRACE_HOURS, not amnesty. What was wrong is the
  // explanation attached to it, which sent a scheduled tick re-deriving a
  // four-repository chain that the head commit's own subject announces.
  const staleRow = rowsFor(stale)[0];
  check('…and does NOT tell the reader that nobody expected it', !staleRow.why.includes('NOTHING says anybody expected it'), staleRow.why);
  check('…it says the marker IS there', staleRow.why.includes(MARKER), staleRow.why);
  check('…and its title says the grace expired rather than hiding the marker', staleRow.title.includes('predicted'), staleRow.title);
  // The control for the pair: an UNMARKED stale red must still say it plainly,
  // or the fix has simply deleted the sentence rather than made it conditional.
  const staleUnmarked = [run('failure', GRACE_HOURS + 2, 'an ordinary commit'), run('success', 40)];
  check('…while an UNMARKED stale red still says nothing expected it', rowsFor(staleUnmarked)[0].why.includes('NOTHING says anybody expected it'), rowsFor(staleUnmarked)[0].why);

  const inherited = [run('failure', 1, 'an ordinary commit'), run('failure', 3, `the marked one ${MARKER}`)];
  check('the marker excuses only the run that CARRIES it, never a later inheritor', summarise(inherited, { now: NOW }).excused === false);

  // WHAT THE MARKER LOOKS LIKE ONCE run-name RESOLVES IT. With a run-name
  // expression, `gh run list` reports displayTitle as the RUN NAME -- the raw
  // marker is gone and the workflow's sentence is there instead. Found on the
  // first real push after the expression landed (2026-09-05), not reasoned about.
  const resolved = [run('failure', 1, 'EXPECTED RED - a session predicted this, no action'), run('success', 9)];
  check('a run whose NAME the workflow already resolved is recognised', summarise(resolved, { now: NOW }).predicted === true);
  check('…and is excused while fresh', summarise(resolved, { now: NOW }).excused === true);
  const nameOnly = [{ ...run('failure', 1, 'some commit'), name: 'EXPECTED RED - a session predicted this, no action' }, run('success', 9)];
  check('the marker is read from `name` as well as `displayTitle`', summarise(nameOnly, { now: NOW }).predicted === true);
  const innocent = [run('failure', 1, 'Document how EXPECTED reds are RED flagged'), run('success', 9)];
  check('…and prose that merely contains both words separately does not trigger it', summarise(innocent, { now: NOW }).predicted === false);
}

console.log('\n7. truncation is stated, not guessed');
{
  const all = [run('failure', 1), run('failure', 5), run('failure', 30)];
  const s = summarise(all, { now: NOW });
  check('every run in the window red: truncated', s.truncated === true);
  check('…lastGreen is null rather than invented', s.lastGreen === null);
  check('…and the row says "at least"', rowsFor(all)[0].why.includes('at least'), rowsFor(all)[0].why);
  check('a window containing a green run is not truncated', summarise([run('failure', 1), run('success', 5)], { now: NOW }).truncated === false);
}

console.log('\n8. every edge fails SOFT — a worklist must still print');
{
  const failing = () => ({ status: 1, stdout: '', stderr: 'gh: could not authenticate\n' });
  const r = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: failing, now: NOW });
  check('a dead git/gh produces a warning', r.warnings.length === 1, JSON.stringify(r.warnings));
  check('…and no state, so no row', r.states.length === 0);

  const noOrigin = (cmd, args) => (args.includes('remote') ? { status: 128, stdout: '', stderr: 'no origin' } : { status: 0, stdout: '[]' });
  const r2 = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: noOrigin, now: NOW });
  check('a tree with no origin is named in a warning, not skipped in silence', r2.warnings[0].includes('no git origin'), r2.warnings[0]);

  const junk = (cmd, args) => (args.includes('remote') ? { status: 0, stdout: 'git@github.com:o/r.git\n' }
    : args.includes('symbolic-ref') ? { status: 0, stdout: 'origin/main\n' }
      : { status: 0, stdout: 'not json at all' });
  const r3 = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: junk, now: NOW });
  check('unparseable gh output is a warning and never a throw', r3.warnings[0].includes('unparseable'), JSON.stringify(r3.warnings));

  const green = (cmd, args) => (args.includes('remote') ? { status: 0, stdout: 'https://github.com/o/r\n' }
    : args.includes('symbolic-ref') ? { status: 0, stdout: 'origin/trunk\n' }
      : { status: 0, stdout: JSON.stringify([run('success', 1)]) });
  const r4 = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: green, now: NOW });
  check('an https remote resolves to owner/repo', r4.states[0].slug === 'o/r', r4.states[0].slug);
  check('the default branch is read from the remote HEAD, not assumed main', r4.states[0].branch === 'trunk', r4.states[0].branch);
  check('a green repository costs no second gh call', r4.states[0].steps.length === 0);
}

console.log('\n10. a run GitHub refused to START is not a red (2026-09-29)');
{
  // The words GitHub wrote on buses-data run 36587778478, verbatim.
  const BILL = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
  const refused = (h, reason = { text: BILL, budget: true }) => ({ ...run('failure', h), notStarted: reason });

  check('a job that failed with no steps was not started', isNotStarted([{ conclusion: 'failure', steps: [] }]));
  check('…but a job with even one step ran, and its failure is real', !isNotStarted([{ conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'success' }] }]));
  check('…and a run with NO jobs is not a refusal (that is a startup failure)', !isNotStarted([]));
  check('…and one real job beside a refused one makes the run real', !isNotStarted([{ conclusion: 'failure', steps: [] }, { conclusion: 'failure', steps: [{ name: 'x' }] }]));
  check('GitHub\'s billing annotation is recognised as a budget refusal', refusalReason([{ message: 'ubuntu-latest will migrate' }, { message: BILL }]).budget === true);
  check('…and quoted verbatim, not the unrelated annotation beside it', refusalReason([{ message: 'ubuntu-latest will migrate' }, { message: BILL }]).text === BILL);
  const other = refusalReason([{ message: 'The job was not started because the runner group is disabled' }]);
  check('a refusal for another reason is quoted but NOT called a budget', other.budget === false && other.text.includes('runner group'), JSON.stringify(other));
  check('no annotation at all still gives a reason, and not a budget', refusalReason([]).budget === false && refusalReason([]).text.length > 0);

  const overGreen = [refused(0.2), refused(0.5), run('success', 1)];
  const s = summarise(overGreen, { now: NOW });
  check('refused runs above a success leave the verdict GREEN', s.verdict === 'green', s.verdict);
  check('…and are counted as a not-run block of 2', s.notRun && s.notRun.count === 2, JSON.stringify(s.notRun));
  const rows = rowsFor(overGreen);
  check('…which produces NO ci-red row', !rows.some((r) => r.key.startsWith('ci-red-')), rows.map((r) => r.key).join());
  const [nr] = rows;
  check('…and exactly one ci-not-run row, at rank 8, a chore', rows.length === 1 && nr.key === 'ci-not-run-o/testrepo' && nr.rank === 8, nr && `${nr.key} ${nr.rank}`);
  check('…titled as a budget, so nobody opens the run', nr.title.includes('Actions budget exhausted'), nr.title);
  check('…quoting GitHub', nr.why.includes(BILL), nr.why);
  check('…and saying the commits are unchecked, not broken', nr.why.includes('UNCHECKED, not broken'), nr.why);

  const overRed = [refused(0.2), run('failure', 1), run('success', 9)];
  const r2 = rowsFor(overRed);
  check('refused runs above a REAL red leave the red row standing at rank 0', r2.some((r) => r.key.startsWith('ci-red-') && r.rank === 0), r2.map((r) => `${r.key}:${r.rank}`).join());
  check('…beside the not-run row', r2.some((r) => r.key.startsWith('ci-not-run-')));
  check('…and the red streak does not count the refusal', summarise(overRed, { now: NOW }).streak === 1, String(summarise(overRed, { now: NOW }).streak));

  const onlyRefused = summarise([refused(0.2), refused(3)], { now: NOW });
  check('nothing but refusals is UNKNOWN, not red', onlyRefused.verdict === 'unknown', onlyRefused.verdict);
  check('…and the block says "at least", because the window may be shorter than the outage', onlyRefused.notRun.atLeast === true);
  const history = summarise([run('success', 0.2), refused(3), run('success', 9)], { now: NOW });
  check('a refusal BELOW a run that ran is history: no not-run block', history.notRun === null, JSON.stringify(history.notRun));
  check('a cancelled run above a refusal does not hide it', summarise([run('cancelled', 0.1), refused(0.2), run('success', 1)], { now: NOW }).notRun?.count === 1);

  // The edge: jobs come from `gh run view --json jobs`, the reason from the job's
  // check-run annotations, and the walk must stop at the first run that ran.
  const calls = [];
  const fakeGh = (list, jobsById) => (cmd, args) => {
    calls.push(args.join(' '));
    if (args.includes('remote')) return { status: 0, stdout: 'https://github.com/o/r\n' };
    if (args.includes('symbolic-ref')) return { status: 0, stdout: 'origin/main\n' };
    if (args.includes('list')) return { status: 0, stdout: JSON.stringify(list) };
    if (args[0] === 'api') return { status: 0, stdout: JSON.stringify([{ message: BILL }]) };
    const id = Number(args[args.indexOf('view') + 1]);
    return { status: 0, stdout: JSON.stringify({ jobs: jobsById(id) }) };
  };
  const NONE = () => [{ databaseId: 7, name: 'status', conclusion: 'failure', steps: [] }];
  const list = [run('failure', 0.2), run('failure', 0.5), run('success', 1)];
  const g = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: fakeGh(list, NONE), now: NOW });
  check('the gatherer marks both refused runs and reads green under them', g.states[0].state.verdict === 'green' && g.states[0].state.notRun?.count === 2, JSON.stringify(g.states[0].state.notRun));
  check('…with the budget reason from the annotation', g.states[0].state.notRun.budget === true);
  check('…reading the annotations ONCE, not per run', calls.filter((c) => c.startsWith('api ')).length === 1, String(calls.filter((c) => c.startsWith('api ')).length));

  calls.length = 0;
  const REAL = () => [{ databaseId: 8, name: 'unit', conclusion: 'failure', steps: [{ name: 'Links', conclusion: 'failure' }] }];
  const g2 = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: fakeGh([run('failure', 0.2), run('failure', 0.5), run('success', 1)], REAL), now: NOW });
  check('a REAL red is still red through the gatherer', g2.states[0].state.verdict === 'red' && !g2.states[0].state.notRun);
  check('…its failing steps still reach the row', g2.states[0].steps.join() === 'unit / Links', g2.states[0].steps.join());
  check('…at the cost of ONE jobs call, not one per run and not two for the same run', calls.filter((c) => c.includes('view')).length === 1, String(calls.filter((c) => c.includes('view')).length));

  calls.length = 0;
  const many = Array.from({ length: MAX_PROBES + 10 }, (_, i) => run('failure', 0.1 * (i + 1)));
  const g3 = gatherCiState({ dirs: [{ name: 'x', dir: '/fake' }], run: fakeGh(many, NONE), now: NOW });
  check(`the walk stops at MAX_PROBES (${MAX_PROBES}) jobs calls`, calls.filter((c) => c.includes('view')).length === MAX_PROBES, String(calls.filter((c) => c.includes('view')).length));
  check('…and the unprobed older failures are dropped, not read as red', g3.states[0].state.verdict === 'unknown', g3.states[0].state.verdict);
  check('…so the row says "at least"', ciRows(g3.states)[0].why.includes('at least'), ciRows(g3.states)[0].why);
}

console.log('\n9. the wire — asserted on its SOURCE');
{
  const wl = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  const conc = fs.readFileSync(path.join(HERE, 'concurrency.mjs'), 'utf8');
  const mod = fs.readFileSync(path.join(HERE, 'ci_state.mjs'), 'utf8');
  check('worklist.mjs imports gatherCiState and ciRows from ./ci_state.mjs', wl.includes("import { gatherCiState, ciRows } from './ci_state.mjs';"));
  check('…and calls the gatherer', wl.includes('gatherCiState({ dirs: CI_DIRS'));
  check('…adds every row it returns', wl.includes('for (const it of ciRows(ci.states)) add(it);'));
  check('…and pushes its warnings rather than dropping them', wl.includes('for (const w of ci.warnings) warnings.push(w);'));
  check('…and it is on by DEFAULT, opted out with --no-ci', wl.includes("const NO_CI = args['no-ci']"));
  check('the row key prefix is the one the module writes', mod.includes('key: `ci-red-${s.slug}`'));
  check('concurrency.mjs classifies ci-red- as contending with nothing', conc.includes("if (key.startsWith('ci-red-')) return [];"));
  check('the not-run row key prefix is the one the module writes', mod.includes('key: `ci-not-run-${s.slug}`'));
  check('concurrency.mjs classifies ci-not-run- as contending with nothing', conc.includes("if (key.startsWith('ci-not-run-')) return [];"));
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : '\n✓ all CI-state checks passed — the row appears, is excused only while fresh, goes away, and a refused run is never a red');
process.exit(bad ? 1 : 0);
