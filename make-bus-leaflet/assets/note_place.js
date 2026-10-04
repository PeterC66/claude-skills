/*
 * note_place.js — a mapNotes entry that finds its own clear ground (buses-data OA-437, A1).
 *
 * WHY. A `mapNotes` entry has always been placed by a typed coordinate: `x`, `y`, and
 * since OA-181 a `w` to say where it wraps. Sixteen of them are hand-set across the
 * estate, every one tuned against the CURRENT geometry, so one composition change
 * invalidates all of them at once — the same trap design.legendPlace closed for the
 * external legend and placePointer closed for the red arrow. This is that idea for a
 * note: say WHAT it says (and, if you care, roughly where), and the engine finds a spot.
 *
 * THE RULE. A note with an `x` or a `y` (or an `at` stop) is the author's decision and
 * is not touched here — byte-identical for every map stored today, which is why this
 * is a new module and not an edit to the loop. A note with none of them is searched:
 *
 *   - widest wrap first. A wider note is fewer lines and a shorter box, and a short
 *     box fits in more places, so the first width that finds a clear spot is the best
 *     one. Widths are tried from `w` (or 120 mm) down in 20 mm steps to 40 mm.
 *   - the lines wrap by MEASURED width (font_metrics.js), not by a character count.
 *   - a spot is clear when no reserved box touches it (the panel, the footer plate,
 *     a symbol, another note — `overlaps`) and no route ink is under it (`inkCover`
 *     is exactly 0). A note is a few words; it is never worth hiding a line for.
 *   - among clear spots the one nearest `near` ({x,y}, mm) wins, so a town can still
 *     say "down by the station" without a coordinate that has to be exact; with no
 *     hint it is the bottom-left of the frame, where these notes have always lived.
 *
 * WHEN IT RUNS. Not in the claim phase where hand-placed notes are reserved: the river and the exit
 * captions do not exist yet, and a note searched there landed on both (St Ives, first probe). It runs
 * after the label solve — see placeSearchedNotes — beside the compass's second look.
 *
 * NOWHERE CLEAR returns null. The caller draws the note at the hint and the existing
 * "drawn across ..." warning names what it covers: dropping a note silently is worse
 * than a note over a road, because the reader loses a fact with nothing to say so.
 */
'use strict';

const WIDTHS_FROM = 120, WIDTHS_TO = 40, WIDTHS_STEP = 20;
const NL = String.fromCharCode(10);
const PARA_GAP = 1.6;   // extra space before a `then` paragraph, mm: the hand-set blocks leave 5.4 against a 3.8 line pitch
const PAD = 1.2;     // clearance kept round every line, mm: a note touching a badge reads as part of it

/*
 * noteInk(svg, ir, Labeller) -> (box) => fraction of the box on anything drawn.
 * Broader than place_pointer's route-only probe, on purpose: a note parked on the river or
 * a railway reads as a label for it. The same occupancy gen_internal's spotSearch uses for the
 * compass and scale bar, bar the two pale road tiers, which cover the sheet and leave nowhere.
 */
function noteInk(svg, ir, Labeller) {
  const pale = new Set([(ir && ir.skeleton) || '#e4e4e4', (ir && ir.contextColor) || '#f0f0f0'].map(v => String(v).toLowerCase()));
  const L = new Labeller({ page: [297, 210] });
  L.stampSvg(svg, (stroke, w) => w >= 1.2 && stroke !== 'none' && !pale.has(stroke) && stroke !== '#fff' && stroke !== '#ffffff');
  return (b) => L.ink.cover(b);
}

// Greedy wrap by measured width: a word that does not fit starts the next line.
function wrapMeasured(text, width, measure) {
  const lines = []; let cur = '';
  for (const wd of String(text).split(' ')) {
    const next = cur ? cur + ' ' + wd : wd;
    if (cur && measure(next) > width) { lines.push(cur); cur = wd; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/*
 * placeNote(deps) -> { x, y, lines, width, boxes } | null
 *   text, size, lineGap  as mapNotes draws them
 *   w                    optional widest wrap, mm
 *   near                 optional { x, y } preference, mm
 *   frame                { x0, y0, x1, y1 } the map frame
 *   footerTop            y where the footer plate starts
 *   measure(line, size)  advance width in mm
 *   overlaps(box)        does the box touch reserved space
 *   inkCover(box)        fraction of the box on route ink
 *   step                 grid step in mm (default 1)
 * `boxes` is one claim per line, the shape mapNotes reserves.
 */
function placeNote(d) {
  const sz = d.size, step = d.step || 1;
  const top = d.frame.y0 + 1, bottomLimit = Math.min(d.frame.y1 - 1, d.footerTop - 2);
  const left = d.frame.x0 + 1, right = d.frame.x1 - 1;
  const near = d.near || { x: left, y: bottomLimit };
  const widest = d.w != null ? d.w : WIDTHS_FROM;
  const widths = [];
  for (let w = widest; w >= Math.min(WIDTHS_TO, widest); w -= WIDTHS_STEP) widths.push(w);
  if (!widths.length) widths.push(widest);
  const seen = new Set();
  for (const width of widths) {
    const rows = layoutRows(d, width);
    const key = rows.map(r => r.ln).join(NL);
    if (seen.has(key)) continue;          // a narrower width that wraps the same way finds the same spots
    seen.add(key);
    const ws = rows.map(r => d.measure(r.ln, r.size));
    const maxW = Math.max(...ws);
    const height = rows[rows.length - 1].dy;
    let best = null;
    for (let y = top + sz; y + height + 1 <= bottomLimit; y += step) {
      for (let x = left; x + maxW <= right; x += step) {
        const dist = Math.hypot(x - near.x, y - near.y);
        if (best && dist >= best.dist) continue;
        const boxes = rows.map((r, i) => {
          const ly = y + r.dy;
          return [x - 0.4, ly - r.size, x + ws[i] + 0.4, ly + 1];
        });
        if (boxes.some(b => { const t = [b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD]; return d.overlaps(t) || d.inkCover(t) > 0; })) continue;
        best = { x, y, dist, boxes };
      }
    }
    if (best) return { x: best.x, y: best.y, lines: rows.map(r => r.ln), rows, width, boxes: best.boxes };
  }
  return null;
}

/*
 * layoutRows(d, width) -> [{ ln, size, color, dy }], one per drawn line.
 * A note is a paragraph; `then` (OA-437 C4) adds paragraphs that are placed with it as ONE
 * block, because a heading and the lines under it that land in different corners say nothing.
 * Each paragraph wraps by measured width at its own size; `dy` is the line's offset from the
 * block's first baseline, and a new paragraph opens a further PARA_GAP below the last line.
 * With no `then` the offsets are i * lineGap, exactly what a single note has always drawn.
 */
function layoutRows(d, width) {
  const paras = [{ text: d.text, size: d.size, lineGap: d.lineGap, color: d.color }]
    .concat((d.then || []).map(p => ({ text: p.text, size: p.size || d.size, lineGap: p.lineGap || (p.size || d.size) * 1.35, color: p.color || d.color })));
  const rows = [];
  paras.forEach(p => {
    const base = rows.length ? rows[rows.length - 1].dy + p.lineGap + PARA_GAP : 0;   // i * lineGap for the first, as ever
    wrapMeasured(p.text, width, ln => d.measure(ln, p.size)).forEach((ln, i) => {
      rows.push({ ln, size: p.size, color: p.color, dy: base + i * p.lineGap });
    });
  });
  return rows;
}

/*
 * placeSearchedNotes(deps) -> [svg <text> strings]
 * Run AFTER the label solve, with the SVG so far, because a searched note has to see what a claim-phase
 * note cannot: the river, the exit captions and every placed label (`labelBoxes`, vetoed like the
 * compass's second look). Each note is reserved as it lands so the next one and every later pass
 * (the place index) keep clear of it. Needs the v2 label engine, as the compass resite does.
 */
function placeSearchedNotes(d) {
  const hit = (b, o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]);
  const out = [];
  let ink = null;
  for (const n of d.notes) {
    const sz = n.size || 2.4, lineGap = n.lineGap || sz * 1.35;
    const nm = 'mapNotes: "' + String(n.text).slice(0, 40) + (n.text.length > 40 ? '…' : '') + '" ';
    const got = placeNote({
      text: n.text, size: sz, lineGap, color: n.color || '#333', then: n.then, w: n.w, near: n.near, frame: d.frame, footerTop: d.footerTop, measure: d.measure,
      overlaps: b => d.overlaps(b) || d.labelBoxes.some(o => hit(b, o)),
      inkCover: b => (ink = ink || noteInk(d.svg, d.IR, d.Labeller))(b),
    });
    let x, y, rows, boxes;
    if (got) {
      ({ x, y, rows, boxes } = got);
      d.warn(nm + 'placed by search at ' + x.toFixed(1) + ',' + y.toFixed(1) + ' (' + rows.length + ' line' + (rows.length > 1 ? 's' : '') + ', ' + got.width + ' mm wrap).' + NL);
    } else {
      // Drawn at the hint rather than dropped: the reader loses a fact otherwise, with nothing to say so.
      x = n.near ? n.near.x : d.frame.x0 + 1; y = n.near ? n.near.y : d.footerTop - 2;
      rows = layoutRows({ text: n.text, size: sz, lineGap, color: n.color || '#333', then: n.then, measure: d.measure }, n.w != null ? n.w : WIDTHS_FROM);
      boxes = rows.map(r => [x - 0.4, y + r.dy - r.size, x + d.measure(r.ln, r.size) + 0.4, y + r.dy + 1]);
      d.warn(nm + 'has no clear ground on this sheet, so it is drawn at ' + x.toFixed(1) + ',' + y.toFixed(1) + ' over whatever is there. Shorten it, or give it x and y.' + NL);
    }
    rows.forEach((r, i) => {
      d.reserve(boxes[i][0], boxes[i][1], boxes[i][2], boxes[i][3], 'a map note');
      out.push(`<text x="${x.toFixed(2)}" y="${(y + r.dy).toFixed(2)}" font-family="Arial" font-size="${r.size}" font-style="italic" fill="${r.color}" text-anchor="start" stroke="#fff" stroke-width="0.7" paint-order="stroke">${d.esc(r.ln)}</text>`);
    });
  }
  return out;
}

module.exports = { placeNote, wrapMeasured, noteInk, placeSearchedNotes };
