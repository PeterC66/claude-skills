#!/usr/bin/env node
/* Prove the correspondence source in worklist.mjs can go red AND go quiet.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-correspondence.mjs
 *
 * Appearing is only half of it. The failure this source exists to prevent is a
 * reminder that never fires; the failure it could EASILY introduce is a
 * reminder that never stops -- a row still nagging about a letter that went out
 * last week is a row that gets ignored, and then so is every row beside it. So
 * every case here is a pair: make the state, see the row; clear the state, see
 * it gone.
 *
 * It builds a throwaway buses tree and points the tool at it with --buses, so
 * it never reads or writes the real correspondence. --portal is aimed at a
 * directory that does not exist: the portal queues then warn and skip, which is
 * exactly what we want, because this is a test of one source and not of six.
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corr-worklist-'));
let bad = 0;

const write = (rel, text) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
  return p;
};

function items() {
  // --local because worklist.mjs refuses to guess a portal since 2026-08-31.
  // This harness has no portal at all -- that is the point of the --portal path
  // below -- so it is asserting the LOCAL-tree sources, and says so.
  const out = execFileSync('node', [TOOL, '--json', '--local', '--buses', root, '--portal', path.join(root, 'no-portal-here')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out).items.filter((i) => i.type === 'correspondence');
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

fs.mkdirSync(path.join(root, 'Areas'), { recursive: true });
write('Correspondence/CORR-901/README.md', '# CORR-901 — the test correspondent\n');

console.log('worklist.mjs, correspondence source — each state, and its absence\n');

// 1. last message inbound => a reply is owed, and nothing is drafted
write('Correspondence/CORR-901/001-2026-08-01-in-report.md', 'Their words.\n');
const owed = expect('a thread whose last message is inbound raises "reply owed"', { key: 'corr-owed-CORR-901', present: true, rank: 2 });
if (owed && !/the test correspondent/.test(owed.title)) {
  console.log('  MISS  it did not pick the label out of the thread README'); bad++;
} else if (owed) console.log('  GREEN it named the thread by its label, not by a person');

// 2. an unsent draft after it => the owed row goes, an unsent row arrives
const draft = `**From:** BusMaps.uk · **Status:** DRAFTED, NOT SENT · **Channel:** email\n\n---\n\nDear all.\n`;
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', draft);
expect('drafting a reply clears "reply owed"', { key: 'corr-owed-CORR-901', present: false });
expect('an unsent draft raises "NOT SENT"', { key: 'corr-unsent-CORR-901', present: true, rank: 3 });

// 3. sending it must make the row GO AWAY. This is the half that matters.
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', draft.replace('DRAFTED, NOT SENT', 'SENT 2026-08-03'));
expect('marking it SENT clears the row', { key: 'corr-unsent-CORR-901', present: false });

// 4. an unanswered local question, and what answering it does
const decisions = (state) => JSON.stringify({
  map: 'Testtown', kind: 'area',
  decisions: [{ id: 'does-it-run', raised: '2026-08-01', answer: { state } }],
}, null, 1);
write('Areas/Testtown/local-decisions.json', decisions('asked'));
expect('a question left at "asked" is raised, as WAITING ON OTHERS', { key: 'corr-asked-Testtown', present: true, rank: 9 });
write('Areas/Testtown/local-decisions.json', decisions('answered'));
expect('answering it clears the row', { key: 'corr-asked-Testtown', present: false });

// 5. a tree with no Correspondence at all must be silent, not an error
fs.rmSync(path.join(root, 'Correspondence'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'Areas', 'Testtown'), { recursive: true, force: true });
expect('a tree with no correspondence raises nothing', { key: 'corr-owed-CORR-901', present: false });
try {
  items();
  console.log('  GREEN it ran cleanly with no Correspondence folder at all');
} catch (e) {
  console.log('  MISS  it threw when there was no Correspondence folder'); bad++;
}

fs.rmSync(root, { recursive: true, force: true });
console.log('');
if (bad) { console.log(`${bad} case(s) behaved wrongly.`); process.exit(1); }
console.log('Every state was watched appear AND watched disappear. A reminder that cannot stop is a reminder that gets ignored.');
