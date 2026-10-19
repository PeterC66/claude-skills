#!/usr/bin/env node
/*
 * ink_review.mjs — ONE review a month, of only the sheets whose ink moved
 * (buses-data OA-429, item 5 of R9 of the process review of 2026-09-17).
 *
 * WHAT IT IS FOR. R9 makes the monthly refresh unattended: a SAFE town is taken
 * through S1–S5 by a tick (`refresh_town.py`, OA-426). Delivery is an interactive
 * session's, never a tick's (since 2026-10-19, when OA-428, a tick stages, was
 * retired). The one human judgement R9 leaves is THIS: Peter looks once a month, at
 * one page, at only the maps whose sheets actually changed, and answers accept or
 * hold per map. A map whose ink did not move is not shown to him at all.
 *
 * IT IS A GATE, NOT A FOLLOW-ON. Delivering a map runs the portal's
 * `propose-update.mjs`, which emails the map's customer. So this review has to
 * sit BEFORE delivery: `--deliverable` is the question OA-428's step asks, and it
 * names only maps whose ink did not move or that Peter accepted. A held map, an
 * unanswered one and one this tool could not read are never deliverable.
 *
 * WHAT "THE INK MOVED" MEANS HERE, EXACTLY. The newest S4 run dated on or after
 * the scan is compared, sheet by sheet, with the newest S4 run dated BEFORE the
 * scan — what the map was before this month, not merely the build before the last
 * one, so a refresh followed by a rollout still shows the whole month's change.
 * The comparison is BYTES, after the footer's `build N.N · date` stamp has been
 * neutralised in both: two builds of one map always differ in that stamp, and the
 * applier round proved a SAFE refresh can be byte-identical apart from it. Any
 * other byte that differs counts as moved. That errs towards showing Peter a sheet
 * whose pixels turn out the same, which costs him a glance; the other way round
 * would publish a change nobody looked at.
 *
 * THE POPULATION is the towns the scan's grading called SAFE — the ones a tick
 * refreshed with nobody present — plus any town named with `--town`, so a map a
 * person rebuilt can join the same review. A grading from another scan is not
 * this review's population: it refuses, for the reason `refresh_grades.mjs` gives.
 *
 * A NAMED MAP STAYS NAMED (buses-data OA-430). Every collection rebuilds the record
 * from the population, so until 2026-10-01 a map named by an earlier run fell out of
 * the review — and its answer and staged record with it — the moment any later run
 * collected the same scan without naming it again. Ticks enrol one rebuilt map each,
 * so the second tick would have dropped the first. `carriedNames()` reads the maps
 * the existing record holds as `named` and every collection names them again; a
 * place keeps the folder it was found at.
 *
 * A PLACE MAP JOINS BY NAME, with `--place` (buses-data OA-430 item 3). The grading
 * is of towns, so no place is ever in the population by itself; a place a tick
 * rebuilt onto a newer engine is named, and the edge finds its folder the way the
 * worklist does (`gate_lib.findPlaces`: `Areas/<Town>/Places/<Place>`, or under
 * `Places/`). Each map carries `kind` (`area` or `place`) and its own `dir`, so
 * nothing downstream has to guess `Areas/<map>`. A place whose name is also a
 * town's in the same review refuses: an answer is recorded by name, and one name
 * must mean one map. `stage_refresh.mjs` stages a place as it stages a town,
 * from the `kind` and `dir` carried here.
 *
 * AN ANSWER IS ABOUT ONE BUILD. It records the S4 run it was given against, and a
 * map rebuilt after Peter answered loses the answer — kept under `superseded`,
 * never discarded — because an accept of v3.12 says nothing about v3.13.
 *
 * EXCEPT WHEN THE REBUILD IS THE SAME PICTURE (buses-data OA-584). Three of five
 * rollouts of Godmanchester Co-op Cambridge Road on 4–6 October changed nothing but
 * the footer stamp, and Peter was asked about one picture three times. So when the
 * answered build and the current one are BOTH on disk and every sheet is byte-identical
 * after `neutralise()`, the answer is carried forward: `after` re-pointed to the
 * current build, `carried: { from, why }` naming the build it was first given against.
 * Anything else — ink moved, a sheet added or dropped, the answered build pruned from
 * disk — supersedes as before, because nothing can then be compared.
 *
 * A SESSION MAY ANSWER BY RULE, AND PETER IS LEFT THE CONTROVERSIAL ONES (2026-10-14).
 * `--self-answer --by <who>` accepts an unanswered ink-moved map itself when (1) every
 * string on every moved sheet is on the before build too — service numbers,
 * destinations, stop names, times, the services panel — and (2) the build's inputs
 * are unchanged, and every engine commit between the two builds that touches the
 * moved sheet's generator has already been accepted by Peter on ANOTHER map (a
 * "first sighting"), with no open hold. Anything else gets
 * `selfCheck: { by, at, after, reason }` and stays waiting, and the reason is shown on
 * the page and in the worklist row. The rule, its limits and the register are in
 * `ink_self_answer.mjs`'s header. The sightings are kept ON the answers: `--answer`
 * records `engine: { from, to, commits: [{ sha, subject, kinds }] }` on every answer it
 * writes, and a self-answer carries `self: true` and never counts as a sighting. Like
 * every local mutator here, it prints by default and writes only with `--apply`; with
 * `--apply` it also backfills `engine` onto older answers whose builds are still on disk.
 *
 * WHERE THINGS GO. The review and its answers are `_gtfs/ink-review_<scan>.json`,
 * tracked, beside the grading it was drawn from. The page and its crops are
 * rebuilt from the sheets on demand and go under `loop/ink-review/<scan>/`, which
 * is gitignored — a crop is evidence to look at, not a record.
 *
 * THE RECORD COMMITS ITSELF. A tool that rewrites a tracked file and has no git call
 * leaves the buses-data checkout dirty, and a dirty main checkout stops every tick
 * that needs the tree — which is how an enrolment's re-pointed `after` build stalled
 * the loop on 2026-10-03 until a person committed it by hand. `commitRecord()` is
 * the one commit: the record and nothing else, by pathspec, subject `ink-review: …`,
 * read back afterwards (the path clean, HEAD's subject the one written). It never
 * pushes — the push preflight paces that. A commit that cannot be made is named on
 * stderr and leaves the record written; `--no-commit` opts out. `adopt.mjs` is
 * deliberately NOT how this file is committed: it is for Peter's finished edits,
 * and this one is machine output with no author to wait for.
 *
 * PURE CORE, INJECTED EDGE, like `refresh_grades.mjs`: `collect()` takes its disk
 * reads as arguments and reads no clock, so `prove-red-ink-review.mjs` can falsify
 * every rule with no Areas folder at all. Node core only, except that the crops
 * call `crop_compare.js` in the engine, which needs `sharp`.
 *
 * Run from anywhere. <scan> is a scan date such as 2026-10-01; <Town> is a folder
 * under Areas/; <Place> is a place map's folder name, wherever it is filed; <who>
 * is the answering session's name, e.g. buses-29 or sched-0015:
 *
 *   node ink_review.mjs --scan <scan>                       collect, write the record and the page
 *   node ink_review.mjs --scan <scan> --town "<Town>,<Town>" add towns a person rebuilt
 *   node ink_review.mjs --scan <scan> --place "<Place>,<Place>" add place maps (with or without --town)
 *   node ink_review.mjs --scan <scan> --no-crops            the record only, no sharp needed
 *   node ink_review.mjs ... --no-commit                     leave the record written and uncommitted
 *   node ink_review.mjs --scan <scan> --answer "<Town>" --verdict accept|hold --by <who> [--note "<why>"]
 *   node ink_review.mjs --scan <scan> --self-answer --by <who> [--apply] answer by rule what needs no person; print, or write with --apply
 *   node ink_review.mjs --scan <scan> --deliverable [--json] which maps a session may deliver
 *   node ink_review.mjs --scan <scan> --staged --town "<Map>" --map <slug> --proposal <n> --by <who> [--at <date>] [--notify digest]
 *                                                            record a staging made by hand, not by stage_refresh.mjs
 *
 * For `--staged`, <Map> is the map's name as the review lists it, a town or a place;
 * <slug> is the portal map's slug; <n> is the portal's proposed-update number; <date> is
 * when the staging was made, e.g. 2026-10-05, defaulting to now; and
 * `--notify digest` is added only if that staging went with `--no-notify` and its
 * customer is still owed the round's email (buses-data OA-573).
 *
 * Exit 0 on success, 2 on a refusal (the message names the remedy).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses, assetsDir } from './engine.mjs';
import { readGradeState, defaultReadGradeFiles } from './refresh_grades.mjs';
import { gatherEvidence, recordable, registerFrom, selfAnswer, backfillEngine, engineEdge, diskInputs } from './ink_self_answer.mjs';

export const SCHEMA = 1;
export const VERDICTS = ['accept', 'hold'];

export class Refused extends Error {}

const defaultGit = (root, argv, input) => {
  const r = spawnSync('git', ['-C', root, ...argv], { encoding: 'utf8', input });
  return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
};

/**
 * Commit ONE record file in the buses-data checkout, and read the commit back.
 * Returns `{ status: 'clean' | 'committed' | 'skipped' | 'failed', why?, sha? }`
 * and never throws: the record is already written, and a caller that has done
 * something outward (staged a map) must not be turned into a retry by a git fault.
 * `git` is injected so a stub can falsify each branch.
 */
export function commitRecord({ root, file, subject, git = defaultGit }) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return { status: 'skipped', why: `${file} is not inside ${root}` };
  const branch = git(root, ['branch', '--show-current']);
  if (branch.status !== 0) return { status: 'skipped', why: `${root} is not a git checkout (${branch.err.trim()})` };
  if (branch.out.trim() !== 'main') return { status: 'skipped', why: `the checkout is on ${JSON.stringify(branch.out.trim())}, not main` };
  const st = git(root, ['status', '--porcelain=v1', '--', rel]);
  if (st.status !== 0) return { status: 'failed', why: `git status failed: ${st.err.trim()}` };
  const line = st.out.split('\n')[0].replace(/\r$/, '');
  if (!line) return { status: 'clean' };
  const code = line.slice(0, 2);
  if (code !== ' M' && code !== '??') return { status: 'skipped', why: `${rel} is in state ${JSON.stringify(code)}; only a modified or new, unstaged record is committed` };
  if (code === '??') {
    const add = git(root, ['add', '--', rel]);
    if (add.status !== 0) return { status: 'failed', why: `git add failed: ${add.err.trim()}` };
  }
  const body = `${subject}\n\nWritten by ink_review.mjs and committed by it, so the checkout is not left dirty for the loop's tick gate.\n`;
  const c = git(root, ['commit', '-q', '-F', '-', '--', rel], body);
  if (c.status !== 0) return { status: 'failed', why: `git commit exited ${c.status}: ${(c.err || c.out).trim().split('\n').pop()}` };
  const head = git(root, ['log', '-1', '--format=%H%x00%s']).out.trim().split('\0');
  const after = git(root, ['status', '--porcelain=v1', '--', rel]).out.trim();
  if (head[1] !== subject || after !== '') return { status: 'failed', why: `the commit did not read back (HEAD ${JSON.stringify(head[1])}, record ${after ? 'still dirty' : 'clean'})` };
  return { status: 'committed', sha: head[0].slice(0, 8), subject };
}

/** Print what `commitRecord` did; true when the record is safely in git or needed no commit. */
export function reportCommit(r, tag = 'ink_review') {
  if (r.status === 'committed') { console.log(`${tag}: committed ${r.sha} "${r.subject}" (not pushed)`); return true; }
  if (r.status === 'clean') return true;
  console.error(`${tag}: the record is written and NOT committed — ${r.why}. The checkout is dirty until it is; commit the _gtfs/ink-review_<scan>.json record by pathspec.`);
  return false;
}

/* The stamp `sheet_stamps.js` prints: `build 3.12 · 21 Sep 2026`. The middle dot
 * is matched in every spelling an SVG could carry it, because a stamp that was
 * escaped and not neutralised would make every sheet in the estate "moved". */
export const STAMP_RE = /build \d+(?:\.\d+)* (?:·|&#183;|&#xb7;|&middot;) \d{1,2} [A-Z][a-z]{2} \d{4}/gi;
export const neutralise = (text) => String(text).replace(STAMP_RE, 'build ·');

/** null when the ink did not move; otherwise 'moved', 'new' or 'dropped'. */
export function inkChange(before, after) {
  if (before == null && after == null) return null;
  if (before == null) return 'new';
  if (after == null) return 'dropped';
  return neutralise(before) === neutralise(after) ? null : 'moved';
}

const RUN_KEY = /(\d{4}-\d{2}-\d{2})_(\d{4})$/;
/** `2026-09-21` from `v3.12_2026-09-21_0343`, the LOCAL date the folder is named by. */
export const runDate = (id) => (String(id || '').match(RUN_KEY) || [])[1] || null;
const runKey = (id) => { const m = String(id || '').match(RUN_KEY); return m ? `${m[1]}_${m[2]}` : ''; };

/**
 * The two S4 runs this month's review compares, from a manifest. Sorted by the
 * run's own name rather than trusted in manifest order, for the reason
 * `refresh_grades.mjs` sorts its listing: an order that happens to be right on
 * this disk is not a rule.
 */
export function pickRuns(manifest, scan) {
  const runs = ((manifest && manifest.stages && manifest.stages.S4 && manifest.stages.S4.runs) || [])
    .filter((r) => runDate(r.id) && (r.outputs || []).some((o) => o.endsWith('.svg')))
    .sort((a, b) => (runKey(a.id) < runKey(b.id) ? -1 : runKey(a.id) > runKey(b.id) ? 1 : 0));
  if (!runs.length) return { status: 'no-s4' };
  const after = runs[runs.length - 1];
  if (runDate(after.id) < scan) return { status: 'not-refreshed', after };
  const before = runs.filter((r) => runDate(r.id) < scan).pop();
  if (!before) return { status: 'no-before', after };
  return { status: 'ok', before, after };
}

/**
 * The newest S5 run in a manifest, by its own name rather than manifest order.
 * Here rather than in `stage_refresh.mjs`, which re-exports it, because `--staged`
 * asks the same question and this module must not import that one (it imports this).
 */
export function newestRender(manifest) {
  const runs = ((manifest && manifest.stages && manifest.stages.S5 && manifest.stages.S5.runs) || [])
    .filter((r) => runKey(r.id)).sort((a, b) => (runKey(a.id) < runKey(b.id) ? -1 : runKey(a.id) > runKey(b.id) ? 1 : 0));
  return runs.length ? runs[runs.length - 1] : null;
}

/**
 * Is this S5 run the render of that S4 build? NOT by id: S5 names its folder by
 * its own start minute, so Ramsey's v3.6 is `_1141` in S4 and `_1142` in S5. A
 * run that declares `basedOn.S4` is taken at its word; most do not, and for those
 * the build's version, which is never reused, is the join.
 */
const versionOf = (id) => (String(id || '').match(/^v(\d+(?:\.\d+)*)_/) || [])[1] || null;
export function isRenderOf(render, s4Id) {
  if (!render || !s4Id) return false;
  if (render.basedOn && render.basedOn.S4) return render.basedOn.S4 === s4Id;
  const v = render.version || versionOf(render.id);
  return !!v && v === versionOf(s4Id);
}

/**
 * Build the review. `io` is the disk:
 *   readGradeFiles(dir)  as refresh_grades.mjs's
 *   readManifest(mapDir) → object | null, or throws for a file that will not parse
 *   readSheet(file)      → text | null
 * `places` is `[{ name, dir }]`, `dir` relative to busesDir, already found by the
 * edge (`resolvePlaces`), so this core walks no folder.
 * Returns `{ schema, scan, maps: [...] }` or throws Refused.
 */
export function collect({ busesDir, scan, towns = [], places = [], io }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scan || ''))) throw new Refused(`--scan must be a date like 2026-10-01, not ${JSON.stringify(scan)}.`);
  const population = new Map();
  const grades = readGradeState({ busesDir, readGradeFiles: io.readGradeFiles });
  if (grades.status === 'ok' && grades.date === scan) {
    for (const g of Object.values(grades.towns)) if (g.grade === 'SAFE') population.set(g.town.toLowerCase(), { town: g.town, why: 'SAFE' });
  } else if (!towns.length && !places.length) {
    const said = grades.status === 'ok' ? `the newest grading is ${grades.date}` : `the grading is ${grades.status}${grades.why ? ` (${grades.why})` : ''}`;
    throw new Refused(`no grading for the ${scan} scan — ${said} — so there is no SAFE population to review. Name the maps with --town or --place, or run the monthly job so the grading and the scan are one run.`);
  }
  for (const t of towns) if (!population.has(t.toLowerCase())) population.set(t.toLowerCase(), { town: t, why: 'named' });
  for (const p of places) {
    const had = population.get(String(p.name).toLowerCase());
    if (had && had.kind !== 'place') throw new Refused(`${p.name} is a town in this review as well as a place map, and an answer is recorded by name — review the two in separate runs.`);
    if (!had) population.set(String(p.name).toLowerCase(), { town: p.name, why: 'named', kind: 'place', rel: String(p.dir).replace(/\\/g, '/') });
  }

  const maps = [];
  for (const { town, why, kind = 'area', rel = `Areas/${town}` } of [...population.values()].sort((a, b) => a.town.localeCompare(b.town))) {
    const mapDir = path.join(busesDir, rel);
    const entry = { map: town, kind, dir: rel, why, status: null, before: null, after: null, sheets: [], answer: null };
    /* One map's broken manifest is that map's status, not the end of the review (OA-633). */
    let manifest;
    try { manifest = io.readManifest(mapDir); } catch (e) { maps.push({ ...entry, status: 'unreadable', detail: e.message }); continue; }
    if (!manifest) { maps.push({ ...entry, status: 'unreadable', detail: 'no manifest.json' }); continue; }
    const picked = pickRuns(manifest, scan);
    entry.after = picked.after ? picked.after.id : null;
    if (picked.status !== 'ok') { maps.push({ ...entry, status: picked.status }); continue; }
    entry.before = picked.before.id;
    const names = [...new Set([...picked.after.outputs, ...picked.before.outputs].filter((o) => o.endsWith('.svg')))].sort();
    let missing = null;
    for (const sheet of names) {
      const inAfter = picked.after.outputs.includes(sheet), inBefore = picked.before.outputs.includes(sheet);
      const a = inAfter ? io.readSheet(path.join(mapDir, picked.after.dir, sheet)) : null;
      const b = inBefore ? io.readSheet(path.join(mapDir, picked.before.dir, sheet)) : null;
      /* A sheet the manifest lists and the disk does not hold is not "no change":
       * S4 folders are gitignored and pruned, and an absence read as sameness would
       * wave a sheet through that nobody compared. */
      if ((inAfter && a == null) || (inBefore && b == null)) { missing = sheet; break; }
      entry.sheets.push({ sheet, change: inkChange(b, a) });
    }
    if (missing) { maps.push({ ...entry, sheets: [], status: 'unreadable', detail: `${missing} is listed in the manifest and not on disk` }); continue; }
    entry.status = entry.sheets.some((s) => s.change) ? 'ink-moved' : 'no-ink';
    maps.push(entry);
  }
  return { schema: SCHEMA, tool: 'ink_review.mjs', scan, maps };
}

/**
 * The maps an earlier collection of this scan held because somebody NAMED them, as
 * `{ towns, places }` ready to pass to `collect()` beside this run's own names, so a
 * later collection cannot drop them. A SAFE town is not carried: the grading names it.
 */
export function carriedNames(prev) {
  const maps = prev && Array.isArray(prev.maps) ? prev.maps.filter((m) => m && m.why === 'named') : [];
  return {
    towns: maps.filter((m) => m.kind !== 'place').map((m) => m.map),
    places: maps.filter((m) => m.kind === 'place').map((m) => ({ name: m.map, dir: m.dir })),
  };
}

/** This run's names added to the carried ones; one map per name, this run's spelling and folder winning. */
export function withCarried(carried, towns, places) {
  const lc = (s) => String(s).toLowerCase();
  const placeNames = new Set(places.map((p) => lc(p.name)));
  const townNames = new Set(towns.map(lc));
  return {
    towns: [...carried.towns.filter((t) => !townNames.has(lc(t)) && !placeNames.has(lc(t))), ...towns],
    places: [...carried.places.filter((p) => !placeNames.has(lc(p.name)) && !townNames.has(lc(p.name))), ...places],
  };
}

/**
 * True when the build an answer was given against and the map's current build are
 * both on disk and every sheet is byte-identical after the stamp is neutralised —
 * the same picture, so the answer still describes it. False for everything else,
 * including a build or sheet the disk no longer holds: S4 folders are gitignored
 * and pruned, and a sheet nobody can read is not a sheet nobody changed.
 * `io` is `collect()`'s (`readManifest`, `readSheet`); it reads no clock.
 */
export function sameInkAsAnswered({ busesDir, entry, answeredId, io }) {
  if (!answeredId || !entry.after || !entry.dir) return false;
  if (answeredId === entry.after) return true;
  const mapDir = path.join(busesDir, entry.dir);
  const manifest = io.readManifest(mapDir);
  const runs = (manifest && manifest.stages && manifest.stages.S4 && manifest.stages.S4.runs) || [];
  const was = runs.find((r) => r.id === answeredId), now = runs.find((r) => r.id === entry.after);
  if (!was || !now) return false;
  const svgs = (r) => (r.outputs || []).filter((o) => o.endsWith('.svg')).sort();
  const names = svgs(now);
  if (!names.length || names.join('|') !== svgs(was).join('|')) return false;
  for (const sheet of names) {
    const a = io.readSheet(path.join(mapDir, was.dir, sheet)), b = io.readSheet(path.join(mapDir, now.dir, sheet));
    if (a == null || b == null || neutralise(a) !== neutralise(b)) return false;
  }
  return true;
}

/**
 * Carry the answers of an earlier collection forward. An answer survives when it
 * was given against the SAME build, or against an earlier build whose every sheet is
 * byte-identical to the current one after the stamp is neutralised (`carried` says
 * from which), and the map still needs one; otherwise it moves to `superseded` with
 * the reason, and the map is unanswered again. `ctx` is `{ busesDir, io }`; without
 * it only the same-build rule applies, which is what a caller with no disk gets.
 */
export function mergeAnswers(prev, next, ctx = null) {
  if (!prev || !Array.isArray(prev.maps)) return next;
  const old = new Map(prev.maps.map((m) => [m.map.toLowerCase(), m]));
  return { ...next, maps: next.maps.map((m) => {
    const p = old.get(m.map.toLowerCase());
    if (!p) return m;
    /* What was staged is carried whatever the build now is: `deliverable()` asks
     * whether it was THIS build, so a rebuilt map is deliverable again by itself. */
    m = { ...m, ...(p.staged ? { staged: p.staged } : {}), ...(p.stagedBefore ? { stagedBefore: p.stagedBefore } : {}) };
    /* A self-answer's reason for waiting is about one build, as an answer is. */
    if (p.selfCheck && p.selfCheck.after === m.after && m.status === 'ink-moved') m = { ...m, selfCheck: p.selfCheck };
    const superseded = [...(p.superseded || [])];
    if (p.answer) {
      if (m.status === 'ink-moved') {
        if (p.answer.after === m.after) return { ...m, answer: p.answer, superseded };
        if (ctx && sameInkAsAnswered({ busesDir: ctx.busesDir, entry: m, answeredId: p.answer.after, io: ctx.io })) {
          const from = (p.answer.carried && p.answer.carried.from) || p.answer.after;
          return { ...m, answer: { ...p.answer, after: m.after, carried: { from, why: `${m.after} is byte-identical to ${p.answer.after} on every sheet once the build stamp is neutralised` } }, superseded };
        }
      }
      superseded.push({ ...p.answer, why: p.answer.after !== m.after ? `rebuilt as ${m.after} after this answer` : `now ${m.status}` });
    }
    return superseded.length ? { ...m, superseded } : m;
  }) };
}

/**
 * Record Peter's answer for one map. `at` is passed in: the core reads no clock.
 * `engine` is what `ink_self_answer.mjs`'s `recordable()` made of this build's
 * range, the sightings a later self-answer stands on; null when it could not be read.
 */
export function answer(review, town, verdict, { by, note = null, at, engine = null }) {
  if (!VERDICTS.includes(verdict)) throw new Refused(`--verdict must be ${VERDICTS.join(' or ')}, not ${JSON.stringify(verdict)}.`);
  if (!by || typeof by !== 'string' || !by.trim()) throw new Refused('--by is required: an answer nobody gave is not an answer.');
  const i = review.maps.findIndex((m) => m.map.toLowerCase() === String(town || '').toLowerCase());
  if (i < 0) throw new Refused(`${town} is not in the ${review.scan} review; it holds ${review.maps.map((m) => m.map).join(', ') || 'nothing'}.`);
  const m = review.maps[i];
  if (m.status !== 'ink-moved') throw new Refused(`${m.map} is ${m.status}, not ink-moved, so there is nothing for a person to answer${m.status === 'no-ink' ? ' — its ink did not move and it is deliverable as it stands' : ''}.`);
  const superseded = [...(m.superseded || [])];
  if (m.answer) superseded.push({ ...m.answer, why: 'answered again' });
  const maps = [...review.maps];
  const { selfCheck, ...rest } = m;
  maps[i] = { ...rest, answer: { verdict, by: by.trim(), at, after: m.after, note, ...(engine ? { engine } : {}) }, ...(superseded.length ? { superseded } : {}) };
  return { ...review, maps };
}

/**
 * Record that `stage_refresh.mjs` staged this build with its customer (OA-428).
 * Staging emails them, so a build staged once is `staged` and never `deliver`
 * again; a later build of the same map is deliverable afresh.
 */
export function markStaged(review, town, { slug, by, at, notify }) {
  const i = review.maps.findIndex((m) => m.map.toLowerCase() === String(town || '').toLowerCase());
  if (i < 0) throw new Refused(`${town} is not in the ${review.scan} review.`);
  const m = review.maps[i];
  const stagedBefore = [...(m.stagedBefore || []), ...(m.staged ? [m.staged] : [])];
  const maps = [...review.maps];
  maps[i] = { ...m, staged: { after: m.after, slug, by, at, ...(notify ? { notify } : {}) }, ...(stagedBefore.length ? { stagedBefore } : {}) };
  return { ...review, maps };
}

/**
 * Record a staging made OUTSIDE `stage_refresh.mjs` (buses-data OA-573). On 5 Oct
 * Peter delivered St Ives Bus Station by hand as proposed update #171, because
 * stage_refresh then refused places, and the record never learnt of it — so
 * `--deliverable` kept naming the map under `deliver`, and the one thing between a
 * tick and a second proposal was this same record. The staging recorded is of the
 * review's `after` build, so it refuses unless the map's newest S5 render IS that
 * build: a hand delivery of a newer render is not the build the review compared,
 * and recording it against `after` would pass off one sheet as the other.
 *
 * `render` is the newest S5 run, read by the edge. `proposal` is the portal's
 * proposed-update number, kept so the record can be checked against the portal.
 * `notify` is `'digest'` only when the hand staging went with `--no-notify` and its
 * customer is still owed the round's email; left out, nothing is owed, as for a
 * staging that emailed its customer itself or one already accepted.
 */
export function recordStaged(review, town, { slug, proposal, by, at, render, notify }) {
  if (!review || !Array.isArray(review.maps)) throw new Refused('there is no ink review for this scan, so there is nothing to record a staging against.');
  if (!slug || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Refused(`--map must be the portal map's slug, not ${JSON.stringify(slug)}.`);
  if (!/^[1-9]\d*$/.test(String(proposal ?? ''))) throw new Refused(`--proposal must be the portal's proposed-update number, e.g. 171, not ${JSON.stringify(proposal)}.`);
  if (!by || typeof by !== 'string' || !by.trim()) throw new Refused('--by is required: a staging nobody recorded is not a record.');
  if (notify !== undefined && notify !== null && notify !== 'digest') throw new Refused(`--notify is "digest" or left out, not ${JSON.stringify(notify)}.`);
  const m = review.maps.find((x) => x.map.toLowerCase() === String(town || '').toLowerCase());
  if (!m) throw new Refused(`${town} is not in the ${review.scan} review; it holds ${review.maps.map((x) => x.map).join(', ') || 'nothing'}.`);
  if (m.staged && m.staged.after === m.after) throw new Refused(`${m.map} ${m.after} is already recorded as staged by ${m.staged.by} at ${m.staged.at}${m.staged.proposal ? ` (proposed update #${m.staged.proposal})` : ''}.`);
  if (!render) throw new Refused(`${m.map} has no S5 render in its manifest, so no staging of ${m.after} can have been made.`);
  if (!isRenderOf(render, m.after)) throw new Refused(`${m.map}'s newest render is ${render.id} and the review's build is ${m.after}, so a staging of the newest render is not a staging of the build the review compared — re-run ink_review.mjs --scan ${review.scan} first.`);
  const staged = markStaged(review, m.map, { slug, by: by.trim(), at, ...(notify ? { notify } : {}) });
  const maps = staged.maps.map((x) => (x.map === m.map ? { ...x, staged: { ...x.staged, proposal: Number(proposal), madeBy: 'hand' } } : x));
  return { ...staged, maps };
}

/** Record that the round's digest email went for these towns' current stagings (buses-data OA-152). */
export function markNotified(review, towns, { by, at }) {
  const want = new Set(towns.map((t) => String(t).toLowerCase()));
  const maps = review.maps.map((m) => (want.has(m.map.toLowerCase()) && m.staged ? { ...m, staged: { ...m.staged, notified: { by, at } } } : m));
  return { ...review, maps };
}

/** The gate OA-428's delivery step asks. Only `deliver` may be delivered. */
export function deliverable(review) {
  const out = { deliver: [], staged: [], waiting: [], held: [], other: [] };
  for (const m of review.maps) {
    if (m.staged && m.staged.after === m.after) out.staged.push(m.map);
    else if (m.status === 'no-ink') out.deliver.push(m.map);
    else if (m.status !== 'ink-moved') out.other.push(`${m.map} (${m.status})`);
    else if (!m.answer || m.answer.after !== m.after) out.waiting.push(m.map);
    else if (m.answer.verdict === 'accept') out.deliver.push(m.map);
    else out.held.push(m.map);
  }
  return out;
}

/**
 * The worklist's row for a review with maps WAITING on Peter's answer (buses-data,
 * 2026-10-14). The review is the one human touch the monthly refresh keeps, and until
 * this row nothing asked for it: on 2026-10-14 the 1 October review had held three maps
 * as `waiting` for a fortnight while no worklist row, board line or hold named them, and
 * an unanswered map is never delivered — and can lose the build it is compared against
 * to the pruner (OA-639). `deliverable()` decides `waiting`, so the row and the gate
 * cannot disagree about what is owed.
 *
 * `reviews` is `[{ scan, review, page }]`, as `readReviews()` gives it; `page` says
 * whether the gitignored crops page is on disk. A map that a LATER scan's review also
 * holds is that review's to ask about, so it is not asked twice. A record that will not
 * parse is a rank-0 row, because nothing is deliverable from it and silence is the
 * failure this row exists to end.
 */
export function waitingItems(reviews, { busesDir = '', assets = '', daysSince = () => null } = {}) {
  const out = [];
  const later = (i) => new Set(reviews.slice(i + 1).flatMap((r) => (r.review && Array.isArray(r.review.maps) ? r.review.maps.map((m) => m.map.toLowerCase()) : [])));
  reviews.forEach((r, i) => {
    const rel = `_gtfs/ink-review_${r.scan}.json`;
    if (!r.review || !Array.isArray(r.review.maps)) {
      out.push({
        key: `ink-review-unreadable-${r.scan}`, rank: 0, type: 'ink-review',
        title: `The ${r.scan} ink review will not parse`,
        why: `${rel} is not a review record, so nothing from that scan can be delivered and no map in it can be answered.`,
        who: 'Peter', runbook: 'R9',
        do: [{ kind: 'chat', what: `Open ${rel} and repair it, or re-collect it with ink_review.mjs --scan ${r.scan}.` }],
      });
      return;
    }
    const newer = later(i);
    const waiting = deliverable(r.review).waiting.filter((m) => !newer.has(m.toLowerCase()));
    if (!waiting.length) return;
    const pageRel = `loop/ink-review/${r.scan}/index.html`;
    const steps = [r.page
      ? { kind: 'chat', what: `Open ${busesDir ? path.join(busesDir, pageRel) : pageRel} in a browser (gitignored, so reach it through File Explorer in the main checkout) and look at the before-and-after of ${waiting.join(', ')}.` }
      : { kind: 'shell', cwd: assets, cmd: `node ink_review.mjs --scan ${r.scan}`, note: `the page is not on disk; this re-collects the record, commits it and rebuilds ${pageRel} with its crops` }];
    /* A map no session has yet tried by rule is offered to the rule first: Peter is asked only what it refuses. */
    const byMap = new Map(r.review.maps.map((m) => [m.map, m]));
    const untried = waiting.filter((m) => { const e = byMap.get(m); return !(e && e.selfCheck && e.selfCheck.after === e.after); });
    if (untried.length) steps.splice(r.page ? 0 : 1, 0, { kind: 'shell', cwd: assets, cmd: `node ink_review.mjs --scan ${r.scan} --self-answer --by <session> --apply`, note: `answers by rule what needs no person (${untried.join(', ')} not yet tried); <session> is the answering session's name` });
    steps.push({ kind: 'chat', what: 'Tell Claude "accept <map>" or "hold <map>, <why>" for each one; it records the answer with ink_review.mjs --answer, which commits the record itself.' });
    const reasons = waiting.map((m) => { const e = byMap.get(m); return e && e.selfCheck && e.selfCheck.after === e.after ? `${m}: ${e.selfCheck.reason}` : null; }).filter(Boolean);
    out.push({
      key: `ink-waiting-${r.scan}`, rank: 5, type: 'ink-review',
      title: `Ink review ${r.scan}: ${waiting.length} map${waiting.length === 1 ? '' : 's'} waiting for your accept or hold`,
      why: `${waiting.join(', ')} — a sheet's ink moved in the ${r.scan} refresh, and nothing reaches its customer until you have looked. An unanswered map is never delivered, and its before-build can be pruned from under it (OA-639).${reasons.length ? ` Not answerable by rule — ${reasons.join(' · ')}.` : ''}`,
      who: 'Peter', runbook: 'R9', ageDays: daysSince(r.scan),
      do: steps,
    });
  });
  return out;
}

/** Every `_gtfs/ink-review_<scan>.json`, oldest first; `review` is null for a file that will not parse. */
export function readReviews(busesDir) {
  const dir = path.join(busesDir, '_gtfs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => /^ink-review_(\d{4}-\d{2}-\d{2})\.json$/.exec(f)).filter(Boolean).map((m) => m[1]).sort()
    /* Lenient on purpose: the worklist reads every scan, and one broken file must not blank the board. */
    .map((scan) => ({ scan, review: (() => { try { return readJson(path.join(dir, `ink-review_${scan}.json`)); } catch { return null; } })(), page: existsSync(path.join(busesDir, 'loop', 'ink-review', scan, 'index.html')) }));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The page Peter reads. `crops` maps `<map>/<sheet>` to `{ pairs: [relPath], note }`. */
export function page(review, crops = {}) {
  const moved = review.maps.filter((m) => m.status === 'ink-moved');
  const quiet = review.maps.filter((m) => m.status === 'no-ink');
  const other = review.maps.filter((m) => m.status !== 'ink-moved' && m.status !== 'no-ink');
  const sec = moved.map((m) => {
    const ans = m.answer ? `<p class="ans">Answered <b>${esc(m.answer.verdict)}</b> by ${esc(m.answer.by)}${m.answer.self ? ' (by rule)' : ''}${m.answer.note ? ` — ${esc(m.answer.note)}` : ''}</p>`
      : `<p class="ans">Not answered yet.${m.selfCheck && m.selfCheck.after === m.after ? ` Not answerable by rule: ${esc(m.selfCheck.reason)}.` : ''}</p>`;
    const sheets = m.sheets.filter((s) => s.change).map((s) => {
      const c = crops[`${m.map}/${s.sheet}`] || {};
      const imgs = (c.pairs || []).map((p) => `<img src="${esc(p)}" alt="${esc(s.sheet)} before and after">`).join('');
      return `<h3>${esc(s.sheet)} — ${esc(s.change)}</h3>${c.note ? `<p>${esc(c.note)}</p>` : ''}${imgs}`;
    }).join('');
    return `<section><h2>${esc(m.map)}</h2><p>${esc(m.before)} → ${esc(m.after)}</p>${ans}${sheets}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ink review ${esc(review.scan)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1150px;margin:0 auto;padding:16px;background:#fff;color:#1c1f22}
img{max-width:100%;display:block;margin:8px 0 24px;border:1px solid #ccc}section{border-top:2px solid #1c1f22;margin-top:32px}.ans{font-weight:600}</style></head><body>
<h1>The ${esc(review.scan)} refresh: ${moved.length} map${moved.length === 1 ? '' : 's'} to look at</h1>
<p>Each map below had a sheet whose ink moved. Look at the before and after, then tell Claude <b>accept &lt;map&gt;</b> or <b>hold &lt;map&gt;</b>, with a reason if you are holding it. Nothing below is delivered to its customer until you have accepted it.</p>
${quiet.length ? `<p>Not shown, because not a mark on any sheet moved: ${quiet.map((m) => esc(m.map)).join(', ')}. These go ahead without you.</p>` : ''}
${other.length ? `<p>Not in this review: ${other.map((m) => `${esc(m.map)} (${esc(m.status)}${m.detail ? `: ${esc(m.detail)}` : ''})`).join(', ')}.</p>` : ''}
${sec}
</body></html>
`;
}

/* ------------------------------------------------------------------ the edge */

/**
 * A JSON file, or null when there is no such file. A file that IS there and does not
 * parse refuses, naming its path and the parse error (buses-data OA-633): on
 * 2026-10-12 Huntingdon's manifest.json carried an unescaped quote, this reader's
 * old catch-all turned it into null, and stage_refresh.mjs refused with "no S5
 * render in its manifest" while the render sat there. The same null here would
 * have let a collection overwrite a review file it could not read. `exists` and
 * `read` are injected for prove-red-stage-refresh.mjs.
 */
export function readJsonFile(f, { exists = existsSync, read = readFileSync } = {}) {
  if (!exists(f)) return null;
  const text = read(f, 'utf8');
  try { return JSON.parse(text); } catch (e) { throw new Refused(`${f} is there and is not valid JSON (${e.message}); repair it.`); }
}
const readJson = (f) => readJsonFile(f);

/**
 * `--place` names to `[{ name, dir }]`, matched against `found` (`[{ name, rel }]`,
 * what `diskPlaces` lists) so this tool and the board agree on what a place is.
 * An unknown or ambiguous name refuses, and says what the place maps are.
 */
export function resolvePlaces(names, found) {
  return names.map((n) => {
    const hit = found.filter((p) => p.name.toLowerCase() === String(n).toLowerCase());
    if (hit.length === 1) return { name: hit[0].name, dir: hit[0].rel };
    if (hit.length > 1) throw new Refused(`${n} names ${hit.length} place maps (${hit.map((p) => p.rel).join(', ')}), and this review records answers by name.`);
    throw new Refused(`no place map is named ${JSON.stringify(n)}; the place maps are ${found.map((p) => p.name).sort().join(', ') || 'none'}.`);
  });
}

/* Every place map on disk, found by the engine's own `gate_lib.findPlaces`, as the worklist finds them. */
function diskPlaces(busesDir) {
  const engine = assetsDir();
  if (!engine) throw new Refused('--place needs the engine assets folder, whose gate_lib.js finds the place maps, and it was not found.');
  const { findTowns, findPlaces } = createRequire(import.meta.url)(path.join(engine, 'gate_lib.js'));
  return findPlaces(findTowns(busesDir), busesDir).map((p) => ({ name: p.name, rel: path.relative(busesDir, p.dir).replace(/\\/g, '/') }));
}
export const diskIo = {
  readGradeFiles: defaultReadGradeFiles,
  readManifest: (dir) => readJson(path.join(dir, 'manifest.json')),
  readSheet: (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null),
};

function cropsFor(review, busesDir, outDir) {
  const engine = assetsDir();
  if (!engine) return { note: 'the engine assets folder was not found, so there are no crops' };
  const work = path.join(outDir, 'work');
  mkdirSync(work, { recursive: true });
  const crops = {};
  for (const m of review.maps.filter((x) => x.status === 'ink-moved')) {
    const mapDir = path.join(busesDir, m.dir);
    const man = diskIo.readManifest(mapDir);
    const runOf = (id) => man.stages.S4.runs.find((r) => r.id === id);
    for (const s of m.sheets.filter((x) => x.change === 'moved')) {
      const slug = `${m.map}_${s.sheet}`.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/\.svg$/, '');
      const pair = ['before', 'after'].map((side) => {
        const f = path.join(work, `${slug}_${side}.svg`);
        writeFileSync(f, neutralise(readFileSync(path.join(mapDir, runOf(m[side]).dir, s.sheet), 'utf8')));
        return f;
      });
      const res = spawnSync('node', [path.join(engine, 'crop_compare.js'), pair[0], pair[1], path.join(outDir, slug),
        '--diff', '3', '--json', '--label', `before (${m.before})|after (${m.after})`], { encoding: 'utf8' });
      let got = null;
      try { got = JSON.parse(String(res.stdout).trim().split('\n').pop()); } catch { /* reported below */ }
      crops[`${m.map}/${s.sheet}`] = !got ? { note: `the crop failed: ${String(res.stderr || res.stdout).trim().split('\n').pop()}` }
        : got.spots.length ? { pairs: got.pairs.map((p) => path.basename(p)) }
          : { note: `bytes moved and ${got.why || 'no pixel differs'} — worth a glance at the whole sheet` };
    }
  }
  return crops;
}

/* The real evidence for `ink_self_answer.mjs`: this estate's disk, the engine checkout's closures and its git. */
function evidenceSource(busesDir) {
  const sk = assetsDir();
  if (!sk) throw new Refused('the engine assets folder was not found, so no engine commit can be attributed to a sheet.');
  const engine = engineEdge(sk);
  const io = { ...diskIo, readInputs: diskInputs(engine.notInputs) };
  return (m, before, after) => gatherEvidence({ busesDir, entry: m, before, after, io, engine });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const busesDir = resolveBuses(args);
  const scan = typeof args.scan === 'string' ? args.scan : null;
  const file = path.join(busesDir, '_gtfs', `ink-review_${scan}.json`);
  const prev = readJson(file);

  if (typeof args.answer === 'string') {
    if (!prev) throw new Refused(`there is no review for ${scan} yet (${file}); collect it first.`);
    /* The sightings a later self-answer stands on. Best effort: an answer is Peter's whether or not they can be read. */
    const was = (prev.maps || []).find((x) => x.map.toLowerCase() === args.answer.toLowerCase());
    let engine = null;
    if (was && was.status === 'ink-moved') {
      try { engine = recordable(evidenceSource(busesDir)(was, was.before, was.after)); } catch { engine = null; }
      if (!engine) console.error(`ink_review: ${was.map}'s answer records no engine sightings (a build or its engineCommit could not be read), so it cannot vouch for an engine commit on another map.`);
    }
    const next = answer(prev, args.answer, args.verdict, { by: typeof args.by === 'string' ? args.by : '', note: typeof args.note === 'string' ? args.note : null, at: new Date().toISOString(), engine });
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    const m = next.maps.find((x) => x.map.toLowerCase() === args.answer.toLowerCase());
    console.log(`ink_review: ${m.map} ${m.answer.verdict} for ${m.after}, recorded in ${file}`);
    if (!args['no-commit'] && !reportCommit(commitRecord({ root: busesDir, file, subject: `ink-review: ${m.map} ${m.answer.verdict} for ${m.after}` }))) process.exitCode = 2;
    return;
  }
  if (args['self-answer']) {
    if (!prev) throw new Refused(`there is no review for ${scan} yet (${file}); collect it first.`);
    const by = typeof args.by === 'string' ? args.by.trim() : '';
    if (!by) throw new Refused('--by is required: a self-answer names the session that gave it.');
    const evidenceFor = evidenceSource(busesDir);
    const { review: filled, filled: n } = backfillEngine(prev, { evidenceFor });
    const reviews = readReviews(busesDir).map((r) => (r.scan === scan ? { scan, review: filled } : r));
    const { review: next, results } = selfAnswer(filled, { by, at: new Date().toISOString(), evidenceFor, register: registerFrom(reviews) });
    for (const r of results) console.log(`  ${r.outcome === 'accept' ? 'ACCEPT ' : 'WAITING'} ${r.map} — ${r.why}`);
    const acc = results.filter((r) => r.outcome === 'accept').length;
    const summary = `${acc} accepted by rule, ${results.length - acc} left for Peter${n ? `, ${n} earlier answer${n === 1 ? '' : 's'} given engine sightings` : ''}`;
    if (!results.length && !n) { console.log(`ink_review: ${scan} — no unanswered ink-moved map to try`); return; }
    if (!args.apply) { console.log(`ink_review: ${scan} — ${summary}. Dry run: nothing written; add --apply to record it.`); return; }
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    console.log(`ink_review: ${scan} — ${summary}, recorded in ${file}`);
    if (!args['no-commit'] && !reportCommit(commitRecord({ root: busesDir, file, subject: `ink-review: ${scan} self-answer by ${by} (${summary})` }))) process.exitCode = 2;
    return;
  }
  if (args.staged) {
    if (!prev) throw new Refused(`there is no review for ${scan} yet (${file}); collect it first.`);
    const town = typeof args.town === 'string' ? args.town : typeof args.place === 'string' ? args.place : '';
    const entry = prev.maps && prev.maps.find((x) => x.map.toLowerCase() === town.toLowerCase());
    const mapDir = entry ? path.join(busesDir, entry.dir === undefined ? path.join('Areas', entry.map) : entry.dir) : null;
    const render = mapDir ? newestRender(readJson(path.join(mapDir, 'manifest.json'))) : null;
    /* `--at` is when the staging was MADE, which a hand staging recorded later is not now. */
    const at = typeof args.at === 'string' ? args.at : new Date().toISOString();
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(at) || Number.isNaN(Date.parse(at))) throw new Refused(`--at must be a date such as 2026-10-05, not ${JSON.stringify(at)}.`);
    const next = recordStaged(prev, town, { slug: args.map, proposal: args.proposal, by: typeof args.by === 'string' ? args.by : '', at, render, notify: typeof args.notify === 'string' ? args.notify : undefined });
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    const m = next.maps.find((x) => x.map === entry.map);
    console.log(`ink_review: ${m.map} ${m.after} recorded as staged by hand, proposed update #${m.staged.proposal}${m.staged.notify ? ', its customer owed the digest' : ', no email owed'}, in ${file}`);
    if (!args['no-commit'] && !reportCommit(commitRecord({ root: busesDir, file, subject: `ink-review: ${m.map} ${m.after} recorded as staged by hand (proposed update #${m.staged.proposal})` }))) process.exitCode = 2;
    return;
  }
  if (args.deliverable) {
    if (!prev) throw new Refused(`there is no review for ${scan} (${file}), so nothing is deliverable.`);
    const d = deliverable(prev);
    if (args.json) { console.log(JSON.stringify({ scan, ...d })); return; }
    for (const k of ['deliver', 'staged', 'waiting', 'held', 'other']) console.log(`${k.padEnd(8)} ${d[k].join(', ') || '—'}`);
    return;
  }
  const list = (v) => (typeof v === 'string' ? v.split(',').map((t) => t.trim()).filter(Boolean) : []);
  const named = withCarried(carriedNames(prev), list(args.town),
    list(args.place).length ? resolvePlaces(list(args.place), diskPlaces(busesDir)) : []);
  const review = mergeAnswers(prev, collect({ busesDir, scan, towns: named.towns, places: named.places, io: diskIo }), { busesDir, io: diskIo });
  writeFileSync(file, JSON.stringify(review, null, 2) + '\n');
  const counts = ['ink-moved', 'no-ink'].map((s) => `${review.maps.filter((m) => m.status === s).length} ${s}`);
  const other = review.maps.filter((m) => m.status !== 'ink-moved' && m.status !== 'no-ink');
  console.log(`ink_review: ${scan} — ${counts.join(', ')}${other.length ? `, ${other.length} not reviewable (${other.map((m) => `${m.map}: ${m.status}`).join('; ')})` : ''}`);
  console.log(`  record: ${file}`);
  if (!args['no-commit'] && !reportCommit(commitRecord({ root: busesDir, file, subject: `ink-review: ${scan} record collected (${counts.join(', ')})` }))) process.exitCode = 2;
  if (args['no-crops']) return;
  const outDir = path.join(busesDir, 'loop', 'ink-review', scan);
  mkdirSync(outDir, { recursive: true });
  const crops = cropsFor(review, busesDir, outDir);
  writeFileSync(path.join(outDir, 'index.html'), page(review, crops.note ? {} : crops));
  console.log(`  page:   ${path.join(outDir, 'index.html')}${crops.note ? ` (${crops.note})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) {
    if (e instanceof Refused) { console.error(`ink_review: ${e.message}`); process.exit(2); }
    throw e;
  }
}
