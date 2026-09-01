#!/usr/bin/env node
/* Prove the commitments source in worklist.mjs can go red AND stay quiet.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-commitments.mjs
 *
 * Written to the same shape as prove-red-correspondence.mjs, and for the same
 * reason: appearing is only half of it. A reminder that never fires is the
 * failure this source exists to prevent; a reminder that never STOPS is the
 * failure it could easily introduce, and a row still nagging about a letter
 * that went out last week is a row that gets ignored -- and then so is every
 * row beside it. So each case is a pair: make the state, see the row; clear
 * the state, see it gone.
 *
 * The dates are computed RELATIVE TO TODAY rather than written as literals.
 * A fixture with a hardcoded 2026-09-20 in it passes today, starts failing in
 * September for no reason anyone will remember, and gets deleted rather than
 * understood.
 *
 * It builds a throwaway buses tree and points the tool at it with --buses, so
 * it never reads or writes the real commitments.json. --portal is aimed at a
 * directory that does not exist: the portal queues then warn and skip, which is
 * what we want, because this tests one source and not six.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/* fileURLToPath, not new URL(...).pathname: this tree lives under
 * "C:\u3a St Ives\.claude\..." and the latter percent-encodes the space. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'worklist.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-worklist-'));
let bad = 0;

const dayOffset = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
};

const writeCommitments = (entries) => {
  const p = path.join(root, 'Development Docs', 'commitments.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ commitments: entries }, null, 2), 'utf8');
};

const writeRaw = (text) => {
  const p = path.join(root, 'Development Docs', 'commitments.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
};

function items() {
  const out = execFileSync('node', [TOOL, '--json', '--local', '--buses', root, '--portal', path.join(root, 'no-portal-here')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out).items.filter((i) => i.type === 'commitment');
}

function expect(label, want) {
  const got = items();
  const hit = want.key ? got.find((i) => i.key === want.key) : null;
  const ok = want.present ? !!hit && (want.rank == null || hit.rank === want.rank) : !hit;
  console.log(`  ${ok ? (want.present ? 'RED  ' : 'QUIET') : 'MISS '} ${label}`);
  if (!ok) {
    bad++;
    console.log(`        want ${want.present ? 'present' : 'absent'}${want.rank != null ? ` at rank ${want.rank}` : ''}; saw: ${got.map((i) => `${i.key}@${i.rank}`).join(', ') || '(none)'}`);
  }
  return hit;
}

const base = { id: 'letter', what: 'Send the letter', why: 'because', warnDays: 7, link: 'Development Docs/x.md' };

console.log('\n== commitments source: can it fire, and can it shut up? ==');

// 1. No file at all. A repo without one is not a repo in breach.
expect('no commitments.json at all', { key: 'commitment-letter', present: false });

// 2. Comfortably in the future -- OUTSIDE the warn window. Must say nothing:
//    a worklist that prints an 80-day-away item is one nobody finishes.
writeCommitments([{ ...base, by: dayOffset(60) }]);
expect('60d away, warnDays 7 -- outside the window', { key: 'commitment-letter', present: false });

// 3. Inside the warn window -- rank 7, YOUR MOVE but not urgent.
writeCommitments([{ ...base, by: dayOffset(3) }]);
expect('3d away, inside warnDays 7', { key: 'commitment-letter', present: true, rank: 7 });

// 4. The boundary itself, and it is centred rather than butted: days === warnDays
//    is INSIDE. Off-by-one here is the whole difference between a reminder that
//    fires on the last useful day and one that fires the day after.
writeCommitments([{ ...base, by: dayOffset(7) }]);
expect('exactly warnDays away -- boundary is inclusive', { key: 'commitment-letter', present: true, rank: 7 });

// 5. Overdue -- rank 4, the band that means it is your move now.
writeCommitments([{ ...base, by: dayOffset(-5) }]);
const od = expect('5d overdue', { key: 'commitment-letter', present: true, rank: 4 });
if (od && !/OVERDUE/.test(od.title)) { bad++; console.log('        title does not say OVERDUE: ' + od.title); }

// 5b. EVERY ROW ASKS WHETHER IT IS ALREADY DONE, and this is not cosmetic.
//    On 2026-09-01 the OSMF row said "send it, 7d left" a week after Peter had
//    sent it, because nothing on this disk changes when he sends an email. The
//    only channel that exists is him saying so, and he will not say so about a
//    row he believes is finished. So the row has to ask, in both bands.
for (const [when, off] of [['inside the window', 3], ['overdue', -5]]) {
  writeCommitments([{ ...base, by: dayOffset(off) }]);
  const row = items().find((i) => i.key === 'commitment-letter');
  const asks = row && row.do.some((d) => /ALREADY DONE IT\?/.test(d.what || ''));
  console.log(`  ${asks ? 'RED  ' : 'MISS '} ${when}: the row asks whether it is already done`);
  if (!asks) { bad++; console.log(`        steps were: ${row ? row.do.map((d) => d.what).join(' | ') : '(no row)'}`); }
}

// 6. THE ONE THAT MATTERS MOST: done means gone. Remove the entry and the row
//    must vanish -- not linger, not go amber. A nag that outlives the work is
//    how the whole list stops being read.
writeCommitments([]);
expect('entry deleted -- the row goes away', { key: 'commitment-letter', present: false });

// 7. A malformed file is a FAULT, not an empty list. Falling quiet here would
//    disable every reminder at once and look exactly like having none.
writeRaw('{ this is not json');
expect('malformed file reports a fault', { key: 'commitments-unreadable', present: true, rank: 0 });

// 8. An entry with no usable date is skipped rather than crashing the run --
//    one bad row must not take the other reminders down with it.
writeCommitments([{ ...base, by: 'not a date' }, { ...base, id: 'good', by: dayOffset(-1) }]);
expect('undated entry skipped, its neighbour still fires', { key: 'commitment-good', present: true, rank: 4 });
expect('undated entry itself is not emitted', { key: 'commitment-letter', present: false });

fs.rmSync(root, { recursive: true, force: true });
if (bad) { console.log(`\n${bad} case(s) behaved wrongly.`); process.exit(1); }
console.log('\nAll cases behaved: it fires when it should, and it shuts up when it should.');
