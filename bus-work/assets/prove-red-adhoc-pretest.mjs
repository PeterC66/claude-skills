#!/usr/bin/env node
/* Prove the ad-hoc pre-test can say SUPERSEDED, BLOCKED, DUE, and can decline to
 * decide (buses-data, 2026-10-08).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-adhoc-pretest.mjs
 *
 * WHAT IS BEING FALSIFIED. A pre-test that only ever answers DUE would be green
 * for ever and would save nothing. So every verdict is built from a real Buses-
 * shaped tree under the temp dir (adhoc/ and loop/ are gitignored, so a fake
 * reader could not be absent), and each case that flips a verdict is paired with
 * the one change that flips it back. The two cases that matter most for safety
 * are the ones where the module must NOT act: a condition it cannot read, and a
 * file with no declaration at all.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pretest, pretestAll, conditionsOf } from './adhoc_pretest.mjs';

let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-adhoc-pretest-'));
const put = (rel, text) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
};
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });

git('init', '-q');
git('config', 'user.email', 'prove@example.invalid');
git('config', 'user.name', 'prove');
put('Areas/March/manifest.json', '{}');
put('Development Docs/open-actions/OA-100.md', '---\nref: OA-100\nstatus: open\n---\n\nbody\n');
put('Development Docs/open-actions/OA-101.md', '---\nref: OA-101\nstatus: open\ndecision: peter\n---\n\nbody\n');
put('Development Docs/open-actions/_parked/OA-102.md', '---\nref: OA-102\nstatus: open\n---\n\nbody\n');
git('add', '-A');
git('commit', '-q', '-m', 'base');
const base = git('rev-parse', 'HEAD').trim();

const run = (lines) => pretest('a.md', `# a request\n\n${lines}\n\nDo the thing.\n`, root);

console.log('SUPERSEDED, and its control');
check('oa-open on a retired OA → SUPERSEDED', run('**Still needed if:** `oa-open OA-999`').verdict === 'SUPERSEDED');
check('  control: the OA exists → DUE', run('**Still needed if:** `oa-open OA-100`').verdict === 'DUE');
check('  a PARKED OA still counts as open', run('**Still needed if:** `oa-open OA-102`').verdict === 'DUE');
check('missing path that now exists → SUPERSEDED', run('**Still needed if:** `missing Areas/March/manifest.json`').verdict === 'SUPERSEDED');
check('  control: path really missing → DUE', run('**Still needed if:** `missing Areas/Nowhere/manifest.json`').verdict === 'DUE');
check('contains false → SUPERSEDED', run('**Still needed if:** `contains Areas/March/manifest.json :: "fixed"`').verdict === 'SUPERSEDED');
check('  control: contains true → DUE', run('**Still needed if:** `contains Areas/March/manifest.json :: {}`').verdict === 'DUE');
check('one false among several → SUPERSEDED', run('**Still needed if:** `oa-open OA-100` `oa-open OA-999`').verdict === 'SUPERSEDED');

console.log('unchanged <sha>, against a real commit');
check('nothing touched it since → DUE', run(`**Still needed if:** \`unchanged ${base} Areas/March/manifest.json\``).verdict === 'DUE');
put('Areas/March/manifest.json', '{"v":2}');
git('add', 'Areas/March/manifest.json');
git('commit', '-q', '-m', 'change');
check('  a later commit touched it → SUPERSEDED', run(`**Still needed if:** \`unchanged ${base} Areas/March/manifest.json\``).verdict === 'SUPERSEDED');

console.log('BLOCKED, and its control');
check('decision: peter → BLOCKED', run('**Needs Peter if:** `oa-decision-peter OA-101`').verdict === 'BLOCKED');
check('  control: no decision field → DUE', run('**Needs Peter if:** `oa-decision-peter OA-100`').verdict === 'DUE');
put('loop/your-move/march-letter-hold.md', '# hold\n');
check('open hold with the town in its name → BLOCKED', run('**Needs Peter if:** `your-move-has march`').verdict === 'BLOCKED');
check('  control: no such hold → DUE', run('**Needs Peter if:** `your-move-has soham`').verdict === 'DUE');
check('SUPERSEDED outranks BLOCKED', run('**Still needed if:** `oa-open OA-999`\n**Needs Peter if:** `oa-decision-peter OA-101`').verdict === 'SUPERSEDED');

console.log('declining to decide');
const unk = run('**Still needed if:** `frobnicate everything`');
check('unknown verb → DUE, never SUPERSEDED', unk.verdict === 'DUE' && /unreadable/.test(unk.why), JSON.stringify(unk));
check('malformed OA ref → DUE', run('**Still needed if:** `oa-open banana`').verdict === 'DUE');
check('unchanged with a bad sha → DUE', run('**Still needed if:** `unchanged zzzz Areas/x`').verdict === 'DUE');
check('a readable false still wins over an unreadable one', run('**Still needed if:** `frobnicate` `oa-open OA-999`').verdict === 'SUPERSEDED');
check('no declaration → UNDECLARED', pretest('b.md', '# a request\n\nDo it.\n', root).verdict === 'UNDECLARED');
check('standing file → STANDING, even with a false condition', pretest('zz-weekly.md', '# w\n**Still needed if:** `oa-open OA-999`\n', root).verdict === 'STANDING');
check('conditionsOf: absent line → null', conditionsOf('# x\n', 'Still needed if') === null);

console.log('the whole folder');
put('adhoc/ready/10-gone.md', '# gone\n**Still needed if:** `oa-open OA-999`\n');
put('adhoc/ready/20-live.md', '# live\n**Still needed if:** `oa-open OA-100`\n');
put('adhoc/ready/30-plain.md', '# plain\n');
put('adhoc/ready/zz-standing.md', '# s\n');
put('adhoc/ready/notes.txt', 'not a prompt');
const all = pretestAll(root);
check('filename order, .md only', all.map((r) => r.name).join() === '10-gone.md,20-live.md,30-plain.md,zz-standing.md', all.map((r) => r.name).join());
check('verdicts per file', all.map((r) => r.verdict).join() === 'SUPERSEDED,DUE,UNDECLARED,STANDING', all.map((r) => r.verdict).join());
check('absent ready/ → []', pretestAll(path.join(root, 'nowhere')).length === 0);

fs.rmSync(root, { recursive: true, force: true });
if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
