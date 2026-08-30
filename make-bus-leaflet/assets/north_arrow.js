/*
 * north_arrow.js — the compass on an internalRoads internal sheet.
 *
 * CONTRACT. `northArrow({IR, theta})` returns the device: `on` (false when the
 * town has `internalRoads.northArrow:false`, or has no internalRoads at all),
 * `at` — the resolved base point, MUTABLE because the two searches below move it —
 * `box(x,y)` for the whole footprint, `site(spotSearch, reserve, warn)`,
 * `resite(spotSearch, hit, warn)` and `draw(out)`. It reads no files, writes none, and touches the document only
 * through the `out` it is handed.
 * Extracted verbatim from gen_internal.js on 2026-08-27 (OA-129 Phase 3).
 *
 * WHY THE DEVICE IS IN THREE PIECES, and why they cannot be merged. The angle
 * has to be known early, because it decides the footprint; the POSITION cannot
 * be settled until the ink is stamped, because the arrow is placed by finding
 * blank space; and the drawing happens at the very end of the sheet, on top of
 * everything. Merge any two and one of those three orderings breaks.
 *
 * IT IS DRAWN LAST AND USED TO KNOW NOTHING. On High Wycombe it printed straight
 * through route 130's terminus badge and across the railway (Peter, G2,
 * 2026-08-15). It does not need a CHOSEN spot, only a blank one (Peter, same
 * day) — so `site()` runs between stamping the ink and solving the labels: any
 * earlier and there is no ink to avoid, any later and the labels have taken the
 * space. The arrow gets first pick of what is empty and the labels work round
 * it, which is the right order, because the arrow can go anywhere and a label
 * cannot. A v1 sheet never runs that search, so its arrow stays exactly where
 * its config puts it.
 */
'use strict';

function northArrow({ IR, theta }){
  const on = !!(IR && IR.northArrow!==false);
  const NA = (IR && IR.northArrow && IR.northArrow!==true) ? IR.northArrow : {};
  const LEN = NA.len||8;
  const ANG = NA.angle!=null ? NA.angle*Math.PI/180
            : Math.atan2(-Math.cos(-theta), Math.sin(-theta));
  function box(bx,by){                 // base, tip, arrowhead and the "N"
    const tx = bx+Math.cos(ANG)*LEN, ty = by+Math.sin(ANG)*LEN;
    return [Math.min(bx,tx)-3.4, Math.min(by,ty)-4.6, Math.max(bx,tx)+3.4, Math.max(by,ty)+4.6];
  }
  const at = { x: NA.x!=null?NA.x:14, y: NA.y!=null?NA.y:150, auto:false };

  /* Give the arrow the blank corner nearest a frame edge, or say why not. */
  const site = (spotSearch, reserve, warn) => {
    const got = spotSearch(box, at.x, at.y, 0.02);
    if(got.auto){
      warn('northArrow: '+(got.want===null?'the configured spot is blocked':
        'the configured spot is '+(got.want*100).toFixed(0)+'% covered by ink')
        +' — placed automatically at '+got.x+','+got.y+' (nearest clear corner).\n');
      at.x=got.x; at.y=got.y; at.auto=true;
    } else if(got.x===null){
      warn('northArrow: no clear spot found on this sheet; left at the configured '
        +at.x+','+at.y+'. Set internalRoads.northArrow:false, or make room.\n');
    }
    reserve(...box(at.x, at.y));
  };

  /* A SECOND LOOK, ONCE THE LABELS ARE DOWN (2026-08-30, OA-124).
   *
   * `site()` deliberately runs before the labels are solved, and the header above
   * says why: the arrow gets first pick of what is blank because it can go
   * anywhere and a label cannot. That is right for every label the placer is free
   * to move, and wrong for the one kind it is not — a `mustPlace` destination
   * caption, which labeller.js costs at `wHard` for entering a reserved box and
   * never drops for it. The arrow takes the corner; the caption is printed through
   * it regardless; and the reader gets "to Chatteris" across the N.
   *
   * So: if something actually landed on the footprint, look again knowing where
   * the labels went, and move ONLY if there is somewhere clear. `hit(b)` names the
   * problem or returns false; `spotSearch` is the caller's, already vetoing the
   * placed label boxes. A hand-pinned arrow (`internalRoads.northArrow:{x,y}` that
   * site() accepted) is left alone — a stated position is a decision, and this
   * pass is for the automatic one. Nothing moves on a sheet with nowhere to move
   * to, so an unchanged sheet stays byte-identical.
   *
   * The box site() reserved is deliberately NOT withdrawn. Everything that reads a
   * reservation has already run by the time this fires, so withdrawing it would
   * change nothing except to make the two passes disagree about what was claimed.
   */
  const resite = (spotSearch, hit, warn) => {
    if(!on) return false;
    if(!at.auto && NA.x!=null && NA.y!=null) return false;   // hand-pinned: a decision
    if(!hit(box(at.x, at.y))) return false;                  // nothing landed on it
    const got = spotSearch(box, null, null, 0.02);
    if(got.x===null){
      warn('northArrow: a label is printed through the compass at '+at.x+','+at.y
        +' and there is no clear spot left to move it to. Set '
        +'internalRoads.northArrow:{x,y} to a corner you are happy with, or '
        +'internalRoads.northArrow:false.\n');
      return false;
    }
    warn('northArrow: a label was placed across the compass at '+at.x+','+at.y
      +' \u2014 moved to '+got.x+','+got.y+' (nearest clear corner, labels included).\n');
    at.x=got.x; at.y=got.y; at.auto=true;
    return true;
  };

  /* The line, the arrowhead and the N, at whatever spot site() settled on. */
  const draw = (out) => {
    // Position resolved above: the configured {x,y} when it is clear, otherwise the
    // nearest blank corner (v2 only — a v1 sheet never runs that search, so its
    // arrow stays exactly where its config puts it and the output is byte-identical).
    // north planar step (0,-1) through the same rot() the projection uses:
    // rot(0,-1) = [sin(-theta), -cos(-theta)] in screen space (y down).
    const bx = at.x, by = at.y, L = LEN, ang = ANG;
    const c=Math.cos(ang), s=Math.sin(ang), tx=bx+c*L, ty=by+s*L;
    const px=-s, py=c, ah=2.4, aw=1.4;                     // arrowhead
    out(`<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}" stroke="#666" stroke-width="0.8"/>`);
    out(`<path d="M${tx.toFixed(2)} ${ty.toFixed(2)}L${(tx-c*ah+px*aw).toFixed(2)} ${(ty-s*ah+py*aw).toFixed(2)}L${(tx-c*ah-px*aw).toFixed(2)} ${(ty-s*ah-py*aw).toFixed(2)}Z" fill="#666"/>`);
    out(`<text x="${(tx+c*3).toFixed(2)}" y="${(ty+s*3+1).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#666" text-anchor="middle">N</text>`);
  };

  return { on, at, box, len: LEN, angle: ANG, site, resite, draw };
}

module.exports = { northArrow };
