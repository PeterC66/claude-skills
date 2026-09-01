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

const missing = conc.readRepo({ key: 'x', label: 'x', name: 'nowhere', dir: path.join(root, 'no-such-dir') });
ok(!missing.present && !missing.readable, 'a directory that does not exist is not silently "clean"');

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
