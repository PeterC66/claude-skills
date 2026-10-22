/*
 * redteam_rejected.js — read `routes.json redteamRejected[]`, and say whether an
 * entry answers one red-team claim.
 *
 * WHY THIS EXISTS (buses-data OA-654). An entry was keyed by route alone and
 * honoured in one place, the serves-town arm of `verify_report.js`, so when the
 * blind red team was wrong about where a route ENDS the S3 had nowhere to record
 * the answer: the terminus HARD came back on every reuse of that answer through
 * `redteam_source.js`, and the only way to clear it was to buy a new one. The
 * lesson is the last sentence of buses-data's
 * `Development Docs/s6-lessons-for-s1-to-s4_2026-10-17.md`.
 *
 * AN ENTRY NOW SAYS WHICH CLAIM IT REJECTS, and is keyed by route AND claim, so a
 * rejection of one claim can never clear another:
 *   - `claim` absent, or `"serves-town"` — the red team says the route does not
 *     serve the town. Every entry in the estate before OA-654 is this kind, and
 *     an absent claim still means it, so none of them moved.
 *   - `"terminus"` — the red team's termini for the route are wrong. The entry
 *     must name them in `termini`, and it answers only a claim whose termini it
 *     names, every one: a red team that later gives a DIFFERENT wrong terminus
 *     has made a new claim, which nobody has looked at.
 * `decidedOn`, `decidedBy` and `why` are required of both. An entry missing any
 * of them, or a terminus entry with no `termini`, or a claim this file does not
 * know, silences nothing and is returned in `bad` so S6 can name it.
 */
'use strict';

const { normRoute, tokenize } = require('./redteam_agree');

const CLAIMS = ['serves-town', 'terminus'];
const DEFAULT_CLAIM = 'serves-town';

const claimOf = (e) => (e && e.claim != null && e.claim !== '') ? String(e.claim) : DEFAULT_CLAIM;
const claimKey = (route, claim = DEFAULT_CLAIM) => `${claim}|${normRoute(route)}`;

/** { byKey: Map(claimKey -> entry), bad: [{ route, claim, missing, unknownClaim? }] } */
function readRejections(list) {
  const byKey = new Map();
  const bad = [];
  for (const e of (Array.isArray(list) ? list : [])) {
    const r = normRoute(e && e.route);
    const claim = claimOf(e);
    if (!r) { bad.push({ route: String((e && e.route) || '?'), claim, missing: ['route'] }); continue; }
    if (!CLAIMS.includes(claim)) { bad.push({ route: r, claim, missing: [], unknownClaim: true }); continue; }
    const missing = ['decidedOn', 'decidedBy', 'why'].filter(k => !e[k]);
    if (claim === 'terminus' && !(Array.isArray(e.termini) && e.termini.length)) missing.push('termini');
    if (missing.length) { bad.push({ route: r, claim, missing }); continue; }
    byKey.set(claimKey(r, claim), e);
  }
  return { byKey, bad };
}

/** The entry rejecting this claim about this route, or null. An `expired` one does not silence. */
function rejectionFor(byKey, route, claim, todayIso) {
  const key = claimKey(route, claim);
  const e = byKey.get(key);
  if (!e) return null;
  return { entry: e, key, claim: claimOf(e), expired: !!(e.recheckBy && String(e.recheckBy) < todayIso) };
}

const foldName = (s) => tokenize(s).join(' ');

/** Does a terminus entry name every one of these red-team termini? */
function terminiCovered(entry, redteamTermini) {
  const named = new Set(((entry && entry.termini) || []).map(foldName).filter(Boolean));
  const asked = (redteamTermini || []).map(foldName).filter(Boolean);
  return asked.length > 0 && asked.every(t => named.has(t));
}

module.exports = { CLAIMS, DEFAULT_CLAIM, claimOf, claimKey, readRejections, rejectionFor, terminiCovered };
