// Check every markdown table in Documentation/ is actually a table.
//
// WHY THIS EXISTS. The glossary and the failure-shapes list are one row per line,
// and both are routinely appended to by a script. Twice on 2026-08-27 a row was
// appended with no leading newline, so it landed on the END of the previous row's
// line: two entries rendered as one, the row count looked right in
// `git diff --stat` ("2 insertions"), and nothing anywhere said otherwise. A
// table is exactly the artefact a stat line cannot describe.
//
// It checks three things, and only things a broken append actually breaks:
//   * a row line ends with `|` — an unterminated row means the append ran on
//   * a row line carries ONE audience cell (`| Team |`, `| Internal |`,
//     `| Anyone … |`) — two means two rows were glued into one
//   * every row has at least three pipes, i.e. two cells — some of these tables are
//     two-column and some three, so three is the floor, not four
//   * a row line is inside a table at all — an append that seeks to the end of the
//     FILE rather than the end of the TABLE strands its rows past the closing
//     prose, where they render as a headerless table and every test above is
//     vacuous, because a row with no header above it belongs to no table
//
// WHERE IT LIVES, AND WHY IT IS NOT WHERE IT WAS WRITTEN. It was written in
// buses-data, which is PRIVATE; `claude-skills` and `community-bus-maps` are
// PUBLIC, and all three run it. A private checker cannot be run by a public
// repository's CI without a cross-repo token, and hanging three repositories'
// documentation checks off one PAT's expiry date is a fault with a date on it.
// Moved here by buses-data OA-246 on 2026-09-04 -- the same move
// `check-file-hygiene.mjs` made under OA-241 five hours earlier. All three
// repositories now run it with NO secret at all.
//
// THE RULE TRAVELS; THE SCOPE STAYS HOME. A checker three repositories run must
// not carry one repository's folder names, so the corpus is no longer a list of
// literals in this file. It is resolved against the repository the checker is
// run FROM -- `process.cwd()` -- and declared by that repository in a
// `.doc-tables.json` at its root. See `declaration()` below.
//
// Run it from the repository root of whichever repository you are checking. The
// path below is a real path on this machine, not a placeholder:
//   node "C:/u3a St Ives/.claude/skills/tools/check-tables.mjs"
//
// Exits non-zero and names the file and line when a table is malformed, so it can
// be run before a commit that touched a document.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { untrackedByCheckers } from './lib/tracked-docs.mjs';
import path from 'node:path';

/* --root <dir> checks that folder instead of this one. It exists for
 * prove-red-tables.mjs, which writes deliberately broken tables and asserts this
 * notices — including in a document whose rows the pre-2026-08-27 version could
 * not see at all. */
// UNKNOWN FLAGS ARE REFUSED, NOT IGNORED (2026-09-02). This file used to read the
// flags it knew and say nothing about the rest, so `--tree <dir>` -- which is
// check-tables.mjs's flag, not this one's -- ran the DEFAULT scope and printed a
// confident "no dead links" about a document set the caller had not asked for.
// The only thing that gave it away was the document count looking familiar. A
// checker that can be pointed at the wrong corpus by a typo, and not say so, is a
// checker that lies about what it read; see "The census that fit on the screen"
// in Documentation/README - Failure shapes we have named.md.
{
  const KNOWN = ["--root", "--tree"];
  const takesValue = new Set(["--root", "--tree"]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    if (!KNOWN.includes(a)) {
      console.error(`check-tables.mjs: unknown flag ${a} (known: ${KNOWN.join(', ')})`);
      process.exit(2);
    }
    if (takesValue.has(a)) i++;
  }
}

const rootArg = process.argv.indexOf('--root');
/* --tree <dir> checks that folder AND every folder beneath it, each one flat,
 * exactly as --root checks one. It exists because the SUBJECT arrived that has
 * no fixed shape (2026-09-01, OA-222): the skills repository holds the engine,
 * three bus SKILL.md files and every reference page beside them — the largest
 * unchecked document set the project had, and the one a session reads before
 * doing any work at all. A glued row sat in `bus-work/SKILL.md` for a day.
 *
 * WHY A NEW FLAG RATHER THAN MAKING --root RECURSIVE. `prove-red-tables.mjs`
 * drives --root over a fixture folder and asserts an exact ROW COUNT, and that
 * count is the assertion that once caught this checker's own coverage bug. A
 * recursive --root would have silently changed what that number means. So --root
 * stays flat, is still what the harness drives, and --tree is the thing that
 * walks — with its own case in the harness.
 *
 * WHY NOT A LIST OF SKILL FOLDERS. The same argument the `enumerate`
 * declaration below makes: a repository whose folders are created by whoever adds the next
 * skill is one nobody will remember to add a line for. Enumerated at run time,
 * one flat scan per folder found. */
const treeArg = process.argv.indexOf('--tree');
const IGNORED_DIRS = new Set(['node_modules', '.git', '.github', 'glossary-src', 'attachments']);
function dirsUnder(dir) {
  const out = [dir];
  for (const e of readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory() && !IGNORED_DIRS.has(e.name)) out.push(...dirsUnder(path.join(dir, e.name)));
  return out;
}
/* THE DEFAULT CORPUS IS DECLARED BY THE REPOSITORY, NOT BY THIS FILE.
 *
 * WHAT IS BEING PRESERVED. Between 2026-08-27 and 2026-09-02 this checker was
 * widened eight times, and seven of those were somebody noticing a corpus nobody
 * had looked at: `Development Docs/`, then its `open-actions/` subfolder, then
 * `Correspondence/`, then `_archive/`, then the skills repository, then -- the
 * one that stopped the sequence -- every other tracked `.md`, ASKED OF GIT
 * rather than kept in a list. The history is in buses-data CLAUDE.md's table of
 * widenings. All of it survives the move; only the place the folder names are
 * WRITTEN DOWN has changed, from literals in this file to a `.doc-tables.json`
 * in the repository those folders belong to. That is the shape
 * `.file-hygiene.json` established under OA-241: the rule travels, the scope and
 * the exemptions stay home, and a checker three repositories run never carries
 * one repository's folder names.
 *
 *   {
 *     "dirs":      ["Documentation", "Development Docs"],
 *     "enumerate": [{ "dir": "Correspondence", "subdirs": "^CORR-\\d+$" }],
 *     "excluded":  { "path/to/imported.md": "why it is not ours" }
 *   }
 *
 * `dirs` are flat-scanned, exactly as --root scans one. `enumerate` is the
 * CORRESPONDENCE SHAPE and the reason it is not simply another `dirs` entry:
 * that folder holds a thread folder per conversation, created by whoever answers
 * the next email, and nobody is going to remember to add `CORR-007/` to a list.
 * It scans the named folder and each immediate subfolder matching `subdirs` --
 * one level, a flat list of directories like any other, no recursive walk
 * sneaking in by the back door.
 *
 * AND WHATEVER GIT KNOWS ABOUT IS ADDED WHETHER IT IS DECLARED OR NOT. Every
 * directory holding a tracked `.md` that the declaration does not already reach
 * joins the scan, so a new town's README is checked the day it is committed and
 * a repository that declares NOTHING still gets its whole tracked corpus. That
 * is deliberately the strong default: this checker's own bug, twice, was
 * COVERAGE -- a confident total over a population smaller than the truth -- and
 * a scope that can only be got wrong by ADDING a folder is the one shape that
 * fault cannot take. Measured on buses-data the day of the move: the declaration
 * it now carries and the git enumeration alone produce the same 39 directories.
 *
 * From git rather than a walk, for the reasons in lib/tracked-docs.mjs: S4/S5/S6
 * run folders are gitignored apart from their README, and a session mid-build
 * has scratch markdown across the estate. */
const REPO_ROOT = path.resolve(process.cwd());

/* A file that does not parse is a REFUSAL rather than a silent fallback -- a
 * declaration nobody can read must not look like a repository that made none.
 * The same contract `.file-hygiene.json` and `.doc-links.json` already use. */
function declaration(root) {
  const file = path.join(root, '.doc-tables.json');
  if (!existsSync(file)) return { declared: false, dirs: [], enumerate: [], excluded: new Map() };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) {
    console.error(`check-tables.mjs: ${file} does not parse — ${e.message}`);
    process.exit(2);
  }
  const dirs = parsed.dirs ?? [];
  const enumerate = parsed.enumerate ?? [];
  const excluded = parsed.excluded ?? {};
  if (!Array.isArray(dirs) || dirs.some((d) => typeof d !== 'string')) {
    console.error(`check-tables.mjs: ${file} — dirs must be an array of repo-relative folders`);
    process.exit(2);
  }
  if (!Array.isArray(enumerate) || enumerate.some((e) => !e || typeof e.dir !== 'string' || typeof e.subdirs !== 'string')) {
    console.error(`check-tables.mjs: ${file} — enumerate must be an array of { "dir": …, "subdirs": … }`);
    process.exit(2);
  }
  if (typeof excluded !== 'object' || Array.isArray(excluded) || Object.values(excluded).some((v) => typeof v !== 'string')) {
    console.error(`check-tables.mjs: ${file} — excluded must be an object of path → reason`);
    process.exit(2);
  }
  return {
    declared: true,
    dirs: dirs.map((d) => d.split('\\').join('/').replace(/\/+$/, '')),
    enumerate: enumerate.map((e) => ({ dir: e.dir.split('\\').join('/').replace(/\/+$/, ''), subdirs: new RegExp(e.subdirs) })),
    excluded: new Map(Object.entries(excluded)),
  };
}

/* One declared open-ended folder: itself, plus each immediate subfolder whose
 * name matches. Absent from disk means absent, not an error — a repository may
 * declare a folder before it has created a thread in it. */
function enumeratedDirs(root, entry) {
  const base = path.join(root, entry.dir) + path.sep;
  if (!existsSync(base)) return [];
  const subs = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && entry.subdirs.test(e.name))
    .map((e) => e.name)
    .sort();
  return [base, ...subs.map((n) => path.join(base, n) + path.sep)];
}

const DECL = declaration(REPO_ROOT);
/* What the declaration already reaches, repo-relative, so the git enumeration
 * adds only what it does not. A prefix covers everything beneath it, which is
 * why declaring `Development Docs` also covers `Development Docs/open-actions`. */
const COVERED_BY_DECLARATION = [...DECL.dirs, ...DECL.enumerate.map((e) => e.dir)];

const DEFAULT_DIRS = [...new Set([
  ...DECL.dirs.map((d) => path.join(REPO_ROOT, d) + path.sep),
  ...DECL.enumerate.flatMap((e) => enumeratedDirs(REPO_ROOT, e)),
  ...untrackedByCheckers(REPO_ROOT, COVERED_BY_DECLARATION),
])];
/* EXCLUSIONS, WITH A REASON EACH, and a stale one is a hard error rather than a
 * silent pass — the same contract `run-tests.mjs` uses in the portal, and the
 * one `.file-hygiene.json`'s `notOurs` uses. It exists because a repository's
 * corpus can hold a document that is not ours to fix: buses-data keeps a
 * converted DfT PDF verbatim whose OCR of an IMAGE contains a `|` inside a
 * `<!-- Start of picture text -->` block. That is not a row and no rule about
 * our tables can make it one. Excluding the file is honest; loosening the row
 * rule to accommodate OCR noise would blind the check to two genuinely glued
 * rows, which is the fault it exists for.
 *
 * A gate that is red on day one is a gate somebody mutes in its first week, so
 * the alternative to an exclusion is not a stricter checker — it is one folder
 * never brought into scope at all. */
const EXCLUDED = DECL.excluded;
/* ONLY WHEN THE DECLARING REPOSITORY IS THE SUBJECT. Under --root or --tree the
 * checker is pointed somewhere else entirely — a prove-red fixture in a temp
 * folder, or another repository's tree — and an exclusion naming a file in the
 * repository we were RUN FROM is neither present nor relevant there. Getting
 * that wrong turned every one of prove-red-tables.mjs's twelve cases into
 * "exited 2" and reddened claude-skills' docs job, which is the sharper lesson:
 * a guard that fires outside its own subject is not a stricter check, it is a
 * broken one. */
const DEFAULT_CORPUS = rootArg === -1 && treeArg === -1;
for (const rel of DEFAULT_CORPUS ? EXCLUDED.keys() : []) {
  if (!existsSync(path.join(REPO_ROOT, rel))) {
    console.error(`check-tables: ${REPO_ROOT}/.doc-tables.json excludes ${rel}, which is not there any more — remove the exclusion or fix the path.`);
    process.exit(2);
  }
}

const DIRS = rootArg > -1
  ? [path.resolve(process.argv[rootArg + 1])]
  : treeArg > -1
    ? dirsUnder(path.resolve(process.argv[treeArg + 1]))
    : DEFAULT_DIRS;
const AUDIENCE = /\|\s*(Team|Internal|Anyone[^|]*|Customer[^|]*)\s*\|/g;
const SEPARATOR = /^\|[\s:|-]+\|[\s:|-]*$/;

/* A ROW IS A ROW BECAUSE IT IS IN A TABLE, not because it starts `| **`.
 *
 * This file used to identify a row by that house style, and it was measured on
 * 2026-08-27: **78 of the 446 table rows in this folder did not start that way,
 * and the checker had never looked at one of them.** Three whole documents were
 * invisible — Folder structure, Retention and pruning, Working in parallel —
 * and so was every row of the glossary's "Words to use with care" table, whose
 * first cell is the word being replaced rather than a bold term. The line the
 * check printed said "362 table rows across 7 documents, all well-formed", and
 * there were ten documents. A green check covering less than its name is the
 * exact shape this folder keeps a list of, and it was in the checker that had
 * been guarding the list all day.
 *
 * So tables are now found structurally: a header line, a `|---|---|` separator,
 * and every `|` line after it until the table ends. That also buys the check
 * this file always wanted and could not have — the separator declares how many
 * columns the table has, so a row with the wrong number of cells is a hard
 * error rather than a heuristic about audience words. Two glued rows have too
 * many cells by construction.
 *
 * Fenced code blocks are skipped, because ASCII diagrams here draw box edges
 * with `|` and are not tables. */
let files = 0, rows = 0, bad = 0;

/* Pipes inside inline code (`a|b`) are content, not cell boundaries. Blank the
 * code spans before counting, keeping the length so the line still reads back.
 *
 * IT COUNTS PIPES, AND IT USED TO SAY CELLS. A row `| a | b |` has three pipes and
 * two cells, so the comparison below — a row's pipes against its separator's — was
 * always right, and the sentence it printed was always wrong by one: `|---|---|---|`
 * was reported as "a 4-column table". Nobody was misled into a bad edit by it, but a
 * checker that names a number the reader can count for themselves and gets it wrong
 * is teaching them to discount the rest of the line. Found 2026-08-29 by a
 * falsification harness that asserted WHICH test objected instead of merely that
 * something had. Pipes are what is compared; cells are what is said.
 *
 * AN ESCAPED PIPE IS NOT A BOUNDARY, and this cost a false finding on the day
 * the archive joined the scan: `portal-optionB-revised-plan_2026-07-23.md:41`
 * writes `map.kind = area \\| place` inside a cell, which is legal markdown and
 * renders as a literal pipe. Counted as a boundary it made a two-column row
 * look like three, and a checker whose first act on a new folder is a wrong
 * finding is one that gets muted. It also cuts the other way, which is the
 * reason to fix it rather than exclude the file: two rows genuinely glued
 * together could be hidden by an escaped pipe miscounted in the other
 * direction. Escapes go before backticks, so a `\\|` inside code is blanked
 * either way. */
const pipeCount = (line) =>
  line.replace(/\\\|/g, '  ')
    .replace(/`[^`]*`/g, (s) => ' '.repeat(s.length))
    .split('|').length - 1;
const cells = (line) => pipeCount(line) - 1;

for (const DIR of DIRS) {
// A document is named by its FOLDER as well as its file whenever more than one
// folder is in scope, because two doc sets can hold the same filename and a bare
// "README.md:12" would then name neither of them.
/* Under --tree the basename is not enough: `make-bus-leaflet/references` and
 * `make-place-bus-leaflet/references` both end in `references`, and a finding
 * labelled `references/style-guide.md:41` would name neither of them. Label
 * from the tree root instead, which is what a reader can paste. */
const label = treeArg > -1
  ? (path.relative(path.resolve(process.argv[treeArg + 1]), DIR).replace(/\\/g, '/') + '/').replace(/^\/$/, '')
  /* Repo-relative, not the basename. With the map tree in scope there are three
   * folders whose basename is `README.md`'s parent and two called `Places`, and
   * `README.md:12` under a bare basename would name none of them. */
  : DIRS.length > 1 ? (path.relative(REPO_ROOT, DIR).split(path.sep).join('/') + '/').replace(/^\/$/, '') : '';
for (const name of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
  if (DEFAULT_CORPUS && EXCLUDED.has(path.relative(REPO_ROOT, path.join(DIR, name)).split(path.sep).join('/'))) continue;
  const lines = readFileSync(path.join(DIR, name), 'utf8').split(/\r?\n/);
  let seen = 0, fenced = false, cols = 0, inTable = false;
  lines.forEach((line, i) => {
    if (line.startsWith('```')) { fenced = !fenced; inTable = false; return; }
    if (fenced) return;
    if (SEPARATOR.test(line)) { inTable = true; cols = pipeCount(line); return; }
    if (!inTable) {
      /* AN ORPHANED ROW — a row that belongs to no table at all.
       *
       * Everything above finds a table from its `|---|` separator and judges each
       * row against that table's header, which means this checker's universe was
       * ROWS THAT BELONG TO A TABLE. A row that belongs to none was not wrong in
       * its eyes; it was not there. On 2026-08-29 four new shapes were appended to
       * the END of `README - Failure shapes we have named.md`, which is not the end
       * of its table — a `---` rule, an `## Adding to this list` heading, two
       * paragraphs and a fenced bash block sit between. They would have rendered as
       * a headerless table under a code block, and this file reported ALL
       * WELL-FORMED. Only the row count caught it, and only because somebody read
       * it: the file's own line said 111 where the file held 115.
       *
       * A HEADER LINE IS NOT AN ORPHAN — it legitimately precedes its separator, so
       * a `|` line whose successor is a separator is skipped. Fenced blocks are
       * already excluded above, which matters because this doc set writes `|` inside
       * bash blocks and a gate that is red on day one gets muted in its first week.
       *
       * Counted into `rows` as well as `bad`, deliberately. The summary line is a
       * coverage claim and this is the third time coverage has been this checker's
       * own bug; a row the file holds should be in the number the file prints. */
      if (line.startsWith('|') && !SEPARATOR.test(lines[i + 1] ?? '')) {
        seen++; rows++; bad++;
        console.log(`✗ ${label}${name}:${i + 1}  a table row outside any table — no header above it declares its columns
    ${line.slice(0, 90)}…`);
      }
      return;
    }
    if (!line.startsWith('|')) { inTable = false; return; }
    seen++; rows++;
    const say = (why) => { bad++; console.log(`✗ ${label}${name}:${i + 1}  ${why}\n    ${line.slice(0, 90)}…`); };
    if (!line.trimEnd().endsWith('|')) say('row does not end with | — an append ran onto this line');
    else if (pipeCount(line) !== cols) say(`${cells(line)} cells in a ${cols - 1}-column table — rows glued together, or a stray pipe`);
    else {
      const n = (line.match(AUDIENCE) || []).length;
      if (n > 1) say(`${n} audience cells on one line — two rows glued together`);
    }
  });
  if (seen) { files++; console.log(`  ${String(seen).padStart(4)} rows  ${label}${name}`); }
}
}

console.log(`\n${rows} table rows across ${files} documents — ${bad ? `${bad} MALFORMED` : 'all well-formed'}.`);
if (bad) {
  console.log('\nA row appended without a leading newline lands on the end of the previous one, and');
  console.log('the two render as a single entry. `git diff --stat` cannot see it: look at the table.');
  console.log('A row appended past the end of the TABLE is the same seam one step further out:');
  console.log('a script that adds a row must find the last existing ROW, not seek to end of FILE.');
}
process.exitCode = bad ? 1 : 0;
