#!/usr/bin/env node
/*
 * curate_services.js — RUNG 0 (and the rung-1 starting point) of the complexity
 * ladder, made actionable.
 *
 *   node curate_services.js [--dir <S2 run dir>] [--apply] [--overlap 0.6]
 *
 * complexity_score.js already FINDS the remedies; this turns them into the two
 * config edits a town actually needs, so the judgement does not have to be
 * retyped from a printed report:
 *
 *   rung 0  the services below the FREQUENCY CLIFF        -> match_cfg.json
 *           (school / works / match-day / market-day)        "skipRoutes"
 *                                                          + a routes.json
 *                                                            "mapNotes" entry
 *                                                            naming them, so the
 *                                                            sheet still tells the
 *                                                            reader they exist
 *   rung 1  the co-running families                       -> routes.json
 *                                                            "internalCorridors"
 *
 * WHAT IT WILL AND WILL NOT WRITE
 *   --apply writes ONLY match_cfg.json skipRoutes (idempotent union). Everything
 *   else is printed for you to paste. That split is deliberate:
 *     - skipRoutes is reversible, mechanical, and its effect is re-measurable by
 *       simply re-running match_routes.js + complexity_score.js;
 *     - internalCorridors is a CLAIM about the real world ("these services run
 *       together"), and the detector only offers candidates. A wrong family
 *       makes the map state something false, so a human confirms it.
 *
 * ORDER OF OPERATIONS (rung 0 changes the geometry, so nothing downstream is
 * valid until S2 is re-run):
 *     node curate_services.js --apply
 *     node match_routes.js                # re-match without the dropped services
 *     node complexity_score.js            # re-score: did rung 0 do enough?
 *
 * The frequency cliff and the families come from complexity_score.js, which is
 * spawned here rather than reimplemented — the gate and the tooling that acts on
 * it must never disagree about what they are looking at.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function die(msg) { console.error('curate_services: ' + msg); process.exit(1); }

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = name => argv.includes('--' + name);

const dir = path.resolve(opt('dir', process.cwd()));
const apply = has('apply');
const overlap = opt('overlap', null);
if (!fs.existsSync(dir)) die('no such directory: ' + dir);

// ---------------------------------------------------------------- score
const scorer = path.join(__dirname, 'complexity_score.js');
if (!fs.existsSync(scorer)) die('complexity_score.js not found beside this script');

const args = [scorer, '--dir', dir, '--json', '--no-fail'];
if (overlap) args.push('--overlap', overlap);
let score;
try {
  score = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
} catch (e) {
  die('complexity_score.js failed: ' + (e.stderr || e.message));
}

const rung = n => (score.ladder || []).find(l => String(l.rung) === String(n));
const r0 = rung(0), r1 = rung(1);

// The town name is only needed for the note wording; routes.json is S3's, so it
// may legitimately not be here yet.
let town = null;
try { town = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8')).town; } catch (e) {}
if (!town) { const m = /([^\\/]+)[\\/]S\d/.exec(dir); town = m ? m[1] : 'the town'; }

// ---------------------------------------------------------------- report
console.log('');
console.log('CURATE SERVICES   ' + score.band +
  '   R=' + score.metrics.R + ' S=' + score.metrics.S +
  ' K5=' + score.metrics.K5 + ' D5=' + score.metrics.D5);
console.log('  ' + dir);
if (score.geometryApproximate) {
  console.log('  WARNING: straight-line geometry — run pull_roads.js + match_routes.js');
  console.log('           first, or the families below are guesswork.');
}
console.log('');

if (score.band === 'GREEN') {
  console.log('  GREEN: this town needs no curation. Build normally.');
  console.log('');
  process.exit(0);
}

// ---- rung 0 ---------------------------------------------------------------
const mcfgPath = path.join(dir, 'match_cfg.json');
let mcfg = null;
try { mcfg = JSON.parse(fs.readFileSync(mcfgPath, 'utf8')); } catch (e) {}
const existingSkip = (mcfg && mcfg.skipRoutes) || [];

if (!r0 || !r0.data || !r0.data.below || !r0.data.below.length) {
  console.log('RUNG 0 — no frequency cliff found.');
  console.log('  Either the town has no natural break in trips/week, or');
  console.log('  verified-services.json (S1) is not reachable from this run dir.');
  console.log('  Curate by hand if the service list still looks too long.');
} else {
  const below = r0.data.below;
  const add = below.filter(r => !existingSkip.includes(r));
  console.log('RUNG 0 — frequency cliff at ' + r0.data.cliffAt + ' -> ' + r0.data.cliffNext +
    ' trips/week (' + r0.data.ratio + 'x jump)');
  console.log('  drop from the map: ' + below.join(', '));
  console.log('  predicted after:   R=' + r0.after.R + ' S=' + r0.after.S +
    ' K5=' + r0.after.K5 + ' D5=' + r0.after.D5 + '   ' + r0.band);
  console.log('');
  console.log('  CHECK EACH ONE before applying. Below the cliff is usually the');
  console.log('  school/works/match-day/market-day set, but a genuinely useful');
  console.log('  once-a-week shopper bus lives down there too — dropping its LINE');
  console.log('  is fine, dropping it from the reader\'s awareness is not, which is');
  console.log('  what the map note below is for.');
  console.log('');
  console.log('  match_cfg.json:');
  console.log('    "skipRoutes": ' + JSON.stringify([...new Set(existingSkip.concat(below))]));
  console.log('');
  console.log('  routes.json — name them on the sheet so they are not simply lost:');
  const note = 'Also serving ' + town + ': ' + below.join(', ') +
    ' (limited services — see bustimes.org for times)';
  console.log('    "mapNotes": [ ' + JSON.stringify({ x: 8, y: 192, text: note, size: 2.4 }) + ' ]');
  console.log('    (position x/y to a clear corner of YOUR sheet — check the S5 JPG)');
  console.log('');

  if (apply) {
    if (!mcfg) die('--apply needs match_cfg.json in ' + dir + ' (S2 config)');
    if (!add.length) {
      console.log('  --apply: skipRoutes already covers all of them, nothing written.');
    } else {
      mcfg.skipRoutes = [...new Set(existingSkip.concat(below))];
      fs.writeFileSync(mcfgPath, JSON.stringify(mcfg, null, 2));
      console.log('  --apply: wrote skipRoutes (+' + add.join(', ') + ') to match_cfg.json');
      console.log('           NOW RE-RUN  node match_routes.js  then  node complexity_score.js');
    }
    console.log('');
  }
}

// ---- rung 1 ---------------------------------------------------------------
console.log('RUNG 1 — co-running families (CANDIDATES, confirm every one)');
if (!r1 || !r1.data || !r1.data.families || !r1.data.families.length) {
  console.log('  none detected at overlap >= ' + (overlap || 0.6) + '.');
  console.log('  Lower --overlap to see weaker candidates, but a weak family is a');
  console.log('  bundle that splits apart across half the sheet.');
} else {
  for (const f of r1.data.families) console.log('    ' + f.join(' / ') + '   lead = ' + f[0]);
  console.log('  predicted after:   R=' + r1.after.R + ' S=' + r1.after.S +
    ' K5=' + r1.after.K5 + ' D5=' + r1.after.D5 + '   ' + r1.band);
  console.log('');
  console.log('  routes.json:');
  console.log('    "internalCorridors": ' +
    JSON.stringify(r1.data.internalCorridors, null, 2).split('\n').join('\n    '));
  console.log('');
  console.log('  Then re-run gen_internal.js: it writes corridors_report.json with the');
  console.log('  share of each member\'s DRAWN length that really is on the bundle, and');
  console.log('  warns below 60%. Drop any family that warns.');
}
console.log('');
console.log('  (rungs 2 / 2b / 3 are judgement calls, not config this script can');
console.log('   propose — see references/complexity-triage.md)');
console.log('');
