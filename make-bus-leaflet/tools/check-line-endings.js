#!/usr/bin/env node
/*
 * check-line-endings.js — is any tracked file CRLF or MIXED in this WORKING TREE?
 *
 * WHY THIS IS ABOUT THE WORKING TREE AND NOT THE COMMIT (OA-174). The repo's
 * `.gitattributes` has said `* text=auto eol=lf` since 2026-08-28 (OA-073), so
 * every tracked file is stored LF and every FRESH checkout writes LF. What it
 * cannot do is rewrite a file that was already sitting on disk when it landed:
 * `eol=lf` acts at checkout, and a file git has not had reason to touch since
 * keeps whatever terminator it was first written with. On 2026-09-01 this laptop
 * still held four — `prove-red-status.js` and `provenance_date.test.js` CRLF,
 * `s2-geometry.md` and `s3-config.md` mixed — in an otherwise all-LF tree.
 *
 * WHAT THAT COSTS, which is small, real, and happens every time. A patch script
 * with a multi-line anchor written `\n` silently matches NOTHING in such a file.
 * That happened on 2026-08-29 and again on 2026-09-01, and both times the only
 * thing that caught it was an assert on the anchor rather than a half-applied
 * edit. The other half is worse: a script that splits on `\n` and rejoins on
 * `\n` normalises the file, so the real change is buried in a diff of every line
 * and `git diff --stat` reports hundreds of insertions — the artefact a stat
 * line cannot describe. Both are avoidable by detecting the file's own
 * terminator, which is the habit; this is the thing that says the habit is
 * needed here at all.
 *
 * IT CANNOT RUN IN CI, AND SAYING SO IS PART OF THE CHECK. `actions/checkout`
 * produces a tree written by that same `eol=lf` rule, so every file there is LF
 * by construction and this would be green for ever — a check sited where its
 * subject cannot exist. The same reasoning keeps the untracked-sibling hook out
 * of CI and keeps `status.js`'s fixture-freshness row a laptop question. Wiring
 * this to something that always passes would be worse than leaving it out.
 *
 * FIXING WHAT IT FINDS COSTS NOTHING COMMITTED. The index already holds LF, so
 * rewriting the working copy to LF changes no committed byte — on 2026-09-01 all
 * four files came out with the identical blob hash they went in with. Run it
 * from `make-bus-leaflet`, with no placeholders:
 *
 *     node tools/check-line-endings.js            report, exit 1 on any finding
 *     node tools/check-line-endings.js --fix      rewrite them to LF, on the bytes
 *
 * `--fix` goes through `assets/line_endings.js`, which works on the BYTES: the
 * obvious `buf.toString('utf8').replace(...)` silently rewrites every byte that
 * is not legal UTF-8, and it corrupted a tracked fixture the first time it ran.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { lfBytes } = require('../assets/line_endings');

const ROOT = path.join(__dirname, '..', '..');   // the skills repo root
const FIX = process.argv.includes('--fix');

let out;
try {
  out = execFileSync('git', ['ls-files', '--eol'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  console.error('check-line-endings: could not run `git ls-files --eol` in ' + ROOT);
  console.error('  ' + (e.message || e));
  process.exit(2);
}

/* `i/<index>  w/<worktree>  attr/<attrs>\t<path>`. Only the WORKTREE column is
 * this check's subject; the index column is LF by construction, and asserting on
 * it would be the vacuous half.
 *
 * SPLIT ON THE TAB, and do not try to match the attrs with a pattern. The first
 * cut of this file read `attr/\S*\s*\t`, which cannot cross the SPACE inside
 * `attr/text=auto eol=lf` — the value every file in this repository carries — so
 * it matched no line at all and the check reported the tree clean. It was caught
 * by deliberately making a file CRLF and watching it stay GREEN, which is the
 * only reason it is not still saying so. A parser that silently matches nothing
 * is a permanent false negative wearing a zero exit code.
 *
 * The verdicts are an ALLOWLIST rather than a skip-list: only `crlf` and `mixed`
 * are findings, so a value nobody anticipated — `none` for a binary, or anything
 * a future git adds — is ignored rather than reported as a fault. */
const rows = [];
for (const line of out.split('\n')) {
  const raw = line.replace(/\r$/, '');
  const tab = raw.indexOf('\t');
  if (tab < 0) continue;
  const m = /^i\/(\S+)\s+w\/(\S+)\s/.exec(raw.slice(0, tab) + ' ');
  if (!m) continue;
  const [, index, work] = m;
  if (work !== 'crlf' && work !== 'mixed') continue;
  rows.push({ file: raw.slice(tab + 1), index, work });
}

console.log(`check-line-endings — ${ROOT}`);
if (!rows.length) {
  console.log('  every tracked file is LF in this working tree.');
  process.exit(0);
}

console.log(`  ${rows.length} tracked file(s) are NOT LF on disk:\n`);
for (const r of rows) console.log(`    ${r.work.toUpperCase().padEnd(6)} ${r.file}   (index: ${r.index})`);

if (!FIX) {
  console.log('\n  A multi-line patch anchor written with \\n will not match any of these, and a');
  console.log('  script that rejoins on \\n will bury its real change in a whole-file diff.');
  console.log('  The index already holds LF, so fixing them changes no committed byte:');
  console.log('      node tools/check-line-endings.js --fix');
  process.exit(1);
}

let changed = 0;
for (const r of rows) {
  const p = path.join(ROOT, r.file);
  const before = fs.readFileSync(p);
  const after = lfBytes(before);
  if (after.equals(before)) continue;
  fs.writeFileSync(p, after);
  console.log(`    rewrote ${r.file}  ${before.length} -> ${after.length} bytes`);
  changed++;
}
console.log(`\n  ${changed} file(s) rewritten to LF. Confirm nothing was committed by it:`);
console.log('      git add -A && git diff --cached --stat        (expect no output)');
console.log('  Then run the suites, because a harness that compares bytes is exactly the kind');
console.log('  of thing a line-ending change can move: npm test, npm run test:prove-red,');
console.log('  npm run test:prove-red-gates, npm run test:prove-red-status.');
