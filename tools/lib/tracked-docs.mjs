// Which markdown files in THIS repository are documents nobody has been checking.
//
// OA-224 Tier 5 (cross-repo F6/F7/F8). `check-tables.mjs` and
// `check-doc-links.mjs` have each been widened by hand seven times, and every
// widening but the last was a folder literal added to a list after somebody
// noticed a corpus nobody had looked at. Measured 2026-09-02: **52 tracked `.md`
// files in this repository were in neither checker's scope** — `_gtfs/` (16, the
// monthly refresh reports), `Areas/` (30) and `Places/` (3, the map READMEs, the
// S1 bootstrap reports, High Wycombe's POI worksheet), and two loose review
// documents at the root.
//
// SO THIS ENUMERATES RATHER THAN LISTS, for the reason `correspondenceDirs()`
// already established one folder along: a repository whose shape is created by
// whoever builds the next map cannot have its corpus written down. A new town's
// README is checked the day it is committed, without anybody editing a checker.
//
// IT ASKS GIT, NOT THE DISK, and that is the whole of the design. `S4-generate/`,
// `S5-render/` and `S6-verify/` are gitignored except for `README.md`, and a
// session mid-build has scratch markdown all over the estate; a `readdir` walk
// would check a neighbour's uncommitted file and make the row count move under
// anyone reading it. `git ls-files` is the same population `assemble.mjs` uses to
// build the backlog index, and for the same reason.
//
// A CHECK THAT CANNOT FIND ITS SUBJECT MUST NOT REPORT CLEAR: if git is not
// there or answers nothing, this throws rather than returning an empty list,
// because an empty list would quietly return both checkers to the scope they had
// before this file existed.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Every tracked `*.md` in the repository at `root`, as repo-relative POSIX paths. */
export function trackedMarkdown(root) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '*.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`cannot ask git which documents are tracked in ${root}: ${e.message}`);
  }
  const files = out.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!files.length) throw new Error(`git tracks no .md files in ${root} — this check cannot find its subject`);
  return files;
}

/**
 * The DIRECTORIES holding tracked markdown that none of `covered` already covers,
 * as absolute paths with a trailing separator — the shape `check-tables.mjs`
 * wants, because its scan is flat and `--root` must stay flat.
 *
 * `covered` is a list of repo-relative directory prefixes the caller already
 * scans. A prefix matches a file that is inside it at any depth, so passing
 * `Documentation` covers `Documentation/lib/x.md` too.
 */
export function untrackedByCheckers(root, covered) {
  const dirs = new Set();
  for (const f of trackedMarkdown(root)) {
    if (covered.some((c) => f === c || f.startsWith(c.replace(/\/$/, '') + '/'))) continue;
    dirs.add(path.join(root, path.dirname(f)) + path.sep);
  }
  return [...dirs].sort();
}

/** The same population as FILES, for a checker that reads files rather than folders. */
export function untrackedFiles(root, covered) {
  return trackedMarkdown(root)
    .filter((f) => !covered.some((c) => f === c || f.startsWith(c.replace(/\/$/, '') + '/')))
    .sort();
}
