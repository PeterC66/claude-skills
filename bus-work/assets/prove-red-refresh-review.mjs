#!/usr/bin/env node
/* Prove the refresh-review suppression can go quiet AND can come back (OA-205).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-refresh-review.mjs
 *
 * WHAT IS BEING FALSIFIED, and why both directions are mandatory. A `refresh` row is
 * a JOIN against the newest BODS scan report, so nothing could clear one except
 * rebuilding the map — which is what OA-205 was raised about, after all 40 High
 * Wycombe items were adjudicated to no-rebuild and the row came back unchanged.
 * `refresh-reviews.json` lets a map say the scan has been read. That introduces the
 * OPPOSITE failure, and it is the worse one: a suppression that never lifts is a
 * refresh row that has been silently deleted, and nobody would ever find out. So
 * every case here is a pair — make the state and see the row go, change the state
 * and see it come back.
 *
 * Written to the same shape as prove-red-commitments.mjs, which says the same thing
 * about reminders. Dates are relative to today rather than literals, for the reason
 * that file gives: a hardcoded date passes now and starts failing in a month for a
 * reason nobody remembers, and then gets deleted rather than understood.
 *
 * A throwaway buses tree, and --portal aimed at a directory that does not exist, so
 * the portal queues warn and skip: this tests one source, not six. With no portal
 * maps the row under test is the `refresh-local` one, which is the same suppression
 * on the same file.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'worklist.mjs');
const REVIEW = path.join(HERE, 'refresh_review.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-review-'));
let bad = 0;

const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const SCAN = dayOffset(0);
const OLDER = dayOffset(-30);
const NEWER = dayOffset(1);

/** A town the map tree can see: a manifest with one committed S4. */
function makeTown(name) {
  const dir = path.join(root, 'Areas', name);
  const run = path.join(dir, 'S4-generate', 'v1.0_' + OLDER + '_1200');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'routes.json'), JSON.stringify({ engine: 'deadbeef01' }));
  fs.writeFileSync(path.join(run, 'internal.svg'), '<svg/>');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    town: name,
    stages: {
      S1: { name: 'services', runs: [], latest: null },
      S2: { name: 'geometry', runs: [], latest: null },
      S3: { name: 'config', runs: [], latest: null },
      S4: { name: 'generate', runs: [{ id: 'v1.0_' + OLDER + '_1200', dir: 'S4-generate/v1.0_' + OLDER + '_1200', at: OLDER + 'T12:00:00Z', outputs: ['internal.svg'], version: '1.0' }], latest: 'v1.0_' + OLDER + '_1200' },
      S5: { name: 'render', runs: [], latest: null },
      S6: { name: 'verify', runs: [], latest: null },
    },
  }, null, 1));
  return dir;
}

/** A scan report naming those towns. */
function writeScan(date, towns) {
  const dir = path.join(root, '_gtfs', 'upcoming');
  fs.mkdirSync(dir, { recursive: true });
  const body = towns.map((t) => `## ${t} — 7 upcoming\n- 2026-09-01  service 1 changes days\n`).join('\n');
  fs.writeFileSync(path.join(dir, `upcoming-report_${date}.md`), `# Upcoming\n\n${body}`);
}

function rows() {
  const out = execFileSync('node', [TOOL, '--json', '--local', '--buses', root, '--portal', path.join(root, 'no-portal-here')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(out);
  return { items: j.items.filter((i) => i.type === 'refresh-local'), adjudicated: j.meta.adjudicated || [] };
}

function expect(label, key, present) {
  const { items } = rows();
  const hit = items.find((i) => i.key === key);
  const ok = present ? !!hit : !hit;
  console.log(`  ${ok ? (present ? 'ROW  ' : 'QUIET') : 'MISS '} ${label}`);
  if (!ok) {
    bad++;
    console.log(`        want ${present ? 'present' : 'absent'}; saw: ${items.map((i) => i.key).join(', ') || '(none)'}`);
  }
}

function reviewFile(townDir, obj) {
  fs.writeFileSync(path.join(townDir, 'refresh-reviews.json'), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
}
const clearReview = (townDir) => fs.rmSync(path.join(townDir, 'refresh-reviews.json'), { force: true });

console.log('\n== refresh-review suppression: does it go quiet, and does it come back? ==');

const dorking = makeTown('Dorking');
const epsom = makeTown('Epsom');
writeScan(SCAN, ['Dorking', 'Epsom']);

// 1. CONTROL. No review anywhere: both towns must print. A suppression test on a
//    tree where the rows never appeared would pass for the wrong reason.
expect('CONTROL: no review file, the row prints', 'refresh-local-Dorking', true);
expect('CONTROL: its neighbour prints too', 'refresh-local-Epsom', true);

// 2. THE ROW THIS EXISTS FOR: adjudicated against the CURRENT scan, no rebuild.
reviewFile(dorking, { reviews: [{ scan: SCAN, verdict: 'no-rebuild', by: 'test' }] });
expect('reviewed against the current scan, no-rebuild', 'refresh-local-Dorking', false);
expect('...and ONLY that town — the neighbour is untouched', 'refresh-local-Epsom', true);

// 3. Suppressed is not the same as deleted. It has to be counted out loud, or a
//    suppression that has gone wrong is invisible in the one place anyone reads.
{
  const { adjudicated } = rows();
  const named = adjudicated.some((a) => a.map === 'Dorking' && a.scan === SCAN);
  console.log(`  ${named ? 'SAID ' : 'MISS '} the suppression is reported, not silent`);
  if (!named) { bad++; console.log(`        meta.adjudicated held: ${JSON.stringify(adjudicated)}`); }
}

// 4. A review of an OLDER scan says nothing about this one. This is the case that
//    makes the whole mechanism safe: last month's reading must not silence today's.
reviewFile(dorking, { reviews: [{ scan: OLDER, verdict: 'no-rebuild', by: 'test' }] });
expect('reviewed against an OLDER scan — the row still prints', 'refresh-local-Dorking', true);

// 5. THE OTHER DIRECTION, and the one that matters most: a newer scan lands and the
//    row comes back, with the old review still sitting in the file.
reviewFile(dorking, { reviews: [{ scan: SCAN, verdict: 'no-rebuild', by: 'test' }] });
expect('...suppressed again against the current scan', 'refresh-local-Dorking', false);
writeScan(NEWER, ['Dorking', 'Epsom']);
expect('a NEWER scan lands — the row returns', 'refresh-local-Dorking', true);
fs.rmSync(path.join(root, '_gtfs', 'upcoming', `upcoming-report_${NEWER}.md`));

// 6. `rebuild-needed` is a verdict, not a silence. Somebody reading the scan and
//    concluding the map DOES need work must not thereby remove the row saying so.
reviewFile(dorking, { reviews: [{ scan: SCAN, verdict: 'rebuild-needed', by: 'test' }] });
expect('verdict rebuild-needed — the row stays', 'refresh-local-Dorking', true);

// 7. An unreadable review file must FAIL SAFE. Falling quiet on a parse error would
//    delete a row for a reason nobody could see.
reviewFile(dorking, '{ this is not json');
expect('malformed refresh-reviews.json — the row still prints', 'refresh-local-Dorking', true);
clearReview(dorking);

// ---- the writer, which is the only thing that should ever make one of these ----
console.log('\n== refresh_review.mjs: can it refuse? ==');

function writeAttempt(args) {
  try {
    const out = execFileSync('node', [REVIEW, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: String(out || '') };
  } catch (e) { return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }; }
}

// 8. A scan that does not exist. This is the failure that would be invisible: a
//    typo'd date silences nothing today and silences the WRONG thing later.
{
  const r = writeAttempt(['--map', dorking, '--scan', '2019-01-01', '--verdict', 'no-rebuild', '--by', 'test']);
  const ok = r.code !== 0 && /no scan report/.test(r.err);
  console.log(`  ${ok ? 'REFUSED' : 'MISS   '} a scan date with no report on disk`);
  if (!ok) { bad++; console.log(`        exit ${r.code}: ${(r.err || '').slice(0, 200)}`); }
}

// 9. A --map that is not a map. Pointing at a town's PARENT would write a file
//    nothing ever reads.
{
  const r = writeAttempt(['--map', path.join(root, 'Areas'), '--scan', SCAN, '--verdict', 'no-rebuild']);
  const ok = r.code !== 0 && /manifest\.json/.test(r.err);
  console.log(`  ${ok ? 'REFUSED' : 'MISS   '} a --map with no manifest.json in it`);
  if (!ok) { bad++; console.log(`        exit ${r.code}: ${(r.err || '').slice(0, 200)}`); }
}

// 10. An unknown verdict. Two spellings of "no rebuild" would make half the reviews
//     inert, and the row they failed to suppress looks exactly like an unread scan.
{
  const r = writeAttempt(['--map', dorking, '--scan', SCAN, '--verdict', 'fine', '--by', 'test']);
  const ok = r.code !== 0 && /--verdict must be one of/.test(r.err);
  console.log(`  ${ok ? 'REFUSED' : 'MISS   '} an unknown verdict`);
  if (!ok) { bad++; console.log(`        exit ${r.code}: ${(r.err || '').slice(0, 200)}`); }
}

// 11. CONTROL for the three refusals above: the good invocation must work, and the
//     row it writes must be the one worklist.mjs then acts on. Three refusals with
//     no accepted case would be satisfied by a script that refuses everything.
{
  const r = writeAttempt(['--map', dorking, '--scan', SCAN, '--verdict', 'no-rebuild', '--by', 'test', '--note', 'nothing drawn']);
  const wrote = r.code === 0 && fs.existsSync(path.join(dorking, 'refresh-reviews.json'));
  console.log(`  ${wrote ? 'WROTE  ' : 'MISS   '} CONTROL: the good invocation is accepted`);
  if (!wrote) { bad++; console.log(`        exit ${r.code}: ${(r.err || '').slice(0, 200)}`); }
}
expect('...and the row it wrote is the one the worklist honours', 'refresh-local-Dorking', false);

/* ---- the history a re-adjudication displaces (buses-data OA-290) ----------
 *
 * `refresh_review.mjs` REPLACES a review of the same scan, and it must: worklist.mjs
 * suppresses on (scan, verdict === 'no-rebuild') by finding ONE review per scan, and
 * two entries for one scan with opposite verdicts would leave the board's behaviour
 * decided by whichever `.find()` reached first. But until 2026-09-09 the replaced
 * entry was DROPPED, while the `_readme` the same script stamps into the same file
 * promised "APPEND, never rewrite: the history is the point". One real note went that
 * way — 900 characters explaining why Huntingdon's row had stood for six days,
 * recoverable afterwards only from commit e1a5102.
 *
 * So the cases below are about the RECORD, not the verdict: the displaced entry has
 * to survive inside the entry that displaced it, the chain has to keep accumulating,
 * the tool has to say out loud what it is displacing, and none of it may change what
 * worklist.mjs joins on. The bug's whole signature was that nothing failed, so each
 * case was watched go red against the pre-fix script before the fix was written.
 */
console.log('\n== what happens to the adjudication a re-adjudication replaces? ==');

const NOTE_1 = '400 and AW1 are an open curation decision parked on 2026-07-12 — the row must stay up';
const NOTE_2 = 'AW1 is now in the displayed set and 400 has a structured notOnLeaflet entry';
const NOTE_3 = 'third reading, and the two above must both still be here';

const readReviews = (townDir) => JSON.parse(fs.readFileSync(path.join(townDir, 'refresh-reviews.json'), 'utf8'));
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'KEPT ' : 'LOST '} ${label}`);
  if (!ok) { bad++; console.log(`        ${detail}`); }
};

clearReview(dorking);
// The writer refuses a scan with no report on disk (case 8), so the second scan
// these cases use needs one. It is OLDER than the current report, which is what
// worklist.mjs reads, so nothing above changes behaviour.
writeScan(OLDER, ['Dorking', 'Epsom']);

// 12. CONTROL, and it has to come first: a FIRST review of a scan carries no
//     `superseded` key at all. Without this, a tool that stamped an empty array on
//     every entry would satisfy every case below.
{
  writeAttempt(['--map', dorking, '--scan', OLDER, '--verdict', 'no-rebuild', '--by', 'test', '--note', 'a different scan entirely']);
  const r = writeAttempt(['--map', dorking, '--scan', SCAN, '--verdict', 'rebuild-needed', '--by', 'buses-7f', '--note', NOTE_1]);
  const j = readReviews(dorking);
  const cur = j.reviews.find((x) => x.scan === SCAN);
  const ok = r.code === 0 && cur && !('superseded' in cur);
  check('CONTROL: a first review of a scan has no superseded[] on it', ok,
    `exit ${r.code}; entry was ${JSON.stringify(cur)}`);
}

// 13. THE CASE OA-290 WAS RAISED FOR. Re-adjudicate the SAME scan the other way, and
//     the reasoning behind the verdict being overturned must still be in the file.
//     Losing it is not a lost status field: it is the evidence somebody assembled,
//     and the reason a verdict was reversed is exactly what a later reader needs.
{
  const r = writeAttempt(['--map', dorking, '--scan', SCAN, '--verdict', 'no-rebuild', '--by', 'sched-0533', '--note', NOTE_2]);
  const j = readReviews(dorking);
  const cur = j.reviews.find((x) => x.scan === SCAN);
  const sup = (cur && cur.superseded) || [];
  check('the displaced note survives inside the entry that displaced it',
    r.code === 0 && sup.length === 1 && sup[0].note === NOTE_1 && sup[0].verdict === 'rebuild-needed' && sup[0].by === 'buses-7f',
    `exit ${r.code}; superseded[] was ${JSON.stringify(sup)}`);

  // 14. And the tool must SAY what it displaced. Printing "replaced scan X as
  //     no-rebuild" while silently discarding 900 characters of somebody else's
  //     reasoning is the half that is indefensible under either design.
  const said = /rebuild-needed/.test(r.out) && /buses-7f/.test(r.out);
  check('the tool names the verdict and the author it displaced, on stdout', said,
    `stdout was: ${JSON.stringify(r.out)}`);
}

// 15. The join worklist.mjs makes is UNCHANGED — still exactly one review per scan,
//     so the board reads the current verdict and not a superseded one. This is the
//     whole reason the history goes inside the entry rather than beside it.
{
  const j = readReviews(dorking);
  const forScan = j.reviews.filter((x) => x.scan === SCAN);
  check('still exactly ONE review entry for that scan', forScan.length === 1,
    `saw ${forScan.length}: ${JSON.stringify(j.reviews.map((x) => x.scan))}`);
}
expect('...and the board honours the CURRENT verdict, not the superseded one', 'refresh-local-Dorking', false);

// 16. A THIRD reading keeps BOTH earlier ones. A chain that only ever holds the
//     immediately-previous entry loses the middle of a three-step reversal, which is
//     the same bug one step further along.
{
  const r = writeAttempt(['--map', dorking, '--scan', SCAN, '--verdict', 'rebuild-needed', '--by', 'test', '--note', NOTE_3]);
  const cur = readReviews(dorking).reviews.find((x) => x.scan === SCAN);
  const notes = ((cur && cur.superseded) || []).map((s) => s.note);
  check('a third adjudication keeps BOTH earlier notes, oldest first',
    r.code === 0 && notes.length === 2 && notes[0] === NOTE_1 && notes[1] === NOTE_2,
    `exit ${r.code}; superseded notes were ${JSON.stringify(notes)}`);
  check('...and a superseded entry does not nest its own superseded[]',
    ((cur && cur.superseded) || []).every((s) => !('superseded' in s)),
    `superseded[] was ${JSON.stringify((cur && cur.superseded) || [])}`);
}

// 17. A review of a DIFFERENT scan is untouched by all of that. The unit of
//     supersession is one scan, and the file's other adjudications are other events.
{
  const other = readReviews(dorking).reviews.find((x) => x.scan === OLDER);
  check('a review of a different scan keeps its own note and gains nothing',
    !!other && other.note === 'a different scan entirely' && !('superseded' in other),
    `entry was ${JSON.stringify(other)}`);
}
clearReview(dorking);

fs.rmSync(root, { recursive: true, force: true });
if (bad) { console.log(`\n${bad} case(s) behaved wrongly.`); process.exit(1); }
console.log('\nAll cases behaved: the row goes quiet when the scan has been read, and comes back when a new one lands.');
