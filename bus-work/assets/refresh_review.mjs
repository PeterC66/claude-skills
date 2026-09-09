#!/usr/bin/env node
/*
 * refresh_review.mjs — record that a map has been adjudicated against a BODS scan.
 *
 * WHY THIS EXISTS (buses-data OA-205). The worklist's `refresh` rows are a JOIN,
 * not a queue: `worklist.mjs` reads the newest `_gtfs/upcoming/upcoming-report_*.md`
 * and prints one row per map whose town has a section in it. Nothing can mark such a
 * row done except rebuilding the map — and on 2026-08-31 all 40 High Wycombe items
 * were worked to a conclusion and NONE of them needed a rebuild. The row came back
 * unchanged, with the same 40 on it.
 *
 * That leaves the next session three options and two of them are bad: redo an
 * adjudication that cost an operator-timetable read in a browser, rebuild the map to
 * silence the row (a no-op major version, which the `bus-work` skill's
 * `references/playbooks.md` explicitly forbids), or ignore it. A list carrying rows
 * nobody can clear is a list that stops being read.
 *
 * WHAT THIS WRITES. `<mapDir>/refresh-reviews.json`, an append-only list of
 * adjudications. `worklist.mjs` suppresses a map's refresh row when the NEWEST
 * review names the CURRENT scan date with verdict `no-rebuild`, and says in one line
 * how many it suppressed. A newer scan brings the row straight back, because the
 * match is on the scan date and nothing else.
 *
 * NOT `local-decisions.json`, deliberately. That file's own `_status` field says in
 * as many words that no generator, gate or portal panel reads it — it is Phase 0,
 * recorded only. Putting a machine-read key inside a file documented as unread is
 * how a document stops being true about itself.
 *
 * IT REFUSES A SCAN THAT DOES NOT EXIST. `--scan` must name a report on disk under
 * `_gtfs/upcoming/`. Without that check the one failure mode that matters is easy to
 * hit by hand — a typo'd or invented date silences nothing today and silences the
 * WRONG thing later, and the row it should have printed would be missing with no
 * error anywhere.
 *
 * Run from anywhere; every argument below is required except --note and --by:
 *
 *   node refresh_review.mjs --map "C:/u3a St Ives/Using AI/Buses/Areas/High Wycombe" \
 *        --scan 2026-08-31 --verdict no-rebuild --by buses-0c \
 *        --note "40 items adjudicated: 12 new September school registrations, ..."
 *
 *   node refresh_review.mjs --map "<mapDir>" --list      print what is recorded
 *
 * `--map` is the map's own folder — the one holding `manifest.json`. For a place
 * that is the PLACE's folder, never its town's: adjudicating a town must not
 * silently adjudicate a place whose frame is different (OA-205 item 4).
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FILE = 'refresh-reviews.json';
const VERDICTS = ['no-rebuild', 'rebuild-needed'];

const README = [
  'Adjudications of a BODS upcoming-changes scan against THIS map (buses-data OA-205).',
  '',
  'A worklist `refresh` row is derived from the newest scan report, so nothing can',
  'clear one except rebuilding the map. This file is how a map says "somebody has',
  'read that scan and this sheet does not need to change". worklist.mjs suppresses',
  'the row when the newest entry here names the CURRENT scan date with verdict',
  '"no-rebuild"; a newer scan brings the row back, because the match is on the date.',
  '',
  'APPEND, never rewrite: the history is the point. Written by refresh_review.mjs in',
  'the bus-work skill, which refuses a scan date that names no report on disk.',
  '',
  'Re-adjudicating one scan is a correction, not a second event, so it REPLACES that',
  'scan\'s entry — the board must find exactly one review per scan. The entry it',
  'displaces is kept in full, oldest first, in "superseded" on the entry that',
  'displaced it. Nothing this script writes is ever discarded (buses-data OA-290).',
  '',
  'A place has its OWN file. Adjudicating a town does not adjudicate a place inside',
  'it, whose frame is different and whose sheet draws a different set of services.',
];

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes('--' + name);
const die = (m) => { console.error('refresh_review: ' + m); process.exit(1); };

const mapDir = flag('map');
if (!mapDir) die('--map "<the map folder holding manifest.json>" is required');
if (!existsSync(path.join(mapDir, 'manifest.json')))
  die(`no manifest.json in ${mapDir} — --map wants the map's own folder, not its parent`);
const target = path.join(mapDir, FILE);

const load = () => {
  if (!existsSync(target)) return { _readme: README, reviews: [] };
  const j = JSON.parse(readFileSync(target, 'utf8'));
  if (!Array.isArray(j.reviews)) die(`${target} has no "reviews" array`);
  return j;
};

if (has('list')) {
  const j = load();
  if (!j.reviews.length) { console.log(`${target}: nothing recorded`); process.exit(0); }
  for (const r of j.reviews) {
    console.log(`  scan ${r.scan}  ${r.verdict.padEnd(14)} by ${r.by || '?'}  ${r.note || ''}`);
    // A superseded entry that only exists in the file is half a fix: the reason a
    // verdict was reversed has to be readable from the tool that reversed it.
    for (const s of r.superseded || [])
      console.log(`       superseded  ${(s.verdict || '?').padEnd(14)} by ${s.by || '?'}  ${s.note || ''}`);
  }
  process.exit(0);
}

const scan = flag('scan');
const verdict = flag('verdict');
if (!scan || !/^\d{4}-\d{2}-\d{2}$/.test(scan)) die('--scan <YYYY-MM-DD> is required, and must be a date');
if (!VERDICTS.includes(verdict)) die(`--verdict must be one of: ${VERDICTS.join(', ')}`);

/*
 * THE SCAN MUST EXIST. Walk up from the map folder for the `_gtfs/upcoming/` dir
 * rather than taking a second path argument: a second argument is a second thing to
 * get wrong, and the map is already inside the repo that holds the reports.
 */
let root = path.resolve(mapDir), up = null;
for (let i = 0; i < 8; i++) {
  const cand = path.join(root, '_gtfs', 'upcoming');
  if (existsSync(cand)) { up = cand; break; }
  const parent = path.dirname(root);
  if (parent === root) break;
  root = parent;
}
if (!up) die(`no _gtfs/upcoming/ directory above ${mapDir} — cannot check that scan ${scan} exists`);
const reports = readdirSync(up).filter((f) => /^upcoming-report_\d{4}-\d{2}-\d{2}\.md$/.test(f));
if (!reports.includes(`upcoming-report_${scan}.md`)) {
  die(`no scan report for ${scan} in ${up}\n`
    + `  A review of a scan that does not exist silences nothing today and would silence\n`
    + `  the WRONG row later, with no error anywhere. Reports on disk:\n`
    + reports.sort().slice(-5).map((f) => '    ' + f).join('\n'));
}

const j = load();
const entry = {
  scan,
  verdict,
  by: flag('by') || 'unknown',
  at: new Date().toISOString(),
};
const note = flag('note');
if (note) entry.note = note;
/*
 * Replace a review of the SAME scan rather than stacking duplicates — re-adjudicating
 * one scan is a correction, not a second event, and `worklist.mjs` suppresses on
 * (scan, verdict === 'no-rebuild') by finding ONE review per scan. Two entries for one
 * scan with opposite verdicts would leave the board's behaviour decided by whichever
 * one a `.find()` reached first, which is worse than either.
 *
 * BUT THE DISPLACED ENTRY IS KEPT, INSIDE THE ONE THAT DISPLACED IT (buses-data
 * OA-290). Until 2026-09-09 it was simply dropped, while the `_readme` this same
 * script stamps into the same file promised "APPEND, never rewrite: the history is
 * the point" — the file carried, in its own header, a promise about its contents that
 * the tool writing it did not keep. It cost a real note: `sched-0533` re-adjudicated
 * Huntingdon on 2026-09-09 and removed 900 characters explaining why that row had
 * stood for six days, recoverable afterwards only from commit `e1a5102`. An
 * adjudication note is not a status field — it is evidence somebody assembled, and
 * the reason a verdict was reversed is exactly what a later reader needs.
 *
 * `superseded[]` goes INSIDE the current entry rather than beside it so the join
 * `worklist.mjs` makes is untouched: still exactly one review per scan, still the
 * current verdict. Oldest first, and flat — a displaced entry's own chain is spliced
 * in ahead of it rather than nested, or a three-step reversal buries its middle.
 */
const was = j.reviews.findIndex((r) => r.scan === scan);
let displaced = null;
if (was >= 0) {
  const prev = j.reviews[was];
  const { superseded: chain, ...body } = prev;
  const history = [...(Array.isArray(chain) ? chain : []), body];
  if (history.length) entry.superseded = history;
  displaced = prev;
  j.reviews[was] = entry;
} else j.reviews.push(entry);
j.reviews.sort((a, b) => (a.scan < b.scan ? -1 : 1));
j._readme = README;
writeFileSync(target, JSON.stringify(j, null, 1) + '\n');
console.log(`${was >= 0 ? 'replaced' : 'recorded'} scan ${scan} as ${verdict} in ${target}`);
/*
 * SAY WHAT WAS DISPLACED. Printing "replaced scan X as no-rebuild" while silently
 * moving somebody else's reasoning out of view is the half that is indefensible under
 * any design — the only signal the 2026-09-09 loss ever gave was the word "replaced".
 */
if (displaced) {
  const note = displaced.note || '';
  console.log(`  it displaced: ${displaced.verdict} by ${displaced.by || '?'}`
    + (displaced.at ? ` at ${displaced.at}` : '')
    + (note ? ` — ${note.length} characters of note` : ' — no note'));
  if (note) console.log(`    "${note.length > 160 ? note.slice(0, 157) + '...' : note}"`);
  console.log(`  kept in full under superseded[] on the new entry (${entry.superseded.length} now), not dropped.`);
}
if (verdict === 'no-rebuild') console.log('  worklist.mjs will suppress this map\'s refresh row while that is the current scan.');
