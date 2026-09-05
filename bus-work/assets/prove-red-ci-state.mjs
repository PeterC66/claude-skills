#!/usr/bin/env node
/* Prove the CI-red row can appear, can be excused, and can go away (buses-data OA-251).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-ci-state.mjs [<extra repo dir> ...]
 *
 * Every argument is optional and is a REPOSITORY ROOT whose .github/workflows/
 * should be checked for the run-name marker. With none given it checks the
 * claude-skills tree this file sits in, plus buses-data and the portal if they
 * are beside it, and SAYS which it could not see -- a silent skip is how a
 * checker comes to cover one repository and claim three.
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
import { summarise, ciRows, gatherCiState, MARKER, GRACE_HOURS } from './ci_state.mjs';

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

  const inherited = [run('failure', 1, 'an ordinary commit'), run('failure', 3, `the marked one ${MARKER}`)];
  check('the marker excuses only the run that CARRIES it, never a later inheritor', summarise(inherited, { now: NOW }).excused === false);
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
}

console.log('\n10. every workflow that runs on push carries the run-name marker');
{
  const trees = [];
  const missing = [];
  const add = (name, dir) => { if (fs.existsSync(path.join(dir, '.github', 'workflows'))) trees.push({ name, dir }); else missing.push(`${name} (${dir})`); };
  add('claude-skills', path.resolve(HERE, '..', '..'));
  for (const d of process.argv.slice(2)) add(path.basename(path.resolve(d)), path.resolve(d));
  if (process.argv.length <= 2) {
    add('buses-data', process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses');
    add('community-bus-maps', process.env.BUSMAPS_PORTAL || 'C:/Claude/community-bus-maps');
  }

  let seen = 0;
  for (const t of trees) {
    const dir = path.join(t.dir, '.github', 'workflows');
    for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // The `on:` block, textually: from a line that is exactly `on:` to the next
      // line starting in column 0. Enough to answer "does this run on push", and
      // it needs no YAML parser, which this tree deliberately has no dependency on.
      const lines = src.split(/\r?\n/);
      const i = lines.findIndex((l) => /^on:\s*$/.test(l));
      if (i < 0) continue;
      let onPush = false;
      for (let j = i + 1; j < lines.length && !/^\S/.test(lines[j]); j++) if (/^\s{2}push:\s*$/.test(lines[j])) onPush = true;
      if (!onPush) continue;
      seen += 1;
      check(`${t.name}/${f} runs on push and its run-name names ${MARKER}`,
        /^run-name:/m.test(src) && src.includes(MARKER),
        /^run-name:/m.test(src) ? `run-name present but does not mention ${MARKER}` : 'no run-name: at column 0');
    }
  }
  check('at least one workflow was actually read — a scan that finds none proves nothing', seen > 0, String(seen));
  if (missing.length) console.log(`      (not checked out here, so not checked: ${missing.join(', ')})`);
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : '\n✓ all CI-state checks passed — the row appears, is excused only while fresh, and goes away');
process.exit(bad ? 1 : 0);
