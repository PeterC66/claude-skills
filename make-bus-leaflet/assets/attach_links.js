/*
 * attach_links.js — what `stage.js attach` and `detach` do (buses-data OA-552).
 * Its own module so stage.js, which the line ratchet holds, does not grow.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/*
 * ATTACH AND DETACH — A MAP BUILD IN A WORKTREE (buses-data OA-552, design A).
 *
 * S4-generate, S5-render, S6-verify and _latest are gitignored, so a build in a
 * worktree writes them into a tree that is removed with the worktree. `attach`
 * junctions those four folders onto the MAIN checkout's, so every run lands where
 * `status.js` and the gates already look; `detach` removes only the junctions.
 *
 * A junction, not a symlink: it needs no privilege on Windows. `detach` removes a
 * link with `unlink` (or `rmdir`), which never follows it — a recursive delete through
 * one would empty the main checkout's runs. A real folder is replaced only when
 * every file in it matches the main checkout's, bar line endings (the tracked
 * redteam.json under S6-verify is exactly that), because then nothing is lost.
 */
const ATTACH_DIRS = ['S4-generate', 'S5-render', 'S6-verify', '_latest'];

function gitOut(cwd, args) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// Where the main checkout's copy of this town folder is, or null when townDir IS in the main checkout.
function mainTownDir(townDir) {
  const top = gitOut(townDir, ['rev-parse', '--show-toplevel']);
  const common = gitOut(townDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!top || !common) return { error: 'not inside a git checkout' };
  const mainRoot = path.dirname(path.resolve(common));
  if (path.resolve(top).toLowerCase() === mainRoot.toLowerCase()) return { main: true };
  return { dir: path.join(mainRoot, path.relative(path.resolve(top), path.resolve(townDir))) };
}

// Line endings are not content: a worktree checks a tracked file out under the same autocrlf as the main checkout, but a file written by a tool need not match.
function sameText(a, b) {
  const strip = (p) => fs.readFileSync(p).filter(c => c !== 13);
  return Buffer.compare(strip(a), strip(b)) === 0;
}

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch (e) { return false; } }

function filesUnder(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...filesUnder(dir, r)); else out.push(r);
  }
  return out;
}

// Returns { attached: [], already: [], refused: [{dir, why}] }; changes nothing for a refused folder.
function attachLinks(townDir, mainDir) {
  const res = { attached: [], already: [], refused: [] };
  for (const d of ATTACH_DIRS) {
    const link = path.join(townDir, d);
    const target = path.join(mainDir, d);
    if (isLink(link)) {
      if (path.resolve(fs.realpathSync(link)).toLowerCase() === path.resolve(fs.existsSync(target) ? fs.realpathSync(target) : target).toLowerCase()) res.already.push(d);
      else res.refused.push({ dir: d, why: 'already a link, to ' + fs.realpathSync(link) });
      continue;
    }
    if (fs.existsSync(link)) {
      const differs = filesUnder(link).filter(f => {
        const m = path.join(target, f);
        return !fs.existsSync(m) || !sameText(path.join(link, f), m);
      });
      if (differs.length) { res.refused.push({ dir: d, why: differs.length + ' file(s) here are not in the main checkout or differ, first ' + differs[0] }); continue; }
      fs.rmSync(link, { recursive: true });
    }
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, link, 'junction');
    res.attached.push(d);
  }
  return res;
}

// A Windows junction takes rmdir; a POSIX symlink to a directory takes unlink. Neither follows the link.
function removeLink(link) {
  try { fs.unlinkSync(link); } catch (e) { fs.rmdirSync(link); }
}

function detachLinks(townDir) {
  const detached = [];
  for (const d of ATTACH_DIRS) {
    const link = path.join(townDir, d);
    if (isLink(link)) { removeLink(link); detached.push(d); }
  }
  return detached;
}

// `--as <name>` and `--force` off the command line; the name is the session's, one word, as ListAgents shows it.
function argsOf() {
  const a = process.argv.slice(2), i = a.indexOf('--as');
  return { as: i >= 0 ? a[i + 1] : null, force: a.includes('--force') };
}

// The commands, called from stage.js's dispatch with its own `die`. attach and lock take the town's lock
// (town_lock.js) in the MAIN checkout's town folder; detach and unlock give it back.
function run(cmd, townDir, die) {
  const lock = require('./town_lock');
  const { as, force } = argsOf();
  const where = mainTownDir(townDir);
  if (where.error) die(cmd + ': ' + where.error, 2);
  const lockedDir = where.main ? townDir : where.dir;
  if (cmd === 'who') {
    const r = lock.read(lockedDir);
    console.log(r.held ? `held by ${r.name || 'an unreadable holder'}, ${r.expired ? 'lease EXPIRED' : r.remainMin + ' min of lease left'}` : 'not held');
    return;
  }
  if (cmd === 'unlock' || cmd === 'detach') {
    if (cmd === 'detach') {
      const gone = detachLinks(townDir);
      console.log(gone.length ? 'detached: ' + gone.join(', ') : 'nothing attached');
    }
    if (!as && !force) { console.log('lock left as it is — pass --as <session name> to release yours'); return; }
    const r = lock.release(lockedDir, as, { force });
    if (!r.ok) die(cmd + ': ' + r.why, 1);
    console.log('town lock released');
    return;
  }
  if (!as) die(cmd + ': pass --as <session name, one word, as ListAgents shows it> — it is written into the town lock', 2);
  if (!where.main && !fs.existsSync(path.join(where.dir, 'manifest.json'))) die(cmd + ': no manifest.json at ' + where.dir + ' — the main checkout does not have this town yet', 2);
  // Lock first: a town somebody else holds is not touched at all, not even to junction its folders.
  const t = lock.take(lockedDir, as);
  if (!t.ok) die(cmd + ': this town ' + t.why, 1);
  console.log('town lock taken by ' + as + (t.was ? ' (' + (t.was.name === as ? 'renewed' : 'took over an expired lease from ' + t.was.name) + ')' : ''));
  if (cmd === 'lock') return;
  if (where.main) { console.log('this is the main checkout — nothing to attach'); return; }
  const r = attachLinks(townDir, where.dir);
  for (const d of r.attached) console.log('attached ' + d + ' -> ' + path.join(where.dir, d));
  for (const d of r.already) console.log('already attached ' + d);
  for (const x of r.refused) console.log('REFUSED ' + x.dir + ': ' + x.why);
  if (r.refused.length) die('attach: ' + r.refused.length + ' folder(s) refused, nothing in them was touched (the town lock is still yours — unlock to give it back)', 1);
}

module.exports = { attachLinks, detachLinks, mainTownDir, ATTACH_DIRS, run };
