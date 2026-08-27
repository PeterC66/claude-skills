/*
 * poi_select.js — which points of interest reach the internal sheet, and under
 * what name.
 *
 * CONTRACT. `selectPois(elementSets, poiCfg)` takes raw OpenStreetMap elements
 * (one array per source file, in the order they should be considered) and the
 * town's `routes.json` `poi` block, and returns the drawable list:
 * `[{ cat, name, ll:[lat,lon] }, …]`. It reads no files, touches no globals and
 * makes no decisions about DRAWING — placement, icons, collision and the
 * overrides in `internal.pois` all stay with the caller. Extracted from
 * gen_internal.js on 2026-08-27 (OA-129 Phase 3); `classify` had exactly one
 * caller and still does.
 *
 * ORDER IS PART OF THE ANSWER. De-duplication keeps the FIRST of a colliding
 * pair, so the order elements arrive in decides which name and which coordinate
 * survive. That is why this takes an array of arrays rather than one flat list:
 * the caller's file order (osm.json, then osm2.json) is load-bearing, and
 * flattening it somewhere else would move it out of sight. Nothing here sorts.
 *
 * THE FILTERS, IN THE ORDER THEY RUN, because each one sees what the last left:
 *   1. classify   — an element with no recognised tag is not a POI at all.
 *   2. industrial — a named list, "none", or (default) any estate with a name.
 *   3. excludeName— one case-insensitive alternation over every category.
 *   4. unnamed greens — always dropped; a park called "Park" names nothing.
 *   5. tidy       — generic bracket/suffix strip, then per-town suffix rules,
 *                   then whole-name canonicalisation.
 *   6. de-duplicate by category plus either an identical name or a point within
 *      60 m, which is what collapses the same shop mapped as node and building.
 * Tidying runs BEFORE de-duplication on purpose: two spellings of one name are
 * only duplicates once they have been tidied to the same string.
 */
'use strict';

/**
 * The OSM tag combinations this engine draws, in precedence order — the first
 * match wins, so a leisure centre tagged as a school stays a school only if the
 * school test comes first. Returns [category, name] or null for "not a POI".
 * `allotments` is opt-in per town (poi.include) because most towns do not want
 * them; everything else is on for every town.
 */
function classify(t, poiCfg) {
  const POI = poiCfg || {};
  if(t.shop==='supermarket') return ['shop', t.name||'Supermarket'];
  if(t.amenity==='pharmacy')  return ['pharmacy', t.name||''];
  if(t.amenity==='doctors')   return ['gp', t.name||''];
  if(t.amenity==='library')   return ['library','Library'];
  if(t.tourism==='museum')    return ['museum','Museum'];
  if(t.amenity==='townhall')  return ['townhall','Town Hall'];
  if(t.amenity==='community_centre') return ['community', t.name||'Community Centre'];
  if(t.leisure==='sports_centre'||t.leisure==='fitness_centre') return ['leisure', t.name||'Leisure'];
  if(t.amenity==='school')    return ['school', t.name||'School'];
  if(t.leisure==='park'||t.leisure==='recreation_ground') return ['park', t.name||'Park'];
  if((POI.include||[]).includes('allotments') && t.landuse==='allotments') return ['allotments', t.name||'Allotments'];
  if(t.landuse==='industrial') return ['industrial', t.name||'Industrial Estate'];
  return null;
}

/** Two points closer than 60 m are the same place mapped twice. */
const near = (a,b) => Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*70000)<60;

function selectPois(elementSets, poiCfg) {
  const POI = poiCfg || {};
  let pois=[];
  for(const elements of elementSets){
    for(const e of (elements||[])){
      const t=e.tags||{}; const c=classify(t, POI); if(!c) continue;
      const ll=e.lat!=null?[e.lat,e.lon]:(e.center?[e.center.lat,e.center.lon]:null); if(!ll) continue;
      pois.push({cat:c[0], name:c[1], ll});
    }
  }
  // industrial: keep a named list (array), drop all ("none"), or keep any named (default)
  const IND = POI.industrialKeep;
  pois = pois.filter(p=>{
    if(p.cat!=='industrial') return true;
    if(IND==='none') return false;
    if(Array.isArray(IND)) return IND.includes(p.name);
    return !!(p.name && p.name!=='Industrial Estate');   // default: keep named estates
  });
  // drop POIs whose name matches any excludeName pattern (case-insensitive, any cat)
  const EXN = POI.excludeName||[];
  if(EXN.length){ const exRe=new RegExp(EXN.join('|'),'i'); pois=pois.filter(p=>!exRe.test(p.name)); }
  // drop unnamed greens (always)
  pois = pois.filter(p=> !(p.cat==='park' && (p.name==='Park'||!p.name)));
  // tidy names: generic strip, then per-town tidy[] (suffix replaces), then canon[] (whole-name)
  const TIDY  = (POI.tidy ||[]).map(([re,to])=>[new RegExp(re),    to]);
  const CANON = (POI.canon||[]).map(([re,to])=>[new RegExp(re,'i'),to]);
  for(const p of pois){
    p.name = p.name.replace(/\s*\(.*?\)/g,'').replace(/\s*-\s*building$/i,'').trim();
    for(const [re,to] of TIDY) p.name = p.name.replace(re,to);
    for(const [re,to] of CANON) if(re.test(p.name)) p.name=to;
  }
  // de-duplicate by cat+name, and collapse near-duplicate points (<60 m)
  const dedup=[];
  outer: for(const p of pois){
    for(const q of dedup){ if(q.cat===p.cat && (q.name===p.name || near(q.ll,p.ll))){ continue outer; } }
    dedup.push(p);
  }
  return dedup;
}

module.exports = { classify, selectPois, near };
