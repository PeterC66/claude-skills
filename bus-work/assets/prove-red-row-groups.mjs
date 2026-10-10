#!/usr/bin/env node
/* Prove the printed board folds an estate-wide fact into one row, and only that
 * (buses-data OA-608 item 2).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), no placeholders:
 *
 *   node prove-red-row-groups.mjs
 *
 * WHAT IS BEING FALSIFIED. `groupForPrint()` replaces per-map rows with one row
 * listing the maps. The CONTROLS matter as much as the fold: a row with a hold is
 * never folded, towns and places stay apart because their commands differ, one
 * member alone is printed as it is, an unrelated row is untouched, and the order
 * of everything else survives. And the wire must RUN in worklist.mjs, on the print
 * loop and not on the --json array, which the loop's ticks read one row at a time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupForPrint } from './row_groups.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const rebuild = (name, place = false, extra = '') => ({
  key: `engine-rebuild-${name}`, rank: 8, type: 'housekeeping', ageDays: name.length,
  title: `${name} was drawn by an older engine`,
  why: `v1.0 was drawn by abc for ${name}. Its sheets are gated against the engine that drew them, so this is a chore.${extra}`,
  safety: { verdict: name === 'Ely' ? 'check' : 'safe', reasons: name === 'Ely' ? [{ need: 'engine', verdict: 'check' }] : [] },
  do: [
    { kind: 'shell', cwd: 'SK', cmd: `node ${place ? 'rollout_places.js --place' : 'rollout.js --town'} "${name}"`, note: 'dry-run' },
    { kind: 'shell', cwd: 'SK', cmd: `node ${place ? 'rollout_places.js --place' : 'rollout.js --town'} "${name}" --apply --commit` },
  ],
});
const other = { key: 'loop-idle', rank: 8, type: 'loop-health', title: 'other', why: 'x.', do: [] };

console.log('\n1. three town rebuilds fold into one row, at the first one\'s place');
{
  const rows = [other, rebuild('March'), rebuild('Ely'), rebuild('St Ives', false, ' Its pull is also old.')];
  const out = groupForPrint(rows);
  check('two rows printed', out.length === 2, String(out.length));
  check('the unrelated row keeps first place', out[0] === other);
  const g = out[1];
  check('titled with the count', g.title === '3 maps were drawn by an older engine', g.title);
  check('lists every member key', JSON.stringify(g.members) === JSON.stringify(['engine-rebuild-March', 'engine-rebuild-Ely', 'engine-rebuild-St Ives']), JSON.stringify(g.members));
  check('one detail line per map, by name', g.detail.split('\n').length === 3 && /^March — /.test(g.detail) && /\nSt Ives — /.test(g.detail), g.detail);
  check('the sentence every member shares is said once, in why', /gated against the engine/.test(g.why) && !/gated against/.test(g.detail), g.why);
  check('a sentence only one member has stays on its line', /St Ives — .*Its pull is also old\./.test(g.detail));
  check('the commands carry <map>, quoted', g.do[0].cmd === 'node rollout.js --town "<map>"' && g.do[1].cmd === 'node rollout.js --town "<map>" --apply --commit', g.do.map((d) => d.cmd).join(' | '));
  check('…and say what <map> is', /<map> is one of the names above/.test(g.do[0].note), g.do[0].note);
  check('the worst verdict wins', g.safety.verdict === 'check' && g.safety.reasons.length === 1, JSON.stringify(g.safety));
  check('the oldest age is shown', g.ageDays === 7, String(g.ageDays));
  check('the input rows are not mutated', rows[1].key === 'engine-rebuild-March' && !rows[1].members);
}

console.log('\n2. controls');
{
  const held = { ...rebuild('Ely'), onHold: [{ title: 'a hold' }] };
  const out = groupForPrint([rebuild('March'), held, rebuild('Soham')]);
  check('a held row is never folded, and the other two still are', out.length === 2 && out.includes(held), out.map((r) => r.key).join());
  const mixed = groupForPrint([rebuild('March'), rebuild('Ely Co-op', true), rebuild('Soham'), rebuild('St Neots East', true)]);
  check('towns and places stay apart: their commands differ', mixed.length === 2 && /^2 maps/.test(mixed[0].title) && /^2 place maps/.test(mixed[1].title), mixed.map((r) => r.title).join(' | '));
  const one = rebuild('March');
  const single = groupForPrint([other, one]);
  check('one member alone is printed as it is', single.length === 2 && single[1] === one);
  const pulls = groupForPrint([
    { key: 'fresh-pull-March', title: 't', why: 'a.', do: [{ kind: 'shell', cmd: 'python repull_landmarks.py --town "March"' }, { kind: 'skill', what: 'Then rebuild March in stage order.' }] },
    { key: 'fresh-pull-Ely', title: 't', why: 'b.', do: [{ kind: 'shell', cmd: 'python repull_landmarks.py --town "Ely"' }, { kind: 'skill', what: 'Then rebuild Ely in stage order.' }] },
  ]);
  // The skill step names the map UNQUOTED, as fresh_pull.mjs writes it; without the bare swap these never fold.
  check('fresh-pull rows fold too, unquoted name and all', pulls.length === 1 && /^2 maps' landmark pulls/.test(pulls[0].title) && pulls[0].do[1].what === 'Then rebuild <map> in stage order.', pulls.map((r) => r.title).join());
  const notGrouped = [{ key: 'refresh-March', title: 'a', do: [] }, { key: 'refresh-Ely', title: 'b', do: [] }];
  check('a prefix not in GROUPED is never folded', groupForPrint(notGrouped).length === 2);
  check('an empty board is empty', groupForPrint([]).length === 0);
}

console.log('\n3. the wire in worklist.mjs — it must RUN, on the print loop only');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  const live = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  check("worklist.mjs RUNS: import { groupForPrint } from './row_groups.mjs';", live.some((l) => l.includes("import { groupForPrint } from './row_groups.mjs';")));
  check('worklist.mjs RUNS: for (const it of groupForPrint(limited))', live.some((l) => l.includes('for (const it of groupForPrint(limited))')));
  // The --json payload is what a tick reads; folding it would take the per-map unit of work away.
  check('the --json payload is NOT folded', live.some((l) => l.includes('items: limited, gates')) && !live.some((l) => /JSON\.stringify\(.*groupForPrint/.test(l)));
}

console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
