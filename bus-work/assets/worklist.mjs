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
 *   node worklist.mjs                 # ranked human list — LIVE portal
 *   node worklist.mjs --local         # the dev checkout instead (opt in)
 *   node worklist.mjs --json          # same items, machine-readable
 *   node worklist.mjs --gates         # + full byte-identical gate run (slow)
 *   node worklist.mjs --url https://busmaps.uk --cookie <cbm_session value>
 *
 * WHICH PORTAL — it will not guess (2026-08-31). Configure BUSMAPS_URL and
 * BUSMAPS_COOKIE (in the portal's own .env is easiest; this tool loads it) and
 * every run reads the live site. With neither set and no --local, this refuses
 * and prints the two lines to add, rather than quietly opening the dev SQLite.
 * It used to default to the dev checkout, and on 2026-08-31 a session asked for
 * "the worklist", got that checkout, and presented a demo customer's publish
 * review as the top blocked item. The banner said LOCAL — dev checkout the
 * whole time. A header you have to read is not a guard.
 *
 * DEMO ROWS are hidden unless --demo, and never share a band with real work.
 * That is the other half of the same fault: the mode was visible and the ROWS
 * were not, so seven test organisation applications sat in SOMEONE IS BLOCKED
 * and pushed the one real item — a member of the public owed a reply — to
 * fourth. Anything whose title, reason or customer carries "(demo)" is demo.
 *
 * Sources, and where each flag/env comes from:
 *   --portal DIR   BUSMAPS_PORTAL   default C:\Claude\community-bus-maps
 *   --buses  DIR   BUSES_DIR        default C:\u3a St Ives\Using AI\Buses
 *   --url    URL   BUSMAPS_URL      set => talk HTTP to a remote portal instead
 *                                   of opening the local SQLite
 *   --cookie TOK   BUSMAPS_COOKIE   the cbm_session cookie value for --url mode
 *                                   (the portal's admin API is cookie-authed;
 *                                   there is no operator token yet)
 *   --local        (none)           read the dev checkout on purpose
 *   --demo         (none)           include rows belonging to demo customers
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
// --local BEATS a configured BUSMAPS_URL, and this is not a detail. The whole
// point of putting BUSMAPS_URL in the portal's .env is that it is always set --
// so if the env still won, --local would be a flag that silently did nothing on
// exactly the machine it was written for, which is how the first version of
// this change behaved for about ten minutes. Contradicting yourself outright
// (--local AND --url) is a refusal rather than a precedence rule.
if (args.local && args.url) {
  console.error('\n  --local and --url contradict each other. Pick one.\n');
  process.exit(2);
}
const URL_BASE = args.local ? '' : (args.url || process.env.BUSMAPS_URL || '').replace(/\/$/, '');
const COOKIE = args.cookie || process.env.BUSMAPS_COOKIE || '';
const REMOTE = !!URL_BASE;
const SHOW_DEMO = !!args.demo;

// Refuse to GUESS which portal was meant. See "WHICH PORTAL" at the top of this
// file. The exit is 2 rather than 1 so a caller can tell "you did not say which
// portal" apart from "the run failed", and it prints on stderr so --json still
// yields nothing parseable on stdout instead of a plausible wrong answer.
if (!REMOTE && !args.local) {
  const envFile = path.join(PORTAL, '.env');
  console.error([
    '',
    '  Which portal? This tool will not guess.',
    '',
    '  For the LIVE site — sign in at https://busmaps.uk as an admin, copy the',
    '  cbm_session cookie value (DevTools -> Application -> Cookies), and add',
    `  two lines to ${envFile} — this tool reads it, and in the portal repo it`,
    '  is gitignored, so the cookie stays off GitHub:',
    '',
    '      BUSMAPS_URL=https://busmaps.uk',
    '      BUSMAPS_COOKIE=<the cbm_session value>',
    '',
    '  Then every run reads the live portal with no flag to remember.',
    '',
    '  For the DEV CHECKOUT, say so: node worklist.mjs --local',
    '',
  ].join('\n'));
  process.exit(2);
}

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

// ---- portal source ---------------------------------------------------------
// The portal's queues are ranked by the PORTAL, in src/worklist/index.js — this
// tool does not have its own copy of that logic. Locally it imports that module
// (and the db module it sits on) directly; remotely it GETs the endpoint the
// admin console's To-do tab uses. Either way the console and this terminal show
// the same list, because it is the same code.
//
// Reading is safe while the dev server runs (the portal DB is WAL), which is
// why the worklist has no "stop the dev server first" step.
async function fromLocalPortal() {
  const wlFile = path.join(PORTAL, 'src', 'worklist', 'index.js');
  if (!existsSync(wlFile)) {
    // Two different problems, and saying the wrong one sends you hunting in the
    // wrong place. The second is the live one until PR #5 lands on main.
    warnings.push(existsSync(path.join(PORTAL, 'src', 'db', 'index.js'))
      ? `The portal at ${PORTAL} has no src/worklist/index.js — it predates the worklist (community-bus-maps PR #5). Portal queues skipped; only local-tree items below.`
      : `Portal repo not found at ${PORTAL} — portal queues skipped. Pass --portal, or --url for a remote portal.`);
    return null;
  }
  const { buildWorklist } = await import(pathToFileURL(wlFile).href);
  const db = await import(pathToFileURL(path.join(PORTAL, 'src', 'db', 'index.js')).href);
  return {
    items: buildWorklist({ baseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000' }).items,
    // Only needed for the local-tree cross-reference below (which town has a map
    // at all); every ranked portal item already arrived above.
    maps: db.listMaps().map((m) => ({
      id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
      built: !!m.cur_key, customerName: m.customer_name,
    })),
  };
}

async function fromRemotePortal() {
  if (!COOKIE) {
    warnings.push('--url given but no --cookie / BUSMAPS_COOKIE — cannot authenticate to the remote portal.');
    return null;
  }
  const get = async (p) => {
    const res = await fetch(`${URL_BASE}${p}`, { headers: { cookie: `cbm_session=${COOKIE}` } });
    if (res.status === 401 || res.status === 403) throw new Error(`${p} -> ${res.status} (session cookie expired, or not an admin account?)`);
    if (res.status === 404 && p.startsWith('/api/admin/worklist')) throw new Error('this portal predates /api/admin/worklist — upgrade it');
    if (!res.ok) throw new Error(`${p} -> ${res.status}`);
    return res.json();
  };
  try {
    const [wl, maps] = await Promise.all([get('/api/admin/worklist'), get('/api/maps')]);
    return {
      items: (wl.worklist && wl.worklist.items) || [],
      maps: (maps.maps || []).map((m) => ({
        id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
        built: !!m.currentVersion, customerName: m.customer && m.customer.name,
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
function fromUpcomingReport() {
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

// ---- correspondence: real people waiting on us -----------------------------
//
// ADDED 2026-08-31, and the reason it was added is the whole argument for it.
// A reply to the first member of the public who ever wrote in was drafted on
// the 30th and was still sitting unsent a day later. Eighty commits landed in
// between. The BACKLOG work it raised was picked up promptly -- another session
// read the open actions, claimed one and released half of it overnight --
// because the backlog is indexed, checked in CI, and read by every session that
// starts. The one step nothing could do for him had nothing watching it.
//
// That asymmetry is the point: everything Claude can do gets picked up by the
// next session, so the ONLY step with no reminder is the human one. This source
// exists to put the human step in the same list as everything else.
//
// It reads tracked files and nothing else -- no network, no portal, no email.
function fromCorrespondence() {
  const dir = path.join(BUSES, 'Correspondence');
  if (!existsSync(dir)) return [];
  const out = [];
  let threads;
  try {
    threads = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^CORR-\d+$/.test(e.name)).map((e) => e.name).sort();
  } catch { return []; }

  for (const ref of threads) {
    const tdir = path.join(dir, ref);
    // NNN-YYYY-MM-DD-in|out-slug.md. The number orders the conversation; the
    // date is when the message happened, which is what an age must count from.
    const msgs = readdirSync(tdir)
      .map((n) => /^(\d+)-(\d{4}-\d{2}-\d{2})-(in|out)-.*\.md$/.exec(n))
      .filter(Boolean)
      .map((m) => ({ file: m[0], seq: Number(m[1]), date: m[2], dir: m[3] }))
      .sort((a, b) => a.seq - b.seq);
    if (!msgs.length) continue;

    // A label rather than a name: the thread record is written that way on
    // purpose and this tool must not be the thing that leaks one.
    let label = ref;
    const readme = path.join(tdir, 'README.md');
    if (existsSync(readme)) {
      const m = /^#\s+CORR-\d+\s+[\u2014-]\s+(.+)$/m.exec(readFileSync(readme, 'utf8'));
      if (m) label = `${ref} (${m[1].trim()})`;
    }

    const last = msgs[msgs.length - 1];
    if (last.dir === 'in') {
      out.push({
        key: `corr-owed-${ref}`, rank: 2, type: 'correspondence',
        title: `${label}: a reply is owed and not drafted`,
        why: `Their message of ${last.date} is the last thing in the thread. A real person is waiting, and nothing has been written.`,
        who: 'Claude drafts it, Peter sends it', runbook: 'correspondence',
        ageDays: daysSince(last.date),
        do: [{ kind: 'chat', what: `Open a chat and say: "triage ${ref}'s latest message and draft the reply".` }],
      });
      continue;
    }

    // An outbound message declares its own state in its header. Read it rather
    // than infer it: "drafted" and "sent" look identical from the outside.
    const head = readFileSync(path.join(tdir, last.file), 'utf8').slice(0, 4000);
    const st = /\*\*Status:\*\*\s*([^\u00b7\n*]+)/.exec(head);
    const status = st ? st[1].trim() : '';
    if (/NOT SENT|DRAFTED/i.test(status)) {
      out.push({
        key: `corr-unsent-${ref}`, rank: 3, type: 'correspondence',
        title: `${label}: reply drafted ${last.date}, NOT SENT`,
        why: 'Only you can send it — there is no reply button on the portal and Claude has no access to email. Until it goes, the person has heard nothing.',
        who: 'Peter', runbook: 'correspondence',
        ageDays: daysSince(last.date),
        do: [
          { kind: 'shell', cwd: BUSES, cmd: `node Correspondence/to-email.mjs "Correspondence/${ref}/${last.file}"`, note: 'run it AFTER any edits you make' },
          { kind: 'chat', what: 'Open the .html it writes, Ctrl+A, Ctrl+C, paste into the email. Add the salutation yourself.' },
          { kind: 'chat', what: 'Then tell Claude it has gone, so the file becomes the sent record.' },
        ],
      });
    }
  }

  // A question we asked and never got an answer to. WAITING ON OTHERS, not your
  // move -- but invisible entirely until now, and one of these is a question the
  // correspondent volunteered to go and research for us.
  const areas = path.join(BUSES, 'Areas');
  if (existsSync(areas)) {
    for (const town of readdirSync(areas, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const f = path.join(areas, town, 'local-decisions.json');
      if (!existsSync(f)) continue;
      let doc;
      try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
      const asked = (doc.decisions || []).filter((d) => d?.answer?.state === 'asked');
      if (!asked.length) continue;
      const oldest = asked.map((d) => d.raised).filter(Boolean).sort()[0];
      out.push({
        key: `corr-asked-${town}`, rank: 9, type: 'correspondence',
        title: `${town}: ${asked.length} question(s) asked locally and still unanswered`,
        why: `${asked.map((d) => d.id).join(', ')} — nothing but a person on the ground can settle these, and the map is drawn on our own judgement until one does.`,
        who: 'the local adviser', runbook: 'correspondence',
        ageDays: oldest ? daysSince(oldest) : null,
        do: [{ kind: 'chat', what: `Read Areas/${town}/local-decisions.json. Chase only if it has gone quiet — silence is not agreement, and it is not a refusal either.` }],
      });
    }
  }
  return out;
}

// ---- commitments: dated obligations with no other witness -------------------
// The one class of work no OTHER source here can see. The portal ranks what its
// own queues hold; the map tree ranks what its files say; the correspondence
// source ranks a real person waiting. A letter WE chose to write, sitting in
// Development Docs, is in none of those -- and nothing on disk changes if it is
// never sent. status.js grew a Commitments section for exactly this and fails
// the board once a date passes; this puts the same rows on the list Peter
// actually works from, because a red CI email is only a reminder if it is read.
//
// DELIBERATELY QUIET UNTIL IT MATTERS. An entry that is comfortably in the
// future is not work, and a worklist that prints everything is one nobody
// finishes. Only OVERDUE (rank 4, YOUR MOVE) and due-soon (rank 7) are emitted;
// an `ok` row prints nothing at all. Same rule the correspondence source
// follows -- it says nothing when no reply is owed.
function fromCommitments() {
  const out = [];
  const f = path.join(BUSES, 'Development Docs', 'commitments.json');
  if (!existsSync(f)) return out;
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch {
    // A file we cannot parse is a FAULT, not an empty list. Say so loudly
    // rather than falling quiet -- falling quiet is the shape this whole
    // section exists to prevent.
    out.push({
      key: 'commitments-unreadable', rank: 0, type: 'commitment',
      title: 'commitments.json will not parse',
      why: 'Nothing is watching any dated obligation while this is broken, and it will fail the board too.',
      who: 'Peter', runbook: 'commitments',
      do: [{ kind: 'chat', what: 'Open Development Docs/commitments.json and fix the JSON.' }],
    });
    return out;
  }
  if (!Array.isArray(doc.commitments)) return out;

  const today = Date.now();
  for (const c of doc.commitments) {
    const byMs = Date.parse(String(c.by) + 'T00:00:00Z');
    if (!Number.isFinite(byMs)) continue;
    const days = Math.ceil((byMs - today) / 86400000);
    const warn = Number.isFinite(+c.warnDays) ? +c.warnDays : 14;
    if (days > warn) continue;

    const overdue = days < 0;
    const steps = [{ kind: 'chat', what: `Read ${c.link || 'Development Docs/commitments.json'} and do it.` }];
    steps.push({ kind: 'chat', what: 'When it is done, DELETE its entry from Development Docs/commitments.json — the list stops being read the moment it keeps dead rows.' });
    if (!overdue) steps.push({ kind: 'chat', what: 'If the date is wrong, move it deliberately. Moving a date is a decision; letting it slide is not.' });

    out.push({
      key: `commitment-${c.id}`, rank: overdue ? 4 : 7, type: 'commitment',
      title: overdue
        ? `${c.what} — ${Math.abs(days)}d OVERDUE (was due ${c.by})`
        : `${c.what} — due ${c.by}, ${days}d left`,
      why: c.why || 'A dated commitment with no other watcher.',
      who: 'Peter', runbook: 'commitments',
      ageDays: overdue ? Math.abs(days) : null,
      do: steps,
    });
  }
  return out;
}

// ---- build the ranked item list --------------------------------------------
const portal = REMOTE ? await fromRemotePortal() : await fromLocalPortal();
const tree = fromMapTree();
const upcoming = fromUpcomingReport();
for (const it of fromCorrespondence()) add(it);
for (const it of fromCommitments()) add(it);

// Ranks 1-6 and 9 — the portal's own queues, ranked by the portal. Its shell
// steps name their working directory symbolically ("portal") because the server
// cannot know where this laptop keeps the repo; resolve it here.
for (const it of (portal ? portal.items : [])) {
  add({ ...it, do: it.do.map((d) => (d.kind === 'shell' && d.cwd === 'portal' ? { ...d, cwd: PORTAL } : d)) });
}
const haveKey = (k) => items.some((i) => i.key === k);


// 5 — BODS says services change soon and a portal map is drawing the old ones (R4).
//
// The portal raises these too, but only for towns someone has already run
// `npm run check-upcoming` for — it can only rank flags that exist. Reading the
// scan report directly is what this side adds: the changes are visible here the
// moment the report lands. Anything the portal has already flagged arrives above
// with its own item, so skip it rather than print the town twice.
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
      if (haveKey(`refresh-${m.slug}`)) continue; // the portal already flagged this one
      const skill = m.kind === 'place' ? 'make-place-bus-leaflet' : 'make-bus-leaflet';
      add({
        key: `refresh-${m.slug}`, rank: 5, type: 'refresh',
        title: `Refresh "${m.name}" — ${s.upcoming} upcoming service change${s.upcoming === 1 ? '' : 's'} in ${s.town}`,
        why: `The ${upcoming.date} BODS scan found changes this map does not draw yet. Not yet flagged in the portal — run \`npm run check-upcoming\` to record it there too.`,
        who: m.customerName || 'unowned', ageDays: upcoming.ageDays, detail: s.body.split('\n').filter((l) => l.trim().startsWith('- ')).slice(0, 6).join('\n'),
        where: appUrl('/app/admin'), runbook: 'R4', skill, subject: s.town, kind: m.kind, slug: m.slug,
        // REMOTE: the target is the live site, so deliver-map.mjs is the only
        // command that actually gets a render there (SSH-based, item 4 of the
        // fool-proofing plan, 2026-08-10) — the bare propose-update.mjs form
        // below only ever writes to a LOCAL DATA_DIR and would silently do
        // nothing useful against a live worklist. LOCAL: propose-update.mjs
        // directly is still simpler/faster for testing against local dev.
        do: REMOTE ? [
          { kind: 'skill', what: `Re-run the ${skill} skill for ${s.town} to produce a fresh S5-render dir.` },
          { kind: 'shell', cwd: PORTAL, cmd: `npm run deliver -- --map ${m.slug} --kind ${m.kind} --src "<fresh S5-render dir>" --note "BODS ${upcoming.date} refresh"` },
        ] : [
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

// (Rank 6 / 9 — proposed updates waiting on a customer — arrive from the portal
// above, along with the review, application, request and build queues.)

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

// ---- demo rows -------------------------------------------------------------
// The seed data (scripts/seed-demo.mjs) names every fake customer "... (demo)",
// and that suffix is the only thing separating a test row from a real one. It
// reaches an item three ways depending on which source built it: the portal
// writes the customer into `why` and sometimes the title, the local refresh
// rows carry it in `who`. Test all three rather than pick one.
//
// THE ROLLUP ROWS ARE THE PORTAL'S TO CLASSIFY, not this pattern's. An item
// like "Decide 8 organisation applications" covers eight underlying records
// and this tool sees only the sentence; if even one of the eight were real the
// row would have to be shown, and if none are it must not be. Only the module
// that built it can tell, so src/worklist/index.js splits that queue itself and
// sets `demo` on the item -- which survives the spread where portal items are
// added above, so this pattern never has to guess at it.
//
// That split exists because of a wrong answer given here on 2026-08-31: the
// eight pending applications on the dev checkout are seven obvious
// "Test <sector>" rows and one called "Ramsey Town Council", and the absence of
// a "(demo)" suffix on the last one was read as evidence it was real. It is
// seeded too (seed-demo.mjs), and the evidence that settles it is the ADDRESS
// -- clerk@ramsey-tc.example, on an RFC 2606 reserved TLD that can never
// receive mail. A name can look real. A reserved domain cannot be one.
const DEMO_RE = /\(demo\)/i;
for (const it of items) {
  if (DEMO_RE.test(`${it.title || ''} ${it.why || ''} ${it.who || ''}`)) it.demo = true;
}
const demoAll = items.filter((i) => i.demo);
const shown = SHOW_DEMO ? items : items.filter((i) => !i.demo);

// Demo rows sort BELOW every real row regardless of rank -- a demo publish
// review is not "someone is blocked", because nobody is.
shown.sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0)
  || a.rank - b.rank || (b.ageDays || 0) - (a.ageDays || 0) || a.key.localeCompare(b.key));
const limited = args.limit ? shown.slice(0, Number(args.limit)) : shown;

// ---- output ----------------------------------------------------------------
const meta = {
  generatedAt: new Date().toISOString(),
  portal: REMOTE ? { mode: 'remote', url: URL_BASE } : { mode: 'local', dir: PORTAL, dataDir: process.env.DATA_DIR || path.join(PORTAL, 'data') },
  buses: BUSES, engine: tree.currentEngine || null,
  upcomingReport: upcoming ? { date: upcoming.date, file: upcoming.file, towns: upcoming.sections.length } : null,
  counts: {
    total: shown.length,
    demoHidden: SHOW_DEMO ? 0 : demoAll.length,
    byType: shown.reduce((a, i) => ({ ...a, [i.type]: (a[i.type] || 0) + 1 }), {}),
  },
  warnings,
};

if (AS_JSON) {
  console.log(JSON.stringify({ meta: { ...meta, portalLabel: REMOTE ? `REMOTE — LIVE PORTAL (${URL_BASE})` : `LOCAL — dev checkout (${PORTAL})` }, items: limited, gates }, null, 2));
  process.exit(0);
}

const BAND = { 0: 'BROKEN', 1: 'SOMEONE IS BLOCKED', 2: 'SOMEONE IS BLOCKED', 3: 'SOMEONE IS BLOCKED', 4: 'YOUR MOVE', 5: 'YOUR MOVE', 6: 'YOUR MOVE', 7: 'YOUR MOVE', 8: 'HOUSEKEEPING', 9: 'WAITING ON OTHERS' };
const bandOf = (it) => (it.demo ? 'DEMO DATA — nobody is waiting on any of this' : BAND[it.rank]);

// Which portal this run actually looked at is the single easiest thing to
// misread once a real live site exists alongside the dev checkout — a bare
// mode word buried in a summary line is too easy to skim past. Bannerize it.
const modeLabel = REMOTE ? `REMOTE — LIVE PORTAL (${URL_BASE})` : `LOCAL — dev checkout (${PORTAL})`;
const bannerRule = '='.repeat(Math.max(modeLabel.length + 4, 40));
console.log(`\n${bannerRule}`);
console.log(`  ${modeLabel}`);
console.log(bannerRule);
console.log(`BusMaps.uk worklist — ${meta.portal.mode} portal`);
console.log(`engine ${meta.engine || '?'} · ${upcoming ? `BODS scan ${upcoming.date} (${upcoming.ageDays}d old)` : 'no upcoming-changes report found'} · ${shown.length} item(s)\n`);
for (const w of warnings) console.log(`  ! ${w}`);
if (warnings.length) console.log('');
if (!SHOW_DEMO && demoAll.length) console.log(`  (${demoAll.length} demo-customer row${demoAll.length === 1 ? '' : 's'} hidden — --demo to show)\n`);

let band = null, n = 0;
for (const it of limited) {
  if (bandOf(it) !== band) { band = bandOf(it); console.log(`── ${band} ${'─'.repeat(Math.max(0, 58 - band.length))}`); }
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
console.log(`\n${limited.length === shown.length ? '' : `(${shown.length - limited.length} more) `}Nothing here needs a runbook: run /bus-work and pick a number.\n`);

/*
 * REMOTE PORTAL — the honest state of it.
 *
 * READING a remote portal works today. The portal ranks its own queues in
 * src/worklist/index.js and serves them at GET /api/admin/worklist — the same
 * response its admin console's To-do tab renders — so this tool and the console
 * cannot show two different lists. Locally that module is imported directly;
 * remotely it is fetched with an admin session cookie.
 *
 * DELIVERY does not. import-map.mjs and propose-update.mjs write straight to a
 * local SQLite and DATA_DIR, so they must run on the machine the portal runs on.
 * The remaining portal-side piece is POST /api/admin/ingest: accept a packed
 * S5-render dir plus an operator token (the METRICS_TOKEN pattern already in
 * .env), run the existing import/propose logic server-side, and run the
 * byte-identical verify before accepting.
 */
