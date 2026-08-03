// Generates the EXTERNAL place map ("Buses from <place> to ...") as SVG.
// AGGREGATED radial: the PLACE is the hub; each spoke is a REACHABLE DESTINATION
// (a town / interchange / village), not a single route. Every route that gets you
// there rides the one spoke as a row of small badges. This is the place skill's
// answer to "where can I get to from here", vs the town skill's one-spoke-per-route
// external map (gen_external_radial.js, on which the drawing primitives are based).
//
// routes.json contract (place skill):
//   place, placeShort?, validFrom, version, palette{route:hex}, textOn{route:hex},
//   operators:[{name,routes[]}], titleColor?,
//   destinations:[{name, sub?, bearing, routes:[...], side?:'up|down|left|right',
//                  terminus?:{x,y}, limited?:bool}],
//   localLoops?:[{route,label}], note?, stamp?
const fs = require('fs');
const DIR = process.env.LEAFLET_DIR || process.cwd();
const D = JSON.parse(fs.readFileSync(DIR + '/routes.json', 'utf8'));
const C = D.palette, TXT = D.textOn || {};
const BL = D.badgeLabels || {};
const blab = r => (BL[r] != null ? BL[r] : r);
const OVF = process.env.OVERRIDES_FILE || (DIR + '/overrides.json');
const ALLOV = (function () { try { return JSON.parse(fs.readFileSync(OVF, 'utf8')); } catch (e) { return {}; } })();
const OV = ALLOV.external || {};
const RCOL = ALLOV.routeColors || {};
for (const r in RCOL) C[r] = RCOL[r];
// hiddenOperators (opt-in customer edit, top-level overrides.json array of
// routes.json operators[].name) — drop a hidden operator's routes from every
// destination spoke's badge row (dropping the spoke entirely if that empties
// it) and its legend row. Absent/empty => byte-identical.
const HIDDEN_OPS = new Set(ALLOV.hiddenOperators || []);
const HIDDEN_ROUTES = new Set();
if (HIDDEN_OPS.size) (D.operators || []).forEach(op => { if (HIDDEN_OPS.has(op.name)) (op.routes || []).forEach(r => HIDDEN_ROUTES.add(r)); });
const OPS = HIDDEN_OPS.size ? D.operators.filter(op => !HIDDEN_OPS.has(op.name)) : D.operators;
const W = 297, H = 210;
let s = '';
const out = x => { s += x + '\n'; };
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(label, max = 13) {
  if (label.length <= max || label.includes('\n')) return label.split('\n');
  const w = label.split(' '); let a = '', b = '';
  for (const t of w) { if ((a + ' ' + t).trim().length <= max && !b) a = (a + ' ' + t).trim(); else b = (b + ' ' + t).trim(); }
  return b ? [a, b] : [a];
}

// ---- primitives (from gen_external_radial.js) -------------------------------
function line(pts, color, w = 3.4, dashed = false) {
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="1.6 2.2"' : ''}/>`);
}
function badge(x, y, route, r = 4.0) {
  out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${C[route] || '#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${(r * 0.95).toFixed(2)}" fill="${TXT[route] || '#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
}
// timeLabel (optional, e.g. "~18 min") — an extra non-bold line appended after
// any `sub` line, fed by routes.json destinations[].minutesToDestination.
// Absent => box drawn exactly as before (byte-identical for gated places).
function destNode(x, y, label, sub, timeLabel) {
  const lines = wrap(label);
  if (sub) lines.push(sub);
  if (timeLabel) lines.push(timeLabel);
  const w = Math.max(20, Math.max(...lines.map(l => l.length)) * 1.95 + 5);
  const h = 5.4 + lines.length * 3.8;
  out(`<rect x="${(x - w / 2).toFixed(2)}" y="${(y - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="2.4" fill="#2e8b57" stroke="#1d5f3a" stroke-width="0.5"/>`);
  const lh = 3.8, y0 = y - (lines.length - 1) * lh / 2;
  const lastPlain = lines.length - 1;
  const smallFrom = sub && timeLabel ? lastPlain - 1 : lastPlain; // both sub+time are non-bold small lines
  lines.forEach((ln, i) => out(`<text x="${x.toFixed(2)}" y="${(y0 + i * lh).toFixed(2)}" font-family="Arial" font-weight="${i >= smallFrom && (sub || timeLabel) ? 'normal' : 'bold'}" font-size="${i >= smallFrom && (sub || timeLabel) ? 2.9 : 3.4}" fill="${i >= smallFrom && (sub || timeLabel) ? '#d7f0df' : '#fff'}" text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`));
  return w;
}

// ---- canvas -----------------------------------------------------------------
out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
const TITLE_COL = D.titleColor || Object.values(C)[0] || '#444';
out(`<text x="10" y="17" font-family="Arial" font-weight="bold" font-size="11" fill="${TITLE_COL}">Buses from ${esc(D.place)}</text>`);
out(`<text x="10" y="24" font-family="Arial" font-size="5" fill="#444">where you can get to, and which buses take you there (${esc(D.validFrom || 'Summer 2026')})</text>`);
out(`<text x="294" y="150" font-family="Arial" font-size="3.3" fill="#999" text-anchor="end" transform="rotate(-90 294 150)">${esc(D.version || '')} · Summer 2026</text>`);

// ---- hub + aggregated spokes ------------------------------------------------
let HX = 150, HY = 118;
if (OV.hub) { HX = OV.hub.x; HY = OV.hub.y; }
const RECT = { x0: 30, y0: 40, x1: 268, y1: 184 };
function rayToRect(dx, dy) {
  let t = 1e9;
  if (dx > 0) t = Math.min(t, (RECT.x1 - HX) / dx); else if (dx < 0) t = Math.min(t, (RECT.x0 - HX) / dx);
  if (dy > 0) t = Math.min(t, (RECT.y1 - HY) / dy); else if (dy < 0) t = Math.min(t, (RECT.y0 - HY) / dy);
  return t;
}
const dests = HIDDEN_ROUTES.size
  ? (D.destinations || []).map(b => Object.assign({}, b, { routes: (b.routes || []).filter(r => !HIDDEN_ROUTES.has(r)) })).filter(b => b.routes.length)
  : (D.destinations || []);
for (const b of dests) {
  const ov = (OV.branches || {})[b.name] || {};
  const bearing = ov.bearing != null ? ov.bearing : b.bearing;
  let a = bearing * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  let t = rayToRect(dx, dy);
  let tx = HX + dx * t, ty = HY + dy * t;
  if (ov.terminus || b.terminus) { const T = ov.terminus || b.terminus; tx = T.x; ty = T.y; const l = Math.hypot(tx - HX, ty - HY) || 1; dx = (tx - HX) / l; dy = (ty - HY) / l; t = l; }
  const R0 = 16;                                  // clear zone around hub
  // spoke line from hub edge to just short of the destination node
  const nodeGap = 9;
  const ex = HX + dx * (t - nodeGap), ey = HY + dy * (t - nodeGap);
  line([[HX + dx * R0, HY + dy * R0], [ex, ey]], C[b.routes[0]] || '#888', 3.0, b.limited);
  // route badges: a row along the spoke just outside the hub
  const rs = b.routes;
  rs.forEach((r, i) => { const rr = R0 + 4 + i * 7.2; badge(HX + dx * rr, HY + dy * rr, r, 3.4); });
  // destination node
  destNode(tx, ty, b.name, b.sub, b.minutesToDestination!=null?('~'+b.minutesToDestination+' min'):null);
}
// hub node (the place) on top
(function () {
  const label = D.placeShort || D.place;
  const w = Math.max(26, label.length * 2.5 + 8), h = 13;
  out(`<rect x="${(HX - w / 2).toFixed(2)}" y="${(HY - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="2.8" fill="#111" stroke="#000" stroke-width="0.5"/>`);
  out(`<text x="${HX}" y="${(HY - 1.2).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="4.8" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`);
  out(`<text x="${HX}" y="${(HY + 3.4).toFixed(2)}" font-family="Arial" font-size="2.8" fill="#bbb" text-anchor="middle" dominant-baseline="central">you are here</text>`);
})();

// ---- legend + notes (top-left) ----------------------------------------------
let lx = 10, ly = 42;
out(`<text x="${lx}" y="${ly - 4}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Operators &amp; services</text>`);
OPS.forEach((op, i) => {
  const yy = ly + i * 6.6; let bx = lx;
  op.routes.filter(r => !HIDDEN_ROUTES.has(r)).forEach(r => { badge(bx + 3, yy, r, 2.9); bx += 7.0; });
  out(`<text x="${bx + 2}" y="${(yy + 0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
});
let ny = ly + OPS.length * 6.6 + 4;
(D.localLoops || []).forEach(l => {
  badge(lx + 3, ny, l.route, 2.9);
  out(`<text x="${lx + 8}" y="${(ny + 0.2).toFixed(2)}" font-family="Arial" font-size="3.0" fill="#666" dominant-baseline="central">${esc(l.label || 'local circular')}</text>`);
  ny += 6.0;
});
if (D.note) { out(`<text x="${lx}" y="${(ny + 2).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666">${esc(D.note)}</text>`); ny += 5; }
const _hasTimes = dests.some(b=>b.minutesToDestination!=null);
out(`<text x="10" y="203" font-family="Arial" font-size="3.0" fill="#666">Reachable destinations &amp; the routes serving them, from BODS open data cross-checked with operators. One spoke per place; a route may run to more. Confirm live times &amp; fares at bustimes.org or operator apps.${_hasTimes?' Journey times shown are approximate.':''}</text>`);

// Optional "coming soon" / validity stamp (shared shape with the town generators).
function stampNote(cfg, x, y, align) {
  if (!cfg) return;
  const notes = Array.isArray(cfg.notes) ? cfg.notes : (cfg.notes ? [cfg.notes] : []);
  if (!notes.length && !cfg.asOf) return;
  const HS = 3.4, NS = 3.0, AS = 2.6, lh = 3.7, pad = 1.8;
  const rows = []; if (notes.length) rows.push([cfg.heading || 'Coming soon', HS, '#b30000', true]);
  notes.forEach(n => rows.push([n, NS, '#222', false]));
  if (cfg.asOf) rows.push(['Timetable correct as at ' + cfg.asOf, AS, '#666', false]);
  const wmm = Math.max(...rows.map(r => r[0].length * (r[1] * 0.56))) + pad * 2, hmm = pad * 2 + lh * rows.length;
  const bx = align === 'end' ? x - wmm : x, anc = align === 'end' ? 'end' : 'start', tx = align === 'end' ? x - pad : x + pad;
  out(`<rect x="${bx.toFixed(2)}" y="${(y - HS - pad + 0.3).toFixed(2)}" width="${wmm.toFixed(2)}" height="${hmm.toFixed(2)}" rx="1.4" fill="#fff" fill-opacity="0.9" stroke="#b30000" stroke-width="0.4"/>`);
  let cy = y;
  rows.forEach((r, i) => { if (i) cy += lh; out(`<text x="${tx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial"${r[3] ? ' font-weight="bold"' : ''} font-size="${r[1]}" fill="${r[2]}" text-anchor="${anc}">${esc(r[0])}</text>`); });
}
{ const at = (D.stamp && D.stamp.externalAt) || [10, 190]; stampNote(D.stamp, at[0], at[1], 'start'); }

out('</svg>');
fs.writeFileSync(DIR + '/external.svg', s);
console.log('external.svg', s.length, 'bytes;', dests.length, 'destination spokes');
