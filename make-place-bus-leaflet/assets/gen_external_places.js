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
//                  terminus?:{x,y}, limited?:bool, minutesToDestination?:num,
//                  stops?:[...intermediate,terminus] (single-route spokes only,
//                  from derive_stops.py)}],
//   localLoops?:[{route,label}], note?, stamp?
const fs = require('fs');
const path = require('path');
const _FOOTER = (()=>{ const local=path.join(__dirname,'footer.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS,'footer.js');
  const sibling = path.join(__dirname,'..','..','make-bus-leaflet','assets','footer.js');
  try{ if(fs.existsSync(sibling)) return sibling; }catch(e){}
  return 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/footer.js'; })();
const { footerBand } = require(_FOOTER);
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
let out = x => { s += x + '\n'; };   // `let`, not `const`: the legend section below
                                      // redirects it into a buffer so its bounding box
                                      // can be measured before the backing panel is drawn.
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(label, max = 13) {
  if (label.length <= max || label.includes('\n')) return label.split('\n');
  const w = label.split(' '); let a = '', b = '';
  for (const t of w) { if ((a + ' ' + t).trim().length <= max && !b) a = (a + ' ' + t).trim(); else b = (b + ' ' + t).trim(); }
  return b ? [a, b] : [a];
}
// wrapText — generic multi-line word wrap (from gen_external_radial.js), used for the
// free-text note so a long sentence breaks onto further lines instead of running off
// the panel as one unbounded line.
function wrapText(text, maxChars) {
  const words = String(text).split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (cand.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}
// measureText — generous Arial glyph-width estimate (mm), used only to size the auto
// legend backing panel and to pick a word-wrap width; deliberately erring wide so the
// panel never clips its own content.
const measureText = (str, size) => String(str).length * size * 0.58;

// ---- primitives (from gen_external_radial.js) -------------------------------
// dashed (limited-service) spokes use a BUTT cap, not round: a round cap on a dash
// shorter than the stroke width balloons each dash into a near-circle, so the whole
// line reads as a string of blobs rather than a dash (Beaconsfield 380, St Neots 66).
// Butt caps plus a dash length comfortably longer than the stroke width keep each
// dash a crisp rectangle.
function line(pts, color, w = 3.4, dashed = false) {
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  const cap = dashed ? 'butt' : 'round';
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"${dashed ? ' stroke-dasharray="2.6 2.4"' : ''}/>`);
}
function tick(x, y, color) { out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="#fff" stroke="${color}" stroke-width="1.1"/>`); }
function badge(x, y, route, r = 4.0) {
  out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${C[route] || '#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${(r * 0.95).toFixed(2)}" fill="${TXT[route] || '#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
}
// destNodeSize — the terminus-box dimensions, factored out of destNode so the legend's
// collision search (below) can know a node's footprint before anything is drawn.
function destNodeSize(label, sub, timeLabel) {
  const lines = wrap(label);
  if (sub) lines.push(sub);
  if (timeLabel) lines.push(timeLabel);
  const w = Math.max(20, Math.max(...lines.map(l => l.length)) * 1.95 + 5);
  const h = 5.4 + lines.length * 3.8;
  return { w, h, lines };
}
// timeLabel (optional, e.g. "~18 min") — an extra non-bold line appended after
// any `sub` line, fed by routes.json destinations[].minutesToDestination.
// Absent => box drawn exactly as before (byte-identical for gated places).
function destNode(x, y, label, sub, timeLabel) {
  const { w, h, lines } = destNodeSize(label, sub, timeLabel);
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

// ---- hub + aggregated spokes ------------------------------------------------
let HX = 150, HY = 118;
if (OV.hub) { HX = OV.hub.x; HY = OV.hub.y; }
const RECT = { x0: 30, y0: 40, x1: 268, y1: 184 };
// Hub box is drawn LAST (on top of the spokes/badges) so it always reads cleanly, but that
// means a long place name's box can grow past the fixed 16mm clear zone and cover the route
// badges parked just outside it — the "bubbles overwritten by the central label" defect. Size
// the hub box up front so the clear zone (and the first badge ring) always sits outside it.
const HUB_LABEL = D.placeShort || D.place;
const HUB_W = Math.max(26, measureText(HUB_LABEL, 4.8) + 8), HUB_H = 13;
// hubEdge — the earlier fixed-circle clear zone bound EVERY spoke to the same radius no
// matter its bearing, so a long/thin label (e.g. two-word place names) left visible gaps
// on spokes leaving from top/bottom while barely clearing the label on spokes leaving from
// the sides. Fit an ellipse to the label's actual measured half-width/half-height instead,
// and solve r(theta) = 1/sqrt((cos/a)^2+(sin/b)^2) for the direction each spoke actually
// travels, so every spoke starts just outside the label box regardless of its angle.
const HUB_A = HUB_W / 2 + 3, HUB_B = HUB_H / 2 + 3;
function hubEdge(dx, dy) {
  const denom = Math.sqrt((dx * dx) / (HUB_A * HUB_A) + (dy * dy) / (HUB_B * HUB_B));
  return denom > 0 ? Math.max(16, 1 / denom) : Math.max(16, HUB_A, HUB_B);
}
function rayToRect(dx, dy) {
  let t = 1e9;
  if (dx > 0) t = Math.min(t, (RECT.x1 - HX) / dx); else if (dx < 0) t = Math.min(t, (RECT.x0 - HX) / dx);
  if (dy > 0) t = Math.min(t, (RECT.y1 - HY) / dy); else if (dy < 0) t = Math.min(t, (RECT.y0 - HY) / dy);
  return t;
}
const dests = HIDDEN_ROUTES.size
  ? (D.destinations || []).map(b => Object.assign({}, b, { routes: (b.routes || []).filter(r => !HIDDEN_ROUTES.has(r)) })).filter(b => b.routes.length)
  : (D.destinations || []);
// nodeBoxes — every destination node's + the hub's own footprint, gathered as the spokes
// are laid out, so the legend panel (drawn later) can be placed somewhere that avoids all
// of them instead of risking landing on top of one (see legend section below). spokeSegs —
// each spoke's own line segment, gathered the same way: a panel is free to cross a spoke
// (it's opaque, so a crossing line just gets tidied up, same as gen_external_radial.js),
// but for a busy hub with spokes fanning in every direction that's a secondary concern —
// prefer a placement with zero crossings, and only accept crossings when no clear spot
// exists at all (a spoke line cut off mid-flight by the panel's edge reads worse than one
// discreetly hidden behind it).
const nodeBoxes = [{ x0: HX - HUB_W / 2, y0: HY - HUB_H / 2, x1: HX + HUB_W / 2, y1: HY + HUB_H / 2 }];
const spokeSegs = [];
for (const b of dests) {
  const ov = (OV.branches || {})[b.name] || {};
  const bearing = ov.bearing != null ? ov.bearing : b.bearing;
  let a = bearing * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  let t = rayToRect(dx, dy);
  let tx = HX + dx * t, ty = HY + dy * t;
  if (ov.terminus || b.terminus) { const T = ov.terminus || b.terminus; tx = T.x; ty = T.y; const l = Math.hypot(tx - HX, ty - HY) || 1; dx = (tx - HX) / l; dy = (ty - HY) / l; t = l; }
  const r0 = hubEdge(dx, dy);   // this spoke's own clear-zone edge (ellipse-fitted, not a flat circle)
  // spoke line from hub edge to just short of the destination node
  const nodeGap = 9;
  const ex = HX + dx * (t - nodeGap), ey = HY + dy * (t - nodeGap);
  spokeSegs.push({ x1: HX + dx * r0, y1: HY + dy * r0, x2: ex, y2: ey });
  line([[HX + dx * r0, HY + dy * r0], [ex, ey]], C[b.routes[0]] || '#888', 3.0, b.limited);
  // intermediate-stop ticks (from gen_external_radial.js): only for a SINGLE-route
  // spoke with a b.stops[] chain (derive_stops.py) -- a multi-route spoke has no one
  // unambiguous stop sequence to hang labels off (see file-header comment).
  // Drawn AFTER the spoke line (not before) so the line doesn't paint over the
  // ticks -- matches gen_external_radial.js's order.
  const stops = (b.routes.length === 1 && Array.isArray(b.stops)) ? b.stops : null;
  if (stops && stops.length) {
    const n = stops.length;
    const px = -dy, py = dx;   // unit perpendicular (left of travel)
    let perpx = px, perpy = py;
    const side = b.side;
    if (side === 'up' && perpy > 0) { perpx *= -1; perpy *= -1; }
    if (side === 'down' && perpy < 0) { perpx *= -1; perpy *= -1; }
    if (side === 'left' && perpx > 0) { perpx *= -1; perpy *= -1; }
    if (side === 'right' && perpx < 0) { perpx *= -1; perpy *= -1; }
    const labSide = perpx < 0 ? 'end' : 'start';
    const span = (t - nodeGap) - r0;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, r = r0 + span * f;
      const x = HX + dx * r, y = HY + dy * r;
      if (i === n - 1) continue;   // last entry is the terminus itself; node drawn separately
      tick(x, y, C[b.routes[0]] || '#888');
      const lx = x + perpx * 5.2, ly = y + perpy * 5.2 + 0.9;
      out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="2.9" fill="#222" text-anchor="${labSide}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(stops[i])}</text>`);
      // Claim this label's footprint as a hard no-go for the legend panel (below), same as a
      // destination node -- the panel is opaque, so landing on tick-label text makes it
      // unreadable, not just "a line tidied up behind it" (which spokeSegs tolerates).
      const lw = measureText(stops[i], 2.9);
      nodeBoxes.push(labSide === 'end'
        ? { x0: lx - lw, y0: ly - 2.6, x1: lx, y1: ly + 1.0 }
        : { x0: lx, y0: ly - 2.6, x1: lx + lw, y1: ly + 1.0 });
    }
  }
  // route badges: a row along the spoke just outside the hub
  const rs = b.routes;
  rs.forEach((r, i) => { const rr = r0 + 4 + i * 7.2; badge(HX + dx * rr, HY + dy * rr, r, 3.4); });
  // destination node
  const _timeLabel = b.minutesToDestination != null ? ('~' + b.minutesToDestination + ' min') : null;
  const _size = destNodeSize(b.name, b.sub, _timeLabel);
  nodeBoxes.push({ x0: tx - _size.w / 2, y0: ty - _size.h / 2, x1: tx + _size.w / 2, y1: ty + _size.h / 2 });
  destNode(tx, ty, b.name, b.sub, _timeLabel);
}
// hub node (the place) on top
(function () {
  const w = HUB_W, h = HUB_H;
  out(`<rect x="${(HX - w / 2).toFixed(2)}" y="${(HY - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="2.8" fill="#111" stroke="#000" stroke-width="0.5"/>`);
  out(`<text x="${HX}" y="${(HY - 1.2).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="4.8" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(HUB_LABEL)}</text>`);
  out(`<text x="${HX}" y="${(HY + 3.4).toFixed(2)}" font-family="Arial" font-size="2.8" fill="#bbb" text-anchor="middle" dominant-baseline="central">you are here</text>`);
})();

// ---- legend + notes -----------------------------------------------------------
// Auto backing panel (from gen_external_radial.js): the legend + its note is drawn into
// a buffer first so its bounding box can be measured, then an opaque panel is emitted
// UNDER it and both are flushed on top of the spokes — otherwise a spoke that happens to
// pass under the panel's sector shows through and the badges/route lines visually
// collide with the text.
// buildLegend(lx,ly) draws (into a buffer) the operators list + local loops + note at a
// given top-left corner and reports the panel size it needed. The size is independent of
// (lx,ly) — every offset inside is relative — so it can be called once to measure and
// again, after a placement is chosen, to actually draw.
function buildLegend(lx, ly) {
  const buf = [];
  const realOut = out;
  out = x => buf.push(x);
  let panelMaxX = lx, panelMaxY = ly - 4;
  out(`<text x="${lx}" y="${ly - 4}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Operators &amp; services</text>`);
  panelMaxX = Math.max(panelMaxX, lx + measureText('Operators & services', 4.4));
  OPS.forEach((op, i) => {
    const yy = ly + i * 6.6; let bx = lx;
    op.routes.filter(r => !HIDDEN_ROUTES.has(r)).forEach(r => { badge(bx + 3, yy, r, 2.9); bx += 7.0; });
    out(`<text x="${bx + 2}" y="${(yy + 0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
    panelMaxX = Math.max(panelMaxX, bx + 2 + measureText(op.name, 3.4));
    panelMaxY = Math.max(panelMaxY, yy + 3);
  });
  let ny = ly + OPS.length * 6.6 + 4;
  (D.localLoops || []).forEach(l => {
    badge(lx + 3, ny, l.route, 2.9);
    const _loopLabel = l.label || 'local circular';
    out(`<text x="${lx + 8}" y="${(ny + 0.2).toFixed(2)}" font-family="Arial" font-size="3.0" fill="#666" dominant-baseline="central">${esc(_loopLabel)}</text>`);
    panelMaxX = Math.max(panelMaxX, lx + 8 + measureText(_loopLabel, 3.0));
    panelMaxY = Math.max(panelMaxY, ny + 3);
    ny += 6.0;
  });
  // D.note — word-wrapped to the legend panel's own content width, so a long note breaks
  // onto further lines instead of running off the panel as one unbounded line.
  if (D.note) {
    const _panelW = Math.max(panelMaxX - lx, 100);
    const _maxChars = Math.max(20, Math.floor(_panelW / (2.9 * 0.58)));
    const _noteLines = wrapText(D.note, _maxChars);
    _noteLines.forEach((ln, i) => out(`<text x="${lx}" y="${(ny + 2 + i * 3.6).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666">${esc(ln)}</text>`));
    panelMaxX = Math.max(panelMaxX, lx + Math.max(..._noteLines.map(ln => measureText(ln, 2.9))));
    panelMaxY = Math.max(panelMaxY, ny + 2 + (_noteLines.length - 1) * 3.6 + 2);
  }
  out = realOut;
  return { buf, bw: panelMaxX - lx + 8, bh: panelMaxY - (ly - 10) + 4 };
}
const { bw, bh } = buildLegend(10, 42);   // measure only; discard this buffer
// Placement search: legendAt is an explicit hand-tuned escape hatch (as in
// gen_external_radial.js); absent that, walk a grid and score every candidate that clears
// every destination/hub node (a hard constraint — the panel is opaque, so overlapping a
// node would fully hide it, not just tidy up a crossing spoke) by how many spoke LINES it
// crosses, and keep the lowest-scoring one (ties broken toward the default top-left). A
// spoke is allowed to run under the panel — same as gen_external_radial.js — but for a busy
// hub with spokes fanning in every direction, minimising crossings still matters: a line
// clipped mid-flight by the panel's edge (High Wycombe Aldi, 14 spokes) reads worse than
// one fully hidden behind it.
function overlaps(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
function segRectHit(x1, y1, x2, y2, r) {
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const cross = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const edges = [[r.x0, r.y0, r.x1, r.y0], [r.x1, r.y0, r.x1, r.y1], [r.x1, r.y1, r.x0, r.y1], [r.x0, r.y1, r.x0, r.y0]];
  return edges.some(([ax, ay, bx, by]) => cross(x1, y1, x2, y2, ax, ay, bx, by));
}
function legendCandidate(lx, ly) {
  const box = { x0: lx - 4, y0: ly - 10, x1: lx - 4 + bw, y1: ly - 10 + bh };
  if (box.x0 < 4 || box.y0 < 27 || box.x1 > W - 4 || box.y1 > 186) return null;
  if (nodeBoxes.some(nb => overlaps(box, nb))) return null;
  const crossings = spokeSegs.filter(s => segRectHit(s.x1, s.y1, s.x2, s.y2, box)).length;
  return { lx, ly, crossings };
}
let lx = 10, ly = 42;
if (D.legendAt && (D.legendAt.x != null || D.legendAt.y != null)) {
  if (D.legendAt.x != null) lx = D.legendAt.x;
  if (D.legendAt.y != null) ly = D.legendAt.y;
} else {
  let best = legendCandidate(lx, ly);
  for (let cy = 42; cy <= 165 && (!best || best.crossings > 0); cy += 6) {
    for (let cx = 10; cx <= 200 && (!best || best.crossings > 0); cx += 10) {
      const cand = legendCandidate(cx, cy);
      if (cand && (!best || cand.crossings < best.crossings)) best = cand;
    }
  }
  if (best) { lx = best.lx; ly = best.ly; }
}
const legend = buildLegend(lx, ly);
out(`<rect x="${(lx - 4).toFixed(2)}" y="${(ly - 10).toFixed(2)}" width="${legend.bw.toFixed(2)}" height="${legend.bh.toFixed(2)}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`);
legend.buf.forEach(out);
const _hasTimes = dests.some(b=>b.minutesToDestination!=null);
out(footerBand({
  notes: `Reachable destinations & routes serving them, from BODS open data cross-checked with operators. Confirm live times & fares at bustimes.org or operator apps.${_hasTimes?' Journey times shown are approximate.':''}`,
  version: D.version, validFrom: D.validFrom || 'Summer 2026'
}));

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
