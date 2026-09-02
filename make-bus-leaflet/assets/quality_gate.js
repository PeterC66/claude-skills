#!/usr/bin/env node
/*
 * quality_gate.js — the ratchet. Turns quality_metrics.js from a tool somebody
 * remembers to run into something that fails when a sheet gets worse.
 *
 * Phase 8 item 1 of the label-and-design-quality plan (§6.1 of the diagnosis):
 * "wire it into status.js so a quality row sits beside each town's byte-gate
 * row… these numbers are what turn 'does it look professional' into something
 * that cannot quietly get worse."
 *
 *   node quality_gate.js                # report, exit 1 on any regression
 *   node quality_gate.js --accept       # re-record the ledger from today
 *   node quality_gate.js --json
 *   node quality_gate.js --accept --include-uncommitted
 *
 * --accept HOLDS BACK any sheet whose ci-reference is not committed, and says
 * which. This tool writes a SHARED ledger and sessions here run concurrently;
 * see the comment above partitionByCommitted() for the run that made that
 * necessary. --include-uncommitted overrides it deliberately.
 *
 * WHY A LEDGER AND NOT A THRESHOLD. The plan says "gate HARD at 0". That is the
 * destination, not a gate that can be switched on today: the board carries 139
 * HARD defects, most of them on sheets whose density is an approved outcome of
 * the complexity triage, so a flat zero would fail all 31 sheets on day one and
 * be turned off within the hour. What §6.1 actually asks for is that quality
 * "cannot quietly get worse". So each sheet's current figures are recorded as
 * its ceiling and the gate fails on any RISE. Lowering a ceiling is deliberate —
 * `--accept` after a change that improved things — which makes every reduction a
 * reviewed commit to the ledger rather than a number drifting in either
 * direction unobserved.
 *
 * THE THIRD GATED NUMBER IS THE IMPORTANT ONE. `mapLabels` is gated as a FLOOR,
 * not a ceiling. Every other measure here counts something wrong that is ON the
 * page, so a placer that drops a label to avoid a collision scores better for
 * dropping it — the trap that had 94 dropped labels uncounted for four sessions
 * while the plan prepared to gate on the total. A sheet may not quietly print
 * less. `drop` is gated too, but a sheet can shed a label without the placer
 * reporting it (a config change that removes a POI outright), which is why the
 * floor on what is actually drawn is the one that closes the hole.
 *
 * THE DROP CEILING IS PER SHEET BY CONSTRUCTION, and that answers the product
 * judgement the plan flagged: High Wycombe sheds 40% of its label candidates
 * because rungs 2 and 2b of complexity-triage.md say a RED town should, and a
 * flat rate ceiling would either fail it or excuse everyone else. Its own
 * recorded figure is the only honest allowance.
 *
 * TARGETS (added 2026-08-25, technical-audit_2026-08-25 N11). Non-regression
 * gives the ratchet a floor and no direction. Between 19 and 25 August the board
 * grew from 39 sheets to 52 and every PER-SHEET number improved — and the
 * accepted ceiling rose, hard 130 -> 137, with the dropped-label floor not
 * moving by a single label across thirteen more sheets. Both readings were true
 * and the ledger could state neither, because it recorded only where the ceiling
 * WAS. `targets` records where it is GOING: dated milestones for the board-wide
 * totals against a baseline taken the day they were written, so the file that
 * holds the ceiling also holds the distance still to travel.
 *
 * A TARGET NEVER FAILS THE BUILD. It is reported, not gated. A check that is red
 * on the day it is written gets muted within the week, and 137 -> 0 is a
 * quarter's work: gating it would redden every run until January and teach
 * everyone to skip the section. The ratchet still fails on a RISE, exactly as
 * before; the target block only adds a line saying how far there is left to go
 * and what weekly rate that now implies.
 *
 * NULLS ARE COUNTED, NOT SUMMED AWAY. `drop` is null on a sheet whose run could
 * not count dropped labels. Adding null as zero would let a board that measures
 * LESS report itself closer to target — the same trap the label floor exists to
 * close — so `targetProgress` carries an `unknown` count beside every total and
 * the report prints it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { analyse } = require('./quality_metrics');
const { resolveBuses } = require('./cli');

const LEDGER_NAME = path.join('Development Docs', 'quality-ledger.json');

// Walks BOTH place layouts, not just the nested one. This searched `Areas/` alone
// until 2026-08-23, so the three maps under `Places/_standalone/` were measured by
// nothing — and Ely Co-op shipped a Key running off the bottom of the page while the
// ratchet reported no change at all, because its sheets were not among the sheets it
// knows about. Same shape as the gap in gate_lib's findPlaces(), in a second file.
// `_portal-fixture` is excluded for the reason gtfs_places.py excludes it: it is a CI
// fixture reproduced byte-for-byte on purpose, not a map anybody reads.
function findSheets(busesDir) {
  const out = [];
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '_portal-fixture') walk(p); }
      else if (e.name.endsWith('.svg') && path.basename(d) === 'ci-reference') out.push(p);
    }
  };
  walk(path.join(busesDir, 'Areas'));
  walk(path.join(busesDir, 'Places'));
  return out.sort();
}

// Same key as quality_metrics.js's own table, so a row here and a row there can
// be read against each other without translation.
const sheetKey = (p) => {
  const parts = p.split(/[\\/]/);
  return parts[parts.indexOf('ci-reference') - 1] + ' · ' + path.basename(p, '.svg');
};

// What the ledger records per sheet. `labels` is a floor; the rest are ceilings.
// DEF and ALL are recorded but NOT gated: DEF is the tracked ledger figure and
// ALL the honest one, and which of the two becomes the headline is still open at
// G5 — gating on a number whose definition is under review would bake the answer
// in before the decision.
function measure(file) {
  const m = analyse(file).metrics;
  return {
    labels: m.mapLabels,
    hard: m.hard,
    soft: m.defectsAll - m.hard,
    drop: m.unplacedLabels === null ? null : m.unplacedLabels,
    def: m.defects,
    all: m.defectsAll,
  };
}

// A sheet's verdict. Order matters: a label floor breach is reported ahead of a
// defect rise, because a sheet that prints less can improve every other number
// here while doing it.
function judge(now, was) {
  if (!was) return { status: 'NEW', why: ['not in the ledger'] };
  const why = [];
  if (now.labels < was.labels) why.push(`${was.labels - now.labels} fewer map labels (${was.labels} -> ${now.labels})`);
  if (now.hard > was.hard) why.push(`HARD ${was.hard} -> ${now.hard}`);
  if (now.drop !== null && was.drop !== null && now.drop > was.drop) why.push(`dropped ${was.drop} -> ${now.drop}`);
  if (why.length) return { status: 'REGRESSED', why };
  const better = [];
  if (now.labels > was.labels) better.push(`+${now.labels - was.labels} labels`);
  if (now.hard < was.hard) better.push(`HARD -${was.hard - now.hard}`);
  if (now.drop !== null && was.drop !== null && now.drop < was.drop) better.push(`drop -${was.drop - now.drop}`);
  const softMoved = now.soft !== was.soft ? [`SOFT ${was.soft} -> ${now.soft}`] : [];
  return { status: better.length ? 'BETTER' : 'ok', why: better.concat(softMoved) };
}

// ---- distance to target ---------------------------------------------------
// Pure, and `today` is a parameter rather than a call to Date.now(), for the
// ordinary reason: a test that reads the clock passes today and fails in
// November. Every date here is a plain 'YYYY-MM-DD' string, which sorts and
// compares lexically, so no timezone can move a milestone by a day.
const DAY_MS = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);

// Board-wide total for one metric, plus how many sheets could not supply it.
// A sheet whose `drop` is null is UNKNOWN, not zero — see the header.
function boardTotal(rows, metric) {
  let total = 0, unknown = 0;
  for (const r of rows) {
    const v = r.now ? r.now[metric] : undefined;
    if (v === null || v === undefined) unknown += 1; else total += v;
  }
  return { total, unknown, sheets: rows.length };
}

// One line per metric that has a target. Returns [] when the ledger has no
// `targets` block at all, so a ledger written before this existed reports
// nothing rather than throwing — and so does a metric with an empty list.
function targetProgress(rows, targets, today) {
  if (!targets) return [];
  const out = [];
  for (const metric of Object.keys(targets)) {
    // The same guard skips the block's own `note` (a string) and `baseline` (an
    // object): a metric is a key whose value is a non-empty list of milestones.
    const milestones = targets[metric];
    if (!Array.isArray(milestones) || !milestones.length) continue;
    const sorted = milestones.slice().sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : 0));
    const { total, unknown, sheets } = boardTotal(rows, metric);

    // The milestone in play is the first one still open. If every date has
    // passed, the LAST one is still the target and the report says overdue —
    // a deadline that has gone by must not silently become "no target".
    const next = sorted.find(m => m.by >= today) || sorted[sorted.length - 1];
    const distance = total - next.total;
    const daysLeft = daysBetween(today, next.by);
    const status = distance <= 0 ? 'met' : daysLeft < 0 ? 'overdue' : 'open';
    // Rate needed from here, which is the number that tells you whether a target
    // has quietly become fiction. Null when it is met or the day has passed,
    // because "per week" means nothing once there are no weeks.
    const perWeek = status === 'open' && daysLeft > 0
      ? Math.round((distance / (daysLeft / 7)) * 10) / 10
      : null;

    const base = targets.baseline && typeof targets.baseline[metric] === 'number'
      ? targets.baseline[metric] : null;
    out.push({
      metric, sheets, total, unknown,
      by: next.by, want: next.total, distance, daysLeft, status, perWeek,
      baseline: base,
      baselineOn: (targets.baseline && targets.baseline.on) || null,
      // Travelled since the baseline was set: NEGATIVE means the board got
      // worse. Recorded separately from `distance` because "we are 37 away" and
      // "we have moved 0 in six days" are different facts and the audit's
      // finding was the second one.
      moved: base === null ? null : base - total,
      remaining: sorted.filter(m => m.by > next.by).length,
    });
  }
  return out;
}

// One printable line per target. Lives here rather than in either caller so the
// gate board and this script cannot describe the same number two different ways.
function targetLines(progress) {
  return progress.map((p) => {
    const head = '  ' + p.metric.toUpperCase().padEnd(6) + String(p.total).padStart(4)
      + ' -> ' + String(p.want).padEnd(4) + ' by ' + p.by + '  ';
    if (p.status === 'met') return head + 'MET (' + Math.abs(p.distance) + ' under)';
    const rate = p.perWeek === null ? '' : ' (' + p.perWeek + '/wk)';
    const when = p.daysLeft < 0 ? 'OVERDUE by ' + Math.abs(p.daysLeft) + ' days' : p.daysLeft + ' days left' + rate;
    const moved = p.moved === null ? ''
      : ' · ' + (p.moved === 0 ? 'none removed' : p.moved > 0 ? p.moved + ' removed' : Math.abs(p.moved) + ' ADDED')
        + (p.baselineOn ? ' since ' + p.baselineOn : '');
    const blind = p.unknown ? ' · ' + p.unknown + ' of ' + p.sheets + ' sheets could not count it' : '';
    return head + p.distance + ' to go, ' + when + moved + blind;
  });
}

function run(busesDir) {
  const ledgerPath = path.join(busesDir, LEDGER_NAME);
  let ledger = { recorded: null, sheets: {} };
  if (fs.existsSync(ledgerPath)) { try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch {} }
  const rows = findSheets(busesDir).map(f => {
    const key = sheetKey(f);
    const now = measure(f);
    return { key, file: f, now, was: ledger.sheets[key] || null, ...judge(now, ledger.sheets[key]) };
  });
  return { ledgerPath, ledger, rows };
}

const DEFAULT_NOTE =
  'Ceilings for hard/drop and a FLOOR for labels. Written by quality_gate.js --accept; '
  + 'lowering a ceiling is a deliberate, reviewable commit. See the header of quality_gate.js.';

// A recorded baseline usually encodes a DECISION -- "we accepted N more collisions to keep the QR
// code" -- and that reasoning is what a future reader needs most. It used to survive only in a
// commit message, because --accept rebuilt this file from scratch and silently dropped both the
// top-level note and any per-sheet note. Both are now carried forward, so --accept re-records the
// NUMBERS without discarding the WHY.
// ---- whose work is this? ---------------------------------------------------
// THE SCOPE OF THIS TOOL IS "EVERY SHEET I CAN FIND", AND THAT IS THE BUG.
// On 2026-08-23 a run of `--accept` folded a NEIGHBOURING SESSION's uncommitted
// `ci-reference/` (St Neots Co-op) into the shared ledger. No `git add` of a
// directory was involved and nothing looked wrong: the ledger is one file this
// session had every reason to rewrite, and its diff read entirely as own work.
// Staging by name protects the other session from me; it does nothing about a
// tool that rebuilds a shared file from whatever it discovers on disk.
//
// So: a sheet whose ci-reference is not COMMITTED is, by definition, work that
// is still in flight — either a neighbouring session's or this one's unfinished
// own. Accepting it records a ceiling for a sheet that may never exist in that
// form, and it steals the other session's chance to accept its own figures.
//
// One `git status` call for the whole tree, not one per sheet. Returns a Set of
// repo-relative paths with forward slashes, or NULL when git could not answer —
// which is deliberately different from "nothing is dirty", because a checker
// that cannot distinguish "no answer" from "clean answer" reports the first as
// the second.
function dirtyPaths(busesDir) {
  const { spawnSync } = require('child_process');
  const res = spawnSync('git', ['-C', busesDir, 'status', '--porcelain', '--untracked-files=all'],
    { encoding: 'utf8' });
  if (res.error || res.status !== 0) return null;
  const out = new Set();
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ').pop();      // renames name both ends
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    out.add(p);
  }
  return out;
}

function partitionByCommitted(busesDir, rows) {
  const dirty = dirtyPaths(busesDir);
  if (dirty === null) return { clean: rows, held: [], unknown: true };
  const rel = f => path.relative(busesDir, f).split(path.sep).join('/');
  const clean = [], held = [];
  for (const r of rows) (dirty.has(rel(r.file)) ? held : clean).push(r);
  return { clean, held, unknown: false };
}

function accept(busesDir, rows, ledgerPath) {
  let prev = {};
  if (fs.existsSync(ledgerPath)) { try { prev = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch {} }
  const prevSheets = prev.sheets || {};
  const sheets = {};
  // Sheets not being re-recorded keep whatever the ledger already held for them,
  // rather than dropping out of it. A held sheet must be left EXACTLY as it was,
  // not deleted: deleting it would read as "new sheet" on the next run and be
  // accepted silently, which is the same adoption by a slower route.
  for (const [k, v] of Object.entries(prevSheets)) sheets[k] = v;
  for (const r of rows) {
    sheets[r.key] = r.now;
    const carried = prevSheets[r.key] && prevSheets[r.key].note;
    if (carried) sheets[r.key].note = carried;
  }
  // `targets` is carried forward for the same reason the notes are, and it
  // matters more: --accept runs after a change that improved things, which is
  // exactly the moment a target is being progressed against. Rebuilding the file
  // without it would delete the target on the run that moved towards it.
  const out = { recorded: new Date().toISOString().slice(0, 10), note: prev.note || DEFAULT_NOTE };
  if (prev.targets) out.targets = prev.targets;   // ahead of `sheets`, which is 300 lines long
  out.sheets = sheets;
  /* ONE SPACE, because that is what the committed ledger is stored with and this
   * function is the only thing that should ever write it.
   *
   * It has been TWO since 2026-08-25 (e0a530f), and the committed file has been one
   * throughout, so every `--accept` reformatted all 468 lines and buried its real
   * change in them. The visible cost is in the history: `099a2b9` and `c0fc71d`,
   * both re-records, each land a tidy 21-line diff — because their authors ran the
   * tool, saw an unreviewable diff, and applied the change to the file by hand
   * instead. A generated file that people hand-edit to keep readable has stopped
   * being generated, and the ratchet's whole defence is that "lowering a ceiling is
   * a deliberate, reviewable commit". A reformat is not reviewable.
   *
   * The fix is here rather than in the file: reformatting 468 lines once would make
   * this diff agree and leave every future one at the mercy of the same drift. */
  fs.writeFileSync(ledgerPath, JSON.stringify(out, null, 1) + '\n');
}

module.exports = { run, accept, measure, judge, sheetKey, findSheets, targetProgress, targetLines, boardTotal, partitionByCommitted, dirtyPaths, LEDGER_NAME };

const todayISO = () => new Date().toISOString().slice(0, 10);

if (require.main === module) {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf('--buses');
  const buses = resolveBuses({ buses: gi >= 0 ? argv[gi + 1] : undefined });
  const { ledgerPath, ledger, rows } = run(buses);

  if (argv.includes('--accept')) {
    const force = argv.includes('--include-uncommitted');
    const { clean, held, unknown } = partitionByCommitted(buses, rows);

    if (unknown && !force) {
      console.error('REFUSING to --accept: `git status` could not be read in ' + buses + '.');
      console.error('Without it there is no way to tell your sheets from a concurrent session\'s');
      console.error('uncommitted work, and this tool records into a SHARED ledger.');
      console.error('Pass --include-uncommitted to accept everything anyway.');
      process.exit(2);
    }

    const use = force ? rows : clean;
    accept(buses, use, ledgerPath);
    console.log(`recorded ${use.length} sheets into ${ledgerPath}`);

    if (held.length && !force) {
      console.log(`\nHELD BACK ${held.length} sheet(s) whose ci-reference is not committed:`);
      for (const r of held) console.log('  ' + r.key);
      console.log('\nTheir existing ledger rows are untouched. A sheet still in flight may be a');
      console.log('concurrent session\'s work, and accepting it both records a ceiling that may');
      console.log('never exist and takes away their chance to accept their own figures.');
      console.log('Commit them and re-run, or pass --include-uncommitted if they are yours.');
    }
    if (force) console.log('\n--include-uncommitted: uncommitted sheets were accepted deliberately.');
    process.exit(0);
  }
  const progress = targetProgress(rows, ledger.targets, todayISO());

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ledgerPath, recorded: ledger.recorded, targets: progress, rows: rows.map(r => ({ ...r, file: undefined })) }, null, 2));
    process.exit(rows.some(r => r.status === 'REGRESSED') ? 1 : 0);
  }

  const w = [40, 11, 7, 6, 6, 6];
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
  console.log(`=== Quality ledger (recorded ${ledger.recorded || 'never'}) === ${ledgerPath}`);
  console.log(['sheet', 'status', 'labels', 'HARD', 'SOFT', 'drop'].map((s, i) => pad(s, w[i])).join(''));
  for (const r of rows) {
    console.log([r.key, r.status, r.now.labels, r.now.hard, r.now.soft, r.now.drop === null ? '-' : r.now.drop]
      .map((s, i) => pad(s, w[i])).join('') + (r.why.length ? '  ' + r.why.join('; ') : ''));
  }
  const bad = rows.filter(r => r.status === 'REGRESSED');
  const nu = rows.filter(r => r.status === 'NEW');
  const tot = (k) => rows.reduce((s, r) => s + (r.now[k] || 0), 0);
  console.log('-'.repeat(w.reduce((a, b) => a + b, 0)));
  console.log([`totals (${rows.length} sheets)`, '', tot('labels'), tot('hard'), tot('soft'), tot('drop')]
    .map((s, i) => pad(s, w[i])).join(''));
  // Where the ceiling is GOING. Reported under the totals and never added to
  // `bad`: the exit code stays a statement about regression alone.
  if (progress.length) {
    console.log('\n=== Distance to target (reported, never gated) ===');
    for (const line of targetLines(progress)) console.log(line);
  } else if (ledger.targets) {
    console.log('\nNo target milestones in the ledger to measure against.');
  }

  console.log(`\n${rows.length} sheets · ${bad.length} REGRESSED · ${rows.filter(r => r.status === 'BETTER').length} better · ${nu.length} new`);
  if (nu.length) console.log('Run --accept to record the current figures as the ceiling.');
  process.exit(bad.length ? 1 : 0);
}
