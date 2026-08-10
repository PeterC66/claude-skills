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

function footerBand({ notes, version, validFrom = 'Summer 2026', x0 = 8, x1 = 294, bottomY = 206, lineGap = 3.6, size = 2.8, pageW = 297, pageH = 210 }) {
  const noteLines = (Array.isArray(notes) ? notes : [notes]).filter(Boolean);
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

module.exports = { footerBand };
