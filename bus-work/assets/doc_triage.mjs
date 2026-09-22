#!/usr/bin/env node
/*
 * doc_triage.mjs — the weekly pass over the two document checks that CANNOT run
 * in CI, and the draft that carries what they find to Peter (buses-data, asked
 * for 2026-09-22).
 *
 * WHY THIS EXISTS. `Development Docs/README.md` has said since 2026-09-21 that
 * `list-archive-candidates.mjs` is what "the loop's weekly triage is meant to
 * run". Grepped on 2026-09-22, the only things naming that script were four
 * documents inside buses-data: no loop move, no worklist row, no workflow. The
 * sentence described an intention and nothing executed it — the same shape as
 * *a rule that is consulted is not a rule that is executed*, one level up, where
 * the thing not executed is a whole recurring job. `check-memory-paths.mjs`,
 * written the same day, was about to join it: both are local-only by
 * construction, because their subjects — Claude's memory store, and a judgement
 * about whether a document is finished — do not survive `actions/checkout`.
 *
 * WHAT IT DOES, AND THE ORDER IS THE DESIGN.
 *
 *   1. Runs both checkers with `--json`, so nothing here greps a report. A
 *      runner that reads prose goes quiet the day somebody improves a sentence.
 *   2. Writes `loop/doc-triage.json`. That file is the STAMP the loop prompt's
 *      `find -mmin` test reads, exactly as `pr-sweep.json` is, and it is written
 *      on every run — including a run that finds nothing, or the tick would redo
 *      this work every tick for ever.
 *   3. Writes ONE draft, `loop/your-move/doc-triage.md`, and only when there is
 *      something to say.
 *
 * IT IS READ-ONLY ON THE MEMORY STORE, DELIBERATELY. `check-memory-paths.mjs
 * --apply` is mechanical and harness-backed, and running it here would be a
 * genuine saving. It is not run, because that store is in NO REPOSITORY: an
 * unattended write to it leaves no diff anybody can review and nothing to
 * revert to. The draft carries the exact command instead, and a person runs it.
 * The rule this follows is the estate's own — a tick may write where the history
 * is readable, and `loop/` and the map trees are both.
 *
 * ONE DRAFT, REWRITTEN, NEVER DELETED. `loop/your-move/` is the one outbound
 * folder and a draft there is Peter's triage; n drafts for n weeks of the same
 * unanswered finding would bury the thing somebody is actually waiting on. So
 * there is a single file, rewritten while the findings stand. **A run that finds
 * nothing does not delete an existing draft** — a draft is never deleted, the
 * reason is the record, and Peter moving it to `loop/adhoc/done/` is what closes
 * it.
 *
 * IT CARRIES NO `## What is needed from you` AND NO `**Blocks:**`, which is what
 * makes it a DRAFT rather than a hold. Nothing here blocks anybody: an archive
 * candidate is a question and a stale memory path is a chore. `loop_your_move.mjs`
 * reads that property off the file, so the shape of this template is load-bearing
 * and not decoration.
 *
 * A CHECKER IT CANNOT RUN IS EXIT 2, NEVER A CLEAN REPORT. If a script is missing
 * or dies, this says so and refuses; a triage that silently drops one of its two
 * halves would report "nothing to do" about a question it never asked.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node doc_triage.mjs                 run both checks, stamp, draft if needed
 *   node doc_triage.mjs --dry-run       report only; write neither file
 *
 * `--buses <dir>` points at a different buses tree; `--out <file>` and
 * `--your-move <dir>` relocate the two outputs, and exist for
 * prove-red-doc-triage.mjs.
 *
 * Falsified by prove-red-doc-triage.mjs beside this file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses } from './engine.mjs';

const DRAFT_NAME = 'doc-triage.md';
const STAMP_NAME = 'doc-triage.json';

/**
 * Run one checker and hand back its parsed JSON, or the reason there is none.
 * A checker that cannot be run is never confused with one that found nothing.
 */
function runChecker(buses, script, flags) {
  const file = path.join(buses, 'Documentation', script);
  if (!fs.existsSync(file)) return { ok: false, why: `${script} is not at ${file}` };
  const r = spawnSync(process.execPath, [file, ...flags], { encoding: 'utf8', cwd: buses });
  if (r.error) return { ok: false, why: `${script} would not run: ${r.error.message}` };
  if (r.status === 2) return { ok: false, why: `${script} refused (exit 2): ${(r.stderr || '').trim().split('\n')[0]}` };
  let data;
  try { data = JSON.parse(r.stdout); } catch {
    return { ok: false, why: `${script} did not print JSON — did its --json flag change?` };
  }
  return { ok: true, code: r.status, data };
}

export function triage(buses) {
  const candidates = runChecker(buses, 'list-archive-candidates.mjs', ['--json']);
  const memory = runChecker(buses, 'check-memory-paths.mjs', ['--json']);
  return { buses, candidates, memory };
}

/** The draft's body. Deliberately carries no ask and no Blocks field. */
export function draftBody(result, today) {
  const cands = result.candidates.data?.candidates ?? [];
  const stale = result.memory.data?.stale ?? [];
  const lines = [];
  lines.push('# The weekly document triage found something');
  lines.push('');
  lines.push(`Written by the scheduled loop's weekly pass on ${today}. Both of these checks are local-only by construction — their subjects do not survive \`actions/checkout\`, so CI has no copy of either and never will. Nothing here blocks anything; each item is a question or a chore.`);
  lines.push('');

  if (cands.length) {
    lines.push(`## ${cands.length} archive candidate${cands.length === 1 ? '' : 's'} — a question, not a fault`);
    lines.push('');
    lines.push('Each is a dated document in `Development Docs/` that no live action and no seed document names, and that cites no live action. The test that decides is *does the ROW carry the work, or does the DOCUMENT?* — see `Development Docs/README.md`.');
    lines.push('');
    for (const c of cands) {
      const named = (c.namedBy || []).length ? ` — still named by ${c.namedBy.join(', ')}` : ' — named by nothing at all';
      lines.push(`- \`${c.document}\`${named}`);
    }
    lines.push('');
  }

  if (stale.length) {
    lines.push(`## ${stale.length} memory path${stale.length === 1 ? '' : 's'} naming a file that moved — a chore`);
    lines.push('');
    lines.push('Each names a file this repository still holds, exactly once, somewhere else. **This pass did not fix them**: the memory store is in no repository, so an unattended write there leaves no diff to review and nothing to revert to.');
    lines.push('');
    for (const s of stale) lines.push(`- \`${s.path}\` → \`${s.isNow}\`  (${path.basename(path.dirname(s.store))}/${s.file})`);
    lines.push('');
    lines.push('One command fixes every one of them, and it prints what it changed:');
    lines.push('');
    lines.push('```bash');
    /* Built from the buses root this run actually resolved, never typed. This
     * repository is public and machine-independent, and `gate:laptop-paths`
     * refuses a literal `C:/u3a St Ives/...` in its source — correctly: a path
     * typed here is a path that is wrong on every machine but one, including in
     * a worktree of this one. */
    lines.push(`node "${result.buses.split('\\').join('/')}/Documentation/check-memory-paths.mjs" --apply`);
    lines.push('```');
    lines.push('');
  }

  lines.push('## What to do with this');
  lines.push('');
  lines.push('It is a draft, so the three dispositions are the usual ones: **promote** it into `loop/adhoc/ready/`, **file** what deserves a row and move this to `loop/adhoc/done/`, or **decline** it with a `## DECLINED` section saying why. A draft is never deleted — the reason is the record.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const buses = resolveBuses(args);
  const dryRun = !!args['dry-run'];

  if (!fs.existsSync(buses)) {
    console.error(`doc_triage: no buses tree at ${buses} — nothing was checked`);
    process.exit(2);
  }

  const result = triage(buses);

  /* A HALF THAT COULD NOT RUN IS A REFUSAL. Reporting "nothing to do" about a
   * question that was never asked is the shape this whole family exists to
   * prevent. */
  const broken = [result.candidates, result.memory].filter((r) => !r.ok);
  if (broken.length) {
    for (const b of broken) console.error(`doc_triage: ${b.why}`);
    console.error('doc_triage: refusing — a triage that drops one of its halves cannot report clear.');
    process.exit(2);
  }

  const cands = result.candidates.data.candidates ?? [];
  const stale = result.memory.data.stale ?? [];
  const found = cands.length + stale.length;
  const today = new Date().toISOString().slice(0, 10);

  const loopDir = path.join(buses, 'loop');
  const yourMove = args['your-move'] ? path.resolve(args['your-move']) : path.join(loopDir, 'your-move');
  const stampFile = args.out ? path.resolve(args.out) : path.join(loopDir, STAMP_NAME);
  const draftFile = path.join(yourMove, DRAFT_NAME);

  const stamp = {
    ranAt: new Date().toISOString(),
    buses,
    archiveCandidates: cands.length,
    staleMemoryPaths: stale.length,
    memoryStores: result.memory.data.stores ?? [],
    memoryPathsRead: result.memory.data.scannedPaths ?? null,
    datedDocuments: result.candidates.data.dated ?? null,
    draft: found ? draftFile : null,
  };

  console.log(`${cands.length} archive candidate(s); ${stale.length} stale memory path(s).`);
  console.log(`  read ${stamp.datedDocuments} dated document(s) and ${stamp.memoryPathsRead} memory path(s) across ${stamp.memoryStores.length} store(s)`);

  if (dryRun) {
    console.log('\n--dry-run: neither the stamp nor the draft was written.');
    if (found) console.log(draftBody(result, today));
    return;
  }

  fs.mkdirSync(loopDir, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify(stamp, null, 2) + '\n', 'utf8');
  console.log(`\nstamped: ${stampFile}`);

  if (found) {
    fs.mkdirSync(yourMove, { recursive: true });
    fs.writeFileSync(draftFile, draftBody(result, today), 'utf8');
    console.log(`drafted: ${draftFile}`);
    console.log('`node worklist.mjs` now counts it in the drafts row.');
  } else if (fs.existsSync(draftFile)) {
    /* NOT DELETED. A draft is Peter's to move, and a tick that tidied one away
     * because the finding had since been fixed would remove the record of the
     * finding along with it. */
    console.log(`nothing found. An earlier draft is still at ${draftFile} — left alone, because a draft is never deleted by a tick.`);
  } else {
    console.log('nothing found, and no draft was written.');
  }
}

/* EXECUTED, not imported — the idiom the rest of this folder uses. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
