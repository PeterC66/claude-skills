// Falsifies complexity_band.mjs (buses-data OA-088) on a scratch map tree.
//
//   node assets/prove-red-complexity-band.mjs      (or: npm run test:prove-red-complexity-band)
//
// Each case is a town folder built to be wrong in one way, plus the controls
// that must stay right. The assertions that matter most are the two that say
// NOTHING: a town with no score must come back null and never a guessed band,
// and an item that is not an area request must come back byte-identical.
//
// Node builtins only; no install, no network, no real map tree.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotateRequest, bandForTownDir, bandSentence, bandStep } from './complexity_band.mjs';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const root = mkdtempSync(path.join(os.tmpdir(), 'bw-complexity-'));
const town = (name, { runs = [], latest = null, manifest = true } = {}) => {
  const dir = path.join(root, 'Areas', name);
  mkdirSync(dir, { recursive: true });
  const stages = { S2: { name: 'geometry', latest, runs: runs.map((r) => ({ id: r.id, dir: `S2-geometry/${r.id}` })) } };
  if (manifest) writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ town: name, stages }));
  for (const r of runs) {
    const rd = path.join(dir, 'S2-geometry', r.id);
    mkdirSync(rd, { recursive: true });
    if (r.score !== undefined) writeFileSync(path.join(rd, 'complexity.json'), typeof r.score === 'string' ? r.score : JSON.stringify(r.score));
  }
  return dir;
};

console.log('\nbandForTownDir — the newest S2 run by the MANIFEST, and null for everything it cannot vouch for');

const red = town('Redham', { latest: '2026-09-01_0000', runs: [{ id: '2026-09-01_0000', score: { band: 'RED', failedThresholds: ['D5=3.7 > 3.5'], scoredAt: '2026-09-01 10:00' } }] });
eq('a RED town reports RED, the measure and the date', bandForTownDir(red), { band: 'RED', failed: ['D5=3.7 > 3.5'], scoredAt: '2026-09-01 10:00', run: '2026-09-01_0000' });

// The manifest's latest wins over directory order: an OLDER run that sorts later
// by name (a v1.9 / v1.15 shape) must not be the one read.
const twoRuns = town('Twinford', {
  latest: '2026-08-02_0000',
  runs: [
    { id: '2026-08-02_0000', score: { band: 'GREEN', failedThresholds: [] } },
    { id: '2026-08-09_0000', score: { band: 'RED', failedThresholds: ['R=20 > 18'] } },   // sorts later, is NOT latest
  ],
});
eq('the manifest names the run, not the directory sort', bandForTownDir(twoRuns).band, 'GREEN');

eq('a town with no manifest is null', bandForTownDir(path.join(root, 'Areas', 'Nowhere')), null);
eq('…and so is one with a manifest and no S2 run', bandForTownDir(town('Unstarted', { manifest: true })), null);
eq('…and one whose latest S2 run holds no score', bandForTownDir(town('Unscored', { latest: 'r1', runs: [{ id: 'r1' }] })), null);
eq('…and one whose score is not JSON', bandForTownDir(town('Garbled', { latest: 'r1', runs: [{ id: 'r1', score: 'nope' }] })), null);
eq('…and a band the gate never writes is null rather than passed through',
  bandForTownDir(town('Purple', { latest: 'r1', runs: [{ id: 'r1', score: { band: 'PURPLE' } }] })), null);
eq('non-string thresholds are dropped',
  bandForTownDir(town('Odd', { latest: 'r1', runs: [{ id: 'r1', score: { band: 'AMBER', failedThresholds: ['P=64 > 42', 3] } }] })).failed, ['P=64 > 42']);

console.log('\nthe sentence and the step say the right thing for each answer');
check('UNSCORED is said in that word', /UNSCORED/.test(bandSentence(null, 'Nowhere')));
check('…and its step is to run S1 and S2 only, without spending quota', /S1 and S2 only/.test(bandStep(null, 'Nowhere').what) && /no quota/.test(bandStep(null, 'Nowhere').what));
check('RED is named as the stop verdict and ties it to the quota slot', /RED/.test(bandSentence(bandForTownDir(red), 'Redham')) && /quota/.test(bandSentence(bandForTownDir(red), 'Redham')));
check('…and its step asks for a strategy before approving', /Before approving/.test(bandStep(bandForTownDir(red), 'Redham').what) && /OA-089/.test(bandStep(bandForTownDir(red), 'Redham').what));
check('GREEN says there is nothing to decide', /nothing to decide/.test(bandStep({ band: 'GREEN', failed: [], scoredAt: null, run: 'r' }, 'X').what));

console.log('\nannotateRequest — only an AREA request or build item, and never in place');
const townDirFor = (name) => (name === 'Redham' ? red : null);
const item = { key: 'request-7', type: 'request-decision', title: 't', why: 'Somebody asked.', do: [{ kind: 'portal-ui', what: 'Approve', url: 'u' }] };
const frozen = JSON.stringify(item);
const out = annotateRequest(item, { kind: 'area', name: 'Redham' }, townDirFor);
eq('the band is on the item', out.band, 'RED');
check('the why gains the sentence, after the portal\'s own', out.why.startsWith('Somebody asked. ') && /RED/.test(out.why));
eq('the band step goes FIRST, ahead of the portal\'s steps', out.do.map((d) => d.kind), ['chat', 'portal-ui']);
eq('…and the input item is untouched', JSON.stringify(item), frozen);

const unscored = annotateRequest({ ...item, key: 'build-8', type: 'build' }, { kind: 'area', name: 'Nowhere' }, townDirFor);
eq('an unscored area BUILD item is annotated too, with null band', unscored.band, null);
check('…and told how to score it', unscored.do[0].kind === 'skill' && /S1 and S2 only/.test(unscored.do[0].what));

eq('a PLACE request comes back identical', annotateRequest(item, { kind: 'place', name: 'Aldi' }, townDirFor), item);
eq('an item of another type comes back identical', annotateRequest({ ...item, type: 'review' }, { kind: 'area', name: 'Redham' }, townDirFor), { ...item, type: 'review' });
eq('an item whose map is unknown comes back identical', annotateRequest(item, null, townDirFor), item);

console.log('\nthe WIRE in worklist.mjs — the module was right and the first wiring never matched a key');
// The edit script that wired this into worklist.mjs wrote the key regex through
// a template literal, which turned `\d` into `d`; `node --check` was silent, the
// module's own assertions above all passed, and no request row on the real
// worklist gained a band until an end-to-end probe was run. The wire is outside
// the module, so the module's harness cannot see it — assert its source.
const wire = readFileSync(new URL('./worklist.mjs', import.meta.url), 'utf8');
check('worklist.mjs imports annotateRequest', /import \{ annotateRequest \} from '\.\/complexity_band\.mjs'/.test(wire));
check('…and matches the portal key with a DIGIT class, not the letter d', wire.includes('/^(?:request|build)-(\\d+)$/'));
check('…and calls it on every portal item before adding', /annotateRequest\(it0, portalMapById\.get\(mapId\[1\]\)/.test(wire));

console.log(failures ? `\n${failures} FAILED\n` : '\nAll complexity-band assertions pass.\n');
process.exit(failures ? 1 : 0);
