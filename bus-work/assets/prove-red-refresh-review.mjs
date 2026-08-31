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
    execFileSync('node', [REVIEW, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0 };
  } catch (e) { return { code: e.status, err: String(e.stderr || '') }; }
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

fs.rmSync(root, { recursive: true, force: true });
if (bad) { console.log(`\n${bad} case(s) behaved wrongly.`); process.exit(1); }
console.log('\nAll cases behaved: the row goes quiet when the scan has been read, and comes back when a new one lands.');
