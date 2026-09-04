// Falsify check-tables.mjs: glue table rows together on purpose and insist it
// notices — in the row styles it can see, and in the ones it could not.
//
// WHY. check-tables.mjs was written for one fault: a row appended with no
// leading newline lands on the END of the previous row's line, two entries
// render as one, and `git diff --stat` reports a tidy "2 insertions". It caught
// that fault twice on 2026-08-27.
//
// It was then MEASURED, the same day, and had a fault of its own. It identified
// a row by this folder's house style — a line beginning `| **` — so **78 of the
// 446 table rows in Documentation/ had never been looked at**: three whole
// documents, and every row of the glossary's own "Words to use with care" table,
// whose first cell is the word being replaced rather than a bold term. Its
// summary line said "362 table rows across 7 documents, all well-formed", and
// there were ten documents. A check that covers less than its name is the shape
// this folder keeps a list of, and this was the check guarding that list.
//
// Rows are now found structurally, from the `|---|` separator, which also buys
// the column-count test the audience heuristic had been standing in for. So the
// cases below deliberately include a row style the old version was blind to —
// otherwise this harness would certify exactly the coverage that was the bug.
//
// Run from the repository root (C:\u3a St Ives\Using AI\Buses). No placeholders:
//   node Documentation/prove-red-tables.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('./check-tables.mjs', import.meta.url));

function run(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tables-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body, 'utf8');
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* A three-column table in the house style, and a two-column one that is NOT —
 * its first cell is a plain word, which is what made the second table invisible
 * for as long as the row test was a string prefix. */
const HOUSE = [
  '# Doc',
  '',
  '| The shape | What happened | Audience |',
  '|---|---|---|',
  '| **First** | something | Team |',
  '| **Second** | something else | Internal |',
  '',
].join('\n');

const PLAIN = [
  '# Other',
  '',
  '| Instead of | Say |',
  '|---|---|',
  '| Legend | **Key** |',
  '| Bubble | **Badge** |',
  '',
].join('\n');

/* An ASCII diagram inside a fence draws its edges with `|`. It is not a table,
 * and a checker that reads it as one is red on documents that are perfectly
 * fine — which is how a new gate gets muted in its first week. */
const FENCED = [
  '# Diagram',
  '',
  '```',
  '| a | b |',
  '|---|---|',
  '| this is art, not a table',
  '```',
  '',
].join('\n');

/* A DOCUMENT WHOSE TABLE IS PERFECTLY WELL-FORMED, carrying one row that landed
 * after the closing prose. This is the 2026-08-29 fault, and the point of it is
 * that EVERY OTHER TEST IN THE CHECKER PASSES ON IT: the stranded row's trailing
 * pipe is there and its cell count is right. It is wrong only in that no header
 * stands above it, so it renders as a headerless table under a code block.
 *
 * The bash fence carries a `|` line on purpose. That is how these documents are
 * really written — the script that appends a row is documented with the row it
 * appends — and a checker that called it an orphan would be red on documents that
 * are perfectly fine, which is how a new gate gets muted in its first week. */
const ORPHAN_BODY = [
  '# Shapes',
  '',
  '| The shape | What happened | Audience |',
  '|---|---|---|',
  '| **First** | something | Team |',
  '',
  '---',
  '',
  '## Adding to this list',
  '',
  'Append a row with the script below.',
  '',
  '```bash',
  '| **New shape** | what happened | Team |',
  '```',
  '',
];
const ORPHANED = [...ORPHAN_BODY, '| **Stranded** | appended past the end of the table | Team |', ''].join('\n');
const ORPHAN_OK = [...ORPHAN_BODY, ''].join('\n');

const glue = (doc, a, b) => doc.replace(`${a}\n${b}`, `${a}${b}`);

let failed = 0;
const report = (ok, line, label = 'RED  ') => { if (!ok) failed++; console.log(`  ${ok ? label : 'MISS '} ${line}`); };

console.log('Rows glued together on purpose — the checker must fail and name the file and line:\n');

const cases = [
  {
    what: 'two rows glued, in the house style the old version could see',
    expect: 'cells in a 3-column table',
    files: { 'a.md': glue(HOUSE, '| **First** | something | Team |', '| **Second** | something else | Internal |') },
  },
  {
    what: 'two rows glued, in a table the old version was BLIND to',
    expect: 'cells in a 2-column table',
    files: { 'b.md': glue(PLAIN, '| Legend | **Key** |', '| Bubble | **Badge** |') },
  },
  {
    what: 'the original fault — a row whose trailing pipe is gone',
    expect: 'does not end with |',
    files: { 'c.md': HOUSE.replace('| **Second** | something else | Internal |', '| **Second** | something else | Internal and then prose ran on') },
  },
  {
    what: 'a well-formed row stranded OUTSIDE the table, past the closing prose',
    expect: 'outside any table',
    files: { 'd.md': ORPHANED },
  },
];

/* READ WHICH TEST OBJECTED, not merely that something did. A harness that accepts
 * any ✗ certifies the checker's *verdict* and nothing about its *reasoning* — the
 * glued-row fixtures would pass on a checker that reported them as orphans, and
 * the orphan fixture would pass on one that miscounted its cells. Each case names
 * the phrase the right test prints, so a fixture that goes red down the wrong path
 * is a MISS. */
for (const c of cases) {
  const { code, out } = run(c.files);
  const why = code !== 1 ? `  <-- exited ${code}, not 1`
    : !out.includes(c.expect) ? `  <-- red, but not for "${c.expect}"` : '';
  report(code === 1 && out.includes(c.expect), c.what + why);
}

/* AN ESCAPED PIPE IS NOT A BOUNDARY — added 2026-08-31, when widening the scan to
 * `_archive/` produced exactly one finding and it was wrong: a cell reading
 * `map.kind = area \\| place` counted as three cells in a two-column table. Both
 * halves are asserted, because quietening the false finding by ignoring the row
 * would have been the easy wrong fix: the escaped row must be SILENT, and two
 * escaped rows glued together must still be CAUGHT. */
console.log('\nAn escaped pipe — not a boundary, and not an excuse either:\n');

const ESC = [
  '# Doc',
  '',
  '| Field | Value |',
  '|---|---|',
  '| Kind | `map.kind = area \\\\| place` |',
  '| Note | plain |',
  '',
].join('\n');

const escOk = run({ 'e.md': ESC });
report(escOk.code === 0, 'a cell containing an escaped pipe — legal markdown, and silent'
  + (escOk.code === 0 ? '' : `  <-- exited ${escOk.code}\n${escOk.out}`), 'GREEN');

const escGlued = run({ 'e.md': glue(ESC, '| Kind | `map.kind = area \\\\| place` |', '| Note | plain |') });
report(escGlued.code === 1 && escGlued.out.includes('cells in a 2-column table'),
  'two rows glued where one carries an escaped pipe — still caught, and for the right reason'
  + (escGlued.code === 1 ? '' : `  <-- exited ${escGlued.code}, the escape fix quietened the check`));

console.log('\nThe control — correct tables of both styles, and a diagram that is not a table:\n');
const { code, out } = run({ 'a.md': HOUSE, 'b.md': PLAIN, 'c.md': FENCED });
report(code === 0, 'nothing wrong, nothing reported' + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');

/* Coverage is part of the claim, not a detail: the whole reason this file exists
 * is that the checker's summary line was true about the documents it looked at
 * and wrong about the folder. */
const covered = /(\d+) table rows across (\d+) documents/.exec(out);
report(!!covered && covered[1] === '4' && covered[2] === '2',
  `it counted ${covered ? `${covered[1]} rows across ${covered[2]} documents` : 'nothing'} — expected 4 rows across 2, with the fenced diagram excluded`,
  'GREEN');


/* THE SECOND CONTROL, and it is the half that matters for the orphan test. The
 * fixture above differs from a correct document by exactly one line, so a checker
 * that reported the closing prose, or the `|` line inside the bash fence, would
 * pass the red case for the wrong reason and be red on every real document. This
 * asserts the same document is silent without that one line — and still counts
 * its one legitimate row, because a checker that went quiet by seeing nothing at
 * all would also pass. */
console.log('\nThe orphan control — the same document without the stranded row:\n');
const only = run({ 'd.md': ORPHAN_OK });
report(only.code === 0, 'the closing prose and the `|` inside the bash fence are not rows'
  + (only.code === 0 ? '' : `  <-- exited ${only.code}\n${only.out}`), 'GREEN');
const orphanCovered = /(\d+) table rows across (\d+) documents/.exec(only.out);
report(!!orphanCovered && orphanCovered[1] === '1' && orphanCovered[2] === '1',
  `it counted ${orphanCovered ? `${orphanCovered[1]} rows across ${orphanCovered[2]} documents` : 'nothing'} — expected the one real row, and only that`,
  'GREEN');

/* --tree, added 2026-09-01 with OA-222. The flag exists because the subject that
 * arrived — the skills repository — nests its documents two deep and grows a
 * folder whenever somebody adds a skill, so nothing could be listed.
 *
 * THE CASE THAT MATTERS IS THE PAIR, not the red one. A --tree that found the
 * nested break would look identical to a --root that had quietly become
 * recursive, and the harness's own row-count assertion above depends on --root
 * staying flat. So this asserts BOTH halves on the same fixture: --tree finds
 * the break in the subfolder, and --root on the same parent does not see it and
 * counts only the parent's own row. The second half is the one that would catch
 * a careless "just make --root recursive". */
console.log('\n--tree reaches a nested folder, and --root still does not:\n');
const treeDir = mkdtempSync(path.join(tmpdir(), 'tables-tree-'));
mkdirSync(path.join(treeDir, 'nested', 'deeper'), { recursive: true });
writeFileSync(path.join(treeDir, 'top.md'), PLAIN, 'utf8');
writeFileSync(path.join(treeDir, 'nested', 'deeper', 'buried.md'),
  glue(HOUSE, '| **First** | something | Team |', '| **Second** | something else | Internal |'), 'utf8');
const asTree = spawnSync(process.execPath, [CHECKER, '--tree', treeDir], { encoding: 'utf8' });
const asRoot = spawnSync(process.execPath, [CHECKER, '--root', treeDir], { encoding: 'utf8' });
rmSync(treeDir, { recursive: true, force: true });
const treeOut = (asTree.stdout || '') + (asTree.stderr || '');
report(asTree.status === 1 && /nested\/deeper\/buried\.md/.test(treeOut),
  '--tree found the glued row two folders down, and named its path from the tree root'
  + (asTree.status === 1 ? '' : `  <-- exited ${asTree.status}\n${treeOut}`));
const rootOut = (asRoot.stdout || '') + (asRoot.stderr || '');
const rootCovered = /(\d+) table rows across (\d+) documents/.exec(rootOut);
report(asRoot.status === 0 && !!rootCovered && rootCovered[2] === '1',
  `--root on the same folder stayed flat — ${rootCovered ? `${rootCovered[2]} document` : 'nothing'}, not the nested one`,
  'GREEN');

/* ---------- THE DEFAULT CORPUS, from 2026-09-04 (buses-data OA-246) ----------
 *
 * Everything above drives --root or --tree, and neither reads a declaration or
 * asks git anything. That was fine while the default corpus was three literals
 * in the checker; it is not fine now that the corpus is resolved from the
 * repository the checker is RUN FROM. The whole risk this move carries is a
 * COVERAGE regression -- a confident total over a population smaller than the
 * truth, which is this checker's own bug twice over -- and not one case above
 * could see it.
 *
 * So these run the checker with its cwd set to a throwaway git repository, which
 * is the only way to exercise the path CI and the hook actually take. */
function repo(files, { staged = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tables-repo-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), body, 'utf8');
  }
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  if (staged) git('add', '-A');
  return {
    dir,
    run(args = []) {
      const r = spawnSync(process.execPath, [CHECKER, ...args], { cwd: dir, encoding: 'utf8' });
      return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
    },
    done() { rmSync(dir, { recursive: true, force: true }); },
  };
}

const BROKEN = glue(HOUSE, '| **First** | something | Team |', '| **Second** | something else | Internal |');

/* THE BARE DEFAULT IS THE WIDE ONE. A repository that declares nothing must still
 * have every directory holding a tracked `.md` scanned -- that is what stops the
 * eight-widenings sequence recurring in a repository nobody has written a
 * declaration for, and it is the assertion that would have caught this move
 * silently narrowing the scope to "the folder the checker sits in". */
console.log('\nThe default corpus, with no .doc-tables.json at all:\n');
{
  const r = repo({ 'docs/fine.md': PLAIN, 'somewhere/deep/broken.md': BROKEN });
  const bare = r.run();
  report(bare.code === 1 && /somewhere\/deep\/broken\.md/.test(bare.out),
    'a glued row in a folder no list names — found anyway, because git tracks it'
    + (bare.code === 1 ? '' : `  <-- exited ${bare.code}\n${bare.out}`));
  const covered = /(\d+) table rows across (\d+) documents/.exec(bare.out);
  report(!!covered && covered[2] === '2',
    `it counted ${covered ? `${covered[2]} documents` : 'nothing'} — both of them, not just the one at the root`,
    'GREEN');
  r.done();
}

/* AND AN UNTRACKED FILE BESIDE A TRACKED ONE IS STILL READ. The corpus is a set
 * of DIRECTORIES from git, each then scanned flat -- so a document written this
 * morning and not yet added is checked, which is the behaviour a pre-commit hook
 * depends on. Asking git for the FILES instead would have lost this quietly. */
console.log('\nA document not yet added to git, in a folder git already knows:\n');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'tables-repo-'));
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'tracked.md'), PLAIN, 'utf8');
  spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  writeFileSync(path.join(dir, 'docs', 'brand-new.md'), BROKEN, 'utf8');
  const r = spawnSync(process.execPath, [CHECKER], { cwd: dir, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  rmSync(dir, { recursive: true, force: true });
  report(r.status === 1 && /brand-new\.md/.test(out),
    'the unstaged document was read — the scan is git for FOLDERS, then flat on disk'
    + (r.status === 1 ? '' : `  <-- exited ${r.status}\n${out}`));
}

/* A CHECK THAT CANNOT FIND ITS SUBJECT MUST NOT REPORT CLEAR. lib/tracked-docs.mjs
 * throws on an empty answer rather than returning [], because an empty list is
 * indistinguishable from a clean corpus in the line this checker prints. */
console.log('\nA repository git can tell it nothing about:\n');
{
  const r = repo({ 'docs/broken.md': BROKEN }, { staged: false });
  const none = r.run();
  report(none.code !== 0 && /tracks no \.md|cannot ask git/.test(none.out),
    'nothing tracked — it refused rather than printing a clean total'
    + (none.code !== 0 ? '' : `  <-- exited 0\n${none.out}`));
  r.done();
}

/* THE DECLARATION. Three cases, and the two refusals matter more than the pass:
 * a declaration nobody can read must not look like a repository that made none,
 * and an exclusion left behind by a document that has gone must not sit there
 * silently exempting a path that no longer exists. */
console.log('\nThe repository’s own .doc-tables.json:\n');
{
  const r = repo({ 'docs/fine.md': PLAIN, '.doc-tables.json': '{ this is not json' });
  const bad = r.run();
  report(bad.code === 2 && /does not parse/.test(bad.out),
    'a .doc-tables.json that does not parse is a refusal, not a silent fallback'
    + (bad.code === 2 ? '' : `  <-- exited ${bad.code}\n${bad.out}`));
  r.done();
}
{
  const r = repo({
    'docs/fine.md': PLAIN,
    '.doc-tables.json': JSON.stringify({ excluded: { 'docs/gone.md': 'left behind' } }),
  });
  const stale = r.run();
  report(stale.code === 2 && /is not there any more/.test(stale.out),
    'an exclusion naming a document that has gone is a hard error'
    + (stale.code === 2 ? '' : `  <-- exited ${stale.code}\n${stale.out}`));
  r.done();
}
{
  const r = repo({
    'imported/not-ours.md': BROKEN,
    '.doc-tables.json': JSON.stringify({ excluded: { 'imported/not-ours.md': 'a converted PDF kept verbatim' } }),
  });
  const excluded = r.run();
  report(excluded.code === 0, 'a declared exclusion is honoured in the default corpus'
    + (excluded.code === 0 ? '' : `  <-- exited ${excluded.code}\n${excluded.out}`), 'GREEN');
  /* AND NOT OUTSIDE ITS OWN SUBJECT. `c1b15f2` turned every case in this harness
   * into "exited 2" by letting the exclusion list fire under --root, where the
   * path it names belongs to another tree entirely. */
  const pointed = r.run(['--root', path.join(r.dir, 'imported')]);
  report(pointed.code === 1 && /not-ours\.md/.test(pointed.out),
    'the same exclusion does NOT fire under --root — a guard outside its subject is a broken one');
  r.done();
}

/* THE OPEN-ENDED FOLDER, which is `Correspondence/` in buses-data: a thread
 * folder per conversation, created by whoever answers the next email. The point
 * of `enumerate` is that CORR-007 is scanned without anybody editing anything,
 * so the case creates a subfolder no declaration names. */
console.log('\nAn `enumerate` folder grows a subfolder nobody listed:\n');
{
  const r = repo({
    'Threads/README.md': PLAIN,
    'Threads/CORR-002/thread.md': BROKEN,
    '.doc-tables.json': JSON.stringify({ dirs: ['Threads'], enumerate: [{ dir: 'Threads', subdirs: '^CORR-\\d+$' }] }),
  });
  const grown = r.run();
  report(grown.code === 1 && /CORR-002\/thread\.md/.test(grown.out),
    'the new thread folder was scanned — enumerated at run time, not written down'
    + (grown.code === 1 ? '' : `  <-- exited ${grown.code}\n${grown.out}`));
  r.done();
}

/* --root AND --tree FROM A CWD THAT IS NOT A REPOSITORY AT ALL.
 *
 * Every case above runs from wherever the harness was started, which on a laptop
 * and in claude-skills' CI is inside a git repository — so for a day this
 * harness could not tell the difference between a checker that ignores the cwd
 * under --root and one that quietly asks git about it. buses-data's CI checks
 * its three repositories into SUBDIRECTORIES of the workspace, so the step's cwd
 * is not a repository, and all twelve of those cases died on a `git ls-files`
 * about a folder none of them had named. The same code, green in one CI and red
 * in the other.
 *
 * The rule is A MODE THAT NAMES A TREE MUST NOT DEPEND ON THE REPOSITORY YOU ARE
 * STANDING IN, and the only way to assert it is to stand somewhere that is not
 * one. `os.tmpdir()` is that place on every platform. */
console.log('\nPointed at a tree from a cwd that is no repository:\n');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'tables-outside-'));
  mkdirSync(path.join(dir, 'nested'), { recursive: true });
  writeFileSync(path.join(dir, 'top.md'), PLAIN, 'utf8');
  writeFileSync(path.join(dir, 'nested', 'buried.md'),
    glue(HOUSE, '| **First** | something | Team |', '| **Second** | something else | Internal |'), 'utf8');
  const from = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'));
  const at = (args) => {
    const r = spawnSync(process.execPath, [CHECKER, ...args], { cwd: from, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const asRoot = at(['--root', dir]);
  const outside = /(\d+) table rows across (\d+) documents/.exec(asRoot.out);
  report(asRoot.code === 0 && !!outside && outside[2] === '1',
    `--root read the tree it was given (${outside ? outside[2] + ' document' : 'nothing'}) and asked git nothing about the cwd`
    + (asRoot.code === 0 ? '' : `  <-- exited ${asRoot.code}\n${asRoot.out}`), 'GREEN');
  const asTree = at(['--tree', dir]);
  report(asTree.code === 1 && /nested\/buried\.md/.test(asTree.out),
    '--tree still found the glued row, standing outside every repository'
    + (asTree.code === 1 ? '' : `  <-- exited ${asTree.code}\n${asTree.out}`));
  rmSync(dir, { recursive: true, force: true });
  rmSync(from, { recursive: true, force: true });
}

console.log(`\n${failed ? `${failed} CASE${failed === 1 ? '' : 'S'} COULD NOT BE FALSIFIED` : 'Every fault was watched go red, every control stayed green, the row count is what it claims, and the default corpus was measured rather than assumed.'}`);
process.exitCode = failed ? 1 : 0;
