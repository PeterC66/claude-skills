// P3 helper — derive `frequency` + `design.frequencyTiers` (the line-weight tiers)
// for a PLACE map, from the S1 fields the place's own `gtfs-services.json` already
// carries.
//
// WHY THIS EXISTS
// The tier model was decided on 2026-08-17 (`Development Docs/frequency-tier-model_
// 2026-08-17.md`) and adopted on all eight TOWNS. Its config emitter,
// `measure_frequency_tiers_2026-08-17.py --emit-config`, is driven by
// `_gtfs/town_prefixes.json` and so can only ever speak for a town. Places were
// left with no route to the keys at all: as of 2026-08-23 exactly one of twelve
// (St Ives Bus Station, hand-set after Peter's review) carried them, and the other
// eleven drew every service at the same 1.7 mm — not because the engine lacks the
// feature but because nothing wrote the key. Same shape as the exit labels that
// `derive_termini.js` exists to fix, and it sits beside it for that reason.
//
// WHY IT READS S1 RATHER THAN GTFS
// The town measurer is a second implementation written from the GTFS spec, whose
// point is to be an independent check on `gtfs_query.py`. That check has been run
// and passed (791 comparisons). Re-implementing it a third time here would add a
// way to disagree, not a way to be right — and a place's `gtfs-services.json` is
// already measured over THAT PLACE'S OWN radius, which is the number a place map
// needs and a town-wide figure is not. `frequencyBasis.note` in every place's S1
// output names the exact fields to tier on:
//
//     "use coreHeadwayMinutes and longestDaytimeGap with a weeksActive floor,
//      not journeysPerWeek: a weekly total is a volume, not availability"
//
// so this file is that sentence, executed.
//
// THE RULE, unchanged from the town model's `tier_reliance()` + `word()`:
//   weeksActive < 6                         -> sparse   (cannot hold a weekly rate)
//   first > 09:30, or last < 15:30, or a
//     midday hole > 150 min                 -> limited  (promoted to sparse when the
//                                                        reason is "certain dates only"
//                                                        or "a few journeys a day")
//   otherwise, median core gap <= 30 min    -> frequent
//   otherwise                               -> all-day
//
// A service DRAWN on the sheet but absent from GTFS (community and pre-book
// services — St Neots' 112 and 193, Wisbech's `excel` and `46L`) is left
// UNCLASSIFIED rather than guessed at. That is the precedent the town rollout set:
// assigning them is a judgement, not a default, and an unclassified lane keeps
// today's 1.7 mm.
//
// Usage — run from the stage folder that holds routes.json (P3's S3 dir, or an S4
// dir after `pull`), exactly like derive_termini.js:
//     node derive_frequency.js                report only, writes nothing
//     node derive_frequency.js --write        merge into routes.json
//     node derive_frequency.js --write --force overwrite a hand-set frequency map
// Reads routes.json and gtfs-services.json from the CURRENT directory (--dir to
// point elsewhere). Never hits the network, never opens a database.
'use strict';
const fs = require('fs');
const path = require('path');
// The town engine's collision guard. Sibling-relative first, absolute only as a
// fallback -- a bare absolute path resolves on this laptop and nowhere else.
const { assertNoCollision } = (() => {
  const sibling = path.join(__dirname, '..', '..', 'make-bus-leaflet', 'assets', 'index_guard.js');
  try { return require(fs.existsSync(sibling) ? sibling
    : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/index_guard.js'); }
  catch (e) { return { assertNoCollision: () => {} }; }
})();

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const WRITE = has('--write'), FORCE = has('--force');
const DIR = path.resolve(val('--dir', '.'));

// The settled styles, copied from measure_frequency_tiers_2026-08-17.py's TIER_STYLE
// so a place's sheet and its town's sheet draw the same tier at the same weight.
// Only the classes a map actually uses are emitted, which is what every town does.
const TIER_STYLE = {
  'frequent': { mm: 2.2 },
  'all-day': { mm: 1.7 },
  'limited': { mm: 1.2 },
  'sparse': { mm: 1.2, dash: '2.4 2.2', label: 'Certain dates only' },
};
const SPARSE_WORDS = new Set(['certain dates only', 'a few journeys a day']);

const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
let RJ, S1;
try {
  RJ = rd('routes.json');
  S1 = rd('gtfs-services.json');
} catch (e) {
  console.error('derive_frequency: ' + e.message);
  console.error('  needs routes.json and gtfs-services.json in ' + DIR);
  process.exit(1);
}

function hhmm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

// The phrase a limited lane would carry in the Services panel. Reproduced from the
// town model's word() in the SAME ORDER, because the order is what decides which
// limited lanes are promoted to sparse — "daytime only" is tested before "a few
// journeys a day", so a two-journey shopping bus stays solid and only a lane with no
// daytime shape at all takes the dash.
function word(r) {
  if (r.wks != null && r.wks < 6) return 'certain dates only';
  if (r.day === 0) return 'not on weekdays';
  if (r.worst != null && r.worst >= 240) return 'morning and evening only';
  const f = r.win[0] || '', l = r.win[1] || '';
  if (f >= '09:00' && l <= '15:30') return 'daytime only';
  if (r.day != null && r.day <= 4) return 'a few journeys a day';
  if (f > '09:30') return 'from mid-morning';
  if (l < '15:30') return 'ends mid-afternoon';
  if (r.worst != null && r.worst > 150) return 'gaps of over two hours';
  return '';
}

// WHICH LANES ARE MEASURABLE AT ALL (OA-019, 2026-08-29).
//
// tier() and word() read five fields that only gtfs_query.py writes:
// weeksActive, typicalDayJourneys, coreHeadwayMinutes, longestDaytimeGap and
// typicalDayWindow. A place's S1 predates them if it was built by an older
// gtfs_chains.py, and three of the twelve places on the estate still are --
// Beaconsfield Simpson Centre, Beaconsfield Waitrose and High Wycombe Aldi, whose
// gtfs-services.json carries tripsAtTownPerWeekSample and no frequencyBasis.
//
// Fed one of those, this file did not fail. tier() saw a null window and returned
// 'limited'; word() compared the EMPTY STRING against '15:30', found it lower, and
// returned "ends mid-afternoon". Every lane on all three sheets came out limited,
// with a reason, from no data at all -- and --write would have drawn all 22 of them
// at the 1.2 mm limited weight and printed a one-row Key saying so. That is a false
// claim in ink, which is worse than the 1.7 mm default it would have replaced.
//
// The test is for the KEY, not its value: 'weeksActive' in s, not s.weeksActive !=
// null. St Ives Bus Station's 301S measures weeksActive 12 and typicalDayWindow
// ['',''] -- a real measurement of a service that does not run on weekdays -- and a
// value test would have thrown that away with the schema-less ones.
//
// The fix for an unmeasured place is to re-run its P1 against the current engine,
// not to widen this. Both High Wycombe boarding places already carry the fields, so
// the Buckinghamshire feed produces them; only these three S1 runs are old.
const FREQ_FIELDS = ['weeksActive', 'typicalDayJourneys', 'coreHeadwayMinutes', 'longestDaytimeGap', 'typicalDayWindow'];
function measurable(s) { return FREQ_FIELDS.every((k) => k in s); }

function tier(r) {
  if (r.wks != null && r.wks < 6) return 'limited';
  const f = hhmm(r.win[0]), l = hhmm(r.win[1]);
  if (f == null || l == null) return 'limited';
  const allDay = f <= 9 * 60 + 30 && l >= 15 * 60 + 30 && r.worst != null && r.worst <= 150;
  if (!allDay) return 'limited';
  return (r.head != null && r.head <= 30) ? 'frequent' : 'all-day';
}

// Drawn lanes = the palette keys, which is what gen_internal.js strokes. A place has
// no internalCorridors, so lane and route are the same thing here; if that ever
// changes this is the line to revisit.
const lanes = Object.keys(RJ.palette || {});
if (!lanes.length) {
  console.error('derive_frequency: routes.json has no palette — nothing is drawn, nothing to tier');
  process.exit(1);
}

const byRoute = new Map();
for (const s of (S1.services || [])) byRoute.set(String(s.route), s);
// A place's service list carries NO `key` field -- measured 2026-08-28, 0 of 12
// places have one -- so this genuinely is keyed on the route number, and two
// same-numbered routes serving one place would silently become one tier. No place
// has that today; this line is what will say so when one does. See OA-134.
assertNoCollision(byRoute, (S1.services || []), 'derive_frequency S1 services');

const place = S1.town || RJ.placeShort || RJ.town || path.basename(DIR);
const basis = S1.frequencyBasis || {};
console.log('# Frequency-tier derivation — ' + place);
console.log('  ' + lanes.length + ' drawn lane(s); S1 sampled ' + (basis.weeksSampled != null ? basis.weeksSampled : '?') +
  ' weeks' + (basis.from ? ' from ' + basis.from : '') + '\n');
console.log('  lane    wks  day  head  worst  window          -> tier      (why)');

const freq = {};
const skipped = [];
const unmeasured = [];
for (const lane of lanes) {
  const s = byRoute.get(lane);
  if (!s) { skipped.push(lane); continue; }
  // Present in GTFS, but this S1 cannot say how often it runs. Left out of the map
  // entirely rather than tiered, so the lane keeps the default weight and the sheet
  // makes no claim -- see measurable() above.
  if (!measurable(s)) { unmeasured.push(lane); continue; }
  const r = {
    wks: s.weeksActive,
    day: s.typicalDayJourneys,
    head: s.coreHeadwayMinutes,
    worst: s.longestDaytimeGap,
    win: Array.isArray(s.typicalDayWindow) ? s.typicalDayWindow : ['', ''],
  };
  let t = tier(r);
  const w = word(r);
  if (t === 'limited' && SPARSE_WORDS.has(w)) t = 'sparse';
  freq[lane] = t;
  const pad = (v, n) => String(v == null ? '-' : v).padStart(n);
  console.log('  ' + lane.padEnd(7) + pad(r.wks, 3) + pad(r.day, 5) + pad(r.head, 6) + pad(r.worst, 7) +
    '  ' + (r.win[0] + '-' + r.win[1]).padEnd(14) + '-> ' + t.padEnd(9) + ' ' + (t === 'frequent' || t === 'all-day' ? '' : '(' + w + ')'));
}

const used = new Set(Object.values(freq));
const tiers = {};
for (const k of Object.keys(TIER_STYLE)) if (used.has(k)) tiers[k] = TIER_STYLE[k];

console.log('\n  ' + Object.keys(freq).length + ' of ' + lanes.length + ' drawn lane(s) tiered; classes used: ' +
  (Object.keys(tiers).join(', ') || 'none'));
if (skipped.length) {
  console.log('  ! not in GTFS, left UNCLASSIFIED (they keep the default 1.7 mm): ' + skipped.join(', '));
  console.log('    Community and pre-book services are a judgement, not a default — set them by hand if wanted.');
}
if (unmeasured.length) {
  console.log('  ! S1 carries no frequency fields for these, left UNCLASSIFIED: ' + unmeasured.join(', '));
  console.log('    Their gtfs-services.json predates ' + FREQ_FIELDS.join('/') + '.');
  console.log('    Re-run this place\'s P1 against the current engine, then re-run this.');
}
if (!Object.keys(freq).length) {
  console.error('\nderive_frequency: not one lane could be tiered' +
    (unmeasured.length ? ' — this place\'s S1 predates the frequency fields' +
      (S1.frequencyBasis ? '' : ' (it has no frequencyBasis either)') + '.' : '.'));
  console.error('  Refusing rather than reporting a tier nothing measured. Re-run P1 for ' + place + ' first.');
  process.exit(2);
}

if (!WRITE) {
  console.log('\n  Report only. Re-run with --write to merge into routes.json.');
  process.exit(0);
}

const hadFreq = RJ.frequency && Object.keys(RJ.frequency).length;
if (hadFreq && !FORCE) {
  console.error('\nderive_frequency: routes.json already carries a frequency map (' + Object.keys(RJ.frequency).length +
    ' entries) — refusing to overwrite. Re-run with --force if that is what you want.');
  process.exit(1);
}
RJ.frequency = freq;
RJ.design = RJ.design || {};
RJ.design.frequencyTiers = tiers;
fs.writeFileSync(path.join(DIR, 'routes.json'), JSON.stringify(RJ, null, 2) + '\n');
console.log('\n  Written into ' + path.join(DIR, 'routes.json') + (hadFreq ? ' (previous map overwritten)' : ''));
