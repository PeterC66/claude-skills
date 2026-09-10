/*
 * loop_adhoc.mjs — the scheduled loop's ad-hoc DROP ZONE, `loop/adhoc/`, as a
 * worklist row (buses-data, 2026-09-10, item 7 of Peter's suggestions review).
 *
 * THE FOURTH FACT ABOUT THE LOOP, AND THE LAST FOLDER WITH NO READER. OA-283
 * gave `loop/blocked/` a reader, OA-287 the lock, OA-288 the run folder. The
 * drop zone had none: `loop/adhoc/` is where a tick saves a draft it cannot act
 * on — a finding that needs a decision, a fix it was barred from making — and
 * the design makes it INERT on purpose, so that saving a file in a hurry lands
 * somewhere nothing executes. Inert was right. Unenumerated was not. On
 * 2026-09-10 five drafts sat there, three of them since 2026-09-08, each ending
 * "promote it, or file it as an open action, if you agree" — addressed to a
 * reader who runs `worklist.mjs` and had never been shown the folder. The same
 * shape this project named the day before for `blocked/`: a channel is not a
 * channel until something the reader already opens enumerates it.
 *
 * ONE ROW, NOT ONE PER FILE. A draft blocks nobody and asks for a triage rather
 * than an answer, so the whole folder is one line in YOUR MOVE with the count
 * and the oldest age, and the files are named inside it. Five rows for five
 * drafts would bury the four things a person is actually waiting on, which is
 * the rule the housekeeping rows already follow.
 *
 * THE DROP ZONE ONLY. `ready/`, `doing/` and `done/` are subfolders of the same
 * directory and are NOT counted: `ready/` is read by the dispatcher, `doing/`
 * by the crash rule, `done/` by nobody on purpose. Counting `ready/` here would
 * report as "awaiting your triage" a prompt Peter has already triaged, and the
 * harness holds that line with a file in each subfolder.
 *
 * SILENCE IS A REQUIREMENT. `loop/` is gitignored apart from its README, so an
 * absent folder is the normal state in a fresh clone, in a worktree, in CI and
 * in every other harness's fixture. Absent, empty, not-a-directory and an
 * unreadable file each yield no row and no warning — proved against real
 * directories in prove-red-loop-adhoc.mjs, because a fake reader cannot be
 * absent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** One line, no markdown emphasis, no link syntax, collapsed whitespace. */
function plain(s, max = 160) {
  const t = String(s || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Read the top-level `.md` files of `<dir>` — files only, never a subfolder's
 * contents. Absent, empty, not-a-directory and unreadable all return [].
 *
 * @returns {Array<{name, text, mtimeMs}>}
 */
export function readDraftsDir(dir) {
  const out = [];
  try {
    // The try/catch IS the mechanism — no existsSync in front of it, for the
    // reason loop_blocked.mjs records: readdirSync already throws on a missing,
    // undefined or file path, so a guard could be deleted with every case green.
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      try {
        out.push({
          name: e.name,
          // The first 1,200 characters are all the parser reads: an H1, a
          // drafted-by line and a date all sit at the top of every draft a tick
          // has written, and a draft is prose — nothing below that is a field.
          text: readFileSync(path.join(dir, e.name), 'utf8').slice(0, 1200),
          mtimeMs: statSync(path.join(dir, e.name)).mtimeMs,
        });
      } catch { /* one unreadable draft is not the folder's problem */ }
    }
  } catch { return []; }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse one draft. Everything is optional: a file with no H1 and no date still
 * counts, keyed on its filename and aged from its mtime.
 *
 * The ticks have written the provenance three ways — "Drafted by `sched-1615`
 * on 2026-09-08", "Noticed by `sched-1522` on 2026-09-08", "**Drafted:**
 * 2026-09-10 by `sched-1015`" — so the parser asks for the FIRST ISO date and
 * the FIRST `sched-HHMM` anywhere in the head of the file rather than for a
 * field, and falls back to the mtime when there is no date. mtime is a sound
 * floor and a poor answer: a draft gets touched by anyone who reads it.
 *
 * @param {{name: string, text: string, mtimeMs: number}} f
 */
export function parseDraft(f) {
  const text = String(f.text || '');
  const h1 = /^#\s+(.+?)\s*$/m.exec(text);
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  const by = /(sched-\d{4})/.exec(text);
  return {
    file: f.name,
    title: h1 ? plain(h1[1]) : String(f.name || '').replace(/\.md$/i, ''),
    draftedOn: iso ? iso[1] : null,
    by: by ? by[1] : null,
    mtimeMs: f.mtimeMs,
  };
}

/**
 * One row for the drop zone, or none when it is empty.
 *
 * Rank 7 — the bottom of YOUR MOVE: it is Peter's act and nobody else's, which
 * is what that band means, and nothing is blocked on it, which is why it sits
 * under a commitment inside its warning window rather than beside an unsent
 * reply.
 *
 * @param {{files: Array, now?: number}} p
 * @returns {Array} zero or one item
 */
export function loopDraftItems({ files, now = Date.now() }) {
  const drafts = [];
  for (const f of files || []) {
    let d;
    try { d = parseDraft(f); } catch { continue; }
    const stamp = d.draftedOn ? Date.parse(`${d.draftedOn}T00:00:00Z`) : d.mtimeMs;
    d.ageDays = Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86400000)) : null;
    drafts.push(d);
  }
  if (!drafts.length) return [];
  const oldest = drafts.reduce((m, d) => (d.ageDays != null && (m == null || d.ageDays > m) ? d.ageDays : m), null);
  const n = drafts.length;
  const list = drafts
    .map((d) => `${d.title}${d.draftedOn ? ` (${d.draftedOn}${d.by ? `, ${d.by}` : ''})` : d.by ? ` (${d.by})` : ''}`)
    .join('; ');
  return [{
    key: 'loop-drafts', rank: 7, type: 'loop-drafts',
    title: `${n} draft${n === 1 ? '' : 's'} in loop/adhoc/ await your triage${oldest != null ? ` (oldest ${oldest}d)` : ''}`,
    why: `A tick saves a draft there when it finds something it cannot act on — a fix it was barred from making, a finding that needs a decision — and the folder is inert by design, so nothing will ever action one until you do. Each ends by asking you to promote it, file it, or decline it: ${list}.`,
    who: 'Peter', runbook: 'loop',
    ageDays: oldest,
    drafts: drafts.map(({ file, title, draftedOn, by, ageDays }) => ({ file, title, draftedOn, by, ageDays })),
    do: [
      { kind: 'chat', what: 'Read each file in loop/adhoc/ (the folder itself, not ready/ or done/).' },
      { kind: 'chat', what: 'Promote: add a "**Promoted:** <date> by <you> — <what a tick should do>" line under its H1 and move it into loop/adhoc/ready/; the next tick takes it.' },
      { kind: 'chat', what: 'File: if it needs a decision or a person, write it as an OA-nnn.md and move the draft to loop/adhoc/done/ with a line saying where it went.' },
      { kind: 'chat', what: 'Decline: append a "## DECLINED — <date>" section with the reason and move it to loop/adhoc/done/. Never delete one — the reason is the record.' },
    ],
  }];
}
