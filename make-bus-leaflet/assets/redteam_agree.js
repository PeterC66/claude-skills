/*
 * redteam_agree.js — does a value of OURS agree with what the blind red team said?
 *
 * ONE RULE, TWO READERS. `verify_report.js` asks it of every service to decide
 * whether an operator or a days string is a finding, and `redteam_source.js` asks
 * it of a value that MOVED to decide whether the move can have changed the
 * answer (buses-data OA-575, item A2 of the 2026-10-06 simplification review).
 * Until then the helpers below lived inside verify_report.js, and a second copy
 * in redteam_source.js would have been free to drift from the first — so that
 * a value S6 calls agreeing could be one the reuse rule calls contradicting, or
 * the other way round, which is the direction that costs.
 *
 * THE NORMALISERS ARE verify_report.js's, MOVED AND NOT CHANGED: the same stop
 * words for operators, the same day-name folding, the same treatment of "only".
 * The history of each (OA-156) stays with the comment beside it.
 *
 * `agreesWithAnswer` is STRICTER than verify_report's no-finding test, on
 * purpose, because it licenses spending nothing where the other only decides
 * what to print:
 *   - an operator agrees only when EVERY part of ours ("A / B", the form
 *     refresh_town.py writes for a route two operators share) shares a token
 *     with the answer's entry — not when any one part does;
 *   - days agree only when they normalise EQUAL. verify_report's
 *     `days-qualified` arm (theirs begins with ours) is not agreement here: it
 *     cannot tell "Mon-Sat (limited Sun)" from "Mon" against "Mon-Sat";
 *   - an empty value on either side never agrees — nothing compared is not
 *     a match;
 *   - an answer entry that says the route does NOT serve (`servesTown: false`)
 *     is not an entry to agree with.
 * Every one of those errs toward BUY, which is the safe direction.
 */
'use strict';

const normRoute = (r) => String(r == null ? '' : r).toUpperCase().replace(/\s+/g, '');

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
const OP_STOP = new Set(['coaches', 'coach', 'buses', 'bus', 'ltd', 'limited', 'the', 'of', 'and', 'company', 'co', 'travel', 'group', 'services', 'service', 'minibus', 'minibuses']);
function opTokens(s) { return tokenize(s).filter(t => !OP_STOP.has(t)); }
function overlaps(a, b) { const sb = new Set(b); return a.some(x => sb.has(x)); }
/*
 * Two things changed here on 2026-08-29 (OA-156, source three), both measured on
 * the estate's 102 `days` findings before the edit and after it.
 *
 * PLURALS. "Thursdays only" normalised to "thus", because the day-name rewrite
 * had no optional s. Ours "Thu" then read as a PREFIX of theirs rather than as
 * the same value, which is the difference between "the red team adds something"
 * and "these are identical".
 *
 * "ONLY" IS NOT A DAY. Eighteen findings across the estate said nothing but
 * that the red team writes "Sat only" where we write "Sat", "Mon-Fri only"
 * where we write "Mon-Fri". The word restates the closed-world assumption a
 * days field already carries; dropping it makes those eighteen comparisons
 * equal and they stop being reported at all. It cannot hide a real difference,
 * because the days either side of it are still compared in full.
 */
function normDays(s) {
  let d = String(s || '').toLowerCase().replace(/[–—]/g, '-');
  d = d.replace(/mondays?/g, 'mon').replace(/tuesdays?/g, 'tue').replace(/wednesdays?/g, 'wed')
       .replace(/thursdays?/g, 'thu').replace(/fridays?/g, 'fri').replace(/saturdays?/g, 'sat').replace(/sundays?/g, 'sun')
       .replace(/\bto\b/g, '-').replace(/\bevery ?day\b/g, 'daily').replace(/\bonly\b/g, '');
  return d.replace(/[^a-z0-9&-]/g, '');
}

function operatorAgrees(ours, theirs) {
  const t = opTokens(theirs);
  const parts = String(ours || '').split('/').map(opTokens).filter(p => p.length);
  return t.length > 0 && parts.length > 0 && parts.every(p => overlaps(p, t));
}
function daysAgree(ours, theirs) {
  const a = normDays(ours);
  return a !== '' && a === normDays(theirs);
}

/*
 * `answer` is a parsed redteam.json; `moved` holds only the fields that moved,
 * each at its NEW value, e.g. { days: 'Mon-Fri' }. Agreement must hold on ONE
 * answer entry for every moved field together: an operator agreeing with one
 * entry for the route and a days string with another is two half-agreements,
 * not one.
 */
function agreesWithAnswer(answer, route, moved) {
  const entries = ((answer && answer.services) || [])
    .filter(e => e && normRoute(e.route) === normRoute(route) && e.servesTown !== false);
  if (!entries.length) return { ok: false, why: `the answer has no entry for route ${route} that serves` };
  for (const e of entries) {
    const opOk = !('operator' in moved) || operatorAgrees(moved.operator, e.operator);
    const daysOk = !('days' in moved) || daysAgree(moved.days, e.days);
    if (opOk && daysOk) return { ok: true, entry: e };
  }
  const said = entries.map(e => Object.keys(moved).map(k => `${k} "${e[k] == null ? '' : e[k]}"`).join(', ')).join(' / ');
  return { ok: false, why: `route ${route} now ${Object.entries(moved).map(([k, v]) => `${k} "${v}"`).join(', ')}, and the answer says ${said}` };
}

module.exports = { normRoute, tokenize, opTokens, overlaps, normDays, operatorAgrees, daysAgree, agreesWithAnswer };
