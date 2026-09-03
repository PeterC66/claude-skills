/*
 * engine_paths.test.js — the one resolver, and the rules that make it one.
 *
 * OA-224 Tier 3.4. The search itself is four lines and has never been wrong; it
 * was spelled FOUR WAYS across five files, and what is worth pinning is not that
 * a path joins but the three properties a fifth spelling would quietly lose:
 *
 *   1. THE ORDER. Sibling, then SKILL_ASSETS, then the laptop. Sibling-FIRST is
 *      what lets status.js gate a held-back town against an older engine: it
 *      hands the gate a generator from a worktree at that commit and sets
 *      SKILL_ASSETS to that worktree, and a resolver that preferred SKILL_ASSETS
 *      would build a HYBRID engine that never existed. gate_lib.js's header
 *      records the morning that was caught, one sheet away from being believed.
 *   2. WHOSE FOLDER "sibling" MEANS. `engineDep` is a factory taking the
 *      CALLER's __dirname, not a free `dep()` closing over this module's. A
 *      generator copied into a workspace beside a copied icons.js must find that
 *      copy; a resolver anchored here would reach past it to the skill's.
 *   3. THAT `siblingOf` DOES NOT SEARCH. It is the second, different rule the
 *      generators express — font_metrics.js follows labeller.js so the two
 *      cannot come from different engines — and a "tidy-up" that made it search
 *      would agree with itself on every deployment we have and silently drop the
 *      guard.
 *
 * The last three tests are source-level, over the real assets/: they are about
 * what the FILES say, which no runtime assertion can reach. The bootstrap that
 * finds this module cannot itself be shared — it is the code that asks where to
 * look — so the check is that all four copies are byte-identical and that
 * nothing else in the engine carries the laptop literal.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine');

const { engineDep, siblingOf, spawnTarget, ENGINE_HOME } = load('engine_paths.js');

/* Two scratch folders standing in for "the workspace a generator was copied to"
 * and "the engine SKILL_ASSETS points at". */
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-paths-'));
  const caller = path.join(root, 'workspace');
  const assets = path.join(root, 'engine');
  fs.mkdirSync(caller); fs.mkdirSync(assets);
  return { root, caller, assets };
}
function withSkillAssets(dir, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SKILL_ASSETS');
  const prev = process.env.SKILL_ASSETS;
  if (dir === null) delete process.env.SKILL_ASSETS; else process.env.SKILL_ASSETS = dir;
  try { return fn(); } finally {
    if (had) process.env.SKILL_ASSETS = prev; else delete process.env.SKILL_ASSETS;
  }
}

test('a sibling wins over SKILL_ASSETS, which is what keeps a held-back gate honest', () => {
  const s = scratch();
  fs.writeFileSync(path.join(s.caller, 'footer.js'), '// the copied one');
  fs.writeFileSync(path.join(s.assets, 'footer.js'), '// the current one');
  const dep = engineDep(s.caller);
  withSkillAssets(s.assets, () => {
    assert.strictEqual(dep('footer.js'), path.join(s.caller, 'footer.js'));
  });
});

test('with no sibling it takes SKILL_ASSETS, which is how it loads inside the portal', () => {
  const s = scratch();
  fs.writeFileSync(path.join(s.assets, 'footer.js'), '// the vendored one');
  const dep = engineDep(s.caller);
  withSkillAssets(s.assets, () => {
    assert.strictEqual(dep('footer.js'), path.join(s.assets, 'footer.js'));
  });
});

test('the cross-skill arm answers before the laptop, and it is the place skills only route', () => {
  // OA-232 Tier 3.1. make-place-bus-leaflet/assets/ is a fifth deployment: its
  // generator takes footer.js, labeller.js and five more from the TOWN folder,
  // and running in place it has neither a sibling nor SKILL_ASSETS. Without this
  // arm the search falls to a path that exists on one laptop — so on CI, where
  // generator_load.test.js requires that file on every run, the only thing
  // holding it up was a private IIFE in the place skill spelling the arm out for
  // itself. That is what F10 and F22 actually were.
  const s = scratch();
  const skills = path.join(s.root, 'skills');
  const town = path.join(skills, 'make-bus-leaflet', 'assets');
  const place = path.join(skills, 'make-place-bus-leaflet', 'assets');
  fs.mkdirSync(town, { recursive: true }); fs.mkdirSync(place, { recursive: true });
  fs.writeFileSync(path.join(town, 'footer.js'), '// the town engines');
  const dep = engineDep(place);
  withSkillAssets(null, () => {
    assert.strictEqual(dep('footer.js'), path.join(town, 'footer.js'));
    // Tried only when it EXISTS, so a name the town folder does not have still
    // reaches the last resort rather than a path that is not there. This is what
    // makes the arm inert for every town caller.
    assert.strictEqual(dep('nothing_here.js'), ENGINE_HOME + 'nothing_here.js');
  });
  // And it LOSES to SKILL_ASSETS, which is what keeps the portal and a held-back
  // gate reading the engine they named rather than whatever is across the tree.
  withSkillAssets(s.assets, () => {
    assert.strictEqual(dep('footer.js'), path.join(s.assets, 'footer.js'));
  });
});

test('spawnTarget is the pre-stages rule: RUN DIR first, and every arm is checked', () => {
  // A THIRD rule, and deliberately not dep(). Both pre-stages spawn gen_internal.js
  // after solving their geometry, and the workspace's own copy is the generator
  // that drew this build, so it wins over the engine the pre-stage happens to have
  // been loaded from. dep() would answer with the CALLER's folder first, and would
  // hand back an unverified path from its SKILL_ASSETS arm; this one checks every
  // arm and returns undefined when nothing is there, because the two callers say
  // so differently and each message names its own file.
  const s = scratch();
  const runDir = path.join(s.root, 'S4'); fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, 'gen_internal.js'), '// the workspace copy');
  fs.writeFileSync(path.join(s.assets, 'gen_internal.js'), '// the current engine');
  fs.writeFileSync(path.join(s.caller, 'gen_internal.js'), '// beside the pre-stage');
  const empty = path.join(s.root, 'empty'); fs.mkdirSync(empty);
  withSkillAssets(s.assets, () => {
    assert.strictEqual(spawnTarget(runDir, s.caller)('gen_internal.js'),
      path.join(runDir, 'gen_internal.js'), 'the run dir must win');
    assert.strictEqual(spawnTarget(empty, s.caller)('gen_internal.js'),
      path.join(s.assets, 'gen_internal.js'), 'then SKILL_ASSETS');
  });
  withSkillAssets(null, () => {
    assert.strictEqual(spawnTarget(empty, s.caller)('gen_internal.js'),
      path.join(s.caller, 'gen_internal.js'), 'then the script folder');
    // UNDEFINED, not a guess: the caller decides what to say and exits 1.
    assert.strictEqual(spawnTarget(empty, empty)('gen_internal.js'), undefined);
  });
});

test('with none of the three it falls to the laptop, which rollout.js still relies on', () => {
  const s = scratch();
  const dep = engineDep(s.caller);
  withSkillAssets(null, () => {
    assert.strictEqual(dep('footer.js'), ENGINE_HOME + 'footer.js');
  });
  // Concatenated, not path.join'd: this is the string the five hand-written
  // copies returned, separators and all, and the last resort has to stay that
  // string or a copied generator loads a different file on the day it is used.
  assert.ok(ENGINE_HOME.endsWith('/'), 'ENGINE_HOME must end in a separator');
});

test('sibling means the CALLERs folder, not this modules — the reason it is a factory', () => {
  const s = scratch();
  // A module of the same name in two places. A resolver anchored on
  // engine_paths.js's own __dirname would answer with the engine's copy; the
  // caller asked about its own.
  fs.writeFileSync(path.join(s.caller, 'icons.js'), '// copied beside the generator');
  const fromCaller = engineDep(s.caller);
  const fromEngine = engineDep(ENGINE_DIR);
  withSkillAssets(null, () => {
    assert.strictEqual(fromCaller('icons.js'), path.join(s.caller, 'icons.js'));
    assert.strictEqual(fromEngine('icons.js'), path.join(ENGINE_DIR, 'icons.js'));
  });
});

test('siblingOf does NOT search — it pins, even when the file is not there', () => {
  const s = scratch();
  fs.writeFileSync(path.join(s.assets, 'font_metrics.js'), '// the current metrics');
  const from = siblingOf(path.join(s.caller, 'labeller.js'));
  withSkillAssets(s.assets, () => {
    // A searching resolver would answer s.assets here. Pinning is the point: the
    // labeller and its metrics table must come from one engine, and this is the
    // only thing that says so.
    assert.strictEqual(from('font_metrics.js'), path.join(s.caller, 'font_metrics.js'));
  });
});

/* ---- source-level: the bootstrap, and the census of the laptop literal ---- */

// The two pre-stages joined on 2026-09-02 (OA-230): they take projection.js and
// internal_roads_config.js from the engine now, so they resolve like every entry point.
// gen_external_busway.js left this list on 2026-09-02 with the file itself.
const ENTRY_POINTS = ['gen_internal.js', 'gen_external_radial.js', 'gen_boarding.js',
                      'diagram_internal.js', 'schematize_internal.js'];
// THE PLACE SKILL JOINED ON 2026-09-03 (OA-232 Tier 3.1). Its generator carried
// two PRIVATE resolver IIFEs, written before engine_paths.js existed and never
// brought onto it, and the reason they could not simply be deleted is the fourth
// arm: the hop across to this folder. That went INTO engine_paths.js and into the
// bootstrap, so there is now ONE bootstrap across both skills and this test is
// what says so. place_engine.js is the place skill's single copy for its eleven
// build-time assets, which are never copied anywhere and can therefore share one;
// gen_external_places.js is vendored to engine/place/ without it, so it keeps its
// own — the same reason the five above keep theirs.
const PLACE_BOOTSTRAPS = ['gen_external_places.js', 'place_engine.js'];
// The last resort, spelled once for the two censuses below.
const LAPTOP_LITERAL = 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets';
const BOOTSTRAP = [
  "const _EP = (() => { const local = path.join(__dirname, 'engine_paths.js');",
  "  try { if (fs.existsSync(local)) return local; } catch (e) {}",
  "  if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS, 'engine_paths.js');",
  "  const across = path.join(__dirname, '..', '..', 'make-bus-leaflet', 'assets', 'engine_paths.js');",
  "  try { if (fs.existsSync(across)) return across; } catch (e) {}",
  "  return 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/engine_paths.js'; })();",
].join('\n');

test('all seven bootstraps, across BOTH skills, are the same characters', () => {
  for (const f of ENTRY_POINTS) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(src.includes(BOOTSTRAP), f + ' does not carry the shared bootstrap verbatim');
  }
  const PLACE_DIR = load('engine_version.js').placeAssetsDir(ENGINE_DIR);
  if (!fs.existsSync(PLACE_DIR)) {
    // Announced rather than skipped silently: a mutation run copies the TOWN
    // engine to a scratch folder and the place skill is not beside it there.
    console.log('# engine_paths: the place assets folder is not at ' + PLACE_DIR
      + ' — checking the five town bootstraps only (the expected shape under ENGINE_DIR=<scratch>)');
    return;
  }
  for (const f of PLACE_BOOTSTRAPS) {
    const p = path.join(PLACE_DIR, f);
    assert.ok(fs.existsSync(p), 'place/' + f + ' is gone — is the place skill still on this bootstrap?');
    const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(src.includes(BOOTSTRAP), 'place/' + f + ' does not carry the shared bootstrap verbatim');
  }
});

test('no OTHER place asset reaches across on its own terms', () => {
  // What F10 and F22 were: eleven build-time assets each with a private way back
  // to this folder, four of them ending in an absolute path. They go through
  // place_engine.js now, and this is the census that stops a twelfth starting a
  // new spelling — over the folder, not over a list of the four that were wrong.
  const PLACE_DIR = load('engine_version.js').placeAssetsDir(ENGINE_DIR);
  if (!fs.existsSync(PLACE_DIR)) return;   // announced by the test above
  const allowed = new Set(PLACE_BOOTSTRAPS);
  const offenders = [];
  for (const f of fs.readdirSync(PLACE_DIR)) {
    if (!f.endsWith('.js') || allowed.has(f)) continue;
    const src = fs.readFileSync(path.join(PLACE_DIR, f), 'utf8');
    for (const line of src.split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;      // a comment is not a resolution
      if (line.includes(LAPTOP_LITERAL) || /'\.\.',\s*'\.\.',\s*'make-bus-leaflet'/.test(line)) {
        offenders.push('place/' + f + ': ' + line.trim());
      }
    }
  }
  assert.deepStrictEqual(offenders, [],
    'a place asset is reaching across on its own — require("./place_engine.js") instead');
});

test('the laptop path is in the five town bootstraps and engine_paths.js, and nowhere else in the engine', () => {
  const LITERAL = LAPTOP_LITERAL;
  const allowed = new Set(ENTRY_POINTS.concat(['engine_paths.js']));
  const offenders = [];
  for (const f of fs.readdirSync(ENGINE_DIR)) {
    if (!f.endsWith('.js') || allowed.has(f)) continue;
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    // A comment quoting the path to a reader is not a resolution; only a live
    // line building it into a require target is.
    for (const line of src.split(/\r?\n/)) {
      if (line.includes(LITERAL) && !/^\s*(\/\/|\*|\/\*)/.test(line)) offenders.push(f + ': ' + line.trim());
    }
  }
  assert.deepStrictEqual(offenders, [], 'a seventh copy of the last-resort path has appeared');
});

test('engine_paths.js and page.js joined the hash closure and dash_fit.js stayed in it', () => {
  // The regression this exists for. Replacing `path.join(path.dirname(_LABELLER),
  // 'dash_fit.js')` with `_from('dash_fit.js')` matched no pattern in
  // engine_version.js, so dash_fit.js fell OUT of the closure in the same edit
  // that put engine_paths.js IN — and the file count did not move. Only the
  // names showed it, so assert the names.
  const { engineFiles } = load('engine_version.js');
  const files = engineFiles(ENGINE_DIR);
  for (const name of ['engine_paths.js', 'page.js', 'wcag.js', 'dash_fit.js', 'svg_primitives.js', 'font_metrics.js']) {
    assert.ok(files.includes(name), name + ' is not in the engine hash closure');
  }
});
