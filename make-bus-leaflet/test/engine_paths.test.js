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

const { engineDep, siblingOf, ENGINE_HOME } = load('engine_paths.js');

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

test('with neither it falls to the laptop, which rollout.js and render_sweep.js still rely on', () => {
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
const ENTRY_POINTS = ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'gen_boarding.js',
                      'diagram_internal.js', 'schematize_internal.js'];
const BOOTSTRAP = [
  "const _EP = (() => { const local = path.join(__dirname, 'engine_paths.js');",
  "  try { if (fs.existsSync(local)) return local; } catch (e) {}",
  "  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS, 'engine_paths.js')",
  "       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/engine_paths.js'; })();",
].join('\n');

test('all six entry points carry the SAME bootstrap, character for character', () => {
  for (const f of ENTRY_POINTS) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(src.includes(BOOTSTRAP), f + ' does not carry the shared bootstrap verbatim');
  }
});

test('the laptop path is in the six bootstraps and engine_paths.js, and nowhere else in the engine', () => {
  const LITERAL = 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets';
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
  for (const name of ['engine_paths.js', 'page.js', 'dash_fit.js', 'svg_primitives.js', 'font_metrics.js']) {
    assert.ok(files.includes(name), name + ' is not in the engine hash closure');
  }
});
