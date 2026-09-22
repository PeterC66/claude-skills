#!/usr/bin/env node
/* Prove the weekly document triage can find something, can say nothing, can
 * REFUSE, and never deletes a draft (buses-data, 2026-09-22).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-doc-triage.mjs
 *
 * WHAT IS BEING FALSIFIED, AND WHY THE REFUSAL CASES ARE THE POINT. This runner
 * exists because a sentence in `Development Docs/README.md` said the weekly
 * triage runs `list-archive-candidates.mjs` and nothing executed it for a
 * fortnight. The failure mode of the replacement is the same shape one level
 * down: a triage that runs, drops one of its two halves silently, and reports
 * "nothing to do" about a question it never asked. So the cases that matter
 * most are the ones where a checker is MISSING, REFUSES or prints something
 * that is not JSON — in all three the runner must exit 2 and say which half it
 * lost, never exit 0.
 *
 * AND IT MUST NOT TIDY. `loop/your-move/` is Peter's triage and a draft there is
 * never deleted by a tick: the reason a finding was raised is part of the
 * record even after the finding is fixed. Case 5 holds that.
 *
 * Every fixture is a whole little buses tree with stub checkers in
 * `Documentation/`, so nothing here depends on the real repository, the real
 * memory store, or the real `loop/`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'doc_triage.mjs');

/* A stub checker that prints the JSON it is given and exits with the code it is
 * given — the two things doc_triage.mjs reads, and nothing else. */
const stub = (json, code = 0) =>
  `console.log(${JSON.stringify(JSON.stringify(json, null, 1))});\nprocess.exit(${code});\n`;

function fixture({ candidates, memory, drafts = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctriage-'));
  fs.mkdirSync(path.join(dir, 'Documentation'), { recursive: true });
  if (candidates !== null) fs.writeFileSync(path.join(dir, 'Documentation', 'list-archive-candidates.mjs'), candidates, 'utf8');
  if (memory !== null) fs.writeFileSync(path.join(dir, 'Documentation', 'check-memory-paths.mjs'), memory, 'utf8');
  const ym = path.join(dir, 'loop', 'your-move');
  if (Object.keys(drafts).length) fs.mkdirSync(ym, { recursive: true });
  for (const [name, body] of Object.entries(drafts)) fs.writeFileSync(path.join(ym, name), body, 'utf8');
  return dir;
}

const run = (dir, extra = []) => {
  const r = spawnSync(process.execPath, [RUNNER, '--buses', dir, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};

const CLEAN_CANDS = stub({ root: '.', dated: 23, liveActions: 135, candidates: [] });
const CLEAN_MEM = stub({ stores: ['S'], scannedPaths: 452, stale: [] });

let failed = 0;
const ran = { 'RED  ': 0, GREEN: 0 };
const report = (ok, line, label = 'RED  ') => { if (!ok) failed++; ran[label]++; console.log(`  ${ok ? label : 'MISS '} ${line}`); };

console.log('A half it cannot run — it must REFUSE, and name which half:\n');

{
  const dir = fixture({ candidates: null, memory: CLEAN_MEM });
  const { code, err } = run(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  report(code === 2 && /list-archive-candidates\.mjs is not at/.test(err) && /cannot report clear/.test(err),
    'a checker that is not on disk — exit 2, named, never "nothing to do"'
    + (code === 2 ? '' : `  <-- exited ${code}\n${err}`));
}

{
  const dir = fixture({ candidates: CLEAN_CANDS, memory: stub({}, 2) });
  const { code, err } = run(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  report(code === 2 && /check-memory-paths\.mjs refused \(exit 2\)/.test(err),
    'a checker that refuses — its exit 2 is carried, not flattened to a clean report'
    + (code === 2 ? '' : `  <-- exited ${code}\n${err}`));
}

{
  /* The shape that would arrive by accident: somebody renames a flag and the
   * checker prints its human report instead of JSON. */
  const dir = fixture({ candidates: CLEAN_CANDS, memory: 'console.log("3 findings, go and look");\n' });
  const { code, err } = run(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  report(code === 2 && /did not print JSON/.test(err),
    'a checker whose output stops being JSON — exit 2, rather than parsed as empty'
    + (code === 2 ? '' : `  <-- exited ${code}\n${err}`));
}

console.log('\nWhat it does when both halves answer:\n');

{
  const dir = fixture({
    candidates: stub({ dated: 23, candidates: [{ document: 'Development Docs/x_2026-01-01.md', namedBy: ['Development Docs/y_2026-01-02.md'] }] }),
    memory: stub({ stores: ['S'], scannedPaths: 10, stale: [{ store: '/a/C--proj/memory', file: 'm.md', path: 'Development Docs/z.md', isNow: 'Development Docs/_archive/z.md' }] }),
  });
  const { code, out } = run(dir);
  const draft = path.join(dir, 'loop', 'your-move', 'doc-triage.md');
  const stampRaw = fs.readFileSync(path.join(dir, 'loop', 'doc-triage.json'), 'utf8');
  const body = fs.readFileSync(draft, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  const stamp = JSON.parse(stampRaw);
  report(code === 0
      && stamp.archiveCandidates === 1 && stamp.staleMemoryPaths === 1
      && body.includes('Development Docs/x_2026-01-01.md')
      && body.includes('Development Docs/_archive/z.md')
      /* THE PROPERTY THAT MAKES IT A DRAFT RATHER THAN A HOLD. loop_your_move.mjs
       * reads these two off the file; a draft that grew either would silently
       * become a rank-3 row claiming to block something. */
      && !body.includes('## What is needed from you')
      && !/\*\*Blocks:\*\*/.test(body)
      /* The fix command is BUILT from the buses root this run resolved, never
       * typed. A literal laptop path here would be wrong on every machine but
       * one — including in a worktree of that one — and `prove-red-engine-adoption`
       * refuses one in this repository's source, which is how the first draft
       * of this file was caught. */
      && body.includes(`node "${dir.split('\\').join('/')}/Documentation/check-memory-paths.mjs" --apply`),
    'both halves found something — stamped, drafted, no ask, no Blocks, and the fix command built from the resolved root'
    + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');
}

{
  const dir = fixture({ candidates: CLEAN_CANDS, memory: CLEAN_MEM });
  const { code } = run(dir);
  const stamped = fs.existsSync(path.join(dir, 'loop', 'doc-triage.json'));
  const drafted = fs.existsSync(path.join(dir, 'loop', 'your-move', 'doc-triage.md'));
  fs.rmSync(dir, { recursive: true, force: true });
  report(code === 0 && stamped && !drafted,
    'nothing found — STAMPED anyway, so the tick does not redo this every tick, and no draft written'
    + (code === 0 ? '' : `  <-- exited ${code}`), 'GREEN');
}

{
  /* A draft is Peter's to move. A tick that tidied one away because the finding
   * had since been fixed would delete the record of the finding with it. */
  const KEEP = '# An earlier triage\n\nSomething was found last week.\n';
  const dir = fixture({ candidates: CLEAN_CANDS, memory: CLEAN_MEM, drafts: { 'doc-triage.md': KEEP } });
  const { code, out } = run(dir);
  const after = fs.readFileSync(path.join(dir, 'loop', 'your-move', 'doc-triage.md'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  report(code === 0 && after === KEEP && /left alone/.test(out),
    'nothing found and a draft already there — left EXACTLY as it was, and said so'
    + (after === KEEP ? '' : '  <-- the draft was rewritten or removed'), 'GREEN');
}

{
  const dir = fixture({ candidates: CLEAN_CANDS, memory: CLEAN_MEM });
  const { code } = run(dir, ['--dry-run']);
  const stamped = fs.existsSync(path.join(dir, 'loop', 'doc-triage.json'));
  fs.rmSync(dir, { recursive: true, force: true });
  report(code === 0 && !stamped, '--dry-run writes neither file'
    + (stamped ? '  <-- it stamped anyway' : ''), 'GREEN');
}

{
  const r = spawnSync(process.execPath, [RUNNER, '--buses', path.join(os.tmpdir(), 'no-such-buses-xyz')], { encoding: 'utf8' });
  report(r.status === 2 && /no buses tree at/.test(r.stderr || ''),
    'no buses tree at all — exit 2, "I cannot tell you"'
    + (r.status === 2 ? '' : `  <-- exited ${r.status}`), 'GREEN');
}

console.log(`\n${failed
  ? `${failed} CHECK${failed === 1 ? '' : 'S'} COULD NOT BE FALSIFIED`
  : `All ${ran['RED  ']} refusals were watched fire, and all ${ran.GREEN} controls held.`}`);
process.exitCode = failed ? 1 : 0;
