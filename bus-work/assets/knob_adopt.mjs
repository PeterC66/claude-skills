/*
 * knob_adopt.mjs — the `adopt-knobs-<map>` row: a map whose newest S3 still types a
 * position or a demand-responsive line the engine now works out for itself
 * (buses-data OA-437, the adoption half, 2026-10-13).
 *
 * WHY A ROW. OA-437 taught the engine to place a map note by search (note_place.js),
 * to fit the external legend (design.legendFit) and the help panel (design.howToUse.fit),
 * to derive the badge offset, and to print the register's demand-responsive lines
 * (fact_notes.js). All of it is byte-inert: a key that is TYPED is still obeyed, and
 * nothing in the rebuild path strips one — rollout.js re-renders the S3 it is given. So
 * the engine half went live on 2026-10-12 and no map drew any of it, and nothing on the
 * board said which maps owed what. This is the OA-430 shape for that debt: one row per
 * map, computed from the map's own newest S3, gone when that S3 no longer carries it.
 *
 * WHAT IS OWED, read off the newest S3 `routes.json` and nothing else:
 *   - a top-level `mapNotes` entry with an `x` or a `y`, no `at` and no `handPlaced` (its `w`
 *     goes with it; a stop-anchored note is a fact about a stop, not a guess about clear ground);
 *   - `legendAt`, `legendWrap`, `design.howToUse.width`, `badgeOffset`, `externalNoteAt`
 *     (no reader in either engine, found 2026-10-11) — present at all;
 *   - `design.howToUse.bullets` — eight of nine stored lists were the default three
 *     verbatim when the default became three (OA-443), so the row says drop them unless
 *     they are the map's own words;
 *   - an in-scope demand-responsive fact that `fact_notes.js`'s own check says is not
 *     carried as a tagged paragraph matching the register.
 * NOT owed: `panelCols.keyAt` and `keyCols`, whose engine half is not built (OA-437 "Left:
 * A1 engine"), and anything under `parked.`, which no generator draws.
 *
 * `handPlaced: "<why>"` ON A NOTE IS A DECISION, NOT A DEBT (OA-437, decided by Peter
 * 2026-10-15). The search covers the map frame only, so a note in the title band or a
 * margin the frame does not reach can never be placed by it, and a note the author put
 * on ground the search's stricter ink test refuses is the author's call. Ely Co-op's six
 * notes are both: draft claude-skills #370 showed no scoring reaches them, and v1.34's
 * searched layout was rejected. The reason must be a non-empty string, so the S3 says
 * WHY the coordinate is typed. The generator ignores the key, so adding it moves no ink.
 *
 * NOT A TICK'S. The loop takes only the row kinds its prompt names, and this is not one:
 * a re-placed note or legend is a new layout, and someone looks at it against the
 * previous version before it is accepted.
 *
 * IT FAILS LOUD, NOT EMPTY. A register or fact_notes.js that cannot be read gives a
 * warning and no demand-responsive verdicts, never "every map carries its facts".
 *
 * PURE CORE. `knobAdoptItems()` takes the S3 reader and the register as arguments, so
 * prove-red-knob-adopt.mjs drives every branch with objects; `readLatestS3` and
 * `readKnobInputs` below are the only I/O.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const TOP = ['legendAt', 'legendWrap', 'badgeOffset', 'externalNoteAt'];
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const decided = (n) => typeof n.handPlaced === 'string' && n.handPlaced.trim() !== '';

/** What one routes.json owes, as { typedNotes, keys[], unsets[], bullets, facts[] }. */
export function knobsOwed(routes, { name, register = null, checkConfig = null } = {}) {
  const r = routes || {};
  const notes = Array.isArray(r.mapNotes) ? r.mapNotes : [];
  const typedNotes = notes.filter((n) => n && typeof n === 'object' && !has(n, 'at') && !decided(n) && (has(n, 'x') || has(n, 'y'))).length;
  const keys = TOP.filter((k) => has(r, k));
  const how = r.design && typeof r.design.howToUse === 'object' ? r.design.howToUse : null;
  if (has(how, 'width')) keys.push('design.howToUse.width');
  const bullets = !!(how && Array.isArray(how.bullets) && how.bullets.length);
  const facts = register && checkConfig ? checkConfig(r, register, name) : [];
  return { typedNotes, keys, unsets: keys.concat(bullets ? ['design.howToUse.bullets'] : []), bullets, facts };
}

/**
 * @param {object} p
 * @param {Array<{name, built, dir}>} p.towns        worklist tree rows
 * @param {Array<{name, town, built, dir}>} [p.places]  the same for place maps; town is null when standalone
 * @param {(row) => {id, routes}|null} p.readS3       the newest S3 run's id and routes.json
 * @param {object|null} p.register                     service-facts.json, or null if unreadable
 * @param {Function|null} p.checkConfig                fact_notes.js's checkConfig, or null
 * @param {string} [p.sk]                              the engine's assets folder, for the commands
 * @param {string} [p.buses]                           the buses-data root, for the register path
 * @returns {{items: object[], warning: string|null}}
 */
export function knobAdoptItems({ towns, places = [], readS3, register, checkConfig, sk = '', buses = '' }) {
  const blind = !register || !checkConfig;
  const items = [];
  const maps = (towns || []).map((t) => ({ m: t, place: false })).concat((places || []).map((p) => ({ m: p, place: true })));
  for (const { m, place } of maps) {
    if (!m.built) continue;
    const s3 = readS3(m);
    if (!s3 || !s3.routes) continue;
    const o = knobsOwed(s3.routes, { name: m.name, register: blind ? null : register, checkConfig: blind ? null : checkConfig });
    if (!o.typedNotes && !o.unsets.length && !o.facts.length) continue;
    const said = [];
    if (o.typedNotes) said.push(`${o.typedNotes} mapNotes ${o.typedNotes === 1 ? 'entry' : 'entries'} placed by a typed x/y`);
    if (o.keys.length) said.push(o.keys.join(', '));
    if (o.bullets) said.push('typed design.howToUse.bullets');
    if (o.facts.length) said.push(`hand-typed demand-responsive lines (${o.facts.length} fact${o.facts.length === 1 ? '' : 's'} not carried as the register's tagged block)`);
    const sel = `${place ? '--place' : '--town'} "${m.name}"`;
    const facts = path.join(buses || '<buses-data>', 'service-facts.json');
    const set = o.typedNotes || o.facts.length ? ' --set-file "<notes.json>"' : '';
    const unset = o.unsets.map((k) => ` --unset ${k}`).join('');
    const tool = place ? 'rollout_places.js' : 'rollout.js';
    items.push({
      key: `adopt-knobs-${m.name}`, rank: 8, type: 'housekeeping',
      title: `${m.name} still types a layout the engine now places itself (OA-437)`,
      why: `Its newest S3 (${s3.id}) carries ${said.join('; ')}. The engine finds clear ground for each of these since OA-437 (live 2026-10-12), but a typed value is still obeyed and no rebuild strips it, so this map draws today's placement only once a new S3 drops them.`
        + ' Not a tick\'s: the re-placed layout is compared with the previous version by someone looking before it is accepted. Not for a map whose sheet is with a local reviewer: it changes the sheet under their answer.',
      who: 'a session, with someone to look at the result', runbook: 'S3', towns: [place ? (m.town || m.name) : m.name],
      do: [
        ...(o.facts.length ? [{ kind: 'shell', cwd: sk, cmd: `node fact_notes.js --name "${m.name}" --facts "${facts}"`, note: 'prints the register\'s demand-responsive block, which replaces the hand-typed lines; read-only' }] : []),
        ...(set ? [{ kind: 'skill', what: 'Write the new top-level mapNotes to a UTF-8 file as {"mapNotes":[...]} — the whole array, because --set-file replaces an array. Keep every note\'s words; drop x, y and w from each note with no `at` (a `near` {x,y} hint may say roughly where), or, where the search cannot reach the spot (the title band, a margin outside the map frame), keep them and add `handPlaced: "<why>"`; put the block above in place of the hand-typed demand-responsive lines (a sheet may still override one, OA-004). <notes.json> below is that file\'s path.' }] : []),
        { kind: 'shell', cwd: sk, cmd: `node adopt_config.js ${sel}${set}${unset}`, note: 'dry run — prints the routes.json change and writes nothing' + (o.bullets ? '; drop the --unset of design.howToUse.bullets if they are the map\'s own words rather than the default three' : '') },
        { kind: 'shell', cwd: sk, cmd: `node adopt_config.js ${sel}${set}${unset} --apply --by <who> --note "OA-437 adoption: the engine places these"`, note: '<who> is the session\'s name; opens and commits the new S3' },
        { kind: 'shell', cwd: sk, cmd: `node ${tool} ${sel} --apply --commit --note "OA-437 adoption"`, note: 'builds a new S4 and S5 from that S3 and commits the map by pathspec; never pushes' },
        { kind: 'skill', what: `Before accepting, compare the new sheets with the previous version: node crop_compare.js <previous S4 svg> <new S4 svg> <out-prefix> --diff 3, for the internal and the external sheet, and look at where each note, legend and help panel landed. Then enrol ${m.name} in the month's ink review (ink_review.mjs --scan <scan date> ${place ? '--place' : '--town'} "${m.name}"), which is the gate before delivery — never deliver it unaccepted.` },
      ],
    });
  }
  return { items, warning: blind ? 'adopt-knobs rows read without the demand-responsive check: service-facts.json or fact_notes.js could not be read, so the check is blind, not clean (OA-437).' : null };
}

/** The newest S3 run of a map, as { id, routes }, or null. Reads the map's own manifest. */
export function readLatestS3(row) {
  try {
    const m = JSON.parse(readFileSync(path.join(row.dir, 'manifest.json'), 'utf8'));
    const s = m.stages && m.stages.S3;
    const run = s && s.runs && s.runs.find((r) => r.id === s.latest);
    const f = run && path.join(row.dir, run.dir, 'routes.json');
    return f && existsSync(f) ? { id: run.id, routes: JSON.parse(readFileSync(f, 'utf8')) } : null;
  } catch { return null; }
}

/** The register and fact_notes.js's checkConfig, each null when unreadable. */
export function readKnobInputs(sk, buses) {
  let register = null, checkConfig = null;
  try { register = JSON.parse(readFileSync(path.join(buses, 'service-facts.json'), 'utf8')); } catch { /* blind, said by the caller */ }
  try { checkConfig = createRequire(import.meta.url)(path.join(sk, 'fact_notes.js')).checkConfig || null; } catch { /* blind */ }
  return { register, checkConfig, readS3: readLatestS3, sk, buses };
}
