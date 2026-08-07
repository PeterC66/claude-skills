#!/usr/bin/env node
/*
 * worklist.mjs — ONE ranked list of everything the BusMaps.uk system is waiting
 * on, gathered from the portal and from the local map tree.
 *
 * The problem it solves: the work currently lives in five places (the admin
 * console's applications / map-requests / proposed-updates / messages tabs, the
 * review queue, the monthly upcoming-changes report on disk, and status.js's
 * engine/S6 staleness). Deciding "what should I do next?" meant visiting all of
 * them and then opening a runbook to remember the command. This prints the
 * union, ranked by who is waiting on it, with the exact next command per row.
 *
 * It is READ-ONLY. It never writes to the portal database, never touches map
 * data, and never calls the network except in --url (remote portal) mode.
 *
 * Usage:
 *   node worklist.mjs                 # ranked human list
 *   node worklist.mjs --json          # same items, machine-readable
 *   node worklist.mjs --gates         # + full byte-identical gate run (slow)
 *   node worklist.mjs --url https://busmaps.uk --cookie <cbm_session value>
 *
 * Sources, and where each flag/env comes from:
 *   --portal DIR   BUSMAPS_PORTAL   default C:\Claude\community-bus-maps
 *   --buses  DIR   BUSES_DIR        default C:\u3a St Ives\Using AI\Buses
 *   --url    URL   BUSMAPS_URL      set => talk HTTP to a remote portal instead
 *                                   of opening the local SQLite
 *   --cookie TOK   BUSMAPS_COOKIE   the cbm_session cookie value for --url mode
 *                                   (the portal has no operator API token yet —
 *                                   see the note at the bottom of this file)
 *
 * Zero dependencies (Node core only), matching stage.js / status.js convention.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// node:sqlite prints an ExperimentalWarning on import. It is the portal's own
// dependency and not this tool's business to announce, and a warning above the
// worklist reads like something is wrong. Drop just that one.
const emit = process.emit;
process.emit = function (name, data, ...rest) {
  if (name === 'warning' && data && data.name === 'ExperimentalWarning' && /SQLite/.test(data.message || '')) return false;
  return emit.apply(process, [name, data, ...rest]);
};

// ---- args + config ---------------------------------------------------------
function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    f[k] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
const AS_JSON = !!args.json;
const RUN_GATES = !!args.gates;

const PORTAL = path.resolve(args.portal || process.env.BUSMAPS_PORTAL || 'C:/Claude/community-bus-maps');

// The portal's own .env is the authority on DATA_DIR / DB_PATH / BUSES_DIR (its
// npm scripts load it with --env-file-if-exists). Read it so this tool always
// looks at the same database the server does, rather than the repo default.
// Real environment wins, so an explicit override still works.
function loadPortalEnv(dir) {
  const f = path.join(dir, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env) && v) process.env[m[1]] = v;
  }
}
loadPortalEnv(PORTAL);

const BUSES = path.resolve(args.buses || process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses');
const URL_BASE = (args.url || process.env.BUSMAPS_URL || '').replace(/\/$/, '');
const COOKIE = args.cookie || process.env.BUSMAPS_COOKIE || '';
const REMOTE = !!URL_BASE;

// The make-bus-leaflet assets dir, wherever the skills tree actually lives.
function findSkillAssets() {
  const cands = [
    process.env.BUS_SKILL_ASSETS,
    path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets'),
    'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets',
    path.join(process.env.USERPROFILE || '', '.claude', 'skills', 'make-bus-leaflet', 'assets'),
  ].filter(Boolean);
  return cands.find((c) => existsSync(path.join(c, 'gate_lib.js'))) || null;
}
const SK = findSkillAssets();

const warnings = [];
const items = [];
const add = (it) => items.push(it);

const daysSince = (v) => {
  if (!v) return null;
  // SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; ISO strings pass through.
  const t = new Date(/\d{4}-\d{2}-\d{2} /.test(v) ? `${v.replace(' ', 'T')}Z` : v).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
};
const appUrl = (p) => `${URL_BASE || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}${p}`;

// ---- portal source: local SQLite -------------------------------------------
// Import the portal's OWN db module rather than re-writing its SQL, so this
// tool cannot drift from the schema. Same thing scripts/check-upcoming-
// refreshes.mjs does. The DB is WAL, so reading while the dev server runs is
// safe — this is why the worklist has no "stop the dev server first" step.
async function fromLocalDb() {
  const dbFile = path.join(PORTAL, 'src', 'db', 'index.js');
  if (!existsSync(dbFile)) {
    warnings.push(`Portal repo not found at ${PORTAL} — portal queues skipped. Pass --portal, or --url for a remote portal.`);
    return null;
  }
  const db = await import(pathToFileURL(dbFile).href);
  return {
    publishQueue: db.listPendingPublishRequests().map((r) => ({
      id: r.id, createdAt: r.created_at, note: r.note, mapId: r.map_id, mapName: r.map_name,
      kind: r.map_kind, customerName: r.customer_name, versionKey: r.version_key, by: r.requested_by_email,
    })),
    applications: db.listApplications({ status: 'pending' }).map((a) => ({
      id: a.id, createdAt: a.created_at, org: a.org_name || a.organisation || a.name, email: a.email, type: a.org_type,
    })),
    awaitingBuild: db.listAwaitingBuild().map((m) => ({
      id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
      note: m.request_note, customerName: m.customer_name, by: m.requested_by_email, createdAt: m.created_at,
    })),
    requested: db.listMapsByStatus(['requested']).map((m) => ({
      id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
      note: m.request_note, customerName: m.customer_name, by: m.requested_by_email, createdAt: m.created_at,
    })),
    proposed: db.listPendingProposedUpdates().map((p) => ({
      id: p.id, createdAt: p.created_at, note: p.source_note, mapId: p.map_id,
      mapName: p.map_name, customerName: p.customer_name,
    })),
    refreshFlags: db.listMessages().filter((m) => m.kind === 'refresh-flag')
      .map((m) => ({ id: m.id, mapId: m.map_id, body: m.body, createdAt: m.created_at })),
    maps: db.listMaps().map((m) => ({
      id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
      status: m.status, built: !!m.cur_key, customerName: m.customer_name,
    })),
  };
}

// ---- portal source: remote HTTP --------------------------------------------
async function fromRemote() {
  if (!COOKIE) {
    warnings.push('--url given but no --cookie / BUSMAPS_COOKIE — cannot authenticate to the remote portal.');
    return null;
  }
  const get = async (p) => {
    const res = await fetch(`${URL_BASE}${p}`, { headers: { cookie: `cbm_session=${COOKIE}` } });
    if (res.status === 401 || res.status === 403) throw new Error(`${p} -> ${res.status} (session cookie expired or not an admin?)`);
    if (!res.ok) throw new Error(`${p} -> ${res.status}`);
    return res.json();
  };
  try {
    const [review, apps, reqs, prop, msgs, maps] = await Promise.all([
      get('/api/review/queue'), get('/api/admin/applications?status=pending'),
      get('/api/admin/map-requests'), get('/api/admin/proposed-updates'),
      get('/api/admin/messages'), get('/api/maps'),
    ]);
    const shapeReq = (m) => ({
      id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
      note: m.requestNote, customerName: m.customer && m.customer.name, by: m.requestedBy, createdAt: m.createdAt,
    });
    return {
      publishQueue: (review.requests || []).map((r) => ({
        id: r.id, createdAt: r.created_at, note: r.note, mapId: r.map_id, mapName: r.map_name,
        kind: r.map_kind, customerName: r.customer_name, versionKey: r.version_key, by: r.requested_by_email,
      })),
      applications: (apps.applications || []).map((a) => ({
        id: a.id, createdAt: a.created_at, org: a.org_name || a.organisation || a.name, email: a.email, type: a.org_type,
      })),
      awaitingBuild: (reqs.awaitingBuild || []).map(shapeReq),
      requested: (reqs.requests || []).map(shapeReq),
      proposed: (prop.updates || []).map((p) => ({
        id: p.id, createdAt: p.createdAt, note: p.sourceNote, mapId: p.map && p.map.id,
        mapName: p.map && p.map.name, customerName: p.customer,
      })),
      refreshFlags: (msgs.messages || []).filter((m) => m.kind === 'refresh-flag')
        .map((m) => ({ id: m.id, mapId: m.map_id, body: m.body, createdAt: m.created_at })),
      maps: (maps.maps || []).map((m) => ({
        id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
        status: m.status, built: !!m.currentVersion, customerName: m.customer && m.customer.name,
      })),
    };
  } catch (e) {
    warnings.push(`Remote portal unreachable (${e.message}) — portal queues skipped.`);
    return null;
  }
}

// ---- local map tree: engine / S6 staleness ---------------------------------
// The cheap signals only (a manifest read + a hash compare). The expensive
// proof — regenerate every town and diff the SVG — is status.js's job and runs
// only under --gates.
function fromMapTree() {
  if (!SK) { warnings.push('make-bus-leaflet assets not found — local staleness skipped.'); return { towns: [], places: [] }; }
  if (!existsSync(path.join(BUSES, 'Areas'))) { warnings.push(`No Areas dir under ${BUSES} — local staleness skipped.`); return { towns: [], places: [] }; }
  const { findTowns, findPlaces, readJson, latestRunDir } = require(path.join(SK, 'gate_lib.js'));
  const { computeEngineVersion } = require(path.join(SK, 'engine_version.js'));
  const current = computeEngineVersion();

  const towns = findTowns(BUSES).map((t) => {
    const m = readJson(path.join(t.dir, 'manifest.json'));
    const s4 = latestRunDir(m, t.dir, 'S4');
    const row = { name: t.name, dir: t.dir, version: s4 ? s4.rec.version : null, built: !!s4 };
    if (s4) {
      let routes = {};
      try { routes = readJson(path.join(s4.dir, 'routes.json')); } catch { /* older build */ }
      row.engine = routes.engine || null;
      row.engineStale = routes.engine !== current;
    }
    const s6 = latestRunDir(m, t.dir, 'S6');
    const dataRuns = ['S1', 'S2', 'S3']
      .map((k) => m.stages && m.stages[k] && m.stages[k].runs.find((r) => r.id === m.stages[k].latest))
      .filter(Boolean);
    const newestData = dataRuns.reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);
    row.s6 = s6 ? s6.rec.id : null;
    row.s6Stale = s6 ? !!(newestData && s6.rec.at < newestData) : true;
    row.s6Age = s6 ? daysSince(s6.rec.at) : null;
    return row;
  });
  const places = findPlaces(findTowns(BUSES)).map((p) => {
    const m = readJson(path.join(p.dir, 'manifest.json'));
    const s4 = latestRunDir(m, p.dir, 'S4');
    return { name: p.name, town: p.town, dir: p.dir, built: !!s4, version: s4 ? s4.rec.version : null };
  });
  return { towns, places, currentEngine: current };
}

// ---- local map tree: upcoming BODS changes ---------------------------------
// Same report and same town->map matching rule as the portal's own
// scripts/check-upcoming-refreshes.mjs, so the two never disagree about which
// map a town section belongs to.
function fromUpcomingReport(portal) {
  const dir = path.join(BUSES, '_gtfs', 'upcoming');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^upcoming-report_\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  if (!files.length) return null;
  const file = path.join(dir, files[files.length - 1]);
  const date = (files[files.length - 1].match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
  const md = readFileSync(file, 'utf8');
  const sections = md.split(/^## /m).slice(1).map((part) => {
    const m = part.match(/^(.+?) — (\d+) upcoming(?:, (\d+) to verify)?\r?\n([\s\S]*)$/);
    return m ? { town: m[1].trim(), upcoming: Number(m[2]), toVerify: Number(m[3] || 0), body: m[4] } : null;
  }).filter(Boolean);
  return { file, date, ageDays: daysSince(date), sections };
}

// ---- build the ranked item list --------------------------------------------
const portal = REMOTE ? await fromRemote() : await fromLocalDb();
const tree = fromMapTree();
const upcoming = fromUpcomingReport(portal);

// 1 — a customer submitted a map for review and is blocked until you look (R3).
for (const r of (portal ? portal.publishQueue : [])) {
  add({
    key: `review-${r.id}`, rank: 1, type: 'review',
    title: `Review "${r.mapName}" ${r.versionKey || ''} for publication`.trim(),
    why: `${r.customerName || 'unowned'} submitted it${r.by ? ` (${r.by})` : ''} and cannot go public until you approve or reject it.`,
    who: r.customerName || 'unowned', ageDays: daysSince(r.createdAt),
    where: appUrl('/app/review'), runbook: 'R3',
    do: [{ kind: 'portal-ui', what: `Open the review queue, work the checklist, approve or reject.`, url: appUrl('/app/review') }],
  });
}

// 2 — an organisation applied to join and is waiting on a human (R2). These are
// one visit to one tab, so a queue of them is one item, not N: the list should
// answer "what do I do next", and "open Applications" is a single next thing.
const apps = portal ? portal.applications : [];
if (apps.length > 2) {
  add({
    key: 'applications', rank: 2, type: 'application',
    title: `Decide ${apps.length} organisation applications`,
    why: `Waiting: ${apps.map((a) => a.org || a.email).join(', ')}. Approving creates the customer, its first editor and an invite.`,
    who: `${apps.length} organisations`, ageDays: Math.max(...apps.map((a) => daysSince(a.createdAt) ?? 0)),
    where: appUrl('/app/admin'), runbook: 'R2',
    do: [{ kind: 'portal-ui', what: 'Vet each against Pol1, then Approve or Reject on the Applications tab.', url: appUrl('/app/admin') }],
  });
} else for (const a of apps) {
  add({
    key: `application-${a.id}`, rank: 2, type: 'application',
    title: `Decide the application from ${a.org || a.email}`,
    why: `They applied${a.type ? ` as ${a.type}` : ''} and are waiting. Approving creates the customer, its first editor and an invite.`,
    who: a.org || a.email, ageDays: daysSince(a.createdAt),
    where: appUrl('/app/admin'), runbook: 'R2',
    do: [{ kind: 'portal-ui', what: 'Vet against Pol1, then Approve or Reject on the Applications tab.', url: appUrl('/app/admin') }],
  });
}

// 3 — a customer asked for a map; approval is the gate before any build.
for (const m of (portal ? portal.requested : [])) {
  add({
    key: `request-${m.id}`, rank: 3, type: 'request-decision',
    title: `Approve or reject the map request "${m.name}" (${m.kind})`,
    why: `${m.customerName || 'unowned'} requested it${m.by ? ` (${m.by})` : ''}. Nothing can be built until it is approved — approval is the quota gate.`,
    who: m.customerName || 'unowned', ageDays: daysSince(m.createdAt), note: m.note,
    where: appUrl('/app/admin'), runbook: 'R1',
    do: [{ kind: 'portal-ui', what: 'Admin → Map requests → Approve (or Reject).', url: appUrl('/app/admin') }],
  });
}

// 4 — approved and waiting for you to actually make the map (R1).
for (const m of (portal ? portal.awaitingBuild : [])) {
  const skill = m.kind === 'place' ? 'make-place-bus-leaflet' : 'make-bus-leaflet';
  add({
    key: `build-${m.id}`, rank: 4, type: 'build',
    title: `Build the ${m.kind} map "${m.name}"${m.subject && m.subject !== m.name ? ` (${m.subject})` : ''}`,
    why: `Approved for ${m.customerName || 'unowned'}${m.by ? ` (${m.by})` : ''} and awaiting a build. The request row becomes the map — one row, quota counted once.`,
    who: m.customerName || 'unowned', ageDays: daysSince(m.createdAt), note: m.note,
    where: appUrl('/app/admin'), runbook: 'R1', skill, subject: m.subject || m.name, kind: m.kind,
    do: [
      { kind: 'skill', what: `Run the ${skill} skill for "${m.subject || m.name}" through S1–S6.` },
      { kind: 'shell', cwd: PORTAL, cmd: `node scripts/import-map.mjs --request ${m.id} --src "<S5-render dir>"` },
      // PowerShell form deliberately: R1 documents the bash `VAR=x cmd` prefix,
      // which PowerShell does not support — it runs the command with the
      // variable unset, and `npm run verify` SKIPS SILENTLY without a fixture
      // dir, so the byte-identical check reports nothing and looks fine.
      { kind: 'shell', cwd: PORTAL, cmd: `$env:${m.kind === 'place' ? 'PLACE_FIXTURE_DIR' : 'FIXTURE_DIR'} = "<S5-render dir>"; npm run verify:${m.kind === 'place' ? 'place' : 'area'}`, note: 'PowerShell; must print PASS with byte counts' },
    ],
  });
}

// 5 — BODS says services change soon and a portal map is drawing the old ones (R4).
const flaggedFor = (mapId) => (portal ? portal.refreshFlags : []).some((f) => f.mapId === mapId && upcoming && f.body.includes(`report ${upcoming.date}`));
const townMaps = (town) => {
  const lower = town.toLowerCase();
  return (portal ? portal.maps : []).filter((m) => m.built && (
    m.kind === 'area' ? m.name.toLowerCase() === lower : (m.subject || '').toLowerCase().includes(lower)
  ));
};
if (upcoming) {
  for (const s of upcoming.sections) {
    const maps = townMaps(s.town);
    const localTown = tree.towns.find((t) => t.name.toLowerCase() === s.town.toLowerCase());
    for (const m of maps) {
      const skill = m.kind === 'place' ? 'make-place-bus-leaflet' : 'make-bus-leaflet';
      add({
        key: `refresh-${m.slug}`, rank: 5, type: 'refresh',
        title: `Refresh "${m.name}" — ${s.upcoming} upcoming service change${s.upcoming === 1 ? '' : 's'} in ${s.town}`,
        why: `The ${upcoming.date} BODS scan found changes this map does not draw yet.${flaggedFor(m.id) ? '' : ' (Not yet flagged in the portal — run check-upcoming to record it.)'}`,
        who: m.customerName || 'unowned', ageDays: upcoming.ageDays, note: s.body.split('\n').filter((l) => l.trim().startsWith('- ')).slice(0, 6).join('\n'),
        where: appUrl('/app/admin'), runbook: 'R4', skill, subject: s.town, kind: m.kind, slug: m.slug,
        do: [
          { kind: 'skill', what: `Re-run the ${skill} skill for ${s.town} to produce a fresh S5-render dir.` },
          { kind: 'shell', cwd: PORTAL, cmd: `node scripts/propose-update.mjs --map ${m.slug} --src "<fresh S5-render dir>" --note "BODS ${upcoming.date} refresh"` },
        ],
      });
    }
    if (!maps.length && localTown) {
      add({
        key: `refresh-local-${localTown.name}`, rank: 7, type: 'refresh-local',
        title: `Refresh the ${localTown.name} leaflet — ${s.upcoming} upcoming service change${s.upcoming === 1 ? '' : 's'}`,
        why: `${localTown.name} has a built leaflet (v${localTown.version}) but no portal map, so nothing flags it. The printed sheet is going stale.`,
        who: '—', ageDays: upcoming.ageDays, runbook: 'R4', skill: 'make-bus-leaflet', subject: localTown.name,
        do: [{ kind: 'skill', what: `Re-run make-bus-leaflet for ${localTown.name} (S1 → S5).` }],
      });
    }
  }
}

// 6 — staged for the customer; they are the blocker, but a stale one needs a nudge.
for (const p of (portal ? portal.proposed : [])) {
  const age = daysSince(p.createdAt);
  add({
    key: `proposed-${p.id}`, rank: age != null && age >= 14 ? 6 : 9, type: 'awaiting-customer',
    title: `${age != null && age >= 14 ? 'Nudge' : 'Waiting on'} ${p.customerName || 'the customer'} — proposed update to "${p.mapName}"`,
    why: age != null && age >= 14
      ? `Staged ${age} days ago and still unaccepted; their published map is going stale.`
      : 'Staged and waiting for the customer to accept or decline. No action from you unless it sits.',
    who: p.customerName || 'unowned', ageDays: age, where: appUrl('/app/admin'), runbook: 'R4',
    do: [{ kind: 'portal-ui', what: 'Admin → Proposed updates. Nudge by email if it has sat.', url: appUrl('/app/admin') }],
  });
}

// 8 — housekeeping: the engine moved on, or nobody has independently verified.
// Grouped, one item per class. Individually these are 15 near-identical rows
// that bury the four things a person is actually waiting on.
for (const t of tree.towns.filter((t) => !t.built)) {
  add({
    key: `nobuild-${t.name}`, rank: 8, type: 'housekeeping',
    title: `${t.name} has a manifest but no S4 build`,
    why: 'Started and never finished, or migrated without a build.', who: '—', runbook: 'R1',
    towns: [t.name],
    do: [{ kind: 'skill', what: `Run make-bus-leaflet for ${t.name} from whichever stage its manifest reached.` }],
  });
}
const engineStale = tree.towns.filter((t) => t.built && t.engineStale);
if (engineStale.length) {
  add({
    key: 'engine-stale', rank: 8, type: 'housekeeping',
    title: `${engineStale.length} town${engineStale.length === 1 ? ' was' : 's were'} drawn by an older engine`,
    why: `${engineStale.map((t) => `${t.name} (v${t.version}, ${t.engine || 'unstamped'})`).join(', ')} — the live template is ${tree.currentEngine}. Harmless until you want the current look; the re-render is mechanical and bumps each town a minor version.`,
    who: '—', runbook: 'engine', towns: engineStale.map((t) => t.name),
    do: [
      { kind: 'shell', cwd: SK || '', cmd: 'node rollout.js --all', note: 'dry-run — shows what would change' },
      { kind: 'shell', cwd: SK || '', cmd: 'node rollout.js --all --apply', note: 'writes; stops on a lost label' },
    ],
  });
}
const s6Stale = tree.towns.filter((t) => t.built && t.s6Stale);
if (s6Stale.length) {
  add({
    key: 's6-stale', rank: 8, type: 'housekeeping',
    title: `${s6Stale.length} town${s6Stale.length === 1 ? '' : 's'} need an independent (S6) verification pass`,
    why: s6Stale.map((t) => `${t.name} (${t.s6 ? `${t.s6Age}d old, pre-dates the current data` : 'never run'})`).join(', ')
      + '. S6 is the cross-model red-team — it is what catches a route we draw that no longer runs.',
    who: '—', runbook: 'S6', towns: s6Stale.map((t) => t.name),
    do: [{ kind: 'skill', what: `Run make-bus-leaflet stage S6 for: ${s6Stale.map((t) => t.name).join(', ')}. One town at a time — each needs a human call on its HARD findings.` }],
  });
}

// ---- optional: the expensive proof -----------------------------------------
// Runs before the sort so a failing gate can take rank 0 — nothing else on the
// list is worth doing while the engine no longer reproduces a committed map.
let gates = null;
if (RUN_GATES && SK) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(SK, 'status.js'), '--json', '--buses', BUSES, '--portal', PORTAL], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { gates = JSON.parse(r.stdout); } catch { warnings.push('status.js --gates run failed; gate columns omitted.'); }
  if (gates) {
    const bad = [
      ...gates.towns.filter((t) => t.internal === 'DIFF' || t.external === 'DIFF').map((t) => `town ${t.name}`),
      ...gates.places.filter((p) => p.internal === 'DIFF' || p.external === 'DIFF').map((p) => `place ${p.name}`),
      ...(gates.portalDrift || []).filter((d) => d.same === false).map((d) => `portal vendoring ${d.file}`),
    ];
    for (const b of bad) {
      add({ key: `gate-${b}`, rank: 0, type: 'gate', title: `Gate FAILS: ${b}`, why: 'Regenerating from the current engine does not reproduce the committed output. Investigate before shipping anything.', who: '—', runbook: 'engine', do: [{ kind: 'shell', cwd: SK, cmd: 'node status.js' }] });
    }
  }
}

items.sort((a, b) => a.rank - b.rank || (b.ageDays || 0) - (a.ageDays || 0) || a.key.localeCompare(b.key));
const limited = args.limit ? items.slice(0, Number(args.limit)) : items;

// ---- output ----------------------------------------------------------------
const meta = {
  generatedAt: new Date().toISOString(),
  portal: REMOTE ? { mode: 'remote', url: URL_BASE } : { mode: 'local', dir: PORTAL, dataDir: process.env.DATA_DIR || path.join(PORTAL, 'data') },
  buses: BUSES, engine: tree.currentEngine || null,
  upcomingReport: upcoming ? { date: upcoming.date, file: upcoming.file, towns: upcoming.sections.length } : null,
  counts: { total: items.length, byType: items.reduce((a, i) => ({ ...a, [i.type]: (a[i.type] || 0) + 1 }), {}) },
  warnings,
};

if (AS_JSON) {
  console.log(JSON.stringify({ meta, items: limited, gates }, null, 2));
  process.exit(0);
}

const BAND = { 0: 'BROKEN', 1: 'SOMEONE IS BLOCKED', 2: 'SOMEONE IS BLOCKED', 3: 'SOMEONE IS BLOCKED', 4: 'YOUR MOVE', 5: 'YOUR MOVE', 6: 'YOUR MOVE', 7: 'YOUR MOVE', 8: 'HOUSEKEEPING', 9: 'WAITING ON OTHERS' };
console.log(`\nBusMaps.uk worklist — ${meta.portal.mode} portal (${REMOTE ? URL_BASE : PORTAL})`);
console.log(`engine ${meta.engine || '?'} · ${upcoming ? `BODS scan ${upcoming.date} (${upcoming.ageDays}d old)` : 'no upcoming-changes report found'} · ${items.length} item(s)\n`);
for (const w of warnings) console.log(`  ! ${w}`);
if (warnings.length) console.log('');

let band = null, n = 0;
for (const it of limited) {
  if (BAND[it.rank] !== band) { band = BAND[it.rank]; console.log(`── ${band} ${'─'.repeat(Math.max(0, 58 - band.length))}`); }
  n++;
  const age = it.ageDays == null ? '' : `  [${it.ageDays}d]`;
  console.log(`\n${String(n).padStart(2)}. ${it.title}${age}`);
  console.log(`    ${it.why}`);
  for (const d of it.do) {
    if (d.kind === 'shell') console.log(`    $ (in ${d.cwd})\n      ${d.cmd}${d.note ? `   # ${d.note}` : ''}`);
    else if (d.kind === 'portal-ui') console.log(`    → ${d.what}  ${d.url}`);
    else console.log(`    → ${d.what}`);
  }
}
console.log(`\n${limited.length === items.length ? '' : `(${items.length - limited.length} more) `}Nothing here needs a runbook: run /bus-work and pick a number.\n`);

/*
 * REMOTE PORTAL — the honest state of it.
 *
 * Reading a remote portal works today with a session cookie (the same one your
 * browser holds after signing in as admin): the admin API is cookie-authed and
 * this tool only ever GETs. What does NOT work remotely yet is DELIVERY —
 * import-map.mjs and propose-update.mjs write straight to a local SQLite and
 * DATA_DIR, so they must run on the machine the portal runs on.
 *
 * The portal-side pieces that would close that gap (neither built yet):
 *   1. GET /api/admin/worklist — this same ranking, server-side, so the admin
 *      console's landing page and this tool show one identical list.
 *   2. POST /api/admin/ingest — accept a packed S5-render dir + an operator
 *      token (the METRICS_TOKEN pattern already in .env), run the existing
 *      import/propose logic server-side, and run the byte-identical verify
 *      before accepting. That removes the last "which machine am I on?" step.
 */
