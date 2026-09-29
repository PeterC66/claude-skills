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
 * break the device a terminus cut gets: an arrow and the route's badge, no "to X".
 *
 * WHAT WAS MEASURED (every committed internal sheet, forced on, in scratch). The
 * vertex test finds a break on nine sheets, but on six of them every one is an
 * exit and re-entry at the SAME point (0.0 mm apart: a vertex a hair past the
 * edge), which is not a journey off the sheet. So breaks are taken as exit /
 * re-entry PAIRS and a pair closer than the cluster distance is dropped. What
 * is left draws on Ramsey (RH5, 12.6 mm), St Neots Co-op (61EY, 66) and Ely
 * Co-op (9, ZIP, 10). Drawing a device moves badges and can cost a road label
 * (Ely lost Witchford Road and Beresford Road), so adoption is per map, on crops.
 */
'use strict';

// Every break inside the drawn span [s0, e] of polyline sh, in order along the
// route: {p, d} with p on the frame and d pointing OUT of it, for both an exit
// and a re-entry. frameCut(inside, outside) and unit(a, b) are gen_internal's own.
function findGapCuts(sh, s0, e, inFrame, frameCut, unit) {
  const cuts = [];
  for (let kk = s0; kk < e; kk++) {
    if (inFrame(sh[kk]) && !inFrame(sh[kk + 1])) cuts.push({ p: frameCut(sh[kk], sh[kk + 1]), d: unit(sh[kk], sh[kk + 1]) });
    else if (!inFrame(sh[kk]) && inFrame(sh[kk + 1])) cuts.push({ p: frameCut(sh[kk + 1], sh[kk]), d: unit(sh[kk + 1], sh[kk]) });
  }
  return cuts;
}

// The exit events for route r's breaks: unlabelled, marked gap, and only for a
// pair whose exit and re-entry are at least minDist apart.
function gapEvents(r, cuts, minDist) {
  const out = [];
  for (let g = 0; g + 1 < cuts.length; g += 2) {
    const a = cuts[g].p, b = cuts[g + 1].p;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < minDist) continue;
    out.push({ r, cut: cuts[g], label: null, gap: true }, { r, cut: cuts[g + 1], label: null, gap: true });
  }
  return out;
}

module.exports = { findGapCuts, gapEvents };
