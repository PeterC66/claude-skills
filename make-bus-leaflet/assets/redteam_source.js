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
 *   1. OUR data moved. Not "was re-pulled" -- MOVED. Until 2026-09-01 this was
 *      decided from the `at` TIMESTAMP of the latest S1/S2 run, which is a proxy
 *      for the thing that matters, and on three occasions it was wrong about it
 *      (OA-166): a Wisbech S1 written only to ADJUDICATE the red team's own claim,
 *      a High Wycombe Aldi S1 re-derived to carry frequency fields with all 12
 *      services identical on route, operator, days, termini and headsigns, and a
 *      Ramsey S2 that rebuilt `routes_paths.json` and moved no fact at all. Each
 *      forced a ~100k-token BUY, each was overridden by hand in a commit note, and
 *      an override that lives in a commit message is not a mechanism.
 *
 *      It now compares a FINGERPRINT of the facts the answer is about -- route,
 *      operator, days, termini, headsigns, per service -- taken from the S1 run
 *      that was current when the answer was derived and from the S1 run that is
 *      current now. Registration windows, frequency samples, trip counts, GTFS
 *      shape flags and our own labelling are all deliberately OUT: the red team
 *      makes no claim about any of them, so none of them can invalidate it.
 *
 *      S2 is out of it entirely when a fingerprint can be taken. S2 owns drawn
 *      geometry, and geometry is not a service fact. S3 was already out, and for
 *      the same reason -- it is config, our colours and our labels. (All of this
 *      is narrower than status.js's own s6Stale rule, which counts all three,
 *      because that rule is about whether the whole REPORT is current, not about
 *      whether this one input can be re-used.)
 *
 *      WHEN IT CANNOT TELL -- neither `gtfs-services.json` nor
 *      `verified-services.json` is readable in both S1 runs, or the manifest does
 *      not name a run on both sides -- it says so and FALLS BACK to the old
 *      timestamp rule over S1 and S2. An absent fingerprint reads as "cannot
 *      tell", never as "unchanged"; the expensive answer is the safe one here.
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
 *     node redteam_source.js --foreign-build  answer about a DIFFERENT map on purpose
 *     node redteam_source.js --reuse-anyway "<reason>"   override a BUY, on the record
 *
 * --reuse-anyway exists because this guard is cheap to bypass and expensive to
 * obey, and a guard like that gets bypassed silently. It does not soften the
 * decision: it still prints every reason it would have bought, requires a reason
 * of its own, and STAMPS `_reuseOverride` into the copy it places in the run dir,
 * so the override travels with the run instead of living in a commit nobody
 * greps. It cannot conjure an answer that does not exist -- a build with no
 * red-team answer at all still exits 10.
 *
 * `--into` defaults to the current directory and `--build` to two levels above
 * it, which is where a town folder sits relative to its S6-verify/<date> run.
 *
 * WHICH BUILD DID IT ACTUALLY LOOK AT? (OA-141, 2026-08-29.) That default is
 * right from the documented cwd and silently wrong from anywhere else. Run from
 * a PLACE's own root -- the natural mistake, and the one made while doing OA-049
 * -- `../..` lands on `Areas/<Town>`, so the tool reported on Beaconsfield for a
 * place called Beaconsfield Waitrose, answered REUSE, and copied the TOWN's
 * answer into the place's folder. Nothing in the output said so. Two changes:
 *
 *   1. The resolved --build path is now printed on every run, always, next to
 *      the map name its manifest declares. One line, and it makes that failure
 *      impossible to miss rather than impossible to see.
 *   2. When --build is not passed, the tool no longer trusts `../..` blindly.
 *      It also walks UP from --into to the nearest enclosing manifest.json, and
 *      if the two disagree it REFUSES (exit 2) naming both, rather than picking
 *      one. An explicit --build that names a different map from the one --into
 *      sits inside is refused the same way, because it is a mistake every time
 *      -- unless you mean it, which is what --foreign-build says.
 *
 * `--foreign-build` exists for one question, and Peter DECIDED it on 2026-08-29:
 * a TOWN's red-team answer MAY verify a PLACE inside it, and every HARD it
 * produces is restated as a SOFT. The independence argument survives whole --
 * the red team never saw our data either way, and blindness does not decay by
 * being read twice. What does not survive is the SCOPE: a town answer is about
 * *services serving the town*, a place asks *services calling at these stops*,
 * so a town answer can be legitimately silent about a service reaching the place
 * but not the centre. Evidence, then, and not a verdict.
 *
 * The copy this places in the run dir is STAMPED `_borrowedFrom`; the answer in
 * its own build is never touched. verify_report.js reads that stamp and does the
 * downgrading. Without --foreign-build a cross-map answer is refused outright,
 * so borrowing is always deliberate and always recorded.
 *
 * EXIT CODES.  0 = reused, a redteam.json is now in the run dir.
 *             10 = must spawn the agent (this is the normal, expected outcome for
 *                  a town whose data has just been re-pulled -- not an error).
 *              2 = could not decide (no manifest, unreadable candidate, or the
 *                  folder is ambiguous -- see above).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return (i >= 0 && argv[i + 1]) ? argv[i + 1] : d; };
const DRY = argv.includes('--dry-run');
const FOREIGN = argv.includes('--foreign-build');
const INTO = path.resolve(flag('--into', process.cwd()));
const BUILD_GIVEN = argv.includes('--build');
const BUILD = path.resolve(flag('--build', path.join(INTO, '..', '..')));
const MAX_AGE = Number(flag('--max-age-days', '60'));
const REUSE_ANYWAY = argv.includes('--reuse-anyway') ? String(flag('--reuse-anyway', '')).trim() : null;

function die(msg) { console.error('redteam_source.js: ' + msg); process.exit(2); }
if (REUSE_ANYWAY !== null && (!REUSE_ANYWAY || REUSE_ANYWAY.startsWith('--'))) {
  die('--reuse-anyway needs a reason: --reuse-anyway "the S1 only re-derived frequency fields; no service fact moved".\n'
    + '  An override with no reason on it is indistinguishable from a bypass, which is the whole thing this flag exists to stop.');
}
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const manifestPath = path.join(BUILD, 'manifest.json');
if (!fs.existsSync(manifestPath)) die(`no manifest.json at ${manifestPath}. Pass --build "<the town or place folder>".`);
const m = readJ(manifestPath);

/* AMBIGUITY GUARD (OA-141). The default --build is a fixed `../..` hop, which is
 * a statement about where you are standing rather than about which map you are
 * verifying. Ask the filesystem the same question a second way -- walk up from
 * --into to the nearest enclosing manifest.json -- and refuse when the two
 * answers name different maps. From the documented cwd (`<build>/S6-verify/<id>`)
 * the two agree and nothing changes. Stop at the drive root; a place nested
 * inside a town means the FIRST manifest found going up is the right one. */
function enclosingBuild(start) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, 'manifest.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
const mapName = dir => {
  try { return readJ(path.join(dir, 'manifest.json')).town || path.basename(dir); }
  catch { return path.basename(dir); }
};
const ENCLOSING = enclosingBuild(INTO);
if (ENCLOSING && path.resolve(ENCLOSING) !== path.resolve(BUILD) && mapName(ENCLOSING) !== mapName(BUILD)) {
  if (!FOREIGN) {
    console.error('redteam_source.js: AMBIGUOUS — refusing rather than guessing which map you mean.');
    console.error('');
    console.error(`  --into                 : ${INTO}`);
    console.error(`  nearest build above it : ${ENCLOSING}`);
    console.error(`                           manifest says "${mapName(ENCLOSING)}"`);
    console.error(`  --build ${BUILD_GIVEN ? 'as given      ' : 'as defaulted  '} : ${BUILD}`);
    console.error(`                           manifest says "${mapName(BUILD)}"`);
    console.error('');
    console.error('  These are two different maps. Answering about the second one while you');
    console.error('  stand in the first is the OA-141 failure, and it used to be silent.');
    console.error('');
    console.error('  If you meant the map you are standing in, pass it explicitly:');
    console.error(`      node redteam_source.js --into "${INTO}" --build "${ENCLOSING}"`);
    console.error('  If you deliberately want the OTHER map\'s answer — a town\'s red team');
    console.error('  verifying a place inside it — add --foreign-build and say so in the');
    console.error('  stage.js commit note. That question is not settled; see OA-141.');
    process.exit(2);
  }
  console.log(`redteam_source — FOREIGN BUILD, deliberately (--foreign-build)`);
  console.log(`  standing in       : ${mapName(ENCLOSING)}  (${ENCLOSING})`);
  console.log(`  answering about   : ${mapName(BUILD)}  (${BUILD})`);
  console.log(`  Record this in the stage.js commit note — the answer is not this map's own.\n`);
}

/* WHAT THE ANSWER IS ABOUT (OA-166) ------------------------------------------
 *
 * The red team answers: which services serve this place, run by whom, on what
 * days, between which termini. That is the whole of what a fingerprint here may
 * contain, and everything else in the file is deliberately excluded -- most
 * pointedly `validFrom`/`validTo` (a registration window lengthening cannot
 * change which buses run) and `tripsAtTownPerWeekSample` (a frequency field
 * added by OA-158, which the red team does not judge).
 *
 * `gtfs-services.json` is preferred over `verified-services.json` because it is
 * the raw derivation from the feed, and it is the WORLD moving that stales an
 * answer. Our own adjudication of a red-team claim is a reply to the answer, not
 * a reason to re-buy it -- which is exactly the Wisbech case. Older S1 runs
 * predate `gtfs-services.json`, so `verified-services.json` is the fallback and
 * the file actually used is always named in the output.
 */
function serviceFacts(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.services) ? j.services : null);
  if (!arr) return null;
  const rows = arr.map(x => [
    String(x.route == null ? '' : x.route),
    String(x.operator == null ? '' : x.operator),
    String(x.days == null ? '' : x.days),
    (Array.isArray(x.termini) ? x.termini : []).map(String).sort(),
    (Array.isArray(x.headsigns) ? x.headsigns : []).map(String).sort(),
  ]);
  // Sorted, so a re-derivation that merely reorders the array is not a change.
  rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return { n: rows.length, hash: crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 12) };
}

const s1Runs = () => {
  const s = (m.stages && m.stages.S1) || {};
  return (s.runs || []).filter(r => r && r.id).map(r => ({
    id: r.id,
    at: String(r.at || '').slice(0, 10),
    dir: path.join(BUILD, r.dir || path.join('S1-services', r.id)),
  }));
};
/* The run the manifest CALLS latest, not the newest by date -- `latest` is the
 * stage pointer, and a stage can be rolled back to an earlier run deliberately. */
const s1Latest = () => s1Runs().find(r => r.id === ((m.stages && m.stages.S1) || {}).latest) || null;
/* The newest S1 run that had already happened when the answer was derived. Dates
 * only, and `<=` on the day itself: a same-day re-pull is treated as not newer,
 * exactly as the timestamp rule below already did, because neither the answer nor
 * the run records a time of day that could separate them. */
const s1AsOf = date => s1Runs().filter(r => r.at && r.at <= date)
  .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : -1)))[0] || null;

function fingerprintPair(answerDate) {
  const now = s1Latest(), then = s1AsOf(answerDate);
  if (!now || !then) return { ok: false, why: 'the manifest names no S1 run on both sides of the answer' };
  for (const f of ['gtfs-services.json', 'verified-services.json']) {
    const a = serviceFacts(path.join(then.dir, f)), b = serviceFacts(path.join(now.dir, f));
    if (a && b) return { ok: true, file: f, then, now, a, b, same: a.hash === b.hash };
  }
  return { ok: false, why: 'neither gtfs-services.json nor verified-services.json is readable in BOTH S1 runs (' + then.id + ' and ' + now.id + ')' };
}

// The FALLBACK input, used only when no fingerprint can be taken: when were the
// inputs the red team is diffed against last pulled? S1 and S2 only.
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
// Always say which folder that name came out of (OA-141). The name alone cannot
// distinguish "the map you are standing in" from "its parent town", and for a
// fortnight nothing did.
console.log(`  build examined     : ${BUILD}`);
console.log(`  answers copied to  : ${INTO}`);
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

/* DID THE FACTS MOVE? (OA-166.) The fingerprint answers it exactly; the
 * timestamp only ever guessed. Both branches print, always -- a decision this
 * expensive should never leave the operator wondering which rule it used. */
const fp = fingerprintPair(best.at);
if (fp.ok) {
  console.log(`  service facts      : ${fp.file}  S1 ${fp.then.id} (${fp.a.n} svc, ${fp.a.hash}) vs S1 ${fp.now.id} (${fp.b.n} svc, ${fp.b.hash})`);
  console.log(`                       route, operator, days, termini, headsigns — ${fp.same ? 'UNCHANGED' : 'CHANGED'}`);
  if (!fp.same) {
    reasons.push(`the service facts moved between S1 ${fp.then.id} and S1 ${fp.now.id} — route, operator, days, termini or headsigns differ, and that is exactly what the answer is about`);
  }
} else {
  console.log(`  service facts      : CANNOT TELL — ${fp.why}`);
  console.log(`                       falling back to the S1/S2 pull timestamp, which is a proxy`);
  // Compare dates only: derivedAt is a date, a run `at` is a date+time, and
  // comparing the two as strings made a same-day re-pull look newer than the answer.
  if (newestDataAt && String(newestDataAt).slice(0, 10) > best.at) {
    reasons.push(`our ${newestDataStage} inputs were re-pulled on ${String(newestDataAt).slice(0, 10)}, after this answer was derived (${best.at}) — and nothing here can say whether any fact the answer is about moved with them`);
  }
}
if (age > MAX_AGE) {
  reasons.push(`the answer is ${age} days old, past the ${MAX_AGE}-day window — the world may have moved without our data moving`);
}

if (reasons.length && REUSE_ANYWAY === null) {
  console.log('\n  BUY — spawn the blind agent. Why:');
  for (const r of reasons) console.log('        * ' + r);
  console.log(`\n        The existing answer stays on disk and in git either way; nothing is`);
  console.log(`        overwritten. Newest is ${best.file}`);
  if (fp.ok) {
    console.log(`\n        If you can say why this cannot have changed the answer, say it HERE and not`);
    console.log(`        in a commit note:  --reuse-anyway "<reason>"`);
  }
  process.exit(10);
}

/* THE OVERRIDE, ON THE RECORD (OA-166). It softens nothing about the decision --
 * every reason it would have bought for is printed first, in full -- and it goes
 * into the COPY as `_reuseOverride`, never into the answer in its own build. */
let override = null;
if (reasons.length) {
  override = { reason: REUSE_ANYWAY, on: today, overrode: reasons.slice() };
  console.log('\n  REUSE ANYWAY (--reuse-anyway) — overriding a BUY, deliberately. It would have bought because:');
  for (const r of reasons) console.log('        * ' + r);
  console.log(`        reason given : ${REUSE_ANYWAY}`);
  console.log('        Stamped into the copy as _reuseOverride, so the run carries it.');
} else if (REUSE_ANYWAY !== null) {
  console.log('\n  (--reuse-anyway was passed and there was nothing to override — no stamp written.)');
}

console.log(`\n  REUSE — ${best.file}`);
const why = override ? 'overridden as above'
  : fp.ok ? 'no service fact it is about has moved since'
  : 'our S1/S2 inputs have not moved since';
console.log(`          derived ${best.at} (${age}d ago), ${best.services} services, and ${why}.`);
console.log(`          It was derived without sight of our data, which is what makes it`);
console.log(`          independent, and that does not decay with age.`);
const dest = path.join(INTO, 'redteam.json');
if (DRY) {
  console.log(`          --dry-run: would copy it to ${dest}`);
} else if (path.resolve(best.file) === path.resolve(dest)) {
  console.log(`          already in place at ${dest}`);
  if (override) {
    console.log(`          NOT STAMPED — the answer is its own copy here, and _reuseOverride is`);
    console.log(`          never written into an answer in its own build. Record it in the`);
    console.log(`          stage.js commit note instead: --note "reused anyway: ${REUSE_ANYWAY}"`);
  }
} else if (FOREIGN || override) {
  /* A BORROWED answer is stamped on the COPY, never on the original in its own
   * build (OA-141, decided 2026-08-29). verify_report.js reads `_borrowedFrom`
   * and restates every red-team HARD as a SOFT: the answer is blind either way,
   * so it is good evidence, but it is scoped to *services serving that map* and
   * cannot settle a question about these stops on its own. Without the stamp the
   * borrowing is invisible to every reader downstream, which is the whole failure
   * this row is about, one file along. */
  const j = JSON.parse(fs.readFileSync(best.file, 'utf8'));
  if (FOREIGN) j._borrowedFrom = { map: m.town || path.basename(BUILD), build: BUILD, run: best.dir, derivedAt: best.at, borrowedOn: today };
  if (override) j._reuseOverride = override;
  fs.writeFileSync(dest, JSON.stringify(j, null, 2) + '\n');
  const stamps = [FOREIGN ? '_borrowedFrom ' + j._borrowedFrom.map : null, override ? '_reuseOverride' : null].filter(Boolean);
  console.log(`          copied to ${dest}, STAMPED ${stamps.join(' and ')}`);
  if (FOREIGN) console.log(`          Its findings will be SOFT, not blocking — that is the deal for a borrowed answer.`);
} else {
  fs.copyFileSync(best.file, dest);
  console.log(`          copied to ${dest}`);
}
console.log(`\n          Record it: pass --note "...redteam reused from ${best.dir}..." to stage.js commit S6,`);
console.log(`          so the run says whose research it rests on.`);
process.exit(0);
