#!/usr/bin/env node
/* Prove the pull-request train picks the right pull request, and leaves the
 * right ones alone (2026-09-27).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets):
 *
 *   node prove-red-pr-train.mjs
 *
 * `decideTrain` is pure, so every case is a literal `gh pr list` answer and no
 * network is touched. The cases are paired: make the state and see the choice,
 * change one field and see the choice change. The one this file exists for is
 * the last: an up-to-date pull request with NO checks — what a run held for
 * approval looks like, as #190 did — must never be read as "on its way", or
 * the train waits behind it for ever.
 */
import { decideTrain } from './pr_train.mjs';

let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const AUTO = { enabledAt: '2026-09-27T16:13:20Z' };
const green = [{ name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'status', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const running = [{ name: 'unit', status: 'IN_PROGRESS', conclusion: '' }];
const red = [{ name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' }];
const pr = (number, mergeStateStatus, statusCheckRollup = green, extra = {}) => ({
  number, headRefName: `b${number}`, headRefOid: `sha${number}`, mergeStateStatus,
  autoMergeRequest: AUTO, isDraft: false, statusCheckRollup, ...extra,
});

let d = decideTrain([]);
check('an empty queue does nothing', d.action === 'none');

d = decideTrain([pr(5, 'BEHIND'), pr(3, 'BEHIND')]);
check('the OLDEST behind pull request is updated', d.action === 'update' && d.pr.number === 3, JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(3, 'BEHIND', green, { autoMergeRequest: null })]);
check('one without auto-merge is left alone', d.action === 'update' && d.pr.number === 5, JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(3, 'BEHIND', green, { isDraft: true })]);
check('a draft is left alone', d.action === 'update' && d.pr.number === 5, JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(3, 'BEHIND', red)]);
check('a red one is skipped, and named', d.pr?.number === 5 && d.warnings.some((w) => w.startsWith('#3 has failed')), JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(3, 'BEHIND', [{ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }])]);
check('a run awaiting approval counts as failed', d.pr?.number === 5, JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(3, 'DIRTY')]);
check('a conflicted one is skipped, and named', d.pr?.number === 5 && d.warnings.some((w) => w.startsWith('#3 conflicts')), JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(7, 'BLOCKED', running)]);
check('one with checks RUNNING holds the train', d.action === 'wait' && d.pr.number === 7, JSON.stringify(d));
d = decideTrain([pr(5, 'BEHIND'), pr(7, 'BLOCKED', green)]);
check('...and the same one finished moves it on', d.action === 'update' && d.pr.number === 5, JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(7, 'CLEAN')]);
check('a CLEAN one about to merge holds the train', d.action === 'wait' && d.pr.number === 7, JSON.stringify(d));

d = decideTrain([pr(5, 'BEHIND'), pr(7, 'BLOCKED', [])]);
check('an up-to-date one with NO checks does not hold the train', d.action === 'update' && d.pr.number === 5, JSON.stringify(d));
check('...and is named as probably held for approval', d.warnings.some((w) => w.startsWith('#7 is up to date with NO checks')), JSON.stringify(d.warnings));
d = decideTrain([pr(7, 'BLOCKED', [])]);
check('...and alone, it is reported stuck rather than nothing', d.action === 'stuck' && d.pr.number === 7, JSON.stringify(d));

if (bad) { console.error(`\n${bad} assertion(s) failed`); process.exit(1); }
console.log('\nall assertions held');
