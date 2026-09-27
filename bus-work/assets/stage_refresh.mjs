#!/usr/bin/env node
/*
 * stage_refresh.mjs — put a refreshed town map in front of its customer, only
 * once the month's ink review has let it through (buses-data OA-428, item 4 of R9
 * of the process review of 2026-09-17).
 *
 * WHY IT IS A SEPARATE STEP WITH A GATE. Staging a refresh is the portal's
 * `npm run deliver -- --map <slug>`, which runs `propose-update.mjs` on the host,
 * and that EMAILS THE MAP'S CUSTOMER. An email cannot be recalled, so everything
 * this tool refuses, it refuses before anything leaves the laptop:
 *
 *   - the town must be under `deliver` in `ink_review.mjs --deliverable`: its ink
 *     did not move, or Peter accepted THIS build. Waiting, held and unreadable
 *     maps are refused, each by name;
 *   - the newest S5 render in the town's manifest must BE the build the review
 *     looked at. A map rebuilt or re-rendered after the review would otherwise
 *     ship a sheet nobody compared — re-run the review and it is looked at again;
 *   - a build already staged is refused, so a second run is never a second email.
 *     The record is `staged` on the map in `_gtfs/ink-review_<scan>.json`, beside
 *     Peter's answer, and a LATER build of the same map is deliverable afresh.
 *
 * ONE EMAIL PER CUSTOMER PER SCAN (buses-data OA-152). The loop stages one town a
 * tick, and `propose-update` would email each map's customer as it went — one
 * notice per map, a tick apart. So the deliver command runs with `--no-notify`,
 * the staging is recorded as owed a digest, and when the LAST deliverable town of
 * the scan is staged this tool sends the portal's `notify-update-round.mjs` for
 * every map owed one, over ssh as the deliver command reaches the host, and
 * records `notified`. The server groups the maps by customer. A map Peter has not
 * answered does not hold the digest back; if he accepts it later it goes out in a
 * digest of its own. `--flush` sends whatever is owed now, for a person clearing
 * a hold.
 *
 * WHERE IT STOPS. At the version STAGED beside the live map, read back from the
 * portal's own worklist as waiting on its customer. Publication is the customer's
 * Accept, a third party's act, and nothing here reaches for it. A place map is
 * refused: the review reads `Areas/` only.
 *
 * DRY RUN BY DEFAULT: it prints the one command it would run. `--apply --by <who>`
 * runs it, records the staging and reads it back. A non-zero exit from the
 * deliver command records NOTHING and is a hold, never a retry — past its step 4
 * the email may already have gone, and the deliver script leaves the service
 * stopped on an import failure on purpose.
 *
 * PURE CORE, INJECTED EDGE, like `ink_review.mjs`: `planStage()` and `readBack()`
 * take their inputs as arguments and read no disk, network or clock, so
 * `prove-red-stage-refresh.mjs` can falsify every refusal.
 *
 * Run from anywhere. <scan> is a scan date such as 2026-10-01; <Town> is a folder
 * under Areas/; <slug> is the portal map's slug, which the worklist's refresh row
 * carries; <who> is the running session's name, e.g. buses-29 or sched-0015:
 *
 *   node stage_refresh.mjs --scan <scan> --town "<Town>" --map <slug>                  dry run
 *   node stage_refresh.mjs --scan <scan> --town "<Town>" --map <slug> --apply --by <who>
 *   node stage_refresh.mjs --scan <scan> --flush                                        dry run
 *   node stage_refresh.mjs --scan <scan> --flush --apply --by <who>
 *
 * The read-back needs BUSMAPS_URL and BUSMAPS_TOKEN, and the digest DEPLOY_HOST
 * and DEPLOY_APP_DIR (DEPLOY_SSH_KEY optional), all of which the portal's own .env
 * carries. Exit 0 on success, 2 on a refusal or a hold (the message names which).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses, resolvePortal, loadPortalEnv } from './engine.mjs';
import { deliverable, markStaged, markNotified, Refused } from './ink_review.mjs';

/* The portal's `deliver` npm script, run as its own command line rather than
 * through npm, because npm on Windows is a .cmd that Node will not spawn without
 * a shell. `main()` refuses if package.json no longer says exactly this. */
export const DELIVER_SCRIPT = 'node --env-file-if-exists=.env scripts/deliver-map.mjs';

const RUN_KEY = /(\d{4}-\d{2}-\d{2})_(\d{4})$/;
const runKey = (id) => { const m = String(id || '').match(RUN_KEY); return m ? `${m[1]}_${m[2]}` : ''; };

/** The newest S5 run in a manifest, by its own name rather than manifest order. */
export function newestRender(manifest) {
  const runs = ((manifest && manifest.stages && manifest.stages.S5 && manifest.stages.S5.runs) || [])
    .filter((r) => runKey(r.id)).sort((a, b) => (runKey(a.id) < runKey(b.id) ? -1 : runKey(a.id) > runKey(b.id) ? 1 : 0));
  return runs.length ? runs[runs.length - 1] : null;
}

/**
 * Is this S5 run the render of that S4 build? NOT by id: S5 names its folder by
 * its own start minute, so Ramsey's v3.6 is `_1141` in S4 and `_1142` in S5. A
 * run that declares `basedOn.S4` is taken at its word; most do not, and for those
 * the build's version, which is never reused, is the join.
 */
const versionOf = (id) => (String(id || '').match(/^v(\d+(?:\.\d+)*)_/) || [])[1] || null;
export function isRenderOf(render, s4Id) {
  if (!render || !s4Id) return false;
  if (render.basedOn && render.basedOn.S4) return render.basedOn.S4 === s4Id;
  const v = render.version || versionOf(render.id);
  return !!v && v === versionOf(s4Id);
}

/**
 * Decide whether one town may be staged, and with what. Throws Refused.
 * Returns `{ town, slug, after, srcRel, note }`; `srcRel` is relative to the map folder.
 */
export function planStage({ review, town, slug, manifest }) {
  if (!review || !Array.isArray(review.maps)) throw new Refused('there is no ink review for this scan, so nothing is deliverable — run ink_review.mjs --scan first.');
  if (!slug || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Refused(`--map must be the portal map's slug, as the worklist's refresh row carries it, not ${JSON.stringify(slug)}.`);
  const m = review.maps.find((x) => x.map.toLowerCase() === String(town || '').toLowerCase());
  if (!m) throw new Refused(`${town} is not in the ${review.scan} review; it holds ${review.maps.map((x) => x.map).join(', ') || 'nothing'}.`);
  const d = deliverable(review);
  if (d.staged.includes(m.map)) throw new Refused(`${m.map} ${m.after} was already staged by ${m.staged.by} at ${m.staged.at}, and its customer was emailed then — staging it again would email them twice.`);
  if (!d.deliver.includes(m.map)) {
    const why = d.waiting.includes(m.map) ? 'its ink moved and Peter has not accepted this build'
      : d.held.includes(m.map) ? `Peter held it${m.answer && m.answer.note ? ` (${m.answer.note})` : ''}`
        : `the review could not read it (${m.status}${m.detail ? `: ${m.detail}` : ''})`;
    throw new Refused(`${m.map} is not deliverable: ${why}.`);
  }
  const render = newestRender(manifest);
  if (!render) throw new Refused(`${m.map} has no S5 render in its manifest, so there is nothing to stage.`);
  if (!isRenderOf(render, m.after)) throw new Refused(`${m.map}'s newest render is ${render.id} and the review looked at ${m.after}, so the sheet that would be staged is not the one that was compared — re-run ink_review.mjs --scan ${review.scan}.`);
  return { town: m.map, slug, after: m.after, srcRel: render.dir, note: `BODS ${review.scan} refresh` };
}

/**
 * Is the staged update visible in the portal as waiting on its customer?
 * `maps` is GET /api/maps's `maps`; `items` is GET /api/admin/worklist's items.
 * The portal's awaiting-customer row names the map only in its title, in quotes.
 */
export function readBack({ maps, items, slug }) {
  const map = (maps || []).find((x) => x.slug === slug);
  if (!map) return { ok: false, why: `the portal has no map with slug ${slug}` };
  const item = (items || []).find((i) => i.type === 'awaiting-customer' && String(i.title || '').includes(`"${map.name}"`));
  return item ? { ok: true, name: map.name, key: item.key } : { ok: false, name: map.name, why: `the portal lists no update to "${map.name}" waiting on its customer` };
}

/**
 * Is the scan's digest due, and for which maps? (buses-data OA-152.) A map is OWED
 * the email when its current build was staged by this tool with `notify: 'digest'`
 * and no `notified` is recorded. Stagings made before the digest existed carry no
 * `notify` and were emailed one by one then, so they are never owed. The digest
 * waits while any map is still under `deliver` — the next tick stages it — and
 * does NOT wait for a map Peter has not answered: an answer may never come, and
 * a map he accepts later goes out in a later digest of its own. `force` is a
 * person's `--flush`, which sends whatever is owed now.
 */
export function planFlush(review, { force = false } = {}) {
  if (!review || !Array.isArray(review.maps)) return { due: false, why: 'there is no ink review for this scan', towns: [], slugs: [] };
  const owed = review.maps.filter((m) => m.staged && m.staged.after === m.after && m.staged.notify === 'digest' && !m.staged.notified);
  const towns = owed.map((m) => m.map), slugs = owed.map((m) => m.staged.slug);
  if (!owed.length) return { due: false, why: 'nothing staged in this scan is owed an email', towns, slugs };
  const left = deliverable(review).deliver;
  if (left.length && !force) return { due: false, why: `${left.join(', ')} still to be staged, and the digest goes when the last of them is`, towns, slugs };
  return { due: true, towns, slugs };
}

/** The remote command that sends the digest: the portal's own caller, inside its container. */
export const flushRemote = (slugs) => `docker compose exec -T portal node scripts/notify-update-round.mjs --map ${slugs.join(',')}`;

/**
 * The ssh argv for it, from the portal's .env as `deliver-map.mjs` reads it, with
 * BatchMode as that script uses: an unattended tick must fail, not wait on a prompt.
 */
export function flushArgs({ host, key, appDir, slugs }) {
  if (!host || !appDir) throw new Refused('DEPLOY_HOST and DEPLOY_APP_DIR are not both set in the portal\'s .env, so the digest cannot be sent.');
  if (!slugs.length || slugs.some((s) => !/^[a-z0-9][a-z0-9-]*$/.test(s))) throw new Refused(`the digest's map slugs are not all slugs: ${JSON.stringify(slugs)}.`);
  return [...(key ? ['-i', key] : []), '-o', 'BatchMode=yes', host, `cd ${appDir} && ${flushRemote(slugs)}`];
}

/* ------------------------------------------------------------------ the edge */

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

async function fetchReadBack(slug) {
  const base = (process.env.BUSMAPS_URL || '').replace(/\/$/, ''), token = process.env.BUSMAPS_TOKEN || '';
  if (!base || !token) return { ok: false, why: 'BUSMAPS_URL and BUSMAPS_TOKEN are not both set, so the staging could not be read back' };
  const get = async (p) => {
    const res = await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${p} -> ${res.status}`);
    return res.json();
  };
  try {
    const [maps, wl] = await Promise.all([get('/api/maps'), get('/api/admin/worklist')]);
    return readBack({ maps: maps.maps, items: wl.worklist && wl.worklist.items, slug });
  } catch (e) { return { ok: false, why: `the portal could not be read (${e.message})` }; }
}

/* Send the digest if it is due, and record it. A non-zero exit is a HOLD, never a
 * retry: notify-update-round refuses the whole round before sending, but a failure
 * after that is indistinguishable from one before it at this end. */
function flush({ file, review, portal, by, force }) {
  const f = planFlush(review, { force });
  if (!f.due) { console.log(`stage_refresh: no digest yet — ${f.why}.`); return; }
  const hand = `npm --prefix "${portal.replace(/\\/g, '/')}" run ssh -- "${flushRemote(f.slugs)}"`;
  console.log(`stage_refresh: the digest is due for ${f.towns.join(', ')}. The command, as a person would run it:`);
  console.log(`  ${hand}`);
  if (!by) { console.log('  dry run: nobody was emailed. Add --apply --by <who> to send it.'); return; }
  const argv = flushArgs({ host: process.env.DEPLOY_HOST, key: process.env.DEPLOY_SSH_KEY, appDir: process.env.DEPLOY_APP_DIR, slugs: f.slugs });
  const res = spawnSync('ssh', argv, { stdio: 'inherit' });
  if (res.status !== 0) throw new Refused(`the digest for ${f.towns.join(', ')} exited ${res.status ?? res.error}, so no email is recorded. This is a HOLD, never a retry: those maps are staged and their customers may NOT have been told. Check /app/admin's audit trail for notify.update-ready-batch; if it is absent, a person sends it with --flush.`);
  writeFileSync(file, JSON.stringify(markNotified(review, f.towns, { by, at: new Date().toISOString() }), null, 2) + '\n');
  console.log(`stage_refresh: one digest per customer sent for ${f.towns.join(', ')}, and recorded in ${file}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portal = resolvePortal(args);
  loadPortalEnv(portal);
  const busesDir = resolveBuses(args);
  const scan = typeof args.scan === 'string' ? args.scan : null;
  const town = typeof args.town === 'string' ? args.town : null;
  const by = typeof args.by === 'string' && args.by.trim() ? args.by.trim() : null;
  if (args.flush) {
    if (!scan) throw new Refused('--flush needs --scan <date>.');
    if (args.apply && !by) throw new Refused('--by is required with --apply: an email nobody sent is not a record.');
    const file = path.join(busesDir, '_gtfs', `ink-review_${scan}.json`);
    return flush({ file, review: readJson(file), portal, by: args.apply ? by : null, force: true });
  }
  if (!scan || !town) throw new Refused('--scan <date> and --town "<Town>" are both required.');
  const file = path.join(busesDir, '_gtfs', `ink-review_${scan}.json`);
  const review = readJson(file);
  const mapDir = path.join(busesDir, 'Areas', town);
  const plan = planStage({ review, town, slug: args.map, manifest: readJson(path.join(mapDir, 'manifest.json')) });
  const src = path.join(mapDir, plan.srcRel).replace(/\\/g, '/');
  if (!existsSync(src)) throw new Refused(`${plan.town}'s render folder ${src} is in its manifest and not on disk.`);
  const pkg = readJson(path.join(portal, 'package.json'));
  if (!pkg || !pkg.scripts || pkg.scripts.deliver !== DELIVER_SCRIPT) throw new Refused(`the portal's deliver script is no longer \`${DELIVER_SCRIPT}\` (${portal}), so this tool would not be running what npm runs — update DELIVER_SCRIPT.`);
  const deliverArgs = ['--map', plan.slug, '--kind', 'area', '--src', src, '--note', plan.note, '--no-notify'];
  console.log(`stage_refresh: ${plan.town} ${plan.after} is deliverable. The command, in ${portal}:`);
  console.log(`  npm run deliver -- ${deliverArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  if (!args.apply) {
    console.log('  dry run: nothing was staged and nobody was emailed. Add --apply --by <who> to stage it.');
    const after = planFlush(markStaged(review, plan.town, { slug: plan.slug, by: 'dry-run', at: '', notify: 'digest' }));
    console.log(after.due ? `  staging it would make the digest due, for ${after.towns.join(', ')}.` : `  staging it would send no digest yet — ${after.why}.`);
    return;
  }

  if (!by) throw new Refused('--by is required with --apply: a staging nobody ran is not a record.');
  const [node, ...rest] = DELIVER_SCRIPT.split(' ');
  const res = spawnSync(node === 'node' ? process.execPath : node, [...rest, ...deliverArgs], { cwd: portal, stdio: 'inherit' });
  if (res.status !== 0) throw new Refused(`the deliver command exited ${res.status ?? res.error}, so nothing was recorded. This is a HOLD naming ${plan.town}, never a retry: the deliver script leaves the portal stopped after an import failure, and a staging may have landed that this record does not show.`);
  const staged = markStaged(review, plan.town, { slug: plan.slug, by, at: new Date().toISOString(), notify: 'digest' });
  writeFileSync(file, JSON.stringify(staged, null, 2) + '\n');
  console.log(`stage_refresh: ${plan.town} ${plan.after} staged without an email and recorded in ${file}`);
  const rb = await fetchReadBack(plan.slug);
  if (!rb.ok) throw new Refused(`staged by the deliver command's own account, and NOT read back: ${rb.why}. Its customer has NOT been emailed. Look at /app/admin → Refreshes before anything else; do not stage it again.`);
  console.log(`stage_refresh: read back — "${rb.name}" is waiting on its customer (${rb.key}). Publishing it is their Accept.`);
  flush({ file, review: staged, portal, by, force: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof Refused) { console.error(`stage_refresh: ${e.message}`); process.exit(2); }
    console.error(e); process.exit(1);
  });
}
