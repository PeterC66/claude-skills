/*
 * THE CALLERS PASS `--by` (OA-427, item 3 of R9 of the process review).
 *
 * `stage.js --by <who>` was built and measured on 2026-09-22, and the measurement
 * was the point of this file: 1,211 stage runs in the 30-day window, not one of
 * them carrying an actor. The flag was not broken. Nothing passed it. So *human
 * touches per map-month* stayed a refusal with a working instrument underneath it,
 * and the only thing standing between the two was four call sites nobody had
 * changed.
 *
 * THIS IS A JOIN, NOT A UNIT TEST, and that is deliberate. A test that spawned one
 * rollout and read the manifest back would prove that ONE call site forwards the
 * flag; the claim worth holding is about ALL of them, including the fifth caller
 * somebody writes next year. So the subject here is the source of every tool under
 * `assets/` that spawns `stage.js`: each `new` or `commit` call site it contains
 * must carry a by-spread, and a new one that does not reddens this file on the day
 * it is written rather than in a token count a month later.
 *
 * WHY A SPREAD AND NOT A STRING. `byArgs()` returns `[]` when nobody was named, so
 * `...BY` spreads to nothing and an unattributed run stays unattributed — absent,
 * never `""` and never `"unknown"`. That control lives in `stage_actor.test.js`;
 * what this file adds is that the argument reaches the CLI at all.
 *
 * `pull` is NOT in scope. It moves a committed output into an open run and writes
 * no run record of its own, so it has no actor to carry; `new` opens the record and
 * `commit` closes it, and those are the two that can answer the question.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
/* The subject directory is overridable so `tools/prove-red-stage-actor-callers.js`
 * can point this file at a mutated copy of the callers and watch it go red —
 * the same STAGE_JS idiom the other stage suites use. `byArgs` is loaded from the
 * SAME directory, so a mutation of either half is visible to the cases below. */
const ASSETS = process.env.STAGE_CALLERS_ASSETS || path.join(__dirname, '..', 'assets');
const { byArgs } = require(path.join(ASSETS, 'cli.js'));

/* Every tool that names stage.js as something to SPAWN. The two spellings are the
 * two this estate actually uses — `path.join(SK, 'stage.js')` and the __dirname
 * form — and a file that merely mentions stage.js in a comment is not one of them,
 * which is why the test is for the quoted filename beside a path join. */
function callersOfStage() {
  const out = [];
  for (const f of fs.readdirSync(ASSETS)) {
    if (!f.endsWith('.js') || f === 'stage.js') continue;
    const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
    if (/path\.join\([^)]*,\s*['"]stage\.js['"]\)/.test(src)) out.push({ file: f, src });
  }
  return out;
}

/* A `new` or `commit` call site, as its text. The tools wrap their spawn in a local
 * `stage(...)` helper with its own first argument (a cwd, or nothing), so the shape
 * to look for is the COMMAND WORD in quotes and everything up to the closing paren
 * — which may be on a later line, as both rollouts' S4 commits are. */
function stageCallSites(src) {
  const sites = [];
  const re = /stage\w*\(\s*(?:[^()]*?,\s*)?'(new|commit)'[\s\S]*?\);/g;
  let m;
  while ((m = re.exec(src))) sites.push({ verb: m[1], text: m[0] });
  return sites;
}

const CALLERS = callersOfStage();

test('the set of stage.js callers is the four this action knows about', () => {
  /* Not a lock on the number — a caller may legitimately be added. It is a lock on
   * NOTICING: a fifth one arrives here first, and the cases below then hold it to
   * the same rule. Four is what 2026-09-22 measured. */
  assert.deepStrictEqual(
    CALLERS.map(c => c.file).sort(),
    ['adopt_config.js', 'poi_tiers_sync.js', 'rollout.js', 'rollout_places.js'],
    'a tool that spawns stage.js was added or removed — give it --by, then update this list');
});

test('every caller requires byArgs rather than shaping the flag itself', () => {
  for (const { file, src } of CALLERS) {
    assert.ok(/require\('\.\/cli(\.js)?'\)/.test(src), `${file}: does not require cli.js`);
    assert.ok(/\bbyArgs\b/.test(src), `${file}: does not use byArgs() — a local ternary is the copy this function exists to prevent`);
  }
});

test('every `new` and `commit` call site forwards the by-spread', () => {
  let seen = 0;
  for (const { file, src } of CALLERS) {
    const sites = stageCallSites(src);
    assert.ok(sites.length > 0, `${file}: matched as a caller but no new/commit call site was found — the matcher has drifted from the code`);
    for (const s of sites) {
      seen++;
      assert.ok(/\.\.\.\s*(BY|by)\b/.test(s.text),
        `${file}: this \`${s.verb}\` call site does not forward --by, so every stage it opens is unattributed:\n${s.text}`);
    }
  }
  /* Nine, on 2026-09-22: four in rollout.js, three in rollout_places.js (its S4
   * commit and both S5 calls plus its S4 new), two in adopt_config.js and two in
   * poi_tiers_sync.js. Asserted as a floor rather than an equality, because adding
   * a call site is fine and dropping every one of them silently is not. */
  assert.ok(seen >= 9, `expected at least 9 new/commit call sites across the callers, found ${seen}`);
});

test('byArgs passes a name through and invents nothing', () => {
  assert.deepStrictEqual(byArgs('sched-1332'), ['--by', 'sched-1332']);
  assert.deepStrictEqual(byArgs('buses-cb2730'), ['--by', 'buses-cb2730']);
});

test('byArgs spreads to NOTHING when nobody was named', () => {
  /* The honest absence. parseArgs gives `undefined` for a flag never written. */
  assert.deepStrictEqual(byArgs(undefined), []);
  assert.deepStrictEqual(byArgs(null), []);
  assert.deepStrictEqual(byArgs(false), []);
});

test('a bare --by is forwarded bare, so stage.js gives its own refusal', () => {
  /* parseArgs yields `true` for `--by` with nothing usable after it. Forwarding a
   * bare `--by` makes stage.js die with the message that names OA-427; turning it
   * into a name here would be the second, drifting copy of a rule that has one
   * owner, and turning it into `[]` would silently record nobody for an operator
   * who plainly meant to say somebody. */
  assert.deepStrictEqual(byArgs(true), ['--by']);
});
