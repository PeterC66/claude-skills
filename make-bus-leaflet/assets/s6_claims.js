/*
 * s6_claims.js — the status board's view of the S6 claims gate (buses-data OA-273,
 * 2026-09-08). Its own module rather than fifty lines in status.js, which is what
 * tools/line-ratchet.js exists to insist on.
 *
 * WHAT IT ASKS. Every service claim on every map's latest S6 report — the red team
 * says a bus serves the town and we do not carry it, or the reverse — must have a
 * HOME: the map's own notOnLeaflet/redteamRejected, its parent town's file, or an
 * entry in service-facts.json at the buses root. Until this landed a claim's outcome
 * was written into the prose of an open action and nothing counted the ones nobody
 * had looked at: 100 on the estate the morning it was measured.
 *
 * The checker is tools/check-s6-claims.mjs in this repository, run rather than
 * re-implemented, and it is THE BOARD that runs its coverage half: verification.json
 * is gitignored, so CI runs only the register half and says so. `--require-reports`
 * makes a run that found no report red — a laptop run that checked nothing must not
 * read as clean. A crash is red for the same reason the quality ratchet's is.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const CHECKER = path.join(__dirname, '..', '..', 'tools', 'check-s6-claims.mjs');

/** Run the checker over `busesDir`. Returns { verdict, error }; exactly one is non-null. */
function measure(busesDir) {
  if (!fs.existsSync(CHECKER)) return { verdict: null, error: 'tools/check-s6-claims.mjs is not beside the engine at ' + CHECKER };
  const r = spawnSync(process.execPath, [CHECKER, '--json', '--require-reports', '--root', busesDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return { verdict: JSON.parse(r.stdout), error: null }; }
  catch (e) { return { verdict: null, error: 'check-s6-claims.mjs printed no verdict (exit ' + r.status + '): ' + String(r.stderr || r.stdout || e.message).trim().slice(0, 300) }; }
}

/** Does the measurement need attention — a claim with no home, a silent map, or a checker that could not run. */
function isRed({ verdict, error }) { return error !== null || !!(verdict && verdict.red); }

/**
 * Print the section. Printed whether or not anything is wrong, because the count
 * of QUEUED claims is the queue Peter works, and a section that appears only when
 * red is one nobody learns to read.
 */
function printSection({ verdict, error }, log = console.log) {
  log('\n=== S6 claims (service-facts.json, tools/check-s6-claims.mjs) ===');
  if (error) {
    log('  NOT MEASURED: ' + error);
    log('  No claim was checked for a home. An absent measurement is RED, not a pass.');
    return;
  }
  const v = verdict;
  const by = Object.entries(v.coveredBy || {}).map(([k, n]) => k + ' ' + n).join(', ') || 'none';
  log('  ' + v.reports + ' map(s) with an S6 report, ' + v.claims + ' claim(s): ' + by);
  if (v.mapsWithoutReport && v.mapsWithoutReport.length) log('  no report on disk: ' + v.mapsWithoutReport.map(x => x.map + ' (' + x.why + ')').join('; '));
  log('  register: ' + (v.register.present ? v.register.facts + ' fact(s), ' + v.register.queued + ' queued, ' + v.register.decided + ' decided' : 'ABSENT'));
  for (const u of v.uncovered || []) log('  UNCOVERED  ' + u.map + '  S6 ' + u.run + ' ' + u.id + '  ' + u.category + '  ' + u.route + (u.operator ? ' (' + u.operator + ')' : ''));
  for (const f of (v.register.findings || [])) log('  REGISTER   ' + f.text);
  for (const s of (v.register.silences || [])) log('  SILENT     ' + s.map + ' says nothing about ' + s.route + ' (' + s.id + ')');
  if (v.queued && v.queued.length) log('  queued: ' + [...new Set(v.queued.map(q => q.id))].join(', ') + ' — questions written down, not yet answered');
  if (v.red) log('  RED — a claim with no home, or a decision no sheet has learned. Run tools/check-s6-claims.mjs from the buses root for the remedy on each row.');
  else log('  every claim has a home, and the register contradicts no map.');
}

module.exports = { measure, isRed, printSection, CHECKER };
