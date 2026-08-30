#!/usr/bin/env node
/*
 * prove-red.js — break the engine on purpose, and check the tests notice.
 *
 * WHY THIS FILE EXISTS. "A green check that has never been seen to go red proves
 * nothing" is written into this project's own memory, and it has been paid for
 * more than once: a drift gate that could not run for six weeks, a verify job
 * blind to its own fixture, a board that printed every row correctly and exited
 * 127. A brand-new test suite is exactly the thing that looks like proof and is
 * not. So the suite ships with the falsification alongside it.
 *
 * WHAT IT DOES. Copies assets/ to a scratch directory, then for each mutation
 * below: applies one deliberate edit, runs one test file against the mutated
 * copy (via ENGINE_DIR — see test/_engine.js), and expects that run to FAIL.
 * A mutation the suite does not notice is reported as SURVIVED and exits 1.
 *
 * Nothing under assets/ is touched. Every file there is vendored into the portal
 * and compared by status.js, so an edit in place would surface as portal drift.
 *
 * Run it from make-bus-leaflet:
 *     npm run test:prove-red
 *     node tools/prove-red.js --keep      leave the scratch copy for inspection
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const KEEP = process.argv.includes('--keep');

/* Each mutation names the file it breaks, the exact text it replaces, what it
 * replaces it with, and the test file that is supposed to object. `find` must
 * appear exactly once in the file — an anchor that matches twice or not at all
 * is a mutation that did not do what it says, which would report a false green
 * just as loudly as the bug it is hunting. */
const MUTATIONS = [
  // projection.js - extracted 2026-08-27 from gen_internal.js. Measured the same
  // day, SIX of its branches are taken by no committed map at all: overrides
  // rotationDeg, design.fixedOrientation, footerSafe:false, the three-zone
  // fisheye, a frozen viewport, and the classic model itself. The byte gate
  // certifies none of them.
  { suite: 'projection.test.js', file: 'projection.js',
    what: 'design.fixedOrientation stops outranking internalRoads.rotationDeg, so the top-level key silently loses',
    find: "  else if(FIXED_ORIENTATION!=null) theta = -FIXED_ORIENTATION*Math.PI/180; // design.fixedOrientation",
    to: "  else if(false) theta = -FIXED_ORIENTATION*Math.PI/180; // design.fixedOrientation" },

  { suite: 'projection.test.js', file: 'projection.js',
    what: 'the published rotation loses its sign, so feeding it back as fixedOrientation mirrors the sheet',
    find: "  const APPLIED_ROTATION_DEG = -theta*180/Math.PI;",
    to: "  const APPLIED_ROTATION_DEG = theta*180/Math.PI;" },

  { suite: 'projection.test.js', file: 'projection.js',
    what: 'a frozen viewport is ignored, so hand-placed stops drift on the next data refresh',
    find: "  if(OV.viewport){ ({minX,maxX,minY,maxY,sc,offX,offY}=OV.viewport); }",
    to: "  if(false){ ({minX,maxX,minY,maxY,sc,offX,offY}=OV.viewport); }" },

  { suite: 'projection.test.js', file: 'projection.js',
    what: 'footerSafe:false keeps the short frame, so the escape hatch stops being one',
    find: "    : 205;",
    to: "    : 192.16;" },

  { suite: 'projection.test.js', file: 'projection.js',
    what: 'the three-zone fisheye collapses to a single band, and midKm/outerComp do nothing',
    find: "  const R1  = (IR && IR.focus.midKm!=null)     ? IR.focus.midKm/111.32 : null;",
    to: "  const R1  = null;" },

  { suite: 'projection.test.js', file: 'projection.js',
    what: 'a detail lens forgets its configured radius and always uses the default',
    find: "    R: (z.radiusKm!=null?z.radiusKm:0.5)/111.32,",
    to: "    R: 0.5/111.32," },

  { suite: 'projection.test.js', file: 'projection.js',
    what: 'the footer gap is not rounded, so the frame bottom carries float noise',
    find: "    ? Math.round((FOOTER_PLATE_TOP - (DESIGN.footerGap!=null?DESIGN.footerGap:3.0))*100)/100",
    to: "    ? (FOOTER_PLATE_TOP - (DESIGN.footerGap!=null?DESIGN.footerGap:3.0)) + 0.001" },

  // svg_primitives.js - extracted 2026-08-27 from gen_internal.js. Measured the
  // same day: seven of the 18 maps with an internal sheet draw a stadium badge,
  // so the SHAPE change is well covered by the byte gate. Two things are not.
  // design.badgeFit is false on ZERO maps, so the opt-out is a dark branch; and
  // gk() emits nothing unless EDITOR_KEYS=1, which no byte gate sets.
  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the badgeFit opt-out stops working, so a town that asked for plain discs gets stadiums anyway',
    find: "    if(!BFIT) return rad;",
    to: "    if(false) return rad;" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the 0.3mm inset goes, so X31 - the widest shipped three-character key - turns into a pill on four maps',
    find: "    return (w <= 2*rad-0.3) ? rad : w/2 + 0.35*rad;",
    to: "    return (w <= 2*rad) ? rad : w/2 + 0.35*rad;" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'badgeXWs takes the first route\'s extra rather than the widest, so a bundle reserves too little',
    find: "  const badgeXWs = (list,rad)=> BFIT ? Math.max(0,...list.map(r=>badgeXW(r,rad))) : 0;",
    to: "  const badgeXWs = (list,rad)=> BFIT ? (list.length?badgeXW(list[0],rad):0) : 0;" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the badge measures the route KEY rather than the label printed in it, so a relabelled route is sized wrong',
    find: "    const w = FONT.textWidth(blab(r), rad, true);   // font-size == rad, Arial Bold",
    to: "    const w = FONT.textWidth(String(r), rad, true);   // font-size == rad, Arial Bold" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'a bundled stack hangs downward from the line instead of straddling it, so half of it sits on the route',
    find: "    const pitch=rad*2+0.5, y0=y-(uniq.length-1)/2*pitch;",
    to: "    const pitch=rad*2+0.5, y0=y;" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the stack half-height forgets the outermost disc, so labels are allowed to sit on top of it',
    find: "    return {h:(uniq.length-1)/2*pitch + rad, xw};",
    to: "    return {h:(uniq.length-1)/2*pitch, xw};" },

  // OA-024. Both of the two above were ANCHOR-stale the moment badgeStack started
  // deduping, and the harness said so rather than quietly passing 152 of 154 — which
  // is the whole reason its verdict separates "stale" from "caught".
  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the stack dedupes by route KEY rather than by printed label, so a bundled 301 family prints 301 three times',
    find: "    for(const r of list){ const t=blab(r); if(!seen.has(t)){ seen.add(t); uniq.push(r); } }",
    to: "    for(const r of list){ const t=r; if(!seen.has(t)){ seen.add(t); uniq.push(r); } }" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the dedupe keeps the LAST member of a duplicate group, so the stack takes a follower colour instead of the leader',
    find: "    for(const r of list){ const t=blab(r); if(!seen.has(t)){ seen.add(t); uniq.push(r); } }",
    to: "    for(const r of list){ const t=blab(r); const i=uniq.findIndex(u=>blab(u)===t); if(i>=0) uniq[i]=r; else { seen.add(t); uniq.push(r); } }" },

  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'gk stops escaping the key, so a feature named with an ampersand writes invalid SVG in editor mode',
    find: "  const gk=(kind,key,inner)=> EDK ? `<g data-kind=\"${kind}\" data-key=\"${esc(key)}\">${inner}</g>` : inner;",
    to: "  const gk=(kind,key,inner)=> EDK ? `<g data-kind=\"${kind}\" data-key=\"${key}\">${inner}</g>` : inner;" },

  // NOT here, and deliberately: a mutation that deletes badgeStack's one-element
  // fast path SURVIVES, because it is an optimisation and not a branch — with one
  // member y0 collapses to y and (n-1)/2*pitch to 0, so the general loop draws the
  // same bytes. Measured 2026-08-27 at four radii. Leaving an equivalent mutant in
  // this list would teach the next reader to write a test for a difference that
  // does not exist.
  { suite: 'svg_primitives.test.js', file: 'svg_primitives.js',
    what: 'the badge text shrinks to fit instead of the disc growing - the fix that was rejected for breaking the 2.4mm legibility floor',
    find: "    out(`<text x=\"${x}\" y=\"${y}\" font-family=\"Arial\" font-weight=\"bold\" font-size=\"${(rad).toFixed(2)}\" fill=\"${TXT[r]||'#fff'}\" text-anchor=\"middle\" dominant-baseline=\"central\">${esc(blab(r))}</text>`);",
    to: "    out(`<text x=\"${x}\" y=\"${y}\" font-family=\"Arial\" font-weight=\"bold\" font-size=\"${(Math.min(rad, rad*2*rad/Math.max(1,hw*2))).toFixed(2)}\" fill=\"${TXT[r]||'#fff'}\" text-anchor=\"middle\" dominant-baseline=\"central\">${esc(blab(r))}</text>`);" },
  // linear_features.js - extracted 2026-08-27 from gen_internal.js. Every branch
  // MEASURED the same day by instrumenting the module and running all 18 maps
  // that have an internal sheet. Covered by the byte gate: projected geometry
  // (11 maps), hide (7), railStitch/railMerge/chequer (6 each), plain stroke
  // (10). DARK - no committed map takes them: the segments/points/move
  // overrides, minSegLen (every railway map takes the chequer, which sets it to
  // 0), a dashed feature (only canal has a dash and no town has a canal), and
  // ties (the chequer sets ties:false, and all six railway maps take it).
  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "the town style stops outranking the chequer preset, so a per-feature colour is silently ignored",
    find: "    return Object.assign({}, base, mid, own);",
    to: "    return Object.assign({}, base, own, mid);" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "the whole-feature nudge is dropped, so overrides.move does nothing",
    find: "    if(dx||dy) segs = segs.map(s=>s.map(p=>[p[0]+dx,p[1]+dy]));",
    to: "    if(false) segs = segs.map(s=>s.map(p=>[p[0]+dx,p[1]+dy]));" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "railStitch chains any two ways that touch, so the St Neots station throat folds back on itself again",
    find: "          if(turnAt(m, jn) > maxTurn) continue;",
    to: "          if(false) continue;" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "railMerge keeps every trimmed stretch, so short floating fragments survive",
    find: "        if(kept.some(k=>ptToPoly(p,k)<=tol)){ if(segLen(run)>=minRun) runs.push(run); run=[]; }",
    to: "        if(kept.some(k=>ptToPoly(p,k)<=tol)){ if(run.length) runs.push(run); run=[]; }" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "railMerge stops trimming and keeps a partly-coincident siding whole, re-doubling the main line",
    find: "      for(const r of runs) kept.push(dropCollinear(r, 0.02));",
    to: "      if(runs.length) kept.push(s);" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "a feature hidden by override is drawn anyway - every place sheet gets its river back",
    find: "    if(featOv(f).hide) return;",
    to: "    if(false) return;" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "minSegLen stops dropping the short crossover stubs, so the junction throat splays again",
    find: "      segs = segs.filter(s=>s.length>1 && segLen(s)>=st.minSegLen);",
    to: "      segs = segs.filter(s=>s.length>1);" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "a dashed feature takes a round cap again, so its gaps fuse into a scalloped solid line",
    find: "      const cap = st.dash ? 'butt' : 'round';",
    to: "      const cap = 'round';" },

  { suite: 'linear_features.test.js', file: 'linear_features.js',
    what: "the first cross-tie is drawn at the segment start rather than half a pitch in, so ties pile up at every vertex",
    find: "        for(let dd=step*0.5; dd<L; dd+=step){ const cx=x0+(x1-x0)*dd/L, cy=y0+(y1-y0)*dd/L;",
    to: "        for(let dd=0; dd<L; dd+=step){ const cx=x0+(x1-x0)*dd/L, cy=y0+(y1-y0)*dd/L;" },
  // label_placer.js - extracted 2026-08-27 from gen_internal.js. MEASURED the
  // same day across all 18 maps with an internal sheet: the WHOLE v1 placer is
  // dark. Every map runs v2, so the eight-candidate search, the manual-offset
  // path, the icon-box relaxation and the give-up return are taken by no
  // committed map at all, and this suite is the only thing that covers them.
  // Covered by the byte gate: the v2 branch (18), reserve (18), the v2 queue
  // (17), inkOnWhite (13, all of which darken at least one colour).
  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the collision test stops being inclusive, so two labels may touch edge to edge",
    find: "  const hit=(b,o)=>!(b[2]<o[0]||b[0]>o[2]||b[3]<o[1]||b[1]>o[3]);",
    to: "  const hit=(b,o)=>!(b[2]<=o[0]||b[0]>=o[2]||b[3]<=o[1]||b[1]>=o[3]);" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "a label stops being allowed to sit beside its own symbol, so every POI name jumps a candidate",
    find: "  const overlaps=(b,skip)=>placed.some(o=>o!==skip && hit(b,o));",
    to: "  const overlaps=(b,skip)=>placed.some(o=>hit(b,o));" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the icon-relaxation pass counts the icons after all, so it can never find anywhere the first pass did not",
    find: "  const overlapsNoIcons=(b)=>placed.some(o=>!iconBoxes.has(o) && hit(b,o));",
    to: "  const overlapsNoIcons=(b)=>placed.some(o=>hit(b,o));" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "reserve stops telling the v2 solver, so v2 places labels over ink v1 would have dodged",
    find: "  function reserve(x0,y0,x1,y1){placed.push([x0,y0,x1,y1]); if(LAB) LAB.block([x0,y0,x1,y1]);}",
    to: "  function reserve(x0,y0,x1,y1){placed.push([x0,y0,x1,y1]);}" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "a manual label offset goes back through de-collision, so a hand-placed name moves",
    find: "    if(lov && lov.offset){                       // manual label placement (skip de-collision)",
    to: "    if(false){                       // manual label placement (skip de-collision)" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the second pass that relaxes the icon boxes is dropped, so a label with nowhere clear of a symbol is lost",
    find: "    if(!chosen && iconBoxes.size){             // nowhere clear of the symbols: fall back to",
    to: "    if(false){             // nowhere clear of the symbols: fall back to" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the page bound stops applying, so a name at the frame edge runs off the paper or into the panel",
    find: "    const onPage=b=>!(IR && (b[0]<1 || b[2]>MX1+2));   // keep labels on the page / off the panel",
    to: "    const onPage=b=>true;   // keep labels on the page / off the panel" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "v1 overlaps rather than give up, which is the trade the placer exists to refuse",
    find: "    if(!chosen){ return false; }                // give up rather than overlap",
    to: "    if(!chosen){ chosen=[x+2.6,y+0.9,'start']; }                // give up rather than overlap" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "a queued v2 label loses its own-icon exclusion, so the solver treats its own symbol as an obstacle",
    find: "      at:[x,y], text, size:sz, fill:col, italic, own:self||null,",
    to: "      at:[x,y], text, size:sz, fill:col, italic, own:null," },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the ink floor stops being applied, so a pale route colour prints as unreadable type again",
    find: "    let f = 1, out = hex;",
    to: "    let f = 1, out = hex; if(true) return hex;" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the darkening scales one channel, so a pale route label changes hue instead of getting darker",
    find: "  const _scaleHex = (hex,f) => '#' + [1,3,5].map(i=>{",
    to: "  const _scaleHex = (hex,f) => '#' + [1,3,5].map((i,j)=>{ if(j) return hex.substr(i,2);" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the darkening loop loses its bound, so an unreachable floor hangs the build instead of returning",
    find: "    for(let i=0; i<40 && 1.05/(_lum(out)+0.05) < floor; i++){ f *= 0.93; out = _scaleHex(hex, f); }",
    to: "    for(let i=0; i<8 && 1.05/(_lum(out)+0.05) < floor; i++){ f *= 0.93; out = _scaleHex(hex, f); }" },

  { suite: 'label_placer.test.js', file: 'label_placer.js',
    what: "the per-call contrast floor is ignored in favour of the design key",
    find: "    const floor = (min!=null) ? min : INK_MIN_CONTRAST;",
    to: "    const floor = INK_MIN_CONTRAST;" },
  // fit_set.js - extracted 2026-08-27 from gen_internal.js. Exactly ONE of the 20
  // committed maps (Ramsey) reaches the off-path rule, and it is the map the rule
  // was written for, so the byte diff certifies this block on a single data point.
  // Every branch below except that one is dark to it.
  { suite: 'fit_set.test.js', file: 'fit_set.js',
    what: 'the three-survivor floor goes, so a broken road match quietly refits the map to whatever is left',
    find: "    if (far.length && near.length >= 3) {",
    to: "    if (far.length) {" },

  { suite: 'fit_set.test.js', file: 'fit_set.js',
    what: 'the off-path distance halves, and stops the map legitimately draws fall out of the fit',
    find: "  const OFFPATH = ir.fitMaxOffPath != null ? ir.fitMaxOffPath : 1500;",
    to: "  const OFFPATH = ir.fitMaxOffPath != null ? ir.fitMaxOffPath : 750;" },

  { suite: 'fit_set.test.js', file: 'fit_set.js',
    what: 'fitMaxOffPath:0 stops disabling the rule, so a town has no escape hatch',
    find: "  if (OFFPATH > 0 && psegs.length) {",
    to: "  if (psegs.length) {" },

  { suite: 'fit_set.test.js', file: 'fit_set.js',
    what: 'an explicit empty fitExtra falls through to extraCore, so a decision reads as an absence',
    find: "  const xc = new Set(ir.fitExtra || ICFG.extraCore || []);",
    to: "  const xc = new Set(ICFG.extraCore || ir.fitExtra || []);" },

  { suite: 'fit_set.test.js', file: 'fit_set.js',
    what: 'distance to a segment is measured to its ends, so a stop beside a long line reads as far away',
    find: "  let t = (px*bx + py*by) / L2; t = Math.max(0, Math.min(1, t));",
    to: "  let t = (px*bx + py*by) / L2; t = t < 0.5 ? 0 : 1;" },

  { suite: 'fit_set.test.js', file: 'fit_set.js',
    what: 'the classic model starts fitting the town core only, and every classic map reframes',
    find: "    for (const r in routes) for (const a of routes[r]) if (atco2ll[a]) stopPts.push(atco2ll[a]);",
    to: "    for (const r in routes) for (const a of routes[r]) if (atco2ll[a] && a.startsWith(prefix)) stopPts.push(atco2ll[a]);" },

  // poi_select.js - extracted 2026-08-27 from gen_internal.js. Unlike
  // strict_guards this block IS covered by the byte gate: measured, every
  // optional branch is exercised by at least one committed map. These six guard
  // the properties that turn on ORDER and on thresholds, which the 20 maps
  // certify only by accident of what happens to be committed today.
  { suite: 'poi_select.test.js', file: 'poi_select.js',
    what: 'the same place mapped as node and building stops collapsing, and prints twice',
    find: "const near = (a,b) => Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*70000)<60;",
    to: "const near = (a,b) => Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*70000)<6;" },

  { suite: 'poi_select.test.js', file: 'poi_select.js',
    what: 'excludeName narrows to industrial, so a town cannot drop a named shop again',
    find: "pois=pois.filter(p=>!exRe.test(p.name)); }",
    to: "pois=pois.filter(p=>p.cat!=='industrial'||!exRe.test(p.name)); }" },

  { suite: 'poi_select.test.js', file: 'poi_select.js',
    what: 'an unnamed industrial estate is kept, and prints the words "Industrial Estate" at nothing',
    find: "    return !!(p.name && p.name!=='Industrial Estate');   // default: keep named estates",
    to: "    return !!p.name;   // default: keep named estates" },

  { suite: 'poi_select.test.js', file: 'poi_select.js',
    what: 'a green named literally "Park" survives, naming nothing',
    find: "  pois = pois.filter(p=> !(p.cat==='park' && (p.name==='Park'||!p.name)));",
    to: "  pois = pois.filter(p=> !(p.cat==='park' && !p.name));" },

  { suite: 'poi_select.test.js', file: 'poi_select.js',
    what: 'the per-town tidy rules stop being applied, so a town cannot shorten a name at all',
    find: "    for(const [re,to] of TIDY) p.name = p.name.replace(re,to);",
    to: "    for(const [re,to] of TIDY) p.name = p.name;" },

  { suite: 'poi_select.test.js', file: 'poi_select.js',
    what: 'allotments stop being opt-in and appear on every town that has any',
    find: "  if((POI.include||[]).includes('allotments') && t.landuse==='allotments') return ['allotments', t.name||'Allotments'];",
    to: "  if(t.landuse==='allotments') return ['allotments', t.name||'Allotments'];" },

  // strict_guards.js - extracted 2026-08-27 from two copies in gen_internal.js
  // and gen_boarding.js. The byte gate runs with the flag UNSET and no committed
  // map refuses anything, so none of this file is reachable from it; these four
  // are the whole of what keeps the refusal contract honest.
  { suite: 'strict_guards.test.js', file: 'strict_guards.js',
    what: 'refusals become fatal by default, and the byte gate turns red over fixtures that legitimately warn',
    find: "const STRICT_GUARDS = process.env.STRICT_GUARDS === '1';",
    to: "const STRICT_GUARDS = process.env.STRICT_GUARDS !== '0';" },

  { suite: 'strict_guards.test.js', file: 'strict_guards.js',
    what: 'only one trailing newline is stripped, so a caller that added two gets a blank line in the middle of the report',
    find: '  while (t.length && t.charAt(t.length - 1) === NL) t = t.slice(0, -1);',
    to: '  if (t.length && t.charAt(t.length - 1) === NL) t = t.slice(0, -1);' },

  { suite: 'strict_guards.test.js', file: 'strict_guards.js',
    what: 'the banner says "guard" however many refused - the plural branch is the one a real run takes',
    find: "    + (count === 1 ? '' : 's') + ' ' + tail + NL);",
    to: "    + '' + ' ' + tail + NL);" },

  { suite: 'strict_guards.test.js', file: 'strict_guards.js',
    what: 'the module ends the run itself, taking the decision away from callers that end differently on purpose',
    find: '  return true;' + String.fromCharCode(10) + '}' + String.fromCharCode(10) + String.fromCharCode(10) + 'module.exports',
    to: '  process.exitCode = 1;' + String.fromCharCode(10) + '  return true;' + String.fromCharCode(10) + '}' + String.fromCharCode(10) + String.fromCharCode(10) + 'module.exports' },
  { suite: 'quality_metrics_spokes.test.js', file: 'quality_metrics.js',
    what: 'a repeat on a different spoke goes back to being scored (OA-169 reverted)',
    find: '  m.duplicateLabelsNet = m.duplicateLabels - (m.duplicateAcrossSpokes || 0);',
    to: '  m.duplicateLabelsNet = m.duplicateLabels;' },

  { suite: 'quality_metrics_spokes.test.js', file: 'quality_metrics.js',
    what: 'the spoke split escapes its scope and forgives duplicates on an INTERNAL sheet too',
    find: "  const isExternal = base === 'external';",
    to: '  const isExternal = true;' },

  { suite: 'quality_metrics_spokes.test.js', file: 'quality_metrics.js',
    what: 'a label equidistant between two spokes is called unambiguous anyway',
    find: '    return (seq !== null && second - nearest >= capHeight) ? seq : null;',
    to: '    return seq;' },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'a re-wrapped label goes back to reading as a lost one (OA-171 reverted)',
    find: '  return parts && parts.length >= 2 ? parts : null;',
    to: '  return null;' },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'a re-wrap is accepted on merely REUSING the words, not reconstructing the name',
    find: '      if (!present.has(chunk)) continue;',
    to: '      if (!newLabels.some(l => normLabel(l).includes(chunk))) continue;' },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'the sheet-version stamp goes back to counting as a lost label',
    find: '  /^(Valid from .*|Map v[\\d.]+(?: · .*)?|Map version v?[\\d.]+|(?:build|Draft|Preview) v?[\\d.]+(?: · .*)?)$/;',
    to: '  /^(Valid from .*|Map v[\\d.]+(?: · .*)?)$/;' },

  // lane_normals.js - four of these six are repairs that were actually tried
  // and measured on the board before the right one was found, so a suite that
  // survives them is a suite that would have let the wrong fix through.
  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'a corridor forgets that two lines can face opposite ways',
    find: '  if (Math.abs(a.ux * b.ux + a.uy * b.uy) < cosAngle) return false;',
    to: '  if ((a.ux * b.ux + a.uy * b.uy) < cosAngle) return false;' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'chain edges go back to walking array positions, and vanish when routes interleave',
    find: '  for (const idx of byRoute.values()) {',
    to: '  for (const idx of [Array.from(segs.keys())]) {' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'a chain edge is allowed to close a cycle and contradict the lateral structure',
    find: '    if (find(i).root === find(j).root) continue;      // bridges only, never a cycle',
    to: '    if (false) continue;      // bridges only, never a cycle' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'components stop being anchored, so a clean corridor can come out mirrored',
    find: '    if (!anchorParity.has(f.root)) anchorParity.set(f.root, f.parity);',
    to: '    if (!anchorParity.has(f.root)) anchorParity.set(f.root, 1);' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'the key-off path starts applying an orientation it was never given',
    find: '    const sg = (sign && bSeg >= 0) ? (sign[bSeg] || 1) : 1;',
    to: '    const sg = (bSeg >= 0 && sign) ? (sign[bSeg] || 1) : -1;' },

  { suite: 'lane_normals.test.js', file: 'lane_normals.js',
    what: 'an unorientable corridor reports itself as clean',
    find: "    if (union(i, j, rel(segs[i], segs[j])) === 'conflict') conflicts++;",
    to: '    union(i, j, rel(segs[i], segs[j]));' },

  { suite: 'font_metrics.test.js', file: 'font_metrics.js',
    what: 'an unmapped glyph costs nothing',
    find: 'const FALLBACK = 0.556;', to: 'const FALLBACK = 0;' },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'ink drawn off the page is only a WARN again',
    find: "const OVERFLOWED = /\\bunder the footer plate\\b|\\binside\\/near the footer plate\\b|\\btoo long for this panel\\b|\\bpast the frame edge\\b/i;",
    to: 'const OVERFLOWED = /$^/;' },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'a mapNotes entry buried in the footer plate is only a WARN again (OA-065)',
    find: "|\\binside\\/near the footer plate\\b", to: '' },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'a generator that DIED is only a WARN again',
    find: '          || CRASHED.test(line)) ? \'BLOCKING\' : \'WARN\';',
    to: '          ) ? \'BLOCKING\' : \'WARN\';' },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'a non-zero exit stops being blocking on its own account',
    find: 'if (r.ok === false &&', to: 'if (false &&' },

  // --- the two ink-on-ink measures, added 2026-08-28 (OA-021, OA-118) ---
  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a badge printed on a badge stops counting',
    find: '    if (over <= T.badgeOverlapMm) continue;',
    to: '    if (true) continue;' },

  // This one used to break the VERDICT. Since the rule was made exact on 2026-08-28
  // (OA-060) `ox`/`oy` are the reported per-axis pair and nothing else, so the same
  // edit now only corrupts what the detail line PRINTS -- and it survived, because
  // no test read that pair. Kept rather than retired, and the suite now asserts the
  // printed figures: a report that quietly lies about how two marks overlap is how
  // OA-021's first cut got believed for a day.
  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the reported y-overlap measures a stadium as a disc, so the detail line overstates how badly two badges clash',
    find: '    const oy = (a.ry + b.ry) - Math.abs(a.cy - b.cy);',
    to: '    const oy = (Math.max(a.rx, a.ry) + Math.max(b.rx, b.ry)) - Math.abs(a.cy - b.cy);' },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a label over a route badge stops counting',
    find: "        detail.labelOverBadge.push({ text: L.text, kind: L.kind, at: [+g.cx.toFixed(1), +g.cy.toFixed(1)] });",
    to: '        void 0;' },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the badge glyph counts as a map label, so every badge reports itself',
    find: '    if (t.central) continue;', to: '    if (false) continue;' },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a steep junction counts as a lane crossing',
    find: '    if (cos < COSMAX) continue;                  // steep: a real junction',
    to: '    if (false) continue;' },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'one visual crossing stops being clustered into one site',
    find: '    const near = sites.find(s3 => Math.hypot(s3.x - x, s3.y - y) < T.laneCrossSiteMm);',
    to: '    const near = null;' },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a route crossing ITSELF counts as two routes crossing',
    find: '    if (a.col === b.col) continue;', to: '    if (false) continue;' },


  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a sheet with no palette reports a clean ZERO instead of UNKNOWN',
    find: '    labelsOverBadge: (palette && palette.size) ? detail.labelOverBadge.length : null,',
    to: '    labelsOverBadge: detail.labelOverBadge.length,' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'the label floor stops being checked',
    find: 'if (now.labels < was.labels)', to: 'if (false && now.labels < was.labels)' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'an unknown drop count is read as zero',
    find: 'if (now.drop !== null && was.drop !== null && now.drop < was.drop)',
    to: 'if ((now.drop || 0) < (was.drop || 0))' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'a board-wide total sums an uncounted sheet as zero',
    find: 'if (v === null || v === undefined) unknown += 1; else total += v;',
    to: 'total += (v || 0);' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: 'a deadline that has gone by takes the target with it',
    find: 'const next = sorted.find(m => m.by >= today) || sorted[sorted.length - 1];',
    to: 'const next = sorted.find(m => m.by >= today) || sorted[0];' },

  { suite: 'quality_gate.test.js', file: 'quality_gate.js',
    what: '--accept discards the target on the run that moved towards it',
    find: '  if (prev.targets) out.targets = prev.targets;',
    to: '  if (false) out.targets = prev.targets;' },

  { suite: 'labeller.test.js', file: 'labeller.js',
    what: 'mustPlace loses its second, relaxed pass',
    find: 'for (const relax of (it.mustPlace ? [false, true] : [false]))',
    to: 'for (const relax of [false])' },

  { suite: 'labeller.test.js', file: 'labeller.js',
    what: 'a label may be placed over one already placed',
    find: 'if (boxesHit(b, pb.b)) return null;', to: 'if (false) return null;' },

  { suite: 'footer.test.js', file: 'footer.js',
    what: 'the note wraps to the full band again, under the right-hand block',
    find: 'const NOTE_GUTTER = 6;', to: 'const NOTE_GUTTER = -80;' },

  { suite: 'geometry.test.js', file: 'quality_metrics.js',
    what: 'middle-anchored text is measured from its left edge',
    find: "const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;",
    to: 'const x0 = t.x;' },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'the file NAME drops out of the engine hash',
    // Re-anchored 2026-08-30: computePlaceEngineVersion() runs the same loop over
    // the town closure, so the bare line now appears twice. The anchor carries the
    // function head with it rather than being loosened.
    find: "function computeEngineVersion(sk = SK) {\n  const h = crypto.createHash('sha256');\n  for (const name of engineFiles(sk)) {\n    const p = path.join(sk, name);\n    h.update(name + '\\0');",
    to: "function computeEngineVersion(sk = SK) {\n  const h = crypto.createHash('sha256');\n  for (const name of engineFiles(sk)) {\n    const p = path.join(sk, name);\n    h.update(\"\");" },

  // Re-anchored 2026-08-28: sameIgnoringLineEndings stopped normalising inline
  // and now compares BYTES through line_endings.js, so the mutation has to break
  // the comparison rather than the old `norm` helper. Same property either way —
  // a CRLF working tree must not read as vendoring drift.
  // seed_prev_s4.js - the ONE rule the rollout's dry run and its apply now share
  // (OA-013). Two mutations, one per half of the property: the winner, and the
  // report that a choice was made at all. Measured on 2026-08-29, no map on the
  // estate currently has an S4 input that differs from its stage copy, so the
  // live tree cannot tell the fixed rule from the broken one -- these mutations
  // are the only thing that can.
  { suite: 'seed_prev_s4.test.js', file: 'seed_prev_s4.js',
    what: "the apply prefers a pulled stage copy again, so the dry run's diff describes a build it will not make",
    find: "    if (fs.existsSync(to) && !fs.readFileSync(to).equals(fs.readFileSync(from))) shadowed.push(name);\n    fs.copyFileSync(from, to);",
    to: "    if (fs.existsSync(to)) continue;\n    fs.copyFileSync(from, to);" },

  { suite: 'seed_prev_s4.test.js', file: 'seed_prev_s4.js',
    what: 'the overwrite happens silently, so nothing says a stage disagreed',
    find: "    if (fs.existsSync(to) && !fs.readFileSync(to).equals(fs.readFileSync(from))) shadowed.push(name);",
    to: "" },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'line endings are compared literally',
    find: "  return sameBytesIgnoringLineEndings(fs.readFileSync(pathA), fs.readFileSync(pathB));",
    to: "  return fs.readFileSync(pathA).equals(fs.readFileSync(pathB));" },

  { suite: 'gate_lib.test.js', file: 'gate_lib.js',
    what: 'a file that cannot be read reports "different" instead of "cannot compare"',
    find: 'if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return null; // can\'t compare',
    to: 'if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return false;' },

  { suite: 'icons.test.js', file: 'icons.js',
    what: 'a pale backing plate is recoloured charcoal',
    find: "if (lum > 0.75) return `${k}=\"#ffffff\"`;", to: 'if (false) return k;' },

  // quality_metrics.js - the first of these three IS the bug of 2026-08-27,
  // restored exactly. It shipped for eleven days, hid 14 sheets' worth of
  // honest zeroes behind the word UNKNOWN, and no test in this folder objected
  // because no test in this folder read a sidecar.
  { suite: 'quality_metrics.test.js', file: 'quality_metrics.js',
    what: 'an absent sidecar reads as UNKNOWN again on every sheet but the internal one',
    find: '    } else unplaced = [];      // every writer unlinks its sidecar when nothing dropped',
    to: "    } else if (base === 'internal') unplaced = [];" },

  { suite: 'quality_metrics.test.js', file: 'quality_metrics.js',
    what: 'the schematic goes back to having no sidecar of its own',
    find: "    'internal-schematic': 'unplaced-schematic.json',",
    to: '' },

  { suite: 'quality_metrics.test.js', file: 'quality_metrics.js',
    what: 'a corrupt sidecar is filed under the same word as a sheet type nobody reports',
    find: "    if (unplaced === null) dropState = 'unreadable';   // the file was there and would not parse",
    to: "    if (unplaced === null) dropState = 'no-reporter';" },

  // The fold-in, 2026-08-28 (OA-021). These four defend a DECISION rather than an
  // algorithm, which is unusual here and deliberate: the whole convention is that
  // a measure is scored only once its board is empty, and the two ways to break it
  // are to quietly unscore one that was folded in, or to fold in one that is still
  // red. Both are one-line edits nobody would notice in review.
  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a badge printed on a badge stops counting as a hard defect, so the ratchet stops seeing it',
    find: "    + (m.badgeOverBadge || 0) + (m.lozengeOverlap || 0)",
    to: "    + (m.lozengeOverlap || 0)" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'a lozenge printed on a lozenge stops counting as a hard defect',
    find: "    + (m.badgeOverBadge || 0) + (m.lozengeOverlap || 0)",
    to: "    + (m.badgeOverBadge || 0)" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'labelsOverBadge is folded in while it still stands at 47, which is how a new gate lands red and gets muted',
    find: "    + (m.panelOnlyServices || 0) + m.strandedFeatureLabels",
    to: "    + (m.panelOnlyServices || 0) + m.strandedFeatureLabels + (m.labelsOverBadge || 0)" },

  // OA-148, 2026-08-30. The AABB is what this measure USED to test, and it was
  // reporting two road names as sitting on badges their glyphs come nowhere near.
  // The second mutation is the other direction and matters just as much: a test
  // that never fires is also "exact".
  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the label-over-badge test goes back to the bounding box, so a badge in the corner of a rotated road name is charged as ink beneath it',
    find: "      if (quadsOverlap(gq, bq)) {",
    to: "      const _bb = quadBox(gq); if (g.cx + g.rx > _bb.x0 && g.cx - g.rx < _bb.x1 && g.cy + g.ry > _bb.y0 && g.cy - g.ry < _bb.y1) {" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the label-over-badge test stops firing altogether, which an exactness fix would hide',
    find: "      if (quadsOverlap(gq, bq)) {",
    to: "      if (false && quadsOverlap(gq, bq)) {" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'an unmeasurable sheet is charged a defect for the measurement it could not take',
    find: "  if (m.badgeOverBadge > 0) fails.push(m.badgeOverBadge + ' route badges printed on each other');",
    to: "  if (m.badgeOverBadge !== 0) fails.push(m.badgeOverBadge + ' route badges printed on each other');" },

  // OA-060, the badge rule made exact 2026-08-28. The box rule it replaced was not
  // a rounding matter: it accounted for 17 of the 30 overprints the board reported
  // that morning, every one of them a pair of discs with clear paper between them.
  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the badge rule goes back to a plain box test, so two discs on a diagonal with daylight between them read as an overprint',
    find: "    const over = -gapMm(a, b);",
    to: "    const over = Math.min((a.rx + b.rx) - Math.abs(a.cx - b.cx), (a.ry + b.ry) - Math.abs(a.cy - b.cy));" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the badge rule goes back to a radial test, so two stadiums sitting tidily side by side read as an overprint',
    find: "    return Math.hypot(dx, a.cy - b.cy) - (a.ry + b.ry);",
    to: "    return Math.hypot(a.cx - b.cx, a.cy - b.cy) - (Math.max(a.rx, a.ry) + Math.max(b.rx, b.ry));" },

  // OA-060, the lozenge measure added 2026-08-28. The FIRST of these is the
  // mutation that matters and it is aimed at the Y term on purpose: a terminus
  // lozenge is 30-40mm wide and 11mm tall, so an x-only or centre-distance rule
  // agrees with the correct one on almost every real pair and diverges only on
  // the column case. OA-021 learned the same lesson on the badges and had to aim
  // its mutation at y for the same reason -- a stadium's rx IS its max.
  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the lozenge test drops its y term, so two destinations stacked in a tidy column read as an overprint',
    find: "      if (ox <= T.lozengeOverlapMm || oy <= T.lozengeOverlapMm) continue;",
    to: "      if (ox <= T.lozengeOverlapMm) continue;" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the lozenge test drops its x term, so any two boxes on the same row read as an overprint',
    find: "      if (ox <= T.lozengeOverlapMm || oy <= T.lozengeOverlapMm) continue;",
    to: "      if (oy <= T.lozengeOverlapMm) continue;" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'an external sheet whose lozenge signature matches nothing reports a clean zero instead of UNKNOWN',
    find: "                 : lozenges.length === 0 ? 'signature-lost' : 'counted';",
    to: "                 : 'counted';" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the measure claims to have checked an internal sheet, which cannot carry a lozenge at all',
    find: "  const lozState = base !== 'external' ? 'not-external'",
    to: "  const lozState = false ? 'not-external'" },

  { suite: 'quality_metrics_ink.test.js', file: 'quality_metrics.js',
    what: 'the detail stops naming the buried destination, leaving a count that cannot say whether to merge or separate',
    find: "        text: a.txt, under: b.txt,",
    to: "        text: '', under: ''," },

  // services_panel.js - extracted 2026-08-27 from gen_internal.js. MEASURED the
  // same day across the 18 maps that draw an internal sheet: NINE of its 35
  // labelled branches are dark, and they include a whole layout (panelCols, 0
  // maps), the whole panelScale opt-out (0), the fare note (0) and keyCols:1 (0).
  // Covered by the byte gate instead: the plain layout (12), panelGroups (5),
  // panelCorridors (1, High Wycombe), the not-shown note (6), a subtitle fitted
  // down (2) and the compressed Key pitch (1, Ely Co-op).
  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the type scale can no longer be turned off, so the hand-tuned sizes it replaced are unreachable',
    find: "  const PS = PANEL_SCALE_ON ? { head:5.0, title:3.5, sub:2.9, dense:2.45 } : null;",
    to: "  const PS = { head:5.0, title:3.5, sub:2.9, dense:2.45 };" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the no-scale panel loses the 2mm nudge under its heading, so every ungated row moves up',
    find: "  if(!PS) py+=2;",
    to: "  if(!PS) py+=0;" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'panelCols fills row-major, so a column no longer reads top to bottom',
    find: "      const col=Math.floor(i/per), row=i%per;",
    to: "      const col=i%nCol, row=Math.floor(i/nCol);" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the panelCols badge loses its legibility floor, so a tight row prints an unreadable disc rather than warning',
    find: "    const pcolsBadgeR = Math.min(PBR-0.6, Math.max(1.8, crow/2-0.5));",
    to: "    const pcolsBadgeR = Math.min(PBR-0.6, Math.max(0.8, crow/2-0.5));" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'a panelCols subtitle is measured to the sheet trim again, so column one runs under column two',
    find: "      const _sfz=(PRINT_SAFE==null)?_ssz:subFit(r,_stext,_sx,_ssz,cx+cw);",
    to: "      const _sfz=(PRINT_SAFE==null)?_ssz:subFit(r,_stext,_sx,_ssz,297-PRINT_SAFE);" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'subFit shrinks past the 2.4mm print floor instead of refusing and saying so',
    find: "    if(want >= 2.4) return Math.floor(want*100)/100;",
    to: "    if(want >= 0) return Math.floor(want*100)/100;" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the corridor note claims a shared palette on a town that has none',
    find: "      const txt = RJ.corridorNote || (CPAL",
    to: "      const txt = RJ.corridorNote || (true" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'corridorNote:false stops suppressing the sentence',
    find: "    if(RJ.corridorNote!==false){",
    to: "    if(true){" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the duplicated route-number prefix is dropped whether or not printSafe is set, so an ungated town changes',
    find: "      const d = (PRINT_SAFE!=null && !stacked && d0[0])",
    to: "      const d = (!stacked && d0[0])" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'keyCols is ignored and every Key takes the two-column default',
    find: "  const KEY_COLS = Math.max(1, Math.min(3, (DESIGN.keyCols|0) || 2));",
    to: "  const KEY_COLS = 2;" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the Key lists every category again, including ones this sheet draws none of',
    find: "  const key=KEY_ALL.filter(([cat])=>pois.some(p=>p.cat===cat));",
    to: "  const key=KEY_ALL.slice();" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the Key pitch is measured against a footer plate a footerSafe:false sheet does not draw',
    find: "    if(!FTIER || !FOOTER_SAFE) return KROW;",
    to: "    if(!FTIER) return KROW;" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the tier rows are counted off the frequency block again, so a sheet explains a weight no drawn lane uses',
    find: "    const used = new Set(order.map(r=>(RJ.frequency||{})[r]).filter(Boolean));",
    to: "    const used = new Set(Object.values(RJ.frequency||{}));" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the not-shown note loses its short fallback, so a row one word too long says nothing at all',
    find: "    for(const note of [NOT_SHOWN_NOTE, NOT_SHOWN_SHORT]){",
    to: "    for(const note of [NOT_SHOWN_NOTE]){" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'a one-point trim counts as drawn, so a service with no line on the map is badged in silence',
    find: "  const NOT_DRAWN = new Set(panelOrder.filter(r=>!(TRIM && TRIM[r] && TRIM[r].pts && TRIM[r].pts.length>=2)));",
    to: "  const NOT_DRAWN = new Set(panelOrder.filter(r=>!(TRIM && TRIM[r] && TRIM[r].pts)));" },

  { suite: 'services_panel.test.js', file: 'services_panel.js',
    what: 'the fare note wraps at 48 characters, so its box and the panel below it move',
    find: "    for(const wd of words){ if((cur+' '+wd).trim().length>38){ lines.push(cur.trim()); cur=wd; } else cur+=' '+wd; }",
    to: "    for(const wd of words){ if((cur+' '+wd).trim().length>48){ lines.push(cur.trim()); cur=wd; } else cur+=' '+wd; }" },

  // complexity_ladder.js - extracted 2026-08-27 from gen_internal.js. MEASURED
  // the same day across the 18 maps that draw an internal sheet: only THREE
  // declare corridor families and only ONE - High Wycombe - sets coreBox,
  // stopThinning or corridorPalette at all, so 14 of the 39 labelled branches
  // are dark to the byte gate. Every hand override of the box (w, h, at,
  // minRun), the whole object form of stopThinning, both "true" shorthands and
  // the anchor refusal are certified by complexity_ladder.test.js alone.
  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "a family of one becomes a family, so a lone route is bundled with nothing and loses its own lane",
    find: "    if(list.length<2) continue;",
    to: "    if(list.length<1) continue;" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "the {routes:[…]} spelling of a family is read as empty, so the town silently draws no bundle",
    find: "    const members=Array.isArray(v)?v:((v&&v.routes)||[]);",
    to: "    const members=Array.isArray(v)?v:[];" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "a lead named among its own members is listed twice, so it takes two slots in the badge stack",
    find: "    const list=[k].concat(members.filter(r=>r!==k));",
    to: "    const list=[k].concat(members);" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "colour aliasing invents a palette key, which changes Object.keys(C) and therefore the draw order",
    find: "    if(m in C) C[m] = C[l];",
    to: "    C[m] = C[l];" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "a member with no text colour acquires the lead’s, so a badge is lettered against the wrong ink",
    find: "    if(TXT && (m in TXT)) TXT[m] = TXT[l];",
    to: "    if(TXT) TXT[m] = TXT[l];" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "a route outside every family gets an undefined lane, so the offset maths loses it",
    find: "  const laneKey = CORR ? (r=>CORR.lead[r]||r) : (r=>r);",
    to: "  const laneKey = CORR ? (r=>CORR.lead[r]) : (r=>r);" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "rung 1 starts reporting a shared colour, so a bundled member is force-badged like a rung-3 line",
    find: "  const colourShared = r => !!(CPAL && CPAL.lead[r]);",
    to: "  const colourShared = r => !!((CPAL && CPAL.lead[r]) || (CORR && CORR.lead[r]));" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "coreBox:true stops meaning \"the box with every default\" and turns the rung off instead",
    find: "  const CBOX = RJ.coreBox ? (RJ.coreBox===true?{}:RJ.coreBox) : null;",
    to: "  const CBOX = (RJ.coreBox && RJ.coreBox!==true) ? RJ.coreBox : null;" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "stopThinning:true stops meaning \"thin, with every default\" and turns the rung off instead",
    find: "  const THIN = RJ.stopThinning ? (RJ.stopThinning===true?{}:RJ.stopThinning) : null;",
    to: "  const THIN = (RJ.stopThinning && RJ.stopThinning!==true) ? RJ.stopThinning : null;" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "a hand width grows the box eastwards instead of about its centre, so the town centre moves",
    find: "    if(CBOX.w!=null){ const cx=(x0+x1)/2; x0=cx-CBOX.w/2; x1=cx+CBOX.w/2; }",
    to: "    if(CBOX.w!=null){ x1=x0+CBOX.w; }" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "coreBox.at is read as the top-left corner rather than the centre, so the box lands half a box out",
    find: "      x0=CBOX.at[0]-w/2; x1=CBOX.at[0]+w/2; y0=CBOX.at[1]-h/2; y1=CBOX.at[1]+h/2; }",
    to: "      x0=CBOX.at[0]; x1=CBOX.at[0]+w; y0=CBOX.at[1]; y1=CBOX.at[1]+h; }" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "label:\"\" falls back to \"town centre\", so a town that asked for a wordless box gets words",
    find: "    return { x0,y0,x1,y1, label:(CBOX.label!=null?CBOX.label:'town centre'), sublabel:CBOX.sublabel||null };",
    to: "    return { x0,y0,x1,y1, label:(CBOX.label||'town centre'), sublabel:CBOX.sublabel||null };" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "the box boundary becomes exclusive, so a route ending exactly on the edge is drawn into the box",
    find: "  const inCore = p => !!CORE && p[0]>=CORE.x0 && p[0]<=CORE.x1 && p[1]>=CORE.y0 && p[1]<=CORE.y1;",
    to: "  const inCore = p => !!CORE && p[0]>CORE.x0 && p[0]<CORE.x1 && p[1]>CORE.y0 && p[1]<CORE.y1;" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "minRun:0 stops disabling the stub filter, so the one escape hatch from it is unreachable",
    find: "  const MINRUN = CBOX ? (CBOX.minRun!=null?CBOX.minRun:2.5) : 0;",
    to: "  const MINRUN = CBOX ? (CBOX.minRun||2.5) : 0;" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "the interchange bar rises to three lines, so a two-route stop loses its tick everywhere",
    find: "  const minLines = THIN.minLines!=null?THIN.minLines:2;",
    to: "  const minLines = THIN.minLines!=null?THIN.minLines:3;" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "termini have to be asked for, so stopThinning:true silently deletes every end stop",
    find: "    if(THIN.termini!==false){ keep.add(chain[0]); keep.add(chain[chain.length-1]); }",
    to: "    if(THIN.termini===true){ keep.add(chain[0]); keep.add(chain[chain.length-1]); }" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "interchanges are counted per ROUTE, so a bundled 1/1A/1B reads as three lines at one stop",
    find: "    for(const a of new Set(chain)) (lanes[a]=lanes[a]||new Set()).add(lane); }",
    to: "    for(const a of new Set(chain)) (lanes[a]=lanes[a]||new Set()).add(r); }" },

  { suite: 'complexity_ladder.test.js', file: 'complexity_ladder.js',
    what: "the hand drop list is applied before the anchor is added, so drop can no longer remove it",
    find: "  keep.add(ANCHOR);                                    // the interchange always stays\n  for(const a of (THIN.drop||[])) keep.delete(a);",
    to: "  for(const a of (THIN.drop||[])) keep.delete(a);\n  keep.add(ANCHOR);                                    // the interchange always stays" },


  // engine_version.js - the template hash stopped being a hand-kept list of five
  // on 2026-08-27 and became the transitive closure of what the entry points
  // require. It had to: ten extractions moved most of gen_internal.js into
  // siblings, and MEASURED that day, appending a line to services_panel.js or
  // complexity_ladder.js moved the hash not at all. labeller.js and footer.js had
  // never been in it. These four break the walk in the four ways that matter.
  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: "the _dep idiom is no longer followed, so every module extracted from a generator falls back outside the hash",
    find: "  /_dep\\(\\s*['\"]([\\w.-]+\\.js)['\"]\\s*\\)/g,                       // _dep('x.js')",
    to: "  /_NEVER_MATCHES_\\(([\\w.-]+\\.js)\\)/g,                            // _dep('x.js')" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: "path.join(__dirname,\"x.js\") is no longer followed, so font_metrics.js and qr.js leave the hash",
    // Re-anchored 2026-08-30: the pattern gained one level of nested parens.
    find: "  /path\\.join\\((?:[^()]|\\([^()]*\\))*?['\"]([\\w.-]+\\.js)['\"]\\s*\\)/g, // path.join(<dir expr>, 'x.js')",
    to: "  /path\\.NEVER\\((?:[^()]|\\([^()]*\\))*?['\"]([\\w.-]+\\.js)['\"]\\s*\\)/g, // path.join(<dir expr>, 'x.js')" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: "the closure comes back in discovery order, so reordering two requires reports a different engine",
    // Re-anchored 2026-08-30: placeEngineFiles() ends with the same line.
    find: "  // Sorted, so the hash cannot depend on the order the requires happen to appear\n  // in \u2014 an extraction reorders them constantly.\n  return [...seen].sort();",
    to: "  return [...seen];" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: "a name is followed whether or not the file exists, so a typo in a require invents a hashed file",
    find: "        if (!seen.has(dep) && fs.existsSync(path.join(sk, dep))) queue.push(dep);",
    to: "        if (!seen.has(dep)) queue.push(dep);" },

  // line_endings.js - the normalisation the engine hash, sync_ci_reference.js and
  // the vendoring drift check all share. It was three copies until 2026-08-28,
  // two of them written hours apart WITH THE SAME BUG, so these mutations are
  // aimed at the one implementation now.
  //
  // TWO SUITES ARE NAMED ON PURPOSE. The first pair runs engine_version.test.js,
  // because a change here has to be caught THROUGH A CONSUMER — an engine version
  // that is a property of the checkout is the failure that started this, and a
  // unit test of the helper alone would not have said so. The third runs the
  // helper's own suite, because the fault it describes is not visible in a hash
  // at all: it rewrites the file.
  { suite: 'engine_version.test.js', file: 'line_endings.js',
    what: "line endings go back into the hash, so one commit reports a different engine per checkout",
    find: "    if (buf[i] === CR && buf[i + 1] === LF) continue;",
    to: "    if (false) continue;" },

  { suite: 'engine_version.test.js', file: 'line_endings.js',
    what: "a bare CR is stripped as well as a CRLF pair, so a real content change can hide inside one",
    find: "    if (buf[i] === CR && buf[i + 1] === LF) continue;",
    to: "    if (buf[i] === CR) continue;" },

  // THE ONE THAT CORRUPTED A FIXTURE. Routing the bytes through a UTF-8 string
  // rewrites every byte that is not legal UTF-8 as U+FFFD, and it did that to
  // March's atco2name_all.json — a raw 0x92, the CP1252 quote in "Ramsey St
  // Mary's" — on its first real run. The hash suites cannot see this: the engine
  // sources are all ASCII, so mutating this way leaves the engine version alone.
  // Only a test that feeds it a byte no decoder can represent goes red.
  { suite: 'line_endings.test.js', file: 'line_endings.js',
    what: "the bytes go through a UTF-8 string again, so anything that is not valid UTF-8 is rewritten as U+FFFD",
    find: "function lfBytes(buf) {",
    to: "function lfBytes(buf) {\n  return Buffer.from(buf.toString('utf8').split('\\r\\n').join('\\n'), 'utf8');" },


  // north_arrow.js - extracted 2026-08-27 from gen_internal.js, and the
  // best-covered module of the phase: MEASURED across the 18 maps with an
  // internal sheet, 12 of its 17 labelled branches are live and 13 maps have
  // their arrow moved off the configured spot by the blank-space search. Note
  // the one that only LOOKS dark: northArrow.angle is taken by no internal
  // sheet and by TWELVE derived ones, because schematize_internal.js and
  // diagram_internal.js inject it - the probe renders internal.svg only.
  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "the arrow needs asking for, so every town that lets the engine own it loses its compass",
    find: "  const on = !!(IR && IR.northArrow!==false);",
    to: "  const on = !!(IR && IR.northArrow);" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "the northArrow config object is never read, so x, y, len and angle are all ignored",
    find: "  const NA = (IR && IR.northArrow && IR.northArrow!==true) ? IR.northArrow : {};",
    to: "  const NA = {};" },

  // NOT HERE, and deliberately: dropping the `!==true` guard so that NA becomes
  // the boolean `true` is an EQUIVALENT MUTANT. Every read of NA is a property
  // access - NA.len, NA.angle, NA.x, NA.y - and `true.len` is undefined exactly
  // as `{}.len` is, so the guard cannot change an output. It is kept for what it
  // says, not for what it does; the mutation above breaks the same line in the
  // way that IS observable. (Same shape as badgeStack's one-element fast path.)

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "a given angle is used as radians, so every schematic and diagram points 57x the wrong way",
    find: "  const ANG = NA.angle!=null ? NA.angle*Math.PI/180",
    to: "  const ANG = NA.angle!=null ? NA.angle" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "north is derived with the rotation instead of against it, mirroring the compass on every rotated town",
    find: "            : Math.atan2(-Math.cos(-theta), Math.sin(-theta));",
    to: "            : Math.atan2(-Math.cos(theta), Math.sin(theta));" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "the footprint shrinks to the shaft, so the N and the arrowhead are drawn over whatever is there",
    find: "    return [Math.min(bx,tx)-3.4, Math.min(by,ty)-4.6, Math.max(bx,tx)+3.4, Math.max(by,ty)+4.6];",
    to: "    return [Math.min(bx,tx), Math.min(by,ty), Math.max(bx,tx), Math.max(by,ty)];" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "the reservation is taken at the OLD spot, so an auto-placed arrow is left unprotected",
    find: "    reserve(...box(at.x, at.y));",
    to: "    reserve(...box(14, 150));" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "an auto placement moves the arrow but never records it, so the drawing goes back to the config",
    find: "      at.x=got.x; at.y=got.y; at.auto=true;",
    to: "      at.auto=true;" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "a sheet with no clear spot moves the arrow to nowhere instead of leaving it be",
    find: "      warn('northArrow: no clear spot found on this sheet; left at the configured '",
    to: "      at.x=got.x; at.y=got.y;\n      warn('northArrow: no clear spot found on this sheet; left at the configured '" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "the search is given the base point rather than the whole device, so the N may sit on ink",
    find: "    const got = spotSearch(box, at.x, at.y, 0.02);",
    to: "    const got = spotSearch((x,y)=>[x,y,x,y], at.x, at.y, 0.02);" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "the letter N is drawn at the tip rather than beyond it, so it sits inside the arrowhead",
    find: "    out(`<text x=\"${(tx+c*3).toFixed(2)}\" y=\"${(ty+s*3+1).toFixed(2)}\" font-family=\"Arial\" font-weight=\"bold\" font-size=\"3.4\" fill=\"#666\" text-anchor=\"middle\">N</text>`);",
    to: "    out(`<text x=\"${tx.toFixed(2)}\" y=\"${ty.toFixed(2)}\" font-family=\"Arial\" font-weight=\"bold\" font-size=\"3.4\" fill=\"#666\" text-anchor=\"middle\">N</text>`);" },

  { suite: 'north_arrow.test.js', file: 'north_arrow.js',
    what: "coordinates go out unrounded, so a re-render moves bytes nobody changed",
    find: "    out(`<line x1=\"${bx.toFixed(2)}\" y1=\"${by.toFixed(2)}\" x2=\"${tx.toFixed(2)}\" y2=\"${ty.toFixed(2)}\" stroke=\"#666\" stroke-width=\"0.8\"/>`);",
    to: "    out(`<line x1=\"${bx}\" y1=\"${by}\" x2=\"${tx}\" y2=\"${ty}\" stroke=\"#666\" stroke-width=\"0.8\"/>`);" },


  // feature_labels.js - extracted 2026-08-27 from gen_internal.js, the block
  // extraction 7 left behind. MEASURED across the 18 maps with an internal
  // sheet: 17 of its 34 labelled branches are dark, and among them is every
  // fault path of all four guards. That is the guards WORKING - each was
  // written after a shipped sheet went wrong and the boards were then fixed -
  // but it also means the byte gate certifies none of them. Delete a guard and
  // all 20 maps stay byte-identical, until the next town sites a label badly.
  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "a hidden feature keeps its name, so a suppressed river is labelled on empty paper",
    find: "    if(ov.hide || lov.hide || !f.labelPos) return;",
    to: "    if(lov.hide || !f.labelPos) return;" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the coreBox guard goes, so a feature name prints inside the town-centre box",
    find: "    if(inCore([x,y])){",
    to: "    if(false){" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the panel guard goes, and a river name is struck across the Services list again",
    find: "    if(x>MX1+2){",
    to: "    if(false){" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the panel guard measures from the wrong edge, so nothing to the right ever trips it",
    find: "    if(x>MX1+2){",
    to: "    if(x>MX1+200){" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the footer guard goes, so six sheets print a name under the plate that covers it",
    find: "    if(FOOTER_SAFE && y>FOOTER_PLATE_TOP-1.5){",
    to: "    if(false){" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the footer guard loses its 1.5mm margin, so a name touching the plate is let through",
    find: "    if(FOOTER_SAFE && y>FOOTER_PLATE_TOP-1.5){",
    to: "    if(FOOTER_SAFE && y>FOOTER_PLATE_TOP+1.5){" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the stranded-label check is measured against ALL the geometry, including the part clipped off the page",
    find: "          if(!inFrame([px,py])) continue;",
    to: "          if(false) continue;" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "a long span is tested only at its ends, so a line crossing the frame reads as entirely clipped",
    find: "          const n = Math.max(2, Math.min(64, Math.ceil(Math.hypot(vx,vy)/2)));",
    to: "          const n = 1;" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the stranded threshold triples, so a name 70mm from its river passes without a word",
    find: "      else if(best > 25)",
    to: "      else if(best > 75)" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "\"no geometry at all\" and \"all of it clipped\" collapse into one message, so the remedy is wrong half the time",
    find: "      if(!anyInk)",
    to: "      if(false)" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the auto path stops reading the solved position and draws at the feature default instead",
    find: "      const got = autoPos[f.key];",
    to: "      const got = autoPos[f.key] || {x:0,y:0};" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "a label offset compounds with a hand position instead of losing to it",
    find: "    if(lov.pos){ x=lov.pos.x; y=lov.pos.y; } else if(lov.offset){ x+=lov.offset.dx; y+=lov.offset.dy; }",
    to: "    if(lov.pos){ x=lov.pos.x; y=lov.pos.y; } if(lov.offset){ x+=lov.offset.dx; y+=lov.offset.dy; }" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the label stops following the feature nudge, so a moved river leaves its name behind",
    find: "    x+=(ov.move&&ov.move.dx)||0; y+=(ov.move&&ov.move.dy)||0;               // follow the feature nudge",
    to: "    x+=0; y+=0;               // follow the feature nudge" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "an override text of \"\" falls back to the feature label, so there is no way to draw the line unnamed",
    find: "    const text=lov.text!=null?lov.text:f.label;",
    to: "    const text=lov.text||f.label;" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "labelItalic:false stops meaning upright, so every feature name is italic whatever the town says",
    find: "    const italic=f.labelItalic!==false, size=f.labelSize||4, anchor=lov.anchor||null;",
    to: "    const italic=true, size=f.labelSize||4, anchor=lov.anchor||null;" },

  { suite: 'feature_labels.test.js', file: 'feature_labels.js',
    what: "the feature name goes out unescaped, so an ampersand in a river name breaks the SVG",
    find: "${anchor?` text-anchor=\"${anchor}\"`:''} fill=\"${f.labelColor||'#7fb0d8'}\">${esc(text)}</text>`);",
    to: "${anchor?` text-anchor=\"${anchor}\"`:''} fill=\"${f.labelColor||'#7fb0d8'}\">${text}</text>`);" },

  // The provenance date. A byte gate cannot catch any of these three: it compares a
  // generator against its OWN previous output, so a date that is wrong on every map
  // reproduces perfectly for ever. That is how "(June 2026)" survived on 20 maps
  // until a member of the public reported errors on a sheet whose footer said it had
  // been cross-checked (OA-153).
  { suite: 'provenance_date.test.js', file: 'gen_internal.js',
    what: "the internal footer goes back to a hardcoded cross-check date, identical and wrong on every map",
    find: "const CHECKED_AT = RJ.checkedAt ? ` (${RJ.checkedAt})` : '';",
    to: "const CHECKED_AT = ' (June 2026)';" },

  { suite: 'provenance_date.test.js', file: 'gen_external_radial.js',
    what: "an absent checkedAt falls back to validFrom - a DIFFERENT claim, and already wrong on Huntingdon",
    find: "cross-checked with operators at bustimes.org${D.checkedAt ? ` (${D.checkedAt})` : ''}.`,",
    to: "cross-checked with operators at bustimes.org${D.checkedAt ? ` (${D.checkedAt})` : ` (${D.validFrom})`}.`," },

  { suite: 'provenance_date.test.js', file: 'gen_external_busway.js',
    what: "the busway footer states a date of its own again",
    find: "cross-checked with operators at bustimes.org${D.checkedAt ? `, ${D.checkedAt}` : ''}.`,",
    to: "cross-checked with operators at bustimes.org, June 2026.`," },

  // dash_fit.js - extracted 2026-08-30 from three copies of the same primitive
  // (OA-167). The whole reason it exists is that a comment saying "change one,
  // change all three" failed TWICE, so the mutations below are what the comment
  // could not be. Note the first one especially: it restores the design that was
  // tried, measured and REJECTED, and a suite that stays green under it is a suite
  // that would let the rejected design come back.
  { suite: 'dash_fit.test.js', file: 'dash_fit.js',
    what: 'the fit target goes back to a whole number of cycles - the design measured on 2026-08-29 and rejected, which took the estate from 2 slivers to SIX',
    find: "const DASH_TARGET = (DASH_ON + DASH_OFF / 2) / DASH_CYCLE;",
    to: "const DASH_TARGET = 1;" },

  { suite: 'dash_fit.test.js', file: 'dash_fit.js',
    what: 'tailInk always answers zero, so every pattern looks clean and the measure certifies whatever it is given',
    find: "  return r < on ? r : 0;",
    to: "  return 0;" },

  { suite: 'dash_fit.test.js', file: 'dash_fit.js',
    what: 'polylineLength measures the straight line between the ends instead of the drawn path, so a multi-point spoke is fitted to the wrong length',
    find: "    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);",
    to: "    len = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);" },

  // build_log.js MEASURED - the third severity (OA-118, 2026-08-30). Two of the
  // three below are about ORDER and ANCHORING rather than about the pattern, which
  // is where this rule can actually go wrong: it is the one rule in that file that
  // classifies on a prefix, and both of its neighbours are phrase rules.
  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'the phrase rules are consulted before the measurement prefix, so a measurement whose payload says "not drawn" is filed as a refusal and blocks the build',
    find: "  if (MEASURED.test(String(line))) return 'MEASURED';\n  return (REFUSED.test(line) || MEANINGLESS.test(line) || OVERFLOWED.test(line)\n          || CRASHED.test(line)) ? 'BLOCKING' : 'WARN';",
    to: "  const base = (REFUSED.test(line) || MEANINGLESS.test(line) || OVERFLOWED.test(line)\n          || CRASHED.test(line)) ? 'BLOCKING' : 'WARN';\n  return base === 'WARN' && MEASURED.test(String(line)) ? 'MEASURED' : base;" },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'the measurement pattern loses its start anchor, so any message merely CONTAINING "measure:" is reclassified as a number and stops being read as a fault',
    find: "const MEASURED = /^\\s*measure:\\s/;",
    to: "const MEASURED = /measure:\\s/;" },

  { suite: 'build_log.test.js', file: 'build_log.js',
    what: 'measurements are counted with the warnings again, so every build reports more faults than it has the moment a number is recorded',
    find: "  const nw = entries.length - nm;",
    to: "  const nw = entries.length;" },

  // engine_version.js - the PLACE template (OA-168, 2026-08-30). Every one of
  // these leaves the TOWN hash working perfectly, which is exactly the state the
  // row records: 12 place maps carried a current-looking stamp across a round that
  // moved ink on nine of them.
  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'the place closure is empty, so the place template collapses back onto the town one and a place-generator change is invisible again',
    find: "  const queue = PLACE_ENGINE_FILES.slice();",
    to: "  const queue = [];" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'a place stamp ignores the town closure, so a gen_internal.js change stops reaching the place sheet it actually draws',
    find: "function computePlaceEngineVersion(sk = SK, psk = placeAssetsDir(sk)) {\n  const h = crypto.createHash('sha256');\n  for (const name of engineFiles(sk)) {",
    to: "function computePlaceEngineVersion(sk = SK, psk = placeAssetsDir(sk)) {\n  const h = crypto.createHash('sha256');\n  for (const name of []) {" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'the place walk stops following requires, so a module the place generators share drops out of the place hash',
    find: "        if (!seen.has(dep) && fs.existsSync(path.join(psk, dep))) queue.push(dep);",
    to: "        if (false) queue.push(dep);" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'the dependency scanner cannot cross a nested paren again, so dash_fit.js drops out of the closure and the dashed-spoke pattern stops being hashed at all',
    find: "  /path\\.join\\((?:[^()]|\\([^()]*\\))*?['\"]([\\w.-]+\\.js)['\"]\\s*\\)/g, // path.join(<dir expr>, 'x.js')",
    to: "  /path\\.join\\([^()]*?['\"]([\\w.-]+\\.js)['\"]\\s*\\)/g,             // path.join(<dir>, 'x.js')" },

  { suite: 'engine_version.test.js', file: 'engine_version.js',
    what: 'isPlaceRun matches the word anywhere in the path instead of as a folder, so a town called Placesville is stamped with the place template',
    find: "  return path.resolve(dir).split(/[\\\\/]+/).includes('Places');",
    to: "  return path.resolve(dir).includes('Places');" },

];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-'));
const engine = path.join(scratch, 'assets');
fs.cpSync(ASSETS, engine, { recursive: true });

const runSuite = (suite) => spawnSync(process.execPath, ['--test', '--test-reporter=spec', path.join(SK, 'test', suite)],
  { cwd: SK, env: { ...process.env, ENGINE_DIR: engine }, encoding: 'utf8' });

let survived = 0, broken = 0;
const rows = [];

// A baseline first: the copied engine, unmutated, must be green. Otherwise every
// "the suite noticed" below could be the copy failing rather than the mutation.
const suites = [...new Set(MUTATIONS.map(m => m.suite))];
for (const suite of suites) {
  const r = runSuite(suite);
  if (r.status !== 0) {
    console.error(`BASELINE FAILED: ${suite} is red against an unmutated copy of the engine.`);
    console.error(r.stdout || r.stderr);
    process.exitCode = 1;
  }
}
if (process.exitCode === 1) { if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true }); return; }

for (const m of MUTATIONS) {
  const p = path.join(engine, m.file);
  const original = fs.readFileSync(p, 'utf8');
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) {
    rows.push(['ANCHOR', m.file, m.what, `the text to replace appears ${hits} times, not once`]);
    broken++;
    continue;
  }
  fs.writeFileSync(p, original.replace(m.find, m.to));
  const r = runSuite(m.suite);
  fs.writeFileSync(p, original);
  if (r.status === 0) {
    rows.push(['SURVIVED', m.file, m.what, `${m.suite} stayed green`]);
    survived++;
  } else {
    const first = (r.stdout.match(/^✖ (.+?) \(/m) || [, '(a test)'])[1];
    rows.push(['caught', m.file, m.what, `${m.suite}: ${first}`]);
  }
}

const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('\nMutation testing — one deliberate break at a time, against a scratch copy of assets/\n');
console.log(w('verdict', 9) + w('file', 22) + w('what was broken', 52) + 'which test objected');
console.log('-'.repeat(140));
for (const [v, f, what, detail] of rows) console.log(w(v, 9) + w(f, 22) + w(what, 52) + detail);
console.log('-'.repeat(140));
console.log(`${rows.length} mutations, ${rows.length - survived - broken} caught, ${survived} survived, ${broken} anchors stale.\n`);
if (survived || broken) {
  console.log('A mutation that SURVIVED is a hole in the suite: the engine did something wrong and');
  console.log('nothing said so. A stale ANCHOR means this file has drifted from the engine it edits.');
}
if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true });
else console.log('scratch copy left at ' + scratch);
process.exitCode = (survived || broken) ? 1 : 0;
