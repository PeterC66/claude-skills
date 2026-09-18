/*
 * loop_your_move.mjs — `loop/your-move/`, the scheduled loop's ONE outbound
 * folder to Peter, as worklist rows (buses-data OA-401, R8 of the 2026-09-17
 * process review; supersedes loop_blocked.mjs of OA-283 and loop_adhoc.mjs of
 * 2026-09-10, whose reasoning is kept below because it is still load-bearing).
 *
 * WHY ONE FOLDER. The review counted nine possible homes for a question aimed at
 * Peter, found one question sitting in three of them at two ranks, and found his
 * own prompt in the folder that is inert on purpose. Two of those homes were
 * this pair: `loop/blocked/`, where a tick wrote a question and stopped, and the
 * drop zone at the top of `loop/adhoc/`, where a tick wrote a finding it could
 * not act on. They differ in urgency and in nothing else — both are a tick
 * handing something back, both move only when Peter moves them — so they are one
 * folder now, named for what he does with it and for the band the board already
 * prints them in.
 *
 * THE FILE SAYS WHAT IT IS; THE FOLDER NO LONGER DOES. Under the old design the
 * two shapes were told apart by which directory they sat in, which meant a hold
 * written into the drop zone in a hurry lost its rank-3 row and its ability to
 * hold anything, silently, with nothing able to notice — and the review found
 * exactly that, a prompt of Peter's in the folder nothing executes. So the test
 * is now a property of the file: it is a HOLD if it carries a *What is needed*
 * section or a `**Blocks:**` field, and a DRAFT otherwise. Both markers are
 * field-shaped and both are what MAKES a hold a hold — an ask addressed to a
 * person, and a claim about a row on this board. A draft that grows an ask by
 * being edited becomes a hold at the next run, which is the right direction.
 *
 * ONE ROW PER HOLD, ONE ROW FOR ALL THE DRAFTS. A hold blocks something and
 * names it; a draft blocks nobody and asks for a triage. So holds are one row
 * each at rank 3 — the same band as an unsent reply, because only a person moves
 * either — and the drafts are one line at rank 7 with the count, the oldest age
 * and the titles inside it. n rows for n drafts would bury the things somebody
 * is actually waiting on.
 *
 * THE LIVE FAILURE THAT EARNED THE HOLDS WAS THE WORST AVAILABLE SHAPE, not an
 * absence. `loop/blocked/st-ives-v10.2-river.md` said in terms *do not send
 * v10.2 for review* — that draft draws the river in seven fragments, one of them
 * ending at y = -263.76 mm on a 210 mm page — while row 8 of the same day's
 * worklist said "Open the map, check the sheets, then Send v10.2 for review". So
 * the loop found the fault, wrote the warning into the channel the design gave
 * it, and the ranked list went on recommending the thing the warning forbade. A
 * finding that is merely invisible is a missing row; this one was OUTRANKED by a
 * row that had never heard of it, which is why holds below annotate rather than
 * only add.
 *
 * IT ANNOTATES, IT NEVER DELETES. A hold may name the worklist rows it
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
 * fresh clone, in a worktree, in every harness fixture and in CI. Absent, empty,
 * not-a-directory and unreadable each produce zero rows and no warning. That also
 * means this source is a working-tree fact that `actions/checkout` erases — the
 * named shape *the subject that does not survive checkout* — so its falsification
 * cannot be a CI step alone and `prove-red-loop-your-move.mjs` builds real folders
 * on disk. The reader is here rather than in worklist.mjs precisely so the harness
 * can drive the absent/empty/unreadable paths against a real directory instead of
 * asserting them against a fake.
 *
 * THE IN-TRAY IS NOT HERE. `loop/adhoc/ready/`, `doing/` and `done/` are Peter's
 * channel INTO the loop and the dispatcher's own bookkeeping, and they are read
 * by the dispatcher, the crash rule and nobody respectively. Counting any of them
 * here would report as *awaiting your triage* a prompt Peter has already triaged,
 * and the harness holds that line with a file in each.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The folder this module reads, relative to the buses repository root. */
export const YOUR_MOVE_DIR = ['loop', 'your-move'];

/** One line, no markdown emphasis, no link syntax, collapsed whitespace. */
function plain(s, max = 320) {
  const t = String(s || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [text](href) -> text
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

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
 * eleventh time. Falsified by cases 14 and 15 of the harness.
 *
 * AND IT IS A FIELD RATHER THAN A SUBSTRING (OA-376, 2026-09-17). The marker was
 * matched anywhere in the file, so a hold that merely DESCRIBES the convention —
 * quoting `**Blocks:**` in a sentence, the ordinary way a document names one —
 * was read as USING it, and the words of the description became row keys. That
 * was measured on 2026-09-15 rather than reasoned about: the first attempt to fix
 * a malformed hold explained in prose what its field had said, and the board
 * printed SEVENTY-THREE warnings where the malformed field itself had printed
 * thirteen. It is the same shape `CLAUDE.md` records for `[expected-red]` — *a
 * commit whose body merely describes the convention would otherwise trip it, and
 * one did* — arriving in a second instrument. A field is a LINE with a known
 * shape, so only a field line is read: one that opens with `**Name:**`, outside
 * any fenced block. Prose that mentions the marker mid-sentence, and a fenced
 * example showing the convention, are both silent. A line that genuinely opens
 * with the marker is still a field wherever it sits, which is deliberate: that is
 * what the shape MEANS, and a rule that also asked where the line was would be
 * guessing at prose.
 *
 * SINCE OA-401 IT ALSO DECIDES WHAT THE FILE IS, so the same care now protects
 * the classification and not only the holds — which is an argument for reusing
 * this function rather than for a second, looser test beside it.
 */
const FIELD_LINE_RE = /^\s{0,3}\*\*[^*\n]+:\*\*/;

/** The lines of `text` that are field lines — see `field`'s header. */
function fieldLines(text) {
  const out = [];
  let fenced = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (!fenced && FIELD_LINE_RE.test(line)) out.push(line);
  }
  return out;
}

function field(text, name) {
  const re = new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]*)`, 'i');
  for (const line of fieldLines(text)) {
    const m = re.exec(line);
    if (!m) continue;
    // Stop at the next `**Something:**` on the same line, then drop the ` · `
    // separator the house style leaves behind.
    return m[1].split(/\*\*[^*\n]+:\*\*/)[0].replace(/[\s·]+$/, '').trim();
  }
  return '';
}

/** The `## What is needed…` section's first paragraph, or ''. */
function neededSection(text) {
  const sec = /^##\s+What is needed[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/im.exec(String(text || ''));
  if (!sec) return null;
  return sec[1].split(/\n\s*\n/).find((p) => p.trim()) || '';
}

/**
 * Is this file a HOLD — something a tick stopped on and is asking Peter about —
 * or a DRAFT it merely handed over?
 *
 * TWO MARKERS, EITHER ONE. A *What is needed* section is the ask; a `**Blocks:**`
 * field is a claim about a row on this board. A file with neither asks for a
 * triage and not for an answer, which is what a draft is. Deliberately NOT a
 * `**Type:**` field somebody must remember to write: every hold a tick has ever
 * written already carries at least one of these two, because the stored prompt
 * has always demanded the first, and a marker that is already universal costs no
 * migration and cannot be forgotten into the wrong band.
 *
 * WHICH WAY IT FAILS. A hold whose heading drifts is read as a draft, and falls
 * from rank 3 to a line inside the rank-7 row — visible, lower, never silent;
 * whereas a draft that grows an ask is promoted to rank 3, which is a false
 * alarm a reader closes in one move. Both are recoverable by editing the file.
 * The old design's failure was neither: a hold in the wrong FOLDER could not be
 * seen as a hold by anything, at any rank, ever.
 *
 * @param {string} text
 */
export function isHold(text) {
  return neededSection(text) !== null || field(text, 'Blocks') !== '';
}

/**
 * Could this token be a worklist row key at all? (OA-376.)
 *
 * IT CHOOSES THE WORDING OF A WARNING AND NOTHING ELSE. A token that fails this
 * is still parsed, still looked up and still able to hold a row — so a wrong
 * answer here costs a differently-worded warning and can never drop a hold. That
 * is deliberate: the thing this module protects is a channel that says when a
 * hold did NOT attach, and a predicate allowed to silence one would be worse than
 * the noise it removes.
 *
 * MEASURED OVER THE POPULATION RATHER THAN FELT. Every row key the board writes
 * is compound — `draft-1`, `s6-stale`, `corr-unsent-CORR-001`, `engine-stale`,
 * `loop-hold-<ref>`, `unpushed-branch-<repo>-<branch>` — and no site anywhere
 * emits a bare English word as a key. Case 19 of the harness holds that claim
 * against the source: every `key:` literal written within two lines of a `rank:`
 * — 30 sites across twelve modules on 2026-09-17 — must pass this, so the day
 * somebody adds a one-word row key the harness says so instead of this predicate
 * quietly mis-reporting a real hold as a sentence.
 */
const ROW_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
export function looksLikeRowKey(tok) {
  const t = String(tok || '');
  return ROW_KEY_RE.test(t) && /[-_./0-9]/.test(t);
}

/**
 * Parse one hold. Everything is optional: a file with no H1, no fields and no
 * sections still yields a usable row keyed on its filename, because the
 * alternative is a tick's warning being dropped over its formatting.
 *
 * @param {{name: string, text: string, mtimeMs: number}} f
 */
export function parseHold(f) {
  const text = String(f.text || '');
  const ref = String(f.name || '').replace(/\.md$/i, '');
  const h1 = /^#\s+(.+?)\s*$/m.exec(text);
  const firstPara = neededSection(text) || '';

  const raisedBy = field(text, 'Raised by');
  // Prefer a date the file STATES over its mtime: a hold gets touched by anyone
  // who reads or edits it, and the age on the board should be the age of the
  // problem. ISO only — the two house formats are "2026-09-08" and "8 September
  // 2026", and inventing a parser for the second is not worth the branch when
  // mtime is a sound fallback.
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(raisedBy);

  // The field as WRITTEN, kept so a caller can quote it back when it turns out
  // not to be a list of keys at all (OA-376). Reading a mangled value is how the
  // reader tells a typo from a sentence, and the tokens alone cannot say which.
  const blocksRaw = plain(field(text, 'Blocks'), 160);

  const blocks = field(text, 'Blocks')
    .split(/[,\s]+/)
    .map((k) => k.replace(/[`'"]/g, '').trim())
    .filter(Boolean);

  // OA-301. The repository path a hold is ABOUT, from its `**File:**` field —
  // the first backticked token, because the house style writes
  // `**File:** \`Correspondence/CORR-001/008-….md\`, modified and uncommitted
  // since 07:16 local` and the prose after the path is for a reader. Normalised
  // to forward slashes so it compares equal to what `git status --porcelain`
  // reports. Empty when the field is absent or carries no backticked path: a
  // hold that does not name a file accounts for nothing, which is the safe
  // reading.
  const fileField = field(text, 'File');
  const tick = /`([^`\n]+)`/.exec(fileField);
  const namesPath = tick ? tick[1].trim().replace(/\\/g, '/').replace(/^\.\//, '') : '';

  return {
    ref,
    file: f.name,
    namesPath,
    headline: h1 ? plain(h1[1], 200) : ref,
    // NOT `|| plain(raisedBy)`, which it was until 2026-09-10. That fallback
    // contradicted loopHoldItems' own rule below — *the provenance is
    // deliberately NOT folded into `why`* — and it won, silently: a hold whose
    // heading stops matching gets a row whose entire reason reads "sched-1715,
    // 2026-09-08". Empty is better, because empty is the one value the row
    // builder has a designed answer for: a sentence naming the file.
    need: plain(firstPara) || '',
    raisedBy: plain(raisedBy, 200),
    blocks,
    blocksRaw,
    raisedOn: iso ? iso[1] : null,
    mtimeMs: f.mtimeMs,
  };
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
  // The first 1,200 characters are all this reads: an H1, a drafted-by line and
  // a date all sit at the top of every draft a tick has written, and a draft is
  // prose — nothing below that is a field.
  const text = String(f.text || '').slice(0, 1200);
  const h1 = /^#\s+(.+?)\s*$/m.exec(text);
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  const by = /(sched-\d{4})/.exec(text);
  return {
    file: f.name,
    title: h1 ? plain(h1[1], 160) : String(f.name || '').replace(/\.md$/i, ''),
    draftedOn: iso ? iso[1] : null,
    by: by ? by[1] : null,
    mtimeMs: f.mtimeMs,
  };
}

/**
 * Read `<dir>` if it is there. Absent, empty, not-a-directory and unreadable all
 * return [] — see the header. A single unreadable file is skipped, not fatal:
 * one bad file must not take the other warnings off the board.
 *
 * Top-level `.md` files only, never a subfolder's contents.
 *
 * @returns {Array<{name, text, mtimeMs}>}
 */
export function readYourMoveDir(dir) {
  const out = [];
  try {
    // THE try/catch IS THE MECHANISM, and there is deliberately no existsSync
    // precondition in front of it. One was written first and a mutation run
    // caught it: `readdirSync` already throws for a missing path, an undefined
    // path and a path that is a file, so the guard could be deleted with every
    // assertion still green — the named shape *the check that could not go red*,
    // an assertion an earlier stage already guarantees. Two mechanisms where one
    // is load-bearing means the falsifiable one cannot be told from the decorative
    // one. Deleting this catch turns cases 4-7 of the harness red.
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
 * Split what the folder holds into holds and drafts. Exported so the harness can
 * drive the classifier over a real folder and so a caller never has to repeat
 * the test.
 *
 * @param {Array<{name, text, mtimeMs}>} files
 * @returns {{holds: Array, drafts: Array}}  the raw file records, partitioned
 */
export function classify(files) {
  const holds = [];
  const drafts = [];
  for (const f of files || []) {
    let hold;
    try { hold = isHold(f.text); } catch { hold = false; }
    (hold ? holds : drafts).push(f);
  }
  return { holds, drafts };
}

/**
 * The repository paths live holds are ABOUT, for concurrency.mjs (OA-301).
 *
 * WHY THE VERDICT NEEDS THIS. On 2026-09-10 twelve of eighteen ticks stopped at
 * the conditions gate on ONE modified file — a letter under Correspondence/
 * whose salutation Peter had typed and left for the morning — while a hold in
 * this very folder named that file, said whose it was, and said the loop must
 * not touch it. The tree was "dirty" and every fact about the dirt was already
 * written down. A dirty path that a live hold names is not unknown residue: it
 * is accounted for, and the buses-tree rule can leave it out of its count. Only
 * a hold that is HERE NOW counts — retiring the hold puts the file back into the
 * verdict, which is the right direction for a rule to fail.
 *
 * A DRAFT ACCOUNTS FOR NOTHING, even one that names a path: it is a note about
 * something to look at, not a statement that the file is spoken for, and the
 * whole point of the classifier is that the two are now told apart by what the
 * file says rather than by where it sits.
 *
 * @param {Array<{name, text, mtimeMs}>} files  as readYourMoveDir returns them
 * @returns {Array<{path: string, ref: string}>}
 */
export function heldPaths(files) {
  const out = [];
  for (const f of classify(files).holds) {
    let b;
    try { b = parseHold(f); } catch { continue; }
    if (b.namesPath) out.push({ path: b.namesPath, ref: b.ref });
  }
  return out;
}

/**
 * Rows for the holds, plus the holds they place on other rows.
 *
 * Rank 3 — the same band as a drafted reply Peter has not sent, and for the same
 * reason: a person's decision is the only thing that moves it, and every tick
 * that fires meanwhile does nothing about it.
 *
 * @param {{files: Array, now?: number}} p   files as readYourMoveDir returns them
 * @returns {{items: Array, holds: Array<{key, ref, file, headline, need}>}}
 */
export function loopHoldItems({ files, now = Date.now() }) {
  const items = [];
  const holds = [];
  for (const f of classify(files).holds) {
    let b;
    try { b = parseHold(f); } catch { continue; }
    const stamp = b.raisedOn ? Date.parse(`${b.raisedOn}T00:00:00Z`) : b.mtimeMs;
    const ageDays = Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86400000)) : null;

    for (const key of b.blocks) holds.push({ key, ref: b.ref, file: b.file, headline: b.headline, need: b.need, raw: b.blocksRaw });

    items.push({
      key: `loop-hold-${b.ref}`, rank: 3, type: 'loop-hold',
      title: `The scheduled loop is blocked on you: ${b.headline}`,
      // The provenance is deliberately NOT folded into `why`: it is a fact about
      // the row rather than a reason to act, and the two oldest holds' own
      // "Raised by" lines run to 180 characters of thread references. It stays on
      // the item so --json carries it and a reader who wants it can have it.
      why: b.need || `A scheduled tick stopped rather than guess and wrote loop/your-move/${b.file}. Nothing in the loop will move this until you answer.`,
      who: 'Peter', runbook: 'loop', ref: b.ref, blocks: b.blocks, raisedBy: b.raisedBy,
      ageDays,
      do: [
        { kind: 'chat', what: `Read loop/your-move/${b.file} — it states what is needed and the evidence behind it.` },
        { kind: 'chat', what: 'When you have the answer, append it to that file and move it into loop/adhoc/ready/ — that is how an answer re-enters the loop, as part of the work rather than as a message.' },
      ],
    });
  }
  return { items, holds };
}

/**
 * One row for the drafts in the folder, or none when there are none.
 *
 * Rank 7 — the bottom of YOUR MOVE: it is Peter's act and nobody else's, which
 * is what that band means, and nothing is blocked on it, which is why it sits
 * under a commitment inside its warning window rather than beside an unsent
 * reply.
 *
 * @param {{files: Array, now?: number}} p   files as readYourMoveDir returns them
 * @returns {Array} zero or one item
 */
export function loopDraftItems({ files, now = Date.now() }) {
  const drafts = [];
  for (const f of classify(files).drafts) {
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
    title: `${n} draft${n === 1 ? '' : 's'} in loop/your-move/ await your triage${oldest != null ? ` (oldest ${oldest}d)` : ''}`,
    why: `A tick saves a draft there when it finds something it cannot act on — a fix it was barred from making, a finding that needs a decision — and nothing in the loop will ever action one until you do. Each ends by asking you to promote it, file it, or decline it: ${list}.`,
    who: 'Peter', runbook: 'loop',
    ageDays: oldest,
    drafts: drafts.map(({ file, title, draftedOn, by, ageDays }) => ({ file, title, draftedOn, by, ageDays })),
    do: [
      { kind: 'chat', what: 'Read each draft in loop/your-move/ — the ones without a "What is needed from you" section, which are rows of their own above.' },
      { kind: 'chat', what: 'Promote: add a "**Promoted:** <date> by <you> — <what a tick should do>" line under its H1 and move it into loop/adhoc/ready/; the next tick takes it.' },
      { kind: 'chat', what: 'File: if it needs a decision or a person, write it as an OA-nnn.md and move the draft to loop/adhoc/done/ with a line saying where it went.' },
      { kind: 'chat', what: 'Decline: append a "## DECLINED — <date>" section with the reason and move it to loop/adhoc/done/. Never delete one — the reason is the record.' },
    ],
  }];
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

/**
 * The unmatched holds as ONE finding per FILE (OA-376, 2026-09-17).
 *
 * WHY THE FILE IS THE UNIT AND THE KEY IS NOT. A `Blocks:` field is written once,
 * by one author, in one file, and it is either right or wrong as a whole — so a
 * value with n unmatched tokens is one mistake, not n. On 2026-09-15 a hold wrote
 * a sentence there and the board printed thirteen warnings, one per English word,
 * each ending with confident and wrong advice — *either the row has cleared and
 * the blocked file can go, or the key is wrong* — about a row key that was the
 * word `the`. A reader who acted on any one of them would have deleted a live
 * hold. Grouping is right even for a well-formed multi-key hold that has gone
 * stale: the reader opens one file either way.
 *
 * `looksLikeKeys` is false when NOT EVERY token could be a key, which is what
 * separates *this field is a sentence* from *this key is stale* — the two have
 * different remedies, and the second is the only one that is a claim about the
 * board. See `looksLikeRowKey` for why it may choose wording and nothing else.
 *
 * @param {Array<{key, ref, file, headline, need, raw}>} unmatched  from applyHolds
 * @returns {Array<{file, ref, raw, keys: string[], looksLikeKeys: boolean}>}
 */
export function groupUnmatched(unmatched) {
  const byFile = new Map();
  for (const h of unmatched || []) {
    const file = h.file || '(unknown file)';
    if (!byFile.has(file)) byFile.set(file, { file, ref: h.ref || '', raw: h.raw || '', keys: [] });
    const g = byFile.get(file);
    if (!g.keys.includes(h.key)) g.keys.push(h.key);
    if (!g.raw && h.raw) g.raw = h.raw;
  }
  return [...byFile.values()].map((g) => ({ ...g, looksLikeKeys: g.keys.every(looksLikeRowKey) }));
}
