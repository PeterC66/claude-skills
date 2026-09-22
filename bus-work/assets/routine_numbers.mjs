#!/usr/bin/env node
/*
 * routine_numbers.mjs — the five numbers R9 says to read off the run each month
 * (buses-data OA-402, R9 of the process review of 2026-09-17).
 *
 * WHY THIS EXISTS. [OA-402] closes with *"the five numbers, read off the run each
 * month and written into the round record, never into a page: human touches per
 * map-month, CI red rate, idle ticks, relayed commands, words a tick loads before
 * acting."* Nothing computed any of them. The review's own baselines were taken by
 * hand, in five sweeps, by a session that then wrote them into a document — which
 * is precisely the shape buses-data's CLAUDE.md forbids under *read every total off
 * the run, never from a document*, and precisely how next month's round record ends
 * up carrying a number somebody remembered.
 *
 * Run it from this folder (C:\u3a St Ives\.claude\skills\bus-work\assets); both
 * paths below are real on this machine and neither is a placeholder:
 *
 *   node routine_numbers.mjs --buses "C:/u3a St Ives/Using AI/Buses"
 *   node routine_numbers.mjs --buses "C:/u3a St Ives/Using AI/Buses" --json
 *   node routine_numbers.mjs --buses "…" --days 30      the window, default 30
 *
 * TWO OF THE FIVE ARE NOT COMPUTABLE HERE AND THIS SAYS SO RATHER THAN GUESSING.
 * That is the point of the file as much as the three that are. Section 10 of the
 * review says in as many words that it *"took Peter's account of what costs him
 * most at face value, since the repository cannot measure his time"* — so a script
 * that printed a confident `human touches: 3` would be inventing the one number the
 * whole recommendation is judged on. Each unmeasured number carries `why` and
 * `wouldNeed`: what would have to start being recorded for it to become real.
 *
 * WHAT EACH NUMBER IS, AND WHAT IT IS NOT:
 *
 *  1. HUMAN TOUCHES PER MAP-MONTH — measured from the MANIFESTS since OA-427,
 *     and reported as not-yet-recorded until they carry anything. `stage.js commit
 *     --by <who>` writes who performed a stage, `stage_actors.mjs` classifies the
 *     name with the loop's own `sched-` test, and a touch is a stage committed by a
 *     session a person started. Git was the wrong instrument and that is the whole
 *     reason this number was missing: it says "Peter Cooper" for a commit Peter made
 *     and for one a session made in his name, across all 103 sessions in the
 *     review's window — and S4, S5 and S6 are gitignored, so most of a map's cost
 *     never reached git at all. **The rate describes ATTRIBUTED runs alone and
 *     `coverage` is printed beside it always**, because on the day the flag landed
 *     no run on disk carried an actor and a rate over nothing is not a low rate.
 *
 *  2. CI RED RATE — measured, per repository, over the window, from `gh run list`
 *     on the default branch. This is the review's sweep 3 as a command. It counts
 *     RUNS and not streaks, which is the number R3's *Done when* is written against;
 *     the review's own finding that 317 failures were 69 streaks is a different
 *     question and this does not answer it.
 *
 *  3. IDLE TICKS — measured, from the NAMES of the files in `loop/runs/`, on
 *     `loop_runs.mjs`'s rule: a `-none` tick stopped before dispatch, an `-around`
 *     tick worked but never reached the barred resource. Both count as idle for
 *     this ratio, because R9's target — *below five per cent once the tree is not
 *     shared* — is about loop time that did not move the queue. No run file is ever
 *     opened, for `loop_runs.mjs`'s reason: they are prose a fresh session writes
 *     each hour, and a reader that depended on their wording would break the first
 *     time one was phrased differently.
 *
 *  4. RELAYED COMMANDS — measured as a **LOWER BOUND**, and labelled one. A relayed
 *     command is one a session handed Peter because it could not run it, and the
 *     only durable trace is prose: run records and `loop/your-move/` files. This
 *     greps them, which is exactly what the review's sweep 5 did, and section 10
 *     says of that method *"counts from greps of run records are lower bounds"*. It
 *     is reported with `floor: true` so no round record can quote it as a total.
 *
 *  5. WORDS BEFORE ACTING — measured, as `wc -w` over the things a session or tick
 *     is told to read before working: the stored task prompt (the text a tick
 *     actually executes), CLAUDE.md, the loop design and the two skills. This is
 *     the review's own `wc` row, and R6's *Done when* is read off it.
 *
 * PURE CORE, INJECTED EDGES, like deploy_pending.mjs and bods_scan.mjs:
 * `routineNumbers()` is a function of an already-read facts object and a clock, and
 * `readFacts()` is the only thing that touches the disk or `gh` — which is what lets
 * prove-red-routine-numbers.mjs falsify every verdict with no repository, no loop
 * folder and no network.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs, resolveBuses, resolvePortal, assetsDir } from './engine.mjs';
import { stageActors, actorWhy, defaultReadManifests } from './stage_actors.mjs';

export const DEFAULT_WINDOW_DAYS = 30;

/* A RELAYED COMMAND IS NOT A DECISION, AND THE FIRST DRAFT OF THIS FILE CONFLATED
 * THEM. Grepping the run records for *only Peter can* returns 58 files, and almost
 * all of them say *only Peter can SEND an email* or *only Peter can APPROVE a
 * publication*. Those are not relays: R9's own sentence is that Peter's part
 * becomes *"the sign-off on printed changes and the answers only a person can
 * give"*, so a drafted letter waiting to be sent is the process working, not the
 * process leaking. What the review's sweep 5 actually counted is narrower — *"at
 * least 12 pushes of this repository in ten days; every merge; every deploy; every
 * settings change"* — a command a session could have run and could not.
 *
 * So there are two populations below and the second is the CONTROL. Reporting the
 * relay count alone would leave a reader unable to tell a genuinely low number from
 * a pattern that matches nothing, which is the whole of this project's *prove the
 * check can fail*: measured on 2026-09-18, 19 files of 267 carry a relay and 58
 * carry a decision, so the patterns plainly bite and the relay number is low
 * because relays are rarer than decisions, not because the regex is dead. */
export const RELAY_PATTERNS = [
  /only (?:Peter|you) can (?:push|merge|deploy|run|apply)/i,
  /(?:Peter|you) (?:must|will|need(?:s)? to|has to|have to) (?:push|merge|deploy|apply)/i,
  /for (?:Peter|you) to (?:push|merge|deploy|run|apply)/i,
  /hand(?:ed|s)? (?:the |this )?(?:push|merge|deploy|command)/i,
  /run this (?:yourself|by hand)/i,
];

/* The control: a decision only a person can make. NOT counted as a relay. */
export const DECISION_PATTERNS = [
  /only (?:Peter|you) can (?:send|approve|reject|decide|answer|sign)/i,
];

const WORD_COUNT = (s) => (String(s || '').match(/\S+/g) || []).length;

/** The last fenced block under "## The task prompt" — check-task-prompt.mjs's rule,
 * restated here rather than imported because that file lives in buses-data and this
 * one is in claude-skills. The join between the two is asserted in the harness. */
export function promptBlock(md) {
  const at = String(md || '').indexOf('## The task prompt');
  if (at < 0) return null;
  const fences = [...String(md).slice(at).matchAll(/\n```[a-z]*\n([\s\S]*?)\n```/g)];
  return fences.length ? fences[fences.length - 1][1] : null;
}

/** `gh run list` for one repo, or null if gh cannot answer. */
export const defaultGhRuns = (dir, { limit = 300, run = execFileSync } = {}) => {
  try {
    const out = run('gh', ['run', 'list', '--limit', String(limit), '--json', 'conclusion,createdAt,headBranch,event'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
    const j = JSON.parse(out);
    return Array.isArray(j) ? j : null;
  } catch { return null; }
};

/**
 * Read every fact the numbers are computed from. The only function here that
 * touches the disk, the network or a subprocess.
 *
 * `repos` is [{ name, dir, branch }]. A repo `gh` cannot answer for is carried as
 * `runs: null`, which the core reports as *not measured* rather than as zero reds —
 * a CI red rate of 0% because nobody could ask is the shape this project has a
 * shelf of lessons about.
 */
export function readFacts({ busesDir, repos = [], readsDir = readdirSync, reads = readFileSync, exists = existsSync, ghRuns = defaultGhRuns, readManifests = defaultReadManifests }) {
  const at = (...p) => path.join(busesDir, ...p);
  const readText = (p) => { try { return exists(p) ? String(reads(p, 'utf8')) : null; } catch { return null; } };
  const listDir = (p) => { try { return exists(p) ? readsDir(p) : null; } catch { return null; } };

  const readmeMd = readText(at('loop', 'README.md'));
  const runNames = listDir(at('loop', 'runs'));
  /* The two skills are found from THIS file's own location, not from busesDir.
   * The first draft climbed out of the buses tree with `dirname(busesDir)/..`,
   * which happens to land on the right folder on this laptop and on nothing at
   * all anywhere else — and `readText` answers a wrong path with `null`, which
   * this core reports as "not measured" rather than as an error. This module
   * lives in `<skills>/bus-work/assets/`, so its siblings are two levels up. */
  const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  /* WHO PERFORMED EACH STAGE (OA-427). Injected like `ghRuns`, and for the same
   * reason: it is the only other fact here that needs something outside the buses
   * tree — `gate_lib.js`'s map enumerator, which lives beside this file in the
   * skills repository — so the harness can hand the core an estate without one. */
  return {
    manifests: readManifests({ busesDir, skillsAssets: path.join(skillsRoot, 'make-bus-leaflet', 'assets') }),
    runNames,
    runTexts: (runNames || []).map((f) => readText(at('loop', 'runs', f)) || ''),
    yourMoveTexts: (listDir(at('loop', 'your-move')) || []).filter((f) => f.endsWith('.md')).map((f) => readText(at('loop', 'your-move', f)) || ''),
    prompt: promptBlock(readmeMd),
    pages: {
      'CLAUDE.md': readText(at('CLAUDE.md')),
      'loop/README.md': readmeMd,
      'make-bus-leaflet/SKILL.md': readText(path.join(skillsRoot, 'make-bus-leaflet', 'SKILL.md')),
      'bus-work/SKILL.md': readText(path.join(skillsRoot, 'bus-work', 'SKILL.md')),
    },
    repos: repos.map((r) => ({ ...r, runs: ghRuns(r.dir) })),
  };
}

/* THE RUN-NAME PARSER IS IMPORTED, NOT RE-IMPLEMENTED, AND THAT COST A WRONG
 * NUMBER FIRST. The first draft of this file carried its own regex, whose feed
 * group was `[a-z]+` where `loop_runs.mjs` uses `(.+)` with `/i` and lowercases
 * the result — so every `…-OA.md` run file failed to parse and was dropped from
 * the DENOMINATOR while the `-none` files it was being compared against all
 * parsed. The idle rate came out at 36.4% against a review baseline of 15%, which
 * is exactly plausible enough to have been written into a round record as a
 * regression. Two copies of one rule, the second one read by nothing that could
 * disagree with it: the shape this repository files under *look for the helper
 * before you build it*. */
export { parseRunName } from './loop_runs.mjs';
import { parseRunName } from './loop_runs.mjs';

/** Feeds that mean the tick did not move the queue — loop_runs.mjs's UNREACHED. */
export const IDLE_FEEDS = new Set(['none', 'around']);

/** The five numbers, from `readFacts()`'s output. */
export function routineNumbers(facts, { now = Date.now(), windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const since = now - windowDays * 86400000;
  const out = { windowDays, at: new Date(now).toISOString(), numbers: {} };

  /* 1 — human touches per map-month, from the manifests (OA-427).
   *
   * A TOUCH IS A STAGE A PERSON-STARTED SESSION COMMITTED. `stage_actors.mjs`
   * holds the classification and the denominator argument; what is decided here is
   * only when the answer may be called MEASURED, and the rule is the narrowest one
   * available: at least one run in the window carries an actor. A threshold of
   * "enough" coverage would be a number nobody could defend, so instead `coverage`
   * travels with the value in every output and is printed beside it always.
   */
  const actors = stageActors(facts.manifests, { now, windowDays });
  const actorsOk = actors.status === 'ok' && actors.attributed > 0;
  out.numbers.humanTouchesPerMapMonth = {
    label: 'Human touches per map-month',
    measured: actorsOk,
    value: actorsOk ? actors.perMapMonth : null,
    target: 'falls towards 1',
    runs: actors.status === 'ok' ? actors.runs : null,
    attributed: actors.status === 'ok' ? actors.attributed : null,
    byPerson: actors.status === 'ok' ? actors.byPerson : null,
    byLoop: actors.status === 'ok' ? actors.byLoop : null,
    coverage: actors.status === 'ok' ? actors.coverage : null,
    mapsAttributed: actors.status === 'ok' ? actors.mapsAttributed : null,
    maps: actors.status === 'ok' ? actors.maps : [],
    note: 'A touch is one stage committed by a session a person started; a `sched-` tick is not one. The rate is over ATTRIBUTED runs only — read `coverage` with it, never without.',
    why: actorsOk ? undefined : actorWhy(actors),
    wouldNeed: actorsOk ? undefined : 'Pass `--by <who>` to `stage.js new` and `stage.js commit` — `sched-HHMM` from a tick, the session name otherwise. Nothing backfills a run committed before OA-427, so the window fills as work is done rather than all at once.',
  };

  // 2 — CI red rate, per repository, over the window.
  const repos = (facts.repos || []).map((r) => {
    if (!Array.isArray(r.runs)) {
      return { name: r.name, measured: false, why: 'gh could not answer for this checkout — not a red rate of zero.' };
    }
    const inWindow = r.runs.filter((x) => {
      const t = Date.parse(x.createdAt);
      return Number.isFinite(t) && t >= since && (!r.branch || x.headBranch === r.branch);
    });
    const done = inWindow.filter((x) => x.conclusion && x.conclusion !== 'cancelled' && x.conclusion !== 'skipped');
    const red = done.filter((x) => x.conclusion === 'failure' || x.conclusion === 'timed_out');
    return {
      name: r.name, measured: true, runs: done.length, red: red.length,
      rate: done.length ? red.length / done.length : null,
      truncated: r.runs.length >= 300 && inWindow.length === r.runs.length,
    };
  });
  out.numbers.ciRedRate = {
    label: 'CI red rate', measured: repos.some((r) => r.measured), target: 'falls from a third towards the real fault rate',
    perRepo: repos,
    note: 'Counts RUNS on the default branch, not streaks. The review found 317 failures in 69 streaks; that is a different question and this does not answer it.',
  };

  // 3 — idle ticks, from the run FILENAMES.
  const runs = (facts.runNames || []).map(parseRunName).filter(Boolean).filter((r) => r.at >= since);
  const idle = runs.filter((r) => IDLE_FEEDS.has(r.feed));
  out.numbers.idleTicks = {
    label: 'Idle ticks', measured: facts.runNames !== null, target: 'below 5%',
    ticks: runs.length, idle: idle.length,
    rate: runs.length ? idle.length / runs.length : null,
    none: runs.filter((r) => r.feed === 'none').length,
    around: runs.filter((r) => r.feed === 'around').length,
    why: facts.runNames === null ? 'no loop/runs/ folder in this tree' : undefined,
  };

  // 4 — relayed commands, as a floor.
  const texts = [...(facts.runTexts || []), ...(facts.yourMoveTexts || [])];
  const anyOf = (pats, t) => pats.some((re) => re.test(t));
  const hits = texts.filter((t) => anyOf(RELAY_PATTERNS, t)).length;
  const decisions = texts.filter((t) => anyOf(DECISION_PATTERNS, t)).length;
  out.numbers.relayedCommands = {
    label: 'Relayed commands', measured: texts.length > 0, floor: true, value: hits,
    files: texts.length, decisions,
    target: 'falls to the settings changes only Peter can make',
    note: 'A LOWER BOUND over every run record and your-move file on disk regardless of date — one hit per FILE, not per command. The only durable trace of a relay is prose, and section 10 of the review says counts from greps of run records are lower bounds. Never quote this as a total.',
    control: 'The decision count beside it is the control and is NOT a relay: a drafted letter only Peter can send, or a publication only he can approve, is R9 working rather than R9 leaking. A relay count that moved with the decision count would be measuring how often Peter is mentioned.',
  };

  // 5 — words before acting.
  const pages = Object.entries(facts.pages || {})
    .filter(([, v]) => typeof v === 'string')
    .map(([name, v]) => ({ name, words: WORD_COUNT(v) }));
  out.numbers.wordsBeforeActing = {
    label: 'Words a tick loads before acting', measured: facts.prompt !== null || pages.length > 0,
    target: 'a tenth of the review\'s baseline',
    taskPrompt: facts.prompt === null ? null : WORD_COUNT(facts.prompt),
    pages,
    note: 'The task prompt is what a tick EXECUTES; since R6 a tick is no longer told to read the loop design first, so the pages below are what a person loads and the prompt alone is what a tick does.',
  };

  return out;
}

/** One block of plain text, for pasting into a round record. */
export function render(r) {
  const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
  const L = [];
  L.push(`The five numbers — ${r.windowDays}-day window, read ${r.at}`);
  L.push('');
  const n = r.numbers;
  /* NUMBER 1 IS PRINTED WITH ITS COVERAGE OR NOT AT ALL (OA-427). A rate over
   * attributed runs alone reads exactly like a rate over the estate, and the one
   * that will be quoted into a round record is whichever one the line shows. */
  const h = n.humanTouchesPerMapMonth;
  if (h.measured) {
    L.push(`1. ${h.label} (target: ${h.target}): ${h.value.toFixed(2)} — ${h.byPerson} person-started stage(s) over ${h.mapsAttributed} map(s) with recorded work`);
    L.push(`     coverage: ${h.attributed} of ${h.runs} stage(s) in the window record who performed them (${pct(h.coverage)}); ${h.byLoop} ${h.byLoop === 1 ? 'was a loop tick' : 'were loop ticks'}. The rate describes the attributed ones alone.`);
  } else {
    L.push(`1. ${h.label}: NOT MEASURED — ${h.why}`);
    L.push(`   Would need: ${h.wouldNeed}`);
  }
  L.push(`2. ${n.ciRedRate.label} (target: ${n.ciRedRate.target}):`);
  for (const p of n.ciRedRate.perRepo) {
    L.push(p.measured ? `     ${p.name}: ${p.red} of ${p.runs} runs red — ${pct(p.rate)}` : `     ${p.name}: NOT MEASURED — ${p.why}`);
  }
  L.push(`3. ${n.idleTicks.label} (target: ${n.idleTicks.target}): ${n.idleTicks.measured ? `${n.idleTicks.idle} of ${n.idleTicks.ticks} ticks — ${pct(n.idleTicks.rate)} (${n.idleTicks.none} none, ${n.idleTicks.around} around)` : `NOT MEASURED — ${n.idleTicks.why}`}`);
  L.push(`4. ${n.relayedCommands.label}: at least ${n.relayedCommands.value} of ${n.relayedCommands.files} run records and your-move files — a LOWER BOUND, never a total`);
  L.push(`     control: ${n.relayedCommands.decisions} of the same files carry a DECISION only Peter can make (send, approve, answer), which is not a relay — so the patterns bite and ${n.relayedCommands.value} is low because relays are rarer, not because the regex is dead`);
  L.push(`5. ${n.wordsBeforeActing.label}: task prompt ${n.wordsBeforeActing.taskPrompt === null ? '—' : n.wordsBeforeActing.taskPrompt} words${n.wordsBeforeActing.pages.length ? '; ' + n.wordsBeforeActing.pages.map((p) => `${p.name} ${p.words}`).join(', ') : ''}`);
  return L.join('\n');
}

/* ---- CLI ---------------------------------------------------------------- */
/*
 * THE THREE REPOSITORIES ARE RESOLVED, NOT NAMED (buses-data OA-345).
 *
 * Until this change the block below carried its own `arg()` over `process.argv`
 * and three literal paths off Peter's laptop, so on any other checkout — CI, a
 * worktree, a second machine — it read three repositories that are not there and
 * reported the resulting silence as a routine number. `parseArgs` and the two
 * resolvers are `engine.mjs`'s, which is the whole point of the row: the
 * argument handling and the path handling are the skill's, in one place, and a
 * `--buses` or `--portal` flag or the `BUSES_DIR` / `BUSMAPS_PORTAL` environment
 * now reaches this tool the same way it reaches every other one.
 *
 * `claude-skills` has no resolver of its own because nothing needed one before:
 * it is the tree `assetsDir()` already finds the engine inside, two levels up,
 * which is the same derivation `preflight.mjs` uses for `skillsRoot`.
 */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('routine_numbers.mjs')) {
  const opts = parseArgs(process.argv.slice(2));
  const busesDir = resolveBuses({ buses: opts.buses });
  const engineAssets = assetsDir();
  const skillsRoot = engineAssets ? path.resolve(engineAssets, '..', '..') : null;
  const days = Number(opts.days ?? DEFAULT_WINDOW_DAYS) || DEFAULT_WINDOW_DAYS;
  const facts = readFacts({
    busesDir,
    repos: [
      { name: 'buses-data', dir: busesDir, branch: 'main' },
      // A tree that could not be found is left OUT rather than passed as null:
      // readFacts would read a missing directory as a repository with no commits,
      // and an absence reported as a zero is this estate's own named fault.
      ...(skillsRoot ? [{ name: 'claude-skills', dir: skillsRoot, branch: 'main' }] : []),
      { name: 'community-bus-maps', dir: resolvePortal({ portal: opts.portal }), branch: 'main' },
    ],
  });
  if (!skillsRoot) console.error('routine_numbers: no skills tree found, so claude-skills is NOT counted — set BUS_SKILL_ASSETS to the make-bus-leaflet assets folder.');
  const r = routineNumbers(facts, { windowDays: days });
  console.log(opts.json ? JSON.stringify(r, null, 2) : render(r));
}
