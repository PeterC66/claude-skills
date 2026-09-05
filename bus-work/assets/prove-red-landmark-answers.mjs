#!/usr/bin/env node
/* Prove the landmark-answer rows can appear AND can go away (buses-data OA-233).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-landmark-answers.mjs
 *
 * WHAT IS BEING FALSIFIED. Two rows over one join: the portal's landmark answer
 * against a town's source S3, and the source S3 against the latest build S4. Both
 * exist because a customer's answer sat committed and unbuilt for two days with
 * every board green. Each case here is a PAIR — make the state and see the row,
 * clear the state and see the row go — because a row that never clears is a row
 * that gets ignored, and that is the failure this whole source exists to prevent.
 *
 * THREE THINGS ARE ASSERTED, NOT ONE. (1) The pure function, driven with fake
 * readers, on every branch. (2) The rule it leans on: an `industrial:*` key under
 * industrialKeep "none" is unreachable, so a portal block made only of those owes
 * nothing — the row nothing could ever clear. (3) THE WIRE'S SOURCE in worklist.mjs
 * and concurrency.mjs: the import, the call, the two key prefixes and their
 * concurrency needs. The module's own tests cannot see the line that calls it,
 * and on 2026-09-05 a template literal turned `\d` into `d` in exactly such a line
 * while 23 module assertions stayed green (*The harness that stopped at the
 * module's edge*). Every source assertion here is a literal string, not a regex.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { landmarkAnswerItems } from './landmark_answers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

// The engine's rule, not a copy. If the skill tree is not beside this one the
// harness cannot run at all, and says so rather than passing on a stub.
const ENGINE = path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets');
const syncPath = path.join(ENGINE, 'poi_tiers_sync.js');
if (!fs.existsSync(syncPath)) { console.error(`prove-red-landmark-answers: ${syncPath} not found — the engine must sit beside bus-work`); process.exit(2); }
const { compareTiers } = require(syncPath);

const maps = [
  { id: 3, kind: 'area', name: 'Testtown', slug: 'testtown' },
  { id: 11, kind: 'place', name: 'Testtown Aldi', slug: 'testtown-aldi' },
  { id: 4, kind: 'area', name: 'Nowhere', slug: 'nowhere' },          // no town folder here
];
const towns = [{ name: 'Testtown', dir: '/fake/Areas/Testtown' }];
const run = ({ block, s3, s4, poiCfg = {} }) => landmarkAnswerItems({
  maps, towns, compareTiers,
  readBlock: () => block,
  readTown: () => ({ s3Tiers: s3, s4Tiers: s4, poiCfg, s3Id: 'S3-x', s4Version: '1.0' }),
});
const keys = (r) => r.items.map((i) => i.key).sort();

console.log('\n1. portal -> source');
{
  const a = run({ block: { tiers: { 'shop:Asda': { tier: 'must' } } }, s3: {}, s4: {} });
  check('the portal holds an answer the source lacks: landmark-owed row', keys(a).includes('landmark-owed-testtown'), keys(a).join(','));
  check('…and it names the key', a.items[0].detail.includes('+ shop:Asda'));
  check('…and its first step runs poi_tiers_sync.js for that town', a.items[0].do[0].cmd.includes('poi_tiers_sync.js --town "Testtown"'));
  const b = run({ block: { tiers: { 'shop:Asda': { tier: 'must' } } }, s3: { 'shop:Asda': 'must' }, s4: { 'shop:Asda': 'must' } });
  check('the source carries the same answer: the row goes', !keys(b).includes('landmark-owed-testtown'), keys(b).join(','));
  const c = run({ block: { tiers: { 'shop:Asda': { tier: 'may' } } }, s3: { 'shop:Asda': 'must' }, s4: { 'shop:Asda': 'must' } });
  check('a CHANGED tier is owed too, not only an added key', keys(c).includes('landmark-owed-testtown'));
  const d = run({ block: { tiers: { 'shop:Asda': { tier: 'must' }, 'community:H': { tier: 'must' } } }, s3: { 'shop:Asda': 'must', 'community:H': 'must' }, s4: { 'shop:Asda': 'must', 'community:H': 'must' } });
  check('a source with MORE than the portal named is owed nothing', keys(d).length === 0, keys(d).join(','));
}

console.log('\n2. the unreachable key — the row nothing could clear');
{
  const a = run({ block: { tiers: { 'industrial:Estate': { tier: 'miss' } } }, s3: {}, s4: {}, poiCfg: { industrialKeep: 'none' } });
  check('an industrial key under industrialKeep "none" owes nothing', keys(a).length === 0, keys(a).join(','));
  const b = run({ block: { tiers: { 'industrial:Estate': { tier: 'miss' } } }, s3: {}, s4: {}, poiCfg: { industrialKeep: 'named' } });
  check('…and the same key under "named" IS owed — the rule is the config, not the category', keys(b).includes('landmark-owed-testtown'));
}

console.log('\n3. source -> build');
{
  const a = run({ block: { tiers: {} }, s3: { 'library:Library': 'must' }, s4: {} });
  check('S3 carries a tier the S4 was not built with: landmark-unbuilt row', keys(a).includes('landmark-unbuilt-testtown'), keys(a).join(','));
  check('…whose first step is a rollout DRY RUN, not --apply', a.items[0].do[0].cmd.includes('rollout.js --town "Testtown"') && !a.items[0].do[0].cmd.includes('--apply'));
  const b = run({ block: { tiers: {} }, s3: { 'library:Library': 'must' }, s4: { 'library:Library': 'must' } });
  check('S4 built with the same tiers: the row goes', !keys(b).includes('landmark-unbuilt-testtown'), keys(b).join(','));
  const c = run({ block: { tiers: {} }, s3: { 'library:Library': 'must' }, s4: undefined });
  check('a town with no S4 at all raises no unbuilt row (nothing to compare)', !keys(c).includes('landmark-unbuilt-testtown'));
  const d = run({ block: { tiers: { 'library:Library': { tier: 'must' } } }, s3: {}, s4: {} });
  check('an answer still in the portal raises the OWED row and not the unbuilt one', keys(d).join(',') === 'landmark-owed-testtown', keys(d).join(','));
}

console.log('\n4. what is skipped is counted, never silent');
{
  const a = run({ block: null, s3: {}, s4: {} });
  check('an unreadable portal block is a SKIP with a reason', a.skipped.length === 1 && /unreadable/.test(a.skipped[0].why), JSON.stringify(a.skipped));
  check('…and still runs the source -> build half', a.checked === 1);
  const b = landmarkAnswerItems({ maps, towns, compareTiers, readBlock: () => ({ tiers: {} }), readTown: () => null });
  check('a town with no committed S3 is a SKIP with a reason', b.skipped.length === 1 && /S3/.test(b.skipped[0].why));
  check('a place map and a portal map with no folder here are neither checked nor skipped', a.checked === 1 && !a.skipped.some((s) => s.town !== 'Testtown'));
}

console.log('\n5. the wire — asserted on its SOURCE');
{
  const wl = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  const conc = fs.readFileSync(path.join(HERE, 'concurrency.mjs'), 'utf8');
  const mod = fs.readFileSync(path.join(HERE, 'landmark_answers.mjs'), 'utf8');
  check('worklist.mjs imports landmarkAnswerItems from ./landmark_answers.mjs', wl.includes("import { landmarkAnswerItems } from './landmark_answers.mjs';"));
  check('…and calls it', wl.includes('return landmarkAnswerItems({'));
  check('…with the ENGINE\u2019s compareTiers, required from the skill assets', wl.includes("const { compareTiers } = require(path.join(SK, 'poi_tiers_sync.js'));"));
  check('…over GET /api/maps/:id/poi-tiers when remote', wl.includes('/api/maps/${m.id}/poi-tiers'));
  check('…adds every item it returns', wl.includes('for (const it of landmarkAnswers.items) {'));
  check('…and counts the skipped towns into the warnings', wl.includes('landmark answers: ${landmarkAnswers.skipped.length} town(s) not compared'));
  check('the two key prefixes are the ones the module writes', mod.includes('key: `landmark-owed-${') && mod.includes('key: `landmark-unbuilt-${'));
  check('concurrency.mjs classifies landmark-owed- as a buses-tree write', conc.includes("if (key.startsWith('landmark-owed-')) return ['buses-tree'];"));
  check('…and landmark-unbuilt- as buses-tree + engine', conc.includes("if (key.startsWith('landmark-unbuilt-')) return ['buses-tree', 'engine'];"));
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : '\n✓ all landmark-answer checks passed — both rows appear and both go away');
process.exit(bad ? 1 : 0);
