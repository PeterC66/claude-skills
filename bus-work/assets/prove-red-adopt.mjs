#!/usr/bin/env node
/* Prove the loop's adoption of Peter's edits refuses what it must, adopts what it
 * may, and that each refusal can be seen to fail (buses-data OA-542).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-adopt.mjs
 *
 * THREE PARTS. The cases drive decide() with stub facts, one exclusion each, each
 * paired with the case that adopts, because a guard that refuses everything is as
 * useless as one that refuses nothing. The real-repository part builds a
 * throwaway git repository with a hold folder and runs gather() and apply() end to
 * end, so a porcelain parser agreeing with a stub is not mistaken for one agreeing
 * with git. Then the MUTANTS: each takes a copy of adopt.mjs with ONE guard broken
 * — an exclusion deleted, the exact-diff match loosened — imports it, reruns the
 * cases and the repository part, and must see at least one of them go red. A
 * mutant nobody catches is a guard nothing proves, and fails the harness. A mutant
 * whose target text is no longer in adopt.mjs fails it too, so a refactor cannot
 * retire a mutant by renaming the line it breaks.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'adopt.mjs');
const NOW = Date.parse('2026-10-01T12:00:00Z');
const OLD = NOW - 45 * 60000;
const GREEN = { ok: true, failed: [] };

const SETTINGS_DIFF = [
  'diff --git a/.claude/settings.json b/.claude/settings.json',
  'index 1111111..2222222 100644',
  '--- a/.claude/settings.json',
  '+++ b/.claude/settings.json',
  '@@ -3,8 +3,6 @@',
  '     "deny": [',
  '       "Read(Areas/**/S4-generate/**/*.html)",',
  '-      "Read(Areas/**/S4-generate/**/*.svg)",',
  '-      "Read(Places/**/S4-generate/**/*.svg)",',
  '       "Read(**/node_modules/**)",',
  '',
].join('\n');

const holdText = (file, diff) => [
  '# The loop is stopped until the edit is committed',
  '',
  '**Raised by:** sched-2127, 2026-09-30',
  '',
  `**File:** \`${file}\``,
  '',
  '## What is needed from you',
  '',
  'The loop is stopped until this change is made and committed.',
  '',
  ...(diff == null ? [] : ['```diff', diff.trimEnd(), '```', '']),
].join('\n');

const hold = (file, diff, ref = 'h1') => ({ ref, file: `${ref}.md`, namesPath: file, text: holdText(file, diff) });
const docDiff = (p, from, to) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,2 +1,2 @@\n # T\n-${from}\n+${to}\n`;

/** Every case: a label, the facts, and whether the one path must be adopted. */
function cases(m) {
  const S = '.claude/settings.json';
  const D = 'Documentation/README - Example.md';
  const one = (code, p) => [{ code, path: p }];
  return [
    // rule (a): the exact-diff match
    ['(a) the settings edit the hold spells out exactly is adopted', { entries: one(' M', S), holds: [hold(S, SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF } }, true],
    ['(a) the same edit with CRLF in the hold still matches', { entries: one(' M', S), holds: [hold(S, SETTINGS_DIFF.replace(/\n/g, '\r\n'))], diffs: { [S]: SETTINGS_DIFF } }, true],
    ['(a) the hold\'s change PLUS one more line in the tree is refused', { entries: one(' M', S), holds: [hold(S, SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF.replace('       "Read(**/node_modules/**)",', '+      "Bash(curl *)",\n       "Read(**/node_modules/**)",') } }, false],
    ['(a) only HALF the hold\'s change in the tree is refused', { entries: one(' M', S), holds: [hold(S, SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF.replace('-      "Read(Places/**/S4-generate/**/*.svg)",\n', '') } }, false],
    ['(a) the same count of changed lines but different content is refused', { entries: one(' M', S), holds: [hold(S, SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF.replace('Places/**/S4-generate/**/*.svg', 'Places/**/S4-generate/**/*.png') } }, false],
    ['(a) a difference of whitespace alone is refused', { entries: one(' M', S), holds: [hold(S, SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF.replace('-      "Read(Places', '-     "Read(Places') } }, false],
    ['(a) a hold that spells out no diff block adopts nothing', { entries: one(' M', S), holds: [hold(S, null)], diffs: { [S]: SETTINGS_DIFF } }, false],
    ['(a) a hold naming ANOTHER file does not adopt this one', { entries: one(' M', S), holds: [hold('.claude/other.json', SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF } }, false],
    ['(a) a doc a hold names, with the wrong change, is not rescued by (b)', { entries: one(' M', D), holds: [hold(D, docDiff(D, 'a', 'b'))], diffs: { [D]: docDiff(D, 'a', 'c') }, mtimes: { [D]: OLD }, checks: GREEN }, false],
    // the never-roots, reached through (a), the only rule that could otherwise take them
    ['never Correspondence/, even with a hold and an exact diff', { entries: one(' M', 'Correspondence/CORR-001/008.md'), holds: [hold('Correspondence/CORR-001/008.md', docDiff('x', 'a', 'b'))], diffs: { 'Correspondence/CORR-001/008.md': docDiff('x', 'a', 'b') } }, false],
    ['never Areas/, even with a hold and an exact diff', { entries: one(' M', 'Areas/StIves/config.json'), holds: [hold('Areas/StIves/config.json', docDiff('x', 'a', 'b'))], diffs: { 'Areas/StIves/config.json': docDiff('x', 'a', 'b') } }, false],
    ['never Places/, even with a hold and an exact diff', { entries: one(' M', 'Places/Tesco/config.json'), holds: [hold('Places/Tesco/config.json', docDiff('x', 'a', 'b'))], diffs: { 'Places/Tesco/config.json': docDiff('x', 'a', 'b') } }, false],
    // the status classes, each reached through (b), where a quiet green doc would otherwise pass
    ['(b) a quiet doc, green checks: adopted', { entries: one(' M', D), mtimes: { [D]: OLD }, checks: GREEN }, true],
    ['an UNTRACKED quiet doc is refused', { entries: one('??', D), mtimes: { [D]: OLD }, checks: GREEN }, false],
    ['a STAGED quiet doc is refused', { entries: one('M ', D), mtimes: { [D]: OLD }, checks: GREEN }, false],
    ['a partly staged quiet doc is refused', { entries: one('MM', D), mtimes: { [D]: OLD }, checks: GREEN }, false],
    ['a DELETED doc is refused', { entries: one(' D', D), mtimes: { [D]: OLD }, checks: GREEN }, false],
    ['a deleted settings file is refused even with a hold spelling the deletion', { entries: one(' D', S), holds: [hold(S, SETTINGS_DIFF)], diffs: { [S]: SETTINGS_DIFF } }, false],
    ['a renamed doc is refused', { entries: one('R ', D), mtimes: { [D]: OLD }, checks: GREEN }, false],
    // rule (b)'s own limits
    ['(b) a doc touched 29 minutes ago is refused', { entries: one(' M', D), mtimes: { [D]: NOW - 29 * 60000 }, checks: GREEN }, false],
    ['(b) a doc touched exactly 30 minutes ago is adopted', { entries: one(' M', D), mtimes: { [D]: NOW - 30 * 60000 }, checks: GREEN }, true],
    ['(b) a doc with a future mtime is refused', { entries: one(' M', D), mtimes: { [D]: NOW + 60000 }, checks: GREEN }, false],
    ['(b) a doc when a checker is red is refused', { entries: one(' M', D), mtimes: { [D]: OLD }, checks: { ok: false, failed: ['check-doc-links'] } }, false],
    ['(b) a doc when the checkers did not run is refused', { entries: one(' M', D), mtimes: { [D]: OLD }, checks: null }, false],
    ['(b) Development Docs/ is in scope', { entries: one(' M', 'Development Docs/round.md'), mtimes: { 'Development Docs/round.md': OLD }, checks: GREEN }, true],
    ['(b) BusMapsUK/ is in scope', { entries: one(' M', 'BusMapsUK/pricing.md'), mtimes: { 'BusMapsUK/pricing.md': OLD }, checks: GREEN }, true],
    ['(b) loop/README.md — the tick\'s own prompt — is out of scope', { entries: one(' M', 'loop/README.md'), mtimes: { 'loop/README.md': OLD }, checks: GREEN }, false],
    ['(b) CLAUDE.md at the root is out of scope', { entries: one(' M', 'CLAUDE.md'), mtimes: { 'CLAUDE.md': OLD }, checks: GREEN }, false],
    ['(b) a script under Documentation/ is not a document', { entries: one(' M', 'Documentation/check-doc-coverage.mjs'), mtimes: { 'Documentation/check-doc-coverage.mjs': OLD }, checks: GREEN }, false],
    ['(b) a settings change no hold spells out is refused, however quiet', { entries: one(' M', S), mtimes: { [S]: OLD }, checks: GREEN, diffs: { [S]: SETTINGS_DIFF } }, false],
    ['(b) the generated backlog index is refused', { entries: one(' M', 'Development Docs/open-actions.md'), mtimes: { 'Development Docs/open-actions.md': OLD }, checks: GREEN }, false],
  ].map(([label, f, want]) => ({ label, f: { holds: [], diffs: {}, mtimes: {}, checks: null, now: NOW, ...f }, want }));
}

function runCases(m, log) {
  let bad = 0, ran = 0;
  for (const c of cases(m)) {
    ran++;
    let got;
    try { got = m.decide(c.f); } catch (e) { got = [{ adopt: 'threw: ' + e.message }]; }
    const ok = got.length === 1 && got[0].adopt === c.want;
    if (!ok) bad++;
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}${ok ? '' : ' -- ' + JSON.stringify(got.map((v) => ({ adopt: v.adopt, why: v.why })))}`);
  }
  return { bad, ran };
}

/** The pieces outside decide(): the porcelain parser, live holds, and apply()'s re-checks. */
function runEdges(m, log) {
  let bad = 0, ran = 0;
  const check = (label, ok, detail) => { ran++; if (!ok) bad++; log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

  const z = m.parseStatusZ(' M a b.md\0R  new.md\0old.md\0?? x.md\0');
  check('-z porcelain: a spaced path verbatim, a rename\'s source consumed', z.length === 3 && z[0].path === 'a b.md' && z[1].path === 'new.md' && z[2].code === '??', JSON.stringify(z));

  let tmp;
  try {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'oa542-holds-'));
    const ym = path.join(tmp, 'your-move');
    mkdirSync(ym);
    writeFileSync(path.join(ym, 'live.md'), holdText('.claude/settings.json', SETTINGS_DIFF));
    writeFileSync(path.join(ym, 'draft.md'), '# A finding\n\n**File:** `Documentation/x.md`\n\nNo ask here.\n');
    const live = m.liveHolds(ym);
    check('a live hold counts and a DRAFT naming a path does not', live.length === 1 && live[0].namesPath === '.claude/settings.json', JSON.stringify(live.map((h) => h.ref)));
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }

  // apply() re-reads the path before committing it.
  const v = { path: '.claude/settings.json', adopt: true, rule: 'a', lines: ['-x'], hold: 'h1', holdFile: 'h1.md' };
  let committed = 0;
  const commit = () => { committed++; return { ok: true }; };
  const gitMoved = (dir, argv) => (argv[0] === 'status' ? ' M .claude/settings.json\0' : argv[0] === 'diff' ? '@@ -1 +1 @@\n-x\n+y\n' : '');
  const r1 = m.apply({ root: 'C:/none', verdicts: [v], by: 'sched-test', git: gitMoved, commit, now: NOW });
  check('apply(): a diff that grew since the decision is not committed', committed === 0 && r1.done[0] && !r1.done[0].ok, JSON.stringify(r1.done));
  const vb = { path: 'Documentation/x.md', adopt: true, rule: 'b', mtime: OLD, ageMin: 45 };
  const gitB = (dir, argv) => (argv[0] === 'status' ? ' M Documentation/x.md\0' : '');
  const r2 = m.apply({ root: 'C:/none', verdicts: [vb], by: 'sched-test', git: gitB, commit, now: NOW, stat: () => ({ mtimeMs: OLD + 1000 }) });
  check('apply(): a doc written again since the decision is not committed', committed === 0 && r2.done[0] && !r2.done[0].ok, JSON.stringify(r2.done));
  const gitGone = (dir, argv) => (argv[0] === 'status' ? 'M  Documentation/x.md\0' : '');
  const r3 = m.apply({ root: 'C:/none', verdicts: [vb], by: 'sched-test', git: gitGone, commit, now: NOW, stat: () => ({ mtimeMs: OLD }) });
  check('apply(): a doc staged since the decision is not committed', committed === 0 && r3.done[0] && !r3.done[0].ok, JSON.stringify(r3.done));
  return { bad, ran };
}

/** End to end against a real repository. */
function runRepo(m, log) {
  let bad = 0, ran = 0;
  const check = (label, ok, detail) => { ran++; if (!ok) bad++; log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };
  let tmp;
  try {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'oa542-repo-'));
    const g = (...a) => execFileSync('git', ['-C', tmp, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'harness@example.invalid');
    g('config', 'user.name', 'harness');
    g('config', 'core.autocrlf', 'false');
    const w = (p, t) => { mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); writeFileSync(path.join(tmp, p), t); };
    const settingsBefore = '{\n  "permissions": {\n    "deny": [\n      "Read(Areas/**/S4-generate/**/*.html)",\n      "Read(Areas/**/S4-generate/**/*.svg)",\n      "Read(Places/**/S4-generate/**/*.svg)",\n      "Read(**/node_modules/**)"\n    ]\n  }\n}\n';
    w('.gitignore', 'loop/*\n!loop/README.md\n');
    w('.claude/settings.json', settingsBefore);
    w('Documentation/README - Example.md', '# T\n\nold\n');
    w('Documentation/README - Fresh.md', '# T\n\nold\n');
    w('Correspondence/CORR-001/008.md', 'Dear\n');
    g('add', '.gitignore', '.claude/settings.json', 'Documentation/README - Example.md', 'Documentation/README - Fresh.md', 'Correspondence/CORR-001/008.md');
    g('commit', '-q', '-m', 'seed');

    w('.claude/settings.json', settingsBefore.replace('      "Read(Areas/**/S4-generate/**/*.svg)",\n      "Read(Places/**/S4-generate/**/*.svg)",\n', ''));
    const realDiff = g('diff', '--no-color', 'HEAD', '--', '.claude/settings.json');
    w('loop/your-move/s4-svg-read-deny.md', holdText('.claude/settings.json', realDiff));
    w('Documentation/README - Example.md', '# T\n\nnew\n');
    w('Documentation/README - Fresh.md', '# T\n\nnew\n');
    w('Documentation/README - Untracked.md', '# T\n');
    w('Correspondence/CORR-001/008.md', 'Dear Peter\n');
    const old = new Date(OLD);
    for (const p of ['Documentation/README - Example.md', 'Documentation/README - Untracked.md', 'Correspondence/CORR-001/008.md']) utimesSync(path.join(tmp, p), old, old);
    utimesSync(path.join(tmp, 'Documentation/README - Fresh.md'), new Date(NOW - 5 * 60000), new Date(NOW - 5 * 60000));

    check('the tree on main with nothing in flight is one a tick may commit in', m.treeRefusal(tmp) === null, m.treeRefusal(tmp));
    const facts = m.gather({ root: tmp, checks: () => GREEN, now: NOW });
    const verdicts = m.decide(facts);
    const by = Object.fromEntries(verdicts.map((v) => [v.path, v]));
    check('the settings edit is adopted under (a)', by['.claude/settings.json']?.adopt === true && by['.claude/settings.json']?.rule === 'a', JSON.stringify(by['.claude/settings.json']));
    check('the quiet doc is adopted under (b)', by['Documentation/README - Example.md']?.adopt === true, JSON.stringify(by['Documentation/README - Example.md']));
    check('the doc touched five minutes ago is refused', by['Documentation/README - Fresh.md']?.adopt === false, JSON.stringify(by['Documentation/README - Fresh.md']));
    check('the untracked doc is refused', by['Documentation/README - Untracked.md']?.adopt === false, JSON.stringify(by['Documentation/README - Untracked.md']));
    check('the letter is refused', by['Correspondence/CORR-001/008.md']?.adopt === false, JSON.stringify(by['Correspondence/CORR-001/008.md']));

    const res = m.apply({ root: tmp, verdicts, by: 'sched-test', now: NOW });
    const subjects = g('log', '--format=%s').trim().split('\n');
    check('two commits, one per adopted path, with the adopt: subject', subjects[0] && subjects.filter((s) => s.startsWith('adopt: ')).length === 2 && subjects.includes("adopt: Peter's edit to .claude/settings.json"), JSON.stringify(subjects));
    check('apply() reports both as read back', !res.failed && res.done.length === 2 && res.done.every((d) => d.ok), JSON.stringify(res.done));
    const status = g('status', '--porcelain', '-uall');
    check('what was refused is still dirty, untouched', /Fresh\.md/.test(status) && /Untracked\.md/.test(status) && /CORR-001/.test(status) && !/settings\.json/.test(status) && !/Example\.md/.test(status), status);
    check('the committed settings file has no S4 svg line', !/S4-generate\/\*\*\/\*\.svg/.test(g('show', 'HEAD~1:.claude/settings.json') + g('show', 'HEAD:.claude/settings.json')));
    const retired = path.join(tmp, 'loop', 'adhoc', 'done', 's4-svg-read-deny.md');
    check('the hold is retired to adhoc/done with a RESOLVED section', existsSync(retired) && !existsSync(path.join(tmp, 'loop', 'your-move', 's4-svg-read-deny.md')) && /## RESOLVED[\s\S]*adopt: Peter's edit to \.claude\/settings\.json/.test(readFileSync(retired, 'utf8')));

    g('checkout', '-q', '-b', 'work/x');
    check('a checkout off main is refused', /not main/.test(m.treeRefusal(tmp) || ''), m.treeRefusal(tmp));
  } catch (e) {
    check('the real-repository part could run', false, e.message);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  return { bad, ran };
}

async function runAll(m, log) {
  const a = runCases(m, log);
  const b = runEdges(m, log);
  const c = runRepo(m, log);
  return { bad: a.bad + b.bad + c.bad, ran: a.ran + b.ran + c.ran };
}

/** One guard broken each. `from` must appear in adopt.mjs exactly once. */
const MUTANTS = [
  ['the never-roots deleted', "if (under(p, NEVER_ROOTS)) {", 'if (false) {'],
  ['untracked let through', "if (e.code !== ' M') {", "if (e.code !== ' M' && e.code !== '??') {"],
  ['staged let through', "if (e.code !== ' M') {", "if (e.code !== ' M' && e.code[0] === ' ') {"],
  ['deleted let through', "if (e.code !== ' M') {", "if (e.code !== ' M' && e.code !== ' D') {"],
  ['the generated index let through', 'if (GENERATED.has(p)) {', 'if (false) {'],
  ['(a) the match ignores the count', 'if (want.length === got.length && want.every((l, i) => l === got[i]))', 'if (want.every((l, i) => l === got[i]))'],
  ['(a) the match ignores the content', 'if (want.length === got.length && want.every((l, i) => l === got[i]))', 'if (want.length === got.length)'],
  ['(a) the match ignores whitespace', "const l = raw.replace(/\\r$/, '');", "const l = raw.replace(/\\s+/g, ' ').trimEnd();"],
  ['(a) no diff block reads as a match', "if (spelled === null) { tried.push(`${h.ref}: spells out no \\`\\`\\`diff block`); continue; }", 'if (spelled === null) { matched = h; break; }'],
  ['(a) a hold-named path falls through to (b)', 'if (naming.length) {', 'if (naming.some((h) => { const w = changedLines(holdDiff(h.text)); const g2 = changedLines(diffs[p]); return w.length && w.length === g2.length && w.every((l, i) => l === g2[i]); })) {'],
  ['(b) not only .md', "if (!/\\.md$/i.test(p)) {", 'if (false) {'],
  ['(b) not only the three roots', 'if (!under(p, DOC_ROOTS)) {', 'if (false) {'],
  ['(b) the 30 minutes deleted', 'if (ageMin < QUIET_MIN) {', 'if (false) {'],
  ['(b) a red checker ignored', 'if (!checks.ok) {', 'if (false) {'],
  ['(b) checkers not run reads as green', "if (!checks) { refuse('rule (b): the checkers were not run'); continue; }", 'if (!checks) { checks = { ok: true }; }'],
  ['a draft counts as a live hold', 'for (const f of classify(readYourMoveDir(yourMoveDir)).holds) {', 'for (const f of readYourMoveDir(yourMoveDir)) {'],
  ['apply() skips the (a) re-read', "if (again.length !== before.length || again.some((l, i) => l !== before[i])) {", 'if (false) {'],
  ['apply() skips the (b) re-read', 'if (m !== v.mtime) {', 'if (false) {'],
  ['apply() skips the status re-read', "if (st.length !== 1 || st[0].code !== ' M') {", 'if (false) {'],
  ['the off-main refusal deleted', "if (branch.trim() !== 'main') return", "if (false) return"],
];

async function main() {
  console.log('\n1. adopt.mjs as written');
  const real = await import(pathToFileURL(SOURCE).href);
  const first = await runAll(real, (l) => console.log(l));
  if (first.bad) {
    console.log(`\nFAILED — ${first.bad} of ${first.ran} assertions did not hold against adopt.mjs as written; the mutants were not run.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n2. Mutants — each breaks one guard and must turn something above red`);
  const src = readFileSync(SOURCE, 'utf8')
    .replace("from './engine.mjs'", `from '${pathToFileURL(path.join(HERE, 'engine.mjs')).href}'`)
    .replace("from './loop_your_move.mjs'", `from '${pathToFileURL(path.join(HERE, 'loop_your_move.mjs')).href}'`);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oa542-mutants-'));
  let survived = 0, missing = 0;
  try {
    for (let i = 0; i < MUTANTS.length; i++) {
      const [name, from, to] = MUTANTS[i];
      const n = src.split(from).length - 1;
      if (n !== 1) { missing++; console.log(`  FAIL ${name} -- its target appears ${n} times in adopt.mjs, not once`); continue; }
      const file = path.join(dir, `m${i}.mjs`);
      writeFileSync(file, src.replace(from, to));
      // A mutant that does not even load proves nothing about the guard it was
      // meant to break, so it counts as one that could not be applied.
      let mod;
      try { mod = await import(pathToFileURL(file).href); } catch (e) { missing++; console.log(`  FAIL ${name} -- the mutant does not load (${e.message}), so it tests nothing`); continue; }
      const r = await runAll(mod, () => {});
      const caught = r.bad > 0;
      if (!caught) survived++;
      console.log(`  ${caught ? 'ok  ' : 'FAIL'} ${name} -- ${caught ? `caught by ${r.bad} assertion(s)` : 'SURVIVED: nothing went red'}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }

  console.log('');
  if (survived || missing) {
    console.log(`FAILED — ${survived} mutant(s) survived and ${missing} could not be applied, of ${MUTANTS.length}: a guard in adopt.mjs is not proved.`);
    process.exitCode = 1;
  } else {
    console.log(`OK — all ${first.ran} assertions held, and each of the ${MUTANTS.length} mutants turned at least one red: every exclusion and the exact-diff match can be seen to fail.`);
  }
}

await main();
