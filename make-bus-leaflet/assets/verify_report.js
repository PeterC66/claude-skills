#!/usr/bin/env node
/*
 * verify_report.js — Stage S6 independent verification engine for make-bus-leaflet.
 *
 * Runs the "antagonistic" verification pass: it diffs an INDEPENDENT blind
 * red-team re-derivation of the town's services (redteam.json — produced by a
 * separate sub-agent that never saw our stored data; see references/s6-verify.md)
 * against our own pipeline outputs, AND runs structural / geographic sanity
 * checks that don't need the red-team at all. Every finding is classified:
 *
 *   HARD  — blocks the build loudly (exit 1). The displayed leaflet would be
 *           wrong or undrawable:
 *             • a displayed route with no full-chain data
 *             • a terminus mismatch vs S1 (chain ends somewhere else entirely)
 *             • a route drawn the wrong direction out of town
 *             • implausible stop counts (nothing to draw)
 *             • an orphan drawn stop with no coordinate
 *             • we display a service the red-team says does NOT serve the town
 *   SOFT  — logged only (exit 0): name/spelling, operator label, off-by-one,
 *           day variants, inclusion candidates, things the red-team couldn't
 *           confirm.
 *
 * Inputs (read from the working dir; override the dir with VERIFY_DIR):
 *   redteam.json            (the blind red-team JSON; optional — sanity-only without it)
 *   verified-services.json  (S1)
 *   routes.json             (S3 — incl. `notShown[]`, routes carried in the panel with no line)
 *   routes_full_atco.json   (S2 — full both-direction chains)
 *   routes_intown_atco.json (S2 — the drawn display subset)
 *   atco2ll.json            (S2 — coords for every full-chain stop)
 *   atco2name.json          (S2 — stop names, for evidence; optional)
 *   intown_cfg.json         (S2 — anchor / prefix; optional)
 *
 * Output:
 *   verification.json       (every check, classified, with evidence + summary)
 *   console summary
 *   exit code 1 if any HARD finding, else 0.
 *
 * Usage:  node verify_report.js            (in the S6 run dir, after pulling inputs)
 *         VERIFY_DIR=/path node verify_report.js
 *
 * Zero dependencies (Node core only).
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.VERIFY_DIR || process.cwd();
const P = (f) => path.join(DIR, f);
function readJSON(f, optional) {
  const fp = P(f);
  if (!fs.existsSync(fp)) {
    if (optional) return null;
    console.error('verify_report.js: missing required input ' + f + ' in ' + DIR);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// ---------- load ----------
function readRedteam() {                    // unescape HTML entities the agent may emit (P&amp;R, Mon &amp; Fri)
  const fp = P('redteam.json');
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, 'utf8')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return JSON.parse(raw);
}
const redteam   = readRedteam();
const verified  = readJSON('verified-services.json');
const routes    = readJSON('routes.json');

/*
 * PRECONDITION -- refuse to run on an uncurated S1 (added 2026-08-27).
 *
 * A town auto-drafted by draft_town.py holds GTFS HEADSIGNS in `termini` where a
 * real S1 pass holds SETTLEMENT names. Every terminus check then fails by
 * construction, and the five red-team ones are not independent corroboration
 * because both sides read the same field. Ramsey returned 12 terminus HARDs on
 * that basis alone on 2026-08-26, on a sheet whose Services panel was correct
 * throughout -- a large, confident, unactionable count that buries the findings
 * that matter. Its own DRAFT-REVIEW.md had predicted every one of them and had
 * sat unread since 4 August.
 *
 * So the S1 pass is owed FIRST. Exit 3 (distinct from 2, a missing input) and say
 * what to do. VERIFY_ALLOW_UNCURATED=1 forces the run anyway -- for proving this
 * gate, and for deliberately measuring what an uncurated town scores.
 */
let UNCURATED = null;                       // reasons array when the S1 is a draft, else null
{
  const reasons = [];
  if (routes._bootstrap) reasons.push('routes.json carries _bootstrap ("' + String(routes._bootstrap).slice(0, 120) + '")');
  // DIR is <town>/S6-verify/<date> (or <town>/Places/<place>/S6-verify/<date>), so
  // the build folder is two levels up.
  const buildDir = path.resolve(DIR, '..', '..');
  const draft = path.join(buildDir, 'DRAFT-REVIEW.md');
  if (fs.existsSync(draft)) reasons.push(draft + ' is present and unactioned');
  if (reasons.length && process.env.VERIFY_ALLOW_UNCURATED !== '1') {
    console.error('-'.repeat(64));
    console.error('verify_report.js: REFUSING TO RUN - this town has an uncurated S1.');
    console.error('-'.repeat(64));
    for (const r of reasons) console.error('  * ' + r);
    console.error('');
    console.error('  An auto-drafted verified-services.json holds GTFS headsigns where a real');
    console.error('  S1 pass holds settlement names, so every terminus check fails by');
    console.error('  construction and the HARD count says nothing about the sheet. Do the S1');
    console.error('  pass first, and read DRAFT-REVIEW.md - it usually already names the');
    console.error('  findings a run would rediscover.');
    console.error('');
    console.error('  To run anyway (the count will not be readable): VERIFY_ALLOW_UNCURATED=1');
    console.error('-'.repeat(64));
    process.exit(3);
  }
  if (reasons.length) {
    UNCURATED = reasons;
    console.error('verify_report.js: WARNING - running on an uncurated S1 (VERIFY_ALLOW_UNCURATED=1).');
    for (const r of reasons) console.error('  * ' + r);
    console.error('  Terminus findings below are reported SOFT: the field they read holds stop');
    console.error('  names, so they are artefacts of the draft, not statements about the sheet.\n');
  }
}
const full      = readJSON('routes_full_atco.json');
const intown    = readJSON('routes_intown_atco.json');
const ll        = readJSON('atco2ll.json');
const names     = readJSON('atco2name.json', true) || {};
const intownCfg = readJSON('intown_cfg.json', true) || {};

// ---------- helpers ----------
const findings = [];
let fid = 0;
function add(severity, category, message, evidence, route, source) {
  findings.push({
    id: 'F' + (++fid).toString().padStart(3, '0'),
    severity, category,
    route: route || null,
    message,
    evidence: evidence || {},
    source: source || 'sanity',
  });
}
const hard = () => findings.filter(f => f.severity === 'hard');
const soft = () => findings.filter(f => f.severity === 'soft');

const normRoute = (r) => String(r == null ? '' : r).toUpperCase().replace(/\s+/g, '');
/*
 * A route NUMBER is not a unique key, and two different things were indexed on it
 * as if it were.
 *
 * OURS. verified-services.json already carries `key` wherever the number repeats:
 * Wisbech runs two route 46s (Stagecoach East to March, Lynx to King's Lynn) and
 * keys them `46` and `46L` -- exactly how routes_full_atco, routes_intown_atco and
 * the palette key them. This file indexed on the number alone, so the Lynx entry
 * silently overwrote the Stagecoach one: route 46's drawn chain was checked against
 * the LYNX termini, and 46L was never checked at all. `ourKey` reads the field the
 * data has been carrying all along.
 *
 * THEIRS. The red team writes what the operator BRANDS, so `46 (Lynx)`,
 * `ZIP2 (Ely Zipper 2)` and `102 (Flightline)` normalise to keys we do not hold and
 * the same route then appears TWICE -- once as `not-confirmed <ours>` and once as
 * `missing-service <theirs>`. Seen on March, Beaconsfield and Wisbech in one run,
 * and the Wisbech case read as a gap in data that was already correct. `baseRoute`
 * strips the brand so the two sides pair on the number and are then told apart by
 * operator, which is the only thing that actually distinguishes them.
 */
const ourKey    = (s) => normRoute(s && (s.key || s.route));
const baseRoute = (r) => { const n = normRoute(r); return n.replace(/\(.*\)$/, '') || n; };
function localityToken(atco) {           // 0500H<LLLL>nnn -> "LLLL"
  const m = String(atco).match(/^[0-9]{4}[A-Z]([A-Z]{4})/);
  return m ? m[1] : null;
}
function placeToken(name) {               // "St Ives" -> "STIV", "Ramsey" -> "RAMS"
  const a = String(name).toUpperCase().replace(/[^A-Z]/g, '');
  return a.slice(0, 4) || null;
}
// Locality CODE -> settlement NAME(s), for the handful of NaPTAN codes that the 3-char
// prefix rule below cannot reach (Cambridge is "CITY"). A code with no entry is
// UNVERIFIABLE, never a mismatch — see naptan_localities.json's own comment.
const LOCALITY_NAMES = (() => {
  try {
    const p = path.join(__dirname, 'naptan_localities.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).localities || {};
  } catch { return {}; }
})();
// Does settlement `name` denote locality code `code`? Prefix rule first (STNE~STNS,
// BUCK~BUCN), then the gazetteer for the irregulars.
function nameMatchesLocality(name, code) {
  const pt = placeToken(name);
  if (!pt || !code) return false;
  if (code === pt || code.slice(0, 3) === pt.slice(0, 3)) return true;
  return (LOCALITY_NAMES[code] || []).some(n => placeToken(n) === pt);
}
function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
const OP_STOP = new Set(['coaches', 'coach', 'buses', 'bus', 'ltd', 'limited', 'the', 'of', 'and', 'company', 'co', 'travel', 'group', 'services', 'service', 'minibus', 'minibuses']);
function opTokens(s) { return tokenize(s).filter(t => !OP_STOP.has(t)); }
function overlaps(a, b) { const sb = new Set(b); return a.some(x => sb.has(x)); }
function normDays(s) {
  let d = String(s || '').toLowerCase().replace(/[–—]/g, '-');
  d = d.replace(/monday/g, 'mon').replace(/tuesday/g, 'tue').replace(/wednesday/g, 'wed')
       .replace(/thursday/g, 'thu').replace(/friday/g, 'fri').replace(/saturday/g, 'sat').replace(/sunday/g, 'sun')
       .replace(/\bto\b/g, '-').replace(/\bevery ?day\b/g, 'daily');
  return d.replace(/[^a-z0-9&-]/g, '');
}

function haversineKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const la1 = a[0] * toR, la2 = b[0] * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {                   // degrees 0..360 from a to b
  const toR = Math.PI / 180;
  const dLon = (b[1] - a[1]) * toR;
  const la1 = a[0] * toR, la2 = b[0] * toR;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angleDiff(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// ---------- derive the displayed-route set + anchor ----------
const palette = routes.palette || {};
const displayed = new Set();
for (const r of Object.keys(intown || {})) displayed.add(normRoute(r));
for (const e of (routes.external || [])) displayed.add(normRoute(e.route));
for (const e of (routes.busway || [])) displayed.add(normRoute(e.route));
for (const r of Object.keys(palette)) displayed.add(normRoute(r)); // palette = intended to draw

// anchor coordinate (for direction checks)
let anchorLL = null;
const anchorAtco = intownCfg.anchor || routes.anchor;
if (anchorAtco && ll[anchorAtco]) anchorLL = ll[anchorAtco];
if (!anchorLL) { // centroid of locality-prefix stops as a fallback
  const pre = intownCfg.prefix;
  const pts = Object.keys(ll).filter(a => pre ? a.startsWith(pre) : false).map(a => ll[a]);
  if (pts.length) anchorLL = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

// index full-chain helpers
function fullEntry(route) {
  const key = Object.keys(full || {}).find(k => normRoute(k) === normRoute(route));
  return key ? full[key] : null;
}
function fullDirections(fe) {              // array of {name,stops}
  if (!fe) return [];
  const dirs = [];
  if (fe.directions) for (const k of Object.keys(fe.directions)) dirs.push(fe.directions[k]);
  if (fe.canonical) for (const d of fe.canonical) dirs.push(d);
  return dirs.filter(d => d && Array.isArray(d.stops) && d.stops.length);
}
function fullAllStops(fe) {
  if (!fe) return [];
  if (Array.isArray(fe.all)) return fe.all;
  const s = new Set();
  for (const d of fullDirections(fe)) for (const a of d.stops) s.add(a);
  return [...s];
}

const CIRCULAR = new Set((intownCfg.circular || []).map(normRoute));

/*
 * NOT SHOWN ON THIS MAP -- a DECLARATION, not an inference (OA-049).
 *
 * A service can be real, correct and deliberately undrawn. The two St Neots place
 * sheets carry routes 112 and 193 as Services-panel rows with no line, because the
 * Ivel Sprinter is a Bedfordshire community service outside the BODS region we pull
 * -- there is no chain to draw and there never will be from this data. The sheets
 * already say so in words: services_panel.js appends "not shown on this map" to the
 * row, and routes.json has carried `notShownNote` / `notShownNoteShort` to change
 * those words since that convention landed.
 *
 * S6 could not tell that from a route whose geometry has genuinely gone missing, so
 * it called both HARD `no-full-chain`. On current data that one category was the
 * ENTIRE distance between two BLOCKED places and two clean ones -- 2 hard apiece and
 * nothing else -- which is the shape of a check that has stopped being believed.
 *
 * `routes.json notShown[]` is the missing declaration, and it is deliberately a
 * declaration rather than a smarter check. Inferring it -- "no chain and no palette
 * entry, so it must be on purpose" -- would make a genuinely broken route
 * indistinguishable from an intended one, which is the fault this check exists to
 * catch. Someone has to write the route down.
 *
 * A declaration that can only ever quieten a finding is a mute button, so this one
 * is checked in both directions (see S-1b below): declaring a route not shown when
 * the sheet DOES draw it is itself HARD, and declaring one the sheet does not carry
 * at all is a stale entry and is reported.
 */
const NOT_SHOWN = new Set((routes.notShown || []).map(normRoute));

// =====================================================================
// SANITY CHECKS (no red-team needed)
// =====================================================================

// S-1: every displayed route has full-chain data -- unless the config declares it undrawn
for (const r of displayed) {
  const fe = fullEntry(r);
  const dirs = fullDirections(fe);
  if (fe && dirs.length) continue;
  if (NOT_SHOWN.has(normRoute(r))) {
    add('soft', 'declared-not-shown',
      `Route ${r} has no full-chain data, and routes.json declares it — it is a panel row carried on purpose with no line on the map, not missing geometry. The sheet says so too ("not shown on this map").`,
      { route: r, hasEntry: !!fe, directions: dirs.length, declared: true }, r);
    continue;
  }
  add('hard', 'no-full-chain',
    `Displayed route ${r} has no full-chain data in routes_full_atco.json.`,
    { route: r, hasEntry: !!fe, directions: dirs.length }, r);
}

/*
 * S-1b: the declaration checked the other way, so it cannot be used as a mute button.
 *
 * Two ways a `notShown` entry can be wrong, and neither is quiet:
 *   - the sheet DRAWS the route. Then the declaration is false, the row's own
 *     subtitle will not say "not shown", and whatever the entry was written to
 *     silence is still there unexamined. HARD.
 *   - the sheet does not carry the route at all -- no palette entry, no panel row.
 *     Then it is a leftover from a config the sheet has moved past, and the next
 *     reader will trust it. Reported SOFT rather than HARD: it hides nothing, it
 *     just is not true any more.
 */
for (const d of NOT_SHOWN) {
  const drawn = intownByNorm(d) || [];
  if (drawn.length >= 2) {
    add('hard', 'declared-not-shown',
      `routes.json declares route ${d} is not shown on this map, but the drawn set gives it ${drawn.length} stops — the sheet draws it. Either the declaration is stale, or it is silencing a finding about a route that is on the sheet.`,
      { route: d, drawnStops: drawn.length }, d);
  } else if (!displayed.has(normRoute(d))) {
    add('soft', 'declared-not-shown',
      `routes.json declares route ${d} is not shown on this map, but the sheet does not carry it at all — no palette entry and no panel row. The entry is stale.`,
      { route: d, drawnStops: drawn.length, inDisplayed: false }, d);
  }
}

// S-2: every drawn ATCO has a coordinate (orphan stop check)
for (const r of Object.keys(intown || {})) {
  for (const a of intown[r]) {
    if (!ll[a]) {
      add('hard', 'orphan-stop',
        `Drawn stop ${a} (route ${r}) has no coordinate in atco2ll.json.`,
        { route: r, atco: a, name: names[a] || null }, r);
    }
  }
}

// S-3: stop counts plausible
for (const r of displayed) {
  const seq = (intown && intown[normRouteKey(r)]) || intownByNorm(r);
  const fe = fullEntry(r);
  const fullN = fe ? fullAllStops(fe).length : 0;
  const inN = seq ? seq.length : 0;
  if (seq && inN === 0) {
    add('hard', 'count', `Displayed route ${r} has 0 drawn stops (nothing to draw).`, { route: r }, r);
  } else if (inN > 80) {
    add('hard', 'count', `Displayed route ${r} has an implausible drawn-stop count (${inN}).`, { route: r, inTown: inN }, r);
  } else if (inN >= 45) {
    add('soft', 'count', `Route ${r} has a high drawn-stop count (${inN}) — sanity-check it isn't accidentally drawing the full chain.`, { route: r, inTown: inN }, r);
  }
  if (fe && fullN < 2) {
    add('hard', 'count', `Route ${r} full chain has < 2 stops (${fullN}); cannot be a real route.`, { route: r, full: fullN }, r);
  }
}
function normRouteKey(r) { return Object.keys(intown || {}).find(k => normRoute(k) === normRoute(r)); }
function intownByNorm(r) { const k = normRouteKey(r); return k ? intown[k] : null; }

// Locality tokens at both ends of every direction of a route's full chain.
// Chain ends OUTSIDE the NaPTAN "0500H<LLLL>nnn" locality-coded style yield no token
// (a cross-border town has them: St Neots' 905 ends at Bedford Bus Station 020035035).
// Count those as UNVERIFIABLE rather than as a mismatch, or an entirely correct route
// gets a false HARD just for leaving the county.
// The town's own locality token, from the in-town ATCO prefix ("0500FWISH" -> "WISH").
const TOWN_TOKEN = localityToken(intownCfg.prefix || routes.atcoPrefix || '');
// Does every end of every direction of this chain sit in the town's own locality?
// Compared on three characters, the same rule nameMatchesLocality uses, so a
// neighbouring sub-locality counts as still-in-town: Wisbech is WISH and Wisbech
// St Mary is WISM. A chain like that has not left town and so cannot be evidence
// about a terminus beyond it. No town token => cannot tell => false, never suppress.
function chainNeverLeavesTown(fe) {
  if (!TOWN_TOKEN) return false;
  const { endTokens, untokenisedEnds } = chainEnds(fe);
  if (untokenisedEnds || !endTokens.size) return false;
  return [...endTokens].every(t => t.slice(0, 3) === TOWN_TOKEN.slice(0, 3));
}

function chainEnds(fe) {
  const endTokens = new Set(); let untokenisedEnds = 0;
  for (const d of fullDirections(fe)) {
    for (const a of [d.stops[0], d.stops[d.stops.length - 1]]) {
      const t = localityToken(a);
      if (t) endTokens.add(t); else untokenisedEnds++;
    }
  }
  endTokens.delete(null);
  return { endTokens, untokenisedEnds };
}

// S-4: routes_full termini align with S1 declared termini.
// Indexed on the SERVICE's own key, so a town with two same-numbered routes gets
// each checked against its own chain rather than one of them checked twice.
const vsByRoute = {};
for (const s of (verified.services || [])) vsByRoute[ourKey(s)] = s;
for (const r of displayed) {
  const vs = vsByRoute[r];
  const fe = fullEntry(r);
  if (!vs || !fe || !Array.isArray(vs.termini) || vs.termini.length === 0) continue;
  const { endTokens, untokenisedEnds } = chainEnds(fe);
  const results = vs.termini.map(t => {
    const pt = placeToken(t);
    const matched = [...endTokens].some(et => nameMatchesLocality(t, et));
    return { terminus: t, token: pt, matched: !!matched };
  });
  const nMatched = results.filter(x => x.matched).length;
  // A PLACE has no hand-verified terminus list. Its termini come from routes.json's
  // curated destinations[] where those exist, and otherwise from raw BODS headsigns —
  // and a headsign ("Market Square", "Tesco") is not a settlement, so it can never match
  // a locality code. Scoring that as HARD made every route of every place fail and left
  // a place's hard count unreadable (10 of St Neots Town Centre's 13, 2026-08-21).
  // Say plainly that the check is unavailable rather than inventing a pass for it: the
  // independent terminus signal for a place is the red-team comparison further down.
  if (nMatched === 0 && vs.terminiSource) {
    const why = vs.terminiSource === 'gtfs-headsign'
      ? `they are raw BODS headsigns (${vs.termini.join(', ')}), not settlements, and routes.json names no destinations[] entry for this route`
      : `they are place destinations (${vs.termini.join(', ')}) — a landmark a rider can reach, which is what a place map is for, not the settlement the route terminates in`;
    add('soft', 'terminus',
      `Route ${r}: terminus not checkable against the drawn chain — ${why}. Chain ends: ${[...endTokens].join(', ')}. This is a limit of the check on a PLACE, not evidence of a fault; the independent terminus signal here is the red-team comparison.`,
      { route: r, termini: vs.termini, terminiSource: vs.terminiSource, chainEndTokens: [...endTokens], results }, r);
  } else if (nMatched === 0 && chainNeverLeavesTown(fe)) {
    /*
     * A TRUNCATED chain. Wisbech's `excel` holds only its 15 local stops, both ends
     * inside Wisbech / Wisbech St Mary, while its declared termini are Peterborough
     * and Norwich. "Neither declared terminus appears at the ends of its full chain"
     * is then perfectly true and says nothing about the sheet, which draws the route
     * correctly as two external spokes. The chain never left town, so it cannot
     * confirm OR contradict a terminus beyond it -- the check did not run.
     */
    const ext = (routes.external || []).some(e => normRoute(e.route) === r);
    add('soft', 'terminus',
      `Route ${r}: terminus not checkable - its full chain never leaves the town (every chain end is a local locality: ${[...endTokens].join(', ')}), so it cannot reach the declared termini (${vs.termini.join(', ')}) whether those are right or wrong. The chain in routes_full_atco.json is truncated to local stops.${ext ? ' routes.json draws this route from external[], which is where its real destination is asserted.' : ''}`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], truncatedChain: true, hasExternalEntry: ext, results }, r);
  } else if (nMatched === 0 && untokenisedEnds) {
    add('soft', 'terminus',
      `Route ${r}: could not verify either declared terminus (${vs.termini.join(', ')}) — ${untokenisedEnds} chain end(s) are not NaPTAN locality-coded (cross-border stops), so there is nothing to match against. Confirm by hand.`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], untokenisedEnds, results }, r);
  } else if (nMatched === 0) {
    /*
     * An UNCURATED S1 fails this check by construction, so under the override that
     * let the run happen at all, do not dress the artefact up as a HARD. The
     * declared "termini" are GTFS headsigns -- stop names like "Bus Station" or
     * "New Road" -- and a stop name can never match a locality code however right
     * the sheet is. Ramsey scored 12 terminus HARDs this way on 2026-08-26 on a
     * sheet that was correct throughout. The default path refuses to run at all,
     * so nothing bad gets a PASS out of this; the override exists to let someone
     * see the other checks, and this keeps their count readable.
     */
    add(UNCURATED ? 'soft' : 'hard', 'terminus',
      UNCURATED
        ? `Route ${r}: terminus not checkable - this town's S1 is an unreviewed draft, so its declared termini (${vs.termini.join(', ')}) are GTFS stop names rather than settlements and can never match a chain-end locality (chain ends: ${[...endTokens].join(', ')}). An artefact of the draft, not a statement about the sheet. Do the S1 pass.`
        : `Route ${r}: neither declared terminus (${vs.termini.join(', ')}) appears at the ends of its full chain (chain ends: ${[...endTokens].join(', ')}).`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], uncuratedS1: !!UNCURATED, results }, r);
  } else if (nMatched < vs.termini.length) {
    add('soft', 'terminus',
      `Route ${r}: terminus name(s) not all confirmed at the chain ends — ${results.filter(x => !x.matched).map(x => x.terminus).join(', ')} (likely naming, chain ends: ${[...endTokens].join(', ')}).`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], results }, r);
  }
}

// S-5: direction sanity — the drawn edge stop heads toward the terminus
const dirUnavailable = [];
if (anchorLL) {
  for (const r of displayed) {
    if (CIRCULAR.has(r)) continue;
    const seq = intownByNorm(r);
    const fe = fullEntry(r);
    if (!seq || seq.length < 2 || !fe) continue;
    // Edge stop = the route's OUT-OF-TOWN continuation, i.e. a derive_intown BUFFER stop
    // (outside the town prefix / extraCore), not merely the farthest drawn stop. In an
    // elongated town the farthest drawn stop can be a core stop on the opposite side from
    // the exit: St Neots' 66 exits north via Little Paxton toward Huntingdon but its
    // farthest drawn stop is Eaton Socon, 2.35 km to the SOUTH-WEST — which read as
    // "drawn the wrong way" (175° out) when the map was entirely correct.
    const corePrefix = intownCfg.prefix || null;
    const extraCore = new Set(intownCfg.extraCore || []);
    const isCore = a => (corePrefix && a.startsWith(corePrefix)) || extraCore.has(a);
    const edgeCands = corePrefix ? seq.filter(a => !isCore(a)) : [];
    /*
     * THE CHECK NEEDS AT LEAST TWO BUFFER STOPS TO ASSERT ANYTHING (added 2026-08-27).
     *
     * The comment above explains at length why the farthest DRAWN stop is the wrong
     * choice. The line that used to stand here -- `edgeCands.length ? edgeCands : seq`
     * -- then fell straight back to that rejected behaviour whenever a route had NO
     * buffer stop, comparing an in-town stop's bearing against the terminus, which
     * asserts nothing at all. With exactly ONE buffer stop the selector has no choice
     * and returns it whichever way it points.
     *
     * On 2026-08-26 all four direction HARDs across seven towns (Huntingdon T1,
     * March 32, Ramsey 32, Ramsey X31) came from routes below this threshold, and
     * every one was wrong: Ramsey's 32 and X31 were called "drawn the wrong way" on
     * the strength of a single Bury stop 207 degrees south, on a sheet that correctly
     * draws both leaving north-east under "to March" and "to Peterborough". The only
     * two findings from routes where the selector had a genuine choice (St Ives 301
     * and 5A) were SOFT, and both were real.
     *
     * So say the check is unavailable, which is true, rather than manufacturing a
     * HARD. A route with two or more buffer stops still goes HARD exactly as before.
     */
    if (edgeCands.length < 2) {
      // ONE finding per town, not one per route. Wisbech draws no buffer stop on
      // seven of its eleven routes, and seven identical rows is the same "large
      // SOFT count" noise this fix exists to remove.
      dirUnavailable.push({ route: r, bufferStops: edgeCands.length, drawnStops: seq.length });
      continue;
    }
    let edge = null, edgeD = -1;
    for (const a of edgeCands) { if (!ll[a]) continue; const d = haversineKm(anchorLL, ll[a]); if (d > edgeD) { edgeD = d; edge = a; } }
    // A route can have TWO out-of-town ends (St Neots' 905: Cambridge east, Bedford
    // west; a two-arm route likewise). Comparing the drawn edge stop against only the
    // single farthest chain stop flagged 905 as "drawn the wrong way" when its edge stop
    // was correctly heading for the OTHER terminus. Compare against every chain end and
    // keep the closest match — a genuinely reversed route still misses them all.
    const termCands = [];
    for (const d of fullDirections(fe)) {
      for (const a of [d.stops[0], d.stops[d.stops.length - 1]]) {
        if (ll[a] && haversineKm(anchorLL, ll[a]) > 0.5) termCands.push(a);
      }
    }
    let term = null, termD = -1;
    for (const a of fullAllStops(fe)) { if (!ll[a]) continue; const d = haversineKm(anchorLL, ll[a]); if (d > termD) { termD = d; term = a; } }
    if (term && !termCands.includes(term)) termCands.push(term);
    if (!edge || !termCands.length || edgeD < 0.2) continue; // no meaningful buffer
    const bEdge = bearing(anchorLL, ll[edge]);
    let bTerm = null, diff = Infinity;
    for (const a of termCands) {
      const b = bearing(anchorLL, ll[a]), dd = angleDiff(bEdge, b);
      if (dd < diff) { diff = dd; bTerm = b; term = a; }
    }
    if (diff > 90) {
      add('hard', 'direction',
        `Route ${r} appears drawn the wrong way: its edge stop leaves town on bearing ${bEdge.toFixed(0)}° but the terminus lies at ${bTerm.toFixed(0)}° (${diff.toFixed(0)}° apart).`,
        { route: r, edge, edgeName: names[edge] || null, edgeBearing: +bEdge.toFixed(1), terminus: term, terminusName: names[term] || null, terminusBearing: +bTerm.toFixed(1), angleApart: +diff.toFixed(1) }, r);
    } else if (diff > 55) {
      add('soft', 'direction',
        `Route ${r}: edge stop bearing (${bEdge.toFixed(0)}°) is somewhat off the terminus bearing (${bTerm.toFixed(0)}°, ${diff.toFixed(0)}° apart) — check the drawn arm.`,
        { route: r, edge, edgeBearing: +bEdge.toFixed(1), terminusBearing: +bTerm.toFixed(1), angleApart: +diff.toFixed(1) }, r);
    }
  }
}

if (dirUnavailable.length) {
  if (!intownCfg.prefix) {
    /*
     * A PLACE has no intown_cfg.json at all, so there is no in-town ATCO prefix and
     * `isCore` can never be true -- the buffer-stop set is empty for every route on
     * every place, always has been, and the check has therefore only ever run in the
     * fallback mode its own comment rejects. Worth stating plainly, because
     * references/s6-verify.md cited St Neots Town Centre's route 66 as corroborated
     * by "two independent checks"; it was one real check (the red-team terminus,
     * which still fires) plus this one, which was structurally incapable of
     * disagreeing with anything.
     */
    add('soft', 'direction-unavailable',
      `Direction not checkable on any route: this build declares no in-town ATCO prefix (intown_cfg.json is absent, which is normal for a PLACE), so nothing distinguishes an out-of-town stop from an in-town one and the check has no edge stop to reason from. It is unavailable here by construction, not failing. The independent direction-ish signal for a place is the red-team terminus comparison.`,
      { routes: dirUnavailable, reason: 'no-intown-prefix', displayedRoutes: displayed.size }, null);
  } else {
    const none = dirUnavailable.filter(d => d.bufferStops === 0).map(d => d.route);
    const one  = dirUnavailable.filter(d => d.bufferStops === 1).map(d => d.route);
    const bits = [];
    if (none.length) bits.push(`${none.join(', ')} (no buffer stop drawn, so the check would compare an in-town stop against the terminus)`);
    if (one.length) bits.push(`${one.join(', ')} (one buffer stop, so the selector returns it whichever way it points)`);
    add('soft', 'direction-unavailable',
      `Direction not checkable on ${dirUnavailable.length} of ${displayed.size} displayed route${displayed.size === 1 ? '' : 's'}: ${bits.join('; ')}. The check needs at least two out-of-town buffer stops before the edge stop it picks means anything. Read those arms on _latest/internal.jpg instead — this is a limit of the check, not a fault in the sheet.`,
      { routes: dirUnavailable, needed: 2, displayedRoutes: displayed.size }, null);
  }
}

// S-6: complexity-ladder remedies assert things about the real world, so check
// what the generator measured about them. Both are SOFT: they are judgement
// calls a human signed off, not data errors — but a bundle whose members barely
// co-run, or a hue shared by unrelated corridors, makes the MAP say something
// false, which is exactly what S6 exists to surface. Absent file => no findings
// (a town with no corridorPalette / internalCorridors never writes one).
{
  const corr = readJSON('corridors_report.json', true);
  if (corr) {
    for (const fam of (corr.families || [])) {
      if (!fam.weakMembers || !fam.weakMembers.length) continue;
      const worst = (fam.members || []).filter(m => fam.weakMembers.includes(m.route));
      add('soft', 'weak-corridor-bundle',
        `internalCorridors bundles ${fam.routes.join('/')} as one drawn line, but ${fam.weakMembers.join(', ')} co-run with the family over less than ${Math.round((corr.sharedMin || 0.6) * 100)}% of their route. The rest draws as a second same-coloured line going elsewhere.`,
        { lead: fam.lead, routes: fam.routes, weak: fam.weakMembers,
          overlap: worst.map(m => `${m.route}=${m.sharedFraction}`) },
        fam.lead, 'corridors_report');
    }
    for (const cl of (corr.colourClashes || [])) {
      add('soft', 'colour-clash',
        `Colour ${cl.colour} is shared by unrelated corridor groups (${cl.groups.join(', ')}). With corridorPalette in force a reader reads one colour as one corridor, so this asserts a corridor that does not exist.`,
        { colour: cl.colour, groups: cl.groups }, null, 'corridors_report');
    }
    if (corr.colours && corr.colours.distinctColours > 12) {
      add('soft', 'palette-exhausted',
        `${corr.colours.drawnLines} lines are drawn in ${corr.colours.distinctColours} distinct colours (ambiguity ${corr.colours.ambiguity}x). The colour-blind-safe palettes hold about 12 usable hues, so colour no longer identifies a line.`,
        corr.colours, null, 'corridors_report');
    }
  }
}

// =====================================================================
// RED-TEAM DIFF (needs redteam.json)
// =====================================================================
if (redteam) {
  const rtServices = redteam.services || [];
  const rtExcluded = redteam.excluded || [];

  /*
   * PAIR the two sides on the route NUMBER, then tell same-numbered routes apart by
   * OPERATOR -- see the baseRoute comment above for why a plain number index
   * double-counted every branded route and mis-paired every duplicated one.
   *
   * Pass 1 pairs on operator-token overlap. Pass 2 pairs a single leftover on each
   * side, because that IS a disagreement about the operator and check (b) below is
   * the one that should say so. Anything still unpaired on their side is a genuine
   * `missing-service` candidate; anything unpaired on ours is `not-confirmed`.
   */
  function group(list, keyOf) {
    const m = new Map();
    for (const s of list) { const b = baseRoute(keyOf(s)); if (!m.has(b)) m.set(b, []); m.get(b).push(s); }
    return m;
  }
  /*
   * `lastResort` is TRUE for the red team's services[] and FALSE for its excluded[].
   *
   * In services[], a single leftover on each side is a disagreement about the
   * OPERATOR, and check (b) below is the one that should say so -- pairing them is
   * how that SOFT gets raised at all.
   *
   * In excluded[] it is the opposite, and pairing on a mismatched operator inverts
   * the red team's meaning. St Ives' red team excluded `5A (Peterborough)`,
   * Stagecoach East, whose own reason says in terms that the St Ives 5A is
   * STEPHENSONS and that a different Stagecoach 5A had taken over the bustimes URL.
   * A last-resort pairing turned that into "red-team says route 5A does NOT serve
   * the town, but we draw it" -- a HARD manufactured out of the red team telling us
   * we were right. An exclusion of a same-numbered route run by someone else is not
   * a statement about ours.
   *
   * Where either side names no operator there is nothing to reconcile on, so fall
   * back to exact key equality, which is what this code did before it could pair
   * at all.
   */
  function pairGroups(ours, theirs, lastResort) {
    const taken = new Set(), out = new Map();
    for (const o of ours) {
      const a = opTokens(o.operator);
      if (!a.length) continue;
      const i = theirs.findIndex((t, j) => !taken.has(j) && opTokens(t.operator).length && overlaps(a, opTokens(t.operator)));
      if (i >= 0) { taken.add(i); out.set(o, theirs[i]); }
    }
    // Nothing to reconcile on: one side named no operator. Exact key only.
    for (const o of ours) {
      if (out.has(o)) continue;
      const i = theirs.findIndex((t, j) => !taken.has(j)
        && (!opTokens(o.operator).length || !opTokens(t.operator).length)
        && normRoute(t.route) === normRoute(o.route));
      if (i >= 0) { taken.add(i); out.set(o, theirs[i]); }
    }
    if (lastResort) {
      const freeOurs = ours.filter(o => !out.has(o));
      const freeTheirs = theirs.filter((_, j) => !taken.has(j));
      if (freeOurs.length === 1 && freeTheirs.length === 1) out.set(freeOurs[0], freeTheirs[0]);
    }
    return out;
  }
  const ourGroups    = group(verified.services || [], s => s.route);
  const rtGroups     = group(rtServices, s => s.route);
  const rtExclGroups = group(rtExcluded, s => s.route);
  const pairedRt = new Map(), pairedExcl = new Map();
  for (const [base, ours] of ourGroups) {
    for (const [k, v] of pairGroups(ours, rtGroups.get(base) || [], true)) pairedRt.set(k, v);
    for (const [k, v] of pairGroups(ours, rtExclGroups.get(base) || [], false)) pairedExcl.set(k, v);
  }
  const rtConsumed = new Set([...pairedRt.values()]);

  // Sub-service aliases: a red-team-found "301S/301V/301X" maps to our parent
  // "301" if we model it as a variant/arm subService. Don't flag those as
  // missing — they're the same branded corridor.
  const aliasOf = {};                       // normRoute(sub) -> normRoute(parent)
  // `variants`/`arms` may be written as a single object {subServices,note} (the
  // schema example + St Neots) OR as an array of such groups — accept both.
  const asGroups = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? [x] : []);
  for (const vs of (verified.services || [])) {
    const parent = normRoute(vs.route);
    for (const grp of [...asGroups(vs.variants), ...asGroups(vs.arms)]) {
      for (const sub of (grp.subServices || [])) aliasOf[normRoute(sub)] = parent;
    }
  }
  // routes our own data marks as NOT serving the town (so we can flag the
  // inverse conflict: red-team says it DOES serve).
  const notServe = {};                      // normRoute -> entry
  for (const e of (verified.notOnLeaflet || [])) if (e.servesTown === false) notServe[normRoute(e.route)] = e;

  // for each of OUR verified/displayed services, diff against the red-team
  for (const vs of (verified.services || [])) {
    const r = ourKey(vs);
    const rt = pairedRt.get(vs) || null;
    const excl = pairedExcl.get(vs) || null;
    const isDisplayed = displayed.has(r);

    // (a) red-team says it does NOT serve the town, but we display/include it
    if ((excl && excl.servesTown === false) || (rt && rt.servesTown === false)) {
      const ev = excl || rt;
      if (isDisplayed || vs.servesTown) {
        add('hard', 'serves-town',
          `Red-team says route ${r} does NOT serve the town${ev.reason ? ' (' + ev.reason + ')' : ''}, but we include it${isDisplayed ? ' and draw it' : ''}.`,
          { route: r, ours: { servesTown: vs.servesTown, displayed: isDisplayed }, redteam: { servesTown: ev.servesTown, reason: ev.reason || null } }, r, 'redteam');
      }
      continue;
    }

    if (!rt) {
      // we have it; red-team didn't list it as serving (and didn't exclude it)
      if (vs.servesTown !== false) {
        add('soft', 'not-confirmed',
          `Route ${r} is in our verified set but the red-team did not independently confirm it serves the town.`,
          { route: r, ours: { operator: vs.operator, termini: vs.termini } }, r, 'redteam');
      }
      continue;
    }

    // (b) operator
    const oOurs = opTokens(vs.operator), oRt = opTokens(rt.operator);
    if (oOurs.length && oRt.length && !overlaps(oOurs, oRt)) {
      add('soft', 'operator',
        `Route ${r} operator differs: ours "${vs.operator}" vs red-team "${rt.operator}".`,
        { route: r, ours: vs.operator, redteam: rt.operator, confidence: rt.confidence || null, notes: rt.notes || null }, r, 'redteam');
    }

    // (c) termini (independent)
    if (Array.isArray(vs.termini) && Array.isArray(rt.termini) && rt.termini.length) {
      if (vs.terminiSource) {
        /*
         * PLACE. Our own "termini" are headsigns or landmarks and will never match a
         * settlement name, so comparing the two name lists is meaningless — it was
         * scoring HARD on every route (4 of St Neots Town Centre's 13, 2026-08-21).
         *
         * Compare the red-team's settlements against the LOCALITY CODES at the ends of
         * our drawn chain instead. That is a real assertion and it can still fail: the
         * red-team put route 66 at Fenstanton where our chain ends at Huntingdon.
         * It is not circular — the red-team is sourced blind, independently of BODS.
         */
        const feRt = fullEntry(r);
        const { endTokens: ends, untokenisedEnds: untok } = feRt
          ? chainEnds(feRt)
          : { endTokens: new Set(), untokenisedEnds: 0 };
        const res = rt.termini.map(t => ({
          terminus: t,
          matched: [...ends].some(et => nameMatchesLocality(t, et)),
        }));
        const nM = res.filter(x => x.matched).length;
        const unmatched = res.filter(x => !x.matched).map(x => x.terminus);
        if (nM === 0) {
          // Everything unmatched AND ends we cannot tokenise: nothing was actually
          // compared, so this is unverifiable, not a disagreement.
          add(untok ? 'soft' : 'hard', 'terminus',
            `Route ${r}: NEITHER red-team terminus (${rt.termini.join(', ')}) is a locality at the ends of our drawn chain (chain ends: ${[...ends].join(', ')}${untok ? `, plus ${untok} end(s) with no NaPTAN locality code` : ''}).`,
            { route: r, redteam: rt.termini, chainEndTokens: [...ends], untokenisedEnds: untok, ours: vs.termini, terminiSource: vs.terminiSource, results: res }, r, 'redteam');
        } else if (nM < rt.termini.length) {
          add('soft', 'terminus',
            `Route ${r}: red-team terminus ${unmatched.join(', ')} is not a locality at either end of our drawn chain (chain ends: ${[...ends].join(', ')}).`,
            { route: r, redteam: rt.termini, chainEndTokens: [...ends], untokenisedEnds: untok, ours: vs.termini, terminiSource: vs.terminiSource, results: res }, r, 'redteam');
        }
      } else {
        // TOWN. Both sides are hand-asserted settlement names, so compare them directly.
        const rtTokens = rt.termini.map(placeToken).filter(Boolean);
        const res = vs.termini.map(t => ({ terminus: t, matched: overlaps([placeToken(t)], rtTokens) || rt.termini.some(x => overlaps(tokenize(t), tokenize(x))) }));
        const nM = res.filter(x => x.matched).length;
        if (nM === 0) {
          // Same artefact as S-4 above, and NOT independent corroboration of it:
          // both sides read the same `termini` field. Five of Ramsey's twelve came
          // from here, and counting them as a second opinion is what made the
          // draft's noise look like agreement between two checks.
          add(UNCURATED ? 'soft' : 'hard', 'terminus',
            UNCURATED
              ? `Route ${r}: terminus not comparable - our termini (${vs.termini.join(', ')}) are GTFS stop names from an unreviewed S1 draft, so they cannot match the red team's settlements (${rt.termini.join(', ')}). This reads the same field S-4 does, so it is not a second opinion. Do the S1 pass.`
              : `Route ${r}: our termini (${vs.termini.join(', ')}) match NEITHER red-team terminus (${rt.termini.join(', ')}).`,
            { route: r, ours: vs.termini, redteam: rt.termini, uncuratedS1: !!UNCURATED }, r, 'redteam');
        } else if (nM < vs.termini.length) {
          add('soft', 'terminus',
            `Route ${r}: a terminus differs from the red-team — ours (${vs.termini.join(', ')}) vs red-team (${rt.termini.join(', ')}).`,
            { route: r, ours: vs.termini, redteam: rt.termini, results: res }, r, 'redteam');
        }
      }
    }

    // (d) days
    if (vs.days && rt.days && normDays(vs.days) !== normDays(rt.days)) {
      add('soft', 'days',
        `Route ${r} operating days differ: ours "${vs.days}" vs red-team "${rt.days}".`,
        { route: r, ours: vs.days, redteam: rt.days }, r, 'redteam');
    }
  }

  // (e) red-team found a town service we don't have (handle aliases + explicit exclusions)
  for (const rt of rtServices) {
    if (rt.servesTown === false) continue;
    if (rtConsumed.has(rt)) continue;       // already paired with one of ours above
    const r = baseRoute(rt.route);
    if (aliasOf[r]) {                       // it's a sub-service of one of ours
      add('soft', 'sub-service',
        `Red-team lists ${r} separately; we model it as a variant of ${aliasOf[r]} — confirm the variant routeing/days are captured.`,
        { route: r, parent: aliasOf[r], redteam: { termini: rt.termini, days: rt.days, notes: rt.notes || null } }, r, 'redteam');
      continue;
    }
    if (notServe[r]) {                      // WE say it doesn't serve town; red-team says it does
      add('soft', 'serves-town-conflict',
        `We list route ${r} as NOT serving the town (${notServe[r].note || notServe[r].reason || 'excluded'}), but the red-team finds it DOES${rt.notes ? ' — ' + rt.notes : ''}. Re-examine.`,
        { route: r, ours: { servesTown: false, note: notServe[r].note || notServe[r].reason || null }, redteam: { operator: rt.operator, termini: rt.termini, days: rt.days, confidence: rt.confidence || null, notes: rt.notes || null } }, r, 'redteam');
      continue;
    }
    add('soft', 'missing-service',
      `Red-team lists route ${r} (${rt.operator || '?'}) serving the town, but it is absent from our verified set — inclusion candidate.`,
      { route: r, redteam: { operator: rt.operator, termini: rt.termini, days: rt.days, confidence: rt.confidence || null, notes: rt.notes || null } }, r, 'redteam');
  }
}

// =====================================================================
// emit
// =====================================================================
const out = {
  town: routes.town || verified.town || 'this town',
  generatedAt: new Date().toISOString().slice(0, 16),
  redteamPresent: !!redteam,
  redteamSources: redteam ? (redteam.sourcesConsulted || []) : [],
  inputs: {
    verifiedOn: verified.verifiedOn || null,
    routesVersion: routes.version || null,
    displayedRoutes: [...displayed].sort(),
  },
  // An uncurated S1 cannot produce a verdict, only a partial one. Say so in the
  // file as well as on the console: `pass` would otherwise read true for a town
  // whose terminus checks were all downgraded because they could not run, and a
  // true in a JSON file outlives the console banner that qualified it.
  uncuratedS1: UNCURATED || null,
  summary: {
    checks: findings.length,
    hard: hard().length,
    soft: soft().length,
    pass: hard().length === 0 && !UNCURATED,
    verdict: UNCURATED ? 'not-verified-uncurated-s1' : (hard().length === 0 ? 'pass' : 'blocked'),
  },
  findings,
};
fs.writeFileSync(P('verification.json'), JSON.stringify(out, null, 2) + '\n');

// console summary
const bar = '─'.repeat(64);
console.log(bar);
console.log(`Verification — ${out.town}  (routes v${out.inputs.routesVersion || '?'}, S1 ${out.inputs.verifiedOn || '?'})`);
console.log(`Red-team: ${out.redteamPresent ? 'present' : 'ABSENT (sanity checks only)'}   Displayed: ${out.inputs.displayedRoutes.join(', ')}`);
console.log(bar);
if (!findings.length) console.log('  No findings — all checks clean.');
for (const sev of ['hard', 'soft']) {
  const fs2 = findings.filter(f => f.severity === sev);
  if (!fs2.length) continue;
  console.log(`\n${sev === 'hard' ? '■ HARD (blocks build)' : '□ soft (logged)'} — ${fs2.length}:`);
  for (const f of fs2) console.log(`  [${f.id}] ${f.category}${f.route ? ' ' + f.route : ''}: ${f.message}`);
}
console.log('\n' + bar);
if (UNCURATED) {
  console.log(`RESULT: NOT VERIFIED — uncurated S1  (${out.summary.hard} hard, ${out.summary.soft} soft)  → verification.json`);
  console.log('        The terminus checks could not run, so this is a PARTIAL result and');
  console.log('        NOT a pass. Do the S1 pass and re-run without VERIFY_ALLOW_UNCURATED.');
} else {
  console.log(`RESULT: ${out.summary.pass ? 'PASS ✓' : 'BLOCKED ✗'}  (${out.summary.hard} hard, ${out.summary.soft} soft)  → verification.json`);
}
console.log(bar);

// 3 = could not verify (uncurated S1), the same code the refusal above uses;
// 1 = verified and BLOCKED; 0 = verified and clean.
process.exit(UNCURATED ? 3 : (out.summary.pass ? 0 : 1));
