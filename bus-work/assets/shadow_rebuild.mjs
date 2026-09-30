#!/usr/bin/env node
/*
 * shadow_rebuild.mjs — the weekly shadow rebuild: how would TODAY'S engine draw
 * every live map? Both estate rollouts, dry run, publishing nothing (buses-data
 * OA-485 item 1).
 *
 * WHY THIS EXISTS. Each map is gated against the engine commit that drew it
 * (buses-data OA-430), which proves the map reproduces, not that today's engine
 * still draws it acceptably. So the first customer change to an old map inherits
 * every engine change since, all at once, and nobody has looked at any of them.
 * Slice 1 (claude-skills #242) gave `rollout.js` and `rollout_places.js` a
 * `--json` verdict per map — clean, regressed or unmeasured. This is the job that
 * asks the question every week, so the answer is on disk before somebody needs it.
 *
 * WHAT IT DOES, AND THE ORDER IS THE DESIGN.
 *
 *   1. Runs `rollout.js --all` and `rollout_places.js --all` with `--json` into a
 *      scratch folder. NEVER with `--apply`: a dry run builds each map in a temp
 *      folder and writes nothing under Areas/ or Places/.
 *   2. Checks that claim rather than trusting it: `git status` of Areas/ and
 *      Places/ is read before and after, and a difference is a refusal.
 *   3. Writes `loop/shadow-rebuild.json` — both reports whole, plus when and on
 *      which engine. That file is the STAMP the loop prompt's `find -mmin` test
 *      reads, exactly as `doc-triage.json` is, and it is written on every run that
 *      could ask both questions, whatever the answer — or the tick would redo
 *      several minutes of builds every tick for ever. The board count (OA-485
 *      item 3) reads it; nothing here writes a board row.
 *
 * A REGRESSED MAP IS AN ANSWER, NOT A FAILURE. `rollout.js` exits 1 when any map
 * would lose a label or raise a blocking warning; that is exactly what this job
 * exists to count, so it exits 0 and says so. `regressed` means LOOK: the
 * lost-label rule cannot tell a deliberate change from damage.
 *
 * A HALF IT CANNOT RUN IS EXIT 2, NEVER A CLEAN REPORT — a rollout missing from
 * disk, one that refused (exit 2) or died, one that wrote no JSON or JSON that is
 * not a rollout report, or one whose report says it applied. Then no stamp is
 * written, so the next tick asks again. A shadow rebuild that silently dropped
 * the place maps would report "the estate is clean" about half an estate.
 *
 * IT COMMITS NOTHING AND TOUCHES NO TRACKED FILE — not `ci-reference/`, not a
 * map's manifest. `loop/` is gitignored and is the only place it writes.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with no
 * placeholders:
 *
 *   node shadow_rebuild.mjs
 *
 * `--buses <dir>` points at a different buses tree, `--engine <dir>` at a
 * different folder holding the two rollout scripts, and `--out <file>` moves the
 * stamp; the last two exist for prove-red-shadow-rebuild.mjs.
 *
 * Falsified by prove-red-shadow-rebuild.mjs beside this file.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses, assetsDir } from './engine.mjs';

const STAMP_NAME = 'shadow-rebuild.json';
const HALVES = [
  { key: 'towns', script: 'rollout.js', tool: 'rollout.js', kind: 'town' },
  { key: 'places', script: 'rollout_places.js', tool: 'rollout_places.js', kind: 'place' },
];

/** The estate's tracked state, or null when the tree is not a git checkout. */
function estateStatus(buses) {
  const r = spawnSync('git', ['-C', buses, 'status', '--porcelain', '--untracked-files=all', '--', 'Areas', 'Places'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/**
 * Run one rollout, dry, and hand back its report or the reason there is none.
 * A rollout that could not answer is never confused with one that found nothing.
 */
function runHalf(half, engine, buses, scratch) {
  const file = path.join(engine, half.script);
  if (!fs.existsSync(file)) return { ok: false, why: `${half.script} is not at ${file}` };
  const out = path.join(scratch, `${half.key}.json`);
  const r = spawnSync(process.execPath, [file, '--all', '--buses', buses, '--json', out],
    { encoding: 'utf8', cwd: engine, maxBuffer: 256 * 1024 * 1024 });
  const tail = ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-3).join(' / ');
  if (r.error) return { ok: false, why: `${half.script} would not run: ${r.error.message}` };
  if (r.status !== 0 && r.status !== 1) return { ok: false, why: `${half.script} exited ${r.status}: ${tail}` };
  if (!fs.existsSync(out)) return { ok: false, why: `${half.script} exited ${r.status} and wrote no --json report — did its --json flag change?` };
  let report;
  try { report = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {
    return { ok: false, why: `${half.script} wrote a --json report that is not JSON` };
  }
  if (!report || report.tool !== half.tool || !report.counts || !Array.isArray(report.maps)) {
    return { ok: false, why: `${half.script} wrote JSON that is not a rollout report (no tool/counts/maps)` };
  }
  if (report.apply !== false) return { ok: false, why: `${half.script}'s report says apply=${report.apply} — a shadow rebuild never applies` };
  return { ok: true, code: r.status, report };
}

export function shadowRebuild({ buses, engine }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-rebuild-'));
  try {
    const before = estateStatus(buses);
    const halves = {};
    for (const h of HALVES) halves[h.key] = runHalf(h, engine, buses, scratch);
    const after = estateStatus(buses);
    return { halves, estateChecked: before !== null && after !== null, estateUntouched: before === after };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const line = (label, c) => `${label}: ${c.clean} clean, ${c.regressed} regressed, ${c.unmeasured} unmeasured, of ${c.total}`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const buses = resolveBuses(args);
  const engine = typeof args.engine === 'string' ? path.resolve(args.engine) : assetsDir();

  if (!fs.existsSync(buses)) {
    console.error(`shadow_rebuild: no buses tree at ${buses} — nothing was built`);
    process.exit(2);
  }
  if (!engine || !fs.existsSync(engine)) {
    console.error('shadow_rebuild: no make-bus-leaflet assets folder found — nothing was built');
    process.exit(2);
  }

  const result = shadowRebuild({ buses, engine });

  const broken = HALVES.map((h) => result.halves[h.key]).filter((r) => !r.ok);
  if (broken.length) {
    for (const b of broken) console.error(`shadow_rebuild: ${b.why}`);
    console.error('shadow_rebuild: refusing — a shadow rebuild that drops one of its halves cannot report the estate. No stamp was written.');
    process.exit(2);
  }
  /* THE DRY RUN'S PROMISE, CHECKED. A rollout that wrote into a map folder has
   * broken the one thing an unattended weekly job must never do, and the stamp
   * must not make the next week look ordinary. */
  if (result.estateChecked && !result.estateUntouched) {
    console.error('shadow_rebuild: Areas/ or Places/ changed while the dry runs ran — refusing. Read `git status -- Areas Places` in the buses tree before anything else. No stamp was written.');
    process.exit(2);
  }

  const towns = result.halves.towns.report;
  const places = result.halves.places.report;
  const loopDir = path.join(buses, 'loop');
  const stampFile = args.out ? path.resolve(args.out) : path.join(loopDir, STAMP_NAME);
  const stamp = {
    ranAt: new Date().toISOString(),
    buses,
    engine: towns.engine ?? places.engine ?? null,
    estateUntouched: result.estateChecked ? true : null,
    counts: {
      clean: towns.counts.clean + places.counts.clean,
      regressed: towns.counts.regressed + places.counts.regressed,
      unmeasured: towns.counts.unmeasured + places.counts.unmeasured,
      total: towns.counts.total + places.counts.total,
    },
    towns,
    places,
  };

  console.log(line('towns ', towns.counts));
  console.log(line('places', places.counts));
  for (const m of [...towns.maps, ...places.maps].filter((x) => x.verdict === 'regressed')) {
    console.log(`  regressed: ${m.name} (${m.status}${m.lost ? `, ${m.lost} label(s) lost` : ''}${m.blockers ? `, ${m.blockers} blocking warning(s)` : ''})`);
  }
  if (!result.estateChecked) console.log('  the buses tree is not a git checkout here, so the dry runs\' promise to write nothing was not checked');

  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify(stamp, null, 2) + '\n', 'utf8');
  console.log(`\nstamped: ${stampFile}`);
  console.log('A regressed map means look, not fix: the lost-label rule cannot tell a deliberate change from damage.');
}

/* EXECUTED, not imported — the idiom the rest of this folder uses. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
