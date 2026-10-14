#!/usr/bin/env node
/* Prove the temp sweep removes ONLY the portal tests' idle scratch folders, and
 * that the checks below can go red (built 2026-10-14 with temp_sweep.mjs).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), no placeholders:
 *
 *   node prove-red-temp-sweep.mjs
 *
 * WHAT IS BEING FALSIFIED. The temp folder is every program's, so the sweep is
 * dangerous in one direction: deleting something that is not ours, or something
 * a test is still using, or — through a junction — something in a live
 * worktree. Section 1 is the pure verdict, each refusal against a control that
 * removes. Section 2 runs the real writer against a throwaway folder holding a
 * stranger's folder, a file with our prefix, a folder touched an hour ago, and an
 * old scratch folder with a junction into a folder whose file must survive.
 * Section 3 breaks the sweep on purpose (idle window of zero) and requires
 * section 2's own checks to turn red, so a green section 2 means something.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyTempEntry, sweepTemp, TEMP_IDLE_HOURS, PREFIXES } from './temp_sweep.mjs';

let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};
const H = 3600000;
const NOW = Date.parse('2026-10-14T12:00:00Z');

console.log('1. classifyTempEntry — each refusal against a control that removes');
const good = { name: 'cbm-test-access-AbC123', isDir: true, isLink: false, mtimeMs: NOW - 48 * H };
check('control: our prefix, a directory, idle 48h → REMOVE', classifyTempEntry(good, { now: NOW }).remove === true);
for (const p of PREFIXES) check(`prefix ${p} is removable`, classifyTempEntry({ ...good, name: `${p}x1Y2z3` }, { now: NOW }).remove === true);
const refusals = [
  ['a stranger\'s folder', { name: 'Diagnostics' }],
  ['a prefix that is only part of ours (no dash)', { name: 'cbmtool' }],
  ['our prefix in the middle of a name', { name: 'x-cbm-test' }],
  ['a file with our prefix', { isDir: false }],
  ['a link with our prefix', { isLink: true }],
  ['touched 23h ago', { mtimeMs: NOW - 23 * H }],
  ['age unreadable', { mtimeMs: null }],
];
for (const [name, patch] of refusals) check(`${name} → keep`, classifyTempEntry({ ...good, ...patch }, { now: NOW }).remove === false);
check(`idle boundary is ${TEMP_IDLE_HOURS}h exactly`,
  classifyTempEntry({ ...good, mtimeMs: NOW - TEMP_IDLE_HOURS * H }, { now: NOW }).remove === true
  && classifyTempEntry({ ...good, mtimeMs: NOW - TEMP_IDLE_HOURS * H + 1 }, { now: NOW }).remove === false);

/** Build the throwaway temp folder and a junction target outside it. */
function build() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-temp-sweep-'));
  const tmp = path.join(base, 'tmp'); fs.mkdirSync(tmp);
  const target = path.join(base, 'live-worktree-node_modules'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'precious.txt'), 'must survive');
  const mk = (name, files = ['a.txt']) => { const d = path.join(tmp, name); fs.mkdirSync(d); for (const f of files) fs.writeFileSync(path.join(d, f), 'x'); return d; };
  const old = new Date(NOW - 48 * H);
  const age = (d, when = old) => fs.utimesSync(d, when, when);
  for (const n of ['cbm-old-aaa111', 'portal-deps-bbb222', 'sheets-ccc333', 'prove-red-status-ddd444']) age(mk(n));
  age(mk('Diagnostics'));                                    // a stranger's, old
  fs.writeFileSync(path.join(tmp, 'cbm-a-file.txt'), 'x'); age(path.join(tmp, 'cbm-a-file.txt'));
  age(mk('cbm-fresh-eee555'), new Date(NOW - 1 * H));       // ours but in use
  const linked = mk('cbm-prove-render-budget-fff666');
  fs.symlinkSync(target, path.join(linked, 'node_modules'), 'junction');
  age(linked);
  return { base, tmp, target };
}
const exists = (...p) => fs.existsSync(path.join(...p));

/** Section 2's assertions, parameterised so section 3 can run them against a broken sweep. */
function scenario(opts = {}) {
  const { base, tmp, target } = build();
  const out = [];
  const ok = (name, cond) => out.push({ name, cond });
  try {
    const dry = sweepTemp({ dir: tmp, apply: false, now: NOW, ...opts });
    ok('report only: nothing is removed', exists(tmp, 'cbm-old-aaa111') && exists(tmp, 'sheets-ccc333') && exists(tmp, 'cbm-prove-render-budget-fff666'));
    ok('report only: counts the five idle folders', dry.removed === 5);
    const r = sweepTemp({ dir: tmp, apply: true, now: NOW, ...opts });
    ok('removes all four prefixes', !exists(tmp, 'cbm-old-aaa111') && !exists(tmp, 'portal-deps-bbb222') && !exists(tmp, 'sheets-ccc333') && !exists(tmp, 'prove-red-status-ddd444'));
    ok('removes the tree that held a junction', !exists(tmp, 'cbm-prove-render-budget-fff666'));
    ok('the junction\'s TARGET still holds its file', exists(target, 'precious.txt'));
    ok('one link was unlinked first', r.linksUnlinked === 1);
    ok('a stranger\'s old folder is left', exists(tmp, 'Diagnostics'));
    ok('a file with our prefix is left', exists(tmp, 'cbm-a-file.txt'));
    ok('our folder touched an hour ago is left', exists(tmp, 'cbm-fresh-eee555'));
    ok('nothing failed', r.failed.length === 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  return out;
}

console.log('\n2. the real writer against a throwaway temp folder');
for (const { name, cond } of scenario()) check(name, cond);

console.log('\n3. the same checks against a sweep broken on purpose (idle window of 0h) must go RED');
const broken = scenario({ idleHours: 0 }).filter((x) => !x.cond);
check('the broken sweep fails at least one of section 2\'s checks', broken.length > 0, 'a green section 2 would prove nothing');
check('and the failing one is the in-use folder', broken.some((x) => x.name.includes('touched an hour ago')), broken.map((x) => x.name).join('; '));

console.log(bad ? `\n✗ ${bad} failure(s)` : '\nall passed');
process.exit(bad ? 1 : 0);
