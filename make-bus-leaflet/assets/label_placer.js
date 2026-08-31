/*
 * label_placer.js — the reserved-box list, and what is allowed to sit where.
 *
 * CONTRACT. `labelPlacer(deps)` returns `{ placed, iconBoxes, hit, overlaps,
 * overlapsNoIcons, LAB, reserve, whatBlocks, whatBlocksInk, placeLabel, inkOnWhite }`. A
 * factory, and
 * unlike the other extracted modules it OWNS MUTABLE STATE on purpose: the
 * whole point of `placed` is that one list is shared by every pass that claims
 * space on the sheet, and 31 call sites reserve into it. Handing it out as a
 * module-level array would let two towns in one process share it.
 *
 * TWO PLACERS, not one. v1 is the greedy eight-candidate search below, which
 * gives up rather than overlap. v2 (`labels.engine`, the default) queues every
 * point label and solves them together at the end of the file, against the ink
 * read back off the SVG this file has already emitted — so nothing painted
 * later can land on an earlier label. `placeLabel` is the one door to both;
 * under v2 it returns true unconditionally, because v2 never silently drops.
 *
 * `inkOnWhite` IS A LODGER HERE, moved verbatim because that is where it sits.
 * It is about colour legibility, not de-collision, and it is one of at least
 * four separate implementations of the WCAG luminance maths in this engine
 * (also icons.js, pick_route_colour.js and quality_metrics.js, the last with
 * two of its own) — and they are not the same function: some gamma-decode the
 * channels and some take a plain weighted average of the raw bytes. Counted
 * 2026-08-27. Unifying them is a behaviour change, not an extraction, so it is
 * logged rather than done here.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3).
 */
'use strict';

function labelPlacer(deps) {
  const {
    out,             // append one line to the document the CALLER owns
    esc,             // from svg_primitives
    Labeller,        // labeller.js, the v2 solver
    DESIGN,          // routes.json design{} — reserveIcons, labelInkMinContrast
    V2,              // is the v2 placer on?
    IR,              // internalRoads config, or null for the classic model
    MX0, MY0, MX1, MY1,      // the map frame, page mm
    FOOTER_PLATE_TOP,        // where the footer starts painting over things
  } = deps;
  const placed=[];                 // [x0,y0,x1,y1]
  // WHAT claimed each box, in the words the caller used. Parallel to `placed` and
  // deliberately sparse: several sites push straight into `placed` rather than going
  // through reserve(), and an untagged box still has coordinates somebody can go and
  // look at. Added 2026-08-30 (OA-148) because "this note is drawn on something" is
  // a warning that sends nobody anywhere.
  const placedTags=[];
  // design.reserveIcons: boxes contributed by POI ICONS rather than by text. They are
  // ordinary members of `placed` for the first placement attempt, but a placer that
  // finds nowhere at all falls back to a second pass that ignores them — so a label
  // that could only ever have sat on a symbol still prints exactly where it used to.
  // That keeps the change strictly a GAIN: labels that can dodge a symbol now do, and
  // none is lost. (`rollout.js` refuses to publish a label loss, by design.)
  const iconBoxes=new Set();
  const hit=(b,o)=>!(b[2]<o[0]||b[0]>o[2]||b[3]<o[1]||b[1]>o[3]);
  const overlaps=(b,skip)=>placed.some(o=>o!==skip && hit(b,o));
  const overlapsNoIcons=(b)=>placed.some(o=>!iconBoxes.has(o) && hit(b,o));
  // labels.engine:"v2" — one shared placer for the point labels (labeller.js). It is fed
  // from the SAME reserve() calls the old placer uses, so nothing has to be remembered
  // twice, plus the route ink read straight off the SVG this file has already emitted.
  // Solved and drawn in one block near the end (the "two-phase draw"): every symbol,
  // badge, pill and tick has claimed its space before the first label is positioned,
  // which retires the whole class of "a later thing painted over an earlier label".
  // bounds repeat the old placer's own page test (`b[0]<1 || b[2]>MX1+2`) as a hard
  // limit — without it a name at the left edge of the map runs off the paper, because
  // straying outside the frame is only COSTED, and on a congested edge the cost is
  // sometimes the cheapest thing going (caught in the first St Ives v2 render).
  const LAB = V2 ? new Labeller({ page:[297,210], frame:{x0:MX0,y0:MY0,x1:MX1,y1:MY1},
                                  bounds:{x0:1, y0:1, x1:MX1+2, y1:FOOTER_PLATE_TOP-0.4} }) : null;
  function reserve(x0,y0,x1,y1,tag){placed.push([x0,y0,x1,y1]); placedTags[placed.length-1]=tag||'';
    if(LAB) LAB.block([x0,y0,x1,y1],tag);}
  // Everything a box would land on, named. `overlaps` answers yes or no, which is all
  // a placer needs and not enough for a build warning a person has to act on.
  const whatBlocks=(b)=>placed.map((o,i)=>hit(b,o)
      ? (placedTags[i] || ('claimed space at '+o[0].toFixed(1)+','+o[1].toFixed(1)))
      : null).filter(Boolean);
  /* MAP INK, as opposed to the page's own chrome.
   *
   * `overlaps` is every reserved box, and most of them are furniture: the services
   * panel, the title block, the footer plate, the four print-safe trim strips, the
   * core box. A badge is already kept out of those by inFrame()/inCore() and by the
   * frame itself, and asking it to avoid them as well moves badges for no reader's
   * benefit — measured on 2026-08-30, doing so cost the board 10 HARD and three
   * printed labels, most of it High Wycombe, for nothing anybody would see.
   *
   * What a reader DOES see is a badge printed on a symbol, on a hand-placed note or
   * on a station lozenge — the three things a member of the public found on the
   * Ramsey sheet from the outside (the GP symbol over a route number, the pharmacy
   * over an RH2 badge so it reads "H2", the symbols over "New Road"). That is this
   * set, and it is deliberately narrow. */
  /* CHROME, as opposed to map ink: the page's own furniture. A hand-placed note
   * drawn INSIDE the services panel column is somebody's deliberate footnote, not
   * a collision — High Wycombe has four of them at x=200 — so a warning that names
   * the panel is a warning that gets muted in its first week. Everything not on
   * this list, including anything reserved without a tag, is treated as ink and IS
   * worth naming: an untagged box is still something a reader will see. */
  const CHROME=/^the (services panel|title block|footer plate|core box|print-safe margin|scale bar)$/;
  const whatBlocksInk=(b)=>placed.map((o,i)=>hit(b,o) && !CHROME.test(placedTags[i]||'')
      ? (placedTags[i] || (iconBoxes.has(o) ? 'a POI symbol'
         : 'claimed space at '+o[0].toFixed(1)+','+o[1].toFixed(1)))
      : null).filter(Boolean);

  /* A ROUTE COLOUR IS CHOSEN TO BE SEEN AS A 1.7 mm RIBBON, NOT READ AS 2.7 mm TYPE.
   *
   * The "to <somewhere>" terminus labels are drawn in their route's own colour, which is
   * what ties the words to the line and is worth keeping. But the palettes are
   * colour-blind-safe sets built for AREA contrast, and their pale members are hopeless as
   * ink on white: Ely Co-op's route 129 is #DDCC77, which scores 1.62:1 against the page —
   * below even the 3:1 floor for large text — so "to Littleport" was, in Peter's words on
   * 2026-08-24, "very hard to read". The white halo every placeLabel carries makes it
   * worse, not better, because the halo is the background bleeding into the letterforms.
   *
   * Darken the INK only, never the line: the hue is preserved (every channel scales by the
   * same factor) so the label still reads as that route's colour, just deep enough to be
   * type. Anything already above the floor is returned untouched, so the strong hues —
   * magenta 6.09, red 5.19, wine 8.73, the navies — are byte-identical.
   * design.labelInkMinContrast tunes the floor; 3.5 was chosen because it lifts the six
   * genuinely unreadable palette entries (yellow 1.95, cyan 1.84, grey 1.92, amber 2.25,
   * light cyan 2.21, orange 2.87) and leaves the rest of the board alone. */
  const INK_MIN_CONTRAST = (DESIGN.labelInkMinContrast != null) ? +DESIGN.labelInkMinContrast : 3.5;
  const _srgb = v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  const _lum = hex => { const c=[1,3,5].map(i=>_srgb(parseInt(hex.substr(i,2),16)/255));
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]; };
  const _scaleHex = (hex,f) => '#' + [1,3,5].map(i=>{
    const v = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(i,2),16)*f)));
    return v.toString(16).padStart(2,'0'); }).join('');
  function inkOnWhite(hex, min){
    const floor = (min!=null) ? min : INK_MIN_CONTRAST;
    if(!/^#[0-9a-fA-F]{6}$/.test(String(hex))) return hex;
    let f = 1, out = hex;
    for(let i=0; i<40 && 1.05/(_lum(out)+0.05) < floor; i++){ f *= 0.93; out = _scaleHex(hex, f); }
    return out;
  }
  // `self` = this label's OWN icon box, excluded from the collision test: placement puts a
  // label 2.6 mm from a 4.2 mm symbol by design, so its own symbol is not a defect (the
  // same exclusion quality_metrics.js makes when it counts "label over a foreign icon").
  // DARK, measured 2026-08-27 — everything below the v2 branch
  // (tools/branch-coverage.label_placer.js):
  // 17 of the 18 maps with an internal sheet queue their labels through v2 and
  // NOT ONE runs v1, so everything after the `if(LAB)` return — the eight-candidate
  // greedy search, the manual-offset path, the icon-box relaxation and the give-up
  // return — is certified by test/label_placer.js and by nothing else. It is a live
  // feature `labels.engine:"v1"` selects, not dead code: do not delete it, and do
  // not assume a change here is covered because the byte gate stayed green.
  function placeLabel(x,y,text,sz=2.6,col='#222',italic=false,lov=null,self=null,opt=null){
    if(LAB){                                     // v2: queue it, solve them all together
      LAB.add(Object.assign({ id:(opt&&opt.id)||('L'+text+'@'+x.toFixed(1)+','+y.toFixed(1)),
        at:[x,y], text, size:sz, fill:col, italic, own:self||null,
        fixed: (lov&&lov.offset) ? {x:x+lov.offset.dx, y:y+lov.offset.dy, anchor:lov.anchor||'start'} : null,
      }, opt||{}));
      return true;                               // the caller only uses this to decide whether
    }                                            // to draw a fallback; v2 never silently drops
    const w=text.length*sz*0.52, h=sz;
    let chosen=null;
    if(lov && lov.offset){                       // manual label placement (skip de-collision)
      const anc=lov.anchor||'start'; chosen=[x+lov.offset.dx, y+lov.offset.dy, anc];
    } else {
      const cands=[[x+2.6,y+0.9,'start'],[x-2.6,y+0.9,'end'],[x,y-2.6,'middle'],[x,y+3.6,'middle'],
                   [x+2.6,y-2.2,'start'],[x-2.6,y-2.2,'end'],[x+2.6,y+3.4,'start'],[x-2.6,y+3.4,'end']];
      const box=([lx,ly,anc])=>{ const bx = anc==='start'?lx : anc==='end'?lx-w : lx-w/2;
        return [bx-0.4,ly-h,bx+w+0.4,ly+1]; };
      const onPage=b=>!(IR && (b[0]<1 || b[2]>MX1+2));   // keep labels on the page / off the panel
      for(const c of cands){ const b=box(c);
        if(!onPage(b)) continue;
        if(!overlaps(b,self)){ placed.push(b); chosen=c; break; }
      }
      if(!chosen && iconBoxes.size){             // nowhere clear of the symbols: fall back to
        for(const c of cands){ const b=box(c);   // the pre-reserveIcons behaviour rather than drop
          if(!onPage(b)) continue;
          if(!overlapsNoIcons(b)){ placed.push(b); chosen=c; break; }
        }
      }
      /* mustPlace on v1 (OA-202). v2 has honoured `mustPlace` since it was
       * written; v1 had no way to express it at all, so a POI the customer
       * classified `must` would have been silently dropped on any sheet running
       * `labels.engine:"v1"` while the same config forced it on every other
       * sheet — a tier that meant one thing here and another there. It takes the
       * first ON-PAGE candidate and accepts the overlap, which is exactly what
       * `mustPlace` means in v2: relax the collision rule, never the frame.
       *
       * No sheet in the estate runs v1 today, so nothing here changes any
       * committed byte; it is written because the alternative is a config key
       * whose meaning depends on which placer a town happens to have selected. */
      if(!chosen && opt && opt.mustPlace){
        for(const c of cands){ const b=box(c);
          if(!onPage(b)) continue;
          placed.push(b); chosen=c; break;
        }
      }
    }
    if(!chosen){ return false; }                // give up rather than overlap
    const [lx,ly,anc]=chosen;
    out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="${sz}" ${italic?'font-style="italic" ':''}fill="${col}" text-anchor="${anc}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(text)}</text>`);
    return true;
  }
  return { placed, iconBoxes, hit, overlaps, overlapsNoIcons, LAB, reserve, whatBlocks, whatBlocksInk, placeLabel, inkOnWhite };
}

module.exports = { labelPlacer };
