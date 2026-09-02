/*
 * engine_paths.js — the ONE way an engine file names a sibling.
 *
 * WHY THIS FILE EXISTS. Every generator in this engine runs in three places and
 * only one of them has its dependencies next to it:
 *
 *   1. in place from `make-bus-leaflet/assets/`, siblings present;
 *   2. COPIED into a town's S4 run folder by rollout.js / gate_lib.js /
 *      preview_design.js, with no siblings at all;
 *   3. inside the portal, where the entry point is vendored to `engine/area/`,
 *      `engine/place/` or `engine/expert/` and the shared modules sit one level
 *      up in `engine/`, with SKILL_ASSETS pointing at that root.
 *
 * A `require('./footer.js')` resolves in (1) and throws in (2) and (3), which is
 * a shape this project has shipped: gen_boarding.js required its three
 * dependencies from __dirname alone and could never have drawn a sheet in the
 * portal — it would have thrown on the require, before reading an input.
 *
 * So the search is: a SIBLING first, then SKILL_ASSETS, then the skill's own
 * path as a last resort. Sibling-first is what lets `status.js` gate a held-back
 * town against an OLDER engine — it hands the gate a generator from a worktree
 * at that commit and sets SKILL_ASSETS to that worktree's assets, and a search
 * that preferred SKILL_ASSETS over a copied sibling would build a HYBRID engine
 * that never existed. gate_lib.js's header records the day that was caught.
 *
 * UNTIL 2026-09-02 THIS SEARCH WAS SPELLED FOUR WAYS across five files: `_dep()`
 * in gen_internal.js and gen_boarding.js, two free-standing IIFEs in
 * gen_external_radial.js and one in gen_external_busway.js, and a
 * `path.dirname(_LABELLER)` chain standing in for it for six further modules.
 * Four spellings of one rule is four places for it to drift, and the machine-
 * specific last resort was written out five times (codebase review 2026-09-01,
 * engine F1 and F2). It is written ONCE here now, plus once in each entry
 * point's four-line bootstrap, which cannot be avoided: the bootstrap is the
 * code that finds THIS file, so it cannot ask this file where to look.
 * `test/engine_paths.test.js` asserts that those bootstraps are byte-identical
 * to each other and that no other engine file carries the literal.
 *
 * IT IS A FACTORY, `engineDep(__dirname)`, NOT A FREE `dep(name)`, and the
 * difference is load-bearing. The sibling arm must search the CALLER's folder,
 * not this module's: a generator copied into a workspace beside a copied
 * `icons.js` must find that copy, and if `dep()` searched its own `__dirname`
 * it would silently reach past it to the skill's. The three deployments above
 * all resolve identically either way; a copied workspace does not.
 *
 * Resolution does not affect the SVG — the same file is found by whichever arm
 * answers, which is why adopting this moved no byte on any of the 20 maps.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* The last resort, and the only copy of it outside the four bootstraps. It is
 * reached only when a generator has been copied away from its siblings AND the
 * caller set no SKILL_ASSETS — which rollout.js and render_sweep.js both do
 * today, so it is load-bearing rather than decorative. Ending in `/` and
 * concatenated (not path.join'd) so the string this returns is byte-for-byte
 * what the five hand-written copies returned. */
const ENGINE_HOME = 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/';

/* engineDep(callerDir) -> dep(name) -> an absolute path to load `name` from. */
function engineDep(callerDir) {
  return function dep(name) {
    const local = path.join(callerDir, name);
    try { if (fs.existsSync(local)) return local; } catch (e) {}
    return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS, name)
         : ENGINE_HOME + name;
  };
}

/* siblingOf(anchorPath) -> from(name) -> `name` in the SAME FOLDER a file was
 * already found in, with no search of its own. This is the second rule the
 * generators express, and it is not the same rule as dep(): gen_internal.js's
 * own comment says font_metrics.js "deliberately follows labeller.js rather than
 * searching on its own — the labeller and its metrics table must come from ONE
 * engine, and a search could pair a sibling labeller with a SKILL_ASSETS metrics
 * file". The two external generators say it with `path.dirname(_LABELLER)` and
 * mean the same thing for four modules each. Written as a search it would be a
 * DIFFERENT rule that happens to agree today, because no copier in this engine
 * copies a partial module set; naming it keeps the guard rather than resting on
 * that. */
function siblingOf(anchorPath) {
  const dir = path.dirname(anchorPath);
  return function from(name) { return path.join(dir, name); };
}

module.exports = { ENGINE_HOME, engineDep, siblingOf };
