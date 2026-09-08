#!/usr/bin/env node
/*
 * check-exclusion-fields.mjs — one field to write, three to read.
 *
 * Run it from the ROOT OF THE REPOSITORY YOU WANT CHECKED, with no arguments and no
 * placeholders — it reads the repository it is run FROM, never the one it lives in:
 *
 *     node "C:/u3a St Ives/.claude/skills/tools/check-exclusion-fields.mjs"
 *
 * WHAT IT CHECKS. A town's `verified-services.json` says "we know about this route and
 * deliberately do not draw it" in `notOnLeaflet[]`. Three older spellings —
 * `verifiedNotDisplayed[]`, `notDisplayed[]` and `excluded[]` — mean exactly the same
 * thing and are still READ by both checkers, for ever, so every S1 run this estate has
 * ever built stays readable. This gate is the other half of that promise: nothing NEW may
 * be written into them. Reading costs nothing; writing is what costs.
 *
 * WHY A GATE AND NOT A REPORT (OA-259, second half, 2026-09-06). Hours before this
 * landed, `assets/known_off.js` and `known_off_routes()` in `gtfs_refresh_report.py` were
 * made to read all four fields identically, which removed the BUG — a decision recorded
 * in the wrong spelling used to be invisible to S6, so a red-team lead costing 89k–137k
 * tokens was re-bought every run. It did not remove the QUESTION. A person writing a new
 * town still had to pick one of four; a reviewer still had to know all four; and a diff
 * moving an entry between them was indistinguishable from one changing its meaning. Four
 * spellings that behave identically are four chances to write the one nobody greps for.
 *
 * WHY AT COMMIT TIME. The two readers report a deprecated field only when they happen to
 * run — S6 on a build, the refresh diff monthly. A new town written from an old town's
 * file would carry the old spelling for however long that took. This fires on the push
 * that introduces it, which is the only moment the fix is one edit.
 *
 * IT WENT GREEN BECAUSE THE ESTATE WAS MIGRATED FIRST, not because it is lenient — all
 * four files that used an alias moved to `notOnLeaflet` in the same round, each as a new
 * dated S1 run, each proved answer-for-answer identical before and after. A gate that is
 * red on the day it lands is one that gets muted inside a week.
 *
 * Exit 0 clean, 1 with findings, 2 on a usage error. Findings go to stdout; the summary
 * line always prints, so "no files found" can never read as "all clean".
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { enclosingRepoRoot } from './lib/repo-root.mjs';

const CANONICAL = 'notOnLeaflet';
const DEPRECATED = ['verifiedNotDisplayed', 'notDisplayed', 'excluded'];

const argv = process.argv.slice(2);
const KNOWN = ['--root'];
for (const a of argv) {
  if (a.startsWith('--') && !KNOWN.includes(a)) {
    console.error(`check-exclusion-fields: unknown flag ${a} (known: ${KNOWN.join(', ')})`);
    process.exit(2);
  }
}
const rootIdx = argv.indexOf('--root');
/* WITH NO `--root`, THE SUBJECT IS THE ENCLOSING REPOSITORY (buses-data OA-275
 * step 2). The corpus below is `git ls-files` run at ROOT, so a cwd one folder
 * down used to answer about that folder alone — and the folder a session is most
 * likely to be standing in is a MAP folder, because the stage engine takes its
 * cwd as its subject and leaves the shell there. A gate about the estate,
 * answered about one town, is green for the wrong reason and says nothing about
 * it. See lib/repo-root.mjs. */
const ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : enclosingRepoRoot();
if (rootIdx >= 0 && !ROOT) { console.error('check-exclusion-fields: --root needs a directory'); process.exit(2); }

/*
 * FROM `git ls-files`, not from a walk. S1/S2/S3 run folders hold untracked scratch, a
 * session mid-build has half-written JSON everywhere, and a fresh S1 that has not been
 * committed is not yet anybody's problem. This is the same rule `tracked-docs.mjs` applies
 * to the documentation checkers, and for the same reason: the subject is what the
 * repository CARRIES.
 */
let tracked;
try {
  tracked = execFileSync('git', ['ls-files', '-z', '*verified-services.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
} catch (e) {
  console.error(`check-exclusion-fields: could not list tracked files in ${ROOT} — ${e.message}`);
  console.error('  Run it from the root of a git repository, or pass --root <dir>.');
  process.exit(2);
}

/*
 * THE LATEST S1 RUN OF EACH MAP, and only that one. This is the file the two readers
 * actually open — `latest_verified()` in gtfs_refresh_report.py sorts the same glob and
 * takes the last, and `stage.js pull S1` resolves to the same run — so checking anything
 * else would be checking something nothing reads.
 *
 * It also settles what the migration is allowed to touch. Every OLDER run is a dated
 * record of what was produced that day, and rewriting one would be a lie about the past
 * told to satisfy a gate about the present. That those files keep working is the whole
 * reason the three aliases are read for ever rather than deleted, so a gate demanding
 * they be edited would be arguing with its own premise.
 *
 * Newest by run id, which is `YYYY-MM-DD_HHMM` and therefore sorts chronologically.
 */
const byMap = new Map();
for (const rel of tracked) {
  const parts = rel.split('/');
  const i = parts.lastIndexOf('S1-services');
  if (i < 1 || i + 2 >= parts.length) continue;   // not the estate's layout; leave it alone
  const map = parts.slice(0, i).join('/');
  const run = parts[i + 1];
  const cur = byMap.get(map);
  if (!cur || run > cur.run) byMap.set(map, { run, rel });
}
const files = [...byMap.values()].map(v => v.rel).sort();
const superseded = tracked.length - files.length;

const findings = [];
let parsed = 0, unreadable = 0;
for (const rel of files) {
  let j;
  try { j = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')); } catch {
    // Reported, never skipped silently: an unparseable town file is a worse problem than
    // the one this gate is about, and "we could not look" must not read as "clean".
    unreadable++;
    findings.push({ rel, field: null, note: 'could not be parsed as JSON — nothing could be checked in it' });
    continue;
  }
  parsed++;
  for (const field of DEPRECATED) {
    const v = j[field];
    if (v === undefined || v === null) continue;
    const n = Array.isArray(v) ? v.length : 1;
    const routes = Array.isArray(v)
      ? v.map(e => (e && typeof e === 'object' ? (e.route ?? (e.group ? `group: ${e.group}` : '?')) : String(e))).map(String)
      : ['(not an array)'];
    // An EMPTY deprecated array is still the field in use. It silences nothing and hides
    // nothing, but it is what the next person cloning this town's file will copy, which is
    // exactly how a deprecated spelling outlives its deprecation. Delete the key.
    findings.push({ rel, field, n, routes, empty: Array.isArray(v) && v.length === 0 });
  }
}

for (const f of findings) {
  if (!f.field) { console.log(`  ${f.rel}\n      ${f.note}`); continue; }
  console.log(`  ${f.rel}`);
  if (f.empty) {
    console.log(`      \`${f.field}\` is a read-only alias and is EMPTY — delete the key.`);
    console.log('      It silences nothing today; it is what the next town copied from this file inherits.');
    continue;
  }
  console.log(`      \`${f.field}\` is a read-only alias — ${f.n} entr${f.n === 1 ? 'y' : 'ies'}: ${f.routes.join(', ')}`);
  console.log(`      Move them into \`${CANONICAL}[]\` verbatim. Both readers already treat the two the same,`);
  console.log('      so a migration that changes no answer is provable: run');
  console.log('        node "…/make-bus-leaflet/tools/prove-known-off-parity.js"');
  console.log(`      Keep each entry's own keys — \`reason\`, \`detail\`, \`servesTown\`, \`source\` are all read as they are.`);
}

console.log(`\ncheck-exclusion-fields — ${path.resolve(ROOT)}`);
console.log(`  ${files.length} map(s) checked at their latest S1 run, ${parsed} parsed${unreadable ? `, ${unreadable} unreadable` : ''}`);
console.log(`  ${superseded} superseded run(s) left alone — an older run is a dated record, not something to edit.`);
if (findings.length) {
  console.log(`  ${findings.length} finding(s): a deprecated exclusion field is still written.`);
  console.log(`  \`${CANONICAL}\` is the one to write; ${DEPRECATED.map(d => '`' + d + '`').join(', ')} are read for ever and written by nothing.`);
  process.exit(1);
}
console.log(`  every one writes its exclusions in \`${CANONICAL}\` — no deprecated field is in use.`);
