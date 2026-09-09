/*
 * loop_blocked.mjs — the scheduled loop's `loop/blocked/` folder, as worklist rows
 * (buses-data OA-283, 2026-09-08).
 *
 * WHY THIS EXISTS. The loop never asks a question: a tick that needs a decision
 * writes `loop/blocked/<ref>.md` and stops. That folder is its ONLY outbound
 * channel to a person, and until this module nothing Peter runs read it. The
 * design justified the folder with one sentence in `loop/README.md` — a growing
 * pile is "visible in the run notification rather than rotting in a folder nobody
 * opens" — and both halves were false: there is no notification he reads, and the
 * run summary that names the folder is itself gitignored, per-tick and enumerated
 * by nothing. His own words on 2026-09-08: "I would only pick those up if I looked
 * at the run itself."
 *
 * THE LIVE FAILURE WAS THE WORST AVAILABLE SHAPE, not an absence.
 * `loop/blocked/st-ives-v10.2-river.md` said in terms *do not send v10.2 for
 * review* — that draft draws the river in seven fragments, one of them ending at
 * y = -263.76 mm on a 210 mm page — while row 8 of the same day's worklist said
 * "Open the map, check the sheets, then Send v10.2 for review". So the loop found
 * the fault, wrote the warning into the channel the design gave it, and the ranked
 * list went on recommending the thing the warning forbade. A finding that is
 * merely invisible is a missing row; this one was OUTRANKED by a row that had
 * never heard of it, which is why holds below annotate rather than only add.
 *
 * IT ANNOTATES, IT NEVER DELETES. A blocked file may name the worklist rows it
 * contradicts in a `**Blocks:** <key>` field. Each named row keeps its place and
 * its age and gains an `onHold` — the renderer prints the warning above the row's
 * commands and gates them behind it, so the row cannot be read unqualified. It is
 * not dropped, because this repository's own rule is that a suppression nobody can
 * see is how a board starts lying (`adjudicated`, `correspondenceSettled`), and a
 * row that vanished would take its age and its URL with it. A `Blocks:` naming a
 * key that is not on the board is reported rather than ignored, for the same
 * reason: a stale hold is how the convention would quietly stop working.
 *
 * SILENCE IS A REQUIREMENT, NOT A CONVENIENCE. `loop/` is gitignored in its
 * entirety apart from its README, so an absent folder is the NORMAL state in a
 * fresh clone, in a worktree, in every harness fixture and in CI. Absent, empty
 * and unreadable each produce zero rows and no warning. That also means this
 * source is a working-tree fact that `actions/checkout` erases — the named shape
 * *the subject that does not survive checkout* — so its falsification cannot be a
 * CI step alone and `prove-red-loop-blocked.mjs` builds real folders on disk.
 *
 * The reader is here rather than in worklist.mjs precisely so the harness can
 * drive the absent/empty/unreadable paths against a real directory instead of
 * asserting them against a fake.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** One line, no markdown emphasis, no link syntax, collapsed whitespace. */
function plain(s, max = 320) {
  const t = String(s || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [text](href) -> text
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The value of a `**Field:**` line, or ''. The blocked files' own house style. */
/* Read one `**Name:** value` field.
 *
 * THE VALUE ENDS AT THE NEXT FIELD, NOT AT THE END OF THE LINE. The house style
 * puts several fields on one header line separated by ` · `, and taking `[^\n]*`
 * swallowed every field after this one. For `Blocks` that is not cosmetic: the
 * value is then split on whitespace, so on 2026-09-09 a real file yielded eleven
 * holds — the true key plus `·`, `**Commit:**`, `c00d273`, `on`, `main`,
 * `unpushed` and a URL — and the board printed ten "names a worklist row that is
 * not on the board today" warnings. The hold still attached, so nothing looked
 * broken; what broke was the channel that exists to say when a hold did NOT
 * attach, and a warning that cries wolf ten times is one nobody reads the
 * eleventh time. Falsified by cases 14 and 15 of prove-red-loop-blocked.mjs.
 */
function field(text, name) {
  const re = new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]*)`, 'i');
  const m = re.exec(text);
  if (!m) return '';
  // Stop at the next `**Something:**` on the same line, then drop the ` · `
  // separator the house style leaves behind.
  return m[1].split(/\*\*[^*\n]+:\*\*/)[0].replace(/[\s·]+$/, '').trim();
}

/**
 * Parse one blocked file. Everything is optional: a file with no H1, no fields
 * and no sections still yields a usable row keyed on its filename, because the
 * alternative is a tick's warning being dropped over its formatting.
 *
 * @param {{name: string, text: string, mtimeMs: number}} f
 * @returns {{ref, file, headline, need, raisedBy, blocks: string[], raisedOn: string|null}}
 */
export function parseBlocked(f) {
  const text = String(f.text || '');
  const ref = String(f.name || '').replace(/\.md$/i, '');
  const h1 = /^#\s+(.+?)\s*$/m.exec(text);

  // "## What is needed from you" / "... from Peter" — the section every blocked
  // file writes, and the one sentence worth putting on a ranked list.
  const sec = /^##\s+What is needed[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/im.exec(text);
  const firstPara = sec ? (sec[1].split(/\n\s*\n/).find((p) => p.trim()) || '') : '';

  const raisedBy = field(text, 'Raised by');
  // Prefer a date the file STATES over its mtime: a blocked file gets touched by
  // anyone who reads or edits it, and the age on the board should be the age of
  // the problem. ISO only — the two house formats are "2026-09-08" and
  // "8 September 2026", and inventing a parser for the second is not worth the
  // branch when mtime is a sound fallback.
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(raisedBy);

  const blocks = field(text, 'Blocks')
    .split(/[,\s]+/)
    .map((k) => k.replace(/[`'"]/g, '').trim())
    .filter(Boolean);

  return {
    ref,
    file: f.name,
    headline: h1 ? plain(h1[1], 200) : ref,
    need: plain(firstPara) || plain(raisedBy) || '',
    raisedBy: plain(raisedBy, 200),
    blocks,
    raisedOn: iso ? iso[1] : null,
    mtimeMs: f.mtimeMs,
  };
}

/**
 * Read `<dir>` if it is there. Absent, empty, not-a-directory and unreadable all
 * return [] — see the header. A single unreadable file is skipped, not fatal:
 * one bad file must not take the other warnings off the board.
 *
 * @returns {Array<{name, text, mtimeMs}>}
 */
export function readBlockedDir(dir) {
  const out = [];
  try {
    // THE try/catch IS THE MECHANISM, and there is deliberately no existsSync
    // precondition in front of it. One was written first and a mutation run
    // caught it: `readdirSync` already throws for a missing path, an undefined
    // path and a path that is a file, so the guard could be deleted with every
    // assertion still green — the named shape *the check that could not go red*,
    // an assertion an earlier stage already guarantees. Two mechanisms where one
    // is load-bearing means the falsifiable one cannot be told from the decorative
    // one. Deleting this catch turns cases 4-7 of prove-red-loop-blocked.mjs red.
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      try {
        out.push({
          name: e.name,
          text: readFileSync(path.join(dir, e.name), 'utf8'),
          mtimeMs: statSync(path.join(dir, e.name)).mtimeMs,
        });
      } catch { /* one unreadable file is not the folder's problem */ }
    }
  } catch { return []; }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rows for the blocked folder, plus the holds they place on other rows.
 *
 * Rank 3 — the same band as a drafted reply Peter has not sent, and for the same
 * reason: a person's decision is the only thing that moves it, and every tick
 * that fires meanwhile does nothing about it.
 *
 * @param {{files: Array, now?: number}} p
 * @returns {{items: Array, holds: Array<{key, ref, file, headline, need}>}}
 */
export function loopBlockedItems({ files, now = Date.now() }) {
  const items = [];
  const holds = [];
  for (const f of files || []) {
    let b;
    try { b = parseBlocked(f); } catch { continue; }
    const stamp = b.raisedOn ? Date.parse(`${b.raisedOn}T00:00:00Z`) : b.mtimeMs;
    const ageDays = Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86400000)) : null;

    for (const key of b.blocks) holds.push({ key, ref: b.ref, file: b.file, headline: b.headline, need: b.need });

    items.push({
      key: `loop-blocked-${b.ref}`, rank: 3, type: 'loop-blocked',
      title: `The scheduled loop is blocked on you: ${b.headline}`,
      // The provenance is deliberately NOT folded into `why`: it is a fact about
      // the row rather than a reason to act, and the two blocked files' own
      // "Raised by" lines run to 180 characters of thread references. It stays on
      // the item so --json carries it and a reader who wants it can have it.
      why: b.need || `A scheduled tick stopped rather than guess and wrote loop/blocked/${b.file}. Nothing in the loop will move this until you answer.`,
      who: 'Peter', runbook: 'loop', ref: b.ref, blocks: b.blocks, raisedBy: b.raisedBy,
      ageDays,
      do: [
        { kind: 'chat', what: `Read loop/blocked/${b.file} — it states what is needed and the evidence behind it.` },
        { kind: 'chat', what: 'When you have the answer, append it to that file and move it into loop/adhoc/ready/ — that is how an answer re-enters the loop, as part of the work rather than as a message.' },
      ],
    });
  }
  return { items, holds };
}

/**
 * Attach each hold to the row it names. Returns the holds that matched nothing,
 * so the caller can say so out loud rather than let a stale `Blocks:` rot.
 *
 * @returns {{applied: number, unmatched: Array}}
 */
export function applyHolds(items, holds) {
  let applied = 0;
  const unmatched = [];
  for (const h of holds || []) {
    const hits = (items || []).filter((i) => i.key === h.key);
    if (!hits.length) { unmatched.push(h); continue; }
    for (const it of hits) { (it.onHold ||= []).push(h); applied++; }
  }
  return { applied, unmatched };
}
