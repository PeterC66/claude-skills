// Reusable POI pictograms. Each returns an SVG string centred at (x,y),
// drawn to fit roughly a 5mm box (scale s = half-extent in mm, default 2.2).
//
// `ink` (optional, 4th arg after s): "charcoal" recolours the whole set to one
// neutral, keeping red for the GP cross. Peter's answer to G3 of the design-
// quality plan, 2026-08-15, chosen from five options rendered at printed size
// (Development Docs/icon-set-options_2026-08-15.html). The reasoning: on a sheet
// where colour already means ROUTE, a bright red trolley and a green cross read
// as route information and compete with the lines. Option E — these shapes with
// the colour taken out and nothing else changed — was preferred over a redrawn
// outline set because at 4.2 mm a 0.5 mm outline goes noticeably faint against a
// ribbon, while these solid glyphs hold their weight.
//
// Absent/any other value ⇒ the original palette, byte-identical.
const CHARCOAL = '#33383d', CHARCOAL_ACCENT = '#c62828';
function inkify(svg) {
  return svg.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (m, k, c) => {
    const h = c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
    const n = parseInt(h.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    // A PALE fill is a backing plate, not a mark — recolouring it charcoal turns
    // the allotments glyph's bed into a solid black block. Send those to white.
    if (lum > 0.75) return `${k}="#ffffff"`;
    if (/^#d00+$/i.test(c)) return `${k}="${CHARCOAL_ACCENT}"`;
    // A symbol that was ALREADY a neutral grey was drawn light on purpose — the
    // industrial estate is context, not subject. Flattening every colour to one
    // charcoal made a cluster of factories the heaviest ink on the sheet, which is
    // the opposite of what taking the colour out is for. Neutralise those, keep
    // their tone; send the genuinely COLOURED symbols to charcoal.
    const neutral = (Math.max(r, g, b) - Math.min(r, g, b)) / 255 < 0.10;
    if (neutral && lum > 0.32) {
      const v = Math.round(lum * 255);
      const hex = (x) => x.toString(16).padStart(2, '0');
      return `${k}="#${hex(v - 2)}${hex(v + 1)}${hex(v + 4)}"`;   // a hair cool, to match CHARCOAL
    }
    return `${k}="${CHARCOAL}"`;
  });
}
/* ------------------------------------------------------------------ grid set
 * Phase 5 of the design-quality plan: all twelve redrawn on ONE 24x24 grid,
 * one stroke weight, one corner radius, one level of detail, and SOLID rather
 * than outlined — a 0.5 mm outline goes faint against a route ribbon at 4.2 mm,
 * which is what the G3 decision sheet showed and why option E (recolour only)
 * shipped ahead of this.
 *
 * Four rules, and they are the whole set:
 *   1. 24 x 24 units, 2 units of padding, live area 20 x 20. Keylines: square
 *      18, circle 20, portrait 16x20, landscape 20x16 — so a square glyph and a
 *      round one look the same SIZE rather than measuring the same.
 *   2. One stroke weight (GW) and one corner radius (GR). Nothing else.
 *   3. Solid marks. A limb is never thinner than GW and two marks are never
 *      closer than GW, so nothing fuses at printed size.
 *   4. THE LIVE AREA IS THE BOX THE ENGINE RESERVES. 20u maps to exactly 2*s mm,
 *      so at the map's s=2.1 a glyph fills the 4.2 mm box POI_HALF declares and
 *      never exceeds it. The shipped set does not: its widest glyphs reach
 *      +-2.6 in a +-2.2 space, ~18% outside the box `reserveIcons` blocks out
 *      and `iconMinSep` separates, which is why symbols that measure clear can
 *      still touch. Mapping the 24u GRID to the box instead of the 20u live
 *      area was the first cut and it came out 20% smaller than the shipped set
 *      on the comparison sheet — the padding is headroom the placer already
 *      provides, so spending printed size on it twice is what that costs.
 *
 * Authored one-colour-per-glyph, so charcoal is a parameter rather than a
 * regex over the artwork — `inkify` is not used on this set and must not be.
 */
const GW = 2.6, GR = 2, WHITE = '#ffffff';
// The casing, in grid units. 1.6u at the map's s=2.1 is 0.34 mm — the same
// 0.35 mm `design.routeCasing` puts under every route line, and for the same
// reason: charcoal on a dark route is charcoal on navy. A solid glyph needs it
// MORE than an outlined one, because an outline at least carries white inside.
// Where the ground is already white it costs nothing; it is invisible.
const GCASE = 1.6;
const GRID_COL = {
  shop: '#c2185b', gp: '#d00', pharmacy: '#0a8a3a', library: '#8a5a00', museum: '#6a3d9a',
  leisure: '#e07b00', school: '#1f78b4', park: '#2f8f2f', industrial: '#777777',
  community: '#00868b', townhall: '#555555', allotments: '#7a8f3c',
};
/* `cw > 0` draws the same glyph as one white silhouette fattened by cw, to be
 * laid down before the real one. It is a separate PASS rather than
 * `paint-order:stroke` per path, which would let a later part's casing eat into
 * an earlier part's fill — the tree's trunk would cut a white notch out of its
 * own canopy. Knockouts are skipped in the casing pass: the silhouette wants to
 * be solid, and a knockout is white on white there anyway. */
function gridGlyph(cat, col, cw = 0) {
  const f = (d) => cw ? `<path d="${d}" fill="${WHITE}" stroke="${WHITE}" stroke-width="${cw * 2}" stroke-linejoin="round"/>`
                      : `<path d="${d}" fill="${col}"/>`;
  const k = (d) => cw ? '' : `<path d="${d}" fill="${WHITE}"/>`;   // knockout
  const st = (d) => `<path d="${d}" fill="none" stroke="${cw ? WHITE : col}" stroke-width="${GW + cw * 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dot = (cx, cy, r, c = col) => cw ? `<circle cx="${cx}" cy="${cy}" r="${r + cw}" fill="${WHITE}"/>`
                                         : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
  // One cross, shared by the two health glyphs, knocked out of a solid field.
  const cross = k('M10,5.6 H14 V10 H18.4 V14 H14 V18.4 H10 V14 H5.6 V10 H10 Z');
  switch (cat) {
    case 'shop':        // trolley: solid basket, one handle, two wheels
      return st('M3.4,4.6 H5.6 L7.8,9')
           + f('M7.4,9 H21.4 L19,15.6 H10 Z')
           + dot(11.6, 17.9, 1.8) + dot(18, 17.9, 1.8);
    case 'gp':          // cross knocked out of the SQUARE keyline
      return `<rect x="${3 - cw}" y="${3 - cw}" width="${18 + cw * 2}" height="${18 + cw * 2}" rx="${GR + cw}" fill="${cw ? WHITE : col}"/>` + cross;
    case 'pharmacy':    // the same cross, in the CIRCLE keyline — one family, and
                        // it survives losing its colour, which the shipped pair
                        // does not: in charcoal those two are the same drawing
      return dot(12, 12, 10) + cross;
    case 'library':     // open book: two leaves tilted into a shallow V with a GW
                        // gutter. Drawn as slabs with a straight spine edge they
                        // read as two blocks — the tilt is what says "book"
      return f('M11.2,8.4 L2.4,5.8 V15.2 L11.2,17.8 Z')
           + f('M12.8,8.4 L21.6,5.8 V15.2 L12.8,17.8 Z');
    case 'museum':      // pediment, four columns, stylobate
      return f('M12,3 L22,9 H2 Z')
           + f('M3.2,10.6 h2.7 v7.6 h-2.7 Z M8.3,10.6 h2.7 v7.6 h-2.7 Z '
             + 'M13.1,10.6 h2.7 v7.6 h-2.7 Z M18.2,10.6 h2.7 v7.6 h-2.7 Z')
           + f('M2,19.4 H22 V21.4 H2 Z');
    case 'leisure':     // running figure — limbs at GW, so it is solid too
      return dot(15.2, 5.6, 3)
           + st('M14.4,9.4 L10.6,14.2 M14.6,10.4 L18.6,13 M13,10.4 L8.8,8.4 '
              + 'M10.6,14.2 L6.4,19.6 M10.6,14.2 L15.2,15.8 L16.2,20.6');
    case 'school':      // mortarboard: board, cap, tassel
      return f('M12,3.6 L22,8.4 L12,13.2 L2,8.4 Z')
           + f('M6.6,10.6 V15.4 C6.6,18.6 17.4,18.6 17.4,15.4 V10.6 L12,13.2 Z')
           + st('M20.1,9.6 V15.4') + dot(20.1, 17.2, 1.7);
    case 'park':        // three-lobe canopy — a broadleaf tree, not a lollipop
      return dot(12, 7.6, 5.2) + dot(6.9, 11.6, 4.6) + dot(17.1, 11.6, 4.6)
           + f('M10.4,12.6 h3.2 v8.2 h-3.2 Z');
    case 'industrial':  // saw-tooth shed under one chimney
      return f('M17.6,3.6 h3.4 v8.4 h-3.4 Z')
           + f('M2.6,21 V11.6 L8,14.6 V11.6 L13.4,14.6 V11.6 L21,14.6 V21 Z');
    case 'community':   // two figures, the front one cased in white so the pair
                        // does not fuse into one blob at printed size
      return dot(16.4, 7.6, 3) + f('M11.4,20 C11.4,14.2 21.4,14.2 21.4,20 Z')
           + (cw ? '' : `<g fill="${col}" stroke="${WHITE}" stroke-width="${GW}" stroke-linejoin="round" paint-order="stroke">`)
           + dot(8, 7, 3) + f('M3.2,20 C3.2,13.6 13.4,13.6 13.4,20 Z') + (cw ? '' : '</g>');
    case 'townhall':    // civic block with a flag — deliberately NOT a colonnade,
                        // so it cannot be mistaken for the museum
      return st('M12,2.2 V8') + f('M12.6,2.4 L17,3.8 L12.6,5.2 Z')
           + f('M3.6,7.6 H20.4 V19 H3.6 Z')
           + k('M5.6,10 h2.6 v2.6 h-2.6 Z M15.8,10 h2.6 v2.6 h-2.6 Z M10.4,13 h3.2 v6 h-3.2 Z')
           + f('M2,19 H22 V21.4 H2 Z');
    case 'allotments':  // three beds inside a frame — the one glyph that is a
                        // frame, so it takes the corner radius
      return `<rect x="${3 + GW / 2}" y="${5 + GW / 2}" width="${18 - GW}" height="${14 - GW}" rx="${GR}" fill="${cw ? WHITE : 'none'}" stroke="${cw ? WHITE : col}" stroke-width="${GW + cw * 2}"/>`
           + f('M6.3,8.4 h2.6 v7.2 h-2.6 Z M10.7,8.4 h2.6 v7.2 h-2.6 Z M15.1,8.4 h2.6 v7.2 h-2.6 Z');
    default:
      return dot(12, 12, 7);
  }
}

// Charcoal is one ink with two deliberate exceptions, both inherited from
// `inkify` and both worth keeping: red for the GP cross, and a lighter neutral
// for the industrial estate, which is CONTEXT rather than subject — flattening
// it to full charcoal makes a cluster of factories the heaviest ink on the
// sheet, which is the opposite of what taking the colour out is for.
const GRID_INK = { gp: CHARCOAL_ACCENT, industrial: '#7c7f82' };
function icon(cat, x, y, s = 2.2, ink, set) {
  if (set === 'grid') {
    const col = ink === 'charcoal' ? (GRID_INK[cat] || CHARCOAL) : (GRID_COL[cat] || '#666666');
    // 20 grid units (the live area) == the 2*s mm box the engine reserves.
    // The casing pass is a fattened white silhouette, laid down first.
    return `<g transform="translate(${x} ${y}) scale(${s / 10}) translate(-12 -12)">`
         + gridGlyph(cat, col, GCASE) + gridGlyph(cat, col) + '</g>';
  }
  if (ink === 'charcoal') return inkify(icon(cat, x, y, s));
  const T = (inner) => `<g transform="translate(${x} ${y}) scale(${s/2.2})">${inner}</g>`;
  const plus = (col) => `<rect x="-0.55" y="-1.5" width="1.1" height="3" fill="${col}"/><rect x="-1.5" y="-0.55" width="3" height="1.1" fill="${col}"/>`;
  switch (cat) {
    case 'shop': // supermarket trolley
      return T(`<g fill="none" stroke="#e2001a" stroke-width="0.5" stroke-linejoin="round">
        <path d="M-2.6,-1.7 h0.9 l1.3,3.2 h2.7"/>
        <path d="M-1.4,-0.9 h3.9 l-0.5,2.0 h-2.6 z" fill="#e2001a" stroke="none"/></g>
        <circle cx="-0.2" cy="2.2" r="0.5" fill="#e2001a"/><circle cx="1.8" cy="2.2" r="0.5" fill="#e2001a"/>`);
    case 'gp':
      return T(`<rect x="-2.1" y="-2.1" width="4.2" height="4.2" rx="0.8" fill="#fff" stroke="#d00" stroke-width="0.5"/>${plus('#d00')}`);
    case 'pharmacy':
      return T(`<rect x="-2.1" y="-2.1" width="4.2" height="4.2" rx="0.8" fill="#fff" stroke="#0a8a3a" stroke-width="0.5"/>${plus('#0a8a3a')}`);
    case 'library': // open book
      return T(`<g fill="#fff" stroke="#8a5a00" stroke-width="0.45" stroke-linejoin="round">
        <path d="M0,-1.5 C-1,-2.1 -2.4,-2.0 -2.4,-1.4 V1.5 C-2.4,1.0 -1,0.9 0,1.5 Z"/>
        <path d="M0,-1.5 C1,-2.1 2.4,-2.0 2.4,-1.4 V1.5 C2.4,1.0 1,0.9 0,1.5 Z"/></g>`);
    case 'museum': // classical building
      return T(`<g fill="#6a3d9a">
        <path d="M0,-2.3 L2.6,-0.7 H-2.6 Z"/>
        <rect x="-2.2" y="-0.5" width="0.6" height="2.3"/><rect x="-0.9" y="-0.5" width="0.6" height="2.3"/>
        <rect x="0.3" y="-0.5" width="0.6" height="2.3"/><rect x="1.6" y="-0.5" width="0.6" height="2.3"/>
        <rect x="-2.6" y="1.8" width="5.2" height="0.7"/></g>`);
    case 'leisure': // running figure
      return T(`<g fill="#ff7f00" stroke="#ff7f00" stroke-width="0.55" stroke-linecap="round">
        <circle cx="0.6" cy="-1.7" r="0.7" stroke="none"/>
        <path d="M-1.2,1.9 L0.2,0.2 L1.4,1.0 M0.2,0.2 L-0.2,-1.0 L1.6,-0.4 M-0.2,-1.0 L-1.6,-0.2"/></g>`);
    case 'school': // mortarboard
      return T(`<g fill="#1f78b4">
        <path d="M0,-1.9 L2.7,-0.6 L0,0.7 L-2.7,-0.6 Z"/>
        <path d="M-1.5,0.0 V1.4 C-1.5,2.0 1.5,2.0 1.5,1.4 V0.0 L0,0.7 Z" opacity="0.85"/>
        <path d="M2.4,-0.45 V1.3" stroke="#1f78b4" stroke-width="0.3"/><circle cx="2.4" cy="1.4" r="0.4"/></g>`);
    case 'park': // tree
      return T(`<rect x="-0.45" y="0.4" width="0.9" height="2.0" fill="#7a4f1d"/>
        <circle cx="0" cy="-0.4" r="1.9" fill="#2ca02c"/><circle cx="-1.2" cy="0.5" r="1.1" fill="#2ca02c"/><circle cx="1.2" cy="0.5" r="1.1" fill="#2ca02c"/>`);
    case 'industrial': // factory
      return T(`<g fill="#777">
        <rect x="1.5" y="-2.3" width="0.8" height="2.0"/>
        <path d="M-2.6,2.2 V-0.3 L-0.7,0.7 V-0.3 L1.1,0.7 V-0.3 L2.6,0.5 V2.2 Z"/></g>`);
    case 'community': // two people
      return T(`<g fill="#00868b">
        <circle cx="-1.1" cy="-1.2" r="0.8"/><path d="M-2.4,2.0 C-2.4,-0.2 0.2,-0.2 0.2,2.0 Z"/>
        <circle cx="1.2" cy="-1.0" r="0.7"/><path d="M0.1,2.0 C0.1,0.1 2.4,0.1 2.4,2.0 Z"/></g>`);
    case 'townhall': // civic building with flag
      return T(`<g fill="#444">
        <rect x="-2.2" y="-0.6" width="4.4" height="3.0"/><path d="M0,-2.6 V-0.6"/>
        <path d="M0,-2.6 L1.4,-2.2 L0,-1.8 Z"/><rect x="-2.6" y="2.2" width="5.2" height="0.5"/></g>`);
    case 'allotments': // bed rows behind a low frame
      return T(`<rect x="-2.2" y="-1.6" width="4.4" height="3.4" rx="0.4" fill="#e8dcc0" stroke="#7a8f3c" stroke-width="0.35"/>
        <path d="M-1.4,-1.0 V1.4 M0,-1.0 V1.4 M1.4,-1.0 V1.4" stroke="#7a8f3c" stroke-width="0.5" fill="none"/>`);
    default:
      return `<circle cx="${x}" cy="${y}" r="${s*0.7}" fill="#888"/>`;
  }
}
module.exports = { icon, inkify, gridGlyph, GRID_COL };
