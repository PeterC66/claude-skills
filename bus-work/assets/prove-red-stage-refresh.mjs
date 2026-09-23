#!/usr/bin/env node
/* Prove the refresh staging step refuses everything that would email a customer
 * about a sheet nobody let through (buses-data OA-428, item 4 of R9 of the
 * process review of 2026-09-17).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), no placeholders:
 *
 *   node prove-red-stage-refresh.mjs
 *
 * WHAT IS AT RISK. `stage_refresh.mjs --apply` runs the portal's deliver command,
 * which emails the map's customer. The failures that matter are ways of reaching
 * that command wrongly: a map Peter has not accepted, a render newer than the one
 * the review compared, and the same build staged twice. Each has a case whose
 * answer would flip if the rule were gone, shown beside it, so each rule is
 * load-bearing rather than merely present. No disk, no portal, no clock.
 */
import { planStage, readBack, newestRender, DELIVER_SCRIPT } from './stage_refresh.mjs';
import { deliverable, markStaged, mergeAnswers, answer, Refused } from './ink_review.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };
const refusal = (fn) => { try { fn(); return null; } catch (e) { return e instanceof Refused ? e.message : `NOT A REFUSAL: ${e.message}`; } };

const SCAN = '2026-10-01', OLD = 'v2.59_2026-09-05_1025', NEW = 'v2.60_2026-10-02_0300', NEWER = 'v2.61_2026-10-03_0300';
const map = (name, status, extra = {}) => ({ map: name, dir: `Areas/${name}`, why: 'SAFE', status, before: OLD, after: NEW, sheets: [], answer: null, ...extra });
const review = (...maps) => ({ schema: 1, tool: 'ink_review.mjs', scan: SCAN, maps });
const manifest = (...ids) => ({ stages: { S5: { runs: ids.map((id) => ({ id, dir: `S5-render/${id}`, outputs: ['internal.jpg'] })) } } });
const plan = (r, town, m = manifest(OLD, NEW), slug = 'march') => refusal(() => planStage({ review: r, town, slug, manifest: m }));

console.log('\n1. Only what the review let through');
{
  const r = review(map('March', 'no-ink'), map('Ely', 'ink-moved'), map('Soham', 'not-refreshed'));
  check('a no-ink map is planned', plan(r, 'March') === null, plan(r, 'March'));
  const p = planStage({ review: r, town: 'march', slug: 'march', manifest: manifest(OLD, NEW) });
  check('  from the render of the reviewed build, with the scan in its note', p.srcRel === `S5-render/${NEW}` && p.note === `BODS ${SCAN} refresh` && p.town === 'March', JSON.stringify(p));
  check('an ink-moved map Peter has not answered is refused, and says so', /not accepted this build/.test(plan(r, 'Ely') || ''), plan(r, 'Ely'));
  const acc = answer(r, 'Ely', 'accept', { by: 'buses-29', at: 'T1' });
  check('  and once he accepts it, it is planned — the answer is what the refusal turned on', plan(acc, 'Ely') === null, plan(acc, 'Ely'));
  const held = answer(r, 'Ely', 'hold', { by: 'buses-29', note: 'the museum icon is doubled', at: 'T1' });
  check('a held map is refused, with his reason', /held it \(the museum icon is doubled\)/.test(plan(held, 'Ely') || ''), plan(held, 'Ely'));
  check('an unreadable or unrefreshed map is refused, with its status', /not-refreshed/.test(plan(r, 'Soham') || ''), plan(r, 'Soham'));
  check('a town not in the review is refused', /not in the 2026-10-01 review/.test(plan(r, 'Wisbech') || ''));
  check('no review at all is refused', /no ink review/.test(plan(null, 'March') || ''));
  check('a slug that is not a slug is refused', /must be the portal map's slug/.test(plan(r, 'March', manifest(OLD, NEW), 'March Town') || ''));
}

console.log('\n2. The render staged is the build that was compared');
{
  const r = review(map('March', 'no-ink'));
  check('a render NEWER than the reviewed build is refused', /newest render is v2\.61.*looked at v2\.60/.test(plan(r, 'March', manifest(OLD, NEW, NEWER)) || ''), plan(r, 'March', manifest(OLD, NEW, NEWER)));
  check('  and without the rule the newer render WOULD have been the one staged — the rule is load-bearing', newestRender(manifest(OLD, NEW, NEWER)).id === NEWER);
  check('a manifest out of order is sorted, not trusted', newestRender(manifest(NEWER, OLD, NEW)).id === NEWER);
  check('a render OLDER than the reviewed build is refused too — S4 ran and S5 did not', /newest render is v2\.59/.test(plan(r, 'March', manifest(OLD)) || ''));
  check('no render at all is refused', /no S5 render/.test(plan(r, 'March', manifest()) || ''));
  /* Ramsey's v3.6 is S4 `_1141` and S5 `_1142`: the render folder is named by its own minute. */
  const skew = manifest(OLD, 'v2.60_2026-10-02_0301');
  check('a render named a minute after its build is still that build\'s render', plan(r, 'March', skew) === null, plan(r, 'March', skew));
  check('  and an id comparison WOULD have refused it — the version join is load-bearing', skew.stages.S5.runs[1].id !== NEW);
  const declared = (s4) => ({ stages: { S5: { runs: [{ id: 'v2.60_2026-10-02_0301', dir: 'S5-render/x', basedOn: { S4: s4 } }] } } });
  check('a render that DECLARES its build is taken at its word', plan(r, 'March', declared(NEW)) === null);
  check('  and refused when it declares another build, whatever its version says', /newest render/.test(plan(r, 'March', declared('v2.60_2026-10-02_0259')) || ''));
}

console.log('\n3. One build, one email');
{
  const r = review(map('March', 'no-ink'));
  const once = markStaged(r, 'March', { slug: 'march', by: 'sched-1215', at: 'T1' });
  check('a staged build is refused a second time, naming who staged it', /already staged by sched-1215.*email them twice/.test(plan(once, 'March') || ''), plan(once, 'March'));
  check('  and the gate lists it as staged, not deliver', deliverable(once).staged.join() === 'March' && !deliverable(once).deliver.length, JSON.stringify(deliverable(once)));
  check('  and without the record it WOULD have been planned again — the record is load-bearing', plan({ ...once, maps: once.maps.map((m) => ({ ...m, staged: undefined })) }, 'March') === null);
  const rebuilt = mergeAnswers(once, review({ ...map('March', 'no-ink'), after: NEWER }));
  check('re-collecting carries the staging forward', !!rebuilt.maps[0].staged && rebuilt.maps[0].staged.after === NEW);
  check('  and a LATER build of the same map is deliverable afresh', deliverable(rebuilt).deliver.join() === 'March', JSON.stringify(deliverable(rebuilt)));
  const again = markStaged(rebuilt, 'March', { slug: 'march', by: 'sched-0100', at: 'T2' });
  check('staging that later build keeps the first staging as history', again.maps[0].stagedBefore.length === 1 && again.maps[0].staged.after === NEWER);
  const same = mergeAnswers(once, review(map('March', 'no-ink')));
  check('re-collecting the SAME build keeps it staged', deliverable(same).staged.join() === 'March');
  check('marking a town not in the review refuses', refusal(() => markStaged(r, 'Ely', { slug: 'ely', by: 'a', at: 'T' })) !== null);
}

console.log('\n4. The read-back finds the update waiting on its customer, and nothing else');
{
  const maps = [{ slug: 'march', name: 'March' }, { slug: 'st-ives', name: 'St Ives' }];
  const waiting = { key: 'proposed-7', type: 'awaiting-customer', title: 'Waiting on Town Council — proposed update to "March"' };
  check('an awaiting-customer row for the map reads back', readBack({ maps, items: [waiting], slug: 'march' }).ok);
  check('a row for ANOTHER map does not', !readBack({ maps, items: [{ ...waiting, title: waiting.title.replace('"March"', '"St Ives"') }], slug: 'march' }).ok);
  check('a refresh row for the map is not a staged update', !readBack({ maps, items: [{ ...waiting, type: 'refresh' }], slug: 'march' }).ok);
  check('an unknown slug says so', /no map with slug/.test(readBack({ maps, items: [waiting], slug: 'wisbech' }).why || ''));
  check('a name that merely CONTAINS the map\'s name does not match', !readBack({ maps: [{ slug: 'ely', name: 'Ely' }], items: [{ ...waiting, title: 'proposed update to "Ely Co-op"' }], slug: 'ely' }).ok);
}

console.log('\n5. It runs what npm runs');
check('DELIVER_SCRIPT is the deliver command line, node first', DELIVER_SCRIPT.split(' ')[0] === 'node' && /scripts\/deliver-map\.mjs$/.test(DELIVER_SCRIPT));

console.log(`\n${ran - bad} of ${ran} passed`);
process.exit(bad ? 1 : 0);
