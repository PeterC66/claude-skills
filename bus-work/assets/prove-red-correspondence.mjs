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

// The suppressions this source makes, which are NOT items. A row that vanishes
// with no trace is the failure mode every case below is guarding, so the two
// assertions "the row is gone" and "the tool says why it is gone" are
// different assertions and both are made.
function settled() {
  const out = execFileSync('node', [TOOL, '--json', '--local', '--buses', root, '--portal', path.join(root, 'no-portal-here')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out).meta.correspondenceSettled || [];
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

// 1b. A THREAD MAY DECLARE ITSELF FINISHED, and then an inbound last message
// raises nothing. CORR-002 ended on "Thank you, I have forwarded it" and was
// reported as a person waiting for 18 days at rank 2, above every row anything
// could actually finish, while its own record said nothing was outstanding.
//
// This is a suppression, so it is the dangerous direction -- the failure it
// could introduce is a reminder that never fires. Every case below is
// therefore a pair, and THREE of the four are the refusals.
const record = (status, stamped) =>
  `# CORR-901 — the test correspondent\n\n`
  + (stamped ? `<!-- docstamp v1.0 | ${stamped} | sha=deadbeef -->\n` : '')
  + `**Opened:** 1 August 2026 · **Status:** ${status}\n`;

write('Correspondence/CORR-901/README.md', record('dormant and in good standing', '2026-08-05'));
expect('a thread record declaring it dormant, stamped after the message, raises nothing',
  { key: 'corr-owed-CORR-901', present: false });

// The one that stops this becoming a reminder that never fires: they wrote
// again. The stamp falls behind the new message on its own, with no upkeep.
write('Correspondence/CORR-901/README.md', record('dormant and in good standing', '2026-07-31'));
expect('the same declaration, stamped BEFORE the message, is not believed',
  { key: 'corr-owed-CORR-901', present: true, rank: 2 });

// An undated declaration proves nothing about which message it covers.
write('Correspondence/CORR-901/README.md', record('dormant and in good standing', null));
expect('a declaration with no stamp at all is not believed',
  { key: 'corr-owed-CORR-901', present: true, rank: 2 });

// The vocabulary is closed. Open prose must keep nagging -- this is the exact
// wording CORR-003 uses, emphasis and all.
write('Correspondence/CORR-901/README.md', record('**open, and the ball is with them.**', '2026-08-05'));
expect('an "open" declaration keeps the row', { key: 'corr-owed-CORR-901', present: true, rank: 2 });

write('Correspondence/CORR-901/README.md', '# CORR-901 — the test correspondent\n');

// 1c. THE REPLY MAY BE FILED IN ANOTHER THREAD, and this source could not see
// one until 2026-09-08. CORR-002 message 010 forwarded somebody else's
// suggestion; the answer was addressed to HER and copied to him, so it lives in
// CORR-005. The row said a real person was waiting with nothing written, at
// rank 2, above every row anything could actually finish, while the answer had
// been drafted an hour earlier.
//
// This is a suppression, so the refusals matter more than the silence. The
// pointer must RESOLVE -- that is what makes this declaration stronger than the
// prose one above, because a mistyped path cannot quietly switch a person off.
write('Correspondence/CORR-902/002-2026-08-02-out-reply.md', 'The answer, filed in her thread.\n');
const answeredBy = (target) =>
  `# CORR-901 · message 001 — inbound\n\n**From:** them · **Answered by:** [${target}](${target}) — it answers this by construction\n\n---\n\nTheir words.\n`;

write('Correspondence/CORR-901/001-2026-08-01-in-report.md',
  answeredBy('../CORR-902/002-2026-08-02-out-reply.md'));
expect('an inbound message naming a reply that EXISTS in another thread raises nothing',
  { key: 'corr-owed-CORR-901', present: false });
const named = settled().find((s) => s.ref === 'CORR-901');
if (named && /answered elsewhere/.test(named.status)) {
  console.log('  GREEN the suppression is NAMED in the output, not silent');
} else {
  console.log('  MISS  the row went quiet without the tool saying why'); bad++;
}

// The refusal. A pointer that resolves to nothing is a typo, a rename or a
// thread that was never created, and none of those is an answer.
write('Correspondence/CORR-901/001-2026-08-01-in-report.md',
  answeredBy('../CORR-902/002-2026-08-02-out-no-such-file.md'));
expect('a pointer to a file that does not exist silences nothing',
  { key: 'corr-owed-CORR-901', present: true, rank: 2 });

// And a bare relative path, without the markdown link, is read the same way --
// the link form is for the reader and for check-doc-links.mjs, not for this.
write('Correspondence/CORR-901/001-2026-08-01-in-report.md',
  '# CORR-901 · message 001 — inbound\n\n**From:** them · **Answered by:** ../CORR-902/002-2026-08-02-out-reply.md\n\n---\n\nTheir words.\n');
expect('a bare relative path is accepted too', { key: 'corr-owed-CORR-901', present: false });

fs.rmSync(path.join(root, 'Correspondence', 'CORR-902'), { recursive: true, force: true });
expect('deleting the reply brings the row straight back', { key: 'corr-owed-CORR-901', present: true, rank: 2 });
write('Correspondence/CORR-901/001-2026-08-01-in-report.md', 'Their words.\n');

// 2. an unsent draft after it => the owed row goes, an unsent row arrives
const draft = `**From:** BusMaps.uk · **Status:** DRAFTED, NOT SENT · **Channel:** email\n\n---\n\nDear all.\n`;
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', draft);
expect('drafting a reply clears "reply owed"', { key: 'corr-owed-CORR-901', present: false });
expect('an unsent draft raises "NOT SENT"', { key: 'corr-unsent-CORR-901', present: true, rank: 3 });

// 2b. THE HUMAN STEP IS NOT SUPPRESSIBLE. A thread record is prose we write,
// and rank 3 is the one row on this whole board that a person on the other end
// is actually waiting on. Marking a thread dormant must never take an unsent
// letter off the list -- that would be this source deleting the only reminder
// it exists to raise.
write('Correspondence/CORR-901/README.md', record('closed', '2026-09-01'));
expect('declaring the thread closed does NOT hide an unsent draft',
  { key: 'corr-unsent-CORR-901', present: true, rank: 3 });
write('Correspondence/CORR-901/README.md', '# CORR-901 — the test correspondent\n');

// 3. sending it must make the row GO AWAY. This is the half that matters.
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', draft.replace('DRAFTED, NOT SENT', 'SENT 2026-08-03'));
expect('marking it SENT clears the row', { key: 'corr-unsent-CORR-901', present: false });

// 3b. THE STATE IS DECLARED IN TWO PLACES AND ONLY ONE WAS BEING READ. Every
// case above writes a `**Status:**` field, and so did every case this harness
// had until 2026-09-08 -- but on that day only 3 of the estate's 12 outbound
// messages carried that field, while 10 of 12 carried the state in the H1
// title. CORR-005 message 002 carried the H1 ALONE, so a reply drafted to a
// member of the public, with two more people copied on it, raised NOTHING on
// this board. That is the reminder that never fires, in the one row of the
// whole list that only a person can clear.
const h1 = (state) => `# CORR-901 · message 002 — outbound, 2 August 2026 — ${state}\n\n**From:** BusMaps.uk · **Channel:** email\n\n---\n\nDear all.\n`;

write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', h1('DRAFTED, NOT SENT'));
expect('an H1 saying DRAFTED, NOT SENT raises the row with no **Status:** field at all',
  { key: 'corr-unsent-CORR-901', present: true, rank: 3 });
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', h1('SENT 3 August 2026'));
expect('the same file marked SENT in its H1 goes quiet', { key: 'corr-unsent-CORR-901', present: false });

// The other end of the trade, and the reason for \b. A row that nags about a
// letter which went out last week is a row that gets ignored, and then so is
// every row beside it -- so a SENT title must stay quiet even when the word
// "drafted" is inside another word in it.
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md', h1('SENT 3 August 2026, redrafted twice'));
expect('"redrafted" inside a SENT title does not nag', { key: 'corr-unsent-CORR-901', present: false });

// A contradiction between the two sites fails TOWARDS nagging, which is the
// same direction the inbound branch takes for unrecognised prose: a nag costs
// a reminder nobody needed, and the silence costs a person forgotten. Both
// orders are asserted, because a rule that only reads one of them is a rule
// that works by accident.
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md',
  h1('SENT 3 August 2026').replace('**From:** BusMaps.uk', '**From:** BusMaps.uk · **Status:** DRAFTED, NOT SENT'));
expect('H1 says SENT, the field says NOT SENT — it nags', { key: 'corr-unsent-CORR-901', present: true, rank: 3 });
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md',
  h1('DRAFTED, NOT SENT').replace('**From:** BusMaps.uk', '**From:** BusMaps.uk · **Status:** SENT, 3 August 2026'));
expect('the field says SENT, the H1 says NOT SENT — it still nags', { key: 'corr-unsent-CORR-901', present: true, rank: 3 });

// Agreeing that it went is the only thing that clears it.
write('Correspondence/CORR-901/002-2026-08-02-out-reply.md',
  h1('SENT 3 August 2026').replace('**From:** BusMaps.uk', '**From:** BusMaps.uk · **Status:** SENT, 3 August 2026'));
expect('both sites agreeing it is SENT clears the row', { key: 'corr-unsent-CORR-901', present: false });

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
