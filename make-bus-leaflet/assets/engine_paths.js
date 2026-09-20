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
 * So the search is: a SIBLING first, then SKILL_ASSETS, then the place skill's
 * way back across to this folder — and then it REFUSES, because a fourth answer
 * could only be the engine that happens to be installed on the machine, which is
 * not the engine any of the three deployments above is asking about. Sibling-first is what lets `status.js` gate a held-back
 * town against an OLDER engine — it hands the gate a generator from a worktree
 * at that commit and sets SKILL_ASSETS to that worktree's assets, and a search
 * that preferred SKILL_ASSETS over a copied sibling would build a HYBRID engine
 * that never existed. gate_lib.js's header records the day that was caught.
 *
 * UNTIL 2026-09-02 THIS SEARCH WAS SPELLED FOUR WAYS across five files: `_dep()`
 * in gen_internal.js and gen_boarding.js, two free-standing IIFEs in
 * gen_external_radial.js and one in gen_external_busway.js (dropped 2026-09-02), and a
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

/* The installed engine on THIS machine, and the only copy of the literal outside
 * the four bootstraps. `test/engine_paths.test.js` asserts no other engine file
 * carries it. Ending in `/` and concatenated (not path.join'd) so it is
 * byte-for-byte what the five hand-written copies produced.
 *
 * `dep()` NO LONGER RETURNS IT, AND THE SENTENCE THAT USED TO STAND HERE WAS
 * FALSE (buses-data OA-342 item 5, 2026-09-20). It read: *reached only when a
 * generator has been copied away from its siblings AND the caller set no
 * SKILL_ASSETS — which rollout.js and render_sweep.js both do today, so it is
 * load-bearing rather than decorative.* Items 1, 2 and 4 of that same row made
 * every clause of it untrue: build_s4.js sets SKILL_ASSETS for EVERY recipe row
 * from one base env, and render_sweep.js's runGenerator sets it from the pack's
 * own engine. gate_lib.js and preview_design.js, the other two copiers, always
 * did. So nothing in this engine reaches that arm any more, and what it was
 * load-bearing FOR was the fault: a generator copied for engine A, drawn with
 * the engine installed at this path, and stamped with A's hash.
 *
 * MEASURED BEFORE IT WAS REMOVED, not reasoned about. The arm was instrumented
 * to record every caller that reached it and the whole suite was run FROM A
 * WORKTREE — a path that is not this one, so the install and the engine under
 * test could be told apart, which on the installed engine they cannot. 1001
 * tests, three hits, and all three were the tests that exist to exercise this
 * arm: engine_paths.test.js's two temp workspaces and build_s4.test.js's
 * no-such-run-folder. No production path reached it.
 *
 * THE FOUR BOOTSTRAPS STILL CARRY THE LITERAL AND STILL FALL BACK TO IT, which
 * is a limit rather than an oversight: a bootstrap is the code that finds THIS
 * file, so it cannot ask this file where to look. What it buys is that the
 * refusal still arrives — a bootstrap that falls to this path loads the
 * INSTALLED engine_paths.js, whose dep() then throws on the first sibling it is
 * asked for, one file later than here and with the same message. */
const ENGINE_HOME = 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/';

/* THE FOURTH ARM IS FOR THE PLACE SKILL, added 2026-09-03 (OA-232 Tier 3.1).
 * make-place-bus-leaflet/assets/ is a FIFTH deployment the three arms above
 * cannot serve: gen_external_places.js takes footer.js, labeller.js and five more
 * from THIS folder, and when it runs in place — which is what
 * `test/generator_load.test.js` does, on every CI run — it has no sibling and no
 * SKILL_ASSETS, so the search would fall to a path that exists on one laptop.
 * The place skill's own two resolver IIFEs carried this arm and that is why they
 * could not simply be deleted; it is written here instead, once. It is tried
 * BEFORE the refusal and only if it EXISTS, so it changes nothing for a town
 * caller: from the engine's own folder it resolves to that same folder, and from
 * a copied S4 workspace it does not exist and the refusal below is what answers
 * — which until 2026-09-20 was the laptop (OA-342 item 5). */
const CROSS_SKILL = ['..', '..', 'make-bus-leaflet', 'assets'];

/* The fourth answer, and it is a refusal. It is a named function rather than an
 * inline `throw` for one reason: `tools/prove-red.js` breaks this arm by swapping
 * the call below for the `return ENGINE_HOME + name` it replaced, and a mutation
 * wants a one-line anchor with no escapes in it. The message is written for a
 * BUILD LOG, the only place anybody will meet it. */
function refuseNoEngine(name, callerDir) {
  throw new Error(
    'engine_paths: no engine to resolve "' + name + '" from.\n'
    + '  The caller was copied away from its siblings and named no engine:\n'
    + '    caller  ' + callerDir + '\n'
    + '    wanted  ' + name + '\n'
    + '  Set SKILL_ASSETS to the assets folder of the engine this build is FOR.\n'
    + '  Until 2026-09-20 this returned ' + ENGINE_HOME + name + ' instead — the\n'
    + '  engine INSTALLED on this machine, whatever engine the build was for. That\n'
    + '  is how eight hybrid sheets reached main (buses-data OA-342).');
}

/* engineDep(callerDir) -> dep(name) -> an absolute path to load `name` from. */
function engineDep(callerDir) {
  return function dep(name) {
    const local = path.join(callerDir, name);
    try { if (fs.existsSync(local)) return local; } catch (e) {}
    if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS, name);
    const acrossSkills = path.join(callerDir, ...CROSS_SKILL, name);
    try { if (fs.existsSync(acrossSkills)) return acrossSkills; } catch (e) {}
    return refuseNoEngine(name, callerDir);
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

/* spawnTarget(runDir, callerDir) -> find(name) -> the path to a file this
 * process is about to SPAWN, or undefined if there is none. A THIRD rule, and
 * the reason it is not dep(): its first arm is the RUN DIRECTORY, not the
 * caller's folder, and it CHECKS every arm rather than returning an unverified
 * path from the second.
 *
 * Both pre-stages run gen_internal.js as a child process after solving their
 * geometry, and both spelled this search out (engine N24). The order is the
 * point: the workspace's own copy is the generator that drew this build, so it
 * wins over the engine the pre-stage happens to have been loaded from — which is
 * what keeps a held-back town's schematic honest, the same property gate_lib.js's
 * header records for dep()'s sibling-first arm. The caller says what to do when
 * nothing answers, because the two say it differently and both messages name
 * their own file. */
function spawnTarget(runDir, callerDir) {
  return function find(name) {
    const cand = [path.join(runDir, name),
      process.env.SKILL_ASSETS && path.join(process.env.SKILL_ASSETS, name),
      path.join(callerDir, name)].filter(Boolean);
    return cand.find((f) => { try { return fs.existsSync(f); } catch (e) { return false; } });
  };
}

module.exports = { ENGINE_HOME, CROSS_SKILL, engineDep, siblingOf, spawnTarget };
