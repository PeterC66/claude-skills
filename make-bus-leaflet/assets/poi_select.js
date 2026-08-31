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
 *   7. tiers      — the customer's must / may / miss answer, plus rename.
 * Tidying runs BEFORE de-duplication on purpose: two spellings of one name are
 * only duplicates once they have been tidied to the same string.
 *
 * TIERS — must / may / miss, and why they sit HERE (OA-202, 2026-08-31).
 * `poi.tiers` is an object keyed on the POI's identity, `"<cat>:<name>"`, the
 * same key `internal.pois` overrides use. Each value is either the bare string
 * `"must"` / `"may"` / `"miss"`, or `{ "tier": "...", "as": "display name" }`.
 *
 *   miss  dropped RIGHT HERE, at selection. That timing is the whole saving and
 *         it is not interchangeable with the portal's render-time `hide`: a
 *         symbol dropped at selection never reserves its 4.2 x 4.2 mm box, never
 *         becomes a placer anchor, and never appears in ci-reference, the byte
 *         gate or the quality ledger. A render-time hide leaves all three
 *         describing a sheet nobody sees.
 *   must  kept, and marked `tier:'must'` for the caller. gen_internal.js turns
 *         that into `priority: 10, mustPlace: true` and prints the name whatever
 *         its category. It is a strong preference, NOT a veto — the placer can
 *         still fail to seat it, which is why gen_internal.js names any `must`
 *         it dropped rather than letting the answer fail in silence.
 *   may   today's behaviour exactly. The default for every POI nobody has
 *         classified, which is what keeps this block byte-neutral when absent.
 *
 * KEYS ARE READ AFTER TIDYING AND AFTER DE-DUPLICATION — they are the identities
 * that actually reach the page, and the ones the worksheet asks about — and a
 * rename REPLACES the identity. `"as"` sets `p.name`, so from that point on the
 * POI's key, for `internal.pois`, for `unplaced.json`, for `indexed.json` and
 * for the byte gate, is the NEW name. One rule applied everywhere, rather than a
 * display string that drifts from the thing it names. See applyTiers() for why
 * the order is not negotiable, and for the collision a rename can still cause.
 *
 * A KEY THAT MATCHES NOTHING IS REPORTED, never ignored. Pass the optional third
 * argument and `report.unknownTierKeys` lists every key that named no selected
 * POI — a misremembered name, or one the tidy rules have already rewritten. A
 * classification nobody has ever seen take effect is worse than no
 * classification at all, because the customer believes it was applied.
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

function selectPois(elementSets, poiCfg, report) {
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
  return applyTiers(dedup, POI, report);
}

/*
 * tiers — the customer's must / may / miss answer, applied LAST.
 *
 * AFTER de-duplication, not before, and that ordering is the whole reason this
 * is a function rather than three lines in the filter chain. De-duplication
 * keeps the FIRST of a colliding pair: a tier applied earlier could be attached
 * to the copy that is about to be thrown away, and the key would then be
 * recorded as APPLIED while nothing on the sheet had changed. Running here means
 * the keys this reads are exactly the identities that reach the page, which is
 * also exactly what the worksheet asks the customer about.
 *
 * A `miss` is no more expensive here than it would have been earlier — nothing
 * outside this module has seen the list yet, so a POI dropped on this line never
 * reserves its box, never becomes an anchor and never reaches ci-reference.
 */
function applyTiers(pois, POI, report){
  const TIERS = POI.tiers || null;
  if(!TIERS) return pois;
  const rule = v => (typeof v === 'string' ? { tier: v, as: null }
                                           : { tier: (v && v.tier) || 'may', as: (v && v.as) || null });
  const used = new Set();
  const kept = [];
  for(const p of pois){
    const k = p.cat+':'+p.name;
    if(!(k in TIERS)){ kept.push(p); continue; }
    used.add(k);
    const r = rule(TIERS[k]);
    if(r.tier === 'miss') continue;                // never drawn, never reserved
    if(r.as) p.name = r.as;                        // a rename REPLACES the identity
    if(r.tier === 'must') p.tier = 'must';
    kept.push(p);
  }
  if(report){
    // A key nobody matched is the failure this whole block exists to avoid: the
    // customer believes their answer was applied and no sheet ever changed.
    report.unknownTierKeys = Object.keys(TIERS).filter(k=>!used.has(k));
    // A rename can only collide AFTER the fact, because de-duplication has
    // already run on the old names. Two POIs sharing one key share an override
    // key and a placer anchor id, so say so rather than drawing them both.
    const seen = new Set(), dup = [];
    for(const p of kept){ const k=p.cat+':'+p.name; if(seen.has(k)) dup.push(k); else seen.add(k); }
    report.renameCollisions = dup;
    report.tierCounts = { must:0, may:0, miss:0 };
    for(const k of Object.keys(TIERS)){
      const t = rule(TIERS[k]).tier;
      if(report.tierCounts[t] != null) report.tierCounts[t]++;
    }
  }
  return kept;
}

module.exports = { classify, selectPois, applyTiers, near };
