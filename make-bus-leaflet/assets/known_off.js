/*
 * known_off.js — the four ways a town's `verified-services.json` says
 * "we know about this route and deliberately do not draw it", read in one place.
 *
 * WHY THIS IS ITS OWN FILE (OA-259, 2026-09-06). Eight town files use FIVE
 * conventions for that one sentence, and on the day this was written the two
 * checkers that read them did not read the same set:
 *
 *   notOnLeaflet[] with servesTown:false   St Ives, Huntingdon   refresh: yes   S6: yes
 *   a services[] entry, servesTown:false   Wisbech (X46)         refresh: yes   S6: paired
 *   verifiedNotDisplayed[]                 High Wycombe (18)     refresh: yes   S6: NO
 *   notDisplayed[]                         St Neots, Beaconsfield refresh: yes  S6: NO
 *   excluded[]                             Ramsey (3)            refresh: NO    S6: NO
 *
 * So the commonest case had nowhere to go. A service that genuinely serves the
 * town and that we deliberately do not carry is INVISIBLE to S6 written
 * truthfully — the route falls through to the `missing-service` arm and is
 * reported as news, *absent from our verified set, inclusion candidate* — and
 * writing `servesTown:false` to silence it is a lie that earns a recurring
 * `serves-town-conflict` instead. Huntingdon's blind red team named the same
 * seven routes on both its S6 runs, at 89k–137k tokens an answer, and no
 * adjudication anybody wrote could have stopped the eighth.
 *
 * WHY A MODULE RATHER THAN A FEW LINES IN THE CALLER. The same rule is already
 * written twice — once here in JavaScript for `verify_report.js` and once in
 * Python inside `gtfs_refresh_report.py` — because the two checkers cannot share
 * a runtime. Two implementations of one rule is exactly OA-135's shape, so the
 * two are held together by `tools/prove-known-off-parity.js`, which feeds one
 * fixture through both and fails when the route sets differ. A written claim
 * that two things agree is a claim about a JOIN, and only the JOIN can check it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not decide what to REPORT — that
 * is the caller's, and the two callers legitimately differ. It never silences:
 * `gtfs_refresh_report.py` turns a hit into RE-EVAL and `verify_report.js` into
 * a SOFT carrying the town's own words, because an exclusion nobody re-reads is
 * how a school service that has become a real public service stays off a sheet
 * for ever. And it reads only the four fields above, not `services[]`, because
 * a `servesTown:false` service entry is PAIRED with the red team by
 * verify_report.js's own grouping and never reaches the arm this feeds.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */

/*
 * The order is the precedence, and it matches `gtfs_refresh_report.py`'s
 * `setdefault` semantics: the first field to name a route wins, so a town that
 * writes the same route into two conventions gets one answer rather than a
 * coin toss. `notOnLeaflet` leads because it is the structured one and the only
 * one S6 could already read.
 */
const FIELDS = ['notOnLeaflet', 'verifiedNotDisplayed', 'notDisplayed', 'excluded'];

/*
 * `notOnLeaflet` writes its prose in `note`; the other three write it in
 * `reason`; High Wycombe adds a `detail` beside a one-word `reason` ("school",
 * "withdrawn"), and the detail is the half a reader actually needs. Accept all
 * of them rather than making eight town files agree on a key name — the point of
 * this module is that they do not have to.
 */
function reasonOf(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const head = entry.note || entry.reason || '';
  const tail = entry.detail || '';
  return (head && tail && head !== tail) ? `${head} — ${tail}` : String(head || tail || '');
}

/**
 * Every route a town has recorded as known-and-not-drawn.
 *
 * Returns a Map from the route EXACTLY as the town file spells it to
 * `{ field, reason, entry }`. Callers normalise: `verify_report.js` keys on
 * `normRoute` and the Python keys on `str()`, and asking this module to pick one
 * would put a normalisation rule in the one place both sides have to agree on.
 *
 * Entries with no `route` are skipped and counted in `skipped`: Beaconsfield's
 * `notDisplayed` carries a `{group: "Dedicated school services", ...}` block
 * that names a class rather than a route, and dropping it silently would make a
 * whole school fleet look declared when it is not.
 */
function knownOff(verified) {
  const found = new Map();
  const skipped = [];
  for (const field of FIELDS) {
    const list = (verified && verified[field]) || [];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      // Huntingdon's older `notDisplayed` was a bare list of route numbers with
      // the reasoning in prose beside it, and the Python has read that shape
      // since 2026-09-03. A bare string is a declaration with no reason, which
      // is worth having and worth being able to see is reasonless.
      if (typeof entry === 'string' || typeof entry === 'number') {
        const r = String(entry);
        if (r && !found.has(r)) found.set(r, { field, reason: '', entry: { route: r } });
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      // servesTown:false in notOnLeaflet is the ONE case that already had a
      // reader: verify_report.js raises `serves-town-conflict` on it, which is a
      // different and louder finding. Leaving it out here keeps that arm's
      // priority rather than quietly demoting it to a SOFT about a decision.
      if (field === 'notOnLeaflet' && entry.servesTown === false) continue;
      if (entry.route === undefined || entry.route === null || entry.route === '') {
        skipped.push({ field, entry });
        continue;
      }
      const r = String(entry.route);
      if (!found.has(r)) found.set(r, { field, reason: reasonOf(entry), entry });
    }
  }
  return { found, skipped };
}

module.exports = { knownOff, reasonOf, FIELDS };
