// Shared footer/attribution band for all four leaflet generators (internal + external,
// town + place). One place for the wording/position/branding so town and place maps stay
// technically identical, and any future addition to the line only has to change here.
//
// Layout: the version+validity line and the "BusMaps.uk" wordmark always sit on the same
// fixed baseline (bottomY, default 4mm above the page edge). The attribution note (one or
// two lines, varies in length by map type) is stacked directly above it. Because the brand/
// version line is pinned to a fixed bottom offset rather than counted from the note, all four
// map types keep an identical bottom-right corner regardless of how many note lines they need.
const path = require('path');
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

// THE ROUTE BACK (design.sheetUrl / design.sheetQr, 2026-08-18).
//
// The band used to end at "Map design © BusMaps.uk", which is a CREDIT and not a
// route back. The portal's whole promise is the monthly refresh; a printed sheet
// is a snapshot of one month, and once it is on a noticeboard it had no way of
// telling anyone a current version exists. See the publisher benchmark plan,
// item 2. Both keys are opt-in and absent they change nothing — with `url` unset
// every number below reduces to exactly the arithmetic that was here before, so
// an ungated sheet stays byte-identical.
//
// SIX modules of quiet zone, not the four the spec calls for. Measured, not
// guessed: of 78 realistic BusMaps URLs rendered at four modules, OpenCV's
// detector could not LOCATE one of them (Beaconsfield Waitrose at level Q) at
// any scale, and found every one of the 78 at six. The symbol was valid either
// way — an independent reverse-decoder read it back correctly — so this is a
// margin for real detectors rather than a correctness fix, which is exactly the
// kind of thing a spec-conformance test would have certified and a phone would
// have refused.
const QUIET_MODULES = 6;
// Below this, a printed module is smaller than a phone camera can reliably
// resolve at arm's length. 16mm of version 4 gives 0.48; a URL long enough to
// need version 6 gives 0.37 and wants either a shorter URL or a bigger `mm`.
const MIN_MODULE_MM = 0.40;

// Geometry of the QR block, or null when no code is asked for. Its bottom edge
// lines up with the descender of the last footer line, so the code and the type
// share a baseline the eye can see.
function qrBox({ x1, bottomY, size, url, qr }) {
  if (!qr || !url) return null;
  // Required lazily, and only down this branch, ON PURPOSE. footer.js is vendored
  // into the portal (changing-the-engine.md §4) and qr.js is a new file beside it;
  // a top-level require would mean a partial vendor throws at require time for
  // EVERY map, including the ones — currently all of them — that ask for no code
  // at all. The drift table still catches the omission; this just stops a dormant
  // feature being able to take the portal down. Same reasoning for font_metrics.
  const QRC = require(path.join(__dirname, 'qr.js'));
  const cfg = (qr === true) ? {} : qr;
  const target = cfg.target || (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url);
  const sym = QRC.encode(target, { level: cfg.level || 'M' });
  const mm = cfg.mm != null ? +cfg.mm : 16;
  const mod = mm / sym.n;
  const quiet = QUIET_MODULES * mod;
  const y1 = bottomY + size * DESCENDER;
  return { QRC, sym, target, mm, mod, quiet, x0: x1 - mm, x1, y0: y1 - mm, y1 };
}

// One layout, computed once, used by BOTH footerPlateTop and footerBand — the two
// used to derive the plate top independently from the same inputs, and the header
// comment on gen_internal.js's INTERNAL_FOOTER_NOTES exists because keeping them in
// step was a manual job. With the QR able to push the plate up as well as the text,
// two derivations would have been two chances to disagree.
function layout({ notes, url, urlLabel, qr, x0, x1, bottomY, lineGap, size, pageW, pageH, safe }) {
  const g = inset({ x0, x1, bottomY, pageW, pageH, safe, size });
  const box = qrBox({ x1: g.x1, bottomY: g.bottomY, size, url, qr });
  // Everything textual stops clear of the code's quiet zone. The floor keeps a
  // silly `mm` from squeezing the notes to nothing rather than failing visibly.
  const textX1 = box ? Math.max(g.x0 + 60, box.x0 - box.quiet) : g.x1;
  const noteLines = wrapNotes(notes, g.x0, textX1, size);
  const urlSize = size * 1.25;
  const urlGap = lineGap * 1.4;
  const urlY = url ? g.bottomY - lineGap * noteLines.length - urlGap : null;
  const textTop = url ? urlY - urlSize * 1.3
                      : g.bottomY - lineGap * noteLines.length - size * 1.3;
  const plateTop = box ? Math.min(textTop, box.y0 - box.quiet) : textTop;
  return { ...g, box, textX1, noteLines, urlY, urlSize, plateTop, urlLabel };
}

// The y (page mm) at which the footer's backing plate starts, for a given notes value —
// exposed so a generator can check BEFORE drawing its own map content (e.g. gen_internal.js's
// mapNotes) whether something is about to land underneath the footer and get visually lost.
// Same defaults as footerBand; call with the same args you intend to pass footerBand with.
function footerPlateTop({ notes, url = null, urlLabel, qr = null, x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210, safe = null } = {}) {
  return layout({ notes, url, urlLabel, qr, x0, x1, bottomY, lineGap, size, pageW, pageH, safe }).plateTop;
}

function footerBand({ notes, version, validFrom = 'Summer 2026', url = null, urlLabel = 'Check for a newer version:', qr = null, x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210, safe = null }) {
  const L = layout({ notes, url, urlLabel, qr, x0, x1, bottomY, lineGap, size, pageW, pageH, safe });
  const { box, textX1, noteLines, plateTop } = L;
  ({ x0, x1, bottomY } = L);
  const n = noteLines.length;
  // Backing plate: map content (route lines, exit-arrow labels) is drawn earlier in the SVG
  // and its extent varies per town/place, so rather than chase a safe y for every geometry,
  // give the footer its own semi-opaque strip that always sits on top and stays legible.
  const out = [`<rect x="0" y="${plateTop.toFixed(2)}" width="${pageW}" height="${(pageH - plateTop).toFixed(2)}" fill="#fff" fill-opacity="0.97"/>`];
  noteLines.forEach((t, i) => {
    const y = bottomY - lineGap * (n - i);
    out.push(`<text x="${x0}" y="${y.toFixed(2)}" font-family="Arial" font-size="${size}" fill="#666">${esc(t)}</text>`);
  });
  if (url) {
    // Label and address are two <text> runs, not one with a bold <tspan>: no other
    // furniture in this engine uses tspan and gate_lib.js's label diff already notes
    // that nested-tspan structure is what makes an SVG diff fragile.
    const FM = require(path.join(__dirname, 'font_metrics.js'));
    const uw = FM.textWidth(url, L.urlSize, true);
    const lw = L.urlLabel ? FM.textWidth(L.urlLabel, L.urlSize, false) : 0;
    // Right-anchored against the code, so "check for a newer version", the address
    // and the thing you point a phone at read as one block in the corner rather
    // than as a caption stranded at the far end of a 297mm sheet.
    out.push(`<text x="${textX1.toFixed(2)}" y="${L.urlY.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${L.urlSize}" fill="#333" text-anchor="end">${esc(url)}</text>`);
    if (L.urlLabel) out.push(`<text x="${(textX1 - uw - L.urlSize * 0.4).toFixed(2)}" y="${L.urlY.toFixed(2)}" font-family="Arial" font-size="${L.urlSize}" fill="#666" text-anchor="end">${esc(L.urlLabel)}</text>`);
    if (x0 + lw + uw + L.urlSize * 0.4 > textX1)
      process.stderr.write(`footer: the URL line is ${(x0 + lw + uw + L.urlSize * 0.4 - textX1).toFixed(1)}mm wider than the band — shorten design.sheetUrlLabel or design.sheetUrl.\n`);
  }
  if (box) {
    // Own white ground, opaque, including the quiet zone: the plate is 0.97 alpha
    // and a code needs real contrast, not nearly-real contrast.
    out.push(`<rect x="${(box.x0 - box.quiet).toFixed(2)}" y="${(box.y0 - box.quiet).toFixed(2)}" width="${(box.mm + 2 * box.quiet).toFixed(2)}" height="${(box.mm + 2 * box.quiet).toFixed(2)}" fill="#ffffff"/>`);
    out.push(`<path d="${box.QRC.svgPath(box.sym.modules, box.x0, box.y0, box.mod)}" fill="#111111"/>`);
    if (box.mod < MIN_MODULE_MM)
      process.stderr.write(`footer: the QR is version ${box.sym.version} at ${box.mm}mm, so each module is `
        + `${box.mod.toFixed(2)}mm — under ${MIN_MODULE_MM}mm a phone will struggle in print. `
        + `Shorten design.sheetUrl, or raise design.sheetQr.mm.\n`);
  }
  // The internal engine build number (`version`) is deliberately NOT printed on the
  // public sheet any more (2026-08-10, Peter) — it's an internal build counter, not
  // a fact about the map's content, and duplicated/confused with the portal's own
  // customer-facing version pill. It stays available in routes.json's `version`/
  // `engine` fields and the S4/S5 run-folder name for internal use; `version` is
  // still accepted here (unused) so existing call sites don't need to change.
  const left = validFrom ? `Valid from ${esc(validFrom)}` : null;
  if (left) out.push(`<text x="${x0}" y="${bottomY}" font-family="Arial" font-size="${size}" fill="#999">${left}</text>`);
  out.push(`<text x="${textX1}" y="${bottomY}" font-family="Arial" font-size="${size}" fill="#999" text-anchor="end">Map design © BusMaps.uk</text>`);
  return out.join('\n');
}

module.exports = { footerBand, footerPlateTop };
