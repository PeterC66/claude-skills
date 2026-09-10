#!/usr/bin/env node
/* Prove the loop/blocked/ rows can appear, can hold another row, and can go away
 * (buses-data OA-283, 2026-09-08).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-loop-blocked.mjs
 *
 * WHAT IS BEING FALSIFIED, AND WHY IT IS NOT ENOUGH TO ASSERT THE ROWS APPEAR.
 * The subject is a folder `actions/checkout` never produces: `loop/` is gitignored
 * in its entirety apart from its README, so in CI, in a fresh clone, in a worktree
 * and in every other harness's fixture the folder is ABSENT. That is the named
 * shape *the subject that does not survive checkout* — a check whose subject is a
 * working-tree fact is green for ever in CI, so the silence has to be proved here
 * against a REAL directory rather than reasoned about. Cases 4-7 do exactly that,
 * and they are why readBlockedDir does its own I/O instead of taking injected
 * files: a fake reader cannot be absent.
 *
 * THE HOLD IS FALSIFIED IN BOTH DIRECTIONS, which matters more than the row is.
 * A hold that fails to attach leaves the board telling Peter to publish a sheet a
 * tick has said must not be published — the live 2026-09-08 failure. A hold that
 * attaches to the wrong row, or silently attaches to nothing, is the same fault
 * one step later. So: it attaches to the named key (case 8), it does NOT touch its
 * neighbours (case 8), a `Blocks:` naming a row that is not on the board is
 * REPORTED rather than dropped (case 9), and a file with no `Blocks:` holds
 * nothing (case 10).
 *
 * AND THE WIRE'S SOURCE IS ASSERTED (case 12), not just the module. The module's
 * own tests cannot see the line that calls it, and this repository has already
 * paid for that once — *The harness that stopped at the module's edge*, where a
 * template literal corrupted a call site while 23 module assertions stayed green.
 * Every source assertion here is a literal string, never a regex.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBlockedDir, parseBlocked, loopBlockedItems, applyHolds } from './loop_blocked.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-loop-blocked-'));
const mk = (dir, name, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text, 'utf8');
  return path.join(dir, name);
};

// The shape a tick actually writes, reduced to what the parser reads.
const RIVER = `# St Ives: the river fault is FIXED, but portal draft v10.2 still carries it — do not send v10.2 for review

**Raised by:** \`sched-1715\`, 2026-09-08 · **Feed:** adhoc

**Blocks:** \`draft-1\`

## What is needed from Peter

**Deliver a fresh St Ives build to the portal before anything is sent for review, and discard draft v10.2.** Doing that would publish the broken river.

## Why the report was right

Not read by anything.
`;

// The same file after somebody rewrote its heading into the past tense. Every
// field the parser reads is still there EXCEPT the one that carries the reason.
const PAST_TENSE = `# St Ives: the river fault is FIXED, but portal draft v10.2 still carries it — do not send v10.2 for review

**Raised by:** \`sched-1715\`, 2026-09-08 · **Feed:** adhoc

**Blocks:** \`draft-1\`

## What was needed from Peter — ANSWERED 2026-09-10, kept for the record

**Deliver a fresh St Ives build to the portal before anything is sent for review.**

## Where this stands

The open question is whether to publish v11.0 anyway.
`;

const SF008 = `# SF-008 — does the Beaconsfield Town Bus still run?

**Raised by:** \`sched-1915\`, 8 September 2026 · **Register entry:** SF-008

## What is needed from you

One question, and it needs a person: ask the council whether the bus still runs.
`;

console.log('\n1. one file, one row');
{
  const dir = path.join(tmp, 'one', 'loop', 'blocked');
  mk(dir, 'st-ives-v10.2-river.md', RIVER);
  const r = loopBlockedItems({ files: readBlockedDir(dir), now: Date.parse('2026-09-11T00:00:00Z') });
  check('one row', r.items.length === 1, `got ${r.items.length}`);
  check('key is loop-blocked-<ref>', r.items[0].key === 'loop-blocked-st-ives-v10.2-river', r.items[0].key);
  check('rank 3 — the SOMEONE IS BLOCKED band', r.items[0].rank === 3, String(r.items[0].rank));
  check('title carries the H1', r.items[0].title.includes('do not send v10.2 for review'));
  check('why is the "What is needed" paragraph', r.items[0].why.startsWith('Deliver a fresh St Ives build'), r.items[0].why.slice(0, 60));
  check('why is NOT the provenance line', !r.items[0].why.includes('sched-1715'));
  check('age comes from the stated date, not mtime', r.items[0].ageDays === 3, String(r.items[0].ageDays));
  check('one hold, naming draft-1', r.holds.length === 1 && r.holds[0].key === 'draft-1', JSON.stringify(r.holds));
}

console.log('\n2. no stated date falls back to mtime');
{
  const dir = path.join(tmp, 'mtime', 'loop', 'blocked');
  const f = mk(dir, 'sf-008.md', SF008);
  const past = new Date('2026-09-05T00:00:00Z');
  fs.utimesSync(f, past, past);
  const r = loopBlockedItems({ files: readBlockedDir(dir), now: Date.parse('2026-09-11T00:00:00Z') });
  check('"8 September 2026" is not ISO, so mtime decides', r.items[0].ageDays === 6, String(r.items[0].ageDays));
  check('no Blocks: line means no hold', r.holds.length === 0, JSON.stringify(r.holds));
}

console.log('\n3. two files, sorted, both rows');
{
  const dir = path.join(tmp, 'two', 'loop', 'blocked');
  mk(dir, 'st-ives-v10.2-river.md', RIVER);
  mk(dir, 'sf-008.md', SF008);
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  check('two rows', r.items.length === 2, `got ${r.items.length}`);
  check('sorted by filename', r.items[0].key.endsWith('sf-008'), r.items[0].key);
}

// ---- the silence, against a real disk ---------------------------------------
// Everything above would still pass if the reader threw on an absent folder,
// because every case above creates one. These four are the check that could not
// exist in CI, where the folder is absent by construction.
console.log('\n4-7. absent, empty, not-a-directory, unreadable file — all silent');
{
  const missing = path.join(tmp, 'nothing-here', 'loop', 'blocked');
  check('absent folder: no throw, no rows', readBlockedDir(missing).length === 0);
  check('absent folder: no throw from the item builder', loopBlockedItems({ files: readBlockedDir(missing) }).items.length === 0);

  const empty = path.join(tmp, 'empty', 'loop', 'blocked');
  fs.mkdirSync(empty, { recursive: true });
  check('empty folder: no rows', loopBlockedItems({ files: readBlockedDir(empty) }).items.length === 0);

  const notDir = path.join(tmp, 'notdir');
  fs.writeFileSync(notDir, 'I am a file, not a folder', 'utf8');
  check('a FILE where the folder should be: no rows, no throw', readBlockedDir(notDir).length === 0);

  const mixed = path.join(tmp, 'mixed', 'loop', 'blocked');
  mk(mixed, 'st-ives-v10.2-river.md', RIVER);
  mk(mixed, 'notes.txt', 'not markdown');
  fs.mkdirSync(path.join(mixed, 'a-directory.md'));   // a .md that is a directory
  const r = loopBlockedItems({ files: readBlockedDir(mixed) });
  check('non-markdown and a directory named *.md are skipped', r.items.length === 1, `got ${r.items.length}`);

  check('undefined dir: no rows', readBlockedDir(undefined).length === 0);
  check('no files at all: no rows', loopBlockedItems({ files: undefined }).items.length === 0);
}

console.log('\n8. a malformed file still raises a row rather than being dropped');
{
  const dir = path.join(tmp, 'bad', 'loop', 'blocked');
  mk(dir, 'no-h1-no-sections.md', 'just some prose a tick wrote in a hurry\n');
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  check('one row', r.items.length === 1, `got ${r.items.length}`);
  check('headline falls back to the ref', r.items[0].title.includes('no-h1-no-sections'), r.items[0].title);
  check('why falls back to a sentence naming the file', r.items[0].why.includes('loop/blocked/no-h1-no-sections.md'), r.items[0].why);
}

// ---- the hold ---------------------------------------------------------------
console.log('\n9. the hold attaches to the named row and to nothing else');
{
  const dir = path.join(tmp, 'hold', 'loop', 'blocked');
  mk(dir, 'st-ives-v10.2-river.md', RIVER);
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  const board = [
    { key: 'draft-1', title: '"St Ives" has an unsent draft (v10.2)', do: [{ kind: 'portal-ui', what: 'Send v10.2 for review' }] },
    { key: 'draft-6', title: '"Ramsey" has an unsent draft (v8.0)', do: [{ kind: 'portal-ui', what: 'Send v8.0 for review' }] },
  ];
  const res = applyHolds(board, r.holds);
  check('one hold applied', res.applied === 1, String(res.applied));
  check('nothing unmatched', res.unmatched.length === 0);
  check('draft-1 is held', Array.isArray(board[0].onHold) && board[0].onHold.length === 1);
  check('the hold carries the headline the reader needs', board[0].onHold[0].headline.includes('do not send v10.2'));
  check('the NEIGHBOUR is untouched', board[1].onHold === undefined);
  check('the held row keeps its own do steps', board[0].do.length === 1);

  // The control that matters: same board, no blocked folder, nothing held.
  const none = applyHolds(
    [{ key: 'draft-1', title: 'x', do: [] }],
    loopBlockedItems({ files: readBlockedDir(path.join(tmp, 'nothing-here')) }).holds,
  );
  check('CONTROL — no blocked folder, no hold applied', none.applied === 0 && none.unmatched.length === 0);
}

console.log('\n10. a Blocks: naming a row that is not on the board is REPORTED, not dropped');
{
  const dir = path.join(tmp, 'stale', 'loop', 'blocked');
  mk(dir, 'stale-hold.md', '# Something already dealt with\n\n**Blocks:** `draft-99`\n');
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  const res = applyHolds([{ key: 'draft-1', title: 'x', do: [] }], r.holds);
  check('nothing applied', res.applied === 0, String(res.applied));
  check('the stale hold is returned so the caller can say so', res.unmatched.length === 1 && res.unmatched[0].key === 'draft-99', JSON.stringify(res.unmatched));
}

console.log('\n11. multiple keys on one line, and quoting is tolerated');
{
  const dir = path.join(tmp, 'multi', 'loop', 'blocked');
  mk(dir, 'two-rows.md', '# Holds two\n\n**Blocks:** `draft-1`, draft-6\n');
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  check('two holds parsed', r.holds.length === 2, JSON.stringify(r.holds.map((h) => h.key)));
  check('backticks stripped', r.holds[0].key === 'draft-1', r.holds[0].key);
}

console.log('\n12. the concurrency verdict');
{
  check('a loop-blocked row touches no working tree', needsOf({ key: 'loop-blocked-x', type: 'loop-blocked' }).length === 0,
    JSON.stringify(needsOf({ key: 'loop-blocked-x', type: 'loop-blocked' })));
  // If the prefix rule were removed, `type: 'loop-blocked'` would fall to the
  // default arm and return ['buses-tree'] — which --safe-only would then hide.
  // That is the mutation this asserts against.
  check('MUTATION CONTROL — an unknown type still defaults to buses-tree', needsOf({ key: 'zzz', type: 'never-heard-of-it' }).join() === 'buses-tree');
}

console.log('\n13. the wire in worklist.mjs — literal strings, not regexes');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  // NOT `src.includes(lit)`. A mutation run commented the wire out — `// for
  // (const it of loopBlocked.items) add(it);` — and every assertion stayed green,
  // because a commented line still CONTAINS the string. A source assertion has to
  // ask whether the line RUNS, and the cheapest honest form of that question is a
  // line that carries the text and does not begin with `//`.
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { readBlockedDir, loopBlockedItems, applyHolds } from './loop_blocked.mjs';",
    "readBlockedDir(path.join(BUSES, 'loop', 'blocked'))",
    'for (const it of loopBlocked.items) add(it);',
    'const heldRows = applyHolds(items, loopBlocked.holds);',
    'for (const h of heldRows.unmatched) {',
    'if (it.onHold && it.onHold.length) {',
    'Only once that is settled:',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 56)}`, liveLine(lit), 'absent, or commented out');

  // The hold must be printed BEFORE the commands, or the row still reads as an
  // instruction with a footnote. Order is the whole point, so assert the order —
  // and assert PRESENCE first, because the first version of this check compared
  // indexOf('⚠ ON HOLD —') against the do-loop's index and -1 is less than
  // everything, so deleting the marker altogether passed. A mutation run found
  // it. An ordering assertion over a string that may be absent is an assertion
  // that silently becomes vacuous, which is this file's own subject.
  const iHold = src.indexOf('⚠ ON HOLD —');
  const iDo = src.indexOf("if (d.kind === 'shell') console.log");
  // A hold that matched nothing has THREE causes, and the wire must not name two
  // of them when the third is live. The stale-hold warning fired on 2026-09-09
  // for a hold that was working, because the portal was unreachable that run and
  // every `draft-*` row went with it — and its text told the reader the row had
  // cleared, whose remedy is deleting the blocked file. Both branches asserted,
  // and the `boardComplete` gate between them, because a single-branch check here
  // would pass on the version that caused the fault.
  // THREE branches, not two. The first fix asked `!!portal` — did a source return
  // something — which is not the question; the question is whether the board knows
  // about the row the hold NAMES. On --local the dev checkout returns an object,
  // so a run that emitted ZERO draft-* rows still concluded a LIVE draft had
  // cleared. Both of the then-existing cases passed on that version, which is why
  // the local branch is asserted by name and why `&& REMOTE` is asserted as a
  // literal: it is the whole of the authority test today.
  for (const lit of [
    'const boardAuthoritative = !!portal && REMOTE;',
    'if (boardAuthoritative) {',
    '} else if (!portal) {',
    'the portal queues were skipped, so every row that source would have raised is missing',
    'it read the DEV CHECKOUT, not the live portal, so a live draft is absent here by construction',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 56)}`, liveLine(lit), 'absent, or commented out');
  // COUNTED, not merely present. Both non-authoritative branches must carry the
  // safety phrase, and a bare liveLine() is satisfied by either — so deleting it
  // from one branch passed, which a mutation run demonstrated. An assertion that
  // one of two things is true is not an assertion about both.
  const safetyLines = src.split('\n').filter((l) => l.includes('NOT evidence the row has cleared') && !l.trim().startsWith('//') && !l.trim().startsWith('*')).length;
  check('BOTH non-authoritative branches carry "NOT evidence the row has cleared"', safetyLines === 2, `found on ${safetyLines} live line(s), expected 2`);
  check('the CONFIDENT stale wording survives for an authoritative board', liveLine('Either the row has cleared and the blocked file can go, or the key is wrong.'));
  // The mutation this is really about: `!!portal` alone. Asserting the literal
  // with `&& REMOTE` is what makes dropping it red, and a substring test would
  // not — `!!portal` is a substring of `!!portal && REMOTE`.
  check('MUTATION CONTROL — the authority test is not `!!portal` alone',
    !liveLine('const boardAuthoritative = !!portal;'), 'a local board would be treated as authoritative');

  check('the ON HOLD marker is present at all', iHold >= 0, 'not found in worklist.mjs');
  check('the do-loop anchor is present at all', iDo >= 0, 'not found in worklist.mjs');
  check('the hold is rendered above the do steps', iHold >= 0 && iDo >= 0 && iHold < iDo,
    `hold at ${iHold}, do-loop at ${iDo}`);
}

console.log('\n14. a Blocks field with MORE FIELDS after it on the same line');
{
  // The live fault, 2026-09-09. `field()` took `[^\n]*` — everything to the end
  // of the line — so a header line in the house style, where several bolded
  // fields share one line separated by ` · `, fed the whole tail into the split
  // and produced one bogus hold per word: `·`, `**Commit:**`, `c00d273`, `on`,
  // `main`, `unpushed`, and the URL. Ten warnings, and the reader has to work out
  // which of the eleven keys was the real one. The hold itself still attached,
  // which is why nothing went visibly wrong and why this is worth a case: the
  // damage is to the WARNING channel, whose whole job is to say when a hold did
  // nothing, and which was crying wolf ten times over.
  const dir = path.join(tmp, 'trailing-fields', 'loop', 'blocked');
  mk(dir, 'push-claude-skills-c00d273.md',
    '# The claude-skills CI red is FIXED and committed, but only you can push it\n\n' +
    '**Raised by:** `sched-0615`, 2026-09-09 · **Blocks:** `ci-red-PeterC66/claude-skills` · ' +
    '**Commit:** `c00d273` on `main`, unpushed · ' +
    '**Failing run:** https://github.com/PeterC66/claude-skills/actions/runs/34312598961\n\n' +
    '## What is needed from you\n\n**Push `claude-skills`.**\n');
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  check('EXACTLY one hold, not one per word', r.holds.length === 1, JSON.stringify(r.holds.map((h) => h.key)));
  check('and it is the real key', r.holds[0].key === 'ci-red-PeterC66/claude-skills', r.holds[0].key);
  // The truncation must not eat the fields it stops at. `Raised by` is the first
  // field on that same line, and the row's AGE comes out of it — so a fix that
  // stopped the value at the wrong place would silently move every such row's age
  // to mtime, which is the failure the stated-date branch exists to avoid.
  check('the stated date still decides the age', parseBlocked(readBlockedDir(dir)[0]).raisedOn === '2026-09-09',
    String(parseBlocked(readBlockedDir(dir)[0]).raisedOn));
  check('raisedBy stops at the next field', !r.items[0].raisedBy.includes('Blocks'), r.items[0].raisedBy);
  check('raisedBy keeps its own value', r.items[0].raisedBy.includes('sched-0615'), r.items[0].raisedBy);
}

console.log('\n15. CONTROL — the truncation does not narrow a well-formed file');
{
  // Cases 1 and 11 already drive the two shapes this could break, but they run
  // against fixtures written before the fix and a reader cannot tell that from
  // here. Restated as one control, because a truncation bug's signature is a hold
  // that quietly stops existing, and every other case in this file would still
  // pass if `field()` returned the empty string for a value on its own line.
  const dir = path.join(tmp, 'control-own-line', 'loop', 'blocked');
  mk(dir, 'own-line.md', '# Holds one\n\n**Raised by:** `sched-1715`, 2026-09-08\n\n**Blocks:** `draft-1`\n');
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  check('a Blocks field alone on its line still holds', r.holds.length === 1 && r.holds[0].key === 'draft-1', JSON.stringify(r.holds));
  check('a Raised by field alone on its line still dates the row', parseBlocked(readBlockedDir(dir)[0]).raisedOn === '2026-09-08',
    String(parseBlocked(readBlockedDir(dir)[0]).raisedOn));
}

console.log('\n16. provenance but NO "What is needed" section — the shape the real hold took on 2026-09-10');
{
  // `loop/blocked/st-ives-v10.2-river.md` was edited that morning so its heading
  // read "## What was needed from Peter — ANSWERED … kept for the record". Past
  // tense, so the heading no longer matched, `need` fell through to the
  // **Raised by:** line, and the board printed that row's whole reason as
  // "sched-1715, 2026-09-08". Nobody could have seen it: the edit was for
  // readability and the join it broke is two files away.
  //
  // Case 1 has asserted `why is NOT the provenance line` since this harness was
  // written and it could NEVER have gone red, because every fixture that reached
  // it HAD the section — the assertion existed and its population did not. That
  // is this project's *assertion that passed on absence*, and the fix is a
  // fixture rather than a cleverer assertion.
  const dir = path.join(tmp, 'past-tense', 'loop', 'blocked');
  mk(dir, 'st-ives-v10.2-river.md', PAST_TENSE);
  const r = loopBlockedItems({ files: readBlockedDir(dir) });
  check('one row', r.items.length === 1, `got ${r.items.length}`);
  check('why is NOT the provenance line', !r.items[0].why.includes('sched-1715'), r.items[0].why.slice(0, 60));
  check('why falls back to the sentence naming the file',
    r.items[0].why.includes('loop/blocked/st-ives-v10.2-river.md'), r.items[0].why.slice(0, 80));
  // The provenance is not lost, only demoted: loopBlockedItems' own comment says
  // it is a fact about the row rather than a reason to act, and --json carries it.
  check('the provenance is still CARRIED on the row', r.items[0].raisedBy.includes('sched-1715'), r.items[0].raisedBy);
  check('the hold still attaches', r.holds.length === 1 && r.holds[0].key === 'draft-1', JSON.stringify(r.holds));
  check('the stated date still dates the row', r.items[0].ageDays !== null, String(r.items[0].ageDays));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
