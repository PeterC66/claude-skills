// Check that what one document says about another is still true.
//
// WHY THIS EXISTS (open-actions OA-110, OA-113). A link checker is the easy
// quarter of this. Three classes of rot have been recorded in this project, and
// only the first is a broken path:
//
//   1. THE PATH DIED. A `Documentation/` link broke unnoticed when its target
//      was archived, and was found by a hand-written walk on 2026-08-21.
//
//   2. THE PATH LIVED AND THE CONTENT LEFT. On 2026-08-22, four documents plus
//      the memory index pointed into `open-actions.md` for narrative and section
//      names it had stopped carrying at the 2026-08-20 tidy-up. Every one of
//      those links resolved. On 2026-08-27 the same shape was caught in time,
//      by hand, before the portal's CHANGELOG tail was archived: three documents
//      cited entries by name in the part about to go. A link checker passes all
//      of these.
//
//   3. THERE WAS NO LINK TO CHECK. Splitting the glossary on 2026-08-26
//      renumbered its sections and broke SEVEN internal `§n` references written
//      as prose — three pointing at a real but wrong section, two at content that
//      had left the file entirely.
//
// And the sibling row: a documented command must state the folder it runs from
// and explain its placeholders (the house rule in `~/.claude/CLAUDE.md`). Two
// commands were found wrong on 2026-08-26 by running one of them — the Board
// entry said `node status.js` "from anywhere in the bus repo" and `status.js`
// is not in that repo at all. Nothing checked any of the others.
//
// So this checks five things, and every one of them is something that has
// actually gone wrong here:
//
//   L1  a relative link resolves to a file that exists
//   L2  a `#fragment` matches a real heading in the target
//   L3  a `§n` citation names a section the target actually has
//   C1  a fenced `bash` block has a folder declared for it somewhere above
//   C2  a script named by a `node`/`python` command in such a block exists
//
// SINCE 2026-08-28 THE HOUSE STYLE ASKS FOR ANCHORS (OA-139). Cite a section as
// [the heading](target.md#the-heading), not as prose naming it. That is not a
// change to this checker -- it is what converts the uncheckable class below into
// the #anchor class this file ALREADY verifies, one citation at a time, as
// documents are written and rewritten. Nothing retro-fits it and nothing needs to.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not judge a citation by phrase
// ("the impeccable round-2 findings"), because there is no syntax to anchor
// that on and a checker that guesses is a checker that gets muted. For that
// class the rule stays the one in `stamp-docs`: when you cut content out of a
// document, grep the doc sets for its filename AND for the headings you are
// removing. What this file does is remove the three classes that DO have a
// syntax, so the hand-grep only has to cover the one that does not.
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
// THE RULE TRAVELS; THE SCOPE STAYS HOME. The corpus is no longer four folder
// names from one repository held in a const here. It is resolved against the
// repository the checker is run FROM -- `process.cwd()` -- and that repository
// declares its own `dirs` and `files` in the `.doc-links.json` at its root,
// beside the `resolveFromRoot` that file already carried. See `declaration()`.
//
// Run it from the repository root of whichever repository you are checking. The
// path below is a real path on this machine, not a placeholder:
//   node "C:/u3a St Ives/.claude/skills/tools/check-doc-links.mjs"
//
// Add --verbose to list every document scanned and its counts. Exits non-zero
// and names file and line for each finding, so it can gate a commit or a CI run.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { untrackedFiles } from './lib/tracked-docs.mjs';

/* --root <dir> scans that directory instead of this repository's doc set. It
 * exists for prove-red-doc-links.mjs, which builds a tree of deliberately
 * broken documents and asserts every one of the five checks fires on it. A
 * check that has never been watched go red is not evidence of anything, and
 * this repository has paid for that lesson more than once. */
// UNKNOWN FLAGS ARE REFUSED, NOT IGNORED (2026-09-02). This file used to read the
// flags it knew and say nothing about the rest, so `--tree <dir>` -- which is
// check-tables.mjs's flag, not this one's -- ran the DEFAULT scope and printed a
// confident "no dead links" about a document set the caller had not asked for.
// The only thing that gave it away was the document count looking familiar. A
// checker that can be pointed at the wrong corpus by a typo, and not say so, is a
// checker that lies about what it read; see "The census that fit on the screen"
// in Documentation/README - Failure shapes we have named.md.
{
  const KNOWN = ["--root", "--verbose"];
  const takesValue = new Set(["--root"]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    if (!KNOWN.includes(a)) {
      console.error(`check-doc-links.mjs: unknown flag ${a} (known: ${KNOWN.join(', ')})`);
      process.exit(2);
    }
    if (takesValue.has(a)) i++;
  }
}

const rootArg = process.argv.indexOf('--root');
const FIXTURE = rootArg > -1 ? path.resolve(process.argv[rootArg + 1]) : null;
/* THE REPOSITORY BEING CHECKED, which used to be the one this file sat in and is
 * now the one it was run from. `--root <dir>` is unchanged and still means
 * something narrower: scan exactly that tree and read no declaration, which is
 * what prove-red-doc-links.mjs drives over a temp folder that is not a git
 * repository at all. */
const ROOT = FIXTURE || path.resolve(process.cwd());
const VERBOSE = process.argv.includes('--verbose');

/* ASSEMBLED FRAGMENTS RESOLVE THEIR LINKS FROM THE REPOSITORY ROOT (W2,
 * 2026-09-04, OA-227). The portal keeps its changelog as one file per entry under
 * `CHANGELOG.d/`, assembled into a single page at the root, so a fragment writes
 * `[the retention module](src/ops/backup-retention.js)` — correct on the page it
 * renders as, and a dead link measured against the folder the fragment sits in.
 * Read against their own folder, 24 such links were reported dead across the
 * fragments and the archived changelog; read against the root, every one of them
 * resolves. The base a document renders from is a property of the REPOSITORY, so
 * it is declared there rather than guessed at here, and a checker three
 * repositories run does not carry one repository's folder names — the same
 * argument that put the hygiene exemptions in `.file-hygiene.json` (OA-241).
 *
 * `.doc-links.json` is optional and absent from two of the three repositories.
 * A file that does not parse is a REFUSAL rather than a silent fallback: a
 * declaration nobody can read must not look like a repository that made none. */
/* IT ALSO CARRIES THE CORPUS from 2026-09-04 (OA-246): `dirs`, the folders this
 * repository wants walked, and `files`, the loose documents at its root.
 *
 * IT IS STILL READ UNDER --root, and getting that wrong was caught by the
 * portal's own corpus during the move: --root names a TREE, not a scope, and the
 * tree it names is usually a real repository whose `resolveFromRoot` its
 * assembled changelog fragments depend on. Skipping the file there reported 24
 * live links as dead. What --root does ignore is `dirs`/`files` -- see DIRS
 * below -- and the harness's fixture is a temp folder that has no such file at
 * all, so it reads as a repository that declared nothing either way. */
function readDocLinksDeclaration(root) {
  const empty = { resolveFromRoot: [], dirs: [], files: [] };
  const file = path.join(root, '.doc-links.json');
  if (!existsSync(file)) return empty;
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) {
    console.error(`check-doc-links.mjs: ${file} does not parse — ${e.message}`);
    process.exit(2);
  }
  const strings = (key) => {
    const list = parsed[key] ?? [];
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) {
      console.error(`check-doc-links.mjs: ${file} — ${key} must be an array of repo-relative paths`);
      process.exit(2);
    }
    return list.map((x) => x.split('\\').join('/').replace(/\/+$/, ''));
  };
  return { resolveFromRoot: strings('resolveFromRoot'), dirs: strings('dirs'), files: strings('files') };
}
const DECLARATION = readDocLinksDeclaration(ROOT);

/* THE CORPUS. The documents people cite each other from, which is not the same
 * set as "every .md in the tree". A map's own README under Areas/ is a build
 * record rather than a document — it is written once per version and cites its
 * plan by nickname ("the paper's §8.5"), which class 3 below cannot resolve and
 * should not pretend to. _archive is out of the FULL corpus for the same reason
 * the stamper leaves it alone: an archived plan is a record of what was said,
 * not a live claim, so its § citations and its commands are not ours to
 * re-litigate.
 *
 * BUT ITS LINKS ARE CHECKED, from 2026-08-31, and only its links. `_archive`'s
 * own README has said since the day it was written that a moved file breaks
 * links exactly as quietly as a deleted one, and tells whoever moves it to
 * repoint what points at it. Nothing enforced that and nothing could SEE it: on
 * 2026-08-31 there were 18 dead links across five archived documents, ten of
 * them in `label-and-design-quality-plan_2026-08-15.md` alone — every one
 * correct on the day it was written and every one a directory short after the
 * file was archived on 2026-08-27. A record whose links go nowhere is not a
 * record. */
/* DECLARED BY THE REPOSITORY (OA-246). buses-data's four folders and two root
 * files were literals here until the move; they are now in its own
 * `.doc-links.json`, because a checker three repositories run must not carry one
 * repository's folder names -- the shape `.file-hygiene.json` established under
 * OA-241, arrived at from the other side of the same argument OA-222 named as
 * *a copy is a checker owning someone else's rule*.
 *
 * A REPOSITORY THAT DECLARES NO `dirs` GETS ITS WHOLE TREE WALKED, which is
 * exactly what `--root .` already did and what claude-skills and the portal have
 * always been given. So the bare default is the widest one, not the narrowest:
 * this checker's sibling has twice had a coverage bug, and a scope that can only
 * be got wrong by NARROWING it is the one shape that fault cannot take. */
/* EMPTY UNDER --root, which means "scan exactly this tree" and has always meant
 * that: the folders a repository declares are the folders it wants scanned when
 * nobody has said otherwise, and a caller who named a tree has said otherwise. */
const DIRS = FIXTURE ? [] : DECLARATION.dirs;
const FILES = FIXTURE ? [] : DECLARATION.files;
/* Declared folders are walked; an undeclared repository is walked from its root.
 * FIXTURE mode is the same thing by another name, which is why the two collapse
 * into one flag rather than being tested separately at four call sites. */
const WALK_WHOLE_TREE = FIXTURE !== null || DIRS.length === 0;
/* WIDENED 2026-09-02 (OA-224 Tier 5) to every tracked `.md` the four roots above
 * do not reach: `_gtfs/`'s monthly refresh reports, the map READMEs and bootstrap
 * reports under `Areas/` and `Places/`, and the loose review documents at the
 * root. ENUMERATED FROM GIT rather than listed, and from git rather than a walk,
 * for the reasons in Documentation/lib/tracked-docs.mjs — chiefly that S4/S5/S6
 * run folders are gitignored apart from their README, so a `readdir` here would
 * check a neighbouring session's uncommitted scratch. It reaches this file as
 * FILES rather than as another DIRS entry because these directories are already
 * the complete set: walking them again would be the same over-scan by another
 * route. */
/* Empty under --root/--tree: those modes point at another tree, which the
 * caller has already scoped, and the harness's fixture is a temp folder that is
 * not a git repository at all. */
const EXTRA_FILES = WALK_WHOLE_TREE ? [] : untrackedFiles(ROOT, [...DIRS, ...FILES]);
const SKIP_DIRS = new Set(['_archive', 'node_modules', '.git', '.claude', 'glossary-src', 'attachments']);

/* THE BASES A DOCUMENT'S LINKS MAY BE WRITTEN FROM — usually one, and for a
 * declared path, two.
 *
 * TWO, BECAUSE AN ASSEMBLED FILE GENUINELY HAS BOTH, which a first cut resolving
 * only from the root got wrong and the portal's own corpus proved in two lines.
 * `CHANGELOG.d/README.md` is a hand-written page ABOUT the folder and links its
 * neighbour the ordinary way; `docs/_archive/CHANGELOG-to-2026-08-19.md` is
 * mixed in a single file — a header link written relative to where it sits, and
 * a thousand body links written for the page it was assembled into. No list of
 * exceptions expresses a file that is both, because the split is per LINK.
 *
 * A finding is therefore raised only when a link resolves under NEITHER base,
 * which is precisely what "this link is dead" means for such a file. It is a
 * weakening and only for declared paths: everything else keeps the single base
 * and the strict test. */
function linkBases(file) {
  const relPath = path.relative(ROOT, file).split('\\').join('/');
  const own = path.dirname(file);
  for (const d of DECLARATION.resolveFromRoot)
    if (relPath === d || relPath.startsWith(d + '/')) return [own, ROOT];
  return [own];
}

/* Correspondence/ joined the corpus on 2026-08-30, when it stopped being
 * gitignored. It belongs here and not in the "build record" exclusion above:
 * a thread record cites OA files, plans and each map's folder by relative path,
 * which is precisely class 1, and a correspondent quoting a heading at us is
 * precisely class 3. `attachments/` is skipped because it holds sent JPGs and
 * is untracked -- a walk of it would find no .md and cost a syscall per thread. */

/* A folder declaration. Every one of these forms is in the corpus today; the
 * rule they encode is the house one — a documented command says where to run it
 * from — and the forms are listed rather than guessed at so that adding a sixth
 * is a deliberate act. */
/* TWO FORMS ADDED 2026-09-01 (OA-222), when this check was first pointed at the
 * skills repository and reported four commands as undeclared that the prose
 * declares perfectly well. Both are deliberate, per the paragraph above, and
 * both are TIGHT rather than convenient — a loose form here does not produce a
 * false finding, it produces a false PASS, because a paragraph wrongly read as
 * a declaration silences the C1 that should have fired and resolves the command
 * against the wrong folder.
 *
 *   * A BACKTICKED ABSOLUTE PATH is itself a declaration, keyword or none. The
 *     house rule asks a document to say where a command runs in the terms of the
 *     machine that runs it, and `C:\u3a St Ives\.claude\skills\bus-work\assets`
 *     is that sentence with nothing left to infer. It does not occur by accident.
 *   * `from` IMMEDIATELY FOLLOWED BY A BACKTICKED TOKEN — "run from
 *     `make-bus-leaflet`". The skills repo names its folders relative to its own
 *     root, which is the natural thing to write there and which none of the five
 *     original forms could see. The backticks are what keep it narrow: prose
 *     saying "from the engine" still does not count.
 */
/* NARROWED TWICE 2026-09-04 (OA-227), when this check was first pointed at the
 * PORTAL and the bare-path form above turned out to be the loose one the comment
 * warns about. It was written for the skills repository, where a backticked
 * absolute path is only ever written to say where to run something. The portal's
 * prose writes one to LOCATE something — "the private ops folder is
 * `C:\Claude\community-bus-maps-ops\`", "paths below are under
 * `C:\u3a St Ives\Using AI\Buses\`" — and neither sentence is an instruction to
 * anybody. Unbounded, one of those reached forward across a section boundary and
 * roughly a hundred lines to the command appendix of
 * `docs/H1-operations-handbook.md`, silenced the C1 that should have fired on it,
 * and then reported seven live portal scripts as missing because it had resolved
 * them against a folder in another repository. That is the false-PASS half of the
 * asymmetry, arriving exactly where the 2026-09-01 comment said it would.
 *
 * THE RULE THAT REPLACES "KEYWORD OR NONE" is that a declaration has to be an
 * INSTRUCTION, and the two narrowings are both ways of asking that:
 *
 *   * N1 — a backticked absolute path counts only when the same line also carries
 *     a run cue: `from`, `run`, `execute`, or "working directory". "Paths below
 *     are under `C:\…\Buses\`" and "the private ops folder is `C:\…-ops\`" state
 *     a location; "started from the buses-data repository root (`C:\…\Buses`)"
 *     issues an instruction, and only the third is a declaration. The cue must be
 *     on the SAME LINE, not merely nearby, so a paragraph cannot borrow one.
 *   * N2 — a path that names something that EXISTS AND IS A FILE is a citation.
 *     That covers both bare paths (`…\README - How to publish a map to the
 *     portal.md`) and the relative form: "kept deliberately apart from
 *     `open-actions.md`" is prose, and it was silencing a C1 through the
 *     ``from `X` `` form written for "run from `make-bus-leaflet`".
 *
 * A PROXIMITY BOUND WAS TRIED FIRST AND IS WRONG — recorded because it looks
 * obviously right. Restricting the bare form to the paragraph immediately above
 * the fence produced six false findings in `claude-skills`, where
 * `make-place-bus-leaflet/references/pipeline.md` says once, at the top, that
 * **every** block below runs from one folder and then shows eleven of them. The
 * corpus declares by scope, not by adjacency, so distance is not the signal;
 * whether the sentence is an instruction is.
 *
 * BOTH ARE NARROWINGS, which is the safe direction: a narrowed declaration
 * produces MORE C1 findings, and a C1 is visible. Widening one is what hides a
 * fault. */
const DECLARES_FOLDER_KEYWORD = /(run (?:\w+ ){0,2}from|regenerate from|from the repository root|working directory|\*\*folder:?\*\*|to pick this up, from|in the (?:bash|powershell) shell)/i;
const DECLARES_FOLDER_BARE_PATH = /`([A-Za-z]:[\\/][^`\n]*)`/;
const DECLARES_FOLDER_REL_PATH = /\bfrom\s+`([^`\n]+)`/i;
/* N1's cue, and it has to be IN THE SAME SENTENCE as the path. `from` is the
 * house word — every keyword form above is built on it — but it is also one of
 * the commonest words in English, and a paragraph-wide test for it is no test at
 * all: `docs/H1-operations-handbook.md` says "listing nothing at all from
 * buses-data" in one sentence and "paths below are under `C:\…\Buses\`" three
 * sentences later, and a line-wide match reads that as an instruction. Same
 * sentence, and `make-place-bus-leaflet/references/pipeline.md`'s "Every block
 * below runs in ONE shell session, started from the buses-data repository root
 * (`C:\…\Buses`)" still declares, while none of the portal's three location
 * statements do. */
const RUN_CUE = /(\bfrom\b|\bruns?\b|\bexecutes?\b|\bstarted\b|\bcd\b|working directory)/i;
const cueInSameSentence = (text, pathIndex) =>
  RUN_CUE.test(text.slice(0, pathIndex).split(/(?<=[.!?])[\s*_)]+/).pop() ?? '');
/* Kept as one regex for any caller that only wants to know "is this line capable
 * of being a declaration at all" — the cue and file tests below are what decide
 * whether it IS one. */
const DECLARES_FOLDER = new RegExp(
  `(${DECLARES_FOLDER_KEYWORD.source.slice(1, -1)}|${DECLARES_FOLDER_BARE_PATH.source}|${DECLARES_FOLDER_REL_PATH.source})`, 'i');

/* N2, for both path forms. A path present on this machine and known to be a FILE
 * is a citation. Absent, it cannot be told apart from a folder and is left alone:
 * the CI runner has neither tree, and `resolveOnThisTree` already counts and
 * reports a fence whose declaration it could not resolve. */
const namesAnExistingFile = (p) => {
  try { return statSync(p.replace(/[\\/]+$/, '')).isFile(); } catch { return false; }
};

const findings = [];
const advisories = [];
const siteLinks = [];   /* `/route` links — a site path, not a file; counted, never failed */
let legal = 0;   /* licence/statute clauses skipped — reported, never failed */
const say = (file, line, code, why, extra) =>
  findings.push({ file, line, code, why, extra });

/* ---------- collecting the corpus ---------- */

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.md')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/* `_archive` folders anywhere under a scanned root. `walk` refuses to enter one,
 * so they are found separately and read for links only. */
function archiveDirsUnder(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === '_archive') out.push(p);
    else if (!SKIP_DIRS.has(e.name)) out.push(...archiveDirsUnder(p));
  }
  return out;
}

const corpus = [];
/* Read for LINKS ONLY — see the corpus note above. */
const archived = [];
if (WALK_WHOLE_TREE) {
  walk(ROOT, corpus);
} else {
  for (const d of DIRS) walk(path.join(ROOT, d), corpus);
  for (const f of [...FILES, ...EXTRA_FILES]) { const p = path.join(ROOT, f); if (existsSync(p)) corpus.push(p); }
}
/* Every `_archive` under a scanned root, in BOTH modes — `walk` skips the
 * folder by name, so this is the only way in. Doing it here rather than from
 * a list keeps the fixture harness honest: `prove-red-doc-links.mjs` builds a
 * whole little doc set in a temp folder, and a hard-coded
 * `Development Docs/_archive` would have been unreachable there — the
 * widening would have been untestable by the harness that exists to test it. */
for (const root of WALK_WHOLE_TREE ? [ROOT] : DIRS.map((d) => path.join(ROOT, d)))
  for (const d of archiveDirsUnder(root)) walk(d, archived);
const ARCHIVED = new Set(archived);

/* ---------- reading a document ---------- */

/* GitHub's heading slug, near enough for our own headings: lowercase, drop
 * anything that is not a letter, digit, space, hyphen or underscore, then
 * spaces to hyphens. Markdown emphasis and backticks go first because a heading
 * here is routinely `## 7.2 Which makes §5's "decline" unworkable`.
 *
 * ONE space to ONE hyphen, and runs are NOT collapsed — corrected 2026-08-31.
 * This mattered because every second heading in these documents carries an em
 * dash, and removing it leaves the two spaces that surrounded it: GitHub writes
 * `heading--subtitle`, and this function used to write `heading-subtitle`. So an
 * anchor spelled the way GitHub spells it was reported DEAD, and one spelled the
 * way this function spelled it was reported healthy and 404d on GitHub. Two of
 * the second kind were live in the corpus, in OA-048 and place-external-round,
 * both green since the day they were written. `prove-red-doc-links.mjs` carries
 * the case, and it was watched MISS against the collapsing version. */
function slug(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

/* Section numbers a document declares in its own headings: `## 7.1 ...`,
 * `## 1a ...`, `### 4.6 The split`. Returned as a Set of the number tokens. */
function sectionNumbers(headings) {
  const out = new Set();
  for (const h of headings) {
    const m = /^\**\s*(\d+[a-z]?(?:\.\d+[a-z]?)*)\.?\s+\S/.exec(h.text.replace(/^#+\s*/, ''));
    if (m) out.add(m[1]);
  }
  return out;
}

const docs = new Map();
function load(file) {
  if (docs.has(file)) return docs.get(file);
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { docs.set(file, null); return null; }
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headings = [];
  const fences = [];       // { line, lang, body[] }
  const prose = [];        // { line, text } — lines OUTSIDE any fence
  let inFence = null;
  lines.forEach((line, i) => {
    const f = /^```(\w*)\s*$/.exec(line);
    if (f && !inFence) { inFence = { line: i + 1, lang: f[1], body: [] }; return; }
    if (inFence) {
      if (line.startsWith('```')) { fences.push(inFence); inFence = null; }
      else inFence.body.push(line);
      return;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) headings.push({ line: i + 1, depth: h[1].length, text: h[2].trim() });
    prose.push({ line: i + 1, text: line });
  });
  if (inFence) fences.push(inFence);
  const doc = {
    file, lines, headings, fences, prose,
    slugs: new Set(headings.map((h) => slug(h.text))),
    sections: sectionNumbers(headings),
  };
  docs.set(file, doc);
  return doc;
}

/* ---------- L1 / L2: links ---------- */

const LINK = /\[(?:[^\]]|\][^(])*?\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function checkLinks(doc) {
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
  for (const { line, text: raw } of doc.prose) {
    /* A LINK INSIDE BACKTICKS IS AN EXAMPLE, NOT A LINK. Documents here write
     * `[…](target.md#the-heading)` to show the shape of a citation, and the
     * first version chased those as if they were real, reporting a document
     * that does not exist because it was never meant to. Blank the code spans
     * for this scan only — the § scan below deliberately still sees them,
     * because a backticked filename is exactly how it finds its target. */
    const text = raw.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
    LINK.lastIndex = 0;
    let m;
    while ((m = LINK.exec(text))) {
      /* `[text](<https://…>)` is a legal autolink-in-link and the angle
       * brackets are delimiters, not part of the URL. Without this the checker
       * reported four live external links as dead files — a false positive of
       * exactly the kind that gets a checker muted in its first week. */
      const href = m[1].replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|#|tel:)/i.test(href)) {
        /* A same-document anchor still has to exist. */
        if (href.startsWith('#')) {
          const frag = decodeURIComponent(href.slice(1)).toLowerCase();
          if (frag && !doc.slugs.has(frag))
            say(rel(doc.file), line, 'L2', `same-document anchor #${frag} matches no heading here`);
        }
        continue;
      }
      /* A LEADING SLASH IS A SITE PATH, NOT A FILE PATH (W1, 2026-09-04, OA-227).
       * `[the apply page](/apply.html)` in the portal's documents means
       * busmaps.uk/apply.html — a route the server owns, which may be served by a
       * file at another path, by a template, or by nothing on disk at all. This
       * corpus had never written one, so the class arrived with the third
       * repository and every one of the three was reported as a dead file.
       *
       * ADVISORY RATHER THAN SILENCE, because it IS unverified: a route that has
       * been renamed looks exactly like one that has not, and the honest thing is
       * to say how many went unchecked rather than to let the total imply they
       * were. Same principle as the outside-the-repo and %VAR% counts below — a
       * check that covers less than it did is only acceptable if it says so. */
      const [rawPath, frag] = href.split('#');
      if (rawPath.startsWith('/')) {
        siteLinks.push({ file: rel(doc.file), line,
          why: `${decodeURIComponent(rawPath)} is a site path, not a file — nothing here can say whether that route still exists` });
        continue;
      }
      /* One base for an ordinary document, two for a declared assembled one —
       * the first that lands inside the repository AND exists wins, so a
       * finding below is about a link that resolved under none of them. */
      const bases = linkBases(doc.file);
      const inRepo = (t) => t.startsWith(ROOT + path.sep) || t === ROOT;
      const candidates = bases.map((b) => path.resolve(b, decodeURIComponent(rawPath)));
      const target = candidates.find((t) => inRepo(t) && existsSync(t))
        ?? candidates.find(inRepo)   /* so the message is "does not exist", not "escapes" */
        ?? candidates[0];
      /* A LINK THAT CLIMBS OUT OF THE REPOSITORY resolves on the machine that
       * wrote it and nowhere else — not in a clone, not in a CI checkout, and
       * not in GitHub's rendering of the file, where it is a plain 404. Three
       * were found this way on 2026-08-27, pointing into `C:\Claude` and into
       * the skills repo; on Windows they exist, so only a Linux checkout could
       * see them. Report the class, not "the file is missing", because the file
       * IS there for the one person least likely to notice. */
      if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
        say(rel(doc.file), line, 'L1',
          `link escapes the repository: ${decodeURIComponent(rawPath)}`,
          'it resolves only on a machine with that tree beside this one — name the repo and use a backticked path instead');
        continue;
      }
      if (!existsSync(target)) {
        say(rel(doc.file), line, 'L1', `link target does not exist: ${decodeURIComponent(rawPath)}`);
        continue;
      }
      if (!frag) continue;
      if (!target.endsWith('.md') || !statSync(target).isFile()) continue;
      const t = load(target);
      const want = decodeURIComponent(frag).toLowerCase();
      if (t && !t.slugs.has(want))
        say(rel(doc.file), line, 'L2', `#${want} matches no heading in ${path.basename(target)}`);
    }
  }
}

/* ---------- L3: section citations ---------- */

/* The target of a `§n` is whatever .md the same line names before it — as a
 * markdown link or as a backticked filename — and otherwise this document
 * itself. A citation with no nameable target ("the paper's §8.5") is reported
 * as an ADVISORY, not a finding: it is a real weakness (nothing can check it)
 * but failing on it would fail on prose that is perfectly clear to a human, and
 * a gate that is red for that reason is a gate that gets muted. */
const SECTION = /§(\d+[a-z]?(?:\.\d+[a-z]?)*)/g;
const NAMED_MD = /(?:\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)|`([^`]+\.md)`)/g;

/* `§` NAMES TWO DIFFERENT THINGS HERE, and the first version of this checker
 * could not tell them apart: a section of one of our own documents, and a
 * CLAUSE OF A LICENCE OR STATUTE. `ODbL §4.6` is the single most-cited section
 * number in this repository and it belongs to a document we did not write. The
 * first run reported nine of them as broken self-references, in the glossary and
 * in the solicitor's letter — which would have been nine wrong edits to legal
 * text. The list is explicit rather than a capitalisation heuristic, because a
 * checker that guesses at legal citations is worse than one that skips them. */
const AUTHORITIES = /\b(ODbL|ODC-BY|OGL|BSL|Business Source Licen[cs]e|GDPR|Data Protection Act|Companies Act|Equality Act|Bus Services Act|the licen[cs]e|the agreement)\b/;

function checkSections(doc) {
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
  for (const { line, text } of doc.prose) {
    SECTION.lastIndex = 0;
    let m;
    while ((m = SECTION.exec(text))) {
      const at = m.index;
      /* An authority name RIGHT BEFORE the § wins outright, before any document
       * is looked for. The first version only consulted this list when no .md
       * was named anywhere on the line, so `see [target.md](target.md) §2, and
       * ODbL §4.6 is a different matter` read the ODbL clause as a section of
       * target.md. The control fixture in prove-red-doc-links.mjs is what found
       * it — none of the five deliberately-broken ones could have. */
      if (AUTHORITIES.test(text.slice(Math.max(0, at - 30), at))) { legal++; continue; }
      /* THE TARGET HAS TO BE ADJACENT, not merely earlier on the line. The
       * first version took the nearest .md named anywhere before the § and got
       * six of twelve wrong — a paragraph that mentions `open-actions.md` in
       * passing and then cites its OWN §8.5 four clauses later is the normal
       * shape of writing here, not an exception. The citation idiom this
       * project actually uses puts them together: "`plan.md` §6",
       * "[plan.md](plan.md) §3 and §6". So: within GAP characters, and no
       * sentence boundary in between. */
      const GAP = 25;
      NAMED_MD.lastIndex = 0;
      let named = null, n;
      while ((n = NAMED_MD.exec(text))) {
        if (n.index >= at) break;
        const between = text.slice(n.index + n[0].length, at);
        if (between.length <= GAP && !/[.;:]\s/.test(between))
          named = decodeURIComponent(n[1] || n[2]);
      }
      let targetFile = doc.file, label = 'this document';
      /* A licence clause cited before this § on the same line means the § is
       * theirs, not ours. Only skip the SELF case: an explicit `.md` beside the
       * § still wins, so `ODbL §4.6, and see [plan.md](plan.md) §3` works. */
      if (!named && AUTHORITIES.test(text.slice(0, at))) { legal++; continue; }
      if (named) {
        const resolved = path.resolve(path.dirname(doc.file), named);
        if (!existsSync(resolved)) continue;   // L1 already said so
        targetFile = resolved;
        label = path.basename(resolved);
      }
      const t = load(targetFile);
      if (!t) continue;
      /* A target with NO numbered sections is much likelier to be a target this
       * script picked wrongly than a document that lost its numbering — both
       * cases in the corpus were exactly that ("`stand-coverage.md` … and §7.1
       * sharpens why", where §7.1 is this document's own). Advisory, not a
       * finding. The hard case below is the unambiguous one: a named target
       * that DOES number its sections and does not have the one cited, which is
       * the shape the 2026-08-26 glossary split produced seven times. */
      if (t.sections.size === 0) {
        advisories.push({ file: rel(doc.file), line, code: 'L3?', why: named
          ? `§${m[1]} reads as a citation of ${label}, which numbers no sections — probably this document's own, or a licence clause`
          : `§${m[1]} names no target and this document has no numbered sections — nothing can check it` });
        continue;
      }
      if (t.sections.has(m[1])) continue;
      const has = `it has ${[...t.sections].slice(0, 12).join(', ')}${t.sections.size > 12 ? ', …' : ''}`;
      /* A citation that names its target is checkable and therefore FAILS. One
       * that does not is a guess, and a guess that fails the build is a gate
       * nobody keeps: `§4.6` in a paragraph about Produced Works is an ODbL
       * clause however confidently a script reads it as our own section 4.6.
       * The advisory is the honest half — it says which citations nothing can
       * check, and naming the document beside the § is what promotes one. */
      if (named)
        say(rel(doc.file), line, 'L3', `§${m[1]} does not exist in ${label}`, has);
      else
        advisories.push({ file: rel(doc.file), line, code: 'L3?', why: `§${m[1]} names no target; read as this document, which does not have it (${has})` });
    }
  }
}

/* ---------- C1 / C2: commands ---------- */

const RUNNER = /(?:^|\|\s*|&&\s*)\s*(node|python|python3)\s+((?:"[^"]*"|'[^']*'|[^\s]+))/g;

/* AN ABSOLUTE WINDOWS PATH IN A DECLARATION IS NOT A PATH ANYWHERE ELSE, and
 * that is the whole point of the house rule — the documents say where to run a
 * command in the terms of the machine that runs it. The first version fed the
 * declared path straight to existsSync, which is true on Peter's laptop and
 * false on a Linux runner, so the checker was green locally and RED in CI on its
 * very first run, reporting four scripts as missing that were all there.
 *
 * So: match the declared path onto the tree we actually have. Longest existing
 * suffix under ROOT wins, which turns `C:/u3a St Ives/Using AI/Buses/BusMapsUK/
 * deck-src` into `<root>/BusMapsUK/deck-src` on any platform. A path with no
 * such suffix is in ANOTHER REPOSITORY — the engine, the portal — which a CI
 * checkout does not have; use it directly if it happens to be present (it is,
 * on the laptop) and otherwise skip that fence, counted and reported rather
 * than silently passed. A check that covers less than it did is only acceptable
 * if it says so. */
let outsideRepo = 0;
let placeheld = 0;   /* command paths behind a %VAR% or $VAR — see checkCommands */
function resolveOnThisTree(declared) {
  if (declared.toLowerCase().replace(/\\/g, '/') === ROOT.toLowerCase().replace(/\\/g, '/')) return ROOT;
  const parts = declared.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const candidate = path.join(ROOT, ...parts.slice(i));
    if (existsSync(candidate)) return candidate;
  }
  if (existsSync(declared)) return declared;   // another repo, present on this machine
  outsideRepo++;
  return false;                                 // another repo, not checked out here
}

function checkCommands(doc) {
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
  /* The declaration in force is the most recent one anywhere above the fence.
   * That is what the corpus actually does: `frequency-tier-model` declares its
   * folder once and then shows four commands over two sections.
   *
   * WHAT COUNTS AS ONE was narrowed on 2026-09-04 (OA-227): a path form is a
   * declaration only when the line issues an instruction and the path is not a
   * known file. See the comment on DECLARES_FOLDER_BARE_PATH. */
  const isDeclaration = (text) => {
    if (DECLARES_FOLDER_KEYWORD.test(text)) return true;
    const bare = DECLARES_FOLDER_BARE_PATH.exec(text);
    if (bare && cueInSameSentence(text, bare.index) && !namesAnExistingFile(bare[1])) return true;
    const rel = DECLARES_FOLDER_REL_PATH.exec(text);
    if (rel) {
      const p = path.join(ROOT, rel[1].replace(/\\/g, '/'));
      try { return statSync(p).isDirectory(); } catch { return false; }
    }
    return false;
  };
  const decls = doc.prose.filter((p) => isDeclaration(p.text));
  for (const fence of doc.fences) {
    if (!['bash', 'sh', 'shell'].includes(fence.lang)) continue;
    const decl = [...decls].reverse().find((d) => d.line < fence.line);
    if (!decl) {
      say(rel(doc.file), fence.line, 'C1',
        'a bash block with no folder declared above it — the house rule is that a documented command states where to run it from');
      continue;
    }
    /* Where does it say to run it? An absolute path wins; "repository root"
     * means this repo; "doesn't matter / from anywhere" means do not resolve. */
    let cwd = null;
    /* A Windows path in this corpus is ALWAYS inside backticks, and it always
     * has spaces in it (`C:\u3a St Ives\Using AI\Buses`). Matching on
     * whitespace instead truncated every one of them to `C:/u3a` and then
     * reported two live scripts as missing. Take the backticked form first. */
    const abs = /`([A-Za-z]:[\\/][^`\n]*)`/.exec(decl.text)
      || /([A-Za-z]:[\\/]\S*)/.exec(decl.text);
    /* A RELATIVE FOLDER IN BACKTICKS, added 2026-09-01 with OA-222. "run from
     * `make-bus-leaflet`" is how the skills repository names its own folders,
     * and there is no absolute path to match. Accepted ONLY when it resolves to
     * a directory that exists under ROOT — a backticked filename, a flag or a
     * prose noun therefore falls through to the behaviour below rather than
     * quietly redirecting the command somewhere it was never run. */
    const relDecl = /\bfrom\s+`([^`\n]+)`/.exec(decl.text);
    const relDir = relDecl && path.join(ROOT, relDecl[1].replace(/\\/g, '/'));
    if (/doesn'?t matter|from anywhere|any folder/i.test(decl.text)) cwd = false;
    /* N2 again, on the RESOLUTION side (2026-09-04). A line can be a declaration
     * by one of the keyword forms and still carry a backticked path that names a
     * document — "regenerate from the register, `C:\…\design-keys.md`". Resolving
     * a command against a markdown file is never right, so a file falls through
     * to the folder the document itself is in. */
    else if (abs && !namesAnExistingFile(abs[1])) cwd = resolveOnThisTree(abs[1].replace(/[\\/]+$/, '').replace(/\\/g, '/'));
    else if (relDir && existsSync(relDir) && statSync(relDir).isDirectory()) cwd = relDir;
    else if (/repository root|repo root/i.test(decl.text)) cwd = ROOT;
    else cwd = path.dirname(doc.file);

    for (const raw of fence.body) {
      const cmd = raw.replace(/\s+#.*$/, '');
      RUNNER.lastIndex = 0;
      let m;
      while ((m = RUNNER.exec(cmd))) {
        const arg = m[2].replace(/^["']|["']$/g, '');
        if (!/\.(js|mjs|cjs|py)$/i.test(arg)) continue;
        /* The ARGUMENT can be an absolute path too, and usually is when the
         * command reaches into the engine. `C:\...\prune_runs.py` is not an
         * absolute path on Linux and not a relative one either, so the first
         * version tested the literal string and, separately, resolved it
         * "against false" when the declaration said the folder does not matter.
         * Both were CI-only failures. Same resolver as the declaration. */
        /* A PATH THAT STARTS WITH A PLACEHOLDER IS NOT A PATH, and pretending
         * to resolve it reports a live script as missing. `make-place-bus-leaflet`
         * writes `node "%TSK%\stage.js"` and defines TSK, PSK and SK as absolute
         * paths in its own prose, which is the house rule satisfied — "explain
         * every placeholder" — in a form no resolver can follow: the definition
         * is a sentence, not an assignment, and expanding it would mean this
         * check guessing at prose. So it is SKIPPED AND COUNTED, printed with
         * the outside-the-repo total, on the same principle as that one: a check
         * that covers less than it did is only acceptable if it says so.
         * Added 2026-09-01 with OA-222; nothing in this repository's own corpus
         * writes a placeholder inside a bash fence today, so it starts at zero
         * here and exists for the corpus it was widened onto. */
        if (/^["']?(%[A-Za-z_][A-Za-z0-9_]*%|\$\{?[A-Za-z_])/.test(arg)) { placeheld++; continue; }
        let target;
        if (path.isAbsolute(arg) || /^[A-Za-z]:[\\/]/.test(arg)) {
          target = resolveOnThisTree(arg.replace(/\\/g, '/'));
        } else if (cwd === false) {
          continue;
        } else {
          target = path.resolve(cwd, arg);
        }
        if (!target) continue;
        if (!existsSync(target))
          say(rel(doc.file), fence.line, 'C2',
            `the command names ${arg}, which does not exist`,
            `resolved against ${cwd === ROOT ? 'the repository root' : String(cwd)}`);
      }
    }
  }
}

/* ---------- run ---------- */

for (const file of corpus.concat(archived)) {
  const doc = load(file);
  if (!doc) continue;
  const before = findings.length;
  checkLinks(doc);
  if (!ARCHIVED.has(file)) {
    checkSections(doc);
    checkCommands(doc);
  }
  if (VERBOSE)
    console.log(`  ${String(findings.length - before).padStart(3)} findings  ${path.relative(ROOT, file).replace(/\\/g, '/')}`);
}

const NAME = {
  L1: 'dead link', L2: 'dead anchor', L3: 'section citation',
  C1: 'command without a folder', C2: 'command names a missing script',
};

if (findings.length) {
  console.log('');
  let last = '';
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (f.file !== last) { console.log(`\n${f.file}`); last = f.file; }
    console.log(`  ${String(f.line).padStart(5)}  [${f.code} ${NAME[f.code]}]  ${f.why}`);
    if (f.extra) console.log(`         ${f.extra}`);
  }
}

if (siteLinks.length) {
  console.log(`
${siteLinks.length} site path${siteLinks.length === 1 ? '' : 's'} not checked — a link beginning \`/\` names a route on the website, which no file on disk has to back:`);
  for (const a of siteLinks.slice(0, 12)) console.log(`  ${a.file}:${a.line}  ${a.why}`);
  if (siteLinks.length > 12) console.log(`  … and ${siteLinks.length - 12} more`);
}

if (advisories.length) {
  console.log(`\n${advisories.length} citation${advisories.length === 1 ? '' : 's'} nothing can check — a §n with no named target, in a document that has no sections of its own:`);
  for (const a of advisories.slice(0, 12)) console.log(`  ${a.file}:${a.line}  ${a.why}`);
  if (advisories.length > 12) console.log(`  … and ${advisories.length - 12} more`);
  console.log('  These do not fail the check. Name the document beside the § if you want one covered.');
}

if (legal)
  console.log(`\n${legal} licence or statute clause citation${legal === 1 ? '' : 's'} skipped — a § preceded by ODbL, GDPR or the like belongs to a document we did not write.`);

if (outsideRepo)
  console.log(`\n${outsideRepo} documented path${outsideRepo === 1 ? '' : 's'} into another repository that is not checked out here — the engine, or the portal — so the script named was not verified. On a machine with those trees beside this one, this line reads 0.`);

if (placeheld)
  console.log(`
${placeheld} documented command path${placeheld === 1 ? '' : 's'} behind a %VAR% placeholder — the document defines those in prose, which no resolver can follow, so the script named was not verified.`);

console.log(`\n${corpus.length} documents checked, plus ${archived.length} archived for links only — ${findings.length ? `${findings.length} FINDING${findings.length === 1 ? '' : 'S'}` : 'no dead links, anchors, section citations or commands'}.`);
if (findings.length) {
  console.log('\nA link that resolves is not a citation that is still true. When you cut content out of a');
  console.log('document, grep the doc sets for its filename AND for the headings you are removing.');
}
process.exitCode = findings.length ? 1 : 0;
