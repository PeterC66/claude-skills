/*
 * scratch.js — the one root every throwaway directory goes into, and the exit
 * sweep that empties it.
 *
 * WHAT THESE PIN, AND WHY EACH ONE (OA-201). The temp folder held 68,078 scratch
 * directories on 2026-08-31 and one `npm test` run leaked 139 of them. The fix is
 * two claims, and both are the kind that quietly stop being true: everything goes
 * under ONE root (so a sweep is something you can write down), and a process that
 * made scratch removes it when it exits (so a forgotten teardown stops mattering).
 *
 * THE EXIT SWEEP CANNOT BE TESTED IN-PROCESS — this process has not exited — so
 * it is tested the only way it can be answered: a child node process makes a
 * directory, prints its path, and exits, and the parent asks the filesystem
 * afterwards. Asserting that `process.on('exit')` was registered would test the
 * registration, which is not the claim.
 *
 * And `--keep` gets its own child, because getting it wrong deletes the evidence a
 * harness was explicitly asked to leave behind — the failure would show up as a
 * missing directory long after the run that was meant to keep it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const S = require('../assets/scratch');

const HELPER = path.resolve(__dirname, '..', 'assets', 'scratch.js').replace(/\\/g, '\\\\');

/* Run a child that uses the helper and prints whatever it is asked to. Returns
 * the child's stdout, trimmed. */
function child(body) {
  return execFileSync(process.execPath, ['-e', "const S = require('" + HELPER + "');" + body],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('every directory lands under the one root, and the root is named once', () => {
  const dir = S.scratchDir('unit-test-');
  try {
    assert.strictEqual(path.dirname(dir), S.scratchRoot());
    assert.strictEqual(path.basename(S.scratchRoot()), S.ROOT_NAME);
    assert.strictEqual(path.dirname(S.scratchRoot()), os.tmpdir());
    assert.ok(fs.existsSync(dir));
  } finally { S.removeScratch(dir); }
});

test('the label is a hint and mkdtemp still supplies the uniqueness', () => {
  const a = S.scratchDir('same-label-');
  const b = S.scratchDir('same-label-');
  try {
    assert.notStrictEqual(a, b);
    assert.ok(path.basename(a).startsWith('same-label-'));
  } finally { S.removeScratch(a); S.removeScratch(b); }
});

/* A label reaches a filesystem path, so anything that cannot be in one is
 * replaced rather than passed through. A place name with a slash in it would
 * otherwise create a directory one level down, outside the root the sweep knows. */
test('a label carrying path separators cannot escape the root', () => {
  const dir = S.scratchDir('../../escape/attempt');
  try {
    assert.strictEqual(path.dirname(dir), S.scratchRoot());
    assert.ok(!path.basename(dir).includes('.'), 'a dot survived into ' + dir);
  } finally { S.removeScratch(dir); }
});

test('an empty or absent label still makes a directory', () => {
  for (const label of ['', null, undefined, '///']) {
    const dir = S.scratchDir(label);
    try { assert.strictEqual(path.dirname(dir), S.scratchRoot()); } finally { S.removeScratch(dir); }
  }
});

test('removeScratch never throws, and says whether it worked', () => {
  const dir = S.scratchDir('remove-me-');
  assert.strictEqual(S.removeScratch(dir), true);
  // force:true makes a second removal a no-op success, which is the contract a
  // call site that already cleans up its own directory relies on.
  assert.strictEqual(S.removeScratch(dir), true);
  assert.strictEqual(S.removeScratch(path.join(S.scratchRoot(), 'never-existed')), true);
});

test('a process that made scratch has none of it left when it exits', () => {
  const dir = child("const d = S.scratchDir('child-'); require('fs').writeFileSync(require('path').join(d,'x'),'x'); console.log(d);");
  assert.ok(dir.startsWith(S.scratchRoot()), 'the child made its directory somewhere else: ' + dir);
  assert.strictEqual(fs.existsSync(dir), false, 'the exit sweep left ' + dir + ' behind');
});

/* THE CONTROL FOR THE ONE ABOVE. A green "it is gone" is also what a test whose
 * child never made a directory would report — the shape this project keeps
 * paying for — so a second child makes one and is asked to keep it. If both
 * cases came back absent, the sweep would be untested and this pair says so. */
test('--keep means keep: keepScratch() switches the exit sweep off', () => {
  const dir = child("S.keepScratch(); console.log(S.scratchDir('kept-'));");
  try {
    assert.ok(dir.startsWith(S.scratchRoot()));
    assert.strictEqual(fs.existsSync(dir), true, 'keepScratch() did not stop the exit sweep');
  } finally { S.removeScratch(dir); }
});

test('BUSMAPS_SCRATCH_KEEP=1 does the same thing from outside the process', () => {
  const out = execFileSync(process.execPath,
    ['-e', "const S = require('" + HELPER + "'); console.log(S.scratchDir('env-kept-'));"],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BUSMAPS_SCRATCH_KEEP: '1' } }).trim();
  try { assert.strictEqual(fs.existsSync(out), true, 'the env opt-out did not hold'); }
  finally { S.removeScratch(out); }
});
