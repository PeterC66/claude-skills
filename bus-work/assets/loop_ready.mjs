/*
 * loop_ready.mjs — a file in `loop/adhoc/ready/` that the ticks keep naming and
 * never take (buses-data OA-503, 2026-09-28).
 *
 * THE FOURTH FACT ABOUT THE LOOP, AND THE ONE THAT LOOKED LIKE HEALTH. The loop
 * rows in this skill already say that a tick is running (`loop_lock.mjs`), that
 * ticks are firing and doing nothing (`loop_runs.mjs`), and that something needs
 * Peter (`loop_your_move.mjs`). None of them says *the loop is working, and it is
 * working round your request*. On 2026-09-28 the ticks passed over
 * `places-issues.md` 21 times and `wisbech-capacity.md` 13 times. Step 4 of the
 * task prompt let a tick take only a feed it could FINISH. The first file was too
 * big for one tick and the second was partly gated. So every tick took an OA
 * instead, wrote a `-OA` run file, and listed the two files as "unchanged". The
 * idle row stayed quiet, because an `-OA` tick is a working tick, and no row read
 * `ready/`. The prompt now says a tick always takes a ready/ file unless it is
 * not due. This row is how we find out when it does not.
 *
 * THIS MODULE READS RUN FILES, WHICH loop_runs.mjs DELIBERATELY NEVER DOES. That
 * module measures idleness from filenames alone, so that a tick's wording cannot
 * break it. The question here, whether a tick named this file and took it, is
 * in the prose and not the name. So the reader depends on only two forms, and the
 * prompt fixes both:
 *   - TOOK: the run's bold `**Feed: adhoc — <file>…**` line names the file. Step 5
 *     makes that line the first under the run file's H1.
 *   - NOT DUE: the pass-over is written `` `<file>` (not due: <why>) ``. Step 4
 *     asks for exactly that form. The test below is looser: "not due" or "next
 *     due" anywhere after this filename on the same line, stopping at the name
 *     of any OTHER ready/ file. The runs before OA-503 wrote it loosely, e.g.
 *     "only `zz-weekly-backlog-triage.md`; `backlog-triage-2026-09-25.md` is in
 *     done/, so it is not due until 2026-10-02". So the span cannot stop at the
 *     next filename, only at the next file this row is also asking about.
 * Any other mention counts as a PASS. A tick that names a file without taking it
 * or excusing it has left Peter's request where it was. That is the fault this
 * row reports. The NEWEST tick that named the file decides whether there is a row
 * at all: if it took the file or excused it, the loop is handling it now.
 *
 * AGE IS THE FILE'S mtime. Promoting a file into `ready/` is a rename, which keeps
 * the mtime, so for a file written long before it was promoted the age reads
 * too old. The pass count is taken only from runs AFTER that mtime and within
 * the last `windowHours`. A run can only name a file in `ready/` once it is
 * there, so the count stays honest even when the age is not.
 *
 * SILENCE IS A REQUIREMENT, for the reason `loop_runs.mjs` gives: `loop/` is
 * gitignored, so in CI, a clone or a worktree the folders are absent. Absent,
 * empty and unreadable each yield no row. `prove-red-loop-ready.mjs` proves that
 * against real directories.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseRunName } from './loop_runs.mjs';

/** The `.md` files in `ready/`, as `{ name, mtimeMs }`. Absent or unreadable → []. */
export function readReady(dir) {
  const out = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      try { out.push({ name: e.name, mtimeMs: statSync(path.join(dir, e.name)).mtimeMs }); } catch { /* one file is not the folder */ }
    }
  } catch { return []; }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The run files stamped at or after `since`, with their text. Only these are
 * opened, so a board read costs the last day or two of runs and not the folder's
 * whole history.
 */
export function readRunsSince(dir, since) {
  const out = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const r = parseRunName(e.name);
      if (!r || r.at < since) continue;
      try { out.push({ ...r, text: readFileSync(path.join(dir, e.name), 'utf8') }); } catch { /* skip it */ }
    }
  } catch { return []; }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * What one run did with one ready/ file: 'took', 'not-due', 'passed', or null if
 * the run never names it. `others` are the other ready/ filenames, where a
 * mention's span stops. See the header for the two forms this depends on.
 */
export function verdict(run, file, others = []) {
  const text = String((run && run.text) || '');
  if (!text.includes(file)) return null;
  const lines = text.split('\n');
  const feedLine = lines.find((l) => /\*\*Feed:/i.test(l)) || '';
  if (run.feed === 'adhoc' && feedLine.includes(file)) return 'took';
  for (const line of lines) {
    let at = line.indexOf(file);
    while (at !== -1) {
      let span = line.slice(at + file.length);
      for (const o of others) {
        const cut = o === file ? -1 : span.indexOf(o);
        if (cut !== -1) span = span.slice(0, cut);
      }
      if (/\b(not|next) due\b/i.test(span)) return 'not-due';
      at = line.indexOf(file, at + file.length);
    }
  }
  return 'passed';
}

const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

/**
 * One row per ready/ file the loop is not taking.
 *
 * @param {object} p
 * @param {Array<{name, mtimeMs}>} p.ready     from readReady()
 * @param {Array<{name, at, feed, text}>} p.runs  from readRunsSince()
 * @param {number} [p.now]
 * @param {number} [p.minAgeMin]   a file younger than this is not yet late (default 180)
 * @param {number} [p.minPasses]   passes before it is a signal (default 2)
 * @param {number} [p.windowHours] only runs this recent count (default 48)
 */
export function adhocNotTakenItems({ ready, runs, now = Date.now(), minAgeMin = 180, minPasses = 2, windowHours = 48 }) {
  const items = [];
  const floor = now - windowHours * 3600000;
  const names = (ready || []).map((f) => f.name);
  for (const f of ready || []) {
    const ageMin = Math.round((now - f.mtimeMs) / 60000);
    if (ageMin < minAgeMin) continue;
    const seen = (runs || []).filter((r) => r.at >= Math.max(f.mtimeMs - 60000, floor))
      .map((r) => ({ at: r.at, name: r.name, v: verdict(r, f.name, names) }))
      .filter((x) => x.v);
    if (!seen.length) continue;
    // The newest tick decides. If it took the file, or passed it over as not due,
    // the loop is handling it now, whatever earlier ticks did.
    if (seen[seen.length - 1].v !== 'passed') continue;
    const passes = seen.filter((x) => x.v === 'passed');
    if (passes.length < minPasses) continue;
    const first = passes[0];
    const last = passes[passes.length - 1];
    items.push({
      key: `adhoc-not-taken/${f.name.replace(/\.md$/i, '')}`,
      rank: 3, type: 'loop-health',
      title: `The loop is not taking this: \`loop/adhoc/ready/${f.name}\` has been named by ${passes.length} tick${passes.length === 1 ? '' : 's'} since ${hhmm(first.at)}, and none took it`,
      why: `A file in \`loop/adhoc/ready/\` is a request you promoted. Since OA-503, step 4 of the task prompt says a tick takes every ready/ file unless it is not due. A tick that cannot finish a file does its first slice and files the rest as OAs. A tick that meets a gate does the ungated half and records the gate. A file that needs a person becomes a hold. A tick passes over a file only as \`\` \`<file>\` (not due: <why>) \`\`. ${passes.length} run file${passes.length === 1 ? '' : 's'} named this one in some other way, the newest being \`${last.name}\`, which should say why. So the prompt is not being followed for this file, or the file asks for something the prompt has no way to handle.`,
      who: 'Peter', runbook: 'loop',
      ageDays: Math.floor(ageMin / 1440),
      passes: passes.length, file: f.name,
      do: [
        { kind: 'chat', what: `Read loop/runs/${last.name} for the tick's reason, then either split loop/adhoc/ready/${f.name} into pieces a tick can take, or move it back to loop/your-move/ and file it as an OA.` },
      ],
    });
  }
  return items;
}
