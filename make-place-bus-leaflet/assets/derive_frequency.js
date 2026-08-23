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

const place = S1.town || RJ.placeShort || RJ.town || path.basename(DIR);
const basis = S1.frequencyBasis || {};
console.log('# Frequency-tier derivation — ' + place);
console.log('  ' + lanes.length + ' drawn lane(s); S1 sampled ' + (basis.weeksSampled != null ? basis.weeksSampled : '?') +
  ' weeks' + (basis.from ? ' from ' + basis.from : '') + '\n');
console.log('  lane    wks  day  head  worst  window          -> tier      (why)');

const freq = {};
const skipped = [];
for (const lane of lanes) {
  const s = byRoute.get(lane);
  if (!s) { skipped.push(lane); continue; }
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
