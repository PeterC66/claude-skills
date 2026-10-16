/*
 * undelivered.mjs — a map rendered here since the portal last received it, as a
 * worklist row (buses-data, 2026-10-16).
 *
 * WHY THIS EXISTS. Peter asked whether the worklist flags a delivery that is ready
 * but not sent, and it did not: the portal's own queues see only what is already IN
 * the portal, and the local refresh row is cleared by `rebuiltFromScan()` the moment
 * S1 and S4 post-date the scan, whether or not the rebuild ever left this laptop. So
 * a rebuild that stopped short of `npm run deliver` silenced its own reminder.
 * Godmanchester Co-op Ermine Street v1.35 (16 Oct, held on Peter's instruction) is
 * the example he gave.
 *
 * WHAT IT COMPARES. The newest local S5 render's `at` against the portal's
 * `lastDeliveryAt` — the map's first version or its newest proposed update, the two
 * things the pipeline writes (community-bus-maps `listMaps()`). It is a comparison
 * of TIMES because nothing on the host records WHICH render a delivery came from
 * (`deliver-map.mjs` step 0b says so in terms): a delivery made after a render was
 * cut is read as carrying it, and `deliver-map.mjs` already refuses to ship an older
 * render than the newest without `--render-superseded`. Both clocks are UTC.
 *
 * WHAT IT DOES NOT DO. It raises nothing for a portal map with no local folder, for
 * a local map with no portal map (the `refresh-local` row's territory), for a map
 * never built on the portal (`lastDeliveryAt` null — the `build-` row's), or for a
 * map the live site does not list (OA-607, as the engine-rebuild rows). A portal that
 * predates the field (`undefined`, not `null`) raises NO rows and one warning,
 * because "could not ask" must never read like "asked, and nothing owed". It never
 * delivers: a delivery mails the customer, and whether a held render ships is
 * Peter's call.
 *
 * PURE: undeliveredItems() is a function of the joined pairs and two flags, which
 * is what lets prove-red-undelivered.mjs falsify each verdict with no portal.
 * Zero dependencies (Node core only), matching worklist.mjs.
 */

/** The newest S5 render as worklist.mjs's tree rows carry it: run id, UTC `at`, version, folder. */
export const s5Row = (s5) => (s5 ? { id: s5.rec.id, at: s5.rec.at, version: s5.rec.version || null, dir: s5.dir } : null);

/** '2026-10-16T08:22' (manifest) or '2026-10-16 08:22:00' (SQLite) as UTC ms; NaN if unreadable. */
export const utcMs = (s) => (typeof s === 'string' && s ? Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

const day = (s) => String(s).slice(0, 10);

/**
 * @param {object} o
 * @param {{map:{slug,name,kind,lastDeliveryAt,customerName}, local:{name,s5:{id,at,version,dir}|null,s6Stale}}[]} o.pairs
 *        portal maps joined to their local folder, already filtered to maps the live site lists
 * @param {boolean} o.remote  true when the worklist reads the live portal (deliver over SSH)
 * @param {string}  o.portalDir  the portal checkout the command runs in
 * @returns {{items:object[], warning:string|null, deliveredUpToDate:number}}
 */
export function undeliveredItems({ pairs, remote, portalDir }) {
  const withFolder = (pairs || []).filter((p) => p && p.map && p.local);
  if (withFolder.length && withFolder.every((p) => p.map.lastDeliveryAt === undefined)) {
    return { items: [], deliveredUpToDate: 0, warning: 'the portal does not report lastDeliveryAt (it predates community-bus-maps\' last-delivery field) — no "built here, never delivered" row can be raised, and none is.' };
  }
  const items = [];
  let upToDate = 0;
  const unreadable = [];
  for (const { map: m, local } of withFolder) {
    if (m.lastDeliveryAt === null || !local.s5) continue;   // never built on the portal, or nothing rendered here
    const built = utcMs(local.s5.at), sent = utcMs(m.lastDeliveryAt);
    if (Number.isNaN(built) || Number.isNaN(sent)) { unreadable.push(m.name); continue; }
    if (built <= sent) { upToDate++; continue; }
    const v = local.s5.version ? `v${local.s5.version}` : local.s5.id;
    const cmd = remote
      ? `npm run deliver -- --map ${m.slug} --kind ${m.kind} --src "${local.s5.dir}" --note "<what changed>"`
      : `node scripts/propose-update.mjs --map ${m.slug} --src "${local.s5.dir}" --note "<what changed>"`;
    items.push({
      // HYPHEN, NOT COLON — a row key is a FIELD in loop/your-move/ (see engine-rebuild-).
      key: `undelivered-${m.slug}`, rank: 5, type: 'delivery',
      title: `"${m.name}" ${v} is built here and not yet sent to the portal`,
      why: `The newest render here, ${v} (S5 ${local.s5.id}, ${local.s5.at} UTC), is newer than the portal's last delivery of this map (${m.lastDeliveryAt} UTC), so the portal and the public sheet do not have it.`
        + (local.s6Stale ? ' Its S6 verification predates its newest data, so verify before delivering.' : '')
        + ' If it is held on purpose the row stays until it is delivered or superseded: a delivery mails the customer, and the decision is Peter\'s.',
      who: m.customerName || 'unowned', ageDays: Math.max(0, Math.floor((Date.now() - built) / 86_400_000)),
      map: m.name, slug: m.slug, kind: m.kind, subject: local.name, runbook: 'R4', builtOn: day(local.s5.at), deliveredOn: day(m.lastDeliveryAt),
      do: [{ kind: 'shell', cwd: portalDir, cmd, note: '<what changed> is the one-line note the customer sees; add --no-notify to stage it without the email' }],
    });
  }
  return { items, deliveredUpToDate: upToDate, warning: unreadable.length ? `could not read a build or delivery time for ${unreadable.join(', ')} — no undelivered row raised for ${unreadable.length === 1 ? 'it' : 'them'}.` : null };
}

/**
 * The join worklist.mjs asks for: each built portal map paired with its local folder (by
 * worklist's own `localDirOf`), split by the live site's listing (OA-607) — reusing the
 * engine rows' `listing` when they read one, reading it here otherwise — then
 * undeliveredItems(). An unread listing raises every row, and says so.
 * @returns {Promise<{items:object[], warnings:string[], off:string[]}>}
 */
export async function undeliveredRows({ portalMaps, localRows, localDirOf, listing, listingLib, liveUrl, noLive, remote, portalDir }) {
  const pairs = (portalMaps || []).filter((m) => m.built)
    .map((m) => { const d = localDirOf(m); return { map: m, local: (d && localRows.find((r) => r.dir === d)) || null }; })
    .filter((p) => p.local);
  if (!pairs.length) return { items: [], warnings: [], off: [] };
  const lst = listing || await listingLib.read({ liveUrl, noLive });
  const warnings = [];
  if (lst && !lst.listed && lst !== listing) warnings.push(`portal listing not read (${lst.why}) — an undelivered row is raised for every portal map, listed or not (OA-607).`);
  const { on, off } = listingLib.split(pairs, lst, (p) => p.map.name);
  const u = undeliveredItems({ pairs: on, remote, portalDir });
  if (u.warning) warnings.push(u.warning);
  return { items: u.items, warnings, off: off.map((p) => p.map.name) };
}
