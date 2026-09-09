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

/**
 * Run the checker over `busesDir`. Returns { verdict, error }; exactly one is non-null.
 *
 * WITHOUT --require-reports, deliberately. This board also runs in CI and inside
 * every prove-red-*.mjs harness, over checkouts and fixture estates that hold no
 * verification.json at all, and the first push of this section reddened three of
 * those harnesses' CONTROLS (2026-09-08, claude-skills run 34189147998). A board
 * that is red because it found nothing to look at cannot be told from one that
 * found a fault, and the harnesses are right to refuse it. The laptop-only "found
 * nothing" red belongs to the worklist, which passes the flag itself.
 */
function measure(busesDir) {
  // A scratch copy of the engine — every prove-red-*.js harness builds one, two
  // folders deep with no tools/ beside it — has no checker to run. That is "nothing
  // to gate here", reported and not red: the floor before this section existed was
  // no check at all, and buses-data's own gates.yml runs the checker directly.
  if (!fs.existsSync(CHECKER)) return { verdict: { notARepository: true, why: 'tools/check-s6-claims.mjs is not beside this engine at ' + CHECKER, register: { present: false, findings: [], silences: [] }, reports: 0, uncovered: [], red: false }, error: null };
  const r = spawnSync(process.execPath, [CHECKER, '--json', '--root', busesDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return { verdict: JSON.parse(r.stdout), error: null }; }
  catch (e) { return { verdict: null, error: 'check-s6-claims.mjs printed no verdict (exit ' + r.status + '): ' + String(r.stderr || r.stdout || e.message).trim().slice(0, 300) }; }
}

/**
 * Is there NOTHING here to gate — no register and no report? True of every CI
 * checkout and every harness fixture; never true of the real estate, where the
 * register is tracked. Such a tree is reported, not reddened: buses-data's own
 * gates.yml runs the checker directly and refuses an absent register there, which
 * is the one place that question has a truthful answer.
 */
function nothingToGate(v) {
  if (!v) return false;
  if (v.notARepository) return true;   // a scratch tree or a harness fixture, not an estate
  return !v.register.present && v.reports === 0 && (v.uncovered || []).length === 0 && (v.register.silences || []).length === 0
    && (v.register.findings || []).every(f => f.kind === 'missing');
}

/** Does the measurement need attention — a claim with no home, a silent map, or a checker that could not run. */
function isRed({ verdict, error }) { return error !== null || !!(verdict && verdict.red && !nothingToGate(verdict)); }

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
  if (nothingToGate(v)) {
    log('  NOTHING TO GATE HERE: ' + (v.notARepository ? 'not a git repository (' + v.why + ')' : 'no service-facts.json and no S6 report in this tree') + ' — a CI checkout or a fixture, not the estate.');
    log('  buses-data\'s own gates.yml runs the checker directly and refuses an absent register there.');
    return;
  }
  const by = Object.entries(v.coveredBy || {}).map(([k, n]) => k + ' ' + n).join(', ') || 'none';
  log('  ' + v.reports + ' map(s) with an S6 report, ' + v.claims + ' claim(s): ' + by);
  if (v.mapsWithoutReport && v.mapsWithoutReport.length) log('  no report on disk: ' + v.mapsWithoutReport.map(x => x.map + ' (' + x.why + ')').join('; '));
  log('  register: ' + (v.register.present ? v.register.facts + ' fact(s), ' + v.register.queued + ' queued, ' + v.register.decided + ' decided' : 'ABSENT'));
  for (const u of v.uncovered || []) log('  UNCOVERED  ' + u.map + '  S6 ' + u.run + ' ' + u.id + '  ' + u.category + '  ' + u.route + (u.operator ? ' (' + u.operator + ')' : ''));
  for (const f of (v.register.findings || [])) log('  REGISTER   ' + f.text);
  for (const s of (v.register.silences || [])) log('  SILENT     ' + s.map + ' says nothing about ' + s.route + ' (' + s.id + ')');
  if (v.queued && v.queued.length) log('  queued: ' + [...new Set(v.queued.map(q => q.id))].join(', ') + ' — questions written down, not yet answered');
  // A decided `include` is a DEBT on the next rebuild, and the checker's silence test
  // is green the moment the map declares the route off -- which for this outcome is
  // the unfinished state (buses-data OA-285). Printed here, never red: the board says
  // what is owed, and whether the note was written at the rebuild is undecided.
  const owed = (v.register && v.register.owed) || [];
  if (owed.length) {
    const waiting = owed.filter(o => o.state === 'waiting');
    log('  owed at the NEXT REBUILD: ' + owed.map(o => o.id + ' (' + o.map + (o.state === 'carried' ? ' — now carried, close the entry' : '') + ')').join(', ')
      + ' — ' + waiting.length + ' of ' + owed.length + ' still off the sheet. A decided "include" is not on a map until a rebuild writes it.');
  }
  if (v.red) log('  RED — a claim with no home, or a decision no sheet has learned. Run tools/check-s6-claims.mjs from the buses root for the remedy on each row.');
  else log('  every claim has a home, and the register contradicts no map.');
}

module.exports = { measure, isRed, printSection, nothingToGate, CHECKER };
