/*
 * s1_unhoused.mjs — the `s1-unhoused-<map>` row: a map whose newest S4 ships a service
 * S1 decided in with no home on the sheet (buses-data OA-655, 2026-10-22).
 *
 * WHY A ROW. Since claude-skills #402 S4 asks make-bus-leaflet's s1_drawn_check.js
 * whether every service in the newest S1 has a home — `routeOrder`, `panelOrder`,
 * `notShown`, or `notOnLeaflet[]` — and refuses a build that MADE a gap. A gap the
 * published sheet already shipped only WARNS, so the refresh of a map is not refused
 * for something it did not do. Read on 2026-10-21, 13 maps ship 26 such services, and
 * a WARN line in a build log is read by nobody once the build is committed. This is
 * the OA-430 shape for that debt: one row per map, computed from the map's own newest
 * S4, gone when an S4 built from a new S3 houses every service.
 *
 * THE VERDICT IS THE ENGINE'S. The row calls s1DrawnCheck() itself rather than a copy
 * of its rules, so a home it learns to see reaches this board unchanged. A map the
 * check cannot read (a place whose S1 holds place.json and no services file) gives no
 * row, exactly as its S4 says "not checked".
 *
 * RIDES WITH THE NEXT REBUILD, AND NOT A TICK'S. Writing a home is an S3, and a new S3
 * re-arms the map's S6 limit, so a row paid for on its own buys a verification for a
 * line the sheet does not draw. The loop takes only the row kinds its prompt names, and
 * this is not one.
 *
 * PURE CORE. `s1UnhousedItems()` takes the check as an argument, so
 * prove-red-s1-unhoused.mjs drives every branch with objects; `readS1Check` below is
 * the only I/O.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const label = (s) => (s.key && s.key !== s.route ? `${s.route} (key ${s.key})` : String(s.route));

/**
 * @param {object} p
 * @param {Array<{name, built, dir, s4Dir}>} p.towns          worklist tree rows
 * @param {Array<{name, town, built, dir, s4Dir}>} [p.places]  the same for place maps; town is null when standalone
 * @param {(row) => {id, fresh[], shipped[], notRun}|null} p.check  s1DrawnCheck on the row's newest S4
 * @param {string} [p.sk]                                      the engine's assets folder, for the command
 * @returns {object[]} the rows
 */
export function s1UnhousedItems({ towns, places = [], check, sk = '' }) {
  const items = [];
  const maps = (towns || []).map((t) => ({ m: t, place: false })).concat((places || []).map((p) => ({ m: p, place: true })));
  for (const { m, place } of maps) {
    if (!m.built || !m.s4Dir) continue;
    const r = check(m);
    if (!r || r.notRun) continue;
    const fresh = r.fresh || [], shipped = r.shipped || [];
    const n = fresh.length + shipped.length;
    if (!n) continue;
    items.push({
      key: `s1-unhoused-${m.name}`, rank: 8, type: 'housekeeping',
      title: `${m.name} ships ${n} S1 service${n === 1 ? '' : 's'} with no home on the sheet (OA-655)`,
      why: `Its newest S4 leaves ${fresh.concat(shipped).map(label).join(', ')} in none of routeOrder, panelOrder or notShown, and not in notOnLeaflet[]. That S4 is "${m.s4Dir}".`
        + (fresh.length ? ` ${fresh.length} of them ${fresh.length === 1 ? 'was' : 'were'} not on the published sheet either way, so the next S4 refuses until ${fresh.length === 1 ? 'it has' : 'they have'} a home.` : ' The published sheet shipped that way, so S4 warns and does not refuse.')
        + ' Write each home in the map\'s next S3; an S3 for this alone re-arms the S6 limit.',
      who: 'a session, at the map\'s next rebuild', runbook: 'S3', towns: [place ? (m.town || m.name) : m.name],
      do: [
        { kind: 'shell', cwd: sk, cmd: 'node s1_drawn_check.js --dir "<S4 folder>"', note: '<S4 folder> is the absolute path the why names; read-only; one line per service with its remedy; exit 1 when a gap is new' },
        { kind: 'skill', what: 'In the next S3, give each service a home: add it to routeOrder if the sheet should draw it, declare it notShown for a Services row with no line, or record it in notOnLeaflet[] with a reason — for a Dial-a-Ride or Tiger on Demand a mapNotes line already carries, a notOnLeaflet[] entry saying the note carries it.' },
      ],
    });
  }
  return items;
}

/** s1DrawnCheck bound to a row's newest S4, or a warning when the engine file cannot be loaded. */
export function readS1Check(sk) {
  const f = sk ? path.join(sk, 's1_drawn_check.js') : null;
  if (!f || !existsSync(f)) return { check: () => null, warning: 's1-unhoused rows not read: make-bus-leaflet/assets/s1_drawn_check.js not found beside the engine, so the check is blind, not clean (OA-655).' };
  const { s1DrawnCheck } = createRequire(import.meta.url)(f);
  return {
    check: (row) => s1DrawnCheck({ dir: row.s4Dir }),
    warning: null,
  };
}
