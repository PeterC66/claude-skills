/*
 * refresh_grades.mjs — whether a town's monthly refresh needs a person, as data
 * (buses-data OA-426, item 2 of R9 of the process review of 2026-09-17).
 *
 * WHAT IT IS FOR. Every `refresh` row on this board says a town's timetables have
 * moved and its sheet has not. What no row has ever said is whether moving the
 * sheet needs a human judgement. `gtfs_refresh_report.py` has graded each town
 * SAFE, ESCALATE or NOTHING since 2026-09-18 — SAFE meaning every actionable
 * change is an operator NAME or a set of DAYS, fields that decide no colour and
 * move no line — but the grade was written only into the report's own heading.
 * OA-426 gave it a file: `_gtfs/refresh-grades_<date>.json`, written beside the
 * prose by the same run, from the same record the heading is built from.
 *
 * WHY THIS IS A READER AND NOT A PARSER. `bods_scan.mjs` deliberately reads report
 * FILENAMES and never a report, because a reader that depends on a generator's
 * wording breaks the first time the generator phrases something differently. That
 * argument does not go away because the fact is now more interesting: it is the
 * reason the answer was given a JSON file rather than a regular expression over
 * `## March — 3 to review · SAFE`.
 *
 * THE DATES HAVE TO MATCH, AND THAT IS THE LOAD-BEARING RULE HERE. A refresh row
 * is a join on the newest `upcoming-report_<date>.md`; a grade is a fact about the
 * run that wrote `refresh-grades_<date>.json`. The monthly job writes both in one
 * pass, so on an ordinary month the two dates are the same day. When they are NOT
 * — a scan half-run, an upcoming pass run by hand afterwards, a grades file left
 * over from last month — the older grade is about a diff nobody is looking at any
 * more, and attaching it to today's row would be a machine saying "no person
 * needed" about changes it has not seen. So a mismatch yields NOTHING, loudly:
 * `gradeFor` returns null and the caller is handed a warning to print.
 *
 * WHAT A GRADE IS NOT. It is not permission. `SAFE` says the report found nothing
 * that needs a judgement; it does not say the rebuild succeeded, that the sheet
 * still gates, or that the map may be delivered. Those are the build's own gates
 * and they are unchanged.
 *
 * PURE CORE, INJECTED EDGE, like `bods_scan.mjs` and `deploy_pending.mjs`:
 * `defaultReadGradeFiles` is the only thing that touches the disk, it hands back
 * raw text, and `readGradeState()` does the parsing — so the harness can falsify
 * an unparseable file, a wrong schema and a stale date with no `_gtfs` folder at
 * all.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const GRADES_RE = /^refresh-grades_(\d{4}-\d{2}-\d{2})\.json$/;

/** The three grades `gtfs_refresh_report.py`'s `classify()` can return. */
export const GRADES = ['SAFE', 'ESCALATE', 'NOTHING'];

/** The schema this reader understands. The producer stamps it; a bump is a refusal. */
export const SCHEMA = 1;

/**
 * The default disk read: every grades file under `_gtfs/`, as `{ date, text }`,
 * ascending by date. `null` means the folder is not there at all.
 *
 * SORTED HERE AS WELL AS IN THE CORE, for the reason `bods_scan.mjs` gives at
 * length: `readdir` on this laptop happens to return these names in order, so a
 * core that trusted the listing would stay green here for ever and name the wrong
 * newest file on any machine that did not.
 */
export const defaultReadGradeFiles = (dir) => {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .map((f) => ({ f, date: (f.match(GRADES_RE) || [])[1] }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((x) => ({ date: x.date, text: readFileSync(path.join(dir, x.f), 'utf8') }));
};

/**
 * Read the newest grades file. Returns one of:
 *   { status: 'no-dir', dir }                     — no `_gtfs/` here (a CI runner, a fixture)
 *   { status: 'none', dir }                       — no grades file: every scan predates OA-426
 *   { status: 'unreadable', dir, date, why }      — the newest file is not a payload this understands
 *   { status: 'ok', dir, date, towns, notChecked }
 *
 * `towns` is keyed by the LOWER-CASED town name, because the callers join on a
 * name typed in three places — the portal's map `name`, the `Areas/` folder and
 * `town_prefixes.json` — and this board already matches those case-insensitively
 * everywhere else.
 */
export function readGradeState({ busesDir, readGradeFiles = defaultReadGradeFiles } = {}) {
  const dir = path.join(busesDir || '.', '_gtfs');
  const read = readGradeFiles(dir);
  if (read === null) return { status: 'no-dir', dir };
  const files = [...read].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!files.length) return { status: 'none', dir };
  const newest = files[files.length - 1];
  const bad = (why) => ({ status: 'unreadable', dir, date: newest.date, why });
  let payload;
  try { payload = JSON.parse(newest.text); } catch (e) { return bad(`it is not JSON (${e.message})`); }
  if (!payload || typeof payload !== 'object') return bad('it is not an object');
  if (payload.schema !== SCHEMA) return bad(`its schema is ${JSON.stringify(payload.schema)} and this reads ${SCHEMA}`);
  if (!payload.towns || typeof payload.towns !== 'object') return bad('it carries no `towns` object');
  /* THE FILENAME'S DATE AND THE PAYLOAD'S MUST AGREE. They are written by one
   * statement from one variable, so a disagreement means the file has been moved,
   * renamed or edited — and the date is the whole basis on which a grade is
   * matched to a scan. Refusing is cheaper than choosing one of them. */
  if (payload.date !== newest.date) return bad(`it is named ${newest.date} and says ${JSON.stringify(payload.date)}`);
  const towns = {};
  for (const [name, rec] of Object.entries(payload.towns)) {
    if (!rec || !GRADES.includes(rec.grade)) return bad(`${name} carries no grade this understands (${JSON.stringify(rec && rec.grade)})`);
    towns[name.toLowerCase()] = { town: name, grade: rec.grade, actionable: rec.actionable, reasons: rec.reasons || [] };
  }
  const notChecked = Array.isArray(payload.notChecked) ? payload.notChecked : [];
  return { status: 'ok', dir, date: newest.date, towns, notChecked };
}

/**
 * The grade for one town AS AT one scan date, or null. `scanDate` is the date of
 * the report the caller's row is joined to; see the dates paragraph at the head of
 * this file for why a mismatch is nothing rather than the older answer.
 */
export function gradeFor(state, town, scanDate) {
  if (!state || state.status !== 'ok') return null;
  if (scanDate && state.date !== scanDate) return null;
  return state.towns[String(town || '').toLowerCase()] || null;
}

/** Was this town one the scan could not check? Named, because an absence is a verdict. */
export function notCheckedFor(state, town) {
  if (!state || state.status !== 'ok') return null;
  const want = String(town || '').toLowerCase();
  return (state.notChecked.find((x) => String(x.town || '').toLowerCase() === want)) || null;
}

/**
 * The sentence a refresh row adds to its `why`, or '' when there is nothing to
 * say. It is a sentence rather than a field because a row's `why` is what a person
 * reads, and the JSON output carries the record itself beside it.
 */
export function gradeSentence(state, town, scanDate) {
  const g = gradeFor(state, town, scanDate);
  if (g) {
    if (g.grade === 'SAFE') {
      return ` The ${state.date} scan graded ${g.town} SAFE: all ${g.actionable} actionable change${g.actionable === 1 ? ' is' : 's are'} an operator name or a day string (${g.reasons.join(', ')}), so no judgement is wanted before the rebuild.`;
    }
    if (g.grade === 'ESCALATE') {
      return ` The ${state.date} scan graded ${g.town} ESCALATE on ${g.reasons.join(', ')}: a person decides what the sheet should say before it is rebuilt.`;
    }
    return '';
  }
  const nc = notCheckedFor(state, town);
  if (nc) return ` The ${state.date} scan could NOT check ${nc.town} (${nc.reason}), so it has no grade — this row's changes came from the upcoming pass alone.`;
  return '';
}

/**
 * The warnings the worklist should print about the grading itself. Kept apart from
 * the rows, exactly as `bods_scan.mjs` keeps them: none of these is work, and a
 * board that turned "I could not read a file" into a task would be filing a row
 * nobody can clear.
 */
export function gradeWarnings(state, scanDate) {
  const w = [];
  if (!state) return w;
  if (state.status === 'no-dir') return w; // bods_scan already says this tree carries no feeds
  if (state.status === 'none') {
    w.push('refresh grades: no `_gtfs/refresh-grades_<date>.json` yet — every scan on this disk predates OA-426, so refresh rows say nothing about whether a person is needed.');
    return w;
  }
  if (state.status === 'unreadable') {
    w.push(`refresh grades: the newest grades file (${state.date}) was ignored — ${state.why}. No row claims a grade.`);
    return w;
  }
  if (scanDate && state.date !== scanDate) {
    w.push(`refresh grades: the newest grading is ${state.date} and the newest upcoming scan is ${scanDate} — they are different runs, so no refresh row carries a grade. Re-run the monthly job so both are written in one pass.`);
  }
  return w;
}
