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
  check('the ON HOLD marker is present at all', iHold >= 0, 'not found in worklist.mjs');
  check('the do-loop anchor is present at all', iDo >= 0, 'not found in worklist.mjs');
  check('the hold is rendered above the do steps', iHold >= 0 && iDo >= 0 && iHold < iDo,
    `hold at ${iHold}, do-loop at ${iDo}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
