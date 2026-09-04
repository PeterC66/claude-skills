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
 *   6. de-duplicate by category plus either an identical NON-EMPTY name or a
 *      point within 60 m, which is what collapses the same shop mapped as node
 *      and building. Two blank names are not a match (OA-234) — they used to be,
 *      and the second unnamed chemist in a town was deleted at any distance.
 *   7. tiers      — the customer's must / may / miss answer, plus rename, over a
 *      default that is `may` for a named POI and `miss` for a nameless one.
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
 *   may   drawn as it always was. The default for every NAMED POI nobody has
 *         classified, which is what keeps this block byte-neutral when absent.
 *
 * THE DEFAULT FOR A POI WITH NO NAME IS `miss` (OA-238, 2026-09-04), and it is
 * the one place this block is not byte-neutral when absent. Only `pharmacy` and
 * `gp` can reach here nameless — every other category has a fallback name from
 * `classify()` — and a nameless symbol costs a full box for a glyph nobody chose.
 * It is still listed in `report.candidates` so the local can name it or confirm
 * the miss; an explicit answer in `poi.tiers` overrides the default either way.
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

/*
 * WHICH CATEGORIES PRINT A NAME, in one place (OA-212, 2026-09-01).
 *
 * The other categories — pharmacy, GP, library, museum, townhall, industrial —
 * draw a symbol the Key explains and nothing more. That matters to a customer
 * far more than it looks: a symbol with no name costs exactly the same 4.2 mm
 * square as one with a name, so "symbol only" is the sentence that makes a
 * `miss` an obvious answer rather than a loss.
 *
 * IT LIVES HERE BECAUSE IT HAD ALREADY BEEN COPIED. The rule was written out
 * twice — `gen_internal.js` decides `auto` with it, and `poi_worksheet.js` kept
 * a hand-typed `AUTO_NAMED` beside it to print *symbol only* in the worksheet.
 * Two copies of one rule, in two files, with nothing comparing them; the
 * landmark chooser would have been a third. `park` carries a second clause —
 * an unnamed green is called "Park" and names nothing — and that clause was in
 * both copies too.
 */
const AUTO_NAMED_CATS = ['shop','leisure','school','park','community','allotments'];

/** Does this POI's own name get printed beside its symbol, or is it symbol-only? */
function printsName(p){
  return AUTO_NAMED_CATS.includes(p.cat) && !!p.name && p.name !== 'Park';
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
  /* de-duplicate by cat+name, and collapse near-duplicate points (<60 m).
   *
   * `p.name &&` IS LOAD-BEARING (OA-234, 2026-09-04). Without it two POIs whose
   * names are both '' compare EQUAL by name, so the second unnamed pharmacy in a
   * town was deleted here at ANY distance whatever — it never became a candidate,
   * never reached the landmark chooser, never got a symbol and never got a key,
   * because there was no second POI. Measured directly rather than read: two
   * unnamed `amenity=pharmacy` 5.5 km apart came out as one, while two NAMED
   * supermarkets the same distance apart came out as two.
   *
   * The blank case belongs to `near()` alone, which is the question this arm was
   * always meant to be asking: 60 m means *the same place mapped twice*. Two
   * survivors then share the key `pharmacy:` — a real collision, and the one the
   * row was originally filed about — so applyTiers REPORTS it below rather than
   * this line hiding it. Measured over all 18 sheet-drawing maps' latest S2
   * sweeps on 2026-09-04: zero POIs un-deleted anywhere, so the fix is byte-inert
   * on today's estate and is here for the town that gets a second one. */
  const dedup=[];
  outer: for(const p of pois){
    for(const q of dedup){ if(q.cat===p.cat && ((q.name===p.name && p.name) || near(q.ll,p.ll))){ continue outer; } }
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
  const rule = v => (typeof v === 'string' ? { tier: v, as: null }
                                           : { tier: (v && v.tier) || 'may', as: (v && v.as) || null });

  /* THE DEFAULT IS NOT ALWAYS `may` ANY MORE (OA-238, Peter's decision 2026-09-03).
   *
   * A POI with no name prints nothing beside its symbol — `classify()` supplies a
   * fallback name for every category except `pharmacy` and `gp`, so the whole
   * population of this rule is a chemist or a surgery OpenStreetMap has not named.
   * It costs the same 4.2 x 4.2 mm box and the same placer anchor as a named one,
   * for a bare glyph nobody chose. So it defaults to NOT DRAWN.
   *
   * IT IS STILL OFFERED, and that is the half that makes this Peter's answer
   * rather than the "just drop them" he was offered. It stays in
   * `report.candidates` — the list the portal's landmark chooser enumerates —
   * carrying `tier:'miss'`, so the person who lives there sees the row, can give
   * it a name with `as` (which promotes it, because `rule()` reads an object with
   * no explicit tier as `may`) or can confirm the `miss`. A POI absent from that
   * list could not be shown as missed and could never be turned back on, which is
   * the one-way control the block below already warns about.
   *
   * AN EXPLICIT ANSWER STILL WINS, in both directions. This is a DEFAULT, and a
   * town that has classified `"pharmacy:"` keeps whatever it said. High Wycombe
   * says `"may"`, which is why the estate loses two symbols under this change and
   * not three — see report.namelessKeptByTier below, which exists so that is
   * visible at build time rather than being something a reader has to know. */
  const defaultRule = p => ({ tier: p.name ? 'may' : 'miss', as: null });
  const explicit = p => !!(TIERS && ((p.cat + ':' + p.name) in TIERS));
  const ruleFor = p => (explicit(p) ? rule(TIERS[p.cat + ':' + p.name]) : defaultRule(p));

  /* CANDIDATES — every identity that got this far, whatever its tier, filled
   * whether or not this town has classified anything.
   *
   * A `miss` LEAVES NO TRACE ANYWHERE DOWNSTREAM. That is the point of doing it
   * here rather than at render time, and it is also the reason a caller that
   * wants to OFFER the choice cannot read the answer back off the finished
   * sheet: until 2026-09-01 the portal enumerated a map's POIs by running the
   * generator and scraping `data-key` out of the SVG, so a POI somebody had
   * classified `miss` was absent from the list, could not be shown as missed,
   * and could never be turned back on. One-way controls are how a customer
   * comes to distrust the whole panel.
   *
   * So the list of what COULD be drawn is published here, beside the list of
   * what will be — same chain, same de-duplication, same tidy rules, no second
   * code path to drift. It is read before the rename below, because the key a
   * tier is written against is the identity as it stood BEFORE `as` replaced
   * it, and a chooser that offered the new name would write a key that matches
   * nothing. */
  if(report){
    report.candidates = pois.map(p => {
      const k = p.cat + ':' + p.name;
      const r = ruleFor(p);
      return { key:k, cat:p.cat, name:p.name, ll:p.ll, tier:r.tier, as:r.as, printsName:printsName(p) };
    });
    /* TWO CANDIDATES SHARING ONE KEY, which only became possible on 2026-09-04
     * (OA-234). Until then de-duplication deleted the second unnamed POI of a
     * category, so this list could not have had a duplicate in it — which is why
     * the measurement that reported "duplicate keys: none" for every town could
     * never have said anything else. Now the second one survives, and two POIs
     * keyed `pharmacy:` share an override key, a tier answer and a placer anchor
     * id. That is a real problem and it is REPORTED rather than silently
     * collapsed, because the alternative is the deletion this row removed.
     * `renameCollisions` below cannot cover it: it runs only for a town with a
     * `poi.tiers` block, and it looks at names AFTER renaming. */
    const seenK = new Set(), dupK = [];
    for(const p of pois){
      const k = p.cat + ':' + p.name;
      if(seenK.has(k)){ if(!dupK.includes(k)) dupK.push(k); } else seenK.add(k);
    }
    report.duplicateCandidateKeys = dupK;
    // A nameless POI that is drawn only because this town's config says so. Not a
    // fault — it is the customer's answer — but it is the one case where the sheet
    // disagrees with the default, so say which town and which key.
    report.namelessKeptByTier = pois.filter(p => !p.name && explicit(p) && ruleFor(p).tier !== 'miss')
                                    .map(p => p.cat + ':' + p.name);
  }

  const used = new Set();
  const kept = [];
  for(const p of pois){
    const k = p.cat+':'+p.name;
    // No early return on a missing TIERS block any more: the nameless default
    // above has to apply to a town that has classified nothing, and Huntingdon
    // and St Neots — the two the estate loses a symbol on — are exactly that.
    if(explicit(p)) used.add(k);
    const r = ruleFor(p);
    if(r.tier === 'miss') continue;                // never drawn, never reserved
    if(r.as) p.name = r.as;                        // a rename REPLACES the identity
    if(r.tier === 'must') p.tier = 'must';
    kept.push(p);
  }
  if(report && TIERS){
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

module.exports = { classify, selectPois, applyTiers, near, AUTO_NAMED_CATS, printsName };
