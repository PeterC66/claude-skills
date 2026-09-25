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
 * the one place this block is not byte-neutral when absent. `pharmacy`, `gp` and
 * — since OA-340 — `pub` can reach here nameless; every other category has a
 * fallback name from `classify()`, and a nameless symbol costs a full box for a
 * glyph nobody chose.
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
 * `allotments` and `pubs` are opt-in per town (poi.include) because most towns
 * do not want them; everything else is on for every town.
 *
 * WHY `pubs` IS OPT-IN RATHER THAN A CATEGORY LIKE THE OTHERS (OA-340, Peter's
 * decision of 2026-09-13, taken on the measurement in
 * `Development Docs/pubs-as-landmarks-measured_2026-09-13.md`). Estate-wide the
 * category is 116 more named symbols on top of the 340 the eight town sheets
 * carry — +34%, and +50% on St Neots — onto pages where 98 labels already do not
 * fit. Branded-only is a defensible 15, but it decides WHICH pubs by a tag that
 * records a tenancy rather than a landmark. Opt-in is byte-inert on the day it
 * lands and puts the judgement where the must/may/miss design already puts it:
 * with the local adviser, who knows that St Neots navigates by three pubs and
 * not by twenty-one.
 */
function classify(t, poiCfg) {
  const POI = poiCfg || {};
  if(t.shop==='supermarket') return ['shop', t.name||'Supermarket'];
  if(t.amenity==='pharmacy')  return ['pharmacy', t.name||''];
  if(t.amenity==='doctors')   return ['gp', t.name||''];
  if(t.amenity==='library')   return ['library', t.name||'Library'];
  if(t.tourism==='museum')    return ['museum', t.name||'Museum'];
  if(t.amenity==='townhall')  return ['townhall', t.name||'Town Hall'];
  if(t.amenity==='community_centre') return ['community', t.name||'Community Centre'];
  if(t.leisure==='sports_centre'||t.leisure==='fitness_centre') return ['leisure', t.name||'Leisure'];
  if(t.amenity==='school')    return ['school', t.name||'School'];
  if(t.leisure==='park'||t.leisure==='recreation_ground') return ['park', t.name||'Park'];
  if((POI.include||[]).includes('allotments') && t.landuse==='allotments') return ['allotments', t.name||'Allotments'];
  /* Below the named categories on purpose: a pub that OpenStreetMap ALSO tags as
   * a community centre or a restaurant-with-rooms is the thing that tag says
   * first, and a town that switched pubs on did not thereby ask for its village
   * hall to be redrawn as one. The fallback is deliberately blank rather than
   * 'Pub': a nameless pub is a bare glyph nobody chose, so OA-238's
   * nameless-`miss` default keeps it off the page while still offering it in the
   * chooser — see the `noName` rule below. */
  if((POI.include||[]).includes('pubs') && t.amenity==='pub') return ['pub', t.name||''];
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
/* `pub` is here because the whole point of the category is *the Wetherspoon* —
 * a pub symbol with no name beside it is no use to anybody navigating by it
 * (OA-340). It is also the one auto-named category with a BLANK fallback, so
 * `noName` below reads an unnamed pub as unnamed and leaves it off the page. */
const AUTO_NAMED_CATS = ['shop','leisure','school','park','community','allotments','pub'];

/** Does this POI's own name get printed beside its symbol, or is it symbol-only? */
function printsName(p){
  /* `p.name !== 'Park'` was this rule's first instance and OA-338 generalised it:
   * an unnamed green called *Park* names nothing, and neither does an unnamed
   * leisure centre called *Leisure*. One list, in `CATEGORY_LABELS`. */
  return AUTO_NAMED_CATS.includes(p.cat) && !unnamed(p.name);
}

/*
 * Which half of a POI's hand-set `label` a sheet honours (buses-data OA-165,
 * decided by Peter 2026-09-21). `force` says DRAW THIS NAME and is about the
 * map's content, so it holds on every sheet and is not read here. `label.offset`
 * and `label.anchor` are a millimetre nudge chosen by eye against the GEOGRAPHIC
 * layout; the schematic has redrawn that geometry octolinearly, so the same nudge
 * lands somewhere unrelated — on High Wycombe Aldi it put the Aldi label on the
 * route 27 line against a stop. On the schematic both are dropped and the placer
 * seats the label itself; every other key survives, and a label left with nothing
 * in it is no label. Any other sheet gets the block unchanged.
 */
function poiLabelOverride(label, notToScale){
  if(!label || notToScale !== 'schematic') return label || null;
  const { offset, anchor, ...rest } = label;
  return Object.keys(rest).length ? rest : null;
}

/** Two points closer than 60 m are the same place mapped twice. */
/*
 * A CATEGORY LABEL IS NOT A NAME, and until 2026-09-13 three things treated it
 * as one (OA-338).
 *
 * `classify()` supplies one of these strings when OpenStreetMap has not named
 * the place. It exists so the sheet can print *Community Centre* under a symbol
 * rather than nothing, and it is a DISPLAY string — but it was also being used
 * as the de-duplication identity and as the does-this-have-a-name test, and in
 * both of those it asserts something the data never said. Two unnamed sports
 * centres are not the same sports centre because they are both called `Leisure`.
 *
 * This set is the whole population of that mistake and is derived from the
 * fallbacks in `classify()` above; `test/poi_select.test.js` holds it against
 * them, so a new category with a new fallback cannot quietly escape it.
 */
const CATEGORY_LABELS = new Set(['Supermarket','Library','Museum','Town Hall',
  'Community Centre','Leisure','School','Park','Allotments','Industrial Estate']);

/** True when this POI has no name of its own — blank, or a label standing in for one. */
function unnamed(name){ return !name || CATEGORY_LABELS.has(name); }

const metresApart = (a,b) => Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*70000);

/*
 * IS THIS THE SAME PLACE MAPPED TWICE? Three answers, and each distance is a
 * measurement rather than a preference (OA-338, 2026-09-13).
 *
 *   no name on one side   the only evidence is position, so 60 m — a shop mapped
 *                         as a node AND as its building. This is the arm OA-234
 *                         restored for blank names, now reaching the labels too.
 *   the same real name    250 m, because one site is often mapped as two ways:
 *                         St Ivo Outdoor 82 m, Wycombe Preparatory 123 m,
 *                         Westwood Primary 178 m, High March 183 m are all one
 *                         place. Beyond that a shared name is a CHAIN — four
 *                         Boots in Wisbech, five libraries in High Wycombe — and
 *                         collapsing them deleted 32 real places from the estate.
 *   one name inside the   60 m. `Tesco` and `Tesco Extra` 39 m apart are one shop
 *   other                 under two spellings; `Superdrug` and `Boots` 24 m apart
 *                         are two chemists, and the sheet drew one of them.
 *
 * Two DIFFERENT names never collapse, at any distance. That is the rule that
 * puts Boots back on the St Neots sheet, and it is deliberately the loose end of
 * the three: where OpenStreetMap maps two parts of one site under two names, both
 * are now drawn. That is the right way round — a spurious symbol is visible on
 * the page and answerable with `miss` in the landmark chooser, and a deleted one
 * is neither.
 */
function sameThing(a, b){
  if(a.cat !== b.cat) return false;
  const d = metresApart(a.ll, b.ll);
  if(unnamed(a.name) || unnamed(b.name)) return d < 60;
  if(a.name === b.name) return d < 250;
  const x = a.name.toLowerCase(), y = b.name.toLowerCase();
  if(x.includes(y) || y.includes(x)) return d < 60;
  return false;
}

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
    for(const q of dedup){ if(sameThing(q,p)){ continue outer; } }
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
   * fallback name for every category except `pharmacy`, `gp` and `pub`, so the
   * population of this rule is a chemist, a surgery, or (since OA-340, on a town
   * that has switched pubs on) a pub OpenStreetMap has not named.
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
  /* OA-338 WIDENS THIS TO THE CATEGORY LABELS, 2026-09-13, and the paragraph
   * above is why: it says the whole population of this rule is a chemist or a
   * surgery, because those are the only two categories `classify()` leaves
   * blank. That was true of the CODE and never of the RULE. An unnamed sports
   * centre reached here called `Leisure`, read as named, defaulted to `may` and
   * printed the word *Leisure* on the sheet beside its symbol — `leisure` is an
   * auto-named category — which is exactly the bare glyph nobody chose that this
   * default exists to stop, wearing a label to get past it. Wisbech has four
   * unnamed sports centres and printed *Leisure*; it is now offered four rows
   * in the chooser and prints none of them until somebody names one. */
  /* THE LABEL RULE APPLIES HERE ONLY TO A CATEGORY THAT PRINTS A NAME, and that
   * narrowing was bought by looking at the artwork rather than by reasoning
   * (OA-338, the estate rollout). Dropping every label-named POI took eleven
   * symbols off the estate: ten were `Leisure`, `Community Centre` and
   * `Allotments` -- auto-named categories where the label WAS the visible word,
   * and exactly what this default exists to stop. The eleventh was
   * Beaconsfield's town hall, and it was a plain regression.
   *
   * A symbol-only category prints nothing either way, so OA-238's argument --
   * `a bare glyph nobody chose` -- does not reach it: for a town hall, a library
   * or a museum the CATEGORY is the choice, the symbol is the information, and
   * whether OpenStreetMap happens to carry a name changes nothing a reader sees.
   * For pharmacy and gp, which reach here genuinely blank, the behaviour is
   * exactly what OA-238 decided and this line is unchanged. A `pub` reaches here
   * blank too but is auto-named, so it takes the first arm and is missed — which
   * is OA-340's own answer to *what does a nameless pub do*.
   *
   * De-duplication still reads a label as no-name for EVERY category, which is
   * the other half of OA-338 and is not affected: two unnamed town halls 5 km
   * apart are two town halls. */
  const noName = p => (AUTO_NAMED_CATS.includes(p.cat) ? unnamed(p.name) : !p.name);
  const defaultRule = p => ({ tier: noName(p) ? 'miss' : 'may', as: null });
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
    /* The key is stamped onto the POI as well as counted. `as` REPLACES the
     * identity two lines below, so a caller holding the kept POI afterwards
     * cannot reconstruct which answer it came from — and the one thing a caller
     * has to be able to say about a classified place it then drops is which key
     * the customer wrote. `tierKey` is that key as they wrote it, before any
     * rename. It is read by gen_internal.js's culledAfterTiers block (OA-250
     * item 2) and by nothing else; it is not serialised anywhere. */
    if(explicit(p)){ used.add(k); p.tierKey = k; }
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

/* A TIER THAT MATCHED AND WAS THEN CULLED BY THE SHEET (OA-250 item 2).
 *
 * `report.unknownTierKeys` catches the answer that matched nothing. This is the
 * opposite and quieter failure: the key DID match a real POI, so it is not
 * unknown, and the place then never became a label candidate on that sheet, so
 * it is not in `unplaced.json` either. It falls out between the two, and until
 * this function existed nothing anywhere said so. High Wycombe is the worked
 * case: the Library and the Museum were both marked `must` in the chooser on
 * 2026-09-02 and both sit inside that town's 600 m `coreBox`, which the
 * geographic sheet leaves blank — so the two places a visitor is most likely to
 * be walking to are the two the sheet cannot name.
 *
 * IT LIVES HERE AND NOT IN THE GENERATOR because the tier key is this module's
 * fact — `as` replaces the identity, so only `tierKey` still holds the key the
 * customer wrote — while the reason is the generator's, and is passed in. A
 * generator supplies `why`: a function from the POI's CURRENT key (after any
 * rename, which is what a frame test would have been given) to a short reason,
 * or a falsey value when the place was drawn.
 *
 * `hide` IS NOT REPORTED, and that exclusion is the point rather than an
 * oversight. It is an override the customer wrote themselves, in a file they
 * can read, saying exactly this: an answer that succeeded. The frame and the
 * core are decisions the ENGINE made about their answer, and those are the ones
 * they are owed a sentence about.
 *
 * Takes the KEPT list — a `miss` never reaches a sheet at all and its absence is
 * the answer working, not failing.
 *
 * ONE ROW PER KEY, not per POI. Where two places share a key — the collision
 * item 1 of OA-250 is about — there is still only ONE answer, written once, and
 * the customer is owed one sentence about it. High Wycombe carries three Boots
 * and would otherwise name the same key three times in a message already long
 * enough to go unread. A row is `must` if ANY of the places under that key was.
 *
 * SORTED, because a build message is read by a person and `must` is the thing
 * they answered hardest: the strongest answers first, and stable within that so
 * the line does not reshuffle between two builds of the same sheet. */
function culledAfterTiers(kept, why){
  const byKey = new Map();
  for(const p of kept){
    if(!p.tierKey) continue;                       // nobody classified this place
    const reason = why(p.cat + ':' + p.name);
    if(!reason || reason === 'hide') continue;
    const row = byKey.get(p.tierKey);
    if(row){ row.must = row.must || p.tier === 'must'; }
    else byKey.set(p.tierKey, { key: p.tierKey, why: reason, must: p.tier === 'must' });
  }
  const out = [...byKey.values()];
  out.sort((a,b) => (b.must - a.must) || 0);       // stable: insertion order within a tier
  return out;
}

/* The build message for the rows above, or '' when there are none — here rather
 * than in the generator because gen_internal.js is the file the line ratchet
 * holds, and a paragraph of prose about tiers is exactly the growth that rule
 * exists to push back into a module.
 *
 * CAPPED AT SIX, like the unplaced-labels line it sits beside. High Wycombe
 * culls 31 keys; a message naming all of them is a paragraph nobody reads and
 * the three that matter are buried in it. The `must`s are sorted first and the
 * count carries the rest. */
function culledAfterTiersNote(culled){
  if(!culled.length) return '';
  const musts = culled.filter(c=>c.must).length;
  const where = c => (c.why === 'core' ? 'inside the blank coreBox' : 'outside the frame');
  return 'poi.tiers: ' + culled.length + ' classified place' + (culled.length>1?'s':'')
    + ' matched a key and then fell off this sheet'
    + (musts ? ' — ' + musts + ' of them a "must"' : '') + ': '
    + culled.slice(0,6).map(c => '"'+c.key+'" ('+where(c)+(c.must?', a "must"':'')+')').join(', ')
    + (culled.length>6 ? ', and ' + (culled.length-6) + ' more' : '')
    /* `coreBox` BARE, with no `design.` in front of it: it is a top-level
     * routes.json key read through complexity_ladder.js, and the prefixed
     * spelling invented a 37th design key for the register gate to hunt — which
     * that gate caught in CI, from inside a string, and then again from inside
     * the comment that explained the first one. */
    + '. The answer was applied and the sheet still cannot show it. Widen or drop'
    + ' the coreBox, widen the frame, or tell whoever classified it that this'
    + ' place is off the edge of the town sheet.';
}

/* ONE PLACER IDENTITY PER POI, whatever its key (buses-data OA-250 item 1).
 *
 * The labeller files every result under the label's id, so two POIs queued as the
 * same `poi:<category>:<name>` came back as ONE record read twice: the second
 * caption printed on top of the first at byte-identical coordinates, the first
 * POI's own name was lost without appearing in unplaced.json, and its icon box and
 * spreadIcons nudge were the other one's. Nine captions on four committed sheets
 * were doubled that way (High Wycombe's Aldi and British Legion, St Neots' two
 * Lidls 2.9 km apart), measured 2026-09-17 and again 2026-09-24.
 *
 * The FIRST POI with a key keeps the key itself, so a sheet with no collision
 * moves no byte; the second is `<key>#2`, the third `<key>#3`, in the order
 * selectPois returned them — which is file order, so it is stable between builds.
 * This is the RENDER identity only: the override key, the tier answer and the
 * editor's data-key are still `<category>:<name>` and still address both places,
 * which is the half of OA-250 this does not close. A reader of `poi:` ids in
 * unplaced.json strips the `#n` to get back to the key (poi_worksheet.js).
 *
 * Returns a Map from each POI object to its id. */
function placerIds(pois){
  const seen = new Map(), ids = new Map();
  for(const p of pois){
    const k = p.cat + ':' + p.name, i = (seen.get(k) || 0) + 1;
    seen.set(k, i);
    ids.set(p, i === 1 ? k : k + '#' + i);
  }
  return ids;
}

module.exports = { classify, selectPois, placerIds, applyTiers, culledAfterTiers, culledAfterTiersNote, sameThing, unnamed, CATEGORY_LABELS, AUTO_NAMED_CATS, printsName, poiLabelOverride };
