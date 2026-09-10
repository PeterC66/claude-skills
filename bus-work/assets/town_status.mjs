#!/usr/bin/env node
/*
 * town_status.mjs — everything that is true about ONE map, worst first.
 *
 * WHY THIS EXISTS. On 2026-09-10 Peter asked "what is the status of Ramsey?" and the
 * board answered `Ramsey 3.9 · PASS PASS PASS · ok · S6 3d`. Every column was honest.
 * The map was also returning 404 to the public, had been invisible for thirteen days,
 * and had a correspondent who had been waiting seven days for a reply — and nothing
 * on that line could have said so, because `status.js` answers "does the current
 * engine reproduce the committed sheet" and that is a different question.
 *
 * THE FOUR READS NOTHING JOINED. A map's identity is spread across four places and
 * no tool crossed them: the build (`Areas/<Town>/manifest.json` and its S6 run), the
 * live site (`/api/public/maps`, where being PUBLISHED and being VISIBLE are separate
 * facts), the people (`Correspondence/CORR-nnn/`, one folder per conversation, each
 * naming its map in its own header), and the questions we asked a real person and
 * never got back (`local-decisions.json`). `status.js` knows the first. `worklist.mjs`
 * knows what is PENDING — which is not the same as what is true, because a thread
 * that is up to date drops off every computed view at exactly the moment somebody
 * asks how we are doing on that town.
 *
 * WORST FIRST, DELIBERATELY. The output leads with whatever is most wrong rather than
 * with the build, because the build is the half that already turns a column red. If a
 * map is invisible to the public, that is its status whatever the gates say.
 *
 * AN UNREACHABLE PORTAL IS NOT AN INVISIBLE MAP. The one failure this must never have
 * is reporting "not on the public site" because the network was down — that reads as
 * an incident and would send somebody to re-publish a map that was never off. A fetch
 * that fails exits 2, "I cannot tell you", and says so in place of the verdict. Same
 * rule as a check that cannot find its subject: never report clear, and never report
 * alarm, on an answer you did not get.
 *
 * WHAT IT DOES NOT DO. It runs no byte gate and re-renders nothing — for the
 * estate-wide gates, drift and the quality ratchet, run `status.js`. It reads what is
 * on disk and what the public site serves, and it writes nothing at all.
 *
 * Run from anywhere. The map name is the only required argument:
 *
 *   node town_status.mjs "Ramsey"
 *   node town_status.mjs "High Wycombe High Street"
 *   node town_status.mjs Ramsey --buses "C:/u3a St Ives/Using AI/Buses"
 *   node town_status.mjs Ramsey --offline          # skip the live site, say so
 *
 *   --buses <dir>   the buses-data checkout. Default: the BUSES_DIR environment
 *                   variable, else the repository this file's own tree sits beside,
 *                   else C:/u3a St Ives/Using AI/Buses
 *   --url <base>    portal base. Default https://busmaps.uk
 *   --offline       do not touch the network; the visibility section reports
 *                   "not checked" rather than guessing, and cannot set exit 1
 *   --json          machine-readable, same facts, no ordering opinion
 *
 * Exit 0 nothing needs attention · 1 something does · 2 used wrongly, or a fact
 * could not be established (unknown map, unreadable tree, unreachable portal).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import https from 'node:https';

/*
 * getJson — one GET, no connection pool, hard timeout.
 *
 * NOT `fetch`, and the reason is measured rather than stylistic. Node's fetch keeps
 * the socket in a pool after the body is read, which holds the event loop open: the
 * process then either hangs (it hung for ever against the stub server in
 * prove-red-town-status.mjs) or, if forced down with process.exit(), aborts on
 * Windows with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exit
 * 127 — which a caller reads as a crash on a perfectly healthy map. Against
 * busmaps.uk neither showed, because that server closes the connection first, so
 * the fault was invisible on the only host anybody would test by hand.
 *
 * `agent: false` means no pool to leave open, and the timeout means an unreachable
 * or wedged portal costs 8 seconds and then says so, rather than hanging a tool
 * whose whole job is to answer quickly.
 */
function getJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { agent: false, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('response was not JSON')); } });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`no answer in ${timeoutMs / 1000}s`)); });
    req.on('error', reject);
  });
}

const KNOWN = new Set(['--buses', '--url', '--offline', '--json', '--help', '-h']);
const TAKES_VALUE = new Set(['--buses', '--url']);

function die(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }

/* ---- arguments -------------------------------------------------------- */
// An unknown flag is refused BY NAME, never ignored (buses-data Conventions,
// 2026-09-02): a checker a typo can silently repoint is one that answers a
// question the caller did not ask.
const argv = process.argv.slice(2);
const opts = { offline: false, json: false, url: 'https://busmaps.uk', buses: null };
const bare = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--') && !(a === '-h')) { bare.push(a); continue; }
  if (!KNOWN.has(a)) {
    die(2, `town_status: unknown flag ${a}\n  known flags: ${[...KNOWN].join(' ')}`);
  }
  if (a === '--help' || a === '-h') { process.stdout.write(headerHelp()); process.exit(0); }
  if (a === '--offline') { opts.offline = true; continue; }
  if (a === '--json') { opts.json = true; continue; }
  if (TAKES_VALUE.has(a)) {
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) die(2, `town_status: ${a} needs a value`);
    opts[a === '--buses' ? 'buses' : 'url'] = v;
  }
}
if (!bare.length) die(2, 'town_status: name a map — e.g. node town_status.mjs "Ramsey"');
const wanted = bare.join(' ').trim();

function headerHelp() {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const m = /\/\*([\s\S]*?)\*\//.exec(src);
  return m ? m[1].replace(/^\s*\*ic? ?/gm, '').replace(/^ \* ?/gm, '') + '\n' : '';
}

/* ---- where is buses-data ---------------------------------------------- */
function resolveBuses() {
  if (opts.buses) return opts.buses;
  if (process.env.BUSES_DIR) return process.env.BUSES_DIR;
  return 'C:/u3a St Ives/Using AI/Buses';
}
const BUSES = resolveBuses();
if (!fs.existsSync(path.join(BUSES, 'Areas'))) {
  die(2, `town_status: no Areas/ under ${BUSES}\n  pass --buses <dir> or set BUSES_DIR.`);
}

/* ---- find the map ------------------------------------------------------ */
// Three shapes on disk and all three are real: Areas/<Town>, a nested place at
// Areas/<Town>/Places/<Place>, and a standalone at Places/_standalone/<Place>.
// Enumerated by looking for manifest.json rather than by listing folder names,
// so a map added tomorrow is found without editing this file.
function findMaps() {
  const out = [];
  const add = (dir, kind, parent) => {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) out.push({ name: path.basename(dir), dir, kind, parent });
  };
  const areas = path.join(BUSES, 'Areas');
  for (const t of fs.readdirSync(areas, { withFileTypes: true })) {
    if (!t.isDirectory() || t.name.startsWith('_')) continue;
    const townDir = path.join(areas, t.name);
    add(townDir, 'area', null);
    const pDir = path.join(townDir, 'Places');
    if (fs.existsSync(pDir)) {
      for (const p of fs.readdirSync(pDir, { withFileTypes: true })) {
        if (p.isDirectory()) add(path.join(pDir, p.name), 'place', t.name);
      }
    }
  }
  const stand = path.join(BUSES, 'Places', '_standalone');
  if (fs.existsSync(stand)) {
    for (const p of fs.readdirSync(stand, { withFileTypes: true })) {
      if (p.isDirectory()) add(path.join(stand, p.name), 'place', null);
    }
  }
  return out;
}

const maps = findMaps();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
let map = maps.find((m) => norm(m.name) === norm(wanted));
if (!map) {
  const near = maps.filter((m) => norm(m.name).includes(norm(wanted)));
  if (near.length === 1) map = near[0];
  else {
    die(2, `town_status: no map called "${wanted}"${near.length ? ` — did you mean: ${near.map((m) => m.name).join(', ')}?` : ''}\n` +
      `  known: ${maps.map((m) => m.name).sort().join(', ')}`);
  }
}

/* ---- 1. the build ------------------------------------------------------ */
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const daysSince = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
};

function buildFacts() {
  const man = readJson(path.join(map.dir, 'manifest.json'));
  if (!man) return { error: 'manifest.json is missing or will not parse' };
  const st = man.stages || {};
  const latest = (k) => (st[k] && st[k].latest) || null;
  const runAt = (k) => {
    const s = st[k]; if (!s) return null;
    const r = (s.runs || []).find((x) => x.id === s.latest);
    return r ? r.at || null : null;
  };
  const s6dir = latest('S6') ? path.join(map.dir, 'S6-verify', latest('S6')) : null;
  const ver = s6dir ? readJson(path.join(s6dir, 'verification.json')) : null;
  const findings = (ver && ver.findings) || [];
  const sev = (f) => String(f.severity || '').toLowerCase();
  return {
    version: latest('S5') || latest('S4'),
    s1At: runAt('S1'),
    s6: latest('S6'),
    s6AgeDays: runAt('S6') ? daysSince(runAt('S6')) : null,
    // S6 is STALE when the data it verified has moved under it: S1 newer than S6.
    s6Stale: !!(runAt('S1') && runAt('S6') && Date.parse(runAt('S1')) > Date.parse(runAt('S6'))),
    hard: findings.filter((f) => sev(f) === 'hard').length,
    soft: findings.filter((f) => sev(f) === 'soft').length,
    hasReport: !!ver,
  };
}

/* ---- 2. can anybody see it -------------------------------------------- */
// PUBLISHED and VISIBLE are different facts. The portal makes a map public only
// when it has a published version AND its customer is active AND public_listed
// is 1 AND it is not archived; the public API is the only place all four have
// already been applied, which is why this asks the site rather than any local file.
const slugOf = (n) => n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function publicFacts() {
  if (opts.offline) return { checked: false, reason: '--offline' };
  const base = opts.url.replace(/\/$/, '');
  let list;
  try {
    list = await getJson(`${base}/api/public/maps`);
  } catch (e) {
    return { checked: false, reason: `could not reach ${base} — ${e.message}` };
  }
  const rows = Array.isArray(list) ? list : (list.maps || list.data || []);
  if (!Array.isArray(rows)) return { checked: false, reason: 'the public maps API did not return a list' };
  const want = norm(map.name);
  const row = rows.find((r) => norm(r.slug || '') === norm(slugOf(map.name)) || norm(r.name || '') === want);
  const out = { checked: true, total: rows.length, listed: !!row };
  if (row) {
    out.slug = row.slug;
    out.version = row.version || (row.provenance && row.provenance.version) || null;
    out.url = `${base}${row.url || '/m/' + row.slug}`;
    out.servicesUrl = row.servicesUrl ? base + row.servicesUrl : null;
    // publishedAt is the VERSION ROW's created_at, not the moment of publication
    // (buses-data OA-295). Carried, and labelled for what it is.
    out.versionCreatedAt = row.publishedAt || (row.provenance && row.provenance.publishedAt) || null;
    if (row.provenance && row.provenance.stale) out.dataStale = true;
  }
  return out;
}

/* ---- 3. the people ----------------------------------------------------- */
// One folder per conversation, and each thread README declares its subject on its
// own `**About:**` line. Reported even when NOTHING is pending: a quiet thread is
// still a relationship, and the worklist only lists one while it is waiting on
// somebody.
//
// MATCHED ON THE DECLARATION, NOT ON A MENTION, and this was a real bug rather than
// a precaution. The first version searched the whole README for the map's name and
// returned CORR-005 — the Shelfords thread — for Ramsey, because its second
// paragraph says "the Ramsey adviser was recruited out of a fault report" while
// comparing candidates. A thread that mentions another thread is not a thread about
// that map. So: the name must appear on the About line, or a real `Areas/<name>/`
// path must appear anywhere in the file. Both are declarations; prose is not.
// A multi-subject thread legitimately matches more than one map, which is why the
// About line is scanned rather than parsed for a single subject.
function corrFacts() {
  const root = path.join(BUSES, 'Correspondence');
  if (!fs.existsSync(root)) return [];
  const threads = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^CORR-\d+$/.test(d.name)) continue;
    const rp = path.join(root, d.name, 'README.md');
    if (!fs.existsSync(rp)) continue;
    const text = fs.readFileSync(rp, 'utf8');
    const esc = map.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const about = (/^\*\*About:\*\*([^\n]*)$/m.exec(text) || [])[1] || '';
    const namedInAbout = new RegExp(`\\b${esc}\\b`, 'i').test(about);
    const pathAnywhere = new RegExp(`(?:Areas|Places)/(?:[^\`\\n]*/)?${esc}/`, 'i').test(text);
    if (!namedInAbout && !pathAnywhere) continue;
    const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || d.name;
    const status = (/\*\*Status:\*\*\s*([^\n]*)/.exec(text) || [])[1] || null;
    // The last row of the messages table is the last thing that happened.
    const rows = [...text.matchAll(/^\|\s*(\d{3})\s*\|\s*([\d-]{10})\s*\|\s*(in|out)\s*\|/gm)];
    const last = rows.length ? rows[rows.length - 1] : null;
    threads.push({
      ref: d.name,
      title: title.replace(/^CORR-\d+\s*[—-]\s*/, ''),
      lastNo: last ? last[1] : null,
      lastDate: last ? last[2] : null,
      lastDirection: last ? last[3] : null,
      lastAgeDays: last ? daysSince(last[2]) : null,
      status: status ? status.replace(/\s+/g, ' ').slice(0, 220) : null,
      // A thread whose last message came IN is a thread where the ball is with us.
      ballWithUs: last ? last[3] === 'in' : false,
      dir: path.join(root, d.name),
    });
  }
  return threads;
}

/* ---- 4. what we asked and never got back ------------------------------- */
function decisionFacts() {
  const p = path.join(map.dir, 'local-decisions.json');
  const d = readJson(p);
  if (!d) return { file: null, open: [] };
  const open = (d.decisions || [])
    .filter((x) => x.answer && !['answered'].includes(String(x.answer.state)))
    .map((x) => ({
      id: x.id,
      state: x.answer.state,
      severity: x.severity || null,
      raised: x.raised || null,
      ageDays: x.raised ? daysSince(x.raised) : null,
      question: String(x.question || '').replace(/\s+/g, ' ').slice(0, 150),
    }));
  return { file: p, updated: d.updated || null, open };
}

/* ---- report ------------------------------------------------------------ */
const build = buildFacts();
const pub = await publicFacts();
const threads = corrFacts();
const decisions = decisionFacts();

const problems = [];
if (build.error) problems.push({ rank: 0, line: `BUILD: ${build.error}` });
if (pub.checked && !pub.listed) {
  problems.push({ rank: 0, line: `INVISIBLE — this map is not on the public site. It is absent from ${opts.url}/api/public/maps, which serves ${pub.total} maps.`,
    hint: 'Published and visible are different facts: a map with a published version is still hidden while public_listed is 0. The listing tick is on the map page in /app.' });
}
if (pub.checked && pub.listed && pub.dataStale) {
  problems.push({ rank: 2, line: 'The published sheet is flagged STALE by the portal\'s own provenance.' });
}
for (const t of threads.filter((t) => t.ballWithUs)) {
  problems.push({ rank: 1, line: `${t.ref}: their message ${t.lastNo} of ${t.lastDate} is the last thing in the thread — ${t.lastAgeDays}d, and the ball is with us.` });
}
for (const d of decisions.open.filter((d) => d.severity === 'blocking')) {
  problems.push({ rank: 2, line: `A BLOCKING local question is ${d.state}: ${d.id} (${d.ageDays}d) — the sheet is drawn on our own judgement until somebody answers it.` });
}
if (build.hasReport && build.hard > 0) problems.push({ rank: 1, line: `S6 reports ${build.hard} HARD finding(s) on run ${build.s6}.` });
if (build.s6Stale) problems.push({ rank: 3, line: `S6 is STALE — run ${build.s6} pre-dates the current S1 data.` });
if (build.hasReport === false) problems.push({ rank: 3, line: 'No S6 verification report on disk — this map has never been independently checked.' });
problems.sort((a, b) => a.rank - b.rank);

if (opts.json) {
  process.stdout.write(JSON.stringify({ map: { name: map.name, kind: map.kind, parent: map.parent, dir: map.dir }, build, public: pub, correspondence: threads, decisions, problems }, null, 2) + '\n');
} else {
  const L = (s = '') => process.stdout.write(s + '\n');
  L();
  L(`${map.name} — ${map.kind}${map.parent ? ` in ${map.parent}` : map.kind === 'place' ? ' (standalone)' : ''}`);
  L('='.repeat(Math.max(20, map.name.length + 24)));

  if (problems.length) {
    L();
    L('NEEDS ATTENTION');
    for (const p of problems) { L(`  ! ${p.line}`); if (p.hint) L(`    ${p.hint}`); }
  } else {
    L();
    L('Nothing on this map needs attention.');
  }

  L();
  L('ON THE PUBLIC SITE');
  if (!pub.checked) L(`  not checked — ${pub.reason}. This is NOT a report that the map is missing.`);
  else if (!pub.listed) L(`  NO. Absent from the public list of ${pub.total} maps.`);
  else {
    L(`  yes — ${pub.url}   (${pub.version || 'version unknown'})`);
    if (pub.servicesUrl) L(`  text alternative: ${pub.servicesUrl}`);
    if (pub.versionCreatedAt) L(`  that version's row was created ${pub.versionCreatedAt} (NOT when it was published — see OA-295)`);
  }

  L();
  L('THE BUILD');
  if (build.error) L(`  ${build.error}`);
  else {
    L(`  local render ${build.version || '(none)'}${pub.checked && pub.listed && pub.version && pub.version !== build.version ? `   — the public has ${pub.version}, which is a different number in a different scheme; compare with care` : ''}`);
    L(`  S6 ${build.s6 || 'never run'}${build.s6AgeDays != null ? `, ${build.s6AgeDays}d old` : ''}${build.hasReport ? ` — ${build.hard} hard / ${build.soft} soft` : ''}${build.s6Stale ? '  STALE' : ''}`);
    L('  byte gates, quality ratchet and vendoring drift are NOT checked here — run status.js for those.');
  }

  L();
  L('THE PEOPLE');
  if (!threads.length) L('  no correspondence thread names this map.');
  for (const t of threads) {
    L(`  ${t.ref} — ${t.title}`);
    if (t.lastDate) L(`    last message: ${t.lastNo} on ${t.lastDate} (${t.lastDirection === 'in' ? 'from them' : 'from us'}), ${t.lastAgeDays}d ago`);
    if (t.status) L(`    ${t.status}`);
    L(`    ${t.dir}`);
  }

  L();
  L('QUESTIONS WE ASKED AND HAVE NOT GOT BACK');
  if (!decisions.file) L('  this map has no local-decisions.json.');
  else if (!decisions.open.length) L('  none outstanding.');
  else for (const d of decisions.open) L(`  ${d.state.padEnd(15)} ${d.id}${d.severity === 'blocking' ? '  [BLOCKING]' : ''}${d.ageDays != null ? `  ${d.ageDays}d` : ''}\n      ${d.question}`);
  L();
}

// A fact we could not establish is not a clean bill of health.
//
// process.exitCode rather than process.exit(): on Windows/Node 24 an abrupt exit
// straight after fetch() aborts with `Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)` and a 127, which would make every caller read a healthy map
// as a crash. Setting the code and letting the loop drain gives the same answer
// without racing libuv's own teardown. Measured here, not reasoned.
process.exitCode = (!pub.checked && !opts.offline) ? 2 : (problems.length ? 1 : 0);
