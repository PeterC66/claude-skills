#!/usr/bin/env node
/* Prove each guard in commit_paths.mjs can fail (buses-data OA-617).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), no placeholders:
 *
 *   node prove-red-commit-paths.mjs
 *
 * WHAT IS BEING FALSIFIED. `prove-red-commit-paths-cases.mjs` says the script refuses what it must and reads
 * back what it must. A suite nobody has seen go red proves less than it looks, so this breaks the
 * script on purpose: for every line in commit_paths.mjs tagged `@guard:<name>`, a scratch copy has
 * that one line removed or weakened, and the cases that guard owns are run against the copy. Each
 * must turn RED. A mutant that stays green is a guard nothing depends on — either dead weight, or
 * a case missing.
 *
 * THE JOIN, both ways. A tag in the source that no mutant breaks is a guard added without a
 * falsification, and a mutant whose tag is not in the source is a guard that was deleted and left
 * its twin behind. Either is a failure here, so the list below cannot drift from the file.
 *
 * Nothing in the real tree is edited: the copies live in the temp folder. The test cases build
 * their own throwaway git repositories. No network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'commit_paths.mjs');
const TEST = path.join(HERE, 'prove-red-commit-paths-cases.mjs');
const src = fs.readFileSync(SOURCE, 'utf8');

const drop = (id) => (line) => `${line.match(/^\s*/)[0]}// mutated away: ${id}`;
const swap = (from, to) => (line) => { if (!line.includes(from)) throw new Error(`the line no longer contains ${JSON.stringify(from)}`); return line.replace(from, to); };
const whole = (to) => (line) => `${line.match(/^\s*/)[0]}${to}`;

/* tag -> how to break it, and the test cases that must object. */
const MUTANTS = {
  literal: [drop('literal'), ['literal']],
  glob: [drop('glob'), ['refuse-glob*']],
  outside: [drop('outside'), ['refuse-outside*']],
  dir: [drop('dir'), ['refuse-dir*']],
  staged: [drop('staged'), ['staged']],
  token: [drop('token'), ['token']],
  digest: [swap('e.head, e.work]', 'e.head]'), ['token']],
  'msg-hash': [swap('message: message.hash', "message: ''"), ['token']],
  branch1: [drop('branch1'), ['branch1']],
  branch2: [drop('branch2'), ['branch2']],
  head: [drop('head'), ['head']],
  'commit-env': [swap("argv[0] !== 'commit' /* @guard:commit-env */", 'true /* @guard:commit-env */'), ['hook-glob']],
  'commit-literal': [swap(':(literal)', ''), ['literal']],
  pathspec: [whole("const argv = ['commit', '--quiet', '-F', p.message.file];"), ['pathspec']],
  unstage: [drop('unstage'), ['hook-refuses']],
  lock: [drop('lock'), ['lock']],
  refresh: [whole('const refreshed = [];'), ['rb-stamp']],
  'rb-subject': [whole("checks.push(checkRow('subject', true));"), ['rb-subject']],
  'rb-files': [whole("checks.push(checkRow('files', true));"), ['rb-files']],
  'rb-clean': [whole("checks.push(checkRow('status clean', true));"), ['rb-clean']],
  'rb-content': [whole('checks.push(checkRow(`content ${e.path}`, true));'), ['rb-content']],
  'rb-stamp': [swap('!isStampLine(l) /* @guard:rb-stamp */ && ', ''), ['rb-stamp']],
  'index-set': [drop('index-set'), ['index-set']],
  'index-kind': [drop('index-kind'), ['index-kind']],
  'index-recheck': [drop('index-recheck'), ['index-recheck']],
};

let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

console.log('commit_paths falsification harness\n');
console.log('1. The tags in the source and the mutants here are the same set');
const tagged = [...src.matchAll(/@guard:([a-z0-9-]+)/g)].map((m) => m[1]);
const dupes = tagged.filter((t, i) => tagged.indexOf(t) !== i);
say(dupes.length === 0, `no tag is used twice${dupes.length ? ': ' + dupes.join(', ') : ''}`);
const unbroken = [...new Set(tagged)].filter((t) => !MUTANTS[t]);
say(unbroken.length === 0, `every guard in the source has a mutant${unbroken.length ? ' — NOT BROKEN: ' + unbroken.join(', ') : ''}`);
const orphans = Object.keys(MUTANTS).filter((t) => !tagged.includes(t));
say(orphans.length === 0, `every mutant names a guard that is still in the source${orphans.length ? ' — GONE: ' + orphans.join(', ') : ''}`);

console.log('\n2. Control: the real script is green on every case the mutants will use');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-paths-prove-'));
const casesAll = [...new Set(Object.values(MUTANTS).flatMap(([, c]) => c))];
const control = spawnSync(process.execPath, [TEST, '--only', casesAll.join(',')], { encoding: 'utf8' });
say(control.status === 0, `${casesAll.length} case selector(s) pass on the real script${control.status === 0 ? '' : '\n' + control.stdout.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`);

console.log('\n3. Each broken copy must turn its cases red');
const runMutant = (tag) => new Promise((resolve) => {
  const [edit, cases] = MUTANTS[tag];
  const lines = src.split('\n');
  const at = lines.map((l, i) => (l.includes(`@guard:${tag}`) ? i : -1)).filter((i) => i >= 0);
  if (at.length !== 1) return resolve({ tag, error: `expected the tag on exactly one line, found ${at.length}` });
  let broken;
  try { broken = edit(lines[at[0]]); } catch (e) { return resolve({ tag, error: e.message }); }
  if (broken === lines[at[0]]) return resolve({ tag, error: 'the edit changed nothing' });
  lines[at[0]] = broken;
  const dir = path.join(scratch, tag);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'commit_paths.mjs');
  fs.writeFileSync(file, lines.join('\n'));
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) return resolve({ tag, error: 'the mutant does not parse: ' + syntax.stderr.split('\n')[0] });
  const child = spawn(process.execPath, [TEST, '--only', cases.join(',')], { env: { ...process.env, COMMIT_PATHS_SCRIPT: file } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ tag, code, failed: out.split('\n').filter((l) => /^\s+FAIL/.test(l)).map((l) => l.trim().split(':')[0].replace('FAIL ', '')) }));
});

const queue = Object.keys(MUTANTS);
const results = [];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) results.push(await runMutant(queue.shift())); }));
for (const tag of Object.keys(MUTANTS)) {
  const r = results.find((x) => x.tag === tag);
  if (r.error) say(false, `${tag}: ${r.error}`);
  else say(r.code === 1 && r.failed.length > 0, `${tag}: broken -> ${r.code === 1 ? 'red in ' + r.failed.join(', ') : 'STILL GREEN (exit ' + r.code + '): nothing depends on this guard'}`);
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log(bad ? `\nFAIL — ${bad} check(s) did not see the break they were written to see` : `\nOK — ${Object.keys(MUTANTS).length} guards, each seen to fail when broken`);
process.exit(bad ? 1 : 0);
