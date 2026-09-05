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
 *   node worklist.mjs --url https://busmaps.uk --token <OPERATOR_TOKEN>
 *
 * WHICH PORTAL — it will not guess (2026-08-31). Configure BUSMAPS_URL and
 * BUSMAPS_TOKEN (in the portal's own .env is easiest; this tool loads it) and
 * every run reads the live site. With neither set and no --local, this refuses
 * and prints the two lines to add, rather than quietly opening the dev SQLite.
 * It used to default to the dev checkout, and on 2026-08-31 a session asked for
 * "the worklist", got that checkout, and presented a demo customer's publish
 * review as the top blocked item. The banner said LOCAL — dev checkout the
 * whole time. A header you have to read is not a guard.
 *
 * PREFER THE TOKEN, AND THIS IS NOT A STYLE POINT (OA-203, 2026-08-31). A
 * cbm_session value is a PERSON's live admin session. Only four portal routes
 * sit behind step-up, so the same string that lets this tool print a list also
 * approves organisations, invites admins, revokes anybody's sessions and mails
 * every customer — and it was being kept in a file, indefinitely, renewed by
 * its own use. The portal's 2026-08-20 security round had explicitly retired
 * "the standing admin cookie kept in a file on the laptop"; this file put it
 * back eleven days later, because nothing on either side named the other.
 * OPERATOR_TOKEN reads the two lists this tool needs — three reads since
 * 2026-09-05, when GET /api/maps/:id/poi-tiers joined them for the landmark
 * rows (OA-233) — and does nothing else anywhere: GET only, those routes only,
 * refused everywhere else.
 *
 * The cookie is not, incidentally, short-lived — the portal's session window is
 * seven days and SLIDES on use, so every live run here renewed it by a week.
 * What kills it is signing out in the browser, which deletes the very row the
 * copied value names. That is worth knowing before blaming an expiry.
 *
 * WHAT NEITHER CREDENTIAL BUYS is the operator half — accepting a staged
 * refresh, withdrawing a publish request, changing a map's outputs. Those are
 * writes behind a real session, and publishing is behind a 30-minute step-up
 * anchored on SIGN-IN, which any stored credential fails by construction.
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
 *   --token  TOK   BUSMAPS_TOKEN    the portal's OPERATOR_TOKEN, sent as an
 *                                   Authorization: Bearer header. PREFER THIS.
 *   --cookie TOK   BUSMAPS_COOKIE   a cbm_session value instead — the old way,
 *                                   kept for a portal deployed before OA-203
 *   --local        (none)           read the dev checkout on purpose
 *   --demo         (none)           include rows belonging to demo customers
 *
 * Zero dependencies (Node core only), matching stage.js / status.js convention.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as conc from './concurrency.mjs';
import { annotateRequest } from './complexity_band.mjs';
import { gatherCiState, ciRows } from './ci_state.mjs';
import { landmarkAnswerItems } from './landmark_answers.mjs';
import { assetsDir, parseArgs, resolveBuses, resolvePortal, loadPortalEnv } from './engine.mjs';

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
// The parser, the two resolvers and the .env reader all come from ./engine.mjs,
// which loads the ENGINE's own `cli.js` (OA-232 Tier 2.6). This skill owns the
// BUSES_DIR / BUSMAPS_PORTAL convention -- `make-bus-leaflet/assets/cli.js` says
// so in its header -- and until 2026-09-03 it reached the engine through bare
// path literals and re-implemented the resolution it invented, with a second
// copy of all three functions in push-status.mjs (satellite F12, cross-repo F30).
const args = parseArgs(process.argv.slice(2));
const AS_JSON = !!args.json;
const RUN_GATES = !!args.gates;
// OA-221 — the concurrency verdict. On by default: the whole point is that
// Peter should not have to remember to ask for it.
const SAFE_ONLY = !!args['safe-only'];
const CONDITIONS_ONLY = !!args.conditions;
const SHOW_CONDITIONS = !args['no-conditions'];
// OA-251 — is any repository standing red in CI. ON BY DEFAULT, for the same
// reason the concurrency verdict is: the failure this replaces is nobody being
// told, and a flag you have to remember is not a fix for that. It costs one
// `gh run list` per repository and fails soft to a warning.
const NO_CI = args['no-ci'] || process.env.BUS_WORKLIST_NO_CI === '1';
const SELF_SESSION = (args.session && args.session !== true) ? String(args.session) : (process.env.BUS_SESSION || '');

const PORTAL = resolvePortal(args);

// The portal's own .env is the authority on DATA_DIR / DB_PATH / BUSES_DIR (its
// npm scripts load it with --env-file-if-exists). Read it so this tool always
// looks at the same database the server does, rather than the repo default.
// Real environment wins, so an explicit override still works.
loadPortalEnv(PORTAL);

const BUSES = resolveBuses(args);   // AFTER loadPortalEnv: BUSES_DIR is set in the portal's .env
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
const TOKEN = args.token || process.env.BUSMAPS_TOKEN || '';
const REMOTE = !!URL_BASE;
const SHOW_DEMO = !!args.demo;

// Refuse to GUESS which portal was meant. See "WHICH PORTAL" at the top of this
// file. The exit is 2 rather than 1 so a caller can tell "you did not say which
// portal" apart from "the run failed", and it prints on stderr so --json still
// yields nothing parseable on stdout instead of a plausible wrong answer.
// --conditions reads three working trees on this disk and never asks a portal
// anything, so the which-portal refusal below must not stand in its way.
if (!REMOTE && !args.local && !CONDITIONS_ONLY) {
  const envFile = path.join(PORTAL, '.env');
  console.error([
    '',
    '  Which portal? This tool will not guess.',
    '',
    '  For the LIVE site — use the portal\'s OPERATOR_TOKEN, which is a READ-ONLY',
    '  credential for exactly what this tool reads: two lists and, since OA-233,',
    '  each area map\'s landmark answer. Add two lines to',
    `  ${envFile} — this tool reads it, and in the portal repo it is gitignored,`,
    '  so the token stays off GitHub:',
    '',
    '      BUSMAPS_URL=https://busmaps.uk',
    '      BUSMAPS_TOKEN=<the value of OPERATOR_TOKEN on the host>',
    '',
    '  Then every run reads the live portal with no flag to remember.',
    '',
    '  A cbm_session cookie (BUSMAPS_COOKIE) still works for a portal deployed',
    '  before OA-203. Prefer the token: a session cookie is a PERSON\'s admin',
    '  login and can do everything an admin can, not just read a list.',
    '',
    '  For the DEV CHECKOUT, say so: node worklist.mjs --local',
    '',
  ].join('\n'));
  process.exit(2);
}

// The make-bus-leaflet assets dir, from ./engine.mjs -- one candidate list, and
// one that probes for BOTH gate_lib.js and status.js. This file probed only the
// first and push-status.mjs only the second, so on a tree holding one and not
// the other the two tools could resolve different engine folders (F12).
const SK = assetsDir();

/*
 * ---- OA-221: what is safe to do RIGHT NOW ---------------------------------
 *
 * Three working trees decide it, and the third one is easy to forget: the
 * ENGINE repository, which is where every generator lives and which is a
 * different repo from both this data tree and the portal. A build or a gate run
 * while it is mid-edit measures somebody's work in progress.
 *
 * `git -C <assets dir> rev-parse --show-toplevel` finds it rather than a
 * hard-coded path, because the skills tree is reached through a junction and the
 * literal path differs depending on which of the two names you came in by.
 */
function findEngineRepo() {
  const explicit = args.engine || process.env.BUS_ENGINE_REPO;
  if (explicit) return path.resolve(explicit);
  if (!SK) return null;
  try {
    const { execFileSync } = require('node:child_process');
    const top = execFileSync('git', ['-C', SK, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top ? path.resolve(top) : null;
  } catch { return null; }
}
const conditions = conc.readConditions({
  buses: BUSES, portal: PORTAL, engine: findEngineRepo(), selfSession: SELF_SESSION,
});

// `--conditions` answers "can I do anything at all right now?" without gathering
// a single queue. It is the cheapest thing in this file and the one to reach for
// before starting work, so it exits before any portal or map-tree read.
if (CONDITIONS_ONLY) {
  if (AS_JSON) { console.log(JSON.stringify({ conditions, standingTools: conc.STANDING_TOOLS.map((t) => ({ ...t, ...conc.assess(t.needs, conditions) })) }, null, 2)); process.exit(0); }
  console.log('\n\u2500\u2500 CONDITIONS ' + '\u2500'.repeat(46));
  for (const l of conc.formatConditions(conditions)) console.log(l);
  console.log('\n\u2500\u2500 WHAT THAT MEANS FOR THE STANDING COMMANDS ' + '\u2500'.repeat(16));
  for (const t of conc.STANDING_TOOLS) {
    const { verdict, reasons } = conc.assess(t.needs, conditions);
    console.log(`\n  ${conc.TAG[verdict].padEnd(16)}${t.what}`);
    console.log(`  ${''.padEnd(16)}${t.cmd}`);
    if (t.note) console.log(`  ${''.padEnd(16)}${t.note}`);
    for (const r of reasons) console.log(`  ${''.padEnd(16)}\u2014 ${r.why}`);
  }
  console.log('\n  Run `node worklist.mjs` for the list itself; every row carries the same verdict.\n');
  process.exit(0);
}

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
  if (!TOKEN && !COOKIE) {
    warnings.push('--url given but no --token / BUSMAPS_TOKEN (nor a --cookie) — cannot authenticate to the remote portal.');
    return null;
  }
  // The token goes in a header and NEVER in the query string: Caddy's access log
  // records the full request URI, so `?token=` writes a live credential in clear
  // into a file under no retention rule. The portal removed that form on
  // 2026-08-25 and this has never used it.
  const auth = TOKEN
    ? { authorization: `Bearer ${TOKEN}` }
    : { cookie: `cbm_session=${COOKIE}` };
  const get = async (p) => {
    const res = await fetch(`${URL_BASE}${p}`, { headers: auth });
    // The two credentials fail for different reasons and sending you to look at
    // the wrong one costs an evening. A token 401 is nearly always the portal
    // rather than the value: OPERATOR_TOKEN unset on the host, or a build that
    // predates OA-203 and has never heard of it.
    if (res.status === 401 || res.status === 403) {
      throw new Error(TOKEN
        ? `${p} -> ${res.status} (is OPERATOR_TOKEN set on that host, does it match BUSMAPS_TOKEN, and is the deployed build newer than OA-203?)`
        : `${p} -> ${res.status} (session cookie expired — did you sign out in the browser? — or not an admin account?)`);
    }
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
  /*
   * S6 staleness is asked of a PLACE too, since 2026-09-03 (OA-232 Tier 2.6,
   * the review's satellite F21).
   *
   * It was computed for towns only, in the identical eight lines above, and the
   * place branch stopped at "is it built". So the three standalone places, which
   * have no S6 run at all, and the nine nested ones whose answers date from
   * 2026-08-28/29 never reached this board -- and S6 is the cross-model red team,
   * the check that catches a route we draw that no longer runs. A place map is
   * put in front of the public exactly like a town map is.
   *
   * The one thing a place gets that a town does not is `borrowed`. A place may
   * reuse its parent town's blind answer (OA-141/OA-140, Peter's decision on
   * 2026-08-29) and then every HARD it produces is restated as a SOFT, because a
   * town answer is about services serving the TOWN where a place asks about
   * services calling at THESE STOPS. That is evidence rather than a verdict, and
   * a row that did not say so would read as a stronger result than it is.
   */
  const places = findPlaces(findTowns(BUSES)).map((p) => {
    const m = readJson(path.join(p.dir, 'manifest.json'));
    const s4 = latestRunDir(m, p.dir, 'S4');
    const row = { name: p.name, town: p.town, dir: p.dir, built: !!s4, version: s4 ? s4.rec.version : null };
    const s6 = latestRunDir(m, p.dir, 'S6');
    const dataRuns = ['S1', 'S2', 'S3']
      .map((k) => m.stages && m.stages[k] && m.stages[k].runs.find((r) => r.id === m.stages[k].latest))
      .filter(Boolean);
    const newestData = dataRuns.reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);
    row.s6 = s6 ? s6.rec.id : null;
    row.s6Stale = s6 ? !!(newestData && s6.rec.at < newestData) : true;
    row.s6Age = s6 ? daysSince(s6.rec.at) : null;
    // A standalone place has no parent town to borrow an answer from, so its S6
    // is the only blind answer it will ever have.
    row.standalone = !p.town;
    return row;
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
    /*
     * ASK WHETHER IT IS ALREADY DONE, and ask it FIRST after the instruction.
     * This file watches in one direction only: it exists because nothing on
     * disk changes when a letter is not sent, and the same is exactly true when
     * Peter sends one. On 2026-09-01 this row said "Send the OSMF enquiry --
     * due 2026-09-08, 7d left" a week after he had sent it, on 2026-08-25, and
     * it would have gone on saying so until the date passed and turned the
     * board red over a letter sitting in somebody's inbox.
     *
     * There is no read-back to add. The evidence is in his sent mail and it is
     * not on this machine, so no check here can reach it. The only channel that
     * exists is him telling a session -- which he will not do unprompted about
     * a row he believes is finished, because from where he sits it IS finished.
     * So the row asks. It costs one line when the answer is no, and the
     * alternative is a list that lies confidently about the one class of work
     * it was built to watch.
     */
    steps.push({ kind: 'chat', what: 'ALREADY DONE IT? Say so — nothing here can see your sent mail, and this row will keep asking until somebody tells it. Then retire the entry, and add the chase or the next step if one is now owed.' });
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
/*
 * AN AREA REQUEST CARRIES THE TOWN'S COMPLEXITY BAND, OR SAYS IT IS UNSCORED
 * (buses-data OA-088). Approval is the quota gate and the S2 gate runs after
 * it, so RED — the pipeline's one "not a single-sheet town" verdict — used to
 * be found only once the slot was spent. The portal cannot score a town; this
 * machine can, for free, and Peter's guide has promised him the band at gate
 * two since 21 August. The band comes off the town's newest S2 run by its
 * manifest; a town with none gets the step that scores it without spending
 * anything. A place request, and every other item, comes through untouched.
 */
const portalMapById = new Map((portal ? portal.maps : []).map((m) => [String(m.id), m]));
const townDirFor = (name) => {
  const t = tree.towns.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());
  return t ? t.dir : null;
};
for (const it0 of (portal ? portal.items : [])) {
  const mapId = /^(?:request|build)-(\d+)$/.exec(it0.key || '');
  const it = mapId ? annotateRequest(it0, portalMapById.get(mapId[1]) || null, townDirFor) : it0;
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
/*
 * HAS THIS MAP ALREADY BEEN ADJUDICATED AGAINST THIS SCAN? (buses-data OA-205)
 *
 * A refresh row is a JOIN against the newest scan report, so nothing can clear one
 * except rebuilding the map. On 2026-08-31 all 40 High Wycombe items were worked to
 * a conclusion and none of them needed a rebuild; the row came back unchanged, with
 * the same 40 on it. `refresh_review.mjs` writes `<mapDir>/refresh-reviews.json`
 * and this reads it.
 *
 * MATCHED ON THE SCAN DATE AND NOTHING ELSE, which is what makes the suppression
 * safe: reviewing 2026-08-31 cannot silence 2026-09-30, because the row is rebuilt
 * from whatever report is newest and the review names a date. A review of a scan
 * that does not exist cannot be written at all — refresh_review.mjs refuses one.
 *
 * SUPPRESSED, AND COUNTED OUT LOUD. The row is not silently dropped: the header
 * says how many were suppressed and against which scan, so a suppression that has
 * gone wrong is visible in the one place somebody is already reading. A list that
 * hides rows without saying so has the same problem as one carrying rows nobody can
 * clear.
 */
/*
 * COUNTED ONCE PER MAP, which the row path gets for free and this one does not.
 * `townMaps()` matches a place by its `subject` CONTAINING the section's town, so a
 * place whose own subject also contains its own section name matches twice: once
 * from the parent town's section, once from its own. St Ives Bus Station is exactly
 * that — subject "St Ives Bus Station" contains both "st ives" and "st ives bus
 * station" — while St Neots Co-op is not, because its subject is only "St Neots".
 *
 * A duplicate ROW cannot happen, because `haveKey('refresh-<slug>')` sees the first
 * one. But an ADJUDICATED map never adds a row, so that guard never arms and the
 * second match pushed the same map onto this list again. Observed 2026-09-03: eleven
 * suppressed maps reported as twelve. That is only a count, but the count is the
 * whole oversight mechanism this block exists for — the header says how many were
 * suppressed precisely so a suppression that has gone wrong is visible to whoever is
 * already reading, and a list that cannot count cannot do that job.
 *
 * NOT COVERED BY prove-red-refresh-review.mjs, deliberately said out loud rather than
 * left to be discovered: that harness runs with `--portal` at a directory which does
 * not exist, so it exercises the `refresh-local` row and never reaches `townMaps()`
 * at all. The local path cannot reproduce this — it resolves a section to a town by
 * exact name, so a place's section matches no town and pushes nothing.
 */
const adjudicated = [];
const adjudicatedSeen = new Set();
const noteAdjudicated = (key, entry) => {
  if (adjudicatedSeen.has(key)) return;
  adjudicatedSeen.add(key);
  adjudicated.push(entry);
};
const reviewedAgainst = (mapDir, scanDate) => {
  if (!mapDir || !scanDate) return null;
  const f = path.join(mapDir, 'refresh-reviews.json');
  if (!existsSync(f)) return null;
  let j = null;
  try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  const hit = (j.reviews || []).find((r) => r.scan === scanDate && r.verdict === 'no-rebuild');
  return hit || null;
};
/*
 * A PLACE HAS ITS OWN FILE, and this resolver is the reason that is true rather
 * than hoped for. `townMaps()` below matches a place by its `subject` containing
 * the town name, so `High Wycombe Aldi` gets a row out of the High Wycombe section
 * of the scan — but its map folder is its OWN, so the town's review is not found
 * for it. Adjudicating a town does not adjudicate a place whose frame is different
 * and whose sheet draws a different set of services (OA-205 item 4).
 */
const localDirOf = (m) => {
  if (m.kind === 'area') {
    const t = tree.towns.find((x) => x.name.toLowerCase() === (m.name || '').toLowerCase());
    return t ? t.dir : null;
  }
  const want = (m.name || '').toLowerCase();
  const pl = tree.places.find((x) => x.name.toLowerCase() === want)
    || tree.places.find((x) => want.includes(x.name.toLowerCase()));
  return pl ? pl.dir : null;
};
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
      const seen = reviewedAgainst(localDirOf(m), upcoming.date);
      if (seen) { noteAdjudicated(`map:${m.slug}`, { map: m.name, scan: upcoming.date, by: seen.by, note: seen.note }); continue; }
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
      const seenLocal = reviewedAgainst(localTown.dir, upcoming.date);
      if (seenLocal) { noteAdjudicated(`local:${localTown.name.toLowerCase()}`, { map: localTown.name, scan: upcoming.date, by: seenLocal.by, note: seenLocal.note }); continue; }
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

// 7 — a town's landmark answer is owed somewhere (buses-data OA-233, 2026-09-05).
//
// Two rows, one join, and neither existed until a customer's answer sat committed
// and unbuilt for two days with every board green. The portal's answer lives in
// its overrides; the town's source is its latest S3; the sheet is its latest S4.
// The byte gate reads the S4's OWN routes.json, so an answer that has reached S3
// and not S4 is invisible to it — which is the row that would have raised High
// Wycombe. The comparison is the engine's `compareTiers()`, not a copy of it, so
// an `industrial:*` key under industrialKeep "none" is unreachable here exactly as
// it is at build time, and this cannot raise a row nothing can clear.
//
// Remote: one GET per area map on `/api/maps/:id/poi-tiers`, admitted by the same
// OPERATOR_TOKEN as the two lists. Local: the store's overrides.json and the pack's
// routes.json, read directly. A portal older than the route answers 404 and the
// town is SKIPPED and counted in the header, never silently omitted.
const landmarkAnswers = await (async () => {
  if (!SK || !portal) return { items: [], checked: 0, skipped: [] };
  const { compareTiers } = require(path.join(SK, 'poi_tiers_sync.js'));
  const { readJson: rj, latestRunDir: lrd } = require(path.join(SK, 'gate_lib.js'));
  const dataDir = process.env.DATA_DIR || path.join(PORTAL, 'data');
  const readTown = (dir) => {
    let m; try { m = rj(path.join(dir, 'manifest.json')); } catch { return null; }
    const s3 = lrd(m, dir, 'S3'); if (!s3) return null;
    let routes; try { routes = rj(path.join(s3.dir, 'routes.json')); } catch { return null; }
    const poi = routes.poi || {};
    const s4 = lrd(m, dir, 'S4');
    let s4Tiers;
    if (s4) { try { s4Tiers = (rj(path.join(s4.dir, 'routes.json')).poi || {}).tiers || {}; } catch { s4Tiers = undefined; } }
    return { s3Tiers: poi.tiers || {}, s4Tiers, poiCfg: poi, s3Id: s3.rec.id, s4Version: s4 ? s4.rec.version : null };
  };
  const blocks = new Map();
  if (REMOTE && TOKEN) {
    await Promise.all(portal.maps.filter((m) => m.kind === 'area').map(async (m) => {
      try {
        const res = await fetch(`${URL_BASE}/api/maps/${m.id}/poi-tiers`, { headers: { authorization: `Bearer ${TOKEN}` } });
        blocks.set(m.id, res.ok ? await res.json() : null);
      } catch { blocks.set(m.id, null); }
    }));
  }
  const readBlock = (m) => {
    if (REMOTE) return blocks.has(m.id) ? blocks.get(m.id) : null;
    const ovPath = path.join(dataDir, 'maps', String(m.id), 'overrides.json');
    const packPath = path.join(dataDir, 'maps', String(m.id), 'data', 'routes.json');
    let ov = {}, pack = {};
    try { ov = JSON.parse(readFileSync(ovPath, 'utf8')); } catch { /* no overrides yet */ }
    try { pack = ((JSON.parse(readFileSync(packPath, 'utf8')).poi || {}).tiers) || {}; } catch { /* no pack */ }
    const saved = (ov.internal && ov.internal.poiTiers) || {};
    return { tiers: { ...pack, ...saved } };
  };
  return landmarkAnswerItems({
    maps: portal.maps, towns: tree.towns, readBlock, readTown, compareTiers,
    syncCmd: 'node poi_tiers_sync.js',
  });
})();
for (const it of landmarkAnswers.items) {
  add({ ...it, do: it.do.map((d) => (d.kind === 'shell' && d.cwd === 'engine-assets' ? { ...d, cwd: SK } : d)) });
}
if (landmarkAnswers.skipped.length) warnings.push(`landmark answers: ${landmarkAnswers.skipped.length} town(s) not compared — ${landmarkAnswers.skipped.map((s) => `${s.town} (${s.why})`).join('; ')}`);

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
const s6StalePlaces = (tree.places || []).filter((p) => p.built && p.s6Stale);
if (s6StalePlaces.length) {
  /*
   * The place half of the same row (OA-232 Tier 2.6, satellite F21). Its own
   * item rather than a widening of the town one, because the ACTION differs: a
   * nested place may borrow its parent town's red-team answer and cost nothing,
   * a standalone place cannot and must buy one. Merging the two would print a
   * single instruction that is wrong for one of the groups.
   */
  const standalone = s6StalePlaces.filter((p) => p.standalone);
  const nested = s6StalePlaces.filter((p) => !p.standalone);
  items.push({
    key: 's6-stale-places', rank: 8, type: 'housekeeping',
    title: `${s6StalePlaces.length} place map${s6StalePlaces.length === 1 ? '' : 's'} need an independent (S6) verification pass`,
    why: s6StalePlaces.map((p) => `${p.name} (${p.s6 ? `${p.s6Age}d old, pre-dates the current data` : 'never run'})`).join(', ')
      + '. This board asked the question of towns only until 2026-09-03, so these never appeared'
      + (standalone.length ? `. ${standalone.length} of them ${standalone.length === 1 ? 'is' : 'are'} STANDALONE and cannot borrow a parent town's answer` : '')
      + '.',
    who: '\u2014', runbook: 'S6', towns: s6StalePlaces.map((p) => p.name),
    do: [
      ...(nested.length ? [{ kind: 'skill', what: `Run S6 for these nested places, one at a time: ${nested.map((p) => p.name).join(', ')}. Run redteam_source.js FIRST — a nested place may reuse its parent town's blind answer, and then every HARD it produces is restated as a SOFT (OA-141).` }] : []),
      ...(standalone.length ? [{ kind: 'skill', what: `Run S6 for these STANDALONE places: ${standalone.map((p) => p.name).join(', ')}. There is no parent town to borrow from, so each needs its own blind answer — 89k–137k tokens apiece. Ask Peter before buying more than one.` }] : []),
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

// ---- CI state (OA-251) -----------------------------------------------------
// THE ONE SOURCE HERE WHOSE ONLY OTHER CHANNEL WAS PETER'S INBOX. Everything
// else on this list is read from a working tree or the portal's database; a
// repository standing red in GitHub Actions was visible only as an email, and on
// 2026-09-05 that channel was measured at ~25 failure mails a day with
// claude-skills red on 21 consecutive runs -- so each push mailed him about a
// red it had inherited, under its own commit message. The three findings
// underneath were fixed because a session went looking, not because anyone was
// told.
//
// Three `gh run list` calls, one per repository, plus one `gh run view` for each
// repository that is actually red. Every failure mode is a warning: no gh, no
// network, no auth and no origin all leave the rest of the list intact. It is
// skipped entirely with --no-ci.
//
// It does NOT overlap `--gates` below. That runs status.js here and asks whether
// the engine still reproduces a committed map; this asks whether the last run
// GitHub actually performed is still failing. Either can be true without the
// other -- a checker that runs only in CI, or a cross-repo pairing, is invisible
// to the local gate by construction.
const CI_DIRS = [
  { name: 'buses-data', dir: BUSES },
  { name: 'claude-skills', dir: findEngineRepo() },
  { name: 'community-bus-maps', dir: PORTAL },
].filter((d) => d.dir);
if (!NO_CI) {
  const ci = gatherCiState({ dirs: CI_DIRS });
  for (const it of ciRows(ci.states)) add(it);
  for (const w of ci.warnings) warnings.push(w);
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
for (const it of items) it.safety = conc.classify(it, conditions);

const demoAll = items.filter((i) => i.demo);
let shown = SHOW_DEMO ? items : items.filter((i) => !i.demo);
// --safe-only is STRICT: only rows nothing contends. CHECK FIRST rows are
// workable and are still hidden by it, because a flag called safe-only that
// showed a row needing care would be the last flag anybody trusted here.
const unsafeHidden = SAFE_ONLY ? shown.filter((i) => i.safety.verdict !== conc.SAFE).length : 0;
if (SAFE_ONLY) shown = shown.filter((i) => i.safety.verdict === conc.SAFE);

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
  // OA-205: which refresh rows were suppressed, and why. In the JSON as well as on
  // the console, because a caller reading --json must not see a shorter list than a
  // person does with no way to find out why.
  adjudicated,
  // OA-221. A caller reading --json must be able to see the same verdict a
  // person does, and the evidence behind it -- otherwise the two disagree and
  // only one of them gets read.
  conditions,
  safeOnly: SAFE_ONLY, unsafeHidden,
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
if (SHOW_CONDITIONS) {
  console.log('\u2500\u2500 CONDITIONS ' + '\u2500'.repeat(46));
  for (const l of conc.formatConditions(conditions)) console.log(l);
  const contended = conc.contentions(shown, conditions);
  if (contended.length) {
    console.log('');
    for (const r of contended) {
      console.log(`  ${conc.TAG[r.verdict].padEnd(16)}${conc.NEED_LABEL[r.need] || r.need}`);
      console.log(`  ${''.padEnd(16)}${r.why}`);
    }
  } else {
    console.log(`\n  ${conc.TAG[conc.SAFE].padEnd(16)}nothing on this list is contended \u2014 go ahead`);
  }
  console.log('');
}
for (const w of warnings) console.log(`  ! ${w}`);
if (adjudicated.length) {
  const scanSaid = upcoming ? upcoming.date : '?';
  console.log('  ' + adjudicated.length + ' refresh row' + (adjudicated.length === 1 ? '' : 's')
    + ' suppressed \u2014 already adjudicated against the ' + scanSaid + ' scan and found not to need a rebuild:');
  for (const a of adjudicated) {
    console.log('    ' + a.map + (a.by ? ' (' + a.by + ')' : '') + (a.note ? ' \u2014 ' + a.note.slice(0, 90) : ''));
  }
  console.log('');
}
if (warnings.length) console.log('');
if (!SHOW_DEMO && demoAll.length) console.log(`  (${demoAll.length} demo-customer row${demoAll.length === 1 ? '' : 's'} hidden — --demo to show)\n`);

let band = null, n = 0;
for (const it of limited) {
  if (bandOf(it) !== band) { band = bandOf(it); console.log(`── ${band} ${'─'.repeat(Math.max(0, 58 - band.length))}`); }
  n++;
  const age = it.ageDays == null ? '' : `  [${it.ageDays}d]`;
  console.log(`\n${String(n).padStart(2)}. ${it.title}${age}`);
  // The verdict sits directly under the title, above the explanation, because it
  // is the thing being scanned for. A banner higher up the page is not a guard.
  if (it.safety) {
    if (it.safety.verdict === conc.SAFE) {
      console.log(`    ${conc.TAG[conc.SAFE]} \u2014 it touches no shared working tree`);
    } else {
      const names = it.safety.reasons.map((r) => conc.NEED_LABEL[r.need] || r.need).join(', ');
      console.log(`    ${conc.TAG[it.safety.verdict]} \u2014 ${names} (why, under CONDITIONS above)`);
    }
  }
  console.log(`    ${it.why}`);
  for (const d of it.do) {
    if (d.kind === 'shell') console.log(`    $ (in ${d.cwd})\n      ${d.cmd}${d.note ? `   # ${d.note}` : ''}`);
    else if (d.kind === 'portal-ui') console.log(`    → ${d.what}  ${d.url}`);
    else console.log(`    → ${d.what}`);
  }
}
const tally = limited.reduce((a, i) => { a[i.safety.verdict] = (a[i.safety.verdict] || 0) + 1; return a; }, {});
console.log(`\n${limited.length === shown.length ? '' : `(${shown.length - limited.length} more) `}Nothing here needs a runbook: run /bus-work and pick a number.`);
console.log(`${tally[conc.SAFE] || 0} safe now \u00b7 ${tally[conc.CHECK] || 0} workable with care \u00b7 ${tally[conc.DELAY] || 0} better to delay${unsafeHidden ? `  (--safe-only hid ${unsafeHidden})` : ''}`);
console.log(`Conditions and the standing commands: node worklist.mjs --conditions\n`);

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
