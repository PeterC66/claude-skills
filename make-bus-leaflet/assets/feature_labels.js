/*
 * feature_labels.js — siting the NAME of a linear feature: the river, the main
 * road, the railway, the canal.
 *
 * CONTRACT. `featureLabels({...})` returns one function, `drawFeatureLabel(f)`.
 * It draws at most one <text> per feature and otherwise refuses, out loud.
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3), where
 * extraction 7 had deliberately left it behind: the geometry and the ink went to
 * linear_features.js and this did not, because siting a name reaches into four
 * subsystems the line knows nothing about — the coreBox, the Services panel
 * edge, the footer plate and the auto-label solver.
 *
 * WHICH IS ALSO WHY IT IS BUILT LATE. `AUTOPOS` and `isAuto` do not exist until
 * 900 lines below where the features are drawn, so this factory is called after
 * them rather than beside `linearFeatures()`. A dependency that points FORWARDS
 * is a sign the boundary is in the wrong place; moving the call is the fix, not
 * engineering round it.
 *
 * FOUR GUARDS, AND THE FOURTH IS A DIFFERENT QUESTION FROM THE OTHER THREE. A
 * feature label is placed by hand and has no collision logic of its own, and it
 * is drawn OUTSIDE the map's clip group — so it can land in the town-centre box,
 * in the Services panel, or under the footer plate, and in each case it is
 * painted and then covered. Those three ask whether it can be READ. Wisbech
 * shipped for months with "River Nene" struck across "46 Wisbech - March", and
 * six sheets carried a name at y=196 against a footer plate starting at 195.16.
 *
 * The fourth asks whether it MEANS anything: is the label anywhere near the thing
 * it names? Seven were stranded across the board on 2026-08-16 — Beaconsfield's
 * "A355" 106mm from the A355 on a 190mm frame; Ramsey's "River Nene (Old
 * Course)" 82mm from the river on the very sheet whose write-up records the
 * label as having been moved "onto the river it names". It was moved out of the
 * corner; nothing checked where it landed. A guard on one edge wants all the
 * edges enumerated, and a guard on legibility wants the question about meaning
 * asked beside it.
 *
 * That fourth is a WARNING, not a refusal — the label is legible and the remedy
 * is a judgement about where the feature reads best. 25mm matches
 * quality_metrics.js's featureLabelMaxMm, so the build and the gate agree.
 */
'use strict';

// DARK, measured 2026-08-27 (tools/branch-coverage.feature_labels.js): EVERY FAULT
// PATH OF ALL FOUR GUARDS below is taken by no committed map — the three that
// refuse to draw and the fourth that warns and draws anyway. That is the guards
// WORKING: each was written after a shipped sheet went wrong and the boards were
// then fixed, and a fixed board trips nothing. It also means no byte gate
// certifies any of them — delete a guard and all 20 maps stay byte-identical,
// right up until the next town sites a label badly. test/feature_labels.test.js
// is what stands behind them.
function featureLabels({ out, esc, refuse, warn, featOv, featSegs, isAuto, autoPos,
                         inCore, MX0, MY0, MX1, MY1, FOOTER_SAFE, FOOTER_PLATE_TOP }){
  function drawFeatureLabel(f){
    const ov=featOv(f), lov=ov.label||{};
    if(ov.hide || lov.hide || !f.labelPos) return;
    // labelPos:"auto" — the position was solved and reserved in the reserve pass, so
    // just draw it. A feature whose auto search found nowhere has no entry and is
    // skipped: it already said so on stderr, and a name printed on top of the map
    // because nothing fitted is worse than the name being absent.
    if(isAuto(f)){
      const got = autoPos[f.key];
      if(!got) return;
      const txt = lov.text!=null?lov.text:f.label;
      const it = f.labelItalic!==false, sz = f.labelSize||4;
      out(`<text x="${got.x.toFixed(2)}" y="${got.y.toFixed(2)}" font-family="Arial" ${it?'font-style="italic" ':''}font-size="${sz}" text-anchor="middle" fill="${f.labelColor||'#7fb0d8'}">${esc(txt)}</text>`);
      return;
    }
    let x=f.labelPos.x, y=f.labelPos.y;
    x+=(ov.move&&ov.move.dx)||0; y+=(ov.move&&ov.move.dy)||0;               // follow the feature nudge
    if(lov.pos){ x=lov.pos.x; y=lov.pos.y; } else if(lov.offset){ x+=lov.offset.dx; y+=lov.offset.dy; }
    const text=lov.text!=null?lov.text:f.label;
    // coreBox: a feature label is placed by hand (labelPos) and has no collision
    // logic of its own, so one sited on the town centre would print INSIDE the
    // box. Drop it and say so — the fix is to move labelPos, not to hide the river.
    if(inCore([x,y])){
      warn('coreBox: feature label "'+text+'" sits inside the town-centre box and was not '
        +'drawn — move its labelPos (routes.json features[] / overrides internal.features).');
      return;
    }
    // Same trap on the other side of the sheet, and it had actually happened: a
    // feature label is drawn OUTSIDE the map's clip group, so a labelPos right of
    // the frame lands in the Services panel and prints through the route list.
    // Wisbech shipped for months with "River Nene" struck across "46 Wisbech –
    // March" and "A47" adrift in the blank space under the Key. Neither the panel
    // metric (which counts point labels) nor the byte gate can see it, so refuse
    // to draw it and say why — as with coreBox, the fix is the labelPos.
    if(x>MX1+2){
      refuse('panel: feature label "'+text+'" sits at x='+x.toFixed(0)+', right of the map frame '
        +'(x'+MX1+') and inside the Services panel — not drawn. Move its labelPos '
        +'(routes.json features[] / overrides internal.features).');
      return;
    }
    // And the third edge, found 2026-08-15 the same way the Wisbech one was — by
    // asking why a number would not move. Six sheets were shipping a river, canal
    // or railway label sited BELOW the frame, at y=196..200 against a footer plate
    // starting at 195.16: drawn, then covered, so those features went unlabelled
    // and no-one could see why. footerSafe does not help, because a feature label
    // is drawn outside the map's clip group. Refuse it and say so, as above.
    if(FOOTER_SAFE && y>FOOTER_PLATE_TOP-1.5){
      refuse('footer: feature label "'+text+'" sits at y='+y.toFixed(0)+', under the footer plate '
        +'(top y'+FOOTER_PLATE_TOP.toFixed(1)+') where it is painted and then covered — not drawn. '
        +'Move its labelPos (routes.json features[] / overrides internal.features).');
      return;
    }
    // THE FOURTH QUESTION, and the one the three guards above never asked: is the
    // label anywhere near the thing it names? Each of those refuses a label that
    // lands somewhere it cannot be READ; none checks whether it lands somewhere it
    // means anything. Seven were stranded across the board when the sheets were
    // printed on 2026-08-16 — Beaconsfield's "A355" 106mm from the A355 on a 190mm
    // frame, High Wycombe's "Chiltern Main Line" 78mm from its railway, and Ramsey's
    // "River Nene (Old Course)" 82mm from the river on the very sheet whose write-up
    // records the label as having been moved "onto the river it names". It was moved
    // out of the corner; nothing checked where it landed. A guard on one edge wants
    // all the edges enumerated, and a guard on legibility wants the question about
    // meaning asked beside it.
    //
    // A warning, not a refusal: unlike the three above, the label is legible and
    // the remedy is a judgement about where the feature reads best. 25mm matches
    // quality_metrics.js's featureLabelMaxMm so the build and the gate agree.
    {
      // Report the REMEDY, not only the fault, and report it about the ink the READER
      // can see. The guard used to say a label named nothing and leave whoever read it
      // to find the feature by eye on a 297x210 sheet — most of why six towns still
      // carried a stranded label a day after the guard was written.
      //
      // MEASURED INSIDE THE FRAME, because a feature polyline does not stop at the map
      // edge — it is CLIPPED there. Huntingdon's Great Ouse runs on to y=277 on a sheet
      // whose frame ends at 182, so the nearest ink to its label was 28mm below the
      // bottom of the page: the unclipped measure said 29mm and looked survivable, and
      // the reader sees no river within reach of the words at all. The clipped measure
      // is the one that matches the artwork, and the suggested spot has to be a place
      // the feature is actually drawn.
      const inFrame = q => q[0]>=MX0 && q[0]<=MX1 && q[1]>=MY0 && q[1]<=MY1;
      let best = Infinity, nearest = null, anyInk = false, seen = 0;
      const mids = [];
      for(const seg of featSegs(f)){
        const vis = [];
        for(let i=0;i<seg.length-1;i++){
          const a=seg[i], b=seg[i+1], vx=b[0]-a[0], vy=b[1]-a[1], l2=vx*vx+vy*vy;
          anyInk = true;
          // Sample the segment rather than only testing its ends: a long span can cross
          // the frame without either endpoint being inside it.
          const n = Math.max(2, Math.min(64, Math.ceil(Math.hypot(vx,vy)/2)));
          for(let k=0;k<=n;k++){
            const px=a[0]+vx*k/n, py=a[1]+vy*k/n;
            if(!inFrame([px,py])) continue;
            seen++; vis.push([px,py]);
            const d = Math.hypot(px-x, py-y);
            if(d < best){ best = d; nearest = [px,py]; }
          }
        }
        if(vis.length) mids.push(vis[Math.floor(vis.length/2)]);
      }
      const at = p => '('+p[0].toFixed(0)+','+p[1].toFixed(0)+')';
      if(!anyInk)
        refuse('feature: label "'+text+'" has no geometry of its own on this sheet at all — check the features[] key against the drawn data.');
      else if(!seen)
        refuse('feature: label "'+text+'" has geometry, but none of it lands inside the map frame ('+MX0+','+MY0+' to '+MX1+','+MY1.toFixed(0)+') — '
          +'every part of it is clipped away, so the label names nothing that is drawn. Drop it from features[], or check the projection.');
      else if(best > 25)
        refuse('feature: label "'+text+'" at '+at([x,y])+' is '+best.toFixed(0)+'mm from the nearest DRAWN '+(f.key||f.type)+' ink — it names nothing where it sits. '
          +'Inside the frame the ink runs through '+mids.slice(0,4).map(at).join(' ')+(mids.length>4?' …':'')+'; nearest drawn point '+at(nearest)+'. '
          +'Move its labelPos there (routes.json features[] / overrides internal.features).');
    }
    const italic=f.labelItalic!==false, size=f.labelSize||4, anchor=lov.anchor||null;
    out(`<text x="${x}" y="${y}" font-family="Arial" ${italic?'font-style="italic" ':''}font-size="${size}"${anchor?` text-anchor="${anchor}"`:''} fill="${f.labelColor||'#7fb0d8'}">${esc(text)}</text>`);
  }
  return drawFeatureLabel;
}

module.exports = { featureLabels };
