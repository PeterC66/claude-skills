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
// edge. Already-short lines pass through unsplit, so hand-authored multi-line notes render
// exactly as before. Shared by footerBand and footerPlateTop so the two can never disagree
// on how many lines a given `notes` value will actually render as.
//
// MEASURED, NOT COUNTED (2026-08-19). This wrapped by CHARACTER COUNT at size*0.52 per
// character — the same estimate the 2026-08-18 session had already found wrong in
// gen_external_radial.js's legend and fixed there — and the five PLACE EXTERNAL sheets are
// where it showed. Their attribution is one long concatenated string, so it is the only
// note the wrap actually has to break, and 0.52/char let it run to x=240.8mm on a band
// that ends at 177-195: between 46 and 64 mm PAST the right-hand "Latest version:" block,
// straight through the label and into the QR's quiet zone, on every one of the five. Peter
// saw the mild end of it on a town sheet ("footer left text nearly meets Latest version",
// item 28); the place sheets were the same bug with the volume up.
//
// GUTTER, because "does not overlap" is not the same as "looks right". Wrapping to exactly
// the available width puts a full-length note line flush against the right-hand block, which
// is what item 28 is about even where nothing collides. 6mm of clear page is roughly two
// characters at this size and reads as deliberate.
//
// font_metrics is required lazily and defended, for the same reason qr.js is (see qrBox):
// footer.js is vendored into the portal and a partial vendor must not be able to take every
// map down for the sake of a wrap. Without it the old estimate is used and says so.
const NOTE_GUTTER = 6;
let _FM = undefined;
function fontMetrics() {
  if (_FM !== undefined) return _FM;
  try { _FM = require(path.join(__dirname, 'font_metrics.js')); }
  catch (e) {
    _FM = null;
    process.stderr.write('footer: font_metrics.js is not beside footer.js — the attribution '
      + 'note falls back to a character-count wrap, which over-runs by up to 60mm on a long '
      + 'note. Vendor font_metrics.js (changing-the-engine.md §4).\n');
  }
  return _FM;
}
function wrapNotes(notes, x0, x1, size) {
  const rawLines = (Array.isArray(notes) ? notes : [notes]).filter(Boolean);
  const FM = fontMetrics();
  const room = Math.max(30, x1 - x0 - NOTE_GUTTER);
  const fits = FM ? (t => FM.textWidth(t, size, false) <= room)
                  : (t => t.length <= Math.max(20, Math.floor(room / (size * 0.52))));
  const noteLines = [];
  for (const raw of rawLines) {
    const words = String(raw).split(' ');
    let cur = '';
    for (const wd of words) {
      if (cur && !fits((cur + ' ' + wd).trim())) { noteLines.push(cur.trim()); cur = wd; }
      else cur += ' ' + wd;
    }
    if (cur.trim()) noteLines.push(cur.trim());
  }
  // One unbreakable word can still be wider than the band. Say so rather than print it
  // through the QR: the remedy is the caller's wording, and nothing here can guess it.
  if (FM) for (const ln of noteLines) {
    const over = FM.textWidth(ln, size, false) - room;
    if (over > 0) process.stderr.write(`footer: the note line "${ln.slice(0, 40)}…" is `
      + `${over.toFixed(1)}mm wider than the band even unwrapped — shorten it.\n`);
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
function layout({ notes, url, urlLabel, qr, sheetVersion, x0, x1, bottomY, lineGap, size, pageW, pageH, safe }) {
  const g = inset({ x0, x1, bottomY, pageW, pageH, safe, size });
  const box = qrBox({ x1: g.x1, bottomY: g.bottomY, size, url, qr });
  // Everything textual stops clear of the code's quiet zone. The floor keeps a
  // silly `mm` from squeezing the notes to nothing rather than failing visibly.
  const textX1 = box ? Math.max(g.x0 + 60, box.x0 - box.quiet) : g.x1;
  const urlSize = size * 1.25;
  /* The notes wrap to clear the RIGHT-HAND BLOCK, not merely the QR.
   *
   * textX1 is where the code's quiet zone begins, and wrapping to it is what made item 28:
   * "Latest version: <url>" is drawn end-anchored AT textX1 on the line above, so a note
   * wrapped to the same width runs the full span underneath it with 0.6mm of air. On the
   * five place-external sheets — the only ones whose attribution is long enough for the
   * wrap to have to break it at all — the note ran to x=240.8 under a block occupying
   * 177 to 275. Nothing overlapped, which is why no gate saw it; it just looked wrong,
   * and Peter said so.
   *
   * Measuring the block is cheap and the width is already known here. Where there is no
   * URL line the old width stands, so a sheet with no route back is unchanged.
   */
  let rightLeft = textX1;
  if (url) {
    const FM = fontMetrics();
    if (FM) rightLeft = textX1 - FM.textWidth(url, urlSize, true)
      - (urlLabel ? FM.textWidth(urlLabel, urlSize, false) : 0) - urlSize * 0.4;
  }
  const noteLines = wrapNotes(notes, g.x0, Math.min(textX1, rightLeft), size);
  const urlGap = lineGap * 1.4;
  let urlY = url ? g.bottomY - lineGap * noteLines.length - urlGap : null;
  // With a code present, sit the URL line on the CODE's optical centre rather than at a
  // fixed offset above the notes.
  //
  // The two devices are anchored from opposite ends — the code's BOTTOM aligns with the
  // last footer line and it grows upward, while the URL line hangs at a fixed gap ABOVE
  // the notes — so at 14mm they met only at the top: the address sat level with the top
  // edge of the code and the band beside its lower two-thirds was empty. Peter spotted it
  // on the St Ives sheet. Centring reads as one "scan or type this" pair and uses the
  // band's own height instead of leaving a hole in it.
  //
  // Never closer to the notes than 0.6 of a line, so a tall code cannot push the address
  // down onto the attribution text; without a code the arithmetic is untouched.
  if (url && box) {
    const centred = box.y0 + box.mm / 2 + urlSize * 0.36;
    const floorY = g.bottomY - lineGap * noteLines.length - lineGap * 0.6;
    urlY = Math.min(centred, floorY);
  }
  const textTop = url ? Math.min(urlY - urlSize * 1.3,
                                 g.bottomY - lineGap * noteLines.length - size * 1.3)
                      : g.bottomY - lineGap * noteLines.length - size * 1.3;
  const plateTop = box ? Math.min(textTop, box.y0 - box.quiet) : textTop;
  return { ...g, box, textX1, noteLines, urlY, urlSize, plateTop, urlLabel, sheetVersion };
}

// The y (page mm) at which the footer's backing plate starts, for a given notes value —
// exposed so a generator can check BEFORE drawing its own map content (e.g. gen_internal.js's
// mapNotes) whether something is about to land underneath the footer and get visually lost.
// Same defaults as footerBand; call with the same args you intend to pass footerBand with.
function footerPlateTop({ notes, url = null, urlLabel, qr = null, sheetVersion = null, x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210, safe = null } = {}) {
  return layout({ notes, url, urlLabel, qr, sheetVersion, x0, x1, bottomY, lineGap, size, pageW, pageH, safe }).plateTop;
}

function footerBand({ notes, version, sheetVersion = null, validFrom = 'Summer 2026', url = null, urlLabel = 'Check for a newer version:', qr = null, x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210, safe = null }) {
  const L = layout({ notes, url, urlLabel, qr, sheetVersion, x0, x1, bottomY, lineGap, size, pageW, pageH, safe });
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
  /* design.sheetVersion — the PUBLISHED version, in the hole the QR left behind.
   *
   * Two of Peter's comments are one line of type. Item 6: no version number is printed
   * anywhere on the sheet. Item 5: there is a vertical hole above the (c) line on the
   * right-hand side — structural, because the URL sits on the QR's optical centre while
   * the credit is pinned to bottomY, and unlike the left-hand side there is nothing
   * between them. Putting the version in that gap answers both with one row.
   *
   * NOT the engine build number. That was deliberately dropped on 2026-08-10 and the
   * decision stands: it is an internal counter, it moves for reasons a reader cannot see,
   * and it was being confused with the portal's version pill. This is the PORTAL's
   * customer-facing version — the number on the public page the QR leads to — so the
   * sheet on the noticeboard and the page it points at agree, which is the whole promise
   * of printing a route back. `version` is still accepted and still unused.
   *
   * THREE STATES, ONE ROW (Peter, 2026-08-19). The same sheet needs a different answer
   * depending on where the reader got it, so the VALUE is the caller's to choose and the
   * engine only decides how to word it:
   *
   *   built here, before it reaches the portal  ->  "build 6.54 · 19 Aug 2026"
   *       the number to quote back when something on a development render looks wrong.
   *       rollout.js stamps it into the run's own routes.json, so the byte gate — which
   *       reads routes.json and nothing else — reproduces it like any other config.
   *   downloaded from the portal as draft/review ->  "Draft 5.0 · 19 Aug 2026 14:02"
   *       the version it WILL publish as, so a comment on a draft can name it.
   *   downloaded from the portal, published      ->  "5.0"
   *       a plain sequence, which is all a reader on a noticeboard needs.
   *
   * A bare number gets the words "Map version" in front of it; anything else prints
   * verbatim, so a caller that needs its own phrasing is not fighting a prefix. That is
   * the whole rule — one string in, one line out.
   *
   * NOT the engine build number. That was deliberately dropped on 2026-08-10 and the
   * decision stands for the PUBLIC states above; the development state is the case it was
   * dropped for not existing yet, and it is the one Peter asked for by name.
   *
   * "from June 2026" on the title already carries the DATA's validity, which is why the
   * date here is the build's, not the timetable's, and why it is optional.
   *
   * LEAFLET_SHEET_VERSION wins over the config key, so the portal can stamp the state it
   * is actually in without rewriting the map's data. Absent both, no row is drawn and the
   * band is byte-identical.
   */
  const sv = process.env.LEAFLET_SHEET_VERSION || L.sheetVersion;
  if (sv) {
    const bare = /^v?\d[\d.]*$/.test(String(sv).trim());
    // Midway between the URL baseline and the credit baseline when there is a URL line to
    // measure from; otherwise one line above the credit. Same grey and size as the credit,
    // because it is the same kind of fact about the sheet rather than a call to action.
    const vy = (L.urlY != null) ? (L.urlY + bottomY) / 2 + size * 0.2 : bottomY - lineGap * 1.3;
    out.push(`<text x="${textX1}" y="${vy.toFixed(2)}" font-family="Arial" font-size="${size}" fill="#999" text-anchor="end">${esc(bare ? 'Map version ' + sv : sv)}</text>`);
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
