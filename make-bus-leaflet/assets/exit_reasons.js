'use strict';
// The last line of the human board: why it exited as it did.
//
// 2026-10-06: the morning brief and another session both read a TRUNCATED board that
// had exited 1, could not tell which line was the fault (one OVERDUE commitment row),
// and told Peter nothing useful. The verdict is one boolean expression in status.js,
// so the board never said WHICH clause was true. This names each one.
//
// A fault here is exactly a clause of that expression, and a CHORE (a map drawn by an
// older engine, a stale S6 under its limit, a deploy BEHIND inside its grace or a claim
// with no home) is never listed, because it is not a clause of it. Nothing in this file
// decides the exit code: report() takes the verdict from status.js and only explains it.
// If the verdict is red and no section below claims it, the line says so in those words
// rather than printing nothing, which is the one way this could mislead a reader.
const { deployBad } = require('./deployment');
const s6Claims = require('./s6_claims');
const s6Limit = require('./s6_stale_limit');

const SHEET_BAD = ['DIFF', 'FAIL', 'MISSING'];
const starts = (v, ...p) => p.some(x => String(v).startsWith(x));
const nm = (r) => r.name || r.file || r.key || r.label || r.id || '?';

function sheetFaults(rows, section, { boarding = false, places = false } = {}) {
  const out = [];
  const add = (r, what) => out.push({ section, what: nm(r) + ' ' + what });
  for (const r of rows) {
    if (['DIFF', 'FAIL', 'NO-BUILD', 'MISSING'].includes(r.internal)) add(r, 'internal sheet ' + r.internal);
    if (starts(r.external, 'DIFF', 'FAIL') || r.external === 'MISSING') add(r, 'external sheet ' + r.external);
    if (SHEET_BAD.includes(r.schematic)) add(r, 'internal-schematic sheet ' + r.schematic);
    if (SHEET_BAD.includes(r.diagram)) add(r, 'internal-diagram sheet ' + r.diagram);
    if (boarding && [...SHEET_BAD, 'INDEX-STALE'].includes(r.boarding)) add(r, 'boarding sheet ' + r.boarding);
    if (boarding && r.indexDrift && r.indexDrift.length) add(r, 'boarding index drift');
    if (places && r.keys && r.keys.state === 'short') add(r, 'is missing a key');
    if (r.ownEngineUncheckable) add(r, 'could not be gated at all: ' + r.ownEngineUncheckable);
  }
  return out;
}

/** Every fault in the board's own sections, each `{ section, what }`. Pure. */
function faultsOf(c) {
  const f = [];
  f.push(...sheetFaults(c.townRows || [], 'Towns'));
  f.push(...sheetFaults(c.placeRows || [], 'Places', { boarding: true, places: true }));
  f.push(...sheetFaults(c.portalFixtureRows || [], 'Portal fixtures', { boarding: true }));
  for (const r of c.driftRows || []) {
    if (r.same !== true && !r.inFlight && !r.pinBehind) f.push({ section: 'Portal vendoring drift', what: nm(r) + (r.same === null ? ' MISSING' : ' DRIFTED') });
  }
  for (const r of c.freshnessRows || []) {
    if (r.stale && r.stale.length) f.push({ section: 'Committed portal fixtures vs the newest render', what: nm(r) + ' STALE: ' + r.stale.join(', ') });
  }
  if (c.qualityError) f.push({ section: 'Quality ratchet', what: 'NOT MEASURED, the gate threw: ' + c.qualityError });
  for (const r of c.qualityRows || []) if (r.status === 'REGRESSED') f.push({ section: 'Quality ratchet', what: nm(r) + ' REGRESSED' });
  const s6 = c.s6Claims;
  if (s6 && s6Claims.isRed(s6)) {
    const owed = s6.error === null && s6.verdict ? s6Claims.owedOverdue(s6.verdict, s6.today) : [];
    if (s6.error !== null) f.push({ section: 'S6 claims', what: 'the checker could not run: ' + s6.error });
    for (const o of owed) f.push({ section: 'S6 claims', what: 'decided fact ' + o.id + ' (' + o.map + ') still waiting for a rebuild, due ' + o.due });
    if (s6.error === null && !owed.length) f.push({ section: 'S6 claims', what: 'the claims register is red' });
  }
  const cm = c.commit;
  if (cm && cm.status === 'UNREADABLE') f.push({ section: 'Commitments', what: 'commitments.json is unreadable: ' + cm.why });
  for (const r of (cm && cm.rows) || []) {
    if (r.state === 'OVERDUE' || r.state === 'UNDATED') {
      f.push({ section: 'Commitments', what: String(r.id || r.what) + ' ' + r.state
        + (r.days == null ? '' : ' by ' + Math.abs(r.days) + 'd') + ' (due ' + r.by + ')' });
    }
  }
  if (deployBad(c.deploy)) f.push({ section: 'Deployment', what: 'the live site runs a commit no fetch can find' });
  if (c.s6Limit && s6Limit.isRed(c.s6Limit)) {
    for (const x of c.s6Limit.overdue) f.push({ section: 'S6 limit', what: x.map + ' is published and its verification has been stale past ' + x.due });
  }
  return f;
}

/** The lines to print. Last-line contract: red -> every one starts `EXIT 1 BECAUSE:`; green -> `EXIT 0: nothing red`. */
function exitLines(failed, faults) {
  if (!failed) return ['EXIT 0: nothing red'];
  const list = faults.length ? faults : [{ section: 'UNATTRIBUTED', what: 'the board is red but no section claims it -- exit_reasons.js has fallen behind the verdict in status.js' }];
  return list.map(x => 'EXIT 1 BECAUSE: [' + x.section + '] ' + x.what);
}

/** Print under the board and hand the verdict straight back. */
function report(failed, ctx, log = console.log) {
  for (const l of exitLines(failed, failed ? faultsOf(ctx) : [])) log(l);
  return failed;
}

module.exports = { faultsOf, exitLines, report };
