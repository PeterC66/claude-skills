/*
 * directory_coverage.mjs — the freshness of the two directory rows OA-315's
 * coverage gate actually depends on, as a worklist row (buses-data OA-317).
 *
 * WHAT THIS IS FOR, AND WHY IT IS NOT THE LINK SWEEP NEXT DOOR. `directory.json`
 * records, for each of seventy-six English local transport authorities, whether
 * that authority publishes a bus map and where. `directory_links.mjs` raises a
 * monthly row asking somebody to re-run `directory.mjs --links`, which probes
 * every recorded URL and reports live / blocked / dead. That is a fact about
 * REACHABILITY. This module is about CONTENT, and the difference is the whole of
 * OA-317: a council that quietly adds a town map to the page we already record
 * reports LIVE for ever, because the URL was never the thing that moved.
 *
 * WHY IT IS NARROWED TO TWO AUTHORITIES, AND NOT SEVENTY-SIX. OA-315 built a
 * gate — `coverage.mjs --check` — that faults when the directory says a sheet has
 * appeared for a town we build. Its input is `directory.json`, and every one of
 * those 76 rows was read on a single day, 2026-09-11, so the whole corpus ages
 * together and no row's date can ever tell you it is the stale one. The gate can
 * therefore only fire if somebody re-surveys, which nothing asks for — green
 * because nobody looked. But the gate does not read 76 rows: `existing-coverage.json`
 * names exactly TWO authorities across all 20 maps, and re-reading two council
 * pages on a cadence makes the gate's input as fresh as the gate implies for a
 * fraction of the work. That narrowing is OA-317's own recommendation, taken
 * before any of the wider sweep is built.
 *
 * THE OTHER 74 ROWS ARE ON NO CADENCE AT ALL, AND THAT IS A DECISION RATHER THAN
 * AN OVERSIGHT. They feed the public /maps directory panel and no gate, their
 * links are swept monthly, and a dead link already raises its own row next door.
 * Written down here and in the directory's own README so it can be disagreed
 * with, which is what the OA asked for: *a slower cadence is defensible there and
 * should be written down rather than left implicit*.
 *
 * WHERE THE AUTHORITIES COME FROM. `existing-coverage.json`'s `maps[].lta`, which
 * is HAND-SET and matched exactly against a `directory.json` row — nothing here
 * guesses one, for the reason that register's own `_readme` gives. So this module
 * asks the register which authorities matter rather than carrying a list of two
 * names, and a twenty-first map in a third authority puts that authority on the
 * cadence the day its entry is written.
 *
 * WHAT IT DELIBERATELY STAYS SILENT ABOUT, SO ONE FAULT IS NOT PRINTED TWICE.
 * An `lta` naming no directory row, an entry with no `lta`, an unparseable
 * register — `coverage.mjs --check` faults on all three and it runs in buses-data's
 * `gates.yml`, so it is already loud in CI. A row here would be the same fault
 * under a second name. What is NOT covered anywhere else is a gate-bearing row
 * with no readable `checked` date at all, so that one IS raised: it is this
 * module's own subject, and *cannot tell* must never collapse into *fine*.
 *
 * IT NEVER TOUCHES THE NETWORK, the same hard constraint `directory_links.mjs`
 * states for itself. Every answer below is read off two tracked files on disk.
 * And it does not read `link-check.json`: whether a fetcher is refused by a bot
 * wall says nothing about this row, because what this row asks for is a PERSON
 * opening the page — which is exactly the distinction OA-317 draws when it points
 * out that 13 of the 76 rows can only ever be re-checked by hand.
 *
 * IT MUST NEVER ENTER CI. A staleness measure is a function of the clock, so a CI
 * step over it would turn `main` red on the CALENDAR with nobody having committed
 * anything — buses-data OA-289's clock-dependent artefact, the fault that was
 * taken out of the backlog index and that OA-315 has already had to design around
 * once. The worklist is the right home because a person reads it.
 *
 * PURE ON PURPOSE, like its sibling. `readCoverageState()` does the I/O and hands
 * everything it learns to `directoryCoverageItems()` as data, and the clock is an
 * argument, so `prove-red-directory-coverage.mjs` drives every branch — including
 * the boundary either side of the cadence — without a directory, a network or a
 * clock.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * The cadence, in days, for the authorities the coverage gate depends on.
 *
 * NINETY DAYS, AND THE NUMBER IS ARGUED RATHER THAN PICKED. The link sweep next
 * door is monthly because it is a machine reading 109 URLs in about a minute;
 * this is a person opening two council pages and reading them, so monthly would
 * be a row that is up more often than it is down, and a row like that is the
 * first one somebody learns to scroll past — the same argument as "a gate that is
 * red on day one gets muted", arriving from the other end. Against that, the
 * thing it guards is advisory: `coverage.mjs` has never once refused a build and
 * all 20 maps grade `area-only`, so a quarter of a wrong answer costs a paragraph
 * of README and not a wasted build. Quarterly bounds the wrong answer at three
 * months where today it is unbounded, for about ten minutes a quarter.
 */
export const REREAD_DAYS = 90;

const DAY = 86400000;

/**
 * Read the register and the directory. Returns a plain object and never throws.
 *
 * `dataPresent` and `coveragePresent` are separate because they mean different
 * things. No `directory.json` is a tree with no directory at all — a worktree, a
 * fixture, some future checkout without `BusMapsUK/` — and must stay silent. A
 * directory with no register is a state `coverage.mjs --check` is already loud
 * about in CI, so it is silent here too, deliberately.
 *
 * @param {string} dir  the bus-map-directory folder
 */
export function readCoverageState(dir) {
  const dataFile = path.join(dir, 'directory.json');
  const coverageFile = path.join(dir, 'existing-coverage.json');
  const state = {
    dir, dataFile, coverageFile,
    dataPresent: false, coveragePresent: false,
    directory: null, coverage: null, unreadable: null,
  };
  let rawData, rawCov;
  try { rawData = fs.readFileSync(dataFile, 'utf8'); } catch { return state; }
  state.dataPresent = true;
  try { rawCov = fs.readFileSync(coverageFile, 'utf8'); } catch { return state; }
  state.coveragePresent = true;
  try { state.directory = JSON.parse(rawData); } catch (e) { state.unreadable = `directory.json: ${e.message}`; return state; }
  try { state.coverage = JSON.parse(rawCov); } catch (e) { state.unreadable = `existing-coverage.json: ${e.message}`; return state; }
  return state;
}

/**
 * Join the register's authorities to their directory rows, oldest read first.
 *
 * Exported so the harness can assert the join itself rather than only the row it
 * produces — the join is the half that can silently narrow, which is the shape
 * recorded as *the subject you named yourself*.
 *
 * @param {object} state  from readCoverageState()
 * @returns {Array<{lta: string, maps: number, checked: string|null, at: number}>}
 */
export function gateBearingAuthorities(state) {
  if (!state || !state.coverage || !state.directory) return [];
  const entries = Array.isArray(state.coverage.maps) ? state.coverage.maps : [];
  const rows = Array.isArray(state.directory.rows) ? state.directory.rows : [];
  const counted = new Map();
  for (const e of entries) {
    if (!e || typeof e.lta !== 'string' || e.lta.trim() === '') continue;
    counted.set(e.lta, (counted.get(e.lta) || 0) + 1);
  }
  const out = [];
  for (const [lta, maps] of counted) {
    // An lta naming no row is coverage.mjs --check's fault, not ours — see the
    // header. Skipping it here keeps one fault under one name; it cannot hide,
    // because that check is in CI and this one is not.
    const row = rows.find((r) => r && r.lta === lta);
    if (!row) continue;
    const checked = typeof row.checked === 'string' && row.checked.trim() !== '' ? row.checked.trim() : null;
    const at = checked ? Date.parse(checked) : NaN;
    out.push({
      lta, maps, checked,
      at: Number.isFinite(at) ? at : NaN,
      landingPage: row.landingPage || null,
      networkMap: (row.networkMap && row.networkMap.status) || 'unknown',
      townMaps: (row.townMaps && row.townMaps.status) || 'unknown',
    });
  }
  // Undated first — "cannot tell" is louder than "old" — then oldest read first.
  return out.sort((a, b) => {
    if (Number.isFinite(a.at) !== Number.isFinite(b.at)) return Number.isFinite(a.at) ? 1 : -1;
    if (!Number.isFinite(a.at)) return a.lta.localeCompare(b.lta);
    return a.at - b.at || a.lta.localeCompare(b.lta);
  });
}

/**
 * @param {object} p
 * @param {object} p.state        from readCoverageState()
 * @param {number} [p.now]        ms since epoch; injected so the harness owns the clock
 * @param {number} [p.rereadDays]
 * @returns {Array} worklist items
 */
export function directoryCoverageItems({ state, now = Date.now(), rereadDays = REREAD_DAYS }) {
  const out = [];
  if (!state || !state.dataPresent || !state.coveragePresent || state.unreadable) return out;

  const authorities = gateBearingAuthorities(state);
  if (!authorities.length) return out;         // no map has been graded yet; coverage.mjs --check says so

  const undated = authorities.filter((a) => !Number.isFinite(a.at));
  const overdue = authorities.filter((a) => Number.isFinite(a.at) && Math.floor((now - a.at) / DAY) >= rereadDays);
  if (!undated.length && !overdue.length) return out;

  // `authorities` is sorted undated-first then oldest-read-first, so `overdue[0]`
  // is the one read longest ago. That single number is both the row's title and
  // its `ageDays`, and it is the OLDEST rather than an average or the newest:
  // every authority in this row is named in `detail` with its own date, so the
  // headline is free to be the worst case without hiding anything.
  const named = [...undated, ...overdue];
  const oldest = overdue.length ? Math.floor((now - overdue[0].at) / DAY) : null;
  const ageDays = oldest;
  const n = named.length;
  const mapsCovered = named.reduce((s, a) => s + a.maps, 0);

  const cwd = state.dir;
  const line = (a) => `${a.lta}\n        last read ${a.checked || 'NEVER — the row carries no readable date'} · ${a.maps} map${a.maps === 1 ? '' : 's'} graded against it`
    + ` · directory says network map ${a.networkMap}, town maps ${a.townMaps}\n        ${a.landingPage || '(no landing page recorded)'}`;

  out.push({
    key: 'directory-coverage-reread', rank: 8, type: 'directory-links',
    title: undated.length
      ? `${undated.length} of the ${authorities.length} authorit${authorities.length === 1 ? 'y' : 'ies'} the coverage gate depends on ${undated.length === 1 ? 'has' : 'have'} no readable read-date`
      : `The ${n} authorit${n === 1 ? 'y' : 'ies'} the coverage gate depends on ${n === 1 ? 'was' : 'were'} last read up to ${oldest} days ago`,
    why: `\`coverage.mjs --check\` asks, of every map we build, whether somebody else already maps that town — and it answers out of \`directory.json\`. `
      + `${mapsCovered} of our maps are graded against ${n === 1 ? 'this authority' : 'these ' + n + ' authorities'}, and ${n === 1 ? 'its row has' : 'their rows have'} not been re-read ${undated.length ? 'in a way this can measure' : `for as much as ${oldest} days`}. `
      + `The monthly link sweep does not touch this: it proves a URL still resolves, and a council that adds a town map to the page we already record reports LIVE for ever. `
      + `So until somebody opens ${n === 1 ? 'that page' : 'those pages'}, the gate is green because nobody looked. Re-reading ${n === 1 ? 'it' : 'them'} is about ten minutes; the other 74 rows are deliberately on no cadence at all, and the directory's README says why.`,
    who: '—', runbook: 'directory',
    ageDays,
    detail: named.map(line).join('\n'),
    do: [
      { kind: 'chat', what: `Open each landing page above and read it as a member of the public would — is there a network map, and is there a TOWN sheet for any town we publish? That second question is the one the gate turns on.` },
      { kind: 'chat', what: `Then, per row of directory.json: set \`checked\` to today, and correct \`networkMap\`/\`townMaps\` (status, url, format, dated, note) wherever the page has moved. A map that has been WITHDRAWN is a finding about that authority — set the status to \`no\` and write what happened, never leave it blank. ${cwd}` },
      { kind: 'shell', cwd, cmd: 'node directory.mjs', note: 'after editing directory.json — re-renders the README table' },
      { kind: 'shell', cwd, cmd: 'node coverage.mjs --check', note: 'the gate this row exists to feed; it faults if a sheet has appeared for a town we build' },
      { kind: 'chat', what: 'If the grade for a town has genuinely moved, the entry in existing-coverage.json needs its `grade` re-recorded AND a fresh `decision`/`reason` — the grade is what the directory says, the decision is the half no code can supply.' },
    ],
  });

  return out;
}
