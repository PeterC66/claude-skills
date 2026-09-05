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
 * EXCEPT THE KEYS THE SELECTOR DROPS BEFORE TIERS EVER RUN. applyTiers() runs
 * after selection, so a key for a POI that selection has already removed matches
 * nothing and lands in report.unknownTierKeys — the build-time signal that means
 * "the customer believes their answer was applied and no sheet changed". With
 * `poi.industrialKeep: "none"` every `industrial:*` key is in that position, and
 * High Wycombe's 26 `miss` estates are exactly why the 2026-09-03 paste wrote
 * 145 keys and not 171. Those are reported as UNREACHABLE, counted, and not
 * written; a worklist comparing the two sides must apply the same rule or it
 * will raise a row nothing can ever clear. `unreachableKeys()` is that rule, in
 * one place, so both callers share it.
 *
 * Zero dependencies (Node core only), like the rest of assets/. Exported as a
 * module for bus-work's worklist; `require.main === module` guards the CLI, so
 * requiring it draws nothing and fetches nothing (the dark-file rule, OA-224
 * Tier 4.1). Not in the engine-hash closure: no generator requires it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, die, readJson, resolveBuses, resolvePortal } = require('./cli.js');

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

/**
 * Keys the selector removes BEFORE applyTiers() sees them, given the town's
 * `poi` config. Today that is one rule: `industrial:*` under industrialKeep
 * "none". Add a rule here when poi_select.js grows another pre-tier cull, and
 * add its case to test/poi_tiers_sync.test.js in the same commit.
 */
function unreachableKeys(tiers, poiCfg) {
  const ind = poiCfg && poiCfg.industrialKeep;
  if (ind !== 'none') return [];
  return Object.keys(tiers || {}).filter((k) => k.startsWith('industrial:'));
}

/**
 * Compare a town's source tiers against the portal's answer.
 *   added       portal keys the source lacks (and can reach)
 *   changed     keys in both with a different tier or `as` — {key, from, to}
 *   same        keys in both, agreeing
 *   sourceOnly  source keys the portal never named — kept
 *   unreachable portal keys the selector would drop before tiers — not written
 * `owed` is the one-word verdict a worklist wants: true when added or changed
 * is non-empty.
 */
function compareTiers(sourceTiers, portalTiers, poiCfg) {
  const src = normTiers(sourceTiers), por = normTiers(portalTiers);
  const unreachable = new Set(unreachableKeys(por, poiCfg));
  const added = [], changed = [], same = [];
  for (const [k, r0] of Object.entries(por)) {
    if (unreachable.has(k)) continue;
    if (!(k in src)) { added.push(k); continue; }
    const r = resolveRule(src[k], r0);
    if (sameRule(src[k], r)) same.push(k);
    else changed.push({ key: k, from: src[k], to: r });
  }
  const sourceOnly = Object.keys(src).filter((k) => !(k in por));
  return { added, changed, same, sourceOnly, unreachable: [...unreachable], owed: added.length + changed.length > 0 };
}

/** The merged tiers block in routes.json's own spelling. Portal wins on conflict. */
function mergeTiers(sourceTiers, portalTiers, poiCfg) {
  const src = normTiers(sourceTiers), por = normTiers(portalTiers);
  const skip = new Set(unreachableKeys(por, poiCfg));
  const merged = {};
  for (const [k, r] of Object.entries(src)) merged[k] = r;
  for (const [k, r] of Object.entries(por)) if (!skip.has(k)) merged[k] = resolveRule(src[k], r);
  const out = {};
  for (const k of Object.keys(merged).sort()) out[k] = denormRule(merged[k]);
  return out;
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

/** A new S3 run, cloned from the latest, with the merged routes.json. Returns its dir. */
function writeNewS3(townInfo, mergedRoutes, note) {
  const { dir, rec, s3Dir } = townInfo;
  const stage = (...a) => {
    const r = spawnSync(process.execPath, [STAGE_JS, ...a], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`stage.js ${a.join(' ')} failed:\n${r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  const newDir = stage('new', 'S3');
  for (const f of fs.readdirSync(s3Dir)) fs.copyFileSync(path.join(s3Dir, f), path.join(newDir, f));
  fs.writeFileSync(path.join(newDir, 'routes.json'), JSON.stringify(mergedRoutes, null, 2) + '\n');
  const outputs = (rec.outputs && rec.outputs.length ? rec.outputs : ['routes.json']).join(',');
  const basedOn = rec.basedOn ? Object.entries(rec.basedOn).map(([k, v]) => `${k}=${v}`).join(';') : '';
  const a = ['commit', 'S3', newDir, '--outputs', outputs, '--note', note];
  if (basedOn) a.push('--based-on', basedOn);
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
  console.log(cmp.owed ? `  => the source is OWED ${cmp.added.length + cmp.changed.length} key(s)` : '  => nothing owed — the source already carries the portal\'s answer');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.town || args.town === true) die('Usage: node poi_tiers_sync.js --town "<Town>" [--apply] [--from block.json] [--json] [--url U --token T] [--note "..."]');
  const buses = resolveBuses(args);
  const portalDir = resolvePortal(args);
  const town = String(args.town);
  const info = loadTown(buses, town);
  const poiCfg = info.routes.poi || {};
  const sourceTiers = poiCfg.tiers || {};

  let portalTiers, where, mapLabel = '';
  if (args.from && args.from !== true) {
    const blk = readJson(String(args.from));
    portalTiers = blk.tiers || blk;
    where = `from ${args.from}`;
  } else {
    const { url, token } = portalCredentials(args, portalDir);
    if (!url || !token) die('No portal named: pass --url and --token, set BUSMAPS_URL/BUSMAPS_TOKEN, or put them in the portal checkout\'s .env (--portal DIR).');
    const { block, map } = await fetchPortalBlock({ url, token, town, mapId: args['map-id'] });
    portalTiers = block.tiers || {};
    mapLabel = `map ${map.id} (${map.slug || map.name})`;
    where = `from ${url}, ${mapLabel}, ${block.counts ? `${block.counts.answered} answered (${block.counts.saved} saved in the portal, ${block.counts.pack} in its pack)` : `${Object.keys(portalTiers).length} keys`}`;
  }

  const cmp = compareTiers(sourceTiers, portalTiers, poiCfg);
  if (args.json) { console.log(JSON.stringify({ town, source: info.rec.id, where, ...cmp }, null, 2)); return; }
  printReport(town, cmp, where);

  if (!args.apply) { if (cmp.owed) console.log('\n  dry run — pass --apply to write a new S3 run carrying the merge'); return; }
  if (!cmp.owed) { console.log('\n  --apply: nothing to write'); return; }
  const merged = { ...info.routes, poi: { ...poiCfg, tiers: mergeTiers(sourceTiers, portalTiers, poiCfg) } };
  const note = (args.note && args.note !== true) ? String(args.note)
    : `poi.tiers merged from the portal's landmark answer (${mapLabel || where}, OA-233): ${cmp.added.length} added, ${cmp.changed.length} changed, ${cmp.sourceOnly.length} source-only kept, ${cmp.unreachable.length} unreachable not written. Cloned from S3 ${info.rec.id}; nothing else in routes.json changed.`;
  const newDir = writeNewS3(info, merged, note);
  console.log(`\n  wrote and committed a new S3 run: ${newDir}`);
  console.log('  Next: a rollout dry run reads the latest S3 —');
  console.log(`    node rollout.js --town "${town}" --buses "${buses}"`);
}

module.exports = { normRule, normTiers, denormRule, unreachableKeys, compareTiers, mergeTiers, findPortalMap, portalCredentials, fetchPortalBlock };

if (require.main === module) {
  // exitCode rather than exit(): a hard exit under an open fetch handle trips a
  // libuv assertion on Windows ("UV_HANDLE_CLOSING") and buries the message.
  main().catch((e) => { console.error(`poi_tiers_sync: ${e.message}`); process.exitCode = 1; });
}
