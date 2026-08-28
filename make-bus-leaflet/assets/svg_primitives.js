/*
 * svg_primitives.js — the small marks the internal sheet is drawn out of.
 *
 * CONTRACT. `svgPrimitives(deps)` returns `{ esc, gk, badgeHalfW, badgeXW,
 * badgeXWs, badge, badgeStack }`. It is a FACTORY, not a module of
 * free functions, because four of the eight need the town in scope: the route
 * palette, the text colour on that fill, the badge-label lookup and the font
 * metrics table. `out` is passed in rather than returned from, so the caller
 * keeps ownership of the document — these helpers append to whatever the
 * caller is building and return only measurements.
 *
 * WHAT EACH ONE RETURNS MATTERS, because several call sites measure before
 * they draw: `badge()` returns how much WIDER than the disc it drew (0 for a
 * circle), `badgeStack()` returns `{h, xw}`, and `badgeHalfW`/`badgeXW`/
 * `badgeXWs` answer the same question without drawing anything at all.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3), verbatim.
 * The design.badgeFit reasoning below came with it, because it explains this
 * code and nothing else.
 *
 * ALSO EXPORTS `separateRow`, added 2026-08-28 (OA-060), which is a pure
 * geometry helper and not a mark at all. It lives here rather than in a new
 * module for one blunt reason: a new file would have to be vendored into the
 * portal and wired into its engine layout before either external generator
 * could load, and a generator that resolves its dependency on this laptop and
 * throws inside the portal is a failure this project has already shipped once.
 * This file is vendored today. The alternative was to duplicate the routine in
 * both external generators, where the two copies would drift apart with nothing
 * to notice.
 */
'use strict';

function svgPrimitives(deps) {
  const {
    out,              // append one line to the document the CALLER owns
    palette: C,       // route key -> fill colour
    textOn: TXT,      // route key -> text colour on that fill
    badgeLabel: blab, // route key -> what is PRINTED in the badge, as a function
    font: FONT,       // font_metrics.js, for textWidth()
    badgeFit: BADGE_FIT,
    editorKeys: EDK,  // emit data-key attrs (EDITOR_KEYS=1) or not
  } = deps;
  const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // editor-only element keys (no-op unless EDITOR_KEYS=1, so normal output is unchanged)
  const gk=(kind,key,inner)=> EDK ? `<g data-kind="${kind}" data-key="${esc(key)}">${inner}</g>` : inner;
  /* ---- design.badgeFit: a 4-character route key does not fit a disc ------------
   * badge() has always drawn its text at font-size = the badge RADIUS. That is
   * right for one to three characters and wrong for four: "301S" is 5.6mm of Arial
   * Bold in a 4.8mm stop badge, 7.0mm in a 6.0mm terminus badge and 9.3mm in the
   * 8.0mm Services-panel one, so it spilled over BOTH edges and the number read as
   * sitting ON the disc rather than IN it. Found 2026-08-15 on Ramsey (301S / 301V
   * / 301X); March (ZIP2) and St Ives (VL14) have it too, on their external sheets
   * as well as their internal ones.
   *
   * The fix is the SHAPE, not the type. Shrinking the font to fit the disc is the
   * smaller change and it fails exactly where it matters most: fitting "301S"
   * inside a 2.4mm-radius stop badge needs 1.8mm type, well under the 2.4mm print
   * legibility floor `quality_metrics.js` enforces. So the badge grows sideways
   * into a stadium — what operator maps do with a lettered route number — and the
   * type stays the size it was.
   *
   * `badgeHalfW(route, rad)` is the single source of truth for how wide a badge is,
   * and `badgeXW` is the same thing as an EXTRA over the radius. Every pitch, clamp
   * and reserve box below is expressed as `<the old literal> + <extra>`, never
   * recomputed from the half-width, so a town with no long key adds a floating
   * zero and stays bit-for-bit identical (invariant 2). Absent the key `badgeXW` is
   * 0 everywhere and none of it runs at all.
   */
  const BFIT = BADGE_FIT;
  // Overflow is measured against the DIAMETER, not against a chord: "X31" pokes a
  // hair outside the circle at the corners of its cap band and has always looked
  // fine, and tightening the test to the chord would turn three-character keys
  // that ship today into pills. 0.3mm of inset keeps the widest shipped
  // three-character key (X31, 4.27mm in a 4.8mm disc) a disc.
  const badgeHalfW = (r,rad)=>{
    if(!BFIT) return rad;
    const w = FONT.textWidth(blab(r), rad, true);   // font-size == rad, Arial Bold
    return (w <= 2*rad-0.3) ? rad : w/2 + 0.35*rad;
  };
  const badgeXW = (r,rad)=> BFIT ? badgeHalfW(r,rad)-rad : 0;
  // widest EXTRA over a set of routes drawn at one radius — needed before the draw,
  // because several call sites test for collisions and then decide whether to badge.
  const badgeXWs = (list,rad)=> BFIT ? Math.max(0,...list.map(r=>badgeXW(r,rad))) : 0;
  function badge(x,y,r,rad=4.6){
    const hw=badgeHalfW(r,rad);
    if(hw>rad) out(`<rect x="${(x-hw).toFixed(2)}" y="${(y-rad).toFixed(2)}" width="${(2*hw).toFixed(2)}" height="${(2*rad).toFixed(2)}" rx="${rad}" fill="${C[r]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
    else out(`<circle cx="${x}" cy="${y}" r="${rad}" fill="${C[r]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
    out(`<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="${(rad).toFixed(2)}" fill="${TXT[r]||'#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(r))}</text>`);
    return hw-rad;}
  // A bundled corridor's badge is a vertical STACK of its members' badges (the
  // convention every operator's own big-town map uses: one line, many identities).
  // A one-element list reduces to exactly badge() at the same centre, so an
  // unbundled town is byte-identical. Returns the stack's half-height in mm, and
  // (under design.badgeFit) how much wider than the disc its widest member drew,
  // so the caller can reserve the right box.
  // OA-024: DEDUPE BY WHAT IS PRINTED, not by route key. A bundled family is a set
  // of route keys, and `badgeLabels` exists precisely so several of them can print
  // the SAME text — so bundling the 301 family on St Ives Bus Station correctly
  // reduced them to one lane and then drew "301" three times down it, one badge per
  // member. The workaround at the time was to delete the duplicate variants from
  // the drawn config, which left the generator fault in place and simply stopped
  // feeding it. A stack is a list of IDENTITIES a reader can tell apart; two badges
  // reading "301" are one identity drawn twice, and the second carries nothing.
  //
  // Deduping here rather than at the call sites because all three badge passes in
  // gen_internal.js reach the page through this function, and a rule applied at two
  // of three call sites is the kind of exempt layer this project has been bitten by.
  // The callers' pre-draw size estimates still count the undeduped group, which
  // over-reserves by a badge — conservative, and it cannot overlap anything.
  //
  // BYTE-NEUTRAL on all 20 committed maps, verified by the byte gate: no map today
  // bundles two routes that print the same text, exactly because the one that did
  // was edited around. What this changes is what happens the next time one does.
  function badgeStack(x,y,list,rad){
    const seen=new Set(), uniq=[];
    for(const r of list){ const t=blab(r); if(!seen.has(t)){ seen.add(t); uniq.push(r); } }
    if(uniq.length===1){ const xw=badge(x,y,uniq[0],rad); return {h:rad, xw}; }
    const pitch=rad*2+0.5, y0=y-(uniq.length-1)/2*pitch;
    let xw=0;
    uniq.forEach((r,i)=>{ xw=Math.max(xw, badge(x, y0+i*pitch, r, rad)); });
    return {h:(uniq.length-1)/2*pitch + rad, xw};
  }
  // DARK, measured 2026-08-27: `design.badgeFit:false` is set by NO committed map,
  // so the whole opt-out from the stadium badge is certified by
  // test/svg_primitives.test.js alone. Seven maps draw at least one stadium badge,
  // so the ON path is well covered by the byte gate; the OFF path is not covered
  // at all.
  //
  // RETIRED 2026-08-27 (OA-136): `cross(x,y,col)` lived here and had no caller
  // anywhere — not in gen_internal.js, not in another generator, not in the
  // portal. gen_external_places.js has a `cross()` of its own and it is the
  // eight-argument segment-intersection test, a different function that shares
  // the name; that is why it read as used for as long as it did. Extraction 8
  // moved it verbatim rather than deleting it, because deleting is a decision
  // and that commit was an extraction. This is the decision: it drew two
  // crossed bars, nothing asked for them, and removing it cannot move a byte.
  return { esc, gk, badgeHalfW, badgeXW, badgeXWs, badge, badgeStack };
}

/*
 * separateRow -- push a row of boxes apart along ONE axis, moving each as little
 * as possible, and say so when they will not fit.
 *
 * WHY THIS EXISTS. Both external generators place a terminus lozenge by clamping
 * it to the printable page and then to the footer plate, and each box is clamped
 * ALONE. Two destinations whose spokes end low both get pushed up to the same
 * line just above the plate, and land on each other; the same happens along the
 * top margin. Measured on the committed board 2026-08-28, that is six of the
 * seven lozenge overlaps on the estate, and the worst is Huntingdon printing
 * "Addenbrooke's ~79 min" over "Cambridge ~56 min" by 13.46 x 14.60 mm -- one
 * destination almost entirely erased on a sheet whose every other number is
 * clean. A clamp is a per-object rule and the defect is a relationship, so no
 * amount of clamping can ever see it.
 *
 * `items` is [{c, hw}] -- centre and half-extent on the axis being separated --
 * and need not be sorted. Returns new centres in the SAME ORDER as the input.
 * `lo`/`hi` bound the axis; `gap` is the daylight to leave between neighbours.
 *
 * The two passes are the whole algorithm. Forward, in sorted order, each box is
 * pushed just clear of its left neighbour; that alone is correct but drifts the
 * whole run one way and can walk the last box off the page, so a backward pass
 * pulls anything past `hi` back, and the two together settle on the layout that
 * moves the row least. A run too long for the space cannot be fixed by moving
 * anything -- the caller is told, and decides. Silently overlapping and silently
 * running off the page are both worse than saying so.
 */
function separateRow(items, lo, hi, gap) {
  const n = items.length;
  const ord = items.map((_, i) => i).sort((a, b) => items[a].c - items[b].c || a - b);
  const need = (k) => items[ord[k - 1]].hw + items[ord[k]].hw + gap;
  const solve = () => {
    const c = items.map(it => it.c);
    for (let k = 1; k < n; k++) c[ord[k]] = Math.max(c[ord[k]], c[ord[k - 1]] + need(k));
    if (n && c[ord[n - 1]] + items[ord[n - 1]].hw > hi) {
      c[ord[n - 1]] = hi - items[ord[n - 1]].hw;
      for (let k = n - 2; k >= 0; k--) c[ord[k]] = Math.min(c[ord[k]], c[ord[k + 1]] - need(k + 1));
    }
    return c;
  };
  const c = solve();
  /* DECIDE WHETHER IT FITS BEFORE DISTRIBUTING ANYTHING, not after.
   *
   * The first cut asked the question at the end and got a wrong answer that
   * looked right: when the row is wider than the space, the two clamps below
   * disagree -- there is no position that satisfies both -- and `Math.max(loCap,
   * ...)` silently let the left-hand clamp win, shoving the run off the right of
   * the page and then reporting fits:true because the LEFT edge was now legal. A
   * feasibility test that runs after the repair can be satisfied by the repair.
   */
  const fits = !n || c[ord[0]] - items[ord[0]].hw >= lo - 1e-9;
  /* CENTRE EACH PRESSED-TOGETHER RUN ON WHERE ITS MEMBERS WANTED TO BE.
   *
   * The two passes above are correct and lopsided: they only ever push to the
   * right, so the leftmost box of a colliding pair never moves and the whole
   * cost lands on its neighbour. On Huntingdon that put "Addenbrooke's" 31mm
   * along the bottom edge to clear "Cambridge", and on this sheet x is not free
   * decoration -- a terminus sits where it does because that is roughly the
   * direction you travel to reach it, so 31mm of sideways shove is a claim about
   * geography. Sharing the move between the two costs each about half as much.
   *
   * A run is a maximal chain of neighbours now sitting at exactly their minimum
   * separation. Shifting a whole run rigidly cannot re-open a collision inside
   * it, and the shift is capped by the slack to whatever sits either side, so it
   * cannot create one outside it either.
   */
  for (let k = 0; fits && k < n;) {
    let e = k;
    while (e + 1 < n && c[ord[e + 1]] - c[ord[e]] <= need(e + 1) + 1e-9) e++;
    if (e > k) {
      let want = 0;
      for (let m = k; m <= e; m++) want += items[ord[m]].c - c[ord[m]];
      want /= (e - k + 1);
      // How far this run may travel each way before it touches its neighbour or
      // the page edge. With `fits` true these bracket zero, so the clamp below is
      // always well formed -- which is exactly what is NOT true when it is false.
      const loCap = k === 0 ? lo + items[ord[k]].hw - c[ord[k]]
                            : (c[ord[k - 1]] + need(k)) - c[ord[k]];
      const hiCap = e === n - 1 ? hi - items[ord[e]].hw - c[ord[e]]
                                : (c[ord[e + 1]] - need(e + 1)) - c[ord[e]];
      const shift = Math.max(loCap, Math.min(hiCap, want));
      if (shift) for (let m = k; m <= e; m++) c[ord[m]] += shift;
    }
    k = e + 1;
  }
  // The run is wider than the space. Report rather than pretend: the caller has
  // options a geometry helper does not (merge two destinations, spread the
  // spokes, shorten a label), and choosing one here would hide the choice. The
  // boxes are still laid left to right from `lo` so the sheet stays readable.
  if (!fits) for (let k = 0; k < n; k++) {
    c[ord[k]] = k === 0 ? lo + items[ord[0]].hw : c[ord[k - 1]] + need(k);
  }
  return { centres: c, fits };
}

module.exports = { svgPrimitives, separateRow };
