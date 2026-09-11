/*
 * directory_links.mjs — the national bus-map directory's link sweep, as worklist
 * rows (buses-data OA-308's "Keeping it true", 2026-09-11).
 *
 * WHAT THIS IS FOR. `BusMapsUK/bus-map-directory/` records, for every English
 * local transport authority, whether it publishes a bus map and where. It is a
 * directory of OTHER PEOPLE'S URLs, so it rots without anybody here touching it —
 * "the draft that ages against its own evidence" in the named failure shapes, with
 * the twist that the evidence belongs to seventy-six councils who reorganise their
 * websites whenever they like. `directory.mjs --links` is the check. OA-308 ruled
 * it OUT of CI on purpose and the reason is worth restating, because it is the
 * same reason this module exists: a council page that dies on a Tuesday would turn
 * `main` red with nobody having committed anything — the calendar-red shape OA-289
 * removed from the backlog index — and buses-data is the one repository in the
 * estate whose Actions minutes are billed.
 *
 * So the check runs by hand. A check that runs by hand is a check that runs once,
 * unless something remembers to ask — and the thing that asks is this list. Hence
 * a MONTHLY row: not a gate, not an email, a line on the board Peter already works
 * from, which goes quiet as soon as the sweep has been run.
 *
 * IT NEVER TOUCHES THE NETWORK, and that is a hard constraint rather than a
 * preference. worklist.mjs says in its own header that it calls the network only
 * in --url mode; a source that quietly fetched 109 council URLs would turn a
 * half-second board into a minute-long one and would fail on a train. So the
 * sweep WRITES its answer — `link-check.json`, built by `buildLinkRecord()` in
 * directory.mjs — and this module only ever READS that file. Every row below is a
 * statement about a dated record on disk, not about the internet.
 *
 * THREE ROWS, AND THE SILENCE IS THE COMMON CASE:
 *
 *   directory-links-dead    rank 7   the last sweep found links that are GONE
 *   directory-links-due     rank 8   the last sweep is over a month old, or never ran
 *   directory-links-record  rank 8   the record is there but cannot be believed
 *
 * A record younger than the cadence with no dead links raises nothing at all, the
 * same rule the commitments and correspondence sources follow. A board that prints
 * everything is one nobody finishes.
 *
 * DEAD IS RANKED ABOVE DUE, and above housekeeping, because a dead link is not
 * hygiene: once OA-308's tier 2 panel is live, a dead row sends a member of the
 * public from busmaps.uk to a 404 while telling them their council publishes a
 * map. Running the sweep is housekeeping; a wrong answer already published is
 * somebody's wasted afternoon.
 *
 * BLOCKED RAISES NOTHING, DELIBERATELY. On its first run this checker called 14
 * links dead and 12 of them were HTTP 403 bot walls on pages a person opens
 * without trouble — "the refusal read as an absence", and the survey agents had
 * read several of those pages through a browser the same morning. directory.mjs
 * separates the two verdicts for that reason; a row here that nagged about them
 * would put the fault straight back, one layer up. The blocked count is carried in
 * the row's prose where a reader can see it and is never a reason to act.
 *
 * PURE ON PURPOSE. `readDirectoryState()` does the I/O and everything it learns is
 * handed to `directoryLinkItems()` as data, so prove-red-directory-links.mjs can
 * drive every branch — including "the sweep has never been run" and "the record
 * will not parse" — without a directory, a network or a clock.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The default cadence, in days. Monthly, as OA-308 asked for. */
export const CADENCE_DAYS = 30;

/**
 * Read the directory's state from disk. Returns a plain object and never throws.
 *
 * `dataPresent` is the TRIGGER for everything below, and it is deliberately the
 * directory's own data file rather than the record: a tree that has no
 * bus-map-directory has nothing to sweep and must stay silent (a worktree, a
 * fixture, some future checkout without BusMapsUK/), while a tree that HAS the
 * directory and no record has never run the sweep, which is the loudest thing
 * this module can say. Keying on the record instead would make "never run" and
 * "not applicable" the same state — the exact shape where a check reports
 * nothing and reads as a pass.
 *
 * @param {string} dir  the bus-map-directory folder
 */
export function readDirectoryState(dir) {
  const dataFile = path.join(dir, 'directory.json');
  const recordFile = path.join(dir, 'link-check.json');
  const state = { dir, dataFile, recordFile, dataPresent: false, present: false, record: null, unreadable: null };
  try { state.dataPresent = fs.existsSync(dataFile); } catch { /* unreadable disk is not our business */ }
  if (!state.dataPresent) return state;
  let raw;
  try { raw = fs.readFileSync(recordFile, 'utf8'); } catch { return state; }
  state.present = true;
  try { state.record = JSON.parse(raw); } catch (e) { state.unreadable = e.message; }
  return state;
}

const DAY = 86400000;

/**
 * @param {object} p
 * @param {object} p.state         from readDirectoryState()
 * @param {number} [p.now]         ms since epoch; injected so the harness owns the clock
 * @param {number} [p.cadenceDays]
 * @returns {Array} worklist items, newest concern first
 */
export function directoryLinkItems({ state, now = Date.now(), cadenceDays = CADENCE_DAYS }) {
  const out = [];
  if (!state || !state.dataPresent) return out;

  const cwd = state.dir;
  const sweep = { kind: 'shell', cwd, cmd: 'node directory.mjs --links', note: 'fetches every recorded URL; writes link-check.json' };
  const rerender = { kind: 'shell', cwd, cmd: 'node directory.mjs', note: 'after editing directory.json — re-renders the README table' };

  // 1. The record is missing, or it is there and cannot be believed. Both are
  //    "nothing is watching the directory", and both must be LOUD rather than
  //    silent: a reader that fell quiet on a record it could not parse would
  //    report exactly what a healthy month reports.
  if (state.present && state.unreadable) {
    out.push({
      key: 'directory-links-record', rank: 8, type: 'directory-links',
      title: 'The bus-map directory\'s link-check record will not parse',
      why: `${state.recordFile} is not JSON (${state.unreadable}). Nothing is watching the directory's 100-odd council URLs while this is broken, and this row is all that says so.`,
      who: '—', runbook: 'directory',
      do: [
        { kind: 'chat', what: 'Delete the file and re-run the sweep — it is a written record, not source data, and it is cheap to rebuild.' },
        sweep,
      ],
    });
    return out;
  }

  const at = state.record && state.record.checkedAt ? Date.parse(state.record.checkedAt) : NaN;

  // 2. The record parses but does not say WHEN. This is the writer-and-reader
  //    join going wrong — a renamed field, a half-written file — and it looks
  //    identical to health from anywhere except here. Say it.
  if (state.present && !state.unreadable && !Number.isFinite(at)) {
    out.push({
      key: 'directory-links-record', rank: 8, type: 'directory-links',
      title: 'The bus-map directory\'s link-check record does not say when it ran',
      why: `${state.recordFile} parses but carries no readable \`checkedAt\`. Its age is the whole basis of the monthly row, so nothing can tell a sweep run this morning from one run last spring.`,
      who: '—', runbook: 'directory',
      do: [
        sweep,
        { kind: 'chat', what: 'If a fresh sweep still writes no checkedAt, the fault is in buildLinkRecord() in directory.mjs, not in the data.' },
      ],
    });
    return out;
  }

  const rec = state.record || {};
  const ageDays = Number.isFinite(at) ? Math.floor((now - at) / DAY) : null;
  const dead = Array.isArray(rec.deadLinks) ? rec.deadLinks : [];
  const blocked = Number.isFinite(+rec.blocked) ? +rec.blocked : (Array.isArray(rec.blockedLinks) ? rec.blockedLinks.length : 0);

  // 3. DEAD LINKS. One row for all of them rather than one row each: they arrive
  //    together, they are worked in one sitting, and a council site reorganising
  //    can kill a dozen at once — twelve near-identical rows would bury the four
  //    things somebody is actually waiting on. Every URL is named in `detail`, so
  //    nothing is hidden by the grouping.
  if (dead.length) {
    const n = dead.length;
    out.push({
      key: 'directory-links-dead', rank: 7, type: 'directory-links',
      title: `${n} link${n === 1 ? '' : 's'} in the national bus-map directory ${n === 1 ? 'is' : 'are'} DEAD`,
      why: `The sweep of ${rec.checkedAt ? String(rec.checkedAt).slice(0, 10) : 'an unknown date'} found ${n} URL${n === 1 ? '' : 's'} gone — a 404, a 410 or a host that no longer resolves, which is the page being withdrawn rather than a reader being refused. Each one is a row of the directory pointing a reader at nothing, and the /maps panel says in the same breath that the authority publishes a map.`,
      who: '—', runbook: 'directory',
      ageDays,
      detail: dead.slice(0, 10).map((d) => `${d.status || d.why || 'gone'}  ${d.url}\n        ${(d.cites || []).join('; ')}`).join('\n')
        + (dead.length > 10 ? `\n        …and ${dead.length - 10} more, all of them in link-check.json` : ''),
      do: [
        { kind: 'chat', what: 'Open each dead URL in the browser pane before editing anything — a link that 404s to a fetcher and opens for a person is a redirect we have not followed, not a withdrawn map.' },
        { kind: 'chat', what: `Then, per row of directory.json: repoint the URL and re-date \`checked\`; or, where the map really is gone, change the status to \`no\` and write what happened in the note — a withdrawn map is a finding about that authority, not a blank. ${cwd}` },
        rerender,
        sweep,
      ],
    });
  }

  // 4. THE MONTHLY ROW ITSELF. Quiet until the cadence is up.
  if (!state.present) {
    out.push({
      key: 'directory-links-due', rank: 8, type: 'directory-links',
      title: 'The national bus-map directory has never had its links swept',
      why: 'Every URL in it belongs to somebody else, and nothing on this laptop has ever checked that they still resolve. The sweep takes about a minute and writes the record this row reads.',
      who: '—', runbook: 'directory',
      do: [sweep],
    });
  } else if (ageDays !== null && ageDays >= cadenceDays) {
    out.push({
      key: 'directory-links-due', rank: 8, type: 'directory-links',
      title: `The bus-map directory's links were last swept ${ageDays} days ago`,
      why: `${rec.urls || 'The'} URL${rec.urls === 1 ? '' : 's'} across ${rec.rows || 'the'} authorit${rec.rows === 1 ? 'y' : 'ies'}, all of them somebody else's, last read on ${String(rec.checkedAt).slice(0, 10)}. Monthly is the cadence OA-308 set: often enough that a reorganised council site is caught before a reader meets it, rarely enough that it is a minute a month.`,
      who: '—', runbook: 'directory',
      ageDays,
      do: [
        sweep,
        { kind: 'chat', what: 'Anything it reports DEAD comes back on this list as its own row. BLOCKED is a bot wall refusing an automated reader, not a dead page — do not "fix" one.' },
      ],
    });
  }

  // Said in the row's prose rather than as a row of its own, because a refusal is
  // not an absence and nobody should be asked to act on one.
  if (blocked && out.length) {
    for (const it of out) {
      if (it.key === 'directory-links-due' || it.key === 'directory-links-dead') {
        it.why += ` (${blocked} URL${blocked === 1 ? '' : 's'} refused an automated reader last time — recorded, and not something to act on.)`;
      }
    }
  }

  return out;
}
