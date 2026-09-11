// Falsify check-doc-acronyms.mjs: use a short form nobody can look up, and
// insist it notices — then prove each way of DEFINING one is recognised, and
// that a near miss of each is not.
//
// WHY BOTH DIRECTIONS, AND WHY THE SECOND ONE HARDER. A false finding is how a
// gate gets muted in its first week, so the controls matter. But widening what
// counts as *already defined* is the DANGEROUS direction: it silences the
// finding that should have fired, and leaves a green check saying the opposite
// of the truth. That is not hypothetical — on 2026-09-01 `check-doc-links.mjs`
// gained three new declaration forms and one of them read a paragraph that
// merely LOCATED something as a declaration, silencing the C1 it should have
// raised. So every recogniser below is falsified in both directions, including
// the control that a bare `EP` with *Enhanced Partnership* nowhere in the
// document is still a finding.
//
// THE FIRST CASE IS THE ONE THAT ALMOST SHIPPED. The rule that separates a short
// form from the house style shouting in capitals began as *if the lower-case
// form appears in prose at all, it is an ordinary word* — and `ep` appears once
// in this estate, so that version silently swallowed the exact abbreviation
// buses-data OA-300 was filed about. It was caught by measuring the two
// populations (short forms topped out at 2 lower-case uses, shouts started at
// 51) rather than by reasoning, and it is case 2 here for ever.
//
// Run from anywhere. The path below is a real path on this machine, not a
// placeholder:
//   node "C:/u3a St Ives/.claude/skills/tools/prove-red-doc-acronyms.mjs"

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('./check-doc-acronyms.mjs', import.meta.url));

/** Write a fixture tree and run the checker over it with --root. */
function run(files, decl, opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'acronyms-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  if (decl) writeFileSync(path.join(dir, '.doc-acronyms.json'), JSON.stringify(decl, null, 2), 'utf8');
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir], { encoding: 'utf8', cwd: opts.cwd });
  if (!opts.keep) rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), dir };
}

let failed = 0;
const report = (ok, line, label = 'RED  ') => { if (!ok) failed++; console.log(`  ${ok ? label : 'MISS '} ${line}`); };

/* Two documents that both use EP and neither expands it. Two, because a short
 * form confined to ONE document is that document's own vocabulary and
 * deliberately out of scope — the same rule that keeps `P8b` and `H1` out. */
const USES_EP_A = [
  '# The outreach case',
  '',
  'The multi-operator information your EP scheme requires is exactly what a printed sheet is.',
  '',
].join('\n');
const USES_EP_B = [
  '# Policy position',
  '',
  'An authority with an EP has already accepted the duty; one without it has not.',
  '',
].join('\n');

console.log('A short form nobody can look up — the checker must fail and name it:\n');

{
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B });
  report(code === 1 && /✗ EP/.test(out), 'EP used in two documents and expanded in neither'
    + (code === 1 ? '' : `  <-- exited ${code}\n${out}`));
}

/* CASE 2 — THE ONE THAT ALMOST SHIPPED. `ep` appears once, lower case, as prose.
 * Under the no-threshold version of the word rule that made EP an ordinary
 * English word and the finding vanished. */
{
  const { code, out } = run({
    'a.md': USES_EP_A + '\nA stray lower-case ep in a sentence, as happens in a converted PDF.\n',
    'b.md': USES_EP_B,
  });
  report(code === 1 && /✗ EP/.test(out),
    'EP where the lower-case form appears ONCE — still a finding, which the first design got wrong'
    + (code === 1 ? '' : `  <-- exited ${code}, the word rule swallowed it\n${out}`));
}

/* CASE 3 — NAMING IS NOT EXPANDING. A definitions document whose row mentions
 * the token and leaves the "in full" cell empty defines nothing. */
{
  const GLOSS = ['# Glossary', '', '| Short form | In full |', '|---|---|', '| **EP** |  |', ''].join('\n');
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B, 'gloss.md': GLOSS },
    { definitions: ['gloss.md'] });
  report(code === 1 && /✗ EP/.test(out), 'a glossary row that names EP and expands it to nothing'
    + (code === 1 ? '' : `  <-- exited ${code}\n${out}`));
}

/* CASE 4 — A PARENTHETICAL WHOSE INITIALS DO NOT SPELL THE TOKEN. This is the
 * `check-doc-links.mjs` shape: any capitalised phrase before any bracket must
 * not count, or every short form in the estate is silenced by the first
 * sentence that happens to end in one. */
{
  const NEAR = ['# Near miss', '', 'The Enhanced Programme (EP) is not what EP stands for here.', ''].join('\n');
  const { code, out } = run({ 'a.md': NEAR, 'b.md': USES_EP_B });
  report(code === 1 && /✗ EP/.test(out), 'a bracket whose initials spell EP by accident — Enhanced Programme is still not a definition'
    + (code === 1 ? '' : `  <-- exited ${code}\n${out}`));
}

/* CASE 5 — EXPANDED IN ONE DOCUMENT AND USED BARE IN TWO OTHERS. An expansion is
 * local by construction: it defines the term for the reader of that document and
 * nobody else, so the finding must name the ones left stranded. */
{
  const EXPANDED = ['# Where it is explained', '', 'An Enhanced Partnership (EP) is the Bus Services Act 2017 arrangement.', ''].join('\n');
  const { code, out } = run({ 'expl.md': EXPANDED, 'a.md': USES_EP_A, 'b.md': USES_EP_B });
  const namesBoth = /a\.md:/.test(out) && /b\.md:/.test(out) && !/expl\.md:/.test(out);
  report(code === 1 && /✗ EP/.test(out) && namesBoth,
    'expanded in one document and bare in two — the finding names the two, and not the one'
    + (code === 1 && namesBoth ? '' : `  <-- exited ${code}\n${out}`));
}

console.log('\nThe three ways a short form gets a home — each must be recognised:\n');

{
  const GLOSS = ['# Glossary', '', '| Short form | In full |', '|---|---|',
    '| **EP** | Enhanced Partnership | the Bus Services Act 2017 arrangement |', ''].join('\n');
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B, 'gloss.md': GLOSS },
    { definitions: ['gloss.md'] });
  report(code === 0, 'a row in a declared definitions document' + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}
{
  const A = USES_EP_A.replace('your EP scheme', 'your Enhanced Partnership (EP) scheme');
  const B = USES_EP_B.replace('an EP has', 'an Enhanced Partnership (EP) has');
  const { code, out } = run({ 'a.md': A, 'b.md': B });
  report(code === 0, 'a parenthetical expansion in each document that uses it' + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}
{
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B }, { defined: { EP: 'Enhanced Partnership' } });
  report(code === 0, 'an entry in the repository\'s own .doc-acronyms.json' + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}
{
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B },
    { notAbbreviations: [{ reason: 'not ours to define', tokens: ['EP'] }] });
  report(code === 0, 'a notAbbreviations group saying it is not ours to define' + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}

console.log('\nThe controls — what the rule puts out of scope, and must stay silent about:\n');

/* THE HOUSE STYLE SHOUTING. Ten lower-case uses is the threshold, and the
 * measurement that chose it is in the checker: short forms topped out at two
 * lower-case uses in buses-data and shouts started at fifty-one. */
{
  const SHOUT_A = ['# One', '', 'The gate must PASS before the build ships.', '',
    ...Array.from({ length: 6 }, (_, i) => `A sentence in which the word pass is used, number ${i}, and the gate did pass.`), ''].join('\n');
  const SHOUT_B = ['# Two', '', 'It did not PASS, so nothing moved.', '',
    'Another pass, and a pass, and a third pass of the same thing.', ''].join('\n');
  const { code, out } = run({ 'a.md': SHOUT_A, 'b.md': SHOUT_B });
  report(code === 0, 'PASS, where the lower-case word is used 10+ times — the house style, not a short form'
    + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}
{
  const A = ['# One', '', 'Stage S6 produced finding F001 on route X31 near PE29 in colour EE6677.', ''].join('\n');
  const B = ['# Two', '', 'Stage S6 again, finding F001 again, route X31 again, PE29 again, EE6677 again.', ''].join('\n');
  const { code, out } = run({ 'a.md': A, 'b.md': B });
  report(code === 0, 'a token carrying a digit — a stage, a finding, a route, a postcode, a hex colour'
    + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}
{
  const { code, out } = run({ 'a.md': USES_EP_A });
  report(code === 0, 'EP in ONE document only — that document\'s own vocabulary, out of scope by rule'
    + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}
{
  /* A short form written inside code, a path or a link target is not prose, and
   * a reader meeting `gtfs_query.py` has not met a short form. */
  const A = ['# One', '', 'Run `EP --all` from the engine folder, see [the plan](EP/plan.md), and read EP_notes.txt.', ''].join('\n');
  const B = ['# Two', '', 'Same again: `EP --all`, [the plan](EP/plan.md), EP_notes.txt.', ''].join('\n');
  const { code, out } = run({ 'a.md': A, 'b.md': B });
  report(code === 0, 'EP only ever inside code, a path and a link target — never met as prose'
    + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}

console.log('\nThe declaration itself — a refusal, not a silent fallback:\n');
{
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B },
    { notAbbreviations: [{ reason: 'one', tokens: ['EP'] }, { reason: 'two', tokens: ['EP'] }] });
  report(code === 2 && /two notAbbreviations groups/.test(out),
    'the same token excused twice, with two different reasons' + (code === 2 ? '' : `  <-- exited ${code}\n${out}`));
}
{
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B }, { excluded: { 'gone.md': 'a document that has left' } });
  report(code === 2 && /not there any more/.test(out),
    'an exclusion naming a document that is not there' + (code === 2 ? '' : `  <-- exited ${code}\n${out}`));
}
{
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B }, { definitions: ['no-such-glossary.md'] });
  report(code === 2 && /definitions document/.test(out),
    'a definitions document that is not there' + (code === 2 ? '' : `  <-- exited ${code}\n${out}`));
}
{
  const dir = mkdtempSync(path.join(tmpdir(), 'acronyms-bad-'));
  writeFileSync(path.join(dir, 'a.md'), USES_EP_A, 'utf8');
  writeFileSync(path.join(dir, '.doc-acronyms.json'), '{ this is not json', 'utf8');
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  report(r.status === 2 && /does not parse/.test((r.stdout || '') + (r.stderr || '')),
    'a declaration that does not parse' + (r.status === 2 ? '' : `  <-- exited ${r.status}`));
}
{
  const { code, out } = run({ 'a.md': USES_EP_A }, { notAbbreviations: [{ reason: 'no tokens key', tokens: 'EP' }] });
  report(code === 2 && /notAbbreviations must be/.test(out),
    'a notAbbreviations group whose tokens are not a list' + (code === 2 ? '' : `  <-- exited ${code}\n${out}`));
}
{
  const r = spawnSync(process.execPath, [CHECKER, '--tree', tmpdir()], { encoding: 'utf8' });
  report(r.status === 2 && /unknown flag --tree/.test((r.stdout || '') + (r.stderr || '')),
    'an unknown flag is refused rather than ignored' + (r.status === 2 ? '' : `  <-- exited ${r.status}`));
}

/* COVERAGE IS PART OF THE CLAIM. Three of the four coverage bugs these checkers
 * have had were a confident total over a population smaller than the truth, and
 * a verdict alone cannot express that. */
console.log('\nThe counts — because a verdict alone cannot express coverage:\n');
{
  const GLOSS = ['# Glossary', '', '| Short form | In full |', '|---|---|', '| **EP** | Enhanced Partnership |', ''].join('\n');
  const EXTRA_A = ['# Three', '', 'The CPCA and the LTA both buy from the same pot, and the CPCA is ours.', ''].join('\n');
  const EXTRA_B = ['# Four', '', 'An LTA is a council; the CPCA is a combined authority.', ''].join('\n');
  const { code, out } = run({ 'a.md': USES_EP_A, 'b.md': USES_EP_B, 'gloss.md': GLOSS, 'c.md': EXTRA_A, 'd.md': EXTRA_B },
    { definitions: ['gloss.md'] });
  const m = /(\d+) documents · (\d+) short forms in use · (\d+) defined/.exec(out);
  report(code === 1 && !!m && m[1] === '5' && m[2] === '3' && m[3] === '1',
    `it counted ${m ? `${m[1]} documents, ${m[2]} short forms, ${m[3]} defined` : 'nothing'} — expected 5 documents, 3 short forms (EP, CPCA, LTA), 1 defined`
    + (code === 1 ? '' : `  <-- exited ${code}\n${out}`));
}

/* A MODE THAT NAMES A TREE MUST NOT DEPEND ON THE REPOSITORY YOU ARE STANDING
 * IN. buses-data's CI checks its three repositories into SUBDIRECTORIES of a
 * workspace that is no repository at all, and the last time this rule was
 * broken, twelve of a sibling harness's cases died on a `git ls-files` about a
 * folder none of them had named — the same code, green in one CI and red in the
 * other. `os.tmpdir()` is a place that is not a repository on every platform. */
console.log('\nPointed at a tree from a cwd that is no repository:\n');
{
  const from = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'));
  const { code, out } = run({ 'a.md': USES_EP_A, 'nested/b.md': USES_EP_B }, null, { cwd: from });
  rmSync(from, { recursive: true, force: true });
  report(code === 1 && /✗ EP/.test(out) && /nested\/b\.md/.test(out),
    '--root walked the tree it was given and asked git nothing about the cwd'
    + (code === 1 ? '' : `  <-- exited ${code}\n${out}`));
}

console.log(`\n${failed ? `${failed} CASE${failed === 1 ? '' : 'S'} COULD NOT BE FALSIFIED` : 'Every fault was watched go red, every recogniser was watched accept a real definition and refuse a near miss, every control stayed green, and the counts are what they claim.'}`);
process.exitCode = failed ? 1 : 0;
