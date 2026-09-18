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
 *  1. HUMAN TOUCHES PER MAP-MONTH — **not measured.** Nothing on disk distinguishes
 *     a commit Peter made from one a session made in his name; `git` says
 *     "Peter Cooper" for all 103 sessions in the review's window. The instrument
 *     that would make it real is named in `wouldNeed` and it is R9's own item 3:
 *     once a map's manifest records what its build and verification COST, the same
 *     record is the natural place for who performed each step.
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
export function readFacts({ busesDir, repos = [], readsDir = readdirSync, reads = readFileSync, exists = existsSync, ghRuns = defaultGhRuns }) {
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
  return {
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

  // 1 — human touches per map-month: not measured, and this says why.
  out.numbers.humanTouchesPerMapMonth = {
    label: 'Human touches per map-month',
    measured: false,
    value: null,
    target: 'falls towards 1',
    why: 'Nothing on disk tells a commit Peter made from one a session made in his name — git says "Peter Cooper" for both, across all 103 sessions in the review\'s window. Section 10 of the review says the repository cannot measure his time, and a number printed here would be the one number the whole recommendation is judged on, invented.',
    wouldNeed: 'R9 item 3 puts each build\'s and each verification\'s COST into the map\'s manifest. The same record is where WHO performed each step belongs — once a manifest carries `by: peter` against a step, this becomes a count over the estate and stops being an opinion.',
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
  L.push(`1. ${n.humanTouchesPerMapMonth.label}: NOT MEASURED — ${n.humanTouchesPerMapMonth.why}`);
  L.push(`   Would need: ${n.humanTouchesPerMapMonth.wouldNeed}`);
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
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('routine_numbers.mjs')) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
  };
  const busesDir = arg('buses', 'C:/u3a St Ives/Using AI/Buses');
  const days = Number(arg('days', String(DEFAULT_WINDOW_DAYS))) || DEFAULT_WINDOW_DAYS;
  const facts = readFacts({
    busesDir,
    repos: [
      { name: 'buses-data', dir: busesDir, branch: 'main' },
      { name: 'claude-skills', dir: 'C:/u3a St Ives/.claude/skills', branch: 'main' },
      { name: 'community-bus-maps', dir: 'C:/Claude/community-bus-maps', branch: 'main' },
    ],
  });
  const r = routineNumbers(facts, { windowDays: days });
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
}
