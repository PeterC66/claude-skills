#!/usr/bin/env node
// Layout faults that confound an EDIT rather than a reader: a byte-order mark, a
// file with two kinds of line ending, trailing whitespace, a missing final newline.
//
// WHY IT EXISTS (buses-data OA-241, 2026-09-04). `failure-shape-memories.json`
// would not take an edit, because its entries had been appended with LF to an
// outer object git had checked out as CRLF. Nothing could see it. With
// `core.autocrlf=true` and `text=auto` the index NORMALISES to LF the moment a
// file is staged — a mixed working tree therefore produces a CLEAN DIFF. A sweep
// of the three repositories then found 47 faults in community-bus-maps, 6 in
// buses-data and 2 here, 52 of them byte-order marks.
//
// WHY IT LIVES HERE, in claude-skills, and not where it was written. It was born
// in buses-data, which is PRIVATE; community-bus-maps and claude-skills are
// PUBLIC. A private checker cannot be run by a public repository's CI without a
// cross-repo token, and hanging a hygiene check off `CROSS_REPO_PAT2` is exactly
// what buses-data's `docs` job was separated out to avoid — a token expiry must
// not take the documentation checks down with the byte gates. This repository is
// public, so all three can fetch it with no secret at all. The direction is the
// point: a shared rule belongs in the repository anyone can read.
//
// AND THE MOVE FORCED THE DESIGN. Carrying one repository's exclusion list in a
// checker three repositories run is the shape OA-222 named — a copy is a checker
// owning someone else's rule — so THE RULE TRAVELS AND THE EXEMPTIONS STAY HOME.
// Each repository declares its own in a `.file-hygiene.json` at its root; a
// repository without one gets the bare rules, which is the correct default for a
// repository nobody has thought about yet.
//
// THE TWO CALLERS SEE DIFFERENT FAULTS, AND THAT IS DELIBERATE.
//
//   MIXED EOL is a property of a WORKING TREE and of nothing else. `actions/
//   checkout` builds a uniform tree by construction, so in CI this check cannot
//   fire and is not meant to. `--staged`, from a pre-commit hook, is where it
//   earns its place. DO NOT delete it on noticing CI never reports it.
//
//   BOM, TRAILING WHITESPACE, BLANK RUNS and a MISSING FINAL NEWLINE are
//   properties of committed bytes. CI is the caller that always exists.
//
// TWO TIERS, because "never legitimate" and "house style" are different claims.
// Tier 1 — BOM and mixed EOL — applies to every tracked text file. Tier 2 —
// whitespace, blank runs, final newline — applies only to files a repository
// counts as its own: generated output belongs to its generator, and an archived
// plan or a correspondence message is a RECORD, where tidying is worse than the
// untidiness. A gate red on day one about files nobody may touch is a gate
// somebody mutes in its first week.
//
// Run it from any repository root, or point it elsewhere. No placeholders but
// the directory:
//   node tools/check-file-hygiene.mjs
//   node tools/check-file-hygiene.mjs --root /path/to/some/repo
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/* AN UNKNOWN FLAG IS REFUSED BY NAME, exit 2 — never ignored. The house rule,
 * bought on 2026-09-02 when `check-doc-links.mjs --tree <dir>` accepted a flag
 * belonging to a different checker, ran its DEFAULT scope, and printed a
 * confident verdict about a corpus the caller had not asked about. A checker a
 * typo can silently repoint is a checker that lies about what it read. */
const KNOWN = ['--root', '--staged'];
const TAKES_VALUE = new Set(['--root']);
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    if (!KNOWN.includes(a)) {
      console.error(`check-file-hygiene.mjs: unknown flag ${a} (known: ${KNOWN.join(', ')})`);
      process.exit(2);
    }
    if (TAKES_VALUE.has(a)) i++;
  }
}

const rootArg = process.argv.indexOf('--root');
const staged = process.argv.includes('--staged');
const ROOT = path.resolve(rootArg > -1 ? process.argv[rootArg + 1] : process.cwd());

/* A BOM is load-bearing in a PowerShell script and noise everywhere else.
 * Windows PowerShell 5.1 reads a BOM-LESS file as ANSI, so the first em dash
 * added to a message string would be mangled at run time with nothing to show
 * for it in the diff. This is a fact about PowerShell, not a repository's
 * preference, so it is here rather than in a config file. */
const BOM_IS_MEANINGFUL = new Set(['.ps1', '.psm1', '.psd1']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.docx', '.pptx', '.xlsx', '.zip', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.sqlite', '.webp', '.mp4', '.svgz', '.gz', '.age']);

/**
 * A repository's own declarations, from `.file-hygiene.json` at its root.
 *
 *   neverRead    [regex source] — byte-exact corpora, OUT OF SCOPE ENTIRELY
 *                rather than merely exempt. Reading them invites a later session
 *                to "fix" a fixture whose whole purpose is to be compared byte
 *                for byte. A checker that names them is a checker that tempts
 *                somebody.
 *   notAuthored  [[regex source, reason]] — Tier 2 does not apply.
 *   notOurs      {path: reason} — Tier 2 does not apply, named file by file.
 *                A STALE ENTRY IS A HARD ERROR, so a document that leaves cannot
 *                leave an exemption behind.
 *
 * Absent is not an error: the bare rules are the right default for a repository
 * nobody has declared anything about.
 */
function declarations(root) {
  const p = path.join(root, '.file-hygiene.json');
  if (!existsSync(p)) return { neverRead: [], notAuthored: [], notOurs: new Map(), declared: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`check-file-hygiene: ${p} is not valid JSON — ${e.message}`);
    process.exit(2);
  }
  const re = (src, where) => {
    try { return new RegExp(src); } catch (e) {
      console.error(`check-file-hygiene: ${where} in ${p} is not a valid regular expression — ${e.message}`);
      process.exit(2);
    }
  };
  return {
    neverRead: (raw.neverRead ?? []).map((s) => re(s, `neverRead ${JSON.stringify(s)}`)),
    notAuthored: (raw.notAuthored ?? []).map(([s, why]) => [re(s, `notAuthored ${JSON.stringify(s)}`), why]),
    notOurs: new Map(Object.entries(raw.notOurs ?? {})),
    declared: true,
  };
}

const DECL = declarations(ROOT);

/* A STALE EXEMPTION IS A HARD ERROR — but only in a WHOLE-CORPUS run, and that
 * caveat is what an integration test bought on 2026-09-04. "Is every exemption
 * still current" is a claim about the CORPUS; `--staged` sees one commit and is
 * in no position to make it. Without this gate the pre-commit hook refused every
 * commit in any repository whose root was not the checker's own. */
if (!staged) {
  for (const rel of DECL.notOurs.keys()) {
    if (!existsSync(path.join(ROOT, rel))) {
      console.error(`check-file-hygiene: ${ROOT}/.file-hygiene.json exempts ${rel}, which is not there any more — remove the entry or fix the path.`);
      process.exit(2);
    }
  }
}

function tracked(root) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`check-file-hygiene: cannot ask git what is tracked in ${root} — ${e.message}`);
    process.exit(2);
  }
  const files = out.split('\0').filter(Boolean);
  /* A CHECK THAT CANNOT FIND ITS SUBJECT MUST NOT REPORT CLEAR. An empty list
   * would quietly turn this into a check of nothing at all. */
  if (!files.length) {
    console.error(`check-file-hygiene: git tracks nothing in ${root} — this check cannot find its subject`);
    process.exit(2);
  }
  return files;
}

function stagedPaths(root) {
  const out = execFileSync('git', ['-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

const files = (staged ? stagedPaths(ROOT) : tracked(ROOT))
  .filter((f) => !DECL.neverRead.some((re) => re.test(f)));

const findings = [];
let checked = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const ext = path.extname(rel).toLowerCase();
  if (BINARY_EXT.has(ext)) continue;
  if (!existsSync(abs)) continue;
  const d = readFileSync(abs);
  if (!d.length) continue;
  if (d.indexOf(0) !== -1) continue; // binary by content
  checked++;

  // ---- Tier 1: never legitimate, every tracked text file.
  if (d[0] === 0xef && d[1] === 0xbb && d[2] === 0xbf && !BOM_IS_MEANINGFUL.has(ext)) {
    findings.push([rel, 'BOM', 'a byte-order mark sits before the first character and breaks any edit that matches on the start of the file']);
  }
  const latin = d.toString('latin1');
  const crlf = (latin.match(/\r\n/g) || []).length;
  const lf = (latin.match(/\n/g) || []).length - crlf;
  if (crlf && lf) {
    findings.push([rel, 'MIXED-EOL', `${crlf} CRLF and ${lf} LF line(s) — an edit matching on surrounding text will not match`]);
  }

  // ---- Tier 2: house style, files this repository counts as its own.
  if (DECL.notOurs.has(rel) || DECL.notAuthored.some(([re]) => re.test(rel))) continue;

  const text = d.toString('utf8');
  if (!text.endsWith('\n')) findings.push([rel, 'NO-FINAL-NEWLINE', 'a text file should end with a newline']);
  const tw = text.split('\n').filter((l) => /[ \t]+\r?$/.test(l)).length;
  if (tw) findings.push([rel, 'TRAILING-WS', `${tw} line(s) end in whitespace`]);
  if (/\n{4,}/.test(text)) findings.push([rel, 'BLANK-RUN', 'three or more consecutive blank lines']);
}

const scope = staged ? 'staged' : `tracked in ${ROOT}`;
const decl = DECL.declared ? '' : ' (no .file-hygiene.json — bare rules)';
if (!findings.length) {
  console.log(`check-file-hygiene: ${checked} text file(s) ${scope}${decl} — all clean.`);
  process.exit(0);
}
for (const [rel, kind, why] of findings) console.error(`${rel}\n    ${kind}: ${why}`);
console.error(`\ncheck-file-hygiene: ${findings.length} finding(s) across ${checked} text file(s) ${scope}${decl}.`);
process.exit(1);
