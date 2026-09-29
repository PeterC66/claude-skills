/*
 * frame_gaps.js — find where a route leaves the internal map's frame BETWEEN two
 * of its in-frame stops, and turn each such break into an exit event.
 *
 * WHY THIS EXISTS (buses-data OA-515, 2026-09-29)
 *
 * gen_internal.js's TRIM step cuts a route only OUTSIDE the span from its first
 * in-frame stop to its last, and records a device for each of those two cuts. A
 * stretch that leaves the frame inside that span stays in the polyline and the
 * SVG clip hides it, so the line runs into the edge and reappears elsewhere with
 * nothing at either break to say why — Ely Co-op's 9 and ZIP leave the bottom
 * edge at x~108 mm and come back at x~137 mm. `design.gapExits: true` gives each
 * break the device a terminus cut gets: an arrow, the route's badge, and — when
 * the route has no terminus cut of its own to carry it — its "to X".
 *
 * WHAT WAS MEASURED (every committed internal sheet, forced on, in scratch). The
 * vertex test finds a break on nine sheets, but on six of them every one is an
 * exit and re-entry at the SAME point (0.0 mm apart: a vertex a hair past the
 * edge), which is not a journey off the sheet. So breaks are taken as exit /
 * re-entry PAIRS and a pair closer than the cluster distance is dropped. What
 * is left draws on Ramsey (RH5, 12.6 mm), St Neots Co-op (61EY, 66) and Ely
 * Co-op (9, ZIP, 10). Drawing a device moves badges and can cost a road label
 * (Ely lost Witchford Road and Beresford Road), so adoption is per map, on crops.
 *
 * THREE THINGS THAT RULE GOT WRONG ON ELY (buses-data OA-519, 2026-09-29)
 *
 * 1. A SLIVER. The 10 comes back over the top edge at x 72.5 mm and leaves again
 *    at 74.3 mm, and the ZIP cuts the top-left corner in 2.8 mm: two devices on a
 *    stretch of line too short to see. A re-entry and the next exit closer than
 *    the cluster distance, with no stop between them, are one excursion, so their
 *    pairs merge into one.
 * 2. AN OUT-AND-BACK. Merged, the ZIP's corner leaves the left edge at y 117.6 mm
 *    and returns to the same point 676 mm of route later — which the chord test
 *    drops as a vertex a hair past the edge. A pair is kept as well when the
 *    route it hides is long: at least OUT_AND_BACK cluster distances. The hair is
 *    hundredths of a millimetre; on Ely the shortest kept stretch is 41 mm.
 * 3. NO "to X". A gap event was written `label: null`, so the 10 (termini
 *    start "Little Downham", no terminus cut on this sheet) drew an arrow and no
 *    name. gen_internal passes the label its terminus cut would have taken, and
 *    only when the route has no terminus cut to carry it; `termini[r].gap` names
 *    one outright, or `false` keeps them bare.
 */
'use strict';

const OUT_AND_BACK = 3;

// Every break inside the drawn span [s0, e] of polyline sh, in order along the
// route: {p, d, k, a} with p on the frame, d pointing OUT of it, k the segment it
// is on and a its distance along sh, for both an exit and a re-entry.
// frameCut(inside, outside) and unit(a, b) are gen_internal's own.
function findGapCuts(sh, s0, e, inFrame, frameCut, unit) {
  const cuts = [];
  let along = 0;
  for (let kk = 0; kk < s0; kk++) along += Math.hypot(sh[kk + 1][0] - sh[kk][0], sh[kk + 1][1] - sh[kk][1]);
  for (let kk = s0; kk < e; kk++) {
    let p = null, d;
    if (inFrame(sh[kk]) && !inFrame(sh[kk + 1])) { p = frameCut(sh[kk], sh[kk + 1]); d = unit(sh[kk], sh[kk + 1]); }
    else if (!inFrame(sh[kk]) && inFrame(sh[kk + 1])) { p = frameCut(sh[kk + 1], sh[kk]); d = unit(sh[kk + 1], sh[kk]); }
    if (p) cuts.push({ p, d, k: kk, a: along + Math.hypot(p[0] - sh[kk][0], p[1] - sh[kk][1]) });
    along += Math.hypot(sh[kk + 1][0] - sh[kk][0], sh[kk + 1][1] - sh[kk][1]);
  }
  return cuts;
}

// The exit events for route r's breaks, marked gap. opts.stops holds the route's
// in-frame stops as segment parameters (i + t along sh); opts.label is the "to X"
// every event carries, null for none.
function gapEvents(r, cuts, minDist, opts = {}) {
  const stops = opts.stops || [], label = opts.label != null ? opts.label : null;
  const pairs = [];
  for (let g = 0; g + 1 < cuts.length; g += 2) pairs.push([cuts[g], cuts[g + 1]]);
  // 1. a re-entry and the next exit close together with no stop between: one excursion
  for (let i = 0; i + 1 < pairs.length;) {
    const back = pairs[i][1], out = pairs[i + 1][0];
    const near = Math.hypot(back.p[0] - out.p[0], back.p[1] - out.p[1]) < minDist;
    const stopBetween = stops.some(s => s > back.k && s < out.k + 1);
    if (near && !stopBetween) pairs.splice(i, 2, [pairs[i][0], pairs[i + 1][1]]);
    else i++;
  }
  const ev = [];
  for (const [a, b] of pairs) {
    const apart = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) >= minDist;
    // 2. the same point out and back, but a long way round
    const long = a.a != null && b.a != null && b.a - a.a >= OUT_AND_BACK * minDist;
    if (!apart && !long) continue;
    ev.push({ r, cut: a, label, gap: true }, { r, cut: b, label, gap: true });
  }
  return ev;
}

// The "to X" route r's gap devices carry: termini[r].gap when it is set (false for
// none); otherwise nothing when the route has a terminus cut, which carries the
// label itself; otherwise the label that cut would have taken — end, then start,
// then terminiLabels. lt is termini[r], tr is TRIM[r], tl is terminiLabels[r].
function gapLabel(lt, tr, tl) {
  if (lt.gap !== undefined) return lt.gap || null;
  if (tr.endCut || tr.startCut) return null;
  if (lt.end !== undefined && lt.end !== false) return lt.end;
  if (lt.start !== undefined && lt.start !== false) return lt.start;
  return tl || null;
}

module.exports = { findGapCuts, gapEvents, gapLabel, OUT_AND_BACK };
