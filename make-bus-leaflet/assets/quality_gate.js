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
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { analyse } = require('./quality_metrics');

const DEFAULT_BUSES = 'C:/u3a St Ives/Using AI/Buses';
const LEDGER_NAME = path.join('Development Docs', 'quality-ledger.json');

function findSheets(busesDir) {
  const out = [];
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith('.svg') && path.basename(d) === 'ci-reference') out.push(p);
    }
  })(path.join(busesDir, 'Areas'));
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
function accept(busesDir, rows, ledgerPath) {
  let prev = {};
  if (fs.existsSync(ledgerPath)) { try { prev = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch {} }
  const prevSheets = prev.sheets || {};
  const sheets = {};
  for (const r of rows) {
    sheets[r.key] = r.now;
    const carried = prevSheets[r.key] && prevSheets[r.key].note;
    if (carried) sheets[r.key].note = carried;
  }
  fs.writeFileSync(ledgerPath, JSON.stringify({
    recorded: new Date().toISOString().slice(0, 10),
    note: prev.note || DEFAULT_NOTE,
    sheets,
  }, null, 2) + '\n');
}

module.exports = { run, accept, measure, judge, sheetKey, findSheets, LEDGER_NAME };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf('--buses');
  const buses = path.resolve(gi >= 0 ? argv[gi + 1] : DEFAULT_BUSES);
  const { ledgerPath, ledger, rows } = run(buses);

  if (argv.includes('--accept')) {
    accept(buses, rows, ledgerPath);
    console.log(`recorded ${rows.length} sheets into ${ledgerPath}`);
    process.exit(0);
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ledgerPath, recorded: ledger.recorded, rows: rows.map(r => ({ ...r, file: undefined })) }, null, 2));
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
  console.log(`\n${rows.length} sheets · ${bad.length} REGRESSED · ${rows.filter(r => r.status === 'BETTER').length} better · ${nu.length} new`);
  if (nu.length) console.log('Run --accept to record the current figures as the ceiling.');
  process.exit(bad.length ? 1 : 0);
}
