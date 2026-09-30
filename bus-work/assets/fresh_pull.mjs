/*
 * fresh_pull.mjs — the `fresh-pull-<town>` row: a town whose stored landmark pull
 * does not ask today's landmark question (buses-data OA-499 item 1, 2026-09-30).
 *
 * WHY A ROW. OA-500 (2026-09-28) widened the landmark query that `draft_town.py`'s
 * `pois_query()` sends to Overpass — pubs, cinemas, colleges, post offices, stations
 * — and changed no stored pull. A rebuild reads the stored S2 and fetches nothing, so
 * a map rebuilt from an old pull draws only what that pull happened to hold, and
 * every gate on the board is green about it. `repull_landmarks.py` (claude-skills
 * #224) is the step that fixes it; this row is what says which towns owe it.
 *
 * WHY A SESSION ROW AND NOT A ROLLOUT MODE (OA-499 item 1, decided 2026-09-29). A
 * landmarks-only rollout gates on "no lost label", which the first March build
 * passed while worse. After a pull, `rollout.js` refuses STALE-INPUTS, so the
 * rebuild is the stage order — S2, S3, a new S4, crops judged by someone looking.
 *
 * HOW "TODAY'S QUESTION" IS KNOWN. From the SOURCE of `pois_query()` in
 * draft_town.py, not from a date and not from a copy here. A date would go stale
 * at the next category change and a copy would be the shape *The second reader of
 * a shape the engine already knew*. Each selector line is split into tokens —
 * `node amenity=pub`, one per value of a `~"^(a|b)$"` alternation — and the town's
 * latest S2 `overpass-pois.txt` (the query that run actually sent, box and all) is
 * split the same way. A token the current query has and the recorded one lacks is
 * owed. A run that recorded no query cannot show it asked anything, so it owes all.
 * The next time the query widens, every town lights up again with no edit here.
 *
 * IT FAILS LOUD, NOT EMPTY. If draft_town.py cannot be read or yields no selector,
 * the result carries a warning and no rows: an empty list from a parser that broke
 * would read as "every town is fresh", the green that could never go red.
 *
 * PLACES TOO, SINCE OA-499 ITEM 2 (2026-09-30). A place's first pull is a bbox MCP
 * search that records no query, so it was thought a different question and the
 * tool refused one. It is the same question over the place's own box — Ely Co-op's
 * rebuild asked `pois_query()` over its old extent by hand — so `repull_landmarks.py
 * --place` now asks it, and a place gets `fresh-pull-<place>` exactly as a town
 * does. A place whose latest S2 holds no `osm.json` has no pull to replace, and the
 * tool refuses it, so it gets no row rather than a command that refuses.
 *
 * PURE CORE. `freshPullItems()` takes the query texts as arguments, so
 * prove-red-fresh-pull.mjs drives every branch with strings; the two readers below
 * it are the only I/O, and the harness asserts the wire in worklist.mjs by source.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// `node["amenity"~"^(pub|cafe)$"](52.1,0.1,52.2,0.2);` or the f-string's `({box})`,
// and the bbox MCP's shape a place records, `nwr["amenity"~"^(pub)$"];`, whose box is
// the tool's argument rather than part of the line (Godmanchester, 2026-09-30).
const SEL = /^\s*(node|way|relation|nwr)((?:\[[^\]]*\])+)\s*[(;]/;
const COND = /\["([^"]+)"\s*(=|~)\s*"([^"]*)"\]/g;

// No place generator draws an OpenStreetMap bus stop — a place's stops come from
// GTFS and NaPTAN — so a place pull that left them out has not missed anything, and
// both Godmanchester places left them out on purpose (OA-499 item 2).
const PLACE_INERT = new Set(['node highway=bus_stop']);

/** Every token a query asks for: `<type> <key>=<value>`, one per alternation value. */
export function queryTokens(text) {
  const out = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const hit = SEL.exec(line);
    if (!hit) continue;
    // nwr is node, way and relation in one line: expand it so it matches either.
    if (hit[1] === 'nwr') {
      for (const t of ['node', 'way', 'relation']) for (const k of queryTokens(`${t}${hit[2]};`)) out.add(k);
      continue;
    }
    const m = hit;
    const conds = [...m[2].matchAll(COND)];
    // A selector with a shape this does not parse is kept whole rather than
    // dropped, so a new kind of line in pois_query() still has to be matched.
    if (!conds.length) { out.add(`${m[1]} ${m[2]}`); continue; }
    // pois_query() has one condition per line; with more, the line is one token
    // made of all of them, so a narrowing condition is still a difference.
    if (conds.length > 1) { out.add(`${m[1]} ${conds.map((c) => c[0]).join('')}`); continue; }
    const [, key, op, val] = conds[0];
    const vals = op === '~' ? val.replace(/^\^\(?/, '').replace(/\)?\$$/, '').split('|') : [val];
    for (const v of vals) out.add(`${m[1]} ${key}=${v}`);
  }
  return out;
}

/** The body of `def pois_query` in draft_town.py, or null. */
export function poisQuerySource(pyText) {
  // To the next top-level def, not the next unindented line: the f-string's own
  // `(` and `)` sit in column 0.
  const m = /def pois_query\([^)]*\):([\s\S]*?)(?:\ndef |$)/.exec(String(pyText || ''));
  return m ? m[1] : null;
}

/**
 * @param {object} p
 * @param {Array<{name, built, s2}>} p.towns  worklist tree rows; s2 = {id, dir} of the latest S2 run
 * @param {Array<{name, town, built, s2}>} [p.places]  the same for place maps; s2 also carries hasPois
 * @param {string|null} p.currentQuery        pois_query()'s source, or null if unreadable
 * @param {(town) => string|null} p.readRecorded  the latest S2's overpass-pois.txt, or null
 * @param {string} [p.sk]                     the engine's assets folder, for the commands
 * @returns {{items: object[], owed: Set<string>, warning: string|null}}
 */
export function freshPullItems({ towns, places = [], currentQuery, readRecorded, sk = '' }) {
  const current = queryTokens(currentQuery);
  if (!current.size) {
    return { items: [], owed: new Set(), warning: 'fresh-pull rows skipped: no selector could be read from pois_query() in draft_town.py — the check is blind, not clean (OA-499).' };
  }
  const items = [];
  const owed = new Set();
  const maps = (towns || []).map((t) => ({ t, place: false }))
    .concat((places || []).filter((p) => p.s2 && p.s2.hasPois !== false).map((t) => ({ t, place: true })));
  for (const { t, place } of maps) {
    if (!t.built || !t.s2) continue;
    const text = readRecorded(t);
    const have = queryTokens(text);
    const missing = [...current].filter((k) => !have.has(k) && !(place && PLACE_INERT.has(k)));
    if (!missing.length) continue;
    owed.add(t.name);
    // Name what is missing by tag, once, whatever element types it was asked on.
    const tags = [...new Set(missing.map((k) => k.replace(/^\S+ /, '')))];
    const shown = tags.length > 8 ? `${tags.slice(0, 8).join(', ')} and ${tags.length - 8} more` : tags.join(', ');
    const sel = `${place ? '--place' : '--town'} "${t.name}"`;
    items.push({
      key: `fresh-pull-${t.name}`, rank: 8, type: 'housekeeping',
      title: `${t.name}'s landmark pull does not ask today's landmark question`,
      why: (text == null
        ? `Its latest S2 (${t.s2.id}) recorded no overpass-pois.txt, so nothing shows it asked for today's categories.`
        : `Its latest S2 (${t.s2.id}) asked Overpass without ${shown}.`)
        + ' A rebuild reads the stored pull and fetches nothing, so it would draw only what that pull holds.'
        + ' Not for a map whose sheet is with a local reviewer: a pull there changes the sheet under their answer (OA-499).',
      who: '—', runbook: 'S2', towns: [place ? (t.town || t.name) : t.name],
      do: [
        { kind: 'shell', cwd: sk, cmd: `python repull_landmarks.py ${sel}`, note: 'dry run — asks Overpass (a read), prints what would change, writes nothing' },
        { kind: 'shell', cwd: sk, cmd: `python repull_landmarks.py ${sel} --apply --by <who>`, note: 'writes the new S2 run through stage.js; <who> is sched-HHMM for a tick, the session name otherwise' },
        { kind: 'skill', what: place
          ? `Then rebuild ${t.name} in stage order through make-place-bus-leaflet — pull P3, a new P4, and judge the crops. rollout_places.js reads the stored S2 and fetches nothing, so it is not the way the new landmarks reach the sheet.`
          : `Then rebuild ${t.name} in stage order through make-bus-leaflet — pull S3, a new S4, and judge the crops. rollout.js refuses STALE-INPUTS after a pull, and a landmarks-only rollout gates only on no lost label, which March passed while worse.` },
      ],
    });
  }
  return { items, owed, warning: null };
}

/**
 * The `s2` a worklist tree row carries, from gate_lib's latestRunDir() answer:
 * {id, dir, hasPois} or null. hasPois, because an S2 with no osm.json has no pull
 * to replace and repull_landmarks.py refuses it. Here rather than in worklist.mjs,
 * which the line ratchet holds at its ceiling.
 */
export function s2Row(s2) {
  return s2 ? { id: s2.rec.id, dir: s2.dir, hasPois: existsSync(path.join(s2.dir, 'osm.json')) } : null;
}

/** pois_query()'s source from the engine folder, or null. */
export function readCurrentQuery(sk) {
  const f = sk ? path.join(sk, 'draft_town.py') : null;
  if (!f || !existsSync(f)) return null;
  try { return poisQuerySource(readFileSync(f, 'utf8')); } catch { return null; }
}

/** The query a town's latest S2 run sent, or null when it recorded none. */
export function readRecordedQuery(town) {
  const f = town && town.s2 && path.join(town.s2.dir, 'overpass-pois.txt');
  if (!f || !existsSync(f)) return null;
  try { return readFileSync(f, 'utf8'); } catch { return null; }
}
