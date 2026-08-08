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
  // town-skill versions are bare numbers ("6.9"); place-skill versions already carry a
  // leading "v" ("v1.4") — strip it so the "Map v…" prefix never doubles up.
  const verNum = version ? String(version).replace(/^v/i, '') : null;
  const left = [verNum ? `Map v${esc(verNum)}` : null, validFrom ? esc(validFrom) : null].filter(Boolean).join(' · ');
  if (left) out.push(`<text x="${x0}" y="${bottomY}" font-family="Arial" font-size="${size}" fill="#999">${left}</text>`);
  out.push(`<text x="${x1}" y="${bottomY}" font-family="Arial" font-size="${size}" fill="#999" text-anchor="end">BusMaps.uk</text>`);
  return out.join('\n');
}

module.exports = { footerBand };
