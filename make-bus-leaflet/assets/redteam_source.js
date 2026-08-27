#!/usr/bin/env node
/*
 * redteam_source.js — decide whether this town's S6 can REUSE a red-team answer
 * it has already paid for, or must buy a new one.
 *
 * WHY. The blind red-team agent is the most expensive thing in this whole skill:
 * 89k-137k tokens and 41-70 tool calls per town, about 814,000 tokens for seven
 * towns on 2026-08-26 (references/s6-verify.md, "Cost"). Until 2026-08-27 every
 * S6 run spawned a new one unconditionally, and the answers were not even tracked
 * in git, so seventeen of them sat on one disk that prune_runs.py was entitled to
 * thin. Both of those are now fixed; this is the part that stops re-buying.
 *
 * THE ARGUMENT FOR REUSE, stated plainly so nobody quietly widens it. What makes
 * the red team's answer independent is that IT NEVER SAW OUR ANSWER -- that is
 * what "blind" means. Blindness does not decay with time. A thirty-day-old answer
 * derived without sight of our data is exactly as independent as one derived this
 * morning. What DOES decay is its accuracy about the world, and there are only
 * two ways that matters here:
 *
 *   1. OUR data moved. If S1 or S2 has been re-pulled since the answer was taken,
 *      the thing being diffed has changed and the diff must be redone. S3 is NOT
 *      in that list, deliberately: S3 is config -- our colours, our labels, our
 *      drawing choices -- and the red team makes no claim about any of it. (This
 *      is narrower than status.js's own s6Stale rule, which counts all three,
 *      because that rule is about whether the whole REPORT is current, not about
 *      whether this one input can be re-used.)
 *   2. THE WORLD moved without our data moving. A withdrawal, a re-tender, an
 *      operator change. Nothing in this repository can detect that, so it is
 *      bounded by an age window instead of measured.
 *
 * THE WINDOW is 60 days by default. That is a judgement, not a measurement, and
 * here is the reasoning behind it so it can be argued with: the red team earns
 * its cost mainly on services that changed since our data was pulled, and the
 * changes it has actually found were dated to individual days (route 31 withdrawn
 * 31 Dec 2025, X31 from 2 Jan 2026, Wisbech's 68 back to FACT on 1 Jun 2026) --
 * i.e. commercial timetable-change dates, which cluster a few times a year.
 * Sixty days cannot straddle two of those. Override with --max-age-days.
 *
 * Run it from the S6 run dir, AFTER stage.js pull S1 S2 S3, with no placeholders:
 *     node "%SK%\redteam_source.js"
 * or point it anywhere:
 *     node redteam_source.js --into "<S6 run dir>" --build "<town or place folder>"
 *     node redteam_source.js --max-age-days 30
 *     node redteam_source.js --dry-run        decide and report, copy nothing
 *
 * `--into` defaults to the current directory and `--build` to two levels above
 * it, which is where a town folder sits relative to its S6-verify/<date> run.
 *
 * EXIT CODES.  0 = reused, a redteam.json is now in the run dir.
 *             10 = must spawn the agent (this is the normal, expected outcome for
 *                  a town whose data has just been re-pulled -- not an error).
 *              2 = could not decide (no manifest, unreadable candidate).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return (i >= 0 && argv[i + 1]) ? argv[i + 1] : d; };
const DRY = argv.includes('--dry-run');
const INTO = path.resolve(flag('--into', process.cwd()));
const BUILD = path.resolve(flag('--build', path.join(INTO, '..', '..')));
const MAX_AGE = Number(flag('--max-age-days', '60'));

function die(msg) { console.error('redteam_source.js: ' + msg); process.exit(2); }
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const manifestPath = path.join(BUILD, 'manifest.json');
if (!fs.existsSync(manifestPath)) die(`no manifest.json at ${manifestPath}. Pass --build "<the town or place folder>".`);
const m = readJ(manifestPath);

// When were the inputs the red team is diffed against last pulled? S1 and S2 only.
let newestDataAt = null, newestDataStage = null;
for (const st of ['S1', 'S2']) {
  const s = m.stages && m.stages[st];
  if (!s || !s.latest) continue;
  const rec = (s.runs || []).find(r => r.id === s.latest);
  if (rec && rec.at && (!newestDataAt || rec.at > newestDataAt)) { newestDataAt = rec.at; newestDataStage = st; }
}

/* Every red-team answer this build has ever bought, newest first. They live in
 * the S6 run folders; those folders are gitignored but redteam.json itself is
 * re-included (buses-data .gitignore, 2026-08-27), so a fresh clone has them all. */
const s6root = path.join(BUILD, 'S6-verify');
const candidates = [];
if (fs.existsSync(s6root)) {
  for (const d of fs.readdirSync(s6root)) {
    const f = path.join(s6root, d, 'redteam.json');
    if (!fs.existsSync(f)) continue;
    let j;
    try {
      j = JSON.parse(fs.readFileSync(f, 'utf8')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    } catch (e) { console.error(`  (skipping unparseable ${f}: ${e.message})`); continue; }
    // Prefer the answer's OWN derivedAt over the folder date: the folder says when
    // the run happened, the field says when the research was done, and only the
    // second is a statement about how current the answer is.
    const at = j.derivedAt || d.slice(0, 10);
    candidates.push({ dir: d, file: f, at: String(at).slice(0, 10), services: (j.services || []).length });
  }
}
candidates.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.dir < b.dir ? 1 : -1)));

const today = new Date().toISOString().slice(0, 10);
const ageDays = d => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

console.log(`redteam_source — ${m.town || path.basename(BUILD)}`);
console.log(`  inputs last pulled : ${newestDataAt || '(unknown)'}${newestDataStage ? ' (' + newestDataStage + ')' : ''}`);
console.log(`  answers on disk    : ${candidates.length}${candidates.length ? ' (newest ' + candidates[0].at + ')' : ''}`);
console.log(`  window             : ${MAX_AGE} days`);

if (!candidates.length) {
  console.log('\n  BUY — this build has no red-team answer at all. Spawn the blind agent;');
  console.log('        see references/s6-verify.md for the exact prompt.');
  process.exit(10);
}

const best = candidates[0];
const age = ageDays(best.at);
const reasons = [];
// Compare dates only: derivedAt is a date, a run `at` is a date+time, and
// comparing the two as strings made a same-day re-pull look newer than the answer.
if (newestDataAt && String(newestDataAt).slice(0, 10) > best.at) {
  reasons.push(`our ${newestDataStage} inputs were re-pulled on ${String(newestDataAt).slice(0, 10)}, after this answer was derived (${best.at}) — the thing being diffed has changed`);
}
if (age > MAX_AGE) {
  reasons.push(`the answer is ${age} days old, past the ${MAX_AGE}-day window — the world may have moved without our data moving`);
}

if (reasons.length) {
  console.log('\n  BUY — spawn the blind agent. Why:');
  for (const r of reasons) console.log('        * ' + r);
  console.log(`\n        The existing answer stays on disk and in git either way; nothing is`);
  console.log(`        overwritten. Newest is ${best.file}`);
  process.exit(10);
}

console.log(`\n  REUSE — ${best.file}`);
console.log(`          derived ${best.at} (${age}d ago), ${best.services} services, and our S1/S2`);
console.log(`          inputs have not moved since. It was derived without sight of our data,`);
console.log(`          which is what makes it independent, and that does not decay with age.`);
const dest = path.join(INTO, 'redteam.json');
if (DRY) {
  console.log(`          --dry-run: would copy it to ${dest}`);
} else if (path.resolve(best.file) === path.resolve(dest)) {
  console.log(`          already in place at ${dest}`);
} else {
  fs.copyFileSync(best.file, dest);
  console.log(`          copied to ${dest}`);
}
console.log(`\n          Record it: pass --note "...redteam reused from ${best.dir}..." to stage.js commit S6,`);
console.log(`          so the run says whose research it rests on.`);
process.exit(0);
