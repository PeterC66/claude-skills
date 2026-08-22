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
 *   routes.json             (S3)
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

// =====================================================================
// SANITY CHECKS (no red-team needed)
// =====================================================================

// S-1: every displayed route has full-chain data
for (const r of displayed) {
  const fe = fullEntry(r);
  const dirs = fullDirections(fe);
  if (!fe || dirs.length === 0) {
    add('hard', 'no-full-chain',
      `Displayed route ${r} has no full-chain data in routes_full_atco.json.`,
      { route: r, hasEntry: !!fe, directions: dirs.length }, r);
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

// S-4: routes_full termini align with S1 declared termini
const vsByRoute = {};
for (const s of (verified.services || [])) vsByRoute[normRoute(s.route)] = s;
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
  } else if (nMatched === 0 && untokenisedEnds) {
    add('soft', 'terminus',
      `Route ${r}: could not verify either declared terminus (${vs.termini.join(', ')}) — ${untokenisedEnds} chain end(s) are not NaPTAN locality-coded (cross-border stops), so there is nothing to match against. Confirm by hand.`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], untokenisedEnds, results }, r);
  } else if (nMatched === 0) {
    add('hard', 'terminus',
      `Route ${r}: neither declared terminus (${vs.termini.join(', ')}) appears at the ends of its full chain (chain ends: ${[...endTokens].join(', ')}).`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], results }, r);
  } else if (nMatched < vs.termini.length) {
    add('soft', 'terminus',
      `Route ${r}: terminus name(s) not all confirmed at the chain ends — ${results.filter(x => !x.matched).map(x => x.terminus).join(', ')} (likely naming, chain ends: ${[...endTokens].join(', ')}).`,
      { route: r, termini: vs.termini, chainEndTokens: [...endTokens], results }, r);
  }
}

// S-5: direction sanity — the drawn edge stop heads toward the terminus
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
    const cands = edgeCands.length ? edgeCands : seq;
    let edge = null, edgeD = -1;
    for (const a of cands) { if (!ll[a]) continue; const d = haversineKm(anchorLL, ll[a]); if (d > edgeD) { edgeD = d; edge = a; } }
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
  const rtByRoute = {};
  for (const s of rtServices) rtByRoute[normRoute(s.route)] = s;
  const rtExclByRoute = {};
  for (const s of rtExcluded) rtExclByRoute[normRoute(s.route)] = s;

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
    const r = normRoute(vs.route);
    const rt = rtByRoute[r];
    const excl = rtExclByRoute[r];
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
          add('hard', 'terminus',
            `Route ${r}: our termini (${vs.termini.join(', ')}) match NEITHER red-team terminus (${rt.termini.join(', ')}).`,
            { route: r, ours: vs.termini, redteam: rt.termini }, r, 'redteam');
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
    const r = normRoute(rt.route);
    if (vsByRoute[r]) continue;             // we already model it
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
  summary: {
    checks: findings.length,
    hard: hard().length,
    soft: soft().length,
    pass: hard().length === 0,
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
console.log(`RESULT: ${out.summary.pass ? 'PASS ✓' : 'BLOCKED ✗'}  (${out.summary.hard} hard, ${out.summary.soft} soft)  → verification.json`);
console.log(bar);

process.exit(out.summary.pass ? 0 : 1);
