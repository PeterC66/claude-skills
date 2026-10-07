#!/usr/bin/env node
/*
 * poi_tiers_sync.js — carry a town's landmark answer from the portal into the
 * town's own source data, and say what that would change before writing it.
 * buses-data OA-233 (2026-09-05).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets):
 *
 *   node poi_tiers_sync.js --town "High Wycombe"                    # dry run: print the diff, write nothing
 *   node poi_tiers_sync.js --town "High Wycombe" --apply            # write a NEW S3 run carrying the merge
 *   node poi_tiers_sync.js --town "High Wycombe" --from block.json  # the block from a file instead of the portal
 *   node poi_tiers_sync.js --town "High Wycombe" --json             # the comparison, machine-readable
 *
 * `--town` is the folder name under Areas/. `--buses` overrides the data tree
 * (default: the BUSES_DIR convention in cli.js). `--url` and `--token` name a
 * portal and its read-only OPERATOR_TOKEN; when absent they are read from
 * BUSMAPS_URL / BUSMAPS_TOKEN, and failing that from the portal checkout's own
 * .env (`--portal DIR`, default C:\Claude\community-bus-maps). `--note` is the
 * S3 commit note under --apply; without it one is written for you. `--map-id`
 * overrides the town -> portal map match. Nothing else is a parameter.
 *
 * WHY THIS EXISTS. The chooser's "Copy for our records" put the same block on
 * the clipboard and touched no file, set no flag and told no server, so the fact
 * that a town's answer was waiting to be pasted existed only in the head of
 * whoever pressed it. High Wycombe's 145 keys travelled that way on 2026-09-03
 * (buses-data 5b971e1), by hand, into an already-committed S3 run — something
 * nobody can diff, date or attribute. This reads `GET /api/maps/:id/poi-tiers`
 * instead, and under --apply writes a NEW S3 run through stage.js, so the
 * arrival is a manifest entry with a note.
 *
 * WHICH MAP IS WHICH TOWN. The portal keys on a map id and this tree on a folder
 * name; the rule here is the one bus-work's worklist already uses — an AREA map
 * whose `name` equals the town folder, case-insensitively — and it is stated
 * rather than guessed at: a town with no such map, or two, is a refusal.
 *
 * MERGE, DO NOT REPLACE. A key only in the source stays (High Wycombe's `as` on
 * Bellfield House, and The Hive's `must`, were both set here before the chooser
 * existed). A key in both with a different answer takes the PORTAL's, because
 * that is the newer word from the person who knows the town, and it is printed
 * as CHANGED with both values so the older one is not lost silently. A key only
 * in the portal is ADDED.
 *
 * AND THE CATEGORY SWITCH TRAVELS WITH THE TIERS (OA-439, 2026-09-28). The
 * Landmarks page switches pubs, allotments and stations on or off per map, and
 * /poi-tiers returns that as `include`; it is carried into poi.include by
 * compareInclude() below, printed as its own block, and owed like a key.
 *
 * EXCEPT THE KEYS THAT CAN CHANGE NOTHING. Two kinds since OA-517 (Peter's
 * landmark precedence, 2026-09-29, in references/landmark-precedence.md): a key
 * in a category the CUSTOMER has switched off, which no tier can bring back; and
 * a `miss` in a category this town has off anyway, or on an estate under
 * `poi.industrialKeep: "none"`, which leaves out a place the default already
 * leaves out. High Wycombe's 26 `miss` estates are the second kind, and exactly
 * why the 2026-09-03 paste wrote 145 keys and not 171. Those are reported as
 * UNREACHABLE, counted, and not written; a worklist comparing the two sides must
 * apply the same rule or it will raise a row nothing can ever clear.
 * `unreachableKeys()` is that rule, in one place, so both callers share it.
 * Before OA-517 a `must` or `may` in an off category was unreachable too; it
 * is not any more, because a tier now beats the map's own switch.
 *
 * AND EXCEPT THE KEYS WHOSE SUBJECT HAS BEEN RE-IDENTIFIED SINCE THE ANSWER WAS
 * GIVEN (OA-354, 2026-09-19). A key is `<category>:<name>`, so a later
 * OpenStreetMap pull that NAMES a POI which used to be nameless retires every
 * stored answer about it: the answer is still true, still on the sheet, and no
 * longer reachable under the identity it was saved with. High Wycombe is the
 * measured case — the portal holds `library:Library` and `museum:Museum`, the
 * fallback names `classify()` gave two unnamed POIs on 2026-08-31, and the town
 * now has five named libraries and three named museums and neither of those
 * keys. Until this rule existed the comparison read them as ADDED, the worklist
 * raised them as a debt, and the only way to clear the row was `--apply`, which
 * would have written two keys matching nothing — the exact unknownTierKeys state
 * three paragraphs up. So an ORPHANED key is named, counted, told which
 * candidates of its category the town DOES have, and never written.
 *
 * THE NARROWING IS ONLY AS GOOD AS THE CANDIDATE LIST, and it FAILS OPEN. When
 * a tree has neither ci-reference nor an S2 run — a fresh clone, a worktree —
 * `townCandidateKeys()` returns null, nothing is called orphaned, and the debt
 * is raised exactly as it was before. A false debt is a row somebody reads; a
 * false clear is a customer's answer quietly written off.
 *
 * Zero dependencies (Node core + poi_select.js, for the candidate list the
 * orphan rule needs), like the rest of assets/. Exported as a
 * module for bus-work's worklist; `require.main === module` guards the CLI, so
 * requiring it draws nothing and fetches nothing (the dark-file rule, OA-224
 * Tier 4.1). Not in the engine-hash closure: no generator requires it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, die, readJson, resolveBuses, resolvePortal, resolveBy } = require('./cli.js');
const { selectPois, mergePoiOverlay, OPT_IN_CATS, CAT_SWITCH, categoryOn } = require('./poi_select.js');

const STAGE_JS = path.join(__dirname, 'stage.js');

/** One shape for a tier rule: {tier, as|null}. routes.json allows a bare string. */
function normRule(v) {
  if (typeof v === 'string') return { tier: v, as: null };
  if (v && typeof v === 'object') return { tier: v.tier || 'may', as: v.as || null };
  return { tier: 'may', as: null };
}
function normTiers(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = normRule(v);
  return out;
}
/** Back to routes.json's own spelling: a bare string unless there is an `as`. */
function denormRule(r) {
  return r.as ? { tier: r.tier, as: r.as } : r.tier;
}
const sameRule = (a, b) => a.tier === b.tier && (a.as || null) === (b.as || null);

/**
 * The portal's word on ONE key, read against the source's. The tier is the
 * portal's; the rename is the portal's only when it HAS one. Found on the first
 * real run (2026-09-05): High Wycombe's source carries `as: "Bellfield House
 * Community Centre"`, set here before the chooser existed to correct an
 * OpenStreetMap spelling, and the portal's overrides hold that key as a bare
 * `may` — nobody typed a rename there because the delivered pack never showed
 * one. "Portal wins" would have dropped the correction silently, which is the
 * exact trap OA-233 warned about in the tier dimension, arriving in the `as`
 * dimension instead. An absent `as` in the portal is no opinion, not a removal;
 * a customer who wants a rename gone can only do that from the chooser once the
 * pack carries it, and then the portal WILL have an opinion.
 */
function resolveRule(src, por) {
  return { tier: por.tier, as: por.as || (src && src.as) || null };
}

/** `<category>:<name>` — the category is everything before the FIRST colon. */
const catOf = (key) => String(key).slice(0, String(key).indexOf(':'));

/**
 * The POI data on disk for one map, preferring ci-reference for the reason
 * poi_worksheet.js states: it is the tracked mirror of the latest S4, so it is
 * the data that DREW the sheet now published, and the S2/S4 run folders are
 * gitignored. The S2 fallback is for a town mid-build. Null when neither is here
 * — which every caller must read as "cannot narrow", never as "nothing found".
 */
function poiInputs(mapDir) {
  const ci = path.join(mapDir, 'ci-reference');
  if (fs.existsSync(path.join(ci, 'osm.json'))) return { dir: ci, source: 'ci-reference' };
  const s2 = path.join(mapDir, 'S2-geometry');
  if (fs.existsSync(s2)) {
    const runs = fs.readdirSync(s2).filter((d) => fs.existsSync(path.join(s2, d, 'osm.json'))).sort();
    if (runs.length) return { dir: path.join(s2, runs[runs.length - 1]), source: 'S2-geometry/' + runs[runs.length - 1] };
  }
  return null;
}

/**
 * Every `<cat>:<name>` identity this map could offer a chooser today, or null if
 * the data to answer that is not in this tree.
 *
 * It runs the engine's OWN poi_select.js over data already on disk — the same
 * chain, the same de-duplication, the same tidy rules that produced the keys the
 * pack was built from — so there is no second code path to drift. Nothing is
 * drawn, no generator runs and no stage folder is touched; `report.candidates`
 * is filled whether or not the town has classified anything, and it is read
 * BEFORE `as` renaming, which is the identity a tier key is written against.
 */
function townCandidateKeys(mapDir, include) {
  const inp = poiInputs(mapDir);
  if (!inp) return null;
  const sets = ['osm.json', 'osm2.json']
    .map((f) => path.join(inp.dir, f)).filter(fs.existsSync)
    .map((f) => { try { return readJson(f).elements; } catch { return null; } }).filter(Boolean);
  if (!sets.length) return null;
  const cfgPath = fs.existsSync(path.join(inp.dir, 'routes.json'))
    ? path.join(inp.dir, 'routes.json') : path.join(mapDir, 'ci-reference', 'routes.json');
  let cfg; try { cfg = readJson(cfgPath); } catch { return null; }
  // `include`, when given, is the poi.include the answer would leave the town
  // with (OA-439). A customer who switched pubs on and then tiered a pub has a
  // pub key the on-disk include cannot see, and without this it would read as
  // ORPHANED — a customer's answer quietly written off, the failure the fail-open
  // rule above exists to avoid.
  const poi = Array.isArray(include) ? { ...(cfg.poi || {}), include } : (cfg.poi || {});
  const report = {};
  try { selectPois(sets, poi, report); } catch { return null; }
  if (!Array.isArray(report.candidates)) return null;
  // A candidate that carries an element id can also be answered by `osm:<type>/<id>`
  // (OA-250: the chooser writes it where `<cat>:<name>` is shared), so that key
  // is one the town holds too; without it the portal's answer for one of a
  // same-name pair read as ORPHANED and was never written to the source.
  return report.candidates.flatMap((c) => (c.osm ? [c.key, 'osm:' + c.osm] : [c.key]));
}

/**
 * The two reasons a stored key can reach no POI, split, in one place so that
 * every caller applies both.
 *
 *   culled    the key can change nothing (OA-517): its category is one the
 *             CUSTOMER switched off (`poiCfg.customerSwitch`, which beats every
 *             tier), or it is a `miss` for a place this town leaves out anyway —
 *             a switchable category off here by poi.exclude or the engine
 *             default, or an `industrial:*` under industrialKeep "none". A
 *             `must` or `may` in a category that is off only by OUR config is
 *             reachable, because a tier beats it. Add a rule here when
 *             poi_select.js grows another reason, and add its case to
 *             test/poi_tiers_sync.test.js in the same commit.
 *   orphaned  the town has no candidate of that identity any more, because the
 *             POI it named has since been named, renamed or lost (OA-354). Each
 *             carries `have`: the candidate keys of its own category the town
 *             DOES hold, which is the whole of what a person needs to decide
 *             whether it was re-keyed by hand or genuinely went.
 *
 * `candidates` null means the candidate list could not be read, and then nothing
 * is orphaned — the narrowing must never be able to blind the check to a real
 * debt just because a tree has no geometry in it.
 */
function unreachableReasons(tiers, poiCfg, candidates) {
  const keys = Object.keys(tiers || {});
  const P = poiCfg || {};
  const cs = P.customerSwitch && typeof P.customerSwitch === 'object' ? P.customerSwitch : {};
  const culled = keys.filter((k) => {
    const cat = catOf(k), sw = CAT_SWITCH[cat];
    if (sw && cs[sw] === false) return true;               // level 1: nothing brings it back
    if (normRule(tiers[k]).tier !== 'miss') return false;  // level 2 beats our switch
    return (!!sw && !categoryOn(P, sw)) || (cat === 'industrial' && P.industrialKeep === 'none');
  });
  if (!candidates) return { culled, orphaned: [] };
  const have = new Set(candidates);
  const skip = new Set(culled);
  const byCat = new Map();
  for (const k of candidates) {
    const c = catOf(k);
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(k);
  }
  const orphaned = keys.filter((k) => !skip.has(k) && !have.has(k))
    .map((k) => ({ key: k, cat: catOf(k), have: byCat.get(catOf(k)) || [] }));
  return { culled, orphaned };
}

/** Both reasons as one list: every stored key that would reach nothing. */
function unreachableKeys(tiers, poiCfg, candidates) {
  const r = unreachableReasons(tiers, poiCfg, candidates);
  return [...r.culled, ...r.orphaned.map((o) => o.key)];
}

/**
 * Compare a town's source tiers against the portal's answer.
 *   added       portal keys the source lacks (and can reach)
 *   changed     keys in both with a different tier or `as` — {key, from, to}
 *   same        keys in both, agreeing
 *   sourceOnly  source keys the portal never named — kept
 *   unreachable portal keys the selector would drop before tiers — not written
 *   orphaned    portal keys naming a POI this town no longer has under that
 *               identity — {key, cat, have} — not written and NOT a debt
 *   narrowed    whether the candidate list was available to tell the last two
 *               apart; false means `added` may still hold a stale identity
 * `owed` is the one-word verdict a worklist wants: true when added or changed
 * is non-empty. Neither unreachable nor orphaned counts towards it, for the same
 * reason: a row that can only be cleared by making the data worse is a row
 * nothing can ever clear.
 */
function compareTiers(sourceTiers, portalTiers, poiCfg, candidates) {
  const src = normTiers(sourceTiers), por = normTiers(portalTiers);
  const reasons = unreachableReasons(por, poiCfg, candidates);
  const unreachable = new Set(reasons.culled);
  const orphaned = new Set(reasons.orphaned.map((o) => o.key));
  const added = [], changed = [], same = [];
  for (const [k, r0] of Object.entries(por)) {
    if (unreachable.has(k) || orphaned.has(k)) continue;
    if (!(k in src)) { added.push(k); continue; }
    const r = resolveRule(src[k], r0);
    if (sameRule(src[k], r)) same.push(k);
    else changed.push({ key: k, from: src[k], to: r });
  }
  const sourceOnly = Object.keys(src).filter((k) => !(k in por));
  return {
    added, changed, same, sourceOnly,
    unreachable: [...unreachable], orphaned: reasons.orphaned, narrowed: !!candidates,
    owed: added.length + changed.length > 0,
  };
}

/** The merged tiers block in routes.json's own spelling. Portal wins on conflict. */
function mergeTiers(sourceTiers, portalTiers, poiCfg, candidates) {
  const src = normTiers(sourceTiers), por = normTiers(portalTiers);
  const skip = new Set(unreachableKeys(por, poiCfg, candidates));
  const merged = {};
  for (const [k, r] of Object.entries(src)) merged[k] = r;
  for (const [k, r] of Object.entries(por)) if (!skip.has(k)) merged[k] = resolveRule(src[k], r);
  const out = {};
  for (const k of Object.keys(merged).sort()) out[k] = denormRule(merged[k]);
  return out;
}

/**
 * THE CATEGORY SWITCH (OA-439). The second half of a landmark answer: the
 * Landmarks page's checkbox per opt-in category, saved as `internal.poiInclude`
 * ({pubs: true, allotments: false}) and returned by /poi-tiers as `include`.
 *
 * The merge is poi_select.js's own mergePoiOverlay(), the function the generator
 * lays the switch over routes.json with — so what this writes into S3 is exactly
 * what the portal's render already drew, and there is no second copy of the rule
 * to drift. `true` adds a category, `false` removes it, anything else is no
 * opinion. An empty or absent switch is owed nothing and changes nothing.
 *
 *   from  the source's poi.include (an array, [] when it has none)
 *   to    what it would be with the switch laid over it
 *   excludeFrom / excludeTo  the same for poi.exclude, which is where a
 *         DEFAULT-ON category switched off is recorded (buses-data OA-500)
 *   on    categories the switch turns on;  off  categories it turns off —
 *         read through categoryOn(), so a pub switched on where pubs were
 *         already on by default is owed nothing
 *   customerSwitch  the switch as the customer gave it, owed or not — the
 *         caller hands it to compareTiers() so a tier in a category the
 *         customer switched off is culled (OA-517: their switch beats every
 *         tier, and once it is folded into poi.exclude it no longer would)
 *   owed  on or off is non-empty
 */
function compareInclude(sourceInclude, portalSwitch, sourceExclude) {
  const from = Array.isArray(sourceInclude) ? sourceInclude.slice() : [];
  const excludeFrom = Array.isArray(sourceExclude) ? sourceExclude.slice() : [];
  const before = { include: from, exclude: excludeFrom };
  const merged = mergePoiOverlay(before, { poiInclude: portalSwitch });
  const to = Array.isArray(merged.include) ? merged.include : from;
  const excludeTo = Array.isArray(merged.exclude) ? merged.exclude : excludeFrom;
  const after = { include: to, exclude: excludeTo };
  const on = OPT_IN_CATS.filter((c) => !categoryOn(before, c) && categoryOn(after, c));
  const off = OPT_IN_CATS.filter((c) => categoryOn(before, c) && !categoryOn(after, c));
  const customerSwitch = merged.customerSwitch || {};
  return { from, to, excludeFrom, excludeTo, on, off, customerSwitch, owed: on.length + off.length > 0 };
}

/**
 * A poi block's switches as the switch that would reproduce them — every opt-in
 * category answered, true or false. For comparing two SOURCES (S3 against the
 * S4 that drew it), where one side is arrays rather than a customer's switch.
 */
function switchOf(include, exclude) {
  const poi = { include: Array.isArray(include) ? include : [], exclude: Array.isArray(exclude) ? exclude : [] };
  return Object.fromEntries(OPT_IN_CATS.map((c) => [c, categoryOn(poi, c)]));
}

/** The portal map that IS this town: one area map whose name equals the folder. */
function findPortalMap(maps, town) {
  const want = String(town).trim().toLowerCase();
  const hits = (maps || []).filter((m) => m.kind === 'area' && String(m.name || '').trim().toLowerCase() === want);
  return { map: hits.length === 1 ? hits[0] : null, hits };
}

// ---- portal access ----------------------------------------------------------
/** BUSMAPS_URL / BUSMAPS_TOKEN from the environment, else from the portal's .env. */
function portalCredentials(args, portalDir) {
  let url = (args.url && args.url !== true ? args.url : '') || process.env.BUSMAPS_URL || '';
  let token = (args.token && args.token !== true ? args.token : '') || process.env.BUSMAPS_TOKEN || '';
  if ((!url || !token) && portalDir) {
    const envFile = path.join(portalDir, '.env');
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = /^\s*(BUSMAPS_URL|BUSMAPS_TOKEN)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        const v = m[2].replace(/^["']|["']$/g, '');
        if (m[1] === 'BUSMAPS_URL' && !url) url = v;
        if (m[1] === 'BUSMAPS_TOKEN' && !token) token = v;
      }
    }
  }
  return { url: String(url).replace(/\/+$/, ''), token };
}
async function portalGet(url, token, p) {
  const res = await fetch(`${url}${p}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) throw new Error(`${p} -> ${res.status}: is OPERATOR_TOKEN set on that host, does it match BUSMAPS_TOKEN, and is the deployed build newer than OA-233 (2026-09-05)?`);
  if (res.status === 404 && p.endsWith('/poi-tiers')) throw new Error(`${p} -> 404: this portal predates GET /api/maps/:id/poi-tiers (OA-233) — deploy it first`);
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
}
/** {block, map} for a town, over the API. */
async function fetchPortalBlock({ url, token, town, mapId }) {
  let map;
  if (mapId) map = { id: Number(mapId), name: town, kind: 'area' };
  else {
    const list = await portalGet(url, token, '/api/maps');
    const { map: m, hits } = findPortalMap(list.maps, town);
    if (!m) throw new Error(hits.length ? `${hits.length} area maps are named "${town}" — pass --map-id` : `no area map on ${url} is named "${town}" (the match is on the map's name, case-insensitively)`);
    map = m;
  }
  const block = await portalGet(url, token, `/api/maps/${map.id}/poi-tiers`);
  return { block, map: block.map || map };
}

// ---- the town's source -----------------------------------------------------
function loadTown(buses, town) {
  const dir = path.join(buses, 'Areas', town);
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) die(`No Areas/${town}/manifest.json under ${buses}`);
  const manifest = readJson(mf);
  const s3 = manifest.stages && manifest.stages.S3;
  const rec = s3 && s3.latest && s3.runs.find((r) => r.id === s3.latest);
  if (!rec) die(`${town} has no committed S3 run to merge into`);
  const s3Dir = path.join(dir, rec.dir);
  const routesPath = path.join(s3Dir, 'routes.json');
  const routes = readJson(routesPath);
  return { dir, manifest, rec, s3Dir, routesPath, routes };
}

/**
 * A new S3 run, cloned from the latest, with the merged routes.json. Returns its dir.
 *
 * `by` is the `--by <who>` pass-through (OA-427), already shaped by resolveBy(): the flag, else
 * the lock holder's name, and this write is refused when neither exists (OA-586). Forwarded, never
 * interpreted — stage.js is the one authority on what a name may be.
 */
function writeNewS3(townInfo, mergedRoutes, note, by = []) {
  const { dir, rec, s3Dir } = townInfo;
  const stage = (...a) => {
    const r = spawnSync(process.execPath, [STAGE_JS, ...a], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`stage.js ${a.join(' ')} failed:\n${r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  const newDir = stage('new', 'S3', ...by);
  for (const f of fs.readdirSync(s3Dir)) fs.copyFileSync(path.join(s3Dir, f), path.join(newDir, f));
  fs.writeFileSync(path.join(newDir, 'routes.json'), JSON.stringify(mergedRoutes, null, 2) + '\n');
  const outputs = (rec.outputs && rec.outputs.length ? rec.outputs : ['routes.json']).join(',');
  const basedOn = rec.basedOn ? Object.entries(rec.basedOn).map(([k, v]) => `${k}=${v}`).join(';') : '';
  const a = ['commit', 'S3', newDir, '--outputs', outputs, '--note', note];
  if (basedOn) a.push('--based-on', basedOn);
  a.push(...by);
  stage(...a);
  return newDir;
}

// ---- report -----------------------------------------------------------------
const fmt = (r) => (r.as ? `${r.tier} as "${r.as}"` : r.tier);
function printReport(town, cmp, where) {
  console.log(`\n${town} — landmark answer: ${where}`);
  console.log(`  in both and agreeing: ${cmp.same.length}   source-only (kept): ${cmp.sourceOnly.length}   unreachable (not written): ${cmp.unreachable.length}`);
  if (cmp.added.length) { console.log(`  ADDED ${cmp.added.length}:`); for (const k of cmp.added) console.log(`    + ${k}`); }
  if (cmp.changed.length) { console.log(`  CHANGED ${cmp.changed.length}:`); for (const c of cmp.changed) console.log(`    ~ ${c.key}: ${fmt(c.from)} -> ${fmt(c.to)}`); }
  if (cmp.unreachable.length) console.log(`  unreachable: ${cmp.unreachable.slice(0, 6).join(', ')}${cmp.unreachable.length > 6 ? ', ...' : ''} — dropped by poi.industrialKeep "none" before tiers run, so writing them would only produce unknownTierKeys warnings`);
  if (cmp.orphaned.length) {
    console.log(`  ORPHANED ${cmp.orphaned.length} — an answer whose subject this town no longer has under that name. NOT owed, and not written:`);
    for (const o of cmp.orphaned) {
      const have = o.have.length ? o.have.join(', ') : '(none at all)';
      console.log(`    ? ${o.key}  — this town's ${o.cat}: ${have}`);
    }
    console.log('    Writing one would match no POI and land in the build\'s unknownTierKeys. Whether to re-key it, retire it,');
    console.log('    or leave it and report it is a decision about somebody else\'s saved answer — so this tool only reports it.');
  }
  if (!cmp.narrowed) console.log('  (no ci-reference or S2 geometry in this tree, so a stale identity cannot be told from a real debt — every ADDED key below is unverified)');
  const inc = cmp.include;
  if (inc && inc.owed) {
    console.log(`  CATEGORY SWITCH: poi.include [${inc.from.join(', ')}] -> [${inc.to.join(', ')}]`);
    for (const c of inc.on) console.log(`    + ${c} switched on`);
    for (const c of inc.off) console.log(`    - ${c} switched off`);
  }
  const n = cmp.added.length + cmp.changed.length;
  const owed = [n ? `${n} key(s)` : '', inc && inc.owed ? 'the category switch' : ''].filter(Boolean).join(' and ');
  console.log(owed ? `  => the source is OWED ${owed}` : '  => nothing owed — the source already carries the portal\'s answer');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.town || args.town === true) die('Usage: node poi_tiers_sync.js --town "<Town>" [--apply] [--from block.json] [--json] [--url U --token T] [--note "..."] [--by <who>]');
  const buses = resolveBuses(args);
  const portalDir = resolvePortal(args);
  const town = String(args.town);
  const info = loadTown(buses, town);
  const poiCfg = info.routes.poi || {};
  const sourceTiers = poiCfg.tiers || {};

  let portalTiers, portalSwitch, where, mapLabel = '';
  if (args.from && args.from !== true) {
    const blk = readJson(String(args.from));
    portalTiers = blk.tiers || blk;
    portalSwitch = blk.tiers ? blk.include : undefined;
    where = `from ${args.from}`;
  } else {
    const { url, token } = portalCredentials(args, portalDir);
    if (!url || !token) die('No portal named: pass --url and --token, set BUSMAPS_URL/BUSMAPS_TOKEN, or put them in the portal checkout\'s .env (--portal DIR).');
    const { block, map } = await fetchPortalBlock({ url, token, town, mapId: args['map-id'] });
    portalTiers = block.tiers || {};
    portalSwitch = block.include;
    mapLabel = `map ${map.id} (${map.slug || map.name})`;
    where = `from ${url}, ${mapLabel}, ${block.counts ? `${block.counts.answered} answered (${block.counts.saved} saved in the portal, ${block.counts.pack} in its pack)` : `${Object.keys(portalTiers).length} keys`}`;
  }

  // The switch first: the candidates a tier key is checked against are the ones
  // the town would have AFTER it, or a pub answer reads as orphaned (OA-439).
  const include = compareInclude(poiCfg.include, portalSwitch, poiCfg.exclude);
  const candidates = townCandidateKeys(info.dir, include.owed ? include.to : undefined);
  // Tiers are judged against the config AFTER the switch (OA-500), carrying the
  // switch itself as the customer gave it (OA-517), or a tier in a category they
  // switched off would be written into S3 and would beat it there.
  const cfgAfter = { ...poiCfg, ...(include.owed ? { include: include.to, exclude: include.excludeTo } : {}), customerSwitch: include.customerSwitch };
  const cmp = { ...compareTiers(sourceTiers, portalTiers, cfgAfter, candidates), include };
  cmp.owed = cmp.owed || include.owed;
  if (args.json) { console.log(JSON.stringify({ town, source: info.rec.id, where, ...cmp }, null, 2)); return; }
  printReport(town, cmp, where);

  if (!args.apply) { if (cmp.owed) console.log('\n  dry run — pass --apply to write a new S3 run carrying the merge'); return; }
  if (!cmp.owed) { console.log('\n  --apply: nothing to write'); return; }
  const poi = { ...poiCfg, tiers: mergeTiers(sourceTiers, portalTiers, cfgAfter, candidates) };
  if (include.owed) {
    poi.include = include.to;
    if (include.excludeTo.length || Array.isArray(poiCfg.exclude)) poi.exclude = include.excludeTo;
  }
  const merged = { ...info.routes, poi };
  const switched = include.owed ? `; poi.include [${include.from.join(', ')}] -> [${include.to.join(', ')}] from the category switch (OA-439)` : '';
  const note = (args.note && args.note !== true) ? String(args.note)
    : `poi.tiers merged from the portal's landmark answer (${mapLabel || where}, OA-233): ${cmp.added.length} added, ${cmp.changed.length} changed, ${cmp.sourceOnly.length} source-only kept, ${cmp.unreachable.length} unreachable and ${cmp.orphaned.length} orphaned not written${switched}. Cloned from S3 ${info.rec.id}; nothing else in routes.json changed.`;
  const newDir = writeNewS3(info, merged, note, resolveBy(args, buses, { required: true }));
  console.log(`\n  wrote and committed a new S3 run: ${newDir}`);
  console.log('  Next: a rollout dry run reads the latest S3. This run is S3 moving over an unmoved S2, which rollout.js');
  console.log('  builds as an ordinary config rollout with no flag (an S2 that HAD moved is STALE-INPUTS, with no override):');
  console.log(`    node rollout.js --town "${town}" --buses "${buses}"`);
}

module.exports = { normRule, normTiers, denormRule, unreachableKeys, unreachableReasons, poiInputs, townCandidateKeys, compareTiers, mergeTiers, compareInclude, switchOf, findPortalMap, portalCredentials, fetchPortalBlock };

if (require.main === module) {
  // exitCode rather than exit(): a hard exit under an open fetch handle trips a
  // libuv assertion on Windows ("UV_HANDLE_CLOSING") and buries the message.
  main().catch((e) => { console.error(`poi_tiers_sync: ${e.message}`); process.exitCode = 1; });
}
