/*
 * labeller.js — the shared label placer for every generator that draws a map.
 *
 * WHY THIS EXISTS. Until 2026-08-15 there were three independent label placers —
 * gen_internal.js's POI/terminus placer, its road-name placer, and
 * gen_external_radial.js's spider-stop placer, the last with no collision
 * detection at all — and between them they knew about one thing: the boxes other
 * labels had already claimed. Route ribbons, the river, the railway, POI icons,
 * route badges and the footer plate were all invisible to them, so a label
 * printed across a coloured ribbon was not a bug in the checker; the checker
 * believed that space was empty. The measured cost, over the 31 shipped sheets:
 * 244 point labels sitting on route ink, 190 sitting on a symbol that is not
 * their own, and an unknown number dropped silently because the first eight
 * candidate offsets happened to be taken (see quality-baseline-scorecard).
 *
 * WHAT IT DOES DIFFERENTLY.
 *  - One occupancy grid (0.5 mm cells) that every kind of ink stamps into, so
 *    "is this space free?" is asked of the drawing, not of a list of text boxes.
 *  - Real Arial advance widths (font_metrics.js) instead of length*size*0.52,
 *    which over-estimates a typical name by ~11% and so refuses space that would
 *    have fitted.
 *  - Candidates are SCORED, not first-fit: ink covered, obstacles, cartographic
 *    preference (E, W, NE, SE, ...), distance from its own symbol, and distance
 *    to the nearest OTHER symbol — that last term is what stops a label reading
 *    as though it belongs to the thing next door.
 *  - A relaxation pass, so an early greedy choice that boxes in a later label
 *    can be revisited. This is the step that makes a sheet look placed rather
 *    than merely legal.
 *  - Two-line wrapping, then a leader line, before ever giving up. Anything that
 *    still cannot be placed is REPORTED (`unplaced()`), because today a dropped
 *    label leaves no trace in the SVG at all and we have no idea how much the
 *    maps are failing to say.
 *  - And then, since 2026-08-30, offered a NUMBER instead of its name
 *    (`indexPass()`, OA-078). A name that needs 84 mm and a number that needs 2.6
 *    do not fail on the same sheet, so most of what the placer drops can still be
 *    identified — by an ordinal on the map and a line in an index the caller
 *    prints. `stillUnplaced()` is what is left after both passes.
 *
 * Invariants (changing-the-engine.md §1): zero dependencies beyond
 * font_metrics.js, no network, no filesystem reads, no Math.random, no Date, no
 * locale- or iteration-order dependence — every loop below runs over an array in
 * insertion order and every tie breaks on a stable key. Same input, same bytes.
 *
 * Phase 2 of Development Docs/label-and-design-quality-plan_2026-08-15.md.
 */
'use strict';
const path = require('path');
const FM = require(path.join(__dirname, 'font_metrics.js'));

// ---------------------------------------------------------------- defaults
// One object, so tuning is a one-line edit and a diff shows what moved.
const DEFAULTS = {
  cell: 0.5,               // mm, occupancy grid resolution
  pad: 0.45,               // mm, halo padding added around every label box
  gap: 2.6,                // mm, nominal distance from the anchor to the label
  wInk: 34,                // cost per unit of ink-coverage fraction
  wPos: 1.0,               // cost per step down the compass preference order
  wDist: 0.55,             // cost per mm beyond the nominal gap
  wAmbig: 9,               // cost for sitting nearer a foreign anchor than its own
  wPrefer: 2.5,             // cost of ignoring a caller's preferred DIRECTION (`prefer`).
                           // Above wPos (1.0 per step down the compass order), so a
                           // stated side beats cartographic habit when both are free,
                           // and below what a fifth of a box of route ink costs
                           // (0.2 x wInk 34 = 6.8), so a spoke label still crosses to
                           // the clear side rather than sitting on the line.
  wWrap: 2.2,              // cost of needing a second line
  wLeader: 14,             // cost of needing a leader line
  wFrame: 6,               // cost per mm of the box outside the soft frame
  ambigRatio: 1.0,         // "nearer a foreign anchor" threshold (ratio of distances)
  maxLineMm: 34,           // above this a one-line label is a candidate for wrapping
  leaderMax: 11,           // mm, longest leader line we will draw
  relaxSweeps: 3,          // hill-climbing sweeps after the greedy pass
  inkFatal: 0.55,          // coverage above this is never acceptable, at any cost
  wHard: 120,              // cost of a mustPlace label overlapping a reserved symbol
  wOffDevice: 40,          // cost of leaving an `only` shortlist. Deliberately above
                           // the worst a shortlist position can cost (inkFatal 0.55
                           // x wInk 34 = 18.7), so the device holds unless every one
                           // of its positions is genuinely unusable — and below
                           // wHard, because a destination is never dropped for it.
};

// Compass offsets, in the cartographic preference order the textbooks give:
// right of the symbol first, then left, then the diagonals, then above/below.
// dx/dy are multiples of `gap`; `anc` is the SVG text-anchor that keeps the box
// on the correct side of the point.
const POSITIONS = [
  { k: 'E',  dx:  1.00, dy:  0.35, anc: 'start'  },
  { k: 'W',  dx: -1.00, dy:  0.35, anc: 'end'    },
  { k: 'NE', dx:  1.00, dy: -0.85, anc: 'start'  },
  { k: 'SE', dx:  1.00, dy:  1.30, anc: 'start'  },
  { k: 'NW', dx: -1.00, dy: -0.85, anc: 'end'    },
  { k: 'SW', dx: -1.00, dy:  1.30, anc: 'end'    },
  { k: 'N',  dx:  0.00, dy: -1.00, anc: 'middle' },
  { k: 'S',  dx:  0.00, dy:  1.38, anc: 'middle' },
];

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// ------------------------------------------------------------------- grid
// Two grids, deliberately: `ink` is drawing a label may sit on if it must (a
// route ribbon — ugly, costed, sometimes unavoidable), `hard` is space a label
// may never enter (the services panel, the footer plate, another label). Mixing
// them was what made the old placer either too permissive or too brittle.
class Grid {
  constructor(w, h, cell) {
    this.cell = cell;
    this.nx = Math.ceil(w / cell); this.ny = Math.ceil(h / cell);
    this.a = new Uint8Array(this.nx * this.ny);
  }
  ix(x) { return Math.round(x / this.cell); }
  set(x0, y0, x1, y1) {
    const gx0 = clamp(Math.floor(x0 / this.cell), 0, this.nx - 1);
    const gx1 = clamp(Math.ceil(x1 / this.cell), 0, this.nx - 1);
    const gy0 = clamp(Math.floor(y0 / this.cell), 0, this.ny - 1);
    const gy1 = clamp(Math.ceil(y1 / this.cell), 0, this.ny - 1);
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) this.a[y * this.nx + x] = 1;
  }
  seg(p0, p1, w) {
    const half = Math.max(w, this.cell) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const x = p0[0] + (p1[0] - p0[0]) * s / steps, y = p0[1] + (p1[1] - p0[1]) * s / steps;
      this.set(x - half, y - half, x + half, y + half);
    }
  }
  // Fraction of a box's cells that are set. The box is in mm.
  cover(b) {
    const gx0 = clamp(Math.floor(b[0] / this.cell), 0, this.nx - 1);
    const gx1 = clamp(Math.ceil(b[2] / this.cell), 0, this.nx - 1);
    const gy0 = clamp(Math.floor(b[1] / this.cell), 0, this.ny - 1);
    const gy1 = clamp(Math.ceil(b[3] / this.cell), 0, this.ny - 1);
    let tot = 0, hit = 0;
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) { tot++; if (this.a[y * this.nx + x]) hit++; }
    return tot ? hit / tot : 0;
  }
  any(b) {
    const gx0 = clamp(Math.floor(b[0] / this.cell), 0, this.nx - 1);
    const gx1 = clamp(Math.ceil(b[2] / this.cell), 0, this.nx - 1);
    const gy0 = clamp(Math.floor(b[1] / this.cell), 0, this.ny - 1);
    const gy1 = clamp(Math.ceil(b[3] / this.cell), 0, this.ny - 1);
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) if (this.a[y * this.nx + x]) return true;
    return false;
  }
}

const boxesHit = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
// Does a segment pass through a box? (Liang–Barsky, reduced to a yes/no.)
function segHitsBox([p0, p1], b) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, p0[0] - b[0]], [dx, b[2] - p0[0]], [-dy, p0[1] - b[1]], [dy, b[3] - p0[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

// --------------------------------------------------------------- Labeller
class Labeller {
  constructor(opt = {}) {
    this.o = Object.assign({}, DEFAULTS, opt);
    this.page = opt.page || [297, 210];
    // The soft frame is where labels BELONG. Straying outside is costed, not
    // forbidden, because a name at the very edge of the map is often right.
    this.frame = opt.frame || { x0: 0, y0: 0, x1: this.page[0], y1: this.page[1] };
    // `bounds` is the HARD limit — the page, minus whatever column the sheet reserves
    // for its services panel. Straying past the soft frame is costed; straying past
    // this is refused, because a label half off the paper is not a placement.
    this.bounds = opt.bounds || null;
    this.ink = new Grid(this.page[0], this.page[1], this.o.cell);
    this.hard = new Grid(this.page[0], this.page[1], this.o.cell);
    this.blocks = [];        // hard boxes, kept as boxes too so we can name what blocked what
    this.anchors = [];       // every symbol on the sheet: [x, y, id]
    this.items = [];
    this.placedBoxes = [];   // boxes claimed by labels already positioned
    this._solved = null;
  }

  // ---- feeding the grids ------------------------------------------------
  stampSeg(p0, p1, width) { this.ink.seg(p0, p1, width); return this; }
  stampBox(b) { this.ink.set(b[0], b[1], b[2], b[3]); return this; }
  // A hard obstacle: the services panel, the title block, the footer plate, the
  // core box, a route badge, a POI symbol. Nothing may be printed here.
  block(b, tag) { this.hard.set(b[0], b[1], b[2], b[3]); this.blocks.push({ b, tag: tag || '' }); return this; }
  // Every symbol on the sheet, whether or not it carries a label. Used for the
  // "is this label nearer someone else's symbol than its own?" term.
  anchor(x, y, id) { this.anchors.push([x, y, id == null ? '' : id]); return this; }

  /*
   * stampSvg — take the ink straight off the drawing.
   *
   * The alternative is for each generator to remember to stamp every polyline it
   * emits, which is exactly the kind of parallel bookkeeping that rots: the
   * corridor-bundling pass, the casing pass and the schematic pre-stage all draw
   * lines, and one of them forgetting would put the placer quietly back to
   * guessing. Reading the SVG the generator has already produced cannot drift
   * from it. `isInk(stroke, width)` decides what counts; gen_internal passes its
   * own route palette.
   */
  stampSvg(svg, isInk) {
    for (const m of String(svg).matchAll(/<(path|line)\b([^>]*)>/g)) {
      const raw = m[2];
      const at = (k) => { const r = raw.match(new RegExp(k + '="([^"]*)"')); return r ? r[1] : null; };
      const stroke = (at('stroke') || 'none').toLowerCase();
      const w = parseFloat(at('stroke-width') || '0') || 0;
      if (!isInk(stroke, w)) continue;
      if (m[1] === 'line') {
        this.ink.seg([+at('x1') || 0, +at('y1') || 0], [+at('x2') || 0, +at('y2') || 0], w);
        continue;
      }
      const d = at('d'); if (!d) continue;
      let cur = null;
      for (const t of d.matchAll(/([MLZ])\s*(-?[\d.]+)?[\s,]*(-?[\d.]+)?/g)) {
        if (t[1] === 'Z') { cur = null; continue; }
        const p = [+t[2], +t[3]];
        if (isNaN(p[0]) || isNaN(p[1])) continue;
        if (cur && t[1] === 'L') this.ink.seg(cur, p, w);
        cur = p;
      }
    }
    return this;
  }

  /*
   * add — request a label.
   *   id        stable key, used for tie-breaks and for the unplaced report
   *   at        [x, y] the point being named
   *   text      the string
   *   size      mm
   *   priority  higher goes first and gets the better spots (default 0)
   *   own       [x0,y0,x1,y1] this label's OWN symbol, exempt from the hard grid
   *   fixed     {x, y, anchor} skip placement entirely (a hand-placed override)
   *   prefer    [dx, dy] the direction the caller would rather the label sat in.
 *             Costed at wPrefer, not enforced — see _preference().
 *   wrap      false to forbid the two-line form
   *   leader    false to forbid a leader line
   *   bold/italic/fill/halo  passed straight back out for rendering
   */
  add(req) {
    const it = Object.assign({ priority: 0, size: 2.5, wrap: true, leader: true }, req);
    it.id = it.id != null ? String(it.id) : 'L' + this.items.length;
    it.seq = this.items.length;
    this.items.push(it);
    if (it.at && it.countAsAnchor !== false) this.anchor(it.at[0], it.at[1], it.id);
    return this;
  }

  // ---- geometry helpers -------------------------------------------------
  _lines(it) {
    const w1 = FM.textWidth(it.text, it.size, it.bold);
    if (!it.wrap || w1 <= this.o.maxLineMm) return [{ lines: [it.text], w: w1, n: 1 }];
    // Split at the space that leaves the two halves most equal — a two-line
    // label reads as one thing only if the lines are of a kind.
    const words = String(it.text).split(' ');
    if (words.length < 2) return [{ lines: [it.text], w: w1, n: 1 }];
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const wa = FM.textWidth(a, it.size, it.bold), wb = FM.textWidth(b, it.size, it.bold);
      const score = Math.abs(wa - wb);
      if (!best || score < best.score) best = { score, lines: [a, b], w: Math.max(wa, wb) };
    }
    return [{ lines: [it.text], w: w1, n: 1 }, { lines: best.lines, w: best.w, n: 2 }];
  }

  // The box a label occupies for a given position, in mm, halo included.
  _box(it, form, pos, gap) {
    const [ax, ay] = it.at;
    const g = gap == null ? this.o.gap : gap;
    const lx = ax + pos.dx * g, ly = ay + pos.dy * g;
    const lead = it.size * 1.28;                       // line pitch for the 2-line form
    const x0 = pos.anc === 'start' ? lx : pos.anc === 'end' ? lx - form.w : lx - form.w / 2;
    const top = ly - it.size * FM.CAP_HEIGHT - (form.n === 2 ? lead : 0);
    const bot = ly + it.size * FM.DESCENDER;
    const p = this.o.pad;
    return { b: [x0 - p, top - p, x0 + form.w + p, bot + p], lx, ly, lead };
  }

  _frameCost(b) {
    const F = this.frame;
    const out = Math.max(0, F.x0 - b[0]) + Math.max(0, b[2] - F.x1)
              + Math.max(0, F.y0 - b[1]) + Math.max(0, b[3] - F.y1);
    return out * this.o.wFrame;
  }

  // How far the box's centre is from the nearest anchor that is NOT its own.
  _ambiguity(it, b) {
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const own = Math.hypot(cx - it.at[0], cy - it.at[1]);
    let near = Infinity;
    for (const [x, y, id] of this.anchors) {
      if (id === it.id) continue;
      const d = Math.hypot(cx - x, cy - y);
      if (d < near) near = d;
    }
    if (!isFinite(near)) return 0;
    // Costed on the RATIO, not the raw distance: on a dense sheet everything is
    // close to something, and what actually misleads a reader is a label that is
    // closer to the wrong symbol than to the right one.
    return near < own * this.o.ambigRatio ? this.o.wAmbig * (1 - near / Math.max(own, 0.01)) : 0;
  }

  // Cost of putting `it` at this candidate. null = impossible.
  _cost(it, cand, skipBoxes, relaxHard) {
    const b = cand.box;
    const B = this.bounds;
    if (B && (b[0] < B.x0 || b[2] > B.x1 || b[1] < B.y0 || b[3] > B.y1)) return null;
    let hardPenalty = 0;
    if (this.hard.any(b)) {
      // ...unless everything it hits is its own symbol, which by construction it
      // is standing next to.
      if (!it.own || !this._onlyOwn(b, it.own)) {
        // `mustPlace` labels (the "to <destination>" strings) do not get dropped for
        // this. A destination is the answer to the question the sheet exists to
        // answer, and the previous placer always printed one — dropping it to keep a
        // symbol pristine trades the most valuable text on the page for the least
        // valuable clearance. It is costed heavily instead, so it still prefers any
        // clean spot that exists.
        if (!relaxHard) return null;
        hardPenalty = this.o.wHard;
      }
    }
    for (const pb of this.placedBoxes) {
      if (skipBoxes && skipBoxes.has(pb)) continue;
      if (boxesHit(b, pb.b)) return null;
      if (cand.leaderSeg) {
        if (pb.leader && Labeller._crosses(cand.leaderSeg, pb.leader)) return null;
        // ...and a leader may not be drawn straight through someone else's label.
        if (segHitsBox(cand.leaderSeg, pb.b)) return null;
      }
      if (pb.leader && segHitsBox(pb.leader, b)) return null;
    }
    const ink = this.ink.cover(b);
    // Same reasoning as the hard grid above: a "to <destination>" label with a white
    // halo over a ribbon is legible; a missing one is not recoverable by the reader.
    if (ink > this.o.inkFatal && !relaxHard) return null;
    let c = ink * this.o.wInk
          + cand.pi * this.o.wPos
          + Math.max(0, cand.gap - this.o.gap) * this.o.wDist
          + (cand.form.n === 2 ? this.o.wWrap : 0)
          + (cand.leader ? this.o.wLeader + cand.leaderLen * 0.5 : 0)
          + (cand.offDevice ? this.o.wOffDevice : 0)
          + this._frameCost(b)
          + this._ambiguity(it, b)
          + this._preference(it, b)
          + hardPenalty;
    return c;
  }

  /*
   * How far this box sits from the direction the CALLER asked for.
   *
   * `prefer` is a vector, not a compass key: gen_external_radial.js computes the
   * perpendicular a spoke's stop labels should sit on — steered into the open
   * space by the spoke's own `side` — and hands it over per label. Until
   * 2026-08-30 this class read sixteen item properties and `prefer` was not one
   * of them, so the value was computed correctly for 81 of the 83 spokes on the
   * board and discarded one call later (OA-062). `labSide` went dead in the same
   * breath, and every `side` in every town's config with it.
   *
   * Costed, never enforced. A preference that cannot be overridden is a rule,
   * and the whole reason the free placer replaced the old one is that a stop
   * label sometimes has to cross the line to find paper. Zero when the box is on
   * the asked-for side, `wPrefer` when it is on the opposite one, and half that
   * across.
   */
  _preference(it, b) {
    if (!it.prefer) return 0;
    const [ux, uy] = it.prefer;
    const pl = Math.hypot(ux, uy);
    if (!(pl > 1e-9)) return 0;
    const vx = (b[0] + b[2]) / 2 - it.at[0], vy = (b[1] + b[3]) / 2 - it.at[1];
    const vl = Math.hypot(vx, vy);
    if (!(vl > 1e-9)) return 0;
    const dot = (vx * ux + vy * uy) / (vl * pl);
    return this.o.wPrefer * (1 - clamp(dot, -1, 1)) / 2;
  }

  // True when every hard cell the box touches lies inside the label's own symbol.
  _onlyOwn(b, own) {
    const clip = [Math.max(b[0], own[0]), Math.max(b[1], own[1]), Math.min(b[2], own[2]), Math.min(b[3], own[3])];
    if (clip[0] > clip[2] || clip[1] > clip[3]) return false;
    // Test the parts of b outside own: split into up to four strips.
    const strips = [
      [b[0], b[1], b[2], own[1]], [b[0], own[3], b[2], b[3]],
      [b[0], Math.max(b[1], own[1]), own[0], Math.min(b[3], own[3])],
      [own[2], Math.max(b[1], own[1]), b[2], Math.min(b[3], own[3])],
    ];
    for (const s of strips) { if (s[0] >= s[2] || s[1] >= s[3]) continue; if (this.hard.any(s)) return false; }
    return true;
  }

  /*
   * The leader from a point to a label box: shortest segment to the box edge, or
   * null if it would be longer than leaderMax (an over-long leader is worse than
   * no label — the reader has to hunt for what it points at).
   *
   * IT STARTS AT THE SYMBOL'S RIM, NOT AT ITS CENTRE (2026-08-30, OA-176 4.20).
   * A reader outside the project found this by looking at the Ramsey sheet at
   * magnification: the leader begins at the exact centre of the badge disc, and
   * labels are drawn last, so it is painted straight across the digit. Measured
   * on that sheet — the 301, 303 and 305 terminus stack at x=158.22, discs of
   * radius 3.0, leaders 5.01 mm long — three fifths of each leader was drawn on
   * top of the badge it came out of.
   *
   * `own` is the box the caller already passes for a different reason (it is the
   * label's exemption from the hard grid), and it is exactly the symbol the
   * leader emerges from, so nothing new has to be plumbed through.
   *
   * The LENGTH test still measures from the point. leaderMax is about how far a
   * reader's eye has to travel from the thing to its name, and that distance
   * does not change because we stopped drawing the first three millimetres of it.
   */
  _leader(at, b, own) {
    const ex = clamp(at[0], b[0], b[2]), ey = clamp(at[1], b[1], b[3]);
    const len = Math.hypot(ex - at[0], ey - at[1]);
    if (len > this.o.leaderMax || len < 0.5) return null;
    let sx = at[0], sy = at[1];
    if (own && at[0] >= own[0] && at[0] <= own[2] && at[1] >= own[1] && at[1] <= own[3]) {
      // Walk from the point towards the box until we leave `own`; the smallest
      // positive t at which the ray crosses one of its four sides.
      const dx = ex - at[0], dy = ey - at[1];
      let t = 0;
      if (dx > 1e-9) t = Math.max(t, (own[2] - at[0]) / dx);
      else if (dx < -1e-9) t = Math.max(t, (own[0] - at[0]) / dx);
      if (dy > 1e-9) t = Math.max(t, (own[3] - at[1]) / dy);
      else if (dy < -1e-9) t = Math.max(t, (own[1] - at[1]) / dy);
      t = clamp(t, 0, 1);
      sx = at[0] + dx * t; sy = at[1] + dy * t;
      // A leader wholly inside its own symbol is not a leader; leave it at the
      // point rather than emitting a zero-length path.
      if (Math.hypot(ex - sx, ey - sy) < 0.35) { sx = at[0]; sy = at[1]; }
    }
    return { seg: [[sx, sy], [ex, ey]], len };
  }
  // Do two segments cross? Leaders that cross each other are the classic tell of
  // an automatic placer, and the plan asks for none.
  static _crosses(a, b) {
    const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const s1 = d(a[0], a[1], b[0]), s2 = d(a[0], a[1], b[1]);
    const s3 = d(b[0], b[1], a[0]), s4 = d(b[0], b[1], a[1]);
    return ((s1 > 0) !== (s2 > 0)) && ((s3 > 0) !== (s4 > 0));
  }

  _candidates(it) {
    const forms = this._lines(it);
    const out = [];
    /* `it.gap` — THIS LABEL'S OWN NOMINAL DISTANCE FROM ITS POINT (2026-08-30,
     * OA-078). The 2.6 mm default is the right distance for a NAME: far enough that
     * the words are not touching the symbol, near enough that they belong to it. An
     * index marker is not a name, it is a tick — two glyphs whose whole job is to
     * be unmistakably attached to one symbol — and holding it 2.6 mm out on a
     * saturated sheet is the difference between placing it and dropping it. Absent
     * on every other caller, so every other label's candidate list is unchanged. */
    const G0 = it.gap != null ? it.gap : this.o.gap;
    const gaps = [G0, G0 * 1.55];                      // and a little further out
    /* `only`: an ORDERED shortlist of compass keys, for a label that belongs to a
     * repeated DEVICE rather than to a point on its own. The free placer is right
     * for a POI name — wherever it fits best is where it should go — and wrong for
     * a device drawn seven times on one sheet, because "best per instance" is what
     * makes seven instances look like seven different designs. Restricting the
     * list keeps the relationship to the line constant and lets it degrade in a
     * stated order instead of a scored one. `pi` is the index within the
     * SHORTLIST, so wPos still charges for stepping down it. See gen_internal.js's
     * off-map continuations (plan §2.5). */
    const list = it.only ? it.only.map(k => POSITIONS.find(p => p.k === k)).filter(Boolean) : POSITIONS;
    for (const form of forms) for (let pi = 0; pi < list.length; pi++) {
      for (const g of gaps) {
        const { b, lx, ly, lead } = this._box(it, form, list[pi], g);
        out.push({ form, pos: list[pi], pi, gap: g, box: b, lx, ly, lead, leader: false, leaderLen: 0 });
      }
    }
    // Every OTHER position, kept as a last resort at `wOffDevice`. A shortlist that
    // can drop a label is worse than an inconsistent sheet: the device is a look,
    // the destination is the information. Anything taken from here is reported by
    // the caller rather than quietly absorbed.
    if (it.only) {
      const rest = POSITIONS.filter(p => !list.includes(p));
      for (const form of forms) for (let pi = 0; pi < rest.length; pi++) {
        for (const g of gaps) {
          const { b, lx, ly, lead } = this._box(it, form, rest[pi], g);
          out.push({ form, pos: rest[pi], pi, gap: g, box: b, lx, ly, lead, leader: false, leaderLen: 0, offDevice: true });
        }
      }
    }
    if (it.leader !== false) {
      // A ring further out, reached by a leader line. Only worth trying for the
      // ones that would otherwise be dropped, so they are costed heavily and sit
      // at the end of the list. The leader's length is measured properly — from
      // the point to the nearest edge of the BOX, not to its text origin — and a
      // candidate whose leader would be too long is dropped here rather than
      // drawn without one. (The first High Wycombe v2 render had six labels
      // stranded in the left margin exactly that way: the position was accepted,
      // then the leader silently failed its own length test.)
      for (const form of forms) for (let pi = 0; pi < list.length; pi++) {
        // Two rings only. A third at 3.9x was tried and made things WORSE: the extra
        // reach let low-priority labels claim distant space that higher-value ones
        // then could not use, and High Wycombe lost five more names than with two.
        for (const g of [G0 * 2.1, G0 * 3.0]) {
          const { b, lx, ly, lead } = this._box(it, form, list[pi], g);
          const lead2 = this._leader(it.at, b, it.own);
          if (!lead2) continue;
          out.push({ form, pos: list[pi], pi, gap: g, box: b, lx, ly, lead,
                     leader: true, leaderLen: lead2.len, leaderSeg: lead2.seg });
        }
      }
    }
    return out;
  }

  // ---- solve ------------------------------------------------------------
  solve() {
    if (this._solved) return this._solved;
    // Fixed labels first: they claim their space before anything competes for it.
    const results = new Map();
    const auto = [];
    for (const it of this.items) {
      if (it.fixed) {
        const form = { lines: [it.text], w: FM.textWidth(it.text, it.size, it.bold), n: 1 };
        const pos = { dx: 0, dy: 0, anc: it.fixed.anchor || 'start' };
        const x0 = pos.anc === 'start' ? it.fixed.x : pos.anc === 'end' ? it.fixed.x - form.w : it.fixed.x - form.w / 2;
        const b = [x0 - this.o.pad, it.fixed.y - it.size * FM.CAP_HEIGHT - this.o.pad,
                   x0 + form.w + this.o.pad, it.fixed.y + it.size * FM.DESCENDER + this.o.pad];
        const rec = { id: it.id, it, placed: true, x: it.fixed.x, y: it.fixed.y, anchor: pos.anc,
                      lines: [it.text], lead: 0, leader: null, b, cost: 0 };
        results.set(it.id, rec); this.placedBoxes.push(rec);
      } else auto.push(it);
    }
    // Priority, then longest text (a long name has the fewest places to go), then
    // insertion order — all three are stable, so the sweep is deterministic.
    auto.sort((a, b) => (b.priority - a.priority) || (b.text.length - a.text.length) || (a.seq - b.seq));

    for (const it of auto) {
      const best = this._best(it, null);
      if (best) {
        const rec = this._record(it, best);
        results.set(it.id, rec); this.placedBoxes.push(rec);
      } else {
        results.set(it.id, { id: it.id, it, placed: false, reason: 'no candidate clear' });
      }
    }

    /*
     * Relaxation. The greedy pass is order-dependent by construction: whoever
     * goes first takes the best spot and can box a later label out of every one
     * of its own. Re-offering each placed label the whole candidate list, with
     * its current box lifted out of the way, lets it move to a cheaper spot; and
     * every label that failed gets another go once its neighbours have shuffled.
     * Three sweeps is where the movement stops on the sheets tested — the fourth
     * changed nothing on any of the eight towns.
     */
    for (let sweep = 0; sweep < this.o.relaxSweeps; sweep++) {
      let moved = 0;
      for (const it of auto) {
        const rec = results.get(it.id);
        if (rec.placed) {
          const skip = new Set([rec]);
          const best = this._best(it, skip);
          if (best && best.cost < rec.cost - 0.01) {
            const i = this.placedBoxes.indexOf(rec);
            const nrec = this._record(it, best);
            this.placedBoxes[i] = nrec; results.set(it.id, nrec); moved++;
          }
        } else {
          const best = this._best(it, null);
          if (best) { const nrec = this._record(it, best); results.set(it.id, nrec); this.placedBoxes.push(nrec); moved++; }
        }
      }
      if (!moved) break;
    }

    this._solved = this.items.map(it => results.get(it.id));
    return this._solved;
  }

  _best(it, skip) {
    const cands = this._candidates(it);
    for (const relax of (it.mustPlace ? [false, true] : [false])) {
      let best = null;
      for (const cand of cands) {
        const c = this._cost(it, cand, skip, relax);
        if (c == null) continue;
        if (!best || c < best.cost - 1e-9) best = { cand, cost: c };
      }
      if (best) return best;
    }
    return null;
  }

  _record(it, best) {
    const c = best.cand;
    return { id: it.id, it, placed: true, x: c.lx, y: c.ly, anchor: c.pos.anc,
             lines: c.form.lines, lead: c.lead, leader: c.leaderSeg || null,
             b: c.box, cost: best.cost, pos: c.pos.k, offDevice: !!c.offDevice };
  }

  unplaced() { return this.solve().filter(r => !r.placed).map(r => ({ id: r.id, text: r.it.text, at: r.it.at, reason: r.reason })); }

  /*
   * indexPass — A NUMBER WHERE THE NAME WOULD NOT GO (2026-08-30, OA-078).
   *
   * `unplaced()` says a sheet failed to name 288 things board-wide. What it does
   * NOT say is that the sheet still DREW all 288 of them: the icon is there, the
   * name is not, and a reader sees an anonymous supermarket trolley. That is the
   * real defect, and it is the one measure the drop count cannot express.
   *
   * Nottingham's city-centre map answers it by numbering the points and listing
   * them at the side, and the reason that works is arithmetic rather than taste:
   * *"Cambridge Fish Preservation and Angling Society Ltd. Managed Fishery"* is
   * 68 characters and 84 mm of type, and `17` is two glyphs and 2.6 mm. A place
   * with nowhere for its name almost always has somewhere for its number.
   *
   * SO THIS IS NOT A SECOND PLACER. It is the same one, run again over the labels
   * that failed, with the text replaced by an ordinal. Every candidate position,
   * every cost, the ink grid, the hard grid, the leader rules and the boxes
   * already taken are the ones the main solve used — the numbers are simply
   * cheaper to satisfy. Each accepted marker joins `placedBoxes`, so number 2
   * avoids number 1 exactly as any two labels avoid each other.
   *
   * WHAT IT DELIBERATELY DOES NOT DO. It does not force. A point with no room for
   * even two digits keeps its silence and stays in `unplaced()`, because a number
   * stamped on top of a route line is a number a reader cannot read and cannot
   * look up either — it would convert a visible failure into an invisible lie.
   * And it does not renumber: `from` lets the caller keep one sequence across the
   * three sheets of a town if it ever wants to, and the default is 1.
   *
   * Returns the rows the CALLER has to print somewhere — this class draws the
   * markers and knows nothing about panels. `max` is how many the caller has room
   * to list; anything past it is left unplaced and unnumbered rather than marked
   * on the map and missing from the list, which is the one outcome worse than
   * saying nothing.
   */
  indexPass(o) {
    if (this._indexed) return this._indexed;
    /* 2.4 mm, NOT 2.3 (2026-09-01, OA-213). The marker used to be drawn at 2.3 mm,
     * which is below `quality_metrics.js`'s own print-legibility floor of 2.4 —
     * so every index marker on the estate was a HARD defect, 82 of them, 27% of
     * the whole board. Measured across all 39 rebuildable sheets before it was
     * taken: it removes 104 hard defects, takes all 21 index sheets off the
     * sub-floor list, drops not one additional label anywhere, and costs a single
     * extra point-label-over-ink. The floor itself is untouched — the artwork
     * moved, which is the difference between fixing this and redefining it. */
    const opt = Object.assign({ size: 2.4, from: 1, max: Infinity, fill: '#111', gap: 1.7 }, o || {});
    /* WHICH ONES GET A NUMBER is the main solve's own question, asked again. The
     * comparator is `solve()`'s, verbatim: priority, then the longest name (which
     * had the fewest places to go), then insertion order. When `max` bites, what
     * is left behind is what the placer already ranked last, not whatever happened
     * to be at the end of an array. */
    const want = this.solve().filter(r => !r.placed && r.it.at).map(r => r.it);
    want.sort((a, b) => (b.priority - a.priority) || (b.text.length - a.text.length) || (a.seq - b.seq));
    /* `max` IS A BLOCK CAPACITY, NOT AN ATTEMPT BUDGET (2026-09-01, OA-187).
     *
     * This used to slice `want` to `max` and try only those. Every candidate the
     * map has no room for — no space beside the symbol even for two digits —
     * spent one of the caller's ROWS and produced none, so a budget counted in
     * attempts was being spent against a block measured in successes, and the two
     * agree only on a sheet where nothing fails. They rarely do: High Wycombe's
     * diagram reported `51 names could not be numbered either ... and the index
     * block still has 5 free rows` — fifty-one candidates and five empty rows,
     * with nothing tried. The sheet was contradicting itself in one sentence.
     *
     * So `cap` is what the caller can PRINT and the walk stops when the block is
     * full, not when the attempts run out. `ceiling` is what keeps that from
     * becoming unbounded: `want` can be 260 names on a dense sheet and `_best` is
     * not free, so the attempts are still capped — just not at the same number as
     * the block's capacity. It is deliberately generous rather than tuned; the
     * measured case needed 43 attempts to fill 12 rows. */
    const cap = opt.max === Infinity ? want.length : Math.max(0, opt.max | 0);
    const ceiling = Math.min(want.length, Math.max(cap * 4, cap + 40));
    const take = want.slice(0, ceiling);
    if (!cap || !take.length) { this._indexed = []; return this._indexed; }
    /* PLACE ON THE WIDEST NUMBER, DRAW THE ACTUAL ONE. The box a marker needs
     * depends on how many digits it ends up with, and the digits are not known
     * until the survivors are counted — so every marker is placed against the
     * widest ordinal this pass could issue, and the glyph drawn into it is never
     * wider than that. The alternative, numbering first, forces a choice between a
     * gap in the sequence (some marker did not fit) and a box narrower than the
     * text, and this project has already paid for the second one twice.
     *
     * It is sized from `cap`, NOT from `ceiling`: the highest ordinal this pass
     * can ever issue is `from + min(cap, take.length) - 1`, because the walk below
     * stops at `cap`. Widening it to the attempt ceiling would reserve a box for a
     * number that cannot exist and move ink on every sheet for nothing. */
    const widest = String(opt.from + Math.min(cap, take.length) - 1).replace(/\d/g, '8');
    const placed = [];
    for (const src of take) {
      if (placed.length >= cap) break;      // the block is full: stop looking
      const it = { id: 'idx:' + src.id, at: src.at, text: widest, size: opt.size,
                   bold: true, wrap: false, leader: true, own: src.own, gap: opt.gap,
                   fill: opt.fill, priority: 0, seq: this.items.length + placed.length };
      const best = this._best(it, null);
      if (!best) continue;                 // no room even for two digits: stays silent
      const rec = this._record(it, best);
      this.placedBoxes.push(rec);
      placed.push({ src, rec });
    }
    /* NUMBERED ALPHABETICALLY, once the survivors are known. A reader arrives at
     * this list from two directions — with a number off the map, wanting a name,
     * and with a name in mind, wanting to know whether the map shows it — and an
     * alphabetical list ordered by its own numbers answers both at once. Numbering
     * in placement order would answer only the first. localeCompare is deliberately
     * NOT used: this file may not depend on locale (same input, same bytes), so the
     * sort is plain code-unit order with a case fold and a stable id tie-break. */
    placed.sort((a, b) => {
      const x = a.src.text.toUpperCase(), y = b.src.text.toUpperCase();
      return x < y ? -1 : x > y ? 1 : (a.src.id < b.src.id ? -1 : a.src.id > b.src.id ? 1 : 0);
    });
    const rows = placed.map((e, i) => {
      const n = opt.from + i;
      e.rec.it.text = String(n);
      e.rec.lines = [String(n)];
      return { n, text: e.src.text, id: e.src.id, at: e.src.at, rec: e.rec };
    });
    this._indexed = rows;
    return rows;
  }

  /* The markers, drawn through the same renderer as every other label. Empty
   * before indexPass() has run, so a caller that never asks for an index emits
   * exactly the bytes it emitted before this method existed. */
  indexSvg(fmt) { return this._svgOf((this._indexed || []).map(r => r.rec), fmt); }

  /* Everything indexPass() could not number either — the residue after both
   * passes, and the honest denominator for "how much is this sheet not saying?" */
  stillUnplaced() {
    const done = new Set((this._indexed || []).map(r => r.id));
    return this.unplaced().filter(u => !done.has(u.id));
  }

  /*
   * svg — render the solved labels. Kept here rather than in the caller so that
   * the box the placer reserved and the glyphs actually drawn can never disagree
   * about size, leading or anchor, which is the failure mode that produced
   * "to Cambridge" printed across its own badge.
   */
  svg(fmt) { return this._svgOf(this.solve(), fmt); }

  /* The renderer, over any list of solved records. `svg()` hands it the main
   * answer and `indexSvg()` hands it the index markers, so a number and a name
   * are drawn by one piece of code and cannot drift apart in leading, anchor or
   * halo — which is the whole reason this renderer lives in the placer. */
  _svgOf(recs, fmt) {
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const out = [];
    for (const r of recs) {
      if (!r.placed) continue;
      const it = r.it;
      if (r.leader) {
        out.push(`<path d="M${r.leader[0][0].toFixed(2)} ${r.leader[0][1].toFixed(2)}L${r.leader[1][0].toFixed(2)} ${r.leader[1][1].toFixed(2)}" stroke="${it.fill || '#222'}" stroke-width="0.3" fill="none" stroke-opacity="0.75"/>`);
      }
      r.lines.forEach((ln, i) => {
        const y = r.y - (r.lines.length - 1 - i) * r.lead;
        const halo = it.halo === false ? '' : ' stroke="#fff" stroke-width="0.7" paint-order="stroke"';
        out.push(`<text x="${r.x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-size="${it.size}"`
          + (it.bold ? ' font-weight="bold"' : '') + (it.italic ? ' font-style="italic"' : '')
          + ` fill="${it.fill || '#222'}" text-anchor="${r.anchor}"${halo}>${esc(ln)}</text>`);
      });
    }
    return (fmt === 'array') ? out : out.join('\n');
  }
}

module.exports = { Labeller, Grid, POSITIONS, DEFAULTS };
