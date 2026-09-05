/*
 * landmark_answers.mjs — the two rows a town's landmark answer can owe, as a pure
 * function over things the worklist already has (buses-data OA-233, 2026-09-05).
 *
 *   1. `landmark-owed-<town>`     the portal holds an answer the town's SOURCE lacks
 *   2. `landmark-unbuilt-<town>`  the source holds an answer its latest BUILD has not drawn
 *
 * WHY TWO, and why the second exists at all. The byte gate reads a build's OWN
 * routes.json, so an answer sitting in S3 is invisible to every gate on the board:
 * High Wycombe's 145 keys were committed on 2026-09-03 and drawn on 2026-09-05, and
 * in between `status.js` said PASS, 98/98 sheet verdicts, and nothing anywhere said
 * a customer's answer was waiting. The first row is what OA-212's finder asked for;
 * the second is the one that would have raised High Wycombe.
 *
 * WHAT IT READS. Per AREA map with a town folder of the same name: the portal's
 * block (`GET /api/maps/:id/poi-tiers`, or the store's overrides.json + pack
 * routes.json when the portal is the local checkout), the town's latest S3
 * routes.json, and its latest S4 routes.json. The comparison is the engine's own
 * `compareTiers()` from make-bus-leaflet/assets/poi_tiers_sync.js — one rule,
 * shared, including the pre-tier cull that makes an `industrial:*` key under
 * industrialKeep "none" unreachable rather than owed. A second copy of that rule
 * here would be the shape *The second reader of a shape the engine already knew*.
 *
 * PURE ON PURPOSE. Everything I/O-shaped arrives as arguments — the map list, a
 * `readBlock(map)` that returns the portal's block or null, and a `readTown(dir)`
 * that returns {s3Tiers, s4Tiers, poiCfg} or null — so prove-red-landmark-answers.mjs
 * can drive every branch without a portal. The wire in worklist.mjs is short and
 * the harness asserts its SOURCE (the import, the call, the two keys) for the
 * reason *The harness that stopped at the module's edge* records.
 */

/**
 * @param {object} p
 * @param {Array<{id, name, kind, slug}>} p.maps  portal maps (any mode)
 * @param {Array<{name, dir}>} p.towns            local towns (gate_lib.findTowns shape)
 * @param {(map) => object|null} p.readBlock      the portal's poi-tiers block, or null if unreadable
 * @param {(dir) => object|null} p.readTown       {s3Tiers, s4Tiers, poiCfg, s3Id, s4Version} or null
 * @param {(src, por, poiCfg) => object} p.compareTiers  the engine's rule
 * @param {string} [p.syncCmd]                    how to run poi_tiers_sync.js, for the row
 * @returns {{ items: Array, checked: number, skipped: Array<{town, why}> }}
 */
export function landmarkAnswerItems({ maps, towns, readBlock, readTown, compareTiers, syncCmd = 'node poi_tiers_sync.js' }) {
  const items = [];
  const skipped = [];
  let checked = 0;
  const townDir = (name) => {
    const t = (towns || []).find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
    return t ? t.dir : null;
  };
  for (const m of maps || []) {
    if (m.kind !== 'area') continue;
    const dir = townDir(m.name);
    if (!dir) continue; // a portal map with no source tree here has nothing to be owed
    const town = readTown(dir);
    if (!town) { skipped.push({ town: m.name, why: 'no committed S3 to compare against' }); continue; }
    checked++;

    // 1. portal -> source
    const block = readBlock(m);
    if (block && block.tiers) {
      const c = compareTiers(town.s3Tiers || {}, block.tiers, town.poiCfg || {});
      if (c.owed) {
        const n = c.added.length + c.changed.length;
        items.push({
          key: `landmark-owed-${m.slug || m.name}`, rank: 7, type: 'landmark-answer',
          title: `${m.name}: a landmark answer in the portal is not in the town's source data (${n} key${n === 1 ? '' : 's'})`,
          why: `Someone answered on /landmarks and the answer lives only in the portal's overrides. A rebuild from source would start again from raw OpenStreetMap. ${c.added.length} added, ${c.changed.length} changed${c.unreachable.length ? `; ${c.unreachable.length} unreachable (dropped before tiers run, not counted)` : ''}.`,
          who: '—', runbook: 'landmarks', town: m.name, slug: m.slug, mapId: m.id,
          detail: [...c.added.map((k) => `+ ${k}`), ...c.changed.map((x) => `~ ${x.key}: ${x.from.tier} -> ${x.to.tier}`)].slice(0, 8).join('\n'),
          do: [
            { kind: 'shell', cwd: 'engine-assets', cmd: `${syncCmd} --town "${m.name}"` },
            { kind: 'chat', what: 'Read the ADDED / CHANGED lines. If they are the customer’s answer, re-run with --apply: it writes a NEW S3 run and the unbuilt row below takes over.' },
          ],
        });
      }
    } else if (block === null) {
      skipped.push({ town: m.name, why: 'portal block unreadable (older portal, or no credential)' });
    }

    // 2. source -> build
    if (town.s4Tiers !== undefined) {
      const c2 = compareTiers(town.s4Tiers || {}, town.s3Tiers || {}, town.poiCfg || {});
      if (c2.owed) {
        const n = c2.added.length + c2.changed.length;
        items.push({
          key: `landmark-unbuilt-${m.slug || m.name}`, rank: 7, type: 'landmark-answer',
          title: `${m.name}: the source carries a landmark answer its latest build (v${town.s4Version || '?'}) has not drawn (${n} key${n === 1 ? '' : 's'})`,
          why: 'The byte gate reads the build’s own routes.json, so an answer waiting in S3 shows on no board. This is a content change and is entitled to its own version, note and a look at the artwork — not a ride inside an engine bump.',
          who: '—', runbook: 'landmarks', town: m.name, slug: m.slug, mapId: m.id,
          detail: [...c2.added.map((k) => `+ ${k}`), ...c2.changed.map((x) => `~ ${x.key}: ${x.from.tier} -> ${x.to.tier}`)].slice(0, 8).join('\n'),
          do: [
            { kind: 'shell', cwd: 'engine-assets', cmd: `node rollout.js --town "${m.name}"` },
            { kind: 'chat', what: 'Read the label-set diff, look at the artwork where a must displaced a may, then --apply --bump major with a note that says whose answer this is.' },
          ],
        });
      }
    }
  }
  return { items, checked, skipped };
}
