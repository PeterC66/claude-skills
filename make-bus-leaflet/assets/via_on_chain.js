'use strict';
/*
 * via_on_chain.js — does every place the sheet says a route goes THROUGH lie on
 * that route's own chain? (buses-data OA-631 part 2, 2026-10-12.)
 *
 * WHY. Huntingdon's sheet said route 9 runs "via Hartford & Wyton" — in the
 * Services panel (`internalDesc["9"]`) and on the external spoke
 * (`external[].stops`) — for every S3 run from the first, 2026-06-07, to v6.0.
 * It runs Godmanchester and the Hemingfords; Hartford and Wyton are the 303's
 * road. The red team had written the right answer on 2026-08-04, but S6 scored
 * only route, termini, days and servesTown, and the direction check reads
 * bearings: St Ives lies on the same bearing either way. Nothing read the places
 * in between, so nothing could have said so.
 *
 * WHAT. For each displayed route, every name in its spoke's `stops[]` and every
 * place after "via" in its Services-panel text is compared against the NaPTAN
 * localities of the stops on that route's S2 chain (routes_full_atco.json).
 *   - on the chain                                         -> nothing
 *   - not on the chain, and the name IS a register locality -> HARD (offChain)
 *   - not on the chain, and the register does not know it   -> unverifiable
 *     ("the Busway", "Addenbrooke's", "RAF Alconbury" are not localities)
 *
 * PER STOP, NOT PER TOKEN, AND THAT IS THE WHOLE POINT. verify_report.js's
 * terminus lookup keys the register by the four-letter token in a Cambridgeshire
 * ATCO code, and the register files 39 Hartford stops under 0500HHUNT…: token
 * HUNT carries the names Huntingdon AND Hartford. Route 9 calls at two HUNT
 * stops (the bus station), so a token-level match passes "via Hartford" and
 * v6.0 stays green. Each chain stop's OWN LocalityName (and its parent) is read
 * by its ATCO code instead, which also works for numeric codes (Buckinghamshire)
 * that yield no token at all.
 *
 * MATCHING IS DELIBERATELY LOOSE, because a false green is the safe direction
 * and a false HARD is the one that gets a gate muted: "Hemingfords" matches
 * Hemingford Grey, "Alconbury" matches Alconbury Weston, a parent locality
 * counts (Eynesbury's stops carry St Neots). Only a name the register knows
 * EXACTLY can go HARD.
 *
 * THE REGISTER IS GITIGNORED AND CI'S NODE HAS NO node:sqlite, so in CI this
 * returns `notRun` and raises nothing HARD. tools/prove-s6-checks.js section 23
 * builds its own register to prove both arms.
 */
const fs = require('fs');

/* NOT YET A GATE. Run across the estate on 2026-10-12 it raised 24 off-chain
 * places on 8 maps besides Huntingdon's route 9 — some look like real sheet
 * errors, some like places an express passes without stopping — and none has
 * been ruled on. Until they are, an off-chain place is SOFT: reported on every
 * S6, blocking none. Flipping this to true is the gate, and it is buses-data
 * OA-636's to flip once each of those findings has an answer. */
const GATES = false;

function normPlace(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .trim()
    .replace(/^the /, '');
}

// Does sheet name `name` denote register locality `loc`? Equal, a whole-word
// prefix either way, or a plural ("the Hemingfords") of one.
function samePlace(name, loc) {
  const a = normPlace(name), b = normPlace(loc);
  if (!a || !b) return false;
  if (a === b || b.startsWith(a + ' ') || a.startsWith(b + ' ')) return true;
  if (a.length > 4 && a.endsWith('s')) {
    const s = a.slice(0, -1);
    return b === s || b.startsWith(s + ' ');
  }
  return false;
}

// The places after "via" in a Services-panel string. Segments are split on the
// panel's own "·"; a list is split on commas, "&", "and" and "/".
function viaPlaces(text) {
  const out = [];
  // A bracket qualifies ("(busway)", "(some via Gransden)"); it names no stop of its own.
  for (const seg of String(text || '').replace(/\([^)]*\)/g, ' ').split('·')) {
    const m = seg.match(/\bvia\s+(.+)$/i);
    if (!m) continue;
    for (let p of m[1].split(/\s*(?:,|&|\/|\band\b)\s*/i)) {
      p = p.trim().replace(/^the\s+/i, '');
      if (p && /^[A-Z0-9]/.test(p)) out.push(p);
    }
  }
  return out;
}

/* Open the DfT register read-only and answer the two questions this check asks.
 * Returns null when there is no register or no node:sqlite — the caller reports
 * that rather than passing it off as a clean result. */
function openRegister(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  let db;
  try {
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => {
      const s = typeof w === 'string' ? w : (w && w.message) || '';
      if (/SQLite is an experimental feature/.test(s)) return;
      return emit.call(process, w, ...rest);
    };
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } finally { process.emitWarning = emit; }
    db = new DatabaseSync(dbPath, { readOnly: true });
    const one = db.prepare('select LocalityName, ParentLocalityName from naptan where ATCOCode = ?');
    const known = new Set();
    for (const r of db.prepare('select distinct LocalityName from naptan').all()) if (r.LocalityName) known.add(normPlace(r.LocalityName));
    const cache = new Map();
    return {
      localitiesOf(atco) {
        if (!cache.has(atco)) {
          const r = one.get(String(atco));
          cache.set(atco, r ? [r.LocalityName, r.ParentLocalityName].filter(Boolean) : []);
        }
        return cache.get(atco);
      },
      isLocality(name) {
        const a = normPlace(name);
        return known.has(a) || (a.length > 4 && a.endsWith('s') && known.has(a.slice(0, -1)));
      },
    };
  } catch { return null; }
}

/*
 * routes    routes.json (external[], internalDesc{})
 * displayed Set of normalised displayed route keys
 * norm      route-key normaliser (redteam_agree.normRoute)
 * chainOf   route key -> array of ATCO codes on its S2 chain, or null
 * register  openRegister(...) or null
 */
function viaOnChain({ routes, displayed, norm, chainOf, register }) {
  const claims = [];                       // { route, routes[], where, name }
  (routes.external || []).forEach((sp, i) => {
    const rs = (Array.isArray(sp.routes) && sp.routes.length ? sp.routes : [sp.route]).filter(Boolean).map(String);
    // The spoke's own destination is a TERMINUS, which the terminus check owns; a chain
    // cut at the region edge (904 to Peterborough) would otherwise go HARD here too.
    for (const name of (sp.stops || []).filter(n => !samePlace(n, sp.label || ''))) claims.push({ route: String(sp.route || rs[0]), routes: rs, where: `external[${i}].stops`, name: String(name) });
  });
  for (const [r, v] of Object.entries(routes.internalDesc || {})) {
    for (const s of [].concat(v)) for (const name of viaPlaces(s)) claims.push({ route: r, routes: [r], where: `internalDesc["${r}"]`, name });
  }
  const mine = claims.filter(c => c.routes.some(r => displayed.has(norm(r))));
  const severity = GATES ? 'hard' : 'soft';
  if (!register) return { severity, notRun: mine.length ? 'no NaPTAN register on this machine (or no node:sqlite)' : null, offChain: [], unverifiable: [], checked: 0 };

  const offChain = [], unverifiable = [];
  let checked = 0;
  for (const c of mine) {
    const stops = c.routes.flatMap(r => chainOf(r) || []);
    if (!stops.length) continue;           // no chain: no-full-chain already reports it
    const locs = [...new Set(stops.flatMap(a => register.localitiesOf(a)))];
    if (!locs.length) { unverifiable.push({ ...c, why: 'no stop on the chain is in the register' }); continue; }
    checked++;
    if (locs.some(l => samePlace(c.name, l))) continue;
    if (register.isLocality(c.name)) offChain.push({ ...c, chainLocalities: locs.sort() });
    else unverifiable.push({ ...c, why: 'not a NaPTAN locality name' });
  }
  return { severity, notRun: null, offChain, unverifiable, checked };
}

module.exports = { viaOnChain, viaPlaces, samePlace, normPlace, openRegister, GATES };
