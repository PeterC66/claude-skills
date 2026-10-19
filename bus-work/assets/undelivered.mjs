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
 * A BLOCKED S6 IS NOT OFFERED FOR DELIVERY (buses-data, 2026-10-17). Wisbech v5.0's
 * row led with `npm run deliver` while its newest S6 (2026-10-14_0701) read
 * "blocked", 7 hard. A render newer than the portal's copy is still a fact worth a
 * row, so the row stays under the same key, but it says the S6 is BLOCKED, offers no
 * delivery command, and names the open action that owns the hard findings: one whose
 * text names both the map and that S6 run id (OA-636 for Wisbech). If none does, it
 * says to file one. Only `blocked` withholds the command; an S6 that is merely stale
 * keeps the older "verify before delivering" sentence.
 *
 * THEN IT COMPARES INK, NOT TIME (buses-data, 2026-10-19). The time test alone raised
 * seven rows on 17 Oct, and several were renders whose ink was the portal's to the
 * stroke — an OA-437 adoption or a stamp-only rebuild re-cuts S5 and changes nothing a
 * reader sees. So a row the time test would raise is checked against the LIVE public
 * sheets (`/api/public/maps/<slug>`, its `outputs[].svgUrl`, no auth): each is
 * normalised — the portal's pilot wrapper (`pilot-bg`, `pilot-content`, `pilot-band`)
 * removed and the "Map version N.N" / "build N.NN · date" stamp blanked — and compared
 * with the same sheet in the newest local S5. Same on every sheet: no row, counted as
 * up to date. Different: the row, with the differing text lines in its `why`. No
 * public sheet (unlisted, unreachable, `--no-live`, no outputs): the time test stands,
 * and the row says it could not compare. Red/green, 17 Oct: Aldi, Godmanchester Co-op
 * Cambridge Road and High Wycombe Town Centre raise none; Ely Co-op (the Dial-a-Ride
 * wording) and Beaconsfield Waitrose do.
 *
 * AND A ROW SOMETHING ELSE ALREADY CARRIES IS FOLDED, NOT REPEATED. A blocked-S6 row
 * with an owning action is folded into that action (undeliveredRows' `folded`), and a
 * row whose map a loop/your-move/ hold names is folded into the hold (foldUnderHolds,
 * then worklist.mjs's foldHeldRows): the hold is already Peter's question about that
 * map, and the delivery waits on its answer.
 *
 * PURE: undeliveredItems() is a function of the joined pairs and two flags, which
 * is what lets prove-red-undelivered.mjs falsify each verdict with no portal.
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The newest S5 render as worklist.mjs's tree rows carry it: run id, UTC `at`, version, folder. */
export const s5Row = (s5) => (s5 ? { id: s5.rec.id, at: s5.rec.at, version: s5.rec.version || null, dir: s5.dir } : null);

/** The newest S6 run's verdict as its verification.json states it; verdict null when the file is missing or unreadable. */
export const s6Verdict = (s6) => {
  if (!s6) return null;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(s6.dir, 'verification.json'), 'utf8')).summary || {};
    return { id: s6.rec.id, verdict: s.verdict || null, hard: typeof s.hard === 'number' ? s.hard : null };
  } catch { return { id: s6.rec.id, verdict: null, hard: null }; }
};

/** The open actions (OA-nnn.md directly in `actionsDir`) whose text names both `name` and the S6 run `s6Id`. */
export function owningActions(actionsDir, name, s6Id) {
  let files = [];
  try { files = fs.readdirSync(actionsDir).filter((f) => /^OA-\d+\.md$/.test(f)).sort(); } catch { return []; }
  return files.filter((f) => {
    let t = '';
    try { t = fs.readFileSync(path.join(actionsDir, f), 'utf8'); } catch { return false; }
    return t.includes(name) && t.includes(s6Id);
  }).map((f) => f.replace(/\.md$/, ''));
}

/** '2026-10-16T08:22' (manifest) or '2026-10-16 08:22:00' (SQLite) as UTC ms; NaN if unreadable. */
export const utcMs = (s) => (typeof s === 'string' && s ? Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

const day = (s) => String(s).slice(0, 10);

/** The local S5 file a portal output key names: internal_geographic → internal.svg, internal_schematic → internal-schematic.svg. */
export const sheetFile = (key) => `${String(key).replace(/_geographic$/, '').replace(/_/g, '-')}.svg`;

/**
 * A sheet as ink: the portal's pilot wrapper removed, the version stamp blanked, and
 * split into one trimmed piece per tag. The wrapper is three things the portal adds
 * round the S5 sheet and nothing else (community-bus-maps' pilot overlay): a `pilot-bg`
 * rect, a `pilot-content` group holding the sheet, and a `pilot-band` group after it.
 */
export function sheetInk(svg) {
  let s = String(svg || '').replace(/\r/g, '');
  const wrapped = /<g id="pilot-content"[^>]*>/.test(s);
  s = s.replace(/<rect id="pilot-bg"[^>]*\/>/, '').replace(/<g id="pilot-band"[^>]*>[\s\S]*?<\/g>/, '').replace(/<g id="pilot-content"[^>]*>/, '');
  if (wrapped) { const i = s.lastIndexOf('</g>'); if (i >= 0) s = s.slice(0, i) + s.slice(i + 4); }   // the pilot-content group's own close
  s = s.replace(/>\s*(Map version \d+(?:\.\d+)*|build \d+(?:\.\d+)* · [^<]*?)\s*</g, '>STAMP<');
  return s.split('>').map((x) => x.trim()).filter(Boolean);
}

/** The text a sheet prints, one entry per text run, for saying WHAT differs. */
const textsOf = (ink) => ink.map((x) => x.replace(/<[^<]*$/, '').trim()).filter((t) => t && t !== 'STAMP');

/**
 * Local and live sheet compared as ink. `lines` are the text runs on one and not the
 * other ('- ' local only, '+ ' live only), at most `max`; empty with `same` false means
 * only drawing differs.
 */
export function inkDiff(local, live, max = 6) {
  const a = sheetInk(local), b = sheetInk(live);
  if (a.length === b.length && a.every((x, i) => x === b[i])) return { same: true, lines: [] };
  const count = (xs) => xs.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const ta = count(textsOf(a)), tb = count(textsOf(b));
  const lines = [];
  for (const [t, n] of ta) if (n > (tb.get(t) || 0)) lines.push(`- ${t}`);
  for (const [t, n] of tb) if (n > (ta.get(t) || 0)) lines.push(`+ ${t}`);
  return { same: false, lines: lines.slice(0, max), more: Math.max(0, lines.length - max) };
}

/**
 * Compare each public sheet of `slug` with the newest local S5 in `s5Dir`.
 * `{ compared: true, differs: [{sheet, lines, more}] }`, or `{ compared: false, why }`
 * when there is no public sheet to read. Never throws.
 */
export async function compareLive({ liveUrl, slug, s5Dir, timeoutMs = 15000, fetchFn = fetch }) {
  const base = String(liveUrl || '').replace(/\/+$/, '');
  try {
    const res = await fetchFn(`${base}/api/public/maps/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { compared: false, why: `the public map answered ${res.status}` };
    const body = await res.json();
    const outs = ((body && body.map && body.map.outputs) || []).filter((o) => o && o.svgUrl);
    if (!outs.length) return { compared: false, why: 'the public map has no SVG sheet' };
    const differs = [];
    for (const o of outs) {
      const file = sheetFile(o.key || o.base);
      let local;
      try { local = fs.readFileSync(path.join(s5Dir, file), 'utf8'); } catch { differs.push({ sheet: file, lines: [`the newest S5 has no ${file}`], more: 0 }); continue; }
      const r = await fetchFn(/^https?:/.test(o.svgUrl) ? o.svgUrl : base + o.svgUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return { compared: false, why: `${file} answered ${r.status}` };
      const d = inkDiff(local, await r.text());
      if (!d.same) differs.push({ sheet: file, lines: d.lines, more: d.more });
    }
    return { compared: true, differs };
  } catch (e) {
    return { compared: false, why: `could not read the public sheets — ${String(e.message || e).split('\n')[0]}` };
  }
}

/** One sentence naming what differs, sheet by sheet. */
const inkWhy = (differs) => differs.map((d) => `${d.sheet}: ${d.lines.length ? d.lines.map((l) => `“${l}”`).join(', ') + (d.more ? ` and ${d.more} more` : '') : 'the drawing differs, no text line does'}`).join('; ');

/**
 * Fold each undelivered row into a loop/your-move/ hold that names its map — in the
 * hold's headline as a whole phrase, or by the map's slug opening the hold's file name
 * — by marking it for worklist.mjs's foldHeldRows. Mutates `items`; returns how many.
 */
export function foldUnderHolds(items) {
  const holds = (items || []).filter((x) => x.type === 'loop-hold');
  let n = 0;
  for (const it of items || []) {
    if (!/^undelivered-/.test(it.key) || !it.map) continue;
    const esc = it.map.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i');
    const h = holds.find((x) => re.test(x.title || '') || (it.slug && String(x.ref || '').startsWith(`${it.slug}-`)));
    if (!h) continue;
    (it.onHold ||= []).push({ ref: h.ref, key: it.key });
    it.foldIntoHold = `the hold names ${it.map}, so the delivery waits on its answer`;
    n++;
  }
  return n;
}

/**
 * @param {object} o
 * @param {{map:{slug,name,kind,lastDeliveryAt,customerName}, local:{name,s5:{id,at,version,dir}|null,s6Stale,s6v:{id,verdict,hard}|null}, owners?:string[]}[]} o.pairs
 *        portal maps joined to their local folder, already filtered to maps the live site lists;
 *        `owners` is set by undeliveredRows() for a pair whose newest S6 is blocked
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
  for (const { map: m, local, owners, ink } of withFolder) {
    if (m.lastDeliveryAt === null || !local.s5) continue;   // never built on the portal, or nothing rendered here
    const built = utcMs(local.s5.at), sent = utcMs(m.lastDeliveryAt);
    if (Number.isNaN(built) || Number.isNaN(sent)) { unreadable.push(m.name); continue; }
    if (built <= sent) { upToDate++; continue; }
    if (ink && ink.compared && !ink.differs.length) { upToDate++; continue; }   // re-rendered, but the live sheets already carry this ink
    const inkSays = ink && ink.compared
      ? ` The live sheets differ from it — ${inkWhy(ink.differs)}.`
      : ` The live sheets could not be compared (${(ink && ink.why) || 'not read'}), so this rests on the times alone.`;
    const v = local.s5.version ? `v${local.s5.version}` : local.s5.id;
    const s6 = local.s6v && local.s6v.verdict === 'blocked' ? local.s6v : null;
    const own = s6 ? owners || [] : [];
    const cmd = remote
      ? `npm run deliver -- --map ${m.slug} --kind ${m.kind} --src "${local.s5.dir}" --note "<what changed>"`
      : `node scripts/propose-update.mjs --map ${m.slug} --src "${local.s5.dir}" --note "<what changed>"`;
    const hard = s6 && s6.hard !== null ? `, ${s6.hard} hard` : '';
    items.push({
      // HYPHEN, NOT COLON — a row key is a FIELD in loop/your-move/ (see engine-rebuild-).
      key: `undelivered-${m.slug}`, rank: 5, type: 'delivery',
      title: s6 ? `"${m.name}" ${v} is built here and not sent, and its newest S6 is BLOCKED${hard}` : `"${m.name}" ${v} is built here and not yet sent to the portal`,
      why: `The newest render here, ${v} (S5 ${local.s5.id}, ${local.s5.at} UTC), is newer than the portal's last delivery of this map (${m.lastDeliveryAt} UTC).${inkSays}`
        + (s6
          ? ` But its newest S6 verification, ${s6.id}, is BLOCKED${hard}, so it is not offered for delivery: `
            + (own.length ? `${own.join(', ')} ${own.length === 1 ? 'owns' : 'own'} those findings. Deliver once a newer S6 passes.` : 'no open action names that S6 run, so file one for its hard findings first.')
          : (local.s6Stale ? ' Its S6 verification predates its newest data, so verify before delivering.' : '')
            + ' If it is held on purpose the row stays until it is delivered or superseded: a delivery mails the customer, and the decision is Peter\'s.'),
      who: m.customerName || 'unowned', ageDays: Math.max(0, Math.floor((Date.now() - built) / 86_400_000)),
      map: m.name, slug: m.slug, kind: m.kind, subject: local.name, runbook: 'R4', builtOn: day(local.s5.at), deliveredOn: day(m.lastDeliveryAt),
      ...(s6 ? { s6Blocked: s6.id, owners: own } : {}),
      ...(ink && ink.compared ? { inkDiffers: ink.differs } : { inkCompared: false }),
      do: s6
        ? [{ kind: 'action', what: own.length ? `Work ${own.join(', ')} in Development Docs/open-actions/, rebuild ${m.name} and re-run S6; no delivery until it passes` : `File an open action for ${m.name}'s hard findings in S6 ${s6.id}` }]
        : [{ kind: 'shell', cwd: portalDir, cmd, note: '<what changed> is the one-line note the customer sees; add --no-notify to stage it without the email' }],
    });
  }
  return { items, deliveredUpToDate: upToDate, warning: unreadable.length ? `could not read a build or delivery time for ${unreadable.join(', ')} — no undelivered row raised for ${unreadable.length === 1 ? 'it' : 'them'}.` : null };
}

/**
 * The join worklist.mjs asks for: each built portal map paired with its local folder (by
 * worklist's own `localDirOf`), split by the live site's listing (OA-607) — reusing the
 * engine rows' `listing` when they read one, reading it here otherwise — then
 * undeliveredItems(). An unread listing raises every row, and says so. Each pair the
 * time test would raise is first compared with its live sheets (compareLive), and a
 * blocked-S6 row an open action owns is returned in `folded`, not `items`.
 * @returns {Promise<{items:object[], warnings:string[], off:string[], folded:object[]}>}
 */
export async function undeliveredRows({ portalMaps, localRows, localDirOf, listing, listingLib, liveUrl, noLive, remote, portalDir, actionsDir, compare = compareLive }) {
  const pairs = (portalMaps || []).filter((m) => m.built)
    .map((m) => { const d = localDirOf(m); return { map: m, local: (d && localRows.find((r) => r.dir === d)) || null }; })
    .filter((p) => p.local);
  if (!pairs.length) return { items: [], warnings: [], off: [], folded: [] };
  for (const p of pairs) if (p.local.s6v && p.local.s6v.verdict === 'blocked') p.owners = owningActions(actionsDir, p.local.name, p.local.s6v.id);
  const lst = listing || await listingLib.read({ liveUrl, noLive });
  const warnings = [];
  if (lst && !lst.listed && lst !== listing) warnings.push(`portal listing not read (${lst.why}) — an undelivered row is raised for every portal map, listed or not (OA-607).`);
  const { on, off } = listingLib.split(pairs, lst, (p) => p.map.name);
  for (const p of on) {
    if (!p.local.s5 || !p.map.lastDeliveryAt || !(utcMs(p.local.s5.at) > utcMs(p.map.lastDeliveryAt))) continue;   // only a row the time test would raise is worth a fetch
    p.ink = noLive ? { compared: false, why: '--no-live' } : await compare({ liveUrl, slug: p.map.slug, s5Dir: p.local.s5.dir });
  }
  const u = undeliveredItems({ pairs: on, remote, portalDir });
  if (u.warning) warnings.push(u.warning);
  const folded = [];
  const items = u.items.filter((it) => {
    if (!(it.s6Blocked && it.owners && it.owners.length)) return true;
    folded.push({ key: it.key, into: it.owners.join(', '), why: `its newest S6, ${it.s6Blocked}, is BLOCKED and ${it.owners.join(', ')} ${it.owners.length === 1 ? 'owns' : 'own'} those findings` });
    return false;
  });
  return { items, warnings, off: off.map((p) => p.map.name), folded };
}
