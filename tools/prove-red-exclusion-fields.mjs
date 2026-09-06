#!/usr/bin/env node
/*
 * prove-red-exclusion-fields.mjs — falsify check-exclusion-fields.mjs.
 *
 * Run from anywhere, with no arguments and no placeholders:
 *
 *     node "C:/u3a St Ives/.claude/skills/tools/prove-red-exclusion-fields.mjs"
 *
 * WHY. `check-exclusion-fields.mjs` is a gate that went GREEN on the day it landed,
 * because the four town files using a deprecated exclusion field were migrated in the
 * same round. A green check that has never been seen to go red proves nothing, and this
 * one has a second way to be worthless: it could pass by looking at the wrong files.
 *
 * Every case builds a throwaway git repository, because the checker's subject is what a
 * repository TRACKS — `git ls-files`, not a directory walk — and a case that ran it over
 * a plain folder would be testing a code path nothing uses.
 *
 * THE LOAD-BEARING CASE IS 5, the superseded run. The gate must fire on the latest S1 run
 * of a map and stay silent on every older one: those are dated records of what was
 * produced that day, and the reason the three aliases are read for ever rather than
 * deleted is precisely so that they keep working. A gate that demanded they be rewritten
 * would be arguing with its own premise, and the migration it asked for would be a lie
 * about the past. Case 6 is its complement — the newest run is the one that counts, even
 * when an older one is clean.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, 'check-exclusion-fields.mjs');
const TMP = mkdtempSync(path.join(tmpdir(), 'prove-red-exclusion-'));
let failures = 0, ran = 0;

function check(name, ok, detail) {
  ran++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!ok) failures++;
}

/** A throwaway repo. `runs` is [mapDir, runId, servicesObject, {track}]. */
function repo(name, runs) {
  const root = path.join(TMP, name);
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'p@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'prove-red'], { cwd: root });
  // This laptop sets core.autocrlf=true globally, which makes every `git add` here print
  // a line-ending warning into the harness's own output. The checker reads bytes off the
  // disk and never through git, so the setting cannot change a verdict — but a harness
  // whose output is two-thirds warnings is one whose failures get skimmed.
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  let anyTracked = false;
  for (const [mapDir, runId, obj, opts] of runs) {
    const dir = path.join(root, mapDir, 'S1-services', runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'verified-services.json'),
      typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
    if (!opts || opts.track !== false) {
      execFileSync('git', ['add', '--', path.join(mapDir, 'S1-services', runId, 'verified-services.json')], { cwd: root });
      anyTracked = true;
    }
  }
  if (anyTracked) execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [CHECKER], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const clean = { town: 'Fixture', services: [{ route: '1', servesTown: true }], notOnLeaflet: [{ route: '99', note: 'a real exclusion, in the canonical field' }] };

console.log('Falsifying check-exclusion-fields.mjs\n');

console.log('1. THE CONTROL — a repo writing only the canonical field is green');
{
  const r = run(repo('clean', [['Areas/Fixture', '2026-09-01_0000', clean]]));
  check('exit 0', r.code === 0, `exit ${r.code}`);
  check('and it says what it looked at, so "none found" cannot read as "all clean"',
    /1 map\(s\) checked at their latest S1 run/.test(r.out) && /no deprecated field is in use/.test(r.out),
    r.out.trim().split('\n').slice(-3).join(' | '));
}

console.log('\n2. Each deprecated field fires, and the row names the field and the routes');
for (const field of ['verifiedNotDisplayed', 'notDisplayed', 'excluded']) {
  const obj = { ...clean, [field]: [{ route: 'W9', reason: 'occasional excursion' }, { route: 'W10', reason: 'as W9' }] };
  const r = run(repo(`dep-${field}`, [['Areas/Fixture', '2026-09-01_0000', obj]]));
  check(`${field} is refused`, r.code === 1, `exit ${r.code}`);
  check(`${field}'s row names it and both routes`,
    r.out.includes(`\`${field}\` is a read-only alias`) && r.out.includes('W9, W10'),
    r.out.split('\n').filter(l => l.includes(field)).slice(0, 1).join(''));
}

console.log('\n3. An entry naming a class rather than a route is still named');
{
  const obj = { ...clean, notDisplayed: [{ group: 'Dedicated school services', reason: 'contracts' }] };
  const r = run(repo('group', [['Areas/Fixture', '2026-09-01_0000', obj]]));
  check('refused', r.code === 1, `exit ${r.code}`);
  check('and the group is named rather than printed as "?"',
    r.out.includes('group: Dedicated school services'),
    r.out.split('\n').filter(l => l.includes('alias')).join(''));
}

console.log('\n4. An EMPTY deprecated array is still the field in use');
{
  const r = run(repo('empty', [['Areas/Fixture', '2026-09-01_0000', { ...clean, notDisplayed: [] }]]));
  check('refused', r.code === 1, `exit ${r.code}`);
  check('and the advice is to delete the key, not to move nothing',
    /is EMPTY — delete the key/.test(r.out), r.out.split('\n').filter(l => l.includes('EMPTY')).join(''));
}

console.log('\n5. THE LOAD-BEARING CASE — a superseded run is a dated record and is left alone');
{
  const r = run(repo('superseded', [
    ['Areas/Fixture', '2026-07-01_0000', { ...clean, notDisplayed: [{ route: 'W9', reason: 'the old spelling' }] }],
    ['Areas/Fixture', '2026-09-01_0000', clean],
  ]));
  check('exit 0 — the migration never has to rewrite history', r.code === 0, `exit ${r.code}`);
  check('and the older run is reported as left alone, not silently ignored',
    /1 superseded run\(s\) left alone/.test(r.out), r.out.split('\n').filter(l => l.includes('superseded')).join(''));
}

console.log('\n6. ...and its complement: the NEWEST run is the one that counts');
{
  const r = run(repo('newest-dirty', [
    ['Areas/Fixture', '2026-07-01_0000', clean],
    ['Areas/Fixture', '2026-09-01_0000', { ...clean, excluded: [{ route: '415', reason: 'not at any stop here' }] }],
  ]));
  check('refused, on the strength of the newest run alone', r.code === 1, `exit ${r.code}`);
  check('and the row names the newest run, not the clean older one',
    r.out.includes('2026-09-01_0000') && !r.out.includes('2026-07-01_0000/verified-services.json'),
    r.out.split('\n').filter(l => l.includes('S1-services')).join(' | '));
}

console.log('\n7. Two maps are told apart, and a path with a space is one of them');
{
  const r = run(repo('two-maps', [
    ['Areas/High Wycombe', '2026-09-01_0000', { ...clean, verifiedNotDisplayed: [{ route: '1S', reason: 'school' }] }],
    ['Areas/St Ives', '2026-09-01_0000', clean],
  ]));
  check('refused for the dirty map only', r.code === 1 && (r.out.match(/read-only alias/g) || []).length === 1,
    `${(r.out.match(/read-only alias/g) || []).length} finding(s)`);
  check('and the spaced path survives git ls-files -z', r.out.includes('Areas/High Wycombe/S1-services'),
    r.out.split('\n').filter(l => l.includes('Areas/')).join(' | '));
  check('both maps were counted', /2 map\(s\) checked/.test(r.out),
    r.out.split('\n').filter(l => l.includes('map(s) checked')).join(''));
}

console.log('\n8. An UNTRACKED file is not the repository\'s problem yet');
{
  const r = run(repo('untracked', [
    ['Areas/Fixture', '2026-09-01_0000', clean],
    ['Areas/Fixture', '2026-09-02_0000', { ...clean, excluded: [{ route: 'X', reason: 'mid-build scratch' }] }, { track: false }],
  ]));
  check('exit 0 — git ls-files, never a directory walk', r.code === 0, `exit ${r.code}`);
}

console.log('\n9. A file that will not parse is REPORTED, never skipped into silence');
{
  const r = run(repo('broken', [['Areas/Fixture', '2026-09-01_0000', '{ this is not json']]));
  check('refused', r.code === 1, `exit ${r.code}`);
  check('and it says nothing could be checked in it',
    /could not be parsed as JSON/.test(r.out), r.out.split('\n').filter(l => l.includes('parsed')).join(' | '));
}

console.log('\n10. An empty repository says so rather than passing quietly');
{
  const root = path.join(TMP, 'nothing');
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  const r = run(root);
  check('exit 0, and the count is printed', r.code === 0 && /0 map\(s\) checked/.test(r.out),
    r.out.trim().split('\n').slice(-2).join(' | '));
}

console.log('\n11. An unknown flag is a usage error, not a silent default');
{
  const root = repo('flags', [['Areas/Fixture', '2026-09-01_0000', clean]]);
  const r = spawnSync(process.execPath, [CHECKER, '--all'], { cwd: root, encoding: 'utf8' });
  check('exit 2 and the known flags are listed', r.status === 2 && /known: --root/.test((r.stdout || '') + (r.stderr || '')),
    `exit ${r.status}`);
}

console.log('\n' + '='.repeat(78));
rmSync(TMP, { recursive: true, force: true });
if (failures) {
  console.log(`FAILED — ${failures} of ${ran} assertions did not hold`);
  process.exit(1);
}
console.log(`OK — all ${ran} assertions held: the gate fires on a written alias, stays silent on a superseded run, and reads only what git tracks`);
