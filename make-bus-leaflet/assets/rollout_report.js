'use strict';
/*
 * rollout_report.js — the machine-readable result of a rollout, written by
 * `rollout.js --json <file>` and `rollout_places.js --json <file>` (buses-data OA-485,
 * slice 1).
 *
 * OA-485 asks how TODAY'S engine would draw every live map. The dry run already builds
 * each map in scratch on the current engine and diffs its labels against the shipped
 * sheet; what it did not do was say so in a form anything but a person could read. The
 * console lines stay exactly as they were — this file adds a second, parallel answer.
 *
 * One verdict per map, from the result the rollout already computed:
 *   clean      — today's engine reproduces it (UP-TO-DATE, STAMP-STALE: the gate PASSED
 *                without a build), or rebuilt it losing no label and raising no blocking
 *                build warning (DRY-RUN, DONE).
 *   regressed  — today's engine drops a label, raises a blocking warning, or cannot
 *                draw the map at all (FAIL). REVIEW-NEEDED is a lost label by definition.
 *   unmeasured — the rollout never asked (SKIP, ERROR, STALE-INPUTS, STALE-S3,
 *                UNRENDERED, NOT-STAMP-STALE, anything new). NEVER counted as clean: a
 *                map this tool could not build is not a map today's engine draws well.
 *
 * Hard collisions (OA-485 item 3's other half) are not measured here; the quality
 * metrics are a later slice. The report carries no date: the file's own mtime says
 * when, and nothing here may read the clock (buses-data CLAUDE.md, "a generated file
 * must not read the clock").
 */
const fs = require('fs');
const path = require('path');

const CLEAN_WITHOUT_BUILD = new Set(['UP-TO-DATE', 'STAMP-STALE']);
const BUILT = new Set(['DRY-RUN', 'DONE', 'REVIEW-NEEDED']);

function lostLabels(r) {
  const out = {};
  for (const [file, d] of Object.entries(r.diffs || {})) if (d && d.lost && d.lost.length) out[file] = d.lost.slice();
  return out;
}
function total(r, key) {
  let n = 0;
  for (const d of Object.values(r.diffs || {})) n += (d && Array.isArray(d[key])) ? d[key].length : 0;
  return n;
}

function verdictOf(r) {
  if (CLEAN_WITHOUT_BUILD.has(r.status)) return 'clean';
  if (r.status === 'FAIL') return 'regressed';
  if (BUILT.has(r.status)) {
    const lost = r.status === 'REVIEW-NEEDED' || r.anyLost || total(r, 'lost') > 0;
    return lost || (r.blockers || []).length ? 'regressed' : 'clean';
  }
  return 'unmeasured';
}

function summarise(results, { kind, engine, apply }) {
  const maps = results.map(r => {
    const m = { name: r.name, status: r.status, verdict: verdictOf(r) };
    if (r.town !== undefined) m.town = r.town;
    if (r.detail) m.detail = r.detail;
    if (BUILT.has(r.status)) {
      m.lost = total(r, 'lost');
      m.gained = total(r, 'gained');
      m.moved = total(r, 'moved');
      m.rewrapped = total(r, 'rewrapped');
      m.blockers = (r.blockers || []).length;
      m.warnings = (r.warnings || []).filter(w => w.severity === 'WARN').length;
      const ll = lostLabels(r);
      if (Object.keys(ll).length) m.lostLabels = ll;
    }
    return m;
  });
  const counts = { total: maps.length, clean: 0, regressed: 0, unmeasured: 0 };
  for (const m of maps) counts[m.verdict]++;
  return { tool: kind === 'place' ? 'rollout_places.js' : 'rollout.js', kind, engine, apply: !!apply, counts, maps };
}

/* `--json` with no value parses as `true`; a flag that silently wrote nowhere is the
 * failure this exists to prevent, so it is refused before the estate is read. */
function jsonTarget(args, die) {
  if (args.json === undefined) return null;
  if (typeof args.json !== 'string' || !args.json.trim()) die('--json needs a file path: --json "<file>"');
  return path.resolve(args.json);
}

function writeReport(file, results, opts) {
  const report = summarise(results, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  return report;
}

module.exports = { verdictOf, summarise, jsonTarget, writeReport };
