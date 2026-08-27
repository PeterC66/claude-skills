/*
 * services_panel.js — the sheet's right-hand column: the Services list, the
 * pictogram Key, the frequency-tier rows and the fare note.
 *
 * CONTRACT. `drawServicesPanel(deps)` DRAWS and returns nothing. That is not a
 * simplification — it is the measured interface. Every one of the thirty-odd
 * names the block declares (`PX`, `py`, `PS`, `lastSubY`, `KROW_FIT`, `KEYROWS`
 * …) was checked for a use below the block and not one has one, so the panel is
 * a pure sink: it consumes the town and appends to the caller's document. The
 * only apparent exception is `py`, which reappears in the north arrow twelve
 * lines later as a block-scoped `const py=c` — a shadow, not this one.
 *
 * WHY IT IS ONE MODULE AND NOT FOUR. The list, the Key, the tier rows and the
 * fare note are four subjects, and `py` threads through all of them: each one
 * starts where the last finished. Splitting on the headings would mean handing
 * `py`, `lastSubY`, `KEY_PER_COL` and `KROW_FIT` back and forth across four
 * boundaries, which is a wider interface than the whole module has now.
 *
 * FOUR LAYOUTS, one of which is the plain one. The list is drawn by exactly one
 * of `panelCorridors` (one row per drawn lane, badges stacked), `panelGroups`
 * (headed by operator), `panelCols` (multi-column) or the plain single column,
 * and the four have historically drifted apart — `subFit` had to be added to a
 * fourth copy after St Ives shipped a subtitle running off the trim, because
 * that town groups by operator and so never reached the branch that had just
 * been fixed. Anything given to one of them belongs in all four.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3), verbatim,
 * re-indented two spaces and otherwise unchanged.
 */
'use strict';

function drawServicesPanel(deps) {
  const {
    out, esc, badge, badgeXWs, icon,   // drawing: the document is the CALLER's
    OV,                                // overrides.internal — panel.x / panel.y
    RJ, DESIGN, INTDESC,               // routes.json, its design block, internalDesc
    FONT,                              // font_metrics.js, for textWidth()
    PANEL_SCALE_ON, PRINT_SAFE,        // design.panelScale / design.printSafe
    FOOTER_SAFE, FOOTER_PLATE_TOP,     // what the Key's pitch must clear
    CORR, CPAL, laneKey,               // the corridor families and their palette
    TRIM,                              // drawn geometry, to spot a badged-but-undrawn service
    panelOrder, order,                 // the panel's list order; the DRAWN order
    pois,                              // which Key pictogram rows this sheet earns
    FTIER, FTIER_LABEL,                // design.frequencyTiers and its default words
    IR, ICON_INK, ICON_SET,            // internalRoads stroke width; the icon style
  } = deps;
  // ---------- right service panel ----------
  const PX=(OV.panel&&OV.panel.x!=null)?OV.panel.x:200; let py=(OV.panel&&OV.panel.y!=null)?OV.panel.y:14;
  const PROW=RJ.panelRow||8, KROW=RJ.keyRow||4.4, PBR=RJ.panelBadge||4;
  // design.badgeFit: ONE badge-column width for the whole panel, not one per row.
  // Sizing each row to its own badge was the first cut and it looked worse than the
  // bug: three pills at the bottom of Ramsey's list pushed only their own titles
  // right, so the panel gained a ragged title column and a ragged badge column at
  // once. A panel is a table — the badges centre in one column and every title
  // starts at the same x. Zero when no route in the list needs a pill, so an
  // ungated panel is drawn exactly as before.
  const PXW = badgeXWs(panelOrder, PBR);
  // panelCols (optional) — multi-column Services panel. Absent => single column.
  const PCOLS=(RJ.panelCols&&(RJ.panelCols.cols|0)>1)?RJ.panelCols:null;

  /* design.panelScale — one type scale and one heading rhythm for the panel.
   *
   * Before this key the panel drew text at eleven unrelated sizes (5 / 4.4 / 4 /
   * 3.5 / 3.2 / 3 / 2.9 / 2.8 / 2.5 / 2.3 / 1.95) and gave its two section
   * headings, which are peers, different sizes AND different amounts of air:
   * measured on Beaconsfield, `Services` had 5.9 mm of clear space beneath it and
   * `Key` had 3.2 mm, while `Key` had barely more air above it (3.6 mm) than
   * below — so the heading read as floating between the two lists rather than
   * belonging to the one under it. Uneven panel rhythm is among the fastest
   * amateur tells and is entirely arithmetic to fix (plan §4.4).
   *
   * The scale is a 1.2 ratio anchored on the route title and floored just above
   * the 2.4 mm print-legibility threshold quality_metrics.js enforces — the dense
   * two-column subtitle was 2.3 mm and failed it:
   *
   *     2.45  ·  2.9  ·  3.5  ·  (4.2)  ·  5.0
   *
   *   5.0   section heading — `Services` and `Key`, now the same size
   *   3.5   route title (single column and grouped)
   *   2.9   route subtitle, operator group header, Key item, fare note, and the
   *         route title in a dense multi-column panel (one step down)
   *   2.45  subtitle in a dense multi-column panel
   *
   * 4.2 is a step of the scale that nothing in the panel needs; it is listed so
   * the 3.5 → 5.0 jump reads as skipping a step rather than as an arbitrary gap.
   *
   * The rhythm: one rule for every heading, expressed as CLEAR AIR between real
   * ink (cap-top to descender) rather than between baselines — so a 5 mm heading
   * gets the same optical gap over 3.5 mm titles as it does over 2.9 mm Key
   * items, which a fixed baseline step cannot give. Air above a section heading
   * is deliberately larger than air below it, the asymmetry panelGroups already
   * discovered by hand on 2026-08-11 and got backwards on its first attempt.
   *
   * Absent => every size and every gap is exactly the hand-tuned value it was,
   * byte for byte (invariant 2).
   */
  const PS = PANEL_SCALE_ON ? { head:5.0, title:3.5, sub:2.9, dense:2.45 } : null;
  const CAP=0.72, DESC=0.21;      // Arial cap-height / descender, as a fraction of size
  const AIR_BELOW_HEAD=3.2, AIR_ABOVE_HEAD=5.0;    // section heading (Services, Key)
  const AIR_ABOVE_GROUP=3.4, AIR_BELOW_GROUP=2.0;  // operator group header, a lesser break
  // Baseline-to-baseline distance leaving `air` mm of clear space between the
  // descenders of one line and the topmost ink of the next. `rise` is how far that
  // ink stands above ITS baseline — cap-height for a plain line of text, but the
  // route badge and the Key pictogram both stand higher than the text beside them,
  // and they are what the eye reads as the top edge of the row. Measuring to the
  // cap-height instead put `Services` visibly tighter to its first badge than
  // `Key` was to its first symbol, even though the arithmetic said they matched.
  const gapDown=(from,air,rise)=>from*DESC+air+rise;
  // Topmost ink above the baseline, per row type.
  const RISE_ROW   = PS ? Math.max(PS.title*CAP, PBR-0.6) : 0;   // badge row, full size
  const RISE_HEAD  = PS ? PS.sub*CAP : 0;                        // operator group header
  const RISE_KEY   = PS ? Math.max(PS.sub*CAP, 2.0+1) : 0;       // 2.0 mm-radius pictogram
  // A single-column route block is a fixed 3.6 mm title-to-subtitle leading inside
  // a `panelRow` pitch, so the air between one row's subtitle and the NEXT row's
  // badge is whatever `panelRow` has left over. The test is simply that they must
  // not touch, with 0.3 mm of tolerance: the default 8.0 clears it with 0.39 mm,
  // and St Ives' 6.8 with a 3.2 mm badge does not — its badges and the subtitles
  // above them are in contact. Report it rather than change `panelRow` here; the
  // pitch is the town's, and widening it lengthens the whole panel.
  if(PS && !PCOLS){
    const needRow = 3.6 + gapDown(PS.sub,0.3,RISE_ROW);
    if(PROW < needRow) process.stderr.write(`panelScale: panelRow ${PROW}mm leaves ${(PROW-3.6-PS.sub*DESC-RISE_ROW).toFixed(2)}mm between a subtitle and the badge below it (wants >= ${needRow.toFixed(1)}mm at ${PS.title}/${PS.sub}mm with a ${PBR}mm badge).\n`);
  }

  /* ---- design.panelCorridors — the panel carries the structure the MAP draws ----
   *
   * Rung 1 of the complexity ladder (internalCorridors) draws a family of co-running
   * services as ONE line carrying a stack of badges; rung 3 (corridorPalette) colours
   * by corridor. The Services panel then listed every service as an equal,
   * individually-badged row and silently undid both — High Wycombe printed 22 rows
   * for the 14 lanes its own map draws, which is what forced the 4.9 mm row pitch
   * that sits its subtitles on the descenders of the titles below them. So the panel,
   * not the pitch, was the over-stuffing (plan Phase 7; §4.4 warned about it here).
   *
   * ONE ROW PER LANE, wearing the badge stack the map already draws. 22 rows become
   * 14 at a pitch the type scale can carry, with no third column and no dropped
   * subtitles. The external spider has always worked this way (external[].routes).
   *
   * A lane of one route draws exactly as a panel row always has: badge left, title
   * and subtitle beside it. A lane of several puts its badge stack on its OWN line,
   * left-aligned at the column edge, above the text — six 5.2 mm discs are 34 mm
   * across and no title survives what is left of a 49 mm column. Either way EVERY
   * TITLE STARTS AT THE SAME X: a panel is a table, the lesson design.badgeFit
   * learned the expensive way (2026-08-16). The hanging stack then reads as the
   * row's heading, which is what a corridor is.
   *
   * The words come from `corridorDesc: {"<lead>":[title,subtitle]}` — internalDesc's
   * twin for a lane. The badges carry the numbers, so the row's words are about
   * where the CORRIDOR goes, and "these services run together to there" is a claim
   * about the real world: it is declared, never inferred (as internalCorridors
   * itself is). Absent, the lead's own internalDesc is used and the engine says so
   * on stderr rather than quietly labelling six services with one's destination.
   *
   * Absent the key ⇒ this branch never runs and the panel is byte-identical.
   */
  const PCORR = (DESIGN.panelCorridors && CORR)
    ? (DESIGN.panelCorridors===true ? {} : DESIGN.panelCorridors) : null;
  if(DESIGN.panelCorridors && !CORR)
    process.stderr.write('panelCorridors: this town has no internalCorridors, so its panel already lists one row per drawn lane — key ignored.\n');

  /*
   * A SERVICE BADGED IN THE PANEL WITH NO LINE ON THE MAP.
   *
   * "VL14 has a service badge but I cannot see any route" — Peter, reading the
   * printed St Ives sheet, 2026-08-16. He was right: VL14 appears exactly once in
   * the whole SVG, as a panel badge, with zero paths in its colour. A sweep found
   * St Neots' 69 doing the same. It happens legitimately — a service too infrequent
   * or too far out of town for the geometry to survive trimming — but the panel is
   * the sheet's own index of itself, so a row with no line sends the reader hunting
   * for something that is not there. Either draw it, or say so.
   *
   * Saying so is the cheaper and more honest half, and it is what this does. The
   * warning is unconditional (stderr changes no bytes); the words on the sheet are
   * gated, like everything else here.
   */
  const NOT_DRAWN = new Set(panelOrder.filter(r=>!(TRIM && TRIM[r] && TRIM[r].pts && TRIM[r].pts.length>=2)));
  for(const r of NOT_DRAWN)
    process.stderr.write(`panel: service ${r} is badged in the Services panel but draws no line on the map — either its geometry is missing/trimmed away, or the row should say it is not shown.\n`);
  // Appended to the row's own subtitle so it inherits that row's size and colour
  // and needs no new furniture. RJ.notShownNote overrides the words.
  //
  // IT MUST FIT THE ROW IT IS APPENDED TO. The plain panel row has no width
  // discipline at all — only the corridor branch measures — so the first cut of
  // this pushed St Neots' "Mon–Fri · Stephensons · Tesco stop only" out to 2.37mm
  // from the trim by adding to it. Adding text to fix a print-margin defect, and
  // creating a print-margin defect. So: measure, and fall back to a shorter form
  // before giving up. A row that cannot hold even "not shown" keeps its subtitle
  // intact and says so on stderr — the note is worth less than the words it would
  // push off the page, and the stderr line is what a build reader acts on.
  const NOT_SHOWN_NOTE = RJ.notShownNote || 'not shown on this map';
  const NOT_SHOWN_SHORT = RJ.notShownNoteShort || 'not shown';
  function panelSub(routeKey, sub, x, size){
    if(PRINT_SAFE==null || !NOT_DRAWN.has(routeKey)) return sub;
    const avail = (297-PRINT_SAFE) - x;
    for(const note of [NOT_SHOWN_NOTE, NOT_SHOWN_SHORT]){
      const t = sub ? sub+' · '+note : note;
      if(FONT.textWidth(t,size,false) <= avail) return t;
    }
    process.stderr.write(`panel: service ${routeKey} draws no line, but its row has no room to say so — "${sub}" already fills the column. Shorten the subtitle, or set routes.json notShownNoteShort.\n`);
    return sub;
  }
  /* subFit — the width discipline the comment above says the plain row does not have.
   *
   * Returns the size (mm) to SET a subtitle at so it fits the space it is given,
   * shrinking no further than the 2.4mm print-legibility floor and reporting on stderr
   * when even that will not do. This is exactly what the panelCorridors branch has done
   * since printSafe landed; the panelCols and plain branches simply never got it, so a
   * subtitle one word too long ran off its column — or off the sheet — in silence.
   *
   * It became load-bearing when the frequency tiers landed: rule 3 of the tier model is
   * that every Limited lane carries a phrase saying WHICH kind of limited it is, and a
   * phrase is 16-28mm of type appended to rows that were already 40-78mm wide. Seven of
   * the thirty-one Limited rows across the eight towns overflowed by 1-17mm. Shrinking
   * those seven a little is a far better answer than shortening real destination lists
   * to hit a ruler, and it means the next subtitle edit is caught rather than shipped.
   *
   * `right` is the boundary the text must not cross: its own column's right edge on a
   * multi-column panel, or the print-safe trim on a single-column one.
   */
  function subFit(routeKey, sub, x, size, right){
    if(!sub) return size;
    const w = FONT.textWidth(sub, size, false);
    if(x + w <= right) return size;
    const want = size * (right - x) / w;
    if(want >= 2.4) return Math.floor(want*100)/100;
    process.stderr.write(`panel: service ${routeKey}'s subtitle "${sub}" needs ${want.toFixed(2)}mm type to fit its column, below the 2.4mm print floor — shorten it in routes.json internalDesc.\n`);
    return 2.4;
  }

  out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="${PS?PS.head:5}" fill="#222">Services</text>`);
  if(!PS) py+=2;
  let lastSubY=py;                // baseline of the last line drawn in the services list
  if(PCORR){
    // ---- one row per lane, in panelOrder order, deduped by lane key -------------
    const lanes=[], seenLane=new Set();
    for(const r of panelOrder){ const k=laneKey(r); if(seenLane.has(k)) continue; seenLane.add(k);
      const mem=(CORR.fam[k]||[k]).filter(m=>panelOrder.includes(m));
      lanes.push({key:k, mem:mem.length?mem:[k]}); }
    const nCol = Math.max(1, (PCORR.cols|0) || (PCOLS?(PCOLS.cols|0):0) || 1);
    let cw     = PCORR.width || (PCOLS&&PCOLS.width) || 96;
    // THE PANEL CAN RUN OFF THE PAGE, AND NOTHING SAID SO. High Wycombe sits its
    // panel at x=200 with two 49mm columns: 200+98 = 298 on a 297mm page, so the
    // second column's longest subtitle printed 1.54mm from the right trim — the
    // worst measurement in the whole 2026-08-16 print check. The row-fits-column
    // warning below could never catch it, because the row DID fit its column; it
    // was the column that did not fit the sheet. A guard on one edge wants all the
    // edges enumerated, again.
    {
      const edge = PRINT_SAFE!=null ? 297-PRINT_SAFE : 297;
      if(PX+nCol*cw > edge+0.01){
        const fit = Math.floor((edge-PX)/nCol*100)/100;
        if(PRINT_SAFE!=null){
          process.stderr.write(`panelCorridors: ${nCol} columns of ${cw}mm from x=${PX} reach ${(PX+nCol*cw).toFixed(1)}mm, past the ${PRINT_SAFE}mm print margin at ${edge}mm — narrowed to ${fit}mm each. Move the panel left (overrides.panel.x) to keep the configured width.\n`);
          cw = fit;
        } else {
          process.stderr.write(`panelCorridors: ${nCol} columns of ${cw}mm from x=${PX} reach ${(PX+nCol*cw).toFixed(1)}mm on a 297mm page — the last column runs off the sheet. Set design.printSafe, narrow the column, or move the panel left.\n`);
        }
      }
    }
    const dense= nCol>1;                       // a multi-column panel steps the type down
    const TS = PS ? (dense?PS.sub:PS.title) : (dense?2.9:3.5);
    const SS = PS ? (dense?PS.dense:PS.sub)  : (dense?2.3:2.8);
    const BR = PCORR.badgeR || (dense?2.6:PBR-0.6);
    const BGAP = PCORR.badgeGap!=null?PCORR.badgeGap:0.6;
    const RGAP = PCORR.rowGap!=null?PCORR.rowGap:1.6;
    const BXW = badgeXWs(panelOrder,BR);       // design.badgeFit: ONE badge column width
    const bw  = 2*(BR+BXW);                    // one badge's drawn width
    const SUBDROP = TS*DESC + 0.45 + SS*CAP;   // title baseline -> subtitle baseline
    const SLEAD = SS*1.35;                     // subtitle line to subtitle line
    const TX  = bw + 2.4;                      // title x, measured from the column edge
    const CD  = RJ.corridorDesc||{};
    const rows = lanes.map(L=>{
      const stacked = L.mem.length>1;
      const d0 = (stacked && CD[L.key]) || INTDESC[L.key] || [L.key,''];
      // A single-service lane falls back to internalDesc, whose titles carry the
      // route number as a prefix ("33  Totteridge–Desborough") because the ordinary
      // panel is read row by row. In the CORRIDOR panel the badge is drawn right
      // beside the title, so the number is said twice — and the stacked lanes,
      // which use corridorDesc, never say it at all ("Hazlemere & Amersham"). So
      // the two kinds of row disagree about what a title is. Dropping the
      // duplicated prefix makes them agree and takes High Wycombe's widest title
      // from 47.0mm to inside its column, which is how it was noticed.
      //
      // Gated on printSafe rather than given a key of its own: it is one town's
      // panel and the invariant is that absent config means byte-identical output.
      const d = (PRINT_SAFE!=null && !stacked && d0[0])
        ? [String(d0[0]).replace(new RegExp('^'+L.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s+'),'')].concat(d0.slice(1))
        : d0;
      if(stacked && !CD[L.key]) process.stderr.write(`panelCorridors: no corridorDesc["${L.key}"] for the ${L.mem.join('/')} lane — the row is wearing ${L.key}'s own description, which names one service of ${L.mem.length}.\n`);
      const stackW = stacked ? L.mem.length*bw + (L.mem.length-1)*BGAP : bw;
      if(stackW>cw) process.stderr.write(`panelCorridors: the ${L.mem.join('/')} badge stack is ${stackW.toFixed(1)}mm across a ${cw}mm column — widen the column or lower design.panelCorridors.badgeR.\n`);
      // A lane may carry SEVERAL subtitle lines: corridorDesc is [title, ...lines].
      // Six services sharing one road through the town still have six destinations
      // beyond it, and the 22-row panel did say all of them — grouping the rows must
      // not quietly drop that, so the row grows a line instead.
      let sub = d.slice(1).filter(x=>x);
      // A lane can carry several services and only some of them may be drawn, so
      // the note names which — "69 not shown on this map" — rather than casting
      // doubt on the whole row.
      { const missing = L.mem.filter(m=>NOT_DRAWN.has(m));
        if(PRINT_SAFE!=null && missing.length) sub = sub.concat(missing.join(', ')+' '+NOT_SHOWN_NOTE); }
      // WRAP before shrinking. "a lane takes as many subtitle lines as it needs"
      // is already this row's design — the six-service Loudwater corridor uses
      // four — so a subtitle too wide for its column should take another line
      // rather than a smaller size. Shrinking is the fallback for the case wrapping
      // cannot help (a single long word), not the first move. Same wrap rule the
      // corridor note below and footer.js's wrapNotes already use.
      if(PRINT_SAFE!=null){
        const avail = cw - TX, out2 = [];
        for(const ln of sub){
          if(FONT.textWidth(ln,SS,false)<=avail){ out2.push(ln); continue; }
          let cur='';
          for(const wd of String(ln).split(' ')){
            const t = cur ? cur+' '+wd : wd;
            if(cur && FONT.textWidth(t,SS,false)>avail){ out2.push(cur); cur=wd; } else cur=t;
          }
          if(cur) out2.push(cur);
        }
        sub = out2;
      }
      // Title and subtitles are measured SEPARATELY because they are set at
      // different sizes and only one of them can be fitted. Taking the max of the
      // two — as this did on its first cut — computes a shrink ratio from the
      // BOLD TITLE's width and then applies it to the subtitle, which is both
      // wrong and invisible: the row still overflows and the type is smaller for
      // nothing. A title too wide for its column is a wording problem and says so.
      const titleW = FONT.textWidth(d[0],TS,true);
      const subW = sub.length ? Math.max(...sub.map(x=>FONT.textWidth(x,SS,false))) : 0;
      const wid = Math.max(titleW, subW);
      // Under printSafe an overflowing SUBTITLE is fitted rather than only
      // complained about — the same move badgeFit made for a number too wide for
      // its disc: measure the real Arial width and adapt the drawing. The 2.4mm
      // floor is the print-legibility threshold and is not negotiable, so a row
      // that cannot fit above it is left at size and reported.
      let ss = SS;
      if(PRINT_SAFE!=null && TX+subW>cw){
        const want = SS*(cw-TX)/subW;
        if(want>=2.4) ss = Math.floor(want*100)/100;
        else process.stderr.write(`panelCorridors: the ${L.key} row's SUBTITLE needs ${want.toFixed(2)}mm type to fit a ${cw}mm column, below the 2.4mm print floor — shorten its corridorDesc/internalDesc or widen the column.\n`);
      }
      if(PRINT_SAFE!=null && TX+titleW>cw)
        process.stderr.write(`panelCorridors: the ${L.key} row's TITLE "${d[0]}" runs to ${(TX+titleW).toFixed(1)}mm in a ${cw}mm column — a title is not fitted down, so shorten it.\n`);
      else if(TX+wid>cw) process.stderr.write(`panelCorridors: the ${L.key} row's text runs to ${(TX+wid).toFixed(1)}mm in a ${cw}mm column${ss!==SS?` — subtitle fitted to ${ss}mm`:''}.\n`);
      // Title baseline measured from the TOP of the row: under the stack when the
      // badges take their own line, beside the badge when there is only one.
      const titleBase = stacked ? 2*BR + 1.0 + TS*CAP : BR - 0.6;
      const textH = sub.length ? titleBase + SUBDROP + (sub.length-1)*SLEAD + ss*DESC
                               : titleBase + TS*DESC;
      return {mem:L.mem, key:L.key, d:[d[0]].concat(sub), titleBase, ss,
              h: Math.max(stacked?0:2*BR, textH)};
    });
    // Balance the columns by HEIGHT, not by row count — a lane with a stacked badge
    // line is twice the height of a plain one, so seven-and-seven would be lopsided.
    // Contiguous runs, so a column still reads top-to-bottom (column-major, as the
    // panelCols branch does).
    const target = (rows.reduce((a,r)=>a+r.h+RGAP,0)-RGAP)/nCol;
    const colOf = new Array(rows.length).fill(0);
    { let c=0, acc=0;
      for(let i=0;i<rows.length;i++){
        const rem=rows.length-i, colsLeft=nCol-c;
        // Break when carrying this row would take the column further past the target
        // than stopping short of it does — and always when the rows left exactly fill
        // the columns left, so no column can come out empty.
        if(c<nCol-1 && acc>0 && (rem===colsLeft
          || (rem>colsLeft && Math.abs(acc+rows[i].h+RGAP-target) > Math.abs(acc-target)))){ c++; acc=0; }
        colOf[i]=c; acc+=rows[i].h+RGAP;
      }
    }
    const top0 = PS ? py + PS.head*DESC + AIR_BELOW_HEAD : py + 4;
    const colY = new Array(nCol).fill(top0);
    let bottom = top0;
    rows.forEach((r,i)=>{
      const c=colOf[i], cx=PX+c*cw, top=colY[c];
      r.mem.forEach((m,j)=> badge(cx+BR+BXW+j*(bw+BGAP), top+BR, m, BR));
      const tb=top+r.titleBase;
      out(`<text x="${(cx+TX).toFixed(2)}" y="${tb.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${TS}" fill="#111">${esc(r.d[0])}</text>`);
      r.d.slice(1).forEach((ln,k)=>out(`<text x="${(cx+TX).toFixed(2)}" y="${(tb+SUBDROP+k*SLEAD).toFixed(2)}" font-family="Arial" font-size="${r.ss}" fill="#555">${esc(ln)}</text>`));
      colY[c]=top+r.h+RGAP; bottom=Math.max(bottom, colY[c]-RGAP);
    });
    lastSubY = bottom - SS*DESC;
    // ---- say the corridor rule on the sheet (Phase 7, item 1) -------------------
    // The triage plan required rung 3 be "stated in the key" and it never was. A
    // reader seeing 22 numbers in 11 hues, four of them shared, can only conclude
    // that the palette ran out — which is precisely the impression the rung exists
    // to prevent. It is one sentence, and it belongs under the list it explains.
    if(RJ.corridorNote!==false){
      const txt = RJ.corridorNote || (CPAL
        ? 'Buses that run the same roads through the town are drawn as one line carrying every number, and routes along the same corridor share a colour.'
        : 'Buses that run the same roads through the town are drawn as one line carrying every number.');
      const noteW=nCol*cw-2, lines=[]; let cur='';
      for(const wd of String(txt).split(' ')){ const t=cur?cur+' '+wd:wd;
        if(cur && FONT.textWidth(t,SS,false)>noteW){ lines.push(cur); cur=wd; } else cur=t; }
      if(cur) lines.push(cur);
      const ny=bottom+2.6+SS*CAP, lead=SS*1.35;
      lines.forEach((ln,i)=>out(`<text x="${PX}" y="${(ny+i*lead).toFixed(2)}" font-family="Arial" font-size="${SS}" fill="#555">${esc(ln)}</text>`));
      lastSubY = ny+(lines.length-1)*lead;
      bottom = lastSubY + SS*DESC;
    }
    // A pinned Key cannot move out of the way, so say when the list has grown into it.
    if(PCOLS&&PCOLS.keyAt&&PCOLS.keyAt.y!=null && bottom > PCOLS.keyAt.y-(PS?PS.head*CAP:3.2))
      process.stderr.write(`panelCorridors: the services list now ends at y=${bottom.toFixed(1)}mm and the pinned Key starts at ${(PCOLS.keyAt.y-(PS?PS.head*CAP:3.2)).toFixed(1)}mm — move panelCols.keyAt.y down or add a column.\n`);
    py = bottom;
  } else if(RJ.panelGroups){
    // group the panel by operator (operators[] from routes.json)
    const groups=(RJ.operators||[]).map(op=>({name:op.name, rs:panelOrder.filter(r=>(op.routes||[]).includes(r))})).filter(g=>g.rs.length);
    const ungrouped=panelOrder.filter(r=>!groups.some(g=>g.rs.includes(r)));
    if(ungrouped.length) groups.push({name:'', rs:ungrouped});
    let firstBlock=true;
    for(const g of groups){
      // Group-header spacing is deliberately asymmetric: more room ABOVE the
      // header (to read as a break from the previous group) than BELOW it
      // (the header sits right above its own routes, not floating between
      // them) — was 5.4/PROW(8), i.e. backwards, until 2026-08-11.
      if(g.name){
        if(PS) py = (firstBlock ? py + gapDown(PS.head,AIR_BELOW_HEAD,RISE_HEAD)
                                : lastSubY + gapDown(PS.sub,AIR_ABOVE_GROUP,RISE_HEAD));
        else py+=7.5;
        out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="${PS?PS.sub:2.9}" fill="#777">${esc(g.name.toUpperCase())}</text>`);
      }
      g.rs.forEach((r,i)=>{
        const d=INTDESC[r]||[r,''];
        // `py` is the badge CENTRE; the title baseline sits 0.6 mm above it, so the
        // 0.6 converts a baseline-to-baseline gap into a row anchor.
        if(PS){
          if(i>0 || (!g.name && !firstBlock)) py += PROW;
          else if(g.name) py += gapDown(PS.sub,AIR_BELOW_GROUP,RISE_ROW) + 0.6;
          else py += gapDown(PS.head,AIR_BELOW_HEAD,RISE_ROW) + 0.6;
        } else py += (g.name && i===0) ? PROW-1.5 : PROW;
        badge(PX+4+PXW,py,r,PBR);
        out(`<text x="${PX+10+2*PXW}" y="${py-0.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.title:3.5}" fill="#111">${esc(d[0])}</text>`);
        // subFit — see the plain branch below. This grouped branch is a FOURTH copy of
        // the same three lines and was missed on the first pass, which is exactly how
        // St Ives shipped "…gaps of over 2 ho" and "…morning & evening or" running off
        // the trim: the town groups its panel by operator, so it never reaches the plain
        // branch that had just been given the measurement.
        const _gx=PX+10+2*PXW, _gsz=PS?PS.sub:2.8, _gtext=panelSub(r,d[1],_gx,_gsz);
        const _gfz=(PRINT_SAFE==null)?_gsz:subFit(r,_gtext,_gx,_gsz,297-PRINT_SAFE);
        out(`<text x="${_gx}" y="${py+3.0}" font-family="Arial" font-size="${_gfz}" fill="#555">${esc(_gtext)}</text>`);
        lastSubY=py+3.0;
      });
      firstBlock=false;
    }
  } else if(PCOLS){
    // multi-column panel: a town with more services than one column fits on A4.
    // Column-major so a column reads top-to-bottom like the single-column panel.
    const nCol=Math.max(1,PCOLS.cols|0), cw=PCOLS.width||48, crow=PCOLS.row||PROW;
    // Badge radius must fit inside whatever row pitch this town picked, or
    // consecutive rows' bubbles overlap (High Wycombe: row 4.9 vs the old
    // fixed PBR-0.6=3.4 radius/6.8 diameter — badges overlapped). Shrink to
    // fit crow, down to a legibility floor of 1.8mm; if even that overlaps,
    // the row pitch itself is too tight and needs widening/another column —
    // warn rather than silently print unreadable or overlapping badges.
    const pcolsBadgeR = Math.min(PBR-0.6, Math.max(1.8, crow/2-0.5));
    if (2*pcolsBadgeR+0.3 > crow) process.stderr.write(`panelCols: row ${crow}mm is too tight even at the ${pcolsBadgeR.toFixed(1)}mm badge floor (needs >= ${(2*1.8+0.3).toFixed(1)}mm) — widen row or add a column.\n`);
    // Under the type scale a dense row carries a 2.9 mm title over a 2.45 mm
    // subtitle; if the row pitch cannot hold both with air between the blocks,
    // say so rather than letting the subtitle silently crowd the title below it.
    // The remedy is a column or a wider row (config), not a smaller type size —
    // 2.45 mm is already the print-legibility floor.
    const riseDense = PS ? Math.max(PS.sub*CAP, pcolsBadgeR-0.6) : 0;
    if (PS){
      const need = gapDown(PS.sub,0.15,PS.dense*CAP) + gapDown(PS.dense,0.8,riseDense);
      if (crow < need) process.stderr.write(`panelScale: panelCols row ${crow}mm cannot carry the type scale (needs >= ${need.toFixed(1)}mm for ${PS.sub}mm over ${PS.dense}mm) — the panel is over-stuffed. Add a column, widen the row, or drop the subtitles on this town.\n`);
    }
    // design.badgeFit: one badge-column width across every column, same argument as
    // PXW above — and here the row has a hard right edge (the next column), so say
    // so rather than silently running a title into it. The remedy is a wider
    // `panelCols.width`, which only the town knows whether it can afford.
    const CXWP = badgeXWs(panelOrder, pcolsBadgeR);
    if(CXWP>0 && nCol>1){
      const widest = Math.max(...panelOrder.map(r=>FONT.textWidth((INTDESC[r]||[r,''])[0], PS?PS.sub:2.9, true)));
      if(7.6+2*CXWP+widest > cw)
        process.stderr.write(`badgeFit: the widened badge column pushes a panelCols title to ${(7.6+2*CXWP+widest).toFixed(1)}mm in a ${cw}mm column — widen panelCols.width.\n`);
    }
    const per=Math.ceil(panelOrder.length/nCol);
    // First row's anchor comes from the heading rule; later rows step by `crow`.
    const top = PS ? py + gapDown(PS.head,AIR_BELOW_HEAD,riseDense) + 0.6 - crow : py;
    panelOrder.forEach((r,i)=>{
      const col=Math.floor(i/per), row=i%per;
      const cx=PX+col*cw, cy=top+(row+1)*crow;
      const d=INTDESC[r]||[r,''];
      badge(cx+3+CXWP,cy,r,pcolsBadgeR);
      // Subtitle sits ~35% of the row pitch below its own title, not at a
      // fixed +3.1mm offset or an even 50/50 split — a 50/50 split (2026-08-11)
      // fixed the previous overlap but read as too close above the title/too
      // loose below it once seen printed; skewing the split gives the title
      // more clear air above (from the previous row's subtitle) while pulling
      // its own subtitle in tighter underneath (2026-08-11, second pass).
      const subY=cy-0.6+crow*0.35+0.1;
      out(`<text x="${cx+7.6+2*CXWP}" y="${cy-0.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.sub:2.9}" fill="#111">${esc(d[0])}</text>`);
      // subFit: this row's own column is the boundary, not the sheet — a two-column
      // panel that measured to the trim would let column 1 run under column 2.
      const _sx=cx+7.6+2*CXWP, _ssz=PS?PS.dense:2.3, _stext=panelSub(r,d[1],_sx,_ssz);
      const _sfz=(PRINT_SAFE==null)?_ssz:subFit(r,_stext,_sx,_ssz,cx+cw);
      out(`<text x="${_sx}" y="${subY.toFixed(2)}" font-family="Arial" font-size="${_sfz}" fill="#555">${esc(_stext)}</text>`);
      if(row===per-1) lastSubY=subY;
    });
    py=top+per*crow;
  } else {
  let firstRow=true;
  for(const r of panelOrder){
    const d=INTDESC[r]||[r,''];
    // `py` is the badge CENTRE; the title baseline sits 0.6 mm above it.
    if(PS&&firstRow) py += gapDown(PS.head,AIR_BELOW_HEAD,RISE_ROW)+0.6; else py+=PROW;
    firstRow=false;
    badge(PX+4+PXW,py,r,PBR);
    out(`<text x="${PX+10+2*PXW}" y="${py-0.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.title:3.5}" fill="#111">${esc(d[0])}</text>`);
    // subFit: one column, so the boundary is the print-safe trim (the sheet is 297mm
    // wide). With printSafe absent this keeps the old behaviour — nothing to measure to.
    const _sx=PX+10+2*PXW, _ssz=PS?PS.sub:2.8, _stext=panelSub(r,d[1],_sx,_ssz);
    const _sfz=(PRINT_SAFE==null)?_ssz:subFit(r,_stext,_sx,_ssz,297-PRINT_SAFE);
    out(`<text x="${_sx}" y="${py+3.0}" font-family="Arial" font-size="${_sfz}" fill="#555">${esc(_stext)}</text>`);
    lastSubY=py+3.0;
  }
  }
  // key (using the real pictograms)
  let KX=PX;
  if(PCOLS&&PCOLS.keyAt){ KX=PCOLS.keyAt.x!=null?PCOLS.keyAt.x:PX; py=(PCOLS.keyAt.y!=null?PCOLS.keyAt.y:py+10)-10; }
  // A pinned keyAt.y still wins — the two-column towns place the Key beside the
  // map, not under the list, and only the town knows where that is.
  if(PS && !(PCOLS&&PCOLS.keyAt&&PCOLS.keyAt.y!=null)) py = lastSubY + gapDown(PS.sub,AIR_ABOVE_HEAD,PS.head*CAP) - 10;
  py+=10; out(`<text x="${KX}" y="${py}" font-family="Arial" font-weight="bold" font-size="${PS?PS.head:4.4}" fill="#222">Key</text>`);
  // Only list a category actually drawn on this sheet, the same rule the
  // 'allotments' row already followed on its own — an unused row is dead
  // weight that can crowd out real content below it (High Wycombe's Key listed
  // Town Hall with no Town Hall POI anywhere on the map, and that row was the
  // difference between the "Also serving..." note fitting and not, 2026-08-19).
  // Filtering can only ever REMOVE a row, never add one, so an already-shipped
  // town that happens to use all these categories renders byte-identical.
  const KEY_ALL=[['shop','Supermarket'],['gp','Doctors / GP'],['pharmacy','Pharmacy'],['library','Library'],['museum','Museum'],['leisure','Leisure centre'],['school','School'],['park','Park'],['industrial','Industrial estate'],['community','Community centre'],['townhall','Town Hall']];
  const key=KEY_ALL.filter(([cat])=>pois.some(p=>p.cat===cat));
  if(pois.some(p=>p.cat==='allotments')) key.push(['allotments','Allotments']);
  /* design.keyCols — lay the pictogram rows out in N columns instead of one.
   *
   * The Services panel is ~92mm wide and a Key row is a 4mm symbol plus a name; the longest
   * name in the list ("Community centre", "Industrial estate") measures about 25mm, so a
   * one-column Key uses barely a third of the width it is given and leaves the rest blank
   * all the way down (Peter's item 9). Filtering the unused categories out, which shipped on
   * 2026-08-19, made the list SHORTER without making it any less narrow — it moved the dead
   * space from below the Key to beside it.
   *
   * Only the PICTOGRAM rows column up. The frequency-tier rows underneath keep one column
   * on purpose: their labels are sentences ("Frequent — turn up and go"), not nouns, and
   * two columns of those read as a paragraph broken in half.
   *
   * Column width comes from the panel, not from a constant, so a town that has moved or
   * narrowed its panel gets columns that still fit it.
   *
   * TWO COLUMNS IS THE DEFAULT since 2026-08-24. It was opt-in and 17 of the 18 maps
   * that draw a Key set it to 2; the eighteenth (Ely Co-op) sets 3 because a place has
   * less panel height to spend. The two that set nothing are boarding-only sheets, and
   * gen_boarding.js deliberately does not read this key. `keyCols:1` restores the old
   * single column.
   */
  const KEY_COLS = Math.max(1, Math.min(3, (DESIGN.keyCols|0) || 2));
  const KEY_PER_COL = Math.ceil(key.length / KEY_COLS) || 1;
  const KEY_COLW = ((PRINT_SAFE!=null ? 297-PRINT_SAFE : 294) - PX - 3) / KEY_COLS;
  // The label baseline is ky+1, so the heading rule is applied there and the icon
  // centre follows from it — the same clear air under `Key` as under `Services`.
  const KFIRST = PS ? gapDown(PS.head,AIR_BELOW_HEAD,RISE_KEY)-1 : 5;
  /* KROW_FIT — the Key's row pitch, compressed if the whole Key would otherwise run
   * under the footer plate.
   *
   * design.frequencyTiers adds one Key row per drawn tier (style-guide §9 rule 7: an
   * unexplained line WEIGHT is worse than an unexplained hue, because the reader can see
   * it is deliberate and cannot tell what it claims). On St Ives that is three more rows
   * under a twelve-row pictogram list, and the last of them — "Limited — check times" —
   * landed at y=190.1 with the plate top at 187.6, so it was painted and then covered by
   * an opaque band. A key row that exists but cannot be seen is the worst of both: the
   * sheet draws a weight it does not explain, and pays for the explanation anyway.
   *
   * Compress the pitch to fit rather than drop a row, floor at 3.6mm (the 2.0mm-radius
   * pictograms need ~3.4mm of pitch not to touch), and say so on stderr when even that
   * will not do. Absent the tier rows this is arithmetically the old constant, so every
   * ungated sheet stays byte-identical.
   */
  const KROW_FIT = (()=>{
    // Rows deep, not rows total: with two columns the Key is half as tall, which is the
    // point of the whole change — pitching it as if it were still one column would keep
    // compressing a Key that now has room to breathe.
    const rows = KEY_PER_COL + (FTIER ? new Set(Object.values(RJ.frequency||{})).size + 0.5 : 0);
    if(!FTIER || !FOOTER_SAFE) return KROW;
    const last = py + KFIRST + (rows-1)*KROW + 1;        // baseline of the final row
    const room = FOOTER_PLATE_TOP - 1.5;
    if(last <= room) return KROW;
    const want = (room - py - KFIRST - 1) / (rows-1);
    if(want >= 3.6) return Math.floor(want*100)/100;
    process.stderr.write(`key: ${rows} rows need ${want.toFixed(2)}mm pitch to clear the footer plate, below the 3.6mm pictogram floor — the Key is too long for this panel. Shorten it, or move it with panelCols.keyAt.\n`);
    return 3.6;
  })();
  key.forEach((kk,i)=>{const ky=py+KFIRST+(i%KEY_PER_COL)*KROW_FIT, kx=PX+3+Math.floor(i/KEY_PER_COL)*KEY_COLW;
    out(icon(kk[0],kx,ky,2.0,ICON_INK,ICON_SET));
    // '3.0' as a STRING: the old code emitted the literal font-size="3.0", and
    // JS renders the number 3.0 as "3" — a one-character diff that fails all 27
    // byte-identical gates with the key absent.
    out(`<text x="${kx+4.0}" y="${ky+1}" font-family="Arial" font-size="${PS?PS.sub:'3.0'}" fill="#222">${esc(kk[1])}</text>`);});

  /* The line-weight rows. style-guide §9 rule 7 — a sheet that shares a hue must say
   * why — and an unexplained line WEIGHT is worse, because the reader can see it is
   * deliberate and cannot tell what it claims. Only tiers a drawn lane actually uses
   * get a row: a Key line for a class this town has none of would be a lie about the
   * network, and Ramsey (no frequent lane) and March (none either) are why that is
   * not hypothetical. Config order decides the order, so the town controls it.
   */
  let KEYROWS = KEY_PER_COL;
  if(FTIER){
    /* ...and "actually uses" has to be asked of the DRAWN routes, not of the frequency
     * block. `frequency` is service DATA and covers every service the town has, including
     * the ones the sheet deliberately does not draw and lists in prose instead ("Also
     * serving High Wycombe, not on this map"). Reading its values counted those, so High
     * Wycombe printed BOTH "Limited — check times" and the dashed "Certain dates only"
     * against a sheet on which no drawn lane is either: 27/29/38/158/331/333/334 are the
     * limited ones and 275/WW1 the sparse ones, and not one of the nine is in routeOrder.
     * The guard ran, it just measured the wrong set (Peter, 2026-08-24). `order` is the
     * post-dropHidden draw order, so this is the same population the lanes come from.
     * Measured across all 20 maps on 2026-08-24: High Wycombe is the only one that loses
     * a row, and it loses exactly those two. */
    const used = new Set(order.map(r=>(RJ.frequency||{})[r]).filter(Boolean));
    const tiers = Object.keys(FTIER).filter(t=>used.has(t));
    // The sample occupies exactly the pictogram's footprint (kx±2.0) and the label
    // sits at kx+4.0, so these rows share the POI rows' column and the whole Key
    // reads as one list. A longer sample crowded the label — 1.2 mm of air against
    // the pictograms' 2.0 — and the Key looked like two different tables.
    const kx=PX+3;
    let ty = py+KFIRST+KEY_PER_COL*KROW_FIT + KROW_FIT*0.5;   // half a row of air below the pictograms
    for(const t of tiers){
      const st=FTIER[t]||{}, w=(st.mm!=null)?st.mm:(IR?IR.stroke:2.6);
      const dash=st.dash?` stroke-dasharray="${st.dash}"`:'', cap=st.dash?'butt':'round';
      out(`<path d="M${(kx-2.0).toFixed(2)} ${ty.toFixed(2)}h4.00" fill="none" stroke="#555" stroke-width="${w}"${dash} stroke-linecap="${cap}"/>`);
      out(`<text x="${kx+4.0}" y="${(ty+1).toFixed(2)}" font-family="Arial" font-size="${PS?PS.sub:'3.0'}" fill="#222">${esc(st.label||FTIER_LABEL[t]||t)}</text>`);
      ty+=KROW_FIT; KEYROWS++;
    }
    KEYROWS += 0.5;                                // the air, so the fare note clears it
  }

  // fare note (opt-in routes.json "fareNote") — highlighted box under the key
  if(RJ.fareNote){
    let fy=PS ? py+KFIRST+(KEYROWS-1)*KROW_FIT+1+gapDown(PS.sub,AIR_ABOVE_HEAD,PS.sub*CAP)
              : py+5+KEYROWS*KROW_FIT+9;
    const words=String(RJ.fareNote).split(' '); const lines=[]; let cur='';
    for(const wd of words){ if((cur+' '+wd).trim().length>38){ lines.push(cur.trim()); cur=wd; } else cur+=' '+wd; }
    if(cur.trim()) lines.push(cur.trim());
    out(`<rect x="${PX-2}" y="${fy-4.4}" width="95" height="${(lines.length*3.6+6).toFixed(1)}" rx="1.2" fill="#fff4c2"/>`);
    lines.forEach((ln,i)=>out(`<text x="${PX}" y="${fy+i*3.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.sub:2.9}" fill="#333">${esc(ln)}</text>`));
  }
}

module.exports = { drawServicesPanel };
