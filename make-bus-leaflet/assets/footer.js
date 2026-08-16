// Shared footer/attribution band for all four leaflet generators (internal + external,
// town + place). One place for the wording/position/branding so town and place maps stay
// technically identical, and any future addition to the line only has to change here.
//
// Layout: the version+validity line and the "BusMaps.uk" wordmark always sit on the same
// fixed baseline (bottomY, default 4mm above the page edge). The attribution note (one or
// two lines, varies in length by map type) is stacked directly above it. Because the brand/
// version line is pinned to a fixed bottom offset rather than counted from the note, all four
// map types keep an identical bottom-right corner regardless of how many note lines they need.
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Word-wrap each note to the available width (x1-x0) so a caller can hand over one long
// string (e.g. place-external's concatenated attribution) without it running off the page
// edge. Char width is estimated the same way gen_internal.js estimates label widths
// (size*0.52/char). Already-short lines pass through unsplit, so hand-authored multi-line
// notes render exactly as before. Shared by footerBand and footerPlateTop so the two can
// never disagree on how many lines a given `notes` value will actually render as.
function wrapNotes(notes, x0, x1, size) {
  const rawLines = (Array.isArray(notes) ? notes : [notes]).filter(Boolean);
  const maxChars = Math.max(20, Math.floor((x1 - x0) / (size * 0.52)));
  const noteLines = [];
  for (const raw of rawLines) {
    const words = String(raw).split(' ');
    let cur = '';
    for (const wd of words) {
      if ((cur + ' ' + wd).trim().length > maxChars) { noteLines.push(cur.trim()); cur = wd; }
      else cur += ' ' + wd;
    }
    if (cur.trim()) noteLines.push(cur.trim());
  }
  return noteLines;
}

// PRINT SAFE MARGIN (design.printSafe, 2026-08-16).
//
// Found by printing two sheets borderless and unscaled, which is the only way it
// could have been found: on screen the footer looks fine. Every sheet ever built
// puts its credit 3 mm from the right trim and its last baseline 4 mm from the
// bottom, and borderless printing over-scales by 2-3% — about 3 mm on A4 — so
// what is left is roughly 1 mm and whether a given sheet looks right comes down
// to the printer's feed tolerance. 5 mm is the conventional floor.
//
// `safe` insets all three edges the footer touches. Absent (null) it is exactly
// today's geometry, so an ungated sheet stays byte-identical. Applied to BOTH
// footerBand and footerPlateTop, because the plate top is computed from bottomY
// and gen_internal.js checks its own map notes against that number before
// drawing them — the two disagreeing is how content ends up under the plate.
// DESCENDER, not baseline. A 5mm margin is a claim about INK, and the last
// footer line is "Valid from July 2026" — the y in "July" hangs below its
// baseline. Insetting to the baseline alone left the ink at 4.41mm and the
// measure still warning, which is the small version of the same mistake the
// whole item is about: fixing the number you thought of rather than the one the
// paper shows. 0.212 em is Arial's descender, the same figure font_metrics.js
// and quality_metrics.js's textQuad both use, so the three agree by construction.
const DESCENDER = 0.212;

function inset({ x0, x1, bottomY, pageW, pageH, safe, size }) {
  if (safe == null) return { x0, x1, bottomY };
  return {
    x0: Math.max(x0, safe),
    x1: Math.min(x1, pageW - safe),
    bottomY: Math.min(bottomY, pageH - safe - size * DESCENDER),
  };
}

// The y (page mm) at which the footer's backing plate starts, for a given notes value —
// exposed so a generator can check BEFORE drawing its own map content (e.g. gen_internal.js's
// mapNotes) whether something is about to land underneath the footer and get visually lost.
// Same defaults as footerBand; call with the same args you intend to pass footerBand with.
function footerPlateTop({ notes, x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210, safe = null } = {}) {
  const g = inset({ x0, x1, bottomY, pageW, pageH, safe, size });
  const n = wrapNotes(notes, g.x0, g.x1, size).length;
  return g.bottomY - lineGap * n - size * 1.3;
}

function footerBand({ notes, version, validFrom = 'Summer 2026', x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210, safe = null }) {
  ({ x0, x1, bottomY } = inset({ x0, x1, bottomY, pageW, pageH, safe, size }));
  const noteLines = wrapNotes(notes, x0, x1, size);
  const n = noteLines.length;
  // Backing plate: map content (route lines, exit-arrow labels) is drawn earlier in the SVG
  // and its extent varies per town/place, so rather than chase a safe y for every geometry,
  // give the footer its own semi-opaque strip that always sits on top and stays legible.
  const plateTop = bottomY - lineGap * n - size * 1.3;
  const out = [`<rect x="0" y="${plateTop.toFixed(2)}" width="${pageW}" height="${(pageH - plateTop).toFixed(2)}" fill="#fff" fill-opacity="0.97"/>`];
  noteLines.forEach((t, i) => {
    const y = bottomY - lineGap * (n - i);
    out.push(`<text x="${x0}" y="${y.toFixed(2)}" font-family="Arial" font-size="${size}" fill="#666">${esc(t)}</text>`);
  });
  // The internal engine build number (`version`) is deliberately NOT printed on the
  // public sheet any more (2026-08-10, Peter) — it's an internal build counter, not
  // a fact about the map's content, and duplicated/confused with the portal's own
  // customer-facing version pill. It stays available in routes.json's `version`/
  // `engine` fields and the S4/S5 run-folder name for internal use; `version` is
  // still accepted here (unused) so existing call sites don't need to change.
  const left = validFrom ? `Valid from ${esc(validFrom)}` : null;
  if (left) out.push(`<text x="${x0}" y="${bottomY}" font-family="Arial" font-size="${size}" fill="#999">${left}</text>`);
  out.push(`<text x="${x1}" y="${bottomY}" font-family="Arial" font-size="${size}" fill="#999" text-anchor="end">Map design © BusMaps.uk</text>`);
  return out.join('\n');
}

module.exports = { footerBand, footerPlateTop };
