#!/usr/bin/env node
// test-measure.mjs — the measurer's first test (codebase review 2026-09-28, Tier 1.5).
//
//   npm run test:measure        (from C:\u3a St Ives\.claude\skills\review-bus-codebases)
//
// measure.mjs had never had a test, and on the fifth run three of its faults
// were found by hand: a wrong path printed zeros and exited 0 (G11), a disk walk
// counted whatever was lying in a checkout (the 2026-09-14 worktree, and the
// NEVER_WALK list that fixed it by hiding tracked files too), and a substring
// count disagreed with the gate built to answer the same question. Each case
// below is one of those, against three scratch git repositories; no real
// checkout is read. Exit 0 all passed, 1 a case failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.join(HERE, 'measure.mjs');
const { measure } = await import('./measure.mjs');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-test-'));
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
function repo(name, files) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  git(dir, 'add', '-A');
  return dir;
}
const LAPTOP = "const X = 'C:/u3a St Ives/Using AI/Buses';\n";
const BUSES = repo('buses', { 'tool.mjs': LAPTOP, '.claude/hook.mjs': LAPTOP });
const SKILLS = repo('skills', {
  'make-bus-leaflet/tools/line-ratchet.json': JSON.stringify({ files: { 'assets/a.js': 3 } }),
  'make-bus-leaflet/assets/a.js': 'one\ntwo\nthree\n',
  'make-bus-leaflet/package.json': JSON.stringify({ scripts: {} }),
});
const PORTAL = repo('portal', { 'package.json': JSON.stringify({ scripts: { test: 'node scripts/run-tests.mjs' } }), 'scripts/run-tests.mjs': '\n' });
// Written AFTER `git add`, so untracked: a stray file, and a second copy of the
// repository the way a worktree left inside it is one.
fs.writeFileSync(path.join(BUSES, 'stray.mjs'), LAPTOP);
fs.mkdirSync(path.join(BUSES, 'nested-worktree'), { recursive: true });
fs.writeFileSync(path.join(BUSES, 'nested-worktree', 'tool.mjs'), LAPTOP);

const cli = (...a) => spawnSync(process.execPath, [MEASURE, ...a], { encoding: 'utf8' });

console.log('an absent subject is refused, never measured as zero');
{
  const r = cli('--buses', BUSES, '--skills', path.join(scratch, 'no-such-dir'), '--portal', PORTAL);
  check('a missing checkout exits 2', r.status === 2, `status ${r.status}`);
  check('and says which one', /claude-skills/.test(r.stderr), r.stderr.trim());
  const plain = path.join(scratch, 'not-a-repo');
  fs.mkdirSync(plain);
  check('a folder that is not a git checkout exits 2', cli('--buses', plain, '--skills', SKILLS, '--portal', PORTAL).status === 2);
  const noLedger = repo('skills-no-ledger', { 'make-bus-leaflet/assets/a.js': 'x\n' });
  const r2 = cli('--buses', BUSES, '--skills', noLedger, '--portal', PORTAL);
  check('a missing ratchet ledger exits 2', r2.status === 2, `status ${r2.status}`);
  check('and names the ledger', /ledger/.test(r2.stderr), r2.stderr.trim());
  check('a complete set measures and exits 0', cli('--buses', BUSES, '--skills', SKILLS, '--portal', PORTAL, '--json').status === 0);
}

console.log('the population is what git tracks');
{
  const out = measure({ BUSES, SKILLS, PORTAL });
  check('measure() answers', out.ok, out.why);
  const lp = out.ok ? out.result.groups.laptopPaths : {};
  check('two tracked files name the laptop — one under .claude/, which NEVER_WALK hid — and the untracked two do not count',
    lp['files naming the laptop path (buses-data code)'] === 2, `got ${lp['files naming the laptop path (buses-data code)']}`);
  check('the ledger\'s file is sized', out.ok && out.result.groups.sizes['a.js'] === 3);
}

console.log('the wiring answer is check-wiring.js\'s, and absent is not zero');
{
  const out = measure({ BUSES, SKILLS, PORTAL });
  const tw = out.ok ? out.result.groups.testWiring : {};
  check('no check-wiring.js in the checkout gives null findings, not 0', tw['check-wiring.js findings (should be 0)'] === null, `got ${tw['check-wiring.js findings (should be 0)']}`);
  check('the substring count over gates.yml is gone', !Object.keys(tw).some((k) => /in no gates\.yml step/.test(k)));
  check('the key that equalled the total by construction is gone', !Object.keys(tw).some((k) => /not in npm test/.test(k)));
}

fs.rmSync(scratch, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall measure checks passed');
