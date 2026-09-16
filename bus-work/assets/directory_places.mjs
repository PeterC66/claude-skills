/*
 * directory_places.mjs — how old the place-lookup edition is, as a worklist row
 * (buses-data OA-312, round 1 of the place-lookup plan, 2026-09-16).
 *
 * WHAT THIS IS FOR. Since OA-312 the /maps search on busmaps.uk resolves any
 * named place in Great Britain to its district and, for England, to the directory
 * row for its local transport authority — out of `places.json` beside the
 * directory in buses-data, built from the ONS Index of Place Names. The Index is
 * republished roughly yearly (December 2022, March 2023, July 2024), and every
 * panel that consulted it tells the reader which edition it read. Nothing in
 * either repository asks whether a newer edition exists, and nothing CAN in CI:
 * `check-places.mjs` holds the three files to one edition and the counts to the
 * files, and deliberately never compares `built` to today, because a check that
 * did would go red on the CALENDAR with nobody committing anything — buses-data
 * OA-289's clock-dependent artefact, the same reason the two directory rows next
 * door are on this board and not in a workflow.
 *
 * SO THIS ROW IS THE ONLY PLACE THE QUESTION IS ASKED, and it is asked of a
 * person: go and look at the Open Geography Portal, and if a new edition exists
 * rebuild; if not, rebuild anyway so `built` records that somebody looked.
 *
 * THE CADENCE, AND WHY THE NUMBER IS ARGUED. Half a year. The Index arrives
 * about yearly, so a yearly check would on average be six months late and could
 * be a year late; half-yearly bounds the lag at six months for about ten minutes
 * of work — a download, a build that refuses if the rule no longer covers the
 * districts, a check, a sync into the portal. Quarterly would raise a row that is
 * up more often than it is down for a dataset that moves once a year, which is
 * the row somebody learns to scroll past. The consequence of lateness is mild —
 * a place renamed or a district reorganised answers with last year's district —
 * so the row ranks with the directory rows and not above them.
 *
 * WHAT IT STAYS SILENT ABOUT, so one fault is not printed twice. No
 * `places-source.json` at all is a checkout older than OA-312, or a worktree, and
 * is silent. Counts that disagree with the files, a missing edition, a broken
 * join — all faults of `check-places.mjs`, loud in buses-data's `gates.yml`. What
 * NOTHING else asks is whether `built` is a readable date, because the check
 * asserts only that the field exists: so an unreadable `built` IS raised here, as
 * "cannot tell", which must never collapse into "fine".
 *
 * IT NEVER TOUCHES THE NETWORK and IT MUST NEVER ENTER CI, for the reasons above.
 * PURE ON PURPOSE, like its siblings: `readPlacesState()` does the I/O, the clock
 * is an argument, and `prove-red-directory-places.mjs` drives every branch
 * without a directory or a clock.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Half a year, argued above. */
export const RECHECK_DAYS = 182;

const DAY = 86400000;

/**
 * Read `places/places-source.json` under the bus-map-directory folder.
 * Returns a plain object and never throws.
 *
 * @param {string} dir  the bus-map-directory folder
 */
export function readPlacesState(dir) {
  const file = path.join(dir, 'places', 'places-source.json');
  const state = { dir, file, present: false, source: null, unreadable: null };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return state; }
  state.present = true;
  try { state.source = JSON.parse(raw); } catch (e) { state.unreadable = `places-source.json: ${e.message}`; }
  return state;
}

/**
 * @param {object} p
 * @param {object} p.state         from readPlacesState()
 * @param {number} [p.now]         ms since epoch; injected so the harness owns the clock
 * @param {number} [p.recheckDays]
 * @returns {Array} worklist items — at most one
 */
export function directoryPlacesItems({ state, now = Date.now(), recheckDays = RECHECK_DAYS }) {
  const out = [];
  if (!state || !state.present) return out;

  const src = state.source || {};
  const built = typeof src.built === 'string' ? src.built.trim() : '';
  // YYYY-MM-DD or nothing: V8's Date.parse reads "sometime in 2024" as a date,
  // and the harness caught it doing so on the first run.
  const at = /^\d{4}-\d{2}-\d{2}$/.test(built) ? Date.parse(built) : NaN;
  const dated = Number.isFinite(at);
  const ageDays = dated ? Math.floor((now - at) / DAY) : null;
  if (!state.unreadable && dated && ageDays < recheckDays) return out;

  const edition = src.edition || '(no edition recorded)';
  const cwd = path.join(state.dir, 'places');
  const cannotTell = Boolean(state.unreadable) || !dated;

  out.push({
    key: 'directory-places-edition', rank: 8, type: 'directory-links',
    title: cannotTell
      ? 'The place lookup\'s edition has no readable build date'
      : `The place lookup was built ${ageDays} days ago from the ${edition} Index of Place Names — is there a newer edition?`,
    why: `The /maps search resolves every named place in Great Britain to its district and authority out of \`places.json\`, built from the ONS Index of Place Names, ${edition} edition. `
      + 'The Index is republished roughly yearly and nothing in either repository can ask whether a newer one exists: a check that compared the build date to today would redden main on the calendar (buses-data OA-289), so the question is asked here, of a person, twice a year. '
      + (cannotTell
        ? `Right now it cannot be asked at all: ${state.unreadable || `\`built\` reads "${built || '(empty)'}", which is not a date`}. Cannot tell is louder than old.`
        : `Every reader of the panel is told which edition answered them, so a stale edition is a true sentence about last year's districts rather than a wrong one — which is why this ranks with the directory rows and not above them.`),
    who: '—', runbook: 'directory',
    ageDays,
    detail: `${state.file}\n        edition ${edition} · built ${built || 'NOT RECORDED'} · sha256 ${src.sha256 ? String(src.sha256).slice(0, 12) + '…' : 'NOT RECORDED'}`,
    do: [
      { kind: 'chat', what: 'Open the Open Geography Portal and look for an Index of Place Names edition newer than the one above (search "Index of Place Names"). The item id in the download URL below is the July 2024 edition; a new edition has a new id, and places-source.json\'s `url` should then point at it.' },
      { kind: 'shell', cwd, cmd: 'curl -sL -o ipn.zip "https://www.arcgis.com/sharing/rest/content/items/208d9884575647c29f0dd5a1184e711a/data"', note: 'the current edition\'s URL — swap the id if a newer edition exists' },
      { kind: 'shell', cwd, cmd: 'tar -xf ipn.zip', note: 'extracts the CSV beside the zip; the CSV name carries the edition year' },
      { kind: 'shell', cwd, cmd: 'node build-places.mjs --csv IPN_GB_2024.csv --zip ipn.zip', note: 'rebuilds the three files and re-records `built`; refuses if the district rule no longer covers the data. If the sha256 matches the old one the edition is unchanged and only `built` moves — commit that: it is the record that somebody looked' },
      { kind: 'shell', cwd, cmd: 'node check-places.mjs', note: 'the gate; a new edition that renames a district shows here first' },
      { kind: 'chat', what: 'If the edition changed: update EDITION and URL in build-places.mjs, then `npm run sync:directory` from the portal root (C:\\Claude\\community-bus-maps) and open a portal PR — AFTER pushing buses-data, because the portal\'s verify.yml reads this repository\'s main.' },
    ],
  });

  return out;
}
