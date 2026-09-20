/*
 * _worktree.js — where a directory of this checkout ALSO lives, when this checkout is a
 * git worktree rather than the main one.
 *
 * WHY THIS FILE EXISTS. Since OA-341 every engine change is made in a worktree, and a
 * worktree is not a second clone: it has no `node_modules` of its own, nothing is
 * junctioned into it deliberately, and it sits at a different depth on disk from the main
 * checkout. Any path this suite derives by walking up from `__dirname` is therefore correct
 * in the installed checkout and wrong in the place the work actually happens — and both
 * instances found on 2026-09-19 failed QUIETLY rather than loudly:
 *
 *   - `asset_load.test.js` put `<pkg>/node_modules` on the child's NODE_PATH. In a worktree
 *     that directory does not exist, NODE_PATH ignores an entry that does not exist without
 *     saying so, and the census died on the first of the four files requiring `sharp`,
 *     reporting `contact_sheet.js failed while being loaded` — a sentence about the ENGINE
 *     for a condition that is a property of the CHECKOUT. `tools/prove-red-asset-load.js`
 *     could then not run in a worktree at all: its CONTROL failed, so four of its six cases
 *     reported NOT RED.
 *   - `_buses.js` walks up four levels to find the buses-data estate. From the installed
 *     checkout that is `C:\u3a St Ives\Using AI\Buses`; from a worktree under `skills-wt/`
 *     the same walk lands on `C:\u3a St Ives\.claude\Using AI\Buses`, which does not exist,
 *     so SEVEN tests skipped — five of them the falsification controls for collect-maps.ps1.
 *
 * SO THE SUITE READ 981/974/0 fail/7 skipped IN A WORKTREE AND 981/981/0 INSTALLED, at the
 * same commit. A green that is never green is a green nobody reads, and the specific cost
 * is the one this estate has paid before: the next session meets a real failure and files
 * it under *that will be the `sharp` one*.
 *
 * WHAT THIS IS NOT. It is not a fallback to "some other tree on this disk" — that is the
 * thing `_buses.js`'s own header forbids, and rightly. `--git-common-dir` names THE SAME
 * REPOSITORY this worktree belongs to, which is why it is the only question worth asking;
 * the twin is then taken at the SAME path relative to the repository root, so this stays
 * correct if either tree is moved or renamed, and returns null rather than guessing when
 * git cannot answer.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/* The same directory inside the MAIN checkout, or null when `dir` is already in it, is not
 * in a git working tree at all, or git cannot be asked. Never throws. */
function mainCheckoutTwin(dir) {
  try {
    const git = (args) => execFileSync('git', args,
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // --git-common-dir is the MAIN checkout's .git even from a linked worktree, and may
    // come back relative to `dir`, so it is resolved against it rather than against cwd.
    const mainRoot = path.dirname(path.resolve(dir, git(['rev-parse', '--git-common-dir'])));
    const here = path.resolve(git(['rev-parse', '--show-toplevel']));
    if (path.resolve(mainRoot) === here) return null; // this IS the main checkout
    return path.join(mainRoot, path.relative(here, path.resolve(dir)));
  } catch {
    return null;
  }
}

module.exports = { mainCheckoutTwin };
