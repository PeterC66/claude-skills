#!/usr/bin/env node
/* Prove the concurrency verdicts can go red — and, just as hard, that they go
 * back to green when the condition clears.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-concurrency.mjs
 *
 * No placeholders; it builds its own throwaway git repositories under the OS
 * temp directory and never looks at the real trees.
 *
 * WHY EVERY CASE IS A PAIR. A guard that says BETTER TO DELAY whatever the
 * world looks like is not a guard, it is a mute button waiting to be pressed —
 * and this one is aimed at somebody who wants to stop thinking about it, which
 * is precisely the reader who will stop reading it. So each case makes the
 * condition and sees the verdict, then clears the condition and sees it go.
 *
 * TWO HALVES, TESTED DIFFERENTLY, because they can each be wrong on their own.
 *
 *   1. THE OBSERVATION — readRepo() against real git repositories built here.
 *      Rules over a hand-written conditions object cannot tell you that
 *      `git status --porcelain` is being parsed correctly, and misparsing it
 *      would make every verdict below a confident fiction.
 *
 *   2. THE JUDGEMENT — assess()/classify() over synthetic conditions. Reaching
 *      a DELAY on the real disk would mean corrupting a real checkout, and a
 *      harness that has to break the machine to run is a harness nobody runs.
 *
 * THE CONTROL IS NOT DECORATION. The last block asserts that a clean world
 * makes everything SAFE NOW. Without it, a rule that returned CHECK FIRST
 * unconditionally would pass every red case above and be useless.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as conc from './concurrency.mjs';

/* fileURLToPath, not new URL(...).pathname: this tree lives under
 * "C:\u3a St Ives\.claude\..." and the latter percent-encodes the space. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-'));
let bad = 0;

function ok(pass, label, detail) {
  console.log(`  ${pass ? 'ok   ' : 'MISS '} ${label}`);
  if (!pass) { bad++; if (detail) console.log(`        ${detail}`); }
}
const want = (got, expected, label) => ok(got.verdict === expected, label, `wanted ${expected}, got ${got.verdict}${got.reasons.length ? ` (${got.reasons.map((r) => r.need).join(', ')})` : ''}`);
const says = (got, re, label) => ok(got.reasons.some((r) => re.test(r.why)), label, `no reason matched ${re}; saw: ${got.reasons.map((r) => r.why).join(' | ') || '(none)'}`);

// ---------------------------------------------------------------------------
// 1. THE OBSERVATION — does readRepo actually see what is on the disk?
// ---------------------------------------------------------------------------
console.log('\n== reading a real working tree ==');

const repoDir = path.join(root, 'fixture');
const g = (...a) => execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
fs.mkdirSync(repoDir, { recursive: true });
try {
  execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'ignore' });
  g('config', 'user.email', 'harness@example.invalid');
  g('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(repoDir, 'kept.txt'), 'one\n');
  g('add', 'kept.txt');
  g('commit', '-m', 'first');
} catch (e) {
  // THE ROOM MUST NOT BE RED BEFORE THE EXPERIMENT. If the fixture itself
  // cannot be built, every case below would fail for a reason that has nothing
  // to do with the thing under test. Refuse to run rather than report it.
  console.log(`\n  Cannot build the git fixture (${e.message.split('\n')[0]}). Nothing was tested.`);
  process.exit(2);
}

const read = () => conc.readRepo({ key: 'f', label: 'fixture', name: 'fixture', dir: repoDir });

let r = read();
ok(r.readable && r.branch === 'main', 'a fresh repo reads as branch main', `branch=${r.branch} readable=${r.readable}`);
ok(!r.dirty && !r.untracked.length && !r.offMain, 'and reads as clean, on the expected branch');

fs.writeFileSync(path.join(repoDir, 'scratch.txt'), 'x\n');
r = read();
ok(r.untracked.length === 1 && !r.dirty, 'an untracked file is untracked, not dirty', `untracked=${r.untracked.length} dirty=${r.dirty}`);

g('add', 'scratch.txt');
r = read();
ok(r.staged.length === 1 && !r.untracked.length, 'staging it moves it to STAGED', `staged=${r.staged.length}`);

fs.writeFileSync(path.join(repoDir, 'kept.txt'), 'two\n');
r = read();
ok(r.modified.length === 1, 'editing a tracked file shows as modified', `modified=${r.modified.join(',')}`);

// The path shape that drives the estate-sweep rule, and the one this project
// has actually been bitten by. A folder with a space in the name is not a
// hypothetical here either -- the real tree is full of them.
fs.mkdirSync(path.join(repoDir, 'Areas', 'St Ives'), { recursive: true });
fs.writeFileSync(path.join(repoDir, 'Areas', 'St Ives', 'routes.json'), '{}');
r = read();
ok(r.touchesMapData, 'an uncommitted file under Areas/ is seen as map data', `touchedTop=${r.touchedTop.join(',')}`);
ok(r.touchedTop.includes('Areas'), 'and the folder is named in the summary');

g('checkout', '-q', '-b', 'work/thing');
r = read();
ok(r.offMain && r.branch === 'work/thing', 'a feature branch reads as off main', `branch=${r.branch}`);
g('checkout', '-q', 'main');
ok(!read().offMain, 'and switching back clears it');

// ---------------------------------------------------------------------------
// 1a. THE HELD LETTER — readConditions against a real tree with a real hold
// ---------------------------------------------------------------------------
/* OA-301. The fixture has to look like the real repository in the one respect
 * that matters: `loop/` is gitignored, so the hold folder itself can never show
 * up as an untracked path. Without that line the tree would be dirty BECAUSE of
 * the hold, and the case would be measuring the wrong thing. */
console.log('\n== a held letter, read from a real tree (OA-301) ==');
{
  const held = path.join(root, 'held');
  const hg = (...a) => execFileSync('git', ['-C', held, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(path.join(held, 'Correspondence', 'CORR-001'), { recursive: true });
  fs.mkdirSync(path.join(held, 'Areas', 'Ramsey'), { recursive: true });
  execFileSync('git', ['init', '-b', 'main', held], { stdio: 'ignore' });
  hg('config', 'user.email', 'harness@example.invalid');
  hg('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(held, '.gitignore'), 'loop/*\n!loop/README.md\n');
  const letter = 'Correspondence/CORR-001/008-2026-09-10-out-the-map-is-back-up.md';
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi\n');
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'x\n');
  hg('add', '-A');
  hg('commit', '-q', '-m', 'first');
  const blocked = path.join(held, 'loop', 'blocked');
  fs.mkdirSync(blocked, { recursive: true });
  const cond = () => conc.readConditions({ buses: held });

  // The clean control first, so the hold cannot be what makes it green.
  let C = cond();
  ok(conc.assess(['buses-tree'], C).verdict === conc.SAFE && C.repos.buses.accounted.length === 0,
    'clean tree with an empty blocked folder: SAFE, nothing accounted');

  // Peter types the salutation and leaves it.
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi Simon\n');
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'the held letter with NO hold naming it: CHECK FIRST — nothing accounts for it');

  // A tick writes the hold, in the house style: several fields on one line,
  // the path in backticks, prose after it.
  fs.writeFileSync(path.join(blocked, 'corr-001-salutation.md'),
    '# CORR-001 message 008: the salutation names the correspondent\n\n' +
    `**Raised by:** \`sched-0815\`, 2026-09-10 · **File:** \`${letter}\`, modified and uncommitted since 07:16 local · **Blocks:** corr-unsent-CORR-001\n\n` +
    '## What is needed from you\n\nDecide the salutation.\n');
  C = cond();
  ok(C.repos.buses.modified.includes(letter), 'the letter is STILL reported as modified — the fact is not hidden', `modified=${C.repos.buses.modified.join(',')}`);
  ok(C.repos.buses.accounted.length === 1 && C.repos.buses.accounted[0].path === letter && C.repos.buses.accounted[0].ref === 'corr-001-salutation',
    'and it is accounted for, by the hold that names it', JSON.stringify(C.repos.buses.accounted));
  want(conc.assess(['buses-tree'], C), conc.SAFE, 'the held letter WITH a live hold naming it: SAFE — this is the case twelve ticks stopped on');
  want(conc.assess(['estate-sweep'], C), conc.SAFE, 'and a sweep is not held back by a letter either');
  ok(conc.formatConditions(C).some((l) => /accounted\s+Correspondence\/CORR-001.*corr-001-salutation\.md/.test(l)),
    'the conditions block SHOWS the subtraction and names the hold', conc.formatConditions(C).join('\n'));

  // A second dirty file the hold does not name brings CHECK FIRST straight back,
  // and the sentence counts ONE file and names Areas, not two and Correspondence.
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'y\n');
  C = cond();
  const A = conc.assess(['buses-tree'], C);
  want(A, conc.CHECK, 'a second dirty file outside the hold: CHECK FIRST again');
  ok(A.reasons.some((x) => /^1 uncommitted file\(s\) here \(Areas\)/.test(x.why)), 'and the reason counts the ONE unaccounted file and names its folder only', A.reasons.map((x) => x.why).join(' | '));
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'x\n');

  // Retiring the hold puts the letter back into the verdict — the direction a
  // rule like this must fail in.
  fs.rmSync(path.join(blocked, 'corr-001-salutation.md'));
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'retire the hold and the letter counts again: CHECK FIRST');

  // A hold that names a file OUTSIDE Correspondence/ accounts for nothing: that
  // is residue, and the tree was right to stop on it on 2026-09-09.
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi\n');
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'y\n');
  fs.writeFileSync(path.join(blocked, 'residue.md'),
    '# Residue\n\n**Raised by:** `sched-1115`, 2026-09-09 · **File:** `Areas/Ramsey/notes.md`, left behind\n\n## What is needed from you\n\nCommit it.\n');
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'a hold naming a file under Areas/ accounts for NOTHING: CHECK FIRST');
  ok(C.repos.buses.accounted.length === 0, 'and nothing is listed as accounted', JSON.stringify(C.repos.buses.accounted));

  // A hold with no File field, or a File field with no backticked path, is inert.
  fs.rmSync(path.join(blocked, 'residue.md'));
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'x\n');
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi Simon\n');
  fs.writeFileSync(path.join(blocked, 'vague.md'), '# Vague\n\n**Raised by:** `sched-0815`, 2026-09-10 · **File:** the Ramsey letter\n\n## What is needed from you\n\nDecide.\n');
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'a hold whose File field carries no backticked path accounts for nothing');
}

const missing = conc.readRepo({ key: 'x', label: 'x', name: 'nowhere', dir: path.join(root, 'no-such-dir') });
ok(!missing.present && !missing.readable, 'a directory that does not exist is not silently "clean"');

// ---------------------------------------------------------------------------
// 1b. THE PROXY — readPeerActivity, which had no case at all until 2026-09-10
// ---------------------------------------------------------------------------
/* It is never scored, which is exactly why nothing tested it, and it was wrong:
 * it read each transcript's MTIME, and a `custom-title` record appended to a
 * finished session moves an mtime with no turn behind it. `sched-1715` was
 * shown a tick that had stopped at 10:23Z as a peer active within the last
 * twenty minutes, in the line a stopped tick uses to decide whether the thing
 * blocking it is about to clear itself.
 *
 * THE FIRST TWO CASES ARE THE PAIR. The first is red against the old code and
 * green against the new; the second must stay green either way, or the fix
 * would have been "count nothing" and would have passed the first on its own.
 * The three after them hold the FLOOR: where the content cannot answer, the
 * mtime still does, because the fallback must not go below what the proxy
 * already gave. */
console.log('\n== the activity proxy, mtime against content ==');

const peerRoot = path.join(root, 'projects');
const peerDir = path.join(peerRoot, 'C--Buses');
fs.mkdirSync(peerDir, { recursive: true });

const NOW = Date.parse('2026-09-10T16:15:00Z');
const MIN = 60000;
const line = (ms) => `{"type":"assistant","timestamp":"${new Date(ms).toISOString()}"}\n`;
// The two records that actually did it: appended after the session ended, and
// neither of them carries a timestamp.
const BOOKKEEPING = '{"type":"last-prompt","leafUuid":"x"}\n{"type":"custom-title","customTitle":"t"}\n';

function transcript(name, body, mtimeMs) {
  const f = path.join(peerDir, name);
  fs.writeFileSync(f, body);
  fs.utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
  return f;
}
const only = (name) => {
  for (const f of fs.readdirSync(peerDir)) if (f !== name) fs.rmSync(path.join(peerDir, f));
};
const peers = () => conc.readPeerActivity({ windowMin: 20, projectsDir: peerRoot, now: NOW });

// 1. The measured fault: a fresh file whose last turn was six hours ago.
transcript('dead.jsonl', line(NOW - 352 * MIN) + BOOKKEEPING, NOW - 1 * MIN);
let P = peers();
ok(P.count === 0, 'a transcript touched a minute ago whose last TURN was 6 h ago is not a live peer', `count=${P.count}`);
ok(P.demoted === 1, 'and the demotion is counted, so the line can say so', `demoted=${P.demoted}`);
ok(P.newestAgeMin === 352, 'and the age reported is the turn\'s, not the file\'s', `newestAgeMin=${P.newestAgeMin}`);

// 2. The other half of the pair — a genuinely live session must still count.
only('none');
transcript('live.jsonl', line(NOW - 3 * MIN), NOW - 3 * MIN);
P = peers();
ok(P.count === 1 && P.demoted === 0, 'a session that took a turn 3 min ago IS counted', `count=${P.count}, demoted=${P.demoted}`);
ok(P.tailed === 1, 'and only the candidate was tail-read', `tailed=${P.tailed}`);

// 3. THE FLOOR. No timestamp anywhere: the mtime is all there is, so it is used.
only('none');
transcript('opaque.jsonl', BOOKKEEPING, NOW - 2 * MIN);
P = peers();
ok(P.count === 1 && P.demoted === 0, 'a transcript with no timestamp at all keeps its mtime — the fallback is the old behaviour, not silence', `count=${P.count}`);

// 4. The floor again, for a file that cannot be read as JSONL at all.
only('none');
transcript('empty.jsonl', '', NOW - 5 * MIN);
P = peers();
ok(P.count === 1, 'an empty transcript still counts by mtime rather than vanishing', `count=${P.count}`);

// 5. A timestamp LATER than the file itself must not be believed. The first
//    version of this case put the fresh stamp in a file with an OLD mtime, so
//    the prefilter threw it out before the cap was ever consulted and the
//    assertion was green against code with no cap in it at all. It has to sit
//    INSIDE the window, where the cap is the only thing standing.
only('none');
transcript('skewed.jsonl', line(NOW + 100 * MIN), NOW - 2 * MIN);
P = peers();
ok(P.newestAgeMin === 2, 'a timestamp from the future is capped at the mtime, not reported as a negative age', `newestAgeMin=${P.newestAgeMin}`);
ok(P.count === 1, 'and the file is still counted, on its mtime', `count=${P.count}`);

// 5b. And the greatest stamp wins, not the last one. A transcript quotes tool
//     output verbatim, so an OLDER timestamp pasted into the final turn must not
//     drag a live session's age backwards.
only('none');
transcript('pasted.jsonl', line(NOW - 4 * MIN) + line(NOW - 900 * MIN), NOW - 4 * MIN);
P = peers();
ok(P.count === 1 && P.newestAgeMin === 4, 'an older stamp pasted after the real one does not age a live session out', `count=${P.count}, newestAgeMin=${P.newestAgeMin}`);

// 6. The stat-only path is untouched: a file outside the window is never tailed.
only('none');
transcript('old.jsonl', line(NOW - 300 * MIN), NOW - 300 * MIN);
P = peers();
ok(P.count === 0 && P.tailed === 0 && P.scanned === 1, 'a file outside the window costs one stat and no read', `tailed=${P.tailed}, scanned=${P.scanned}`);

fs.rmSync(peerRoot, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 2. THE JUDGEMENT — each rule, made red and then cleared
// ---------------------------------------------------------------------------
console.log('\n== the rules, each one paired ==');

const repo = (over = {}) => {
  const base = {
    present: true, readable: true, name: 'repo', dir: '/x', branch: 'main', expect: 'main',
    staged: [], modified: [], untracked: [], unpushed: 0, touchedTop: [], touchesMapData: false,
  };
  const out = { ...base, ...over };
  out.dirty = out.staged.length + out.modified.length > 0;
  out.offMain = out.branch !== out.expect;
  if (!out.touchedTop.length) out.touchedTop = [...new Set([...out.staged, ...out.modified, ...out.untracked].map((p) => p.split('/')[0]))];
  return out;
};
const world = (o = {}) => ({
  at: '', selfSession: null, claims: [], peers: { ok: false },
  repos: { buses: repo(o.buses), engine: repo(o.engine), portal: repo(o.portal) },
});
const CLEAN = world();

// --- the shared working tree ---
want(conc.assess(['buses-tree'], CLEAN), conc.SAFE, 'clean tree: SAFE NOW');
const dirtyTree = world({ buses: { modified: ['_gtfs/refresh.log', 'Documentation/x.md'] } });
want(conc.assess(['buses-tree'], dirtyTree), conc.CHECK, 'uncommitted files: CHECK FIRST, not a delay');
says(conc.assess(['buses-tree'], dirtyTree), /_gtfs/, 'and it names the folder so you can recognise your own work');
says(conc.assess(['buses-tree'], dirtyTree), /cannot tell yours from a neighbour/, 'and admits it cannot attribute them');

const stagedTree = world({ buses: { staged: ['Development Docs/OA-999.md'] } });
want(conc.assess(['buses-tree'], stagedTree), conc.CHECK, "someone else's staged file: CHECK FIRST");
says(conc.assess(['buses-tree'], stagedTree), /pathspec/, 'and the remedy named is the pathspec commit');

// OA-301, the judgement half: accountFor over a synthetic repo, and the
// subtraction must reach the STAGED count too, or a staged held letter would
// print "1 already STAGED" about a file the verdict has not counted.
{
  const LETTER = 'Correspondence/CORR-001/008-out.md';
  const heldOnly = world({ buses: { modified: [LETTER] } });
  conc.accountFor(heldOnly.repos.buses, [{ path: LETTER, ref: 'corr-001-salutation' }]);
  want(conc.assess(['buses-tree'], heldOnly), conc.SAFE, 'synthetic: one held letter, accounted: SAFE');
  const unheld = world({ buses: { modified: [LETTER] } });
  conc.accountFor(unheld.repos.buses, []);
  want(conc.assess(['buses-tree'], unheld), conc.CHECK, 'synthetic: the same letter with no hold: CHECK FIRST');
  const stagedHeld = world({ buses: { staged: [LETTER], modified: ['Documentation/x.md'] } });
  conc.accountFor(stagedHeld.repos.buses, [{ path: LETTER, ref: 'corr-001-salutation' }]);
  const S = conc.assess(['buses-tree'], stagedHeld);
  want(S, conc.CHECK, 'synthetic: a staged held letter beside an unheld edit: CHECK FIRST');
  ok(S.reasons.some((x) => /^1 uncommitted file\(s\) here \(Documentation\) — this tool cannot tell/.test(x.why)),
    'and the staged-count branch is NOT taken for the accounted file', S.reasons.map((x) => x.why).join(' | '));
  const json = world({ buses: { modified: ['Correspondence/CORR-001/_people.local.json'] } });
  conc.accountFor(json.repos.buses, [{ path: 'Correspondence/CORR-001/_people.local.json', ref: 'x' }]);
  want(conc.assess(['buses-tree'], json), conc.CHECK, 'synthetic: a hold naming a .json under Correspondence/ is outside the scope: CHECK FIRST');
}

// --- the engine ---
want(conc.assess(['engine'], CLEAN), conc.SAFE, 'clean engine: SAFE NOW');
want(conc.assess(['engine'], world({ engine: { modified: ['assets/gen_internal.js'] } })), conc.CHECK, 'engine mid-edit: CHECK FIRST');
says(conc.assess(['engine'], world({ engine: { branch: 'work/labels' } })), /work\/labels/, 'engine on a branch names the branch');

// --- an estate-wide sweep: the quality_gate.js --accept shape ---
want(conc.assess(['estate-sweep'], CLEAN), conc.SAFE, 'clean tree, sweep away: SAFE NOW');
const sweepDanger = world({ buses: { untracked: ['Areas/Ramsey/ci-reference/internal.svg'] } });
want(conc.assess(['estate-sweep'], sweepDanger), conc.DELAY, 'uncommitted ci-reference: BETTER TO DELAY');
says(conc.assess(['estate-sweep'], sweepDanger), /every sheet it can FIND/, 'and says why a sweep is different from a commit');
// Cleared -- and this is the half that stops it being a mute button.
want(conc.assess(['estate-sweep'], world({ buses: { modified: ['Documentation/x.md'] } })), conc.CHECK,
  'dirty but NOT under Areas/Places/ci-reference: back down to CHECK FIRST');

// --- delivery and deploy ---
want(conc.assess(['portal-write'], CLEAN), conc.SAFE, 'portal on main and clean: SAFE NOW');
const portalBranch = world({ portal: { branch: 'oa-220-landmark-chooser' } });
want(conc.assess(['portal-write'], portalBranch), conc.DELAY, 'portal on a feature branch: BETTER TO DELAY');
says(conc.assess(['portal-deploy'], portalBranch), /oa-220-landmark-chooser/, 'and the deploy rule names the branch it would ship');
want(conc.assess(['portal-write'], world({ buses: { unpushed: 3 } })), conc.CHECK, 'unpushed commits here: CHECK FIRST before portal work');
says(conc.assess(['portal-write'], world({ buses: { unpushed: 3 } })), /verify\.yml/, 'and it says WHY the order matters');

// --- failing safe ---
const blind = world({ portal: { present: false, readable: false } });
want(conc.assess(['portal-write'], blind), conc.CHECK, 'a portal it cannot read is never reported SAFE');

// ---------------------------------------------------------------------------
// 3. WHICH ROW GETS WHICH VERDICT
// ---------------------------------------------------------------------------
console.log('\n== rows ==');

// The worst world it can construct. Everything that touches a tree should be
// held back in it -- and the decisions must NOT be, because a decision taken in
// a browser cannot be spoiled by anything happening on this disk. That is the
// single most important assertion in this file: it is what makes the tool
// useful rather than merely cautious.
const WORST = world({
  buses: { staged: ['Areas/Ramsey/S3-config/x.json'], modified: ['_gtfs/refresh.log'], unpushed: 4 },
  engine: { branch: 'work/x', modified: ['assets/render.js'] },
  portal: { branch: 'oa-220-x', modified: ['src/app.js'] },
});

for (const [type, key] of [['review', 'review-7'], ['application', 'apps'], ['request-decision', 'req-3'], ['awaiting-customer', 'await-2'], ['commitment', 'commitment-letter']]) {
  want(conc.classify({ type, key }, WORST), conc.SAFE, `${type}: SAFE NOW even in the worst world — it is a decision, not a write`);
}
want(conc.classify({ type: 'correspondence', key: 'corr-unsent-CORR-001' }, WORST), conc.SAFE,
  'a drafted reply Peter has to SEND: SAFE NOW — it is an email, not a commit');
want(conc.classify({ type: 'correspondence', key: 'corr-owed-CORR-001' }, WORST), conc.CHECK,
  'a reply that still has to be DRAFTED: CHECK FIRST — drafting writes into the tree');

want(conc.classify({ type: 'housekeeping', key: 'engine-stale' }, WORST), conc.DELAY,
  'an estate rollout: BETTER TO DELAY');
want(conc.classify({ type: 'housekeeping', key: 's6-stale' }, WORST), conc.CHECK,
  'one town\'s S6 pass: CHECK FIRST — the two housekeeping rows are not conflated');
want(conc.classify({ type: 'build', key: 'build-x' }, WORST), conc.DELAY,
  'a build that ends in a delivery: BETTER TO DELAY while the portal is off main');
want(conc.classify({ type: 'refresh-local', key: 'refresh-local-Ramsey' }, WORST), conc.CHECK,
  'a local-only refresh: CHECK FIRST — it never reaches the portal');

// An unrecognised type must not be assumed harmless. Whoever adds a new type
// should find it marked and come and say what it touches.
want(conc.classify({ type: 'something-new', key: 'zzz' }, WORST), conc.CHECK,
  'an unknown item type is not assumed harmless');

// One fact, stated once. contentions() is what lets the rows stay short.
const rows = [
  { key: 'a', type: 'refresh-local', safety: conc.classify({ key: 'a', type: 'refresh-local' }, dirtyTree) },
  { key: 'b', type: 'refresh-local', safety: conc.classify({ key: 'b', type: 'refresh-local' }, dirtyTree) },
];
ok(conc.contentions(rows, dirtyTree).length === 1, 'two rows blocked by one thing produce ONE contention line',
  `got ${conc.contentions(rows, dirtyTree).length}`);

// ---------------------------------------------------------------------------
// 4. THE CONTROL — a quiet machine must say go
// ---------------------------------------------------------------------------
console.log('\n== the control: nothing else running ==');

for (const t of conc.STANDING_TOOLS) {
  want(conc.assess(t.needs, CLEAN), conc.SAFE, `clean world: "${t.what}" is SAFE NOW`);
}
for (const type of ['build', 'refresh', 'housekeeping', 'correspondence', 'gate']) {
  want(conc.classify({ type, key: `${type}-1` }, CLEAN), conc.SAFE, `clean world: a ${type} row is SAFE NOW`);
}
ok(conc.contentions([{ key: 'a', type: 'build', safety: conc.classify({ key: 'a', type: 'build' }, CLEAN) }], CLEAN).length === 0,
  'and nothing is listed as contended');

// The other side of the control: the worst world must NOT be all-clear, or the
// block above would pass with rules that always return SAFE.
ok(conc.STANDING_TOOLS.some((t) => conc.assess(t.needs, WORST).verdict !== conc.SAFE),
  'and the worst world does hold something back (so the control means something)');

fs.rmSync(root, { recursive: true, force: true });
if (bad) { console.log(`\n${bad} case(s) behaved wrongly.`); process.exit(1); }
console.log('\nAll cases behaved: it holds work back when it should, and gets out of the way when it should.');
