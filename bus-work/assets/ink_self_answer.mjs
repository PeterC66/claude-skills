/*
 * ink_self_answer.mjs — answer the month's ink review BY RULE, and leave Peter only
 * what is controversial (buses-data, asked for on 2026-10-14; the review itself is
 * OA-429, and `ink_review.mjs --self-answer` is the command).
 *
 * WHY. The review asks Peter about every map whose ink moved. Most of a month's
 * moved maps are engine rollouts, not data: on 2026-10-14 Peter walked through ten
 * maps, and every note he left named an engine change (a place arrow, a leader
 * that stops at the badge rim, a footnote placed by search). He had usually seen
 * each change once already on another map. So a session may accept a map ITSELF
 * only when both of these hold, and leaves everything else `waiting` with a
 * one-line reason that says why it would not:
 *
 *   1. THE WORDS ARE THE SAME. Every `<text>`, `<title>` and `<desc>` string on each
 *      moved sheet, after decoding entities and neutralising the footer stamp, is
 *      on the before build too, as many times: service numbers, destinations, stop
 *      and street names, times, the services panel and the help text. Draw order
 *      and a re-wrapped line are not content (`textChange()` says why); a string
 *      added, dropped or altered by one character is.
 *   2. EVERY MOVED MARK HAS AN ENGINE COMMIT THAT PETER HAS ALREADY ACCEPTED ELSEWHERE.
 *      The build's inputs must be identical — the top-level `.json` files of the S4
 *      folder, minus the engine's own `NOT_INPUTS`, with `routes.json`'s provenance
 *      (`engine`, `engineCommit`, `version`, `design.sheetVersion`) set aside. If they
 *      differ, the change is data or hand config and no engine commit explains it.
 *      Then every claude-skills commit between the before and after builds' recorded
 *      `engineCommit` that touches the moved sheet's generator closure must have a
 *      FIRST SIGHTING: an answer from Peter (`--answer accept`, never a self-answer)
 *      on a DIFFERENT map, for the same kind of sheet, whose range held that commit.
 *      A commit Peter HELD on another map, with no later accept on that map, refuses.
 *
 * AN OA-437 ADOPTION COUNTS LIKE AN ENGINE COMMIT (buses-data OA-643, Peter's yes of
 * 2026-10-14). Three of the 1 October review's moved maps changed only because
 * `knob_adopt.mjs` adopted them: a typed `mapNotes` x/y became `near`, a dead
 * `legendAt` went. Such a change is not hand config, so when the routes.json
 * difference is ONLY that — each typed note keeping its words and losing its x/y
 * (and `w`), a `handPlaced` reason added, or a knob in `ADOPTED_KEYS` dropped, and
 * every other input file the same — each kind of adoption becomes a pseudo-commit
 * `adopt:<knob>` and needs its own first sighting on another map, exactly as a
 * commit does. So the first map to adopt stays Peter's. A per-map switch
 * (`strandedOnInk`, `exitInFrame`) or a moved typed coordinate is not an adoption
 * and still waits.
 *
 * WHERE THE SIGHTINGS ARE KEPT. On the answers themselves, in the tracked
 * `_gtfs/ink-review_<scan>.json` records: `--answer` writes `engine: { from, to,
 * commits: [{ sha, subject, kinds }] }` on every answer it records, and `kinds` holds
 * only the kinds of sheet that MOVED on that map. A commit is never credited to a
 * sheet it could not have changed there. The register is the union over every
 * record, superseded answers included, because Peter saw what he accepted even after
 * the map was rebuilt. `self: true` marks an answer this module gave, and such an
 * answer is never a sighting, so a rule cannot stand on its own earlier output.
 * `--self-answer --apply` backfills `engine` onto older answers that lack it, when
 * both builds are still on disk.
 *
 * WHAT THIS CANNOT SEE, said so the rule is not trusted past it. Attribution is by
 * commit and kind of sheet, not by pixel: a commit that drew one thing on the map
 * Peter accepted and something else on this one passes, if the words are unchanged.
 * The closure is read from the engine checkout this runs from, not from each
 * commit's own tree, so a file that has since left the closure is not asked about.
 * Both limits err only where rule 1 still holds, which is why rule 1 is first.
 *
 * KINDS. A sheet's kind is the map's kind and the sheet: `area:internal`,
 * `area:external`, `area:schematic`, `place:internal`, `place:external`,
 * `place:boarding`. A sheet with any other name has no rule and waits. A place
 * generator reaches the town skill by paths `requireClosure` does not follow, so its
 * closure adds the town closure of every town file it names in quotes.
 *
 * PURE CORE, INJECTED EDGE, like `ink_review.mjs`: `decide()`, `selfAnswer()`,
 * `backfillEngine()` and `registerFrom()` read no disk, no git and no clock;
 * `gatherEvidence()` takes its reads as `io` and `engine`, and `engineEdge()` and
 * `diskInputs()` are the real ones. `prove-red-ink-review.mjs` section 10 falsifies
 * each rule. Node core only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { neutralise, inkChange } from './ink_review.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});

/** Every text string a reader sees on a sheet, in document order, stamp neutralised. */
export function svgText(svg) {
  const out = [];
  for (const m of neutralise(String(svg)).matchAll(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const t = neutralise(decode(m[2].replace(/<[^>]*>/g, ''))).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * How the words on a sheet changed: null when the strings are identical in order;
 * otherwise `{ added, removed, reordered, rewrapped, changed }`, where `changed` is
 * the only thing the rule asks. DRAW ORDER IS NOT CONTENT: on 2026-10-14 three of
 * the month's maps moved a footnote or a landmark label later in the SVG, because
 * the engine now places it by search after the others, and every string was the
 * same. A RE-WRAP IS NOT CONTENT EITHER: when the strings that went and the strings
 * that came read as the same words in the same order once joined, only a line
 * break moved (Beaconsfield Simpson Centre's school footnote). Anything else, one
 * word included, is `changed`.
 */
export function textChange(before, after) {
  if (before.length === after.length && before.every((t, i) => t === after[i])) return null;
  const count = new Map();
  for (const t of before) count.set(t, (count.get(t) || 0) + 1);
  const added = [];
  for (const t of after) { const n = count.get(t) || 0; if (n) count.set(t, n - 1); else added.push(t); }
  const gone = new Map([...count].filter(([, n]) => n > 0));
  const removed = [];
  for (const t of before) { const n = gone.get(t) || 0; if (n) { removed.push(t); gone.set(t, n - 1); } }
  const words = (xs) => xs.join(' ').split(/\s+/).filter(Boolean).join(' ');
  const rewrapped = !!(added.length || removed.length) && words(added) === words(removed);
  return { added, removed, reordered: !added.length && !removed.length, rewrapped, changed: !!(added.length || removed.length) && !rewrapped };
}

const clip = (s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
const some = (xs) => xs.slice(0, 3).map((t) => JSON.stringify(clip(t))).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');
export function describeText(c) {
  if (!c.changed) return c.rewrapped ? 'the same words, wrapped differently' : 'the same words, drawn in a different order';
  return [c.added.length ? `added ${some(c.added)}` : '', c.removed.length ? `removed ${some(c.removed)}` : ''].filter(Boolean).join('; ');
}

/** routes.json without the provenance every build rewrites; any other input as it is. */
export const PROVENANCE = ['engine', 'engineCommit', 'version'];
export function normaliseInput(name, text) {
  if (name !== 'routes.json') return text;
  let j;
  try { j = JSON.parse(text); } catch { return text; }
  for (const k of PROVENANCE) delete j[k];
  if (j.design && typeof j.design.sheetVersion === 'string') j.design = { ...j.design, sheetVersion: neutralise(j.design.sheetVersion) };
  return j;
}

/** The inputs that differ, as short phrases: `osm.json`, `routes.json (mapNotes)`, `+new.json`. */
export function inputChange(before, after) {
  const out = [];
  for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!(name in before)) { out.push(`+${name}`); continue; }
    if (!(name in after)) { out.push(`-${name}`); continue; }
    const a = normaliseInput(name, before[name]), b = normaliseInput(name, after[name]);
    if (typeof a === 'object' && typeof b === 'object') {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (keys.length) out.push(`${name} (${keys.join(', ')})`);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(name);
  }
  return out;
}

/*
 * The knobs an OA-437 adoption drops, as paths into routes.json: `knob_adopt.mjs`'s
 * TOP keys and the two `design.howToUse` ones. Dropping one is an adoption; adding
 * or changing one is not.
 */
export const ADOPTED_KEYS = ['legendAt', 'legendWrap', 'badgeOffset', 'externalNoteAt', 'design.howToUse.width', 'design.howToUse.bullets'];
const NOTE_PLACE = ['x', 'y', 'w', 'near', 'handPlaced'];
const getAt = (o, p) => p.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
const dropAt = (o, p) => {
  const ks = p.split('.'), last = ks.pop();
  const parent = ks.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
  if (parent && typeof parent === 'object') delete parent[last];
};
const without = (o, ks) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));

/** How one note changed, as an adoption label, '' for no ink change, or null when it is not an adoption. */
function noteAdoption(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
  if (JSON.stringify(without(a, NOTE_PLACE)) !== JSON.stringify(without(b, NOTE_PLACE))) return null;
  const typed = (n) => 'x' in n || 'y' in n;
  if (typed(a) && !typed(b) && !('at' in a) && !('w' in b)) return 'mapNotes.near';
  /* A `handPlaced` reason added to a note that keeps its typed place is a decision, and moves no ink. */
  if (typeof b.handPlaced === 'string' && b.handPlaced.trim() && JSON.stringify(without(a, ['handPlaced'])) === JSON.stringify(without(b, ['handPlaced']))) return '';
  return null;
}

/**
 * The OA-437 adoptions that are the WHOLE of an input change, as sorted labels
 * (`mapNotes.near`, `legendAt`), or null when anything else changed too. `[]` means
 * the inputs changed in no way that moves ink — only a `handPlaced` reason — or not at all.
 */
export function adoptionChange(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (names.some((n) => n !== 'routes.json' && before[n] !== after[n])) return null;
  if (!('routes.json' in before) || !('routes.json' in after)) return before['routes.json'] === after['routes.json'] ? [] : null;
  const a = normaliseInput('routes.json', before['routes.json']), b = normaliseInput('routes.json', after['routes.json']);
  if (typeof a !== 'object' || typeof b !== 'object') return JSON.stringify(a) === JSON.stringify(b) ? [] : null;
  const ca = structuredClone(a), cb = structuredClone(b);
  const labels = new Set();
  for (const p of ADOPTED_KEYS) {
    const va = getAt(a, p), vb = getAt(b, p);
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    if (va === undefined || vb !== undefined) return null;
    labels.add(p);
    dropAt(ca, p);
  }
  const na = Array.isArray(a.mapNotes) ? a.mapNotes : null, nb = Array.isArray(b.mapNotes) ? b.mapNotes : null;
  if (JSON.stringify(na) !== JSON.stringify(nb)) {
    if (!na || !nb || na.length !== nb.length) return null;
    for (let i = 0; i < na.length; i++) {
      const l = noteAdoption(na[i], nb[i]);
      if (l == null) return null;
      if (l) labels.add(l);
    }
    delete ca.mapNotes; delete cb.mapNotes;
  }
  /* An empty object left behind by the last dropped key is not a change. */
  const tidy = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && k && !Object.keys(v).length ? undefined : v));
  return tidy(ca) === tidy(cb) ? [...labels].sort() : null;
}
const ADOPT = 'adopt:';
const adoptCommit = (label) => ({ sha: `${ADOPT}${label}`, subject: `OA-437 adoption of ${label}` });

const SHEET_KINDS = { 'internal.svg': 'internal', 'external.svg': 'external', 'internal-schematic.svg': 'schematic', 'boarding.svg': 'boarding' };
export const KINDS = ['area:internal', 'area:external', 'area:schematic', 'place:internal', 'place:external', 'place:boarding'];
/** `area:internal` and the like, or null for a sheet no rule covers. */
export function sheetKind(mapKind, sheet) {
  const k = `${mapKind === 'place' ? 'place' : 'area'}:${SHEET_KINDS[sheet] || '?'}`;
  return KINDS.includes(k) ? k : null;
}

const engineCommitOf = (text) => { try { const j = JSON.parse(text); return typeof j.engineCommit === 'string' && /^[0-9a-f]{7,40}$/.test(j.engineCommit) ? j.engineCommit : null; } catch { return null; } };
const unknown = (why) => ({ status: 'unknown', why });

/**
 * What the rule needs about one map between two of its S4 builds. `io` is
 * `{ readManifest(mapDir), readSheet(file), readInputs(runDir) → { name: text } }`;
 * `engine` is `{ commitsIn(from, to, kind) → { status: 'ok', commits: [{ sha, subject }] } | { status, why } }`.
 */
export function gatherEvidence({ busesDir, entry, before, after, io, engine }) {
  const mapDir = path.join(busesDir, entry.dir || path.join('Areas', entry.map));
  const runs = (io.readManifest(mapDir)?.stages?.S4?.runs) || [];
  const b = runs.find((r) => r.id === before), a = runs.find((r) => r.id === after);
  if (!before || !b) return unknown(`the before build ${before || '(none)'} is not in the manifest`);
  if (!after || !a) return unknown(`the after build ${after || '(none)'} is not in the manifest`);
  const svgs = (r) => (r.outputs || []).filter((o) => o.endsWith('.svg'));
  const sheets = [];
  for (const sheet of [...new Set([...svgs(a), ...svgs(b)])].sort()) {
    const tb = svgs(b).includes(sheet) ? io.readSheet(path.join(mapDir, b.dir, sheet)) : null;
    const ta = svgs(a).includes(sheet) ? io.readSheet(path.join(mapDir, a.dir, sheet)) : null;
    if ((svgs(b).includes(sheet) && tb == null) || (svgs(a).includes(sheet) && ta == null)) return unknown(`${sheet} is listed in the manifest and not on disk`);
    const change = inkChange(tb, ta);
    sheets.push({ sheet, change, kind: sheetKind(entry.kind, sheet), text: change === 'moved' ? textChange(svgText(tb), svgText(ta)) : null });
  }
  const ib = io.readInputs(path.join(mapDir, b.dir)), ia = io.readInputs(path.join(mapDir, a.dir));
  const from = ib['routes.json'] != null ? engineCommitOf(ib['routes.json']) : null;
  const to = ia['routes.json'] != null ? engineCommitOf(ia['routes.json']) : null;
  if (!from) return unknown(`the before build ${before} records no engineCommit${ib['routes.json'] == null ? ' (its S4 folder holds no routes.json)' : ''}, so no engine commit can be named`);
  if (!to) return unknown(`the after build ${after} records no engineCommit, so no engine commit can be named`);
  const inputs = inputChange(ib, ia);
  const adopted = inputs.length ? adoptionChange(ib, ia) : [];
  const byKind = {};
  for (const kind of new Set(sheets.filter((s) => s.change === 'moved' && s.kind).map((s) => s.kind))) {
    const r = engine.commitsIn(from, to, kind);
    if (r.status !== 'ok') return unknown(r.why);
    /* An adoption is credited to every kind that moved, like a commit: Peter's accept elsewhere must have seen it on that kind. */
    byKind[kind] = [...r.commits, ...(adopted || []).map(adoptCommit)];
  }
  return { status: 'ok', from, to, sheets, inputs, adopted, byKind };
}

/** What an answer records as its sightings: each commit, with the kinds of sheet that MOVED and that it touches. */
export function recordable(ev) {
  if (!ev || ev.status !== 'ok') return null;
  const by = new Map();
  for (const [kind, commits] of Object.entries(ev.byKind)) for (const c of commits) {
    const e = by.get(c.sha) || { sha: c.sha, subject: c.subject, kinds: [] };
    e.kinds.push(kind);
    by.set(c.sha, e);
  }
  return { from: ev.from, to: ev.to, commits: [...by.values()].map((c) => ({ ...c, kinds: c.kinds.sort() })) };
}

/**
 * The first-sighting register from `[{ scan, review }]`: every answer that is not a
 * self-answer and carries `engine.commits`, current or superseded, one row per
 * commit and kind.
 */
export function registerFrom(reviews) {
  const rows = [];
  for (const { scan, review } of reviews) {
    for (const m of (review && Array.isArray(review.maps) ? review.maps : [])) {
      for (const a of [m.answer, ...(m.superseded || [])]) {
        if (!a || a.self || !a.engine || !Array.isArray(a.engine.commits)) continue;
        for (const c of a.engine.commits) for (const kind of c.kinds || []) {
          rows.push({ sha: c.sha, kind, map: m.map, scan, after: a.after, by: a.by, at: a.at || '', verdict: a.verdict });
        }
      }
    }
  }
  return rows;
}

const short = (sha) => (String(sha).startsWith(ADOPT) ? String(sha) : String(sha).slice(0, 7));

/** `{ verdict: 'accept', note, attributed }` or `{ verdict: 'waiting', reason }`. */
export function decide({ entry, evidence, register }) {
  const wait = (reason) => ({ verdict: 'waiting', reason });
  if (!evidence || evidence.status !== 'ok') return wait(evidence ? evidence.why : 'no evidence was gathered');
  const odd = evidence.sheets.find((s) => s.change && s.change !== 'moved');
  if (odd) return wait(`${odd.sheet} is ${odd.change}, and a sheet added or dropped is not a rollout`);
  const moved = evidence.sheets.filter((s) => s.change === 'moved');
  if (!moved.length) return wait('no sheet moved between these builds, so there is nothing to attribute');
  const worded = moved.find((s) => s.text && s.text.changed);
  if (worded) return wait(`the text on ${worded.sheet} changed: ${describeText(worded.text)}`);
  if (evidence.inputs.length && !evidence.adopted) return wait(`the build's inputs changed — ${evidence.inputs.join(', ')} — and neither an engine commit nor an OA-437 adoption explains that change`);
  const other = (r) => r.map.toLowerCase() !== String(entry.map).toLowerCase();
  const attributed = [];
  for (const s of moved) {
    if (!s.kind) return wait(`${s.sheet} moved, and no rule covers a sheet of that name`);
    const commits = evidence.byKind[s.kind] || [];
    if (!commits.length) return wait(`${s.sheet} moved with no OA-437 adoption and no engine commit touching its generator between ${short(evidence.from)} and ${short(evidence.to)}, so nothing explains it`);
    for (const c of commits) {
      const rows = register.filter((r) => r.sha === c.sha && r.kind === s.kind && other(r));
      const held = rows.find((r) => r.verdict === 'hold' && !rows.some((x) => x.verdict === 'accept' && x.map === r.map && x.at > r.at));
      if (held) return wait(`${short(c.sha)} "${clip(c.subject || '')}" was held on ${held.map} by ${held.by}`);
      const seen = rows.find((r) => r.verdict === 'accept');
      if (!seen) return wait(`${short(c.sha)} "${clip(c.subject || '')}" moves ${s.kind} ink and Peter has not accepted it on another map`);
      if (!attributed.some((x) => x.sha === c.sha)) attributed.push({ sha: c.sha, map: seen.map, by: seen.by });
    }
  }
  const quiet = moved.filter((s) => s.text).map((s) => `${s.sheet}: ${describeText(s.text)}`);
  const ins = evidence.inputs.length ? `the inputs differ only by the OA-437 adoption of ${(evidence.adopted || []).join(', ') || 'a handPlaced reason'}` : 'the inputs are unchanged';
  const note = `answered by rule: the text is unchanged on ${moved.map((s) => s.sheet).join(', ')}${quiet.length ? ` (${quiet.join('; ')})` : ''}, ${ins}, and the ink is ${attributed.map((x) => `${short(x.sha)} (accepted on ${x.map} by ${x.by})`).join(', ')}`;
  return { verdict: 'accept', note, attributed };
}

/**
 * Write `engine` onto every answer in this review that lacks it and is not a
 * self-answer, where `evidenceFor(entry, before, after)` can still read both builds.
 * Returns `{ review, filled }`.
 */
export function backfillEngine(review, { evidenceFor }) {
  let filled = 0;
  const fill = (m, a) => {
    if (!a || a.self || a.engine) return a;
    const rec = recordable(evidenceFor(m, m.before, a.after));
    if (!rec) return a;
    filled++;
    return { ...a, engine: rec };
  };
  const maps = review.maps.map((m) => {
    if (m.status !== 'ink-moved') return m;
    const next = { ...m, answer: fill(m, m.answer) };
    if (Array.isArray(m.superseded)) next.superseded = m.superseded.map((a) => fill(m, a));
    return next;
  });
  return { review: { ...review, maps }, filled };
}

/**
 * The pass itself. Every ink-moved map with no answer for its current build is
 * either accepted (`self: true`, with the note and its sightings) or given
 * `selfCheck: { by, at, after, reason }` and left waiting. `register` is the rows
 * from `registerFrom()`; `at` is passed in, the core reads no clock.
 */
export function selfAnswer(review, { by, at, evidenceFor, register }) {
  if (!by || typeof by !== 'string' || !by.trim()) throw new Error('--by is required: a self-answer names the session that gave it.');
  const results = [];
  const maps = review.maps.map((m) => {
    if (m.status !== 'ink-moved' || (m.answer && m.answer.after === m.after)) return m;
    const ev = evidenceFor(m, m.before, m.after);
    const d = decide({ entry: m, evidence: ev, register });
    results.push({ map: m.map, outcome: d.verdict, why: d.verdict === 'accept' ? d.note : d.reason });
    if (d.verdict !== 'accept') return { ...m, selfCheck: { by: by.trim(), at, after: m.after, reason: d.reason } };
    const superseded = [...(m.superseded || []), ...(m.answer ? [{ ...m.answer, why: `rebuilt as ${m.after} after this answer` }] : [])];
    const { selfCheck, ...rest } = m;
    return { ...rest, answer: { verdict: 'accept', by: by.trim(), at, after: m.after, note: d.note, self: true, engine: recordable(ev) }, ...(superseded.length ? { superseded } : {}) };
  });
  return { review: { ...review, maps }, results };
}

/* ------------------------------------------------------------------ the edge */

/** `readInputs` for `gatherEvidence`: the top-level `.json` files of a run folder, minus the engine's `NOT_INPUTS`. */
export function diskInputs(notInputs) {
  return (runDir) => {
    const out = {};
    if (!existsSync(runDir)) return out;
    for (const f of readdirSync(runDir)) {
      if (!f.endsWith('.json') || notInputs.has(f)) continue;
      const p = path.join(runDir, f);
      if (statSync(p).isFile()) out[f] = readFileSync(p, 'utf8');
    }
    return out;
  };
}

/**
 * The real engine: per-kind closures from `engine_version.js`, as paths in the
 * claude-skills repository, and `git log` between two engine commits over them.
 * `sk` is `make-bus-leaflet/assets` (from `engine.mjs`'s `assetsDir()`).
 */
export function engineEdge(sk) {
  const req = createRequire(import.meta.url);
  const ev = req(path.join(sk, 'engine_version.js'));
  const { NOT_INPUTS } = req(path.join(sk, 'engine_paths.js'));
  const psk = ev.placeAssetsDir(sk);
  const root = path.resolve(sk, '..', '..');
  const relA = (f) => `make-bus-leaflet/assets/${f}`, relP = (f) => `make-place-bus-leaflet/assets/${f}`;
  const town = (entries) => (entries.length ? ev.requireClosure(sk, entries) : []);
  const crossSeeds = (files) => {
    const seeds = new Set();
    for (const f of files) {
      const p = path.join(psk, f);
      if (!existsSync(p)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/['"]([A-Za-z0-9_]+\.js)['"]/g)) if (existsSync(path.join(sk, m[1]))) seeds.add(m[1]);
    }
    return [...seeds].sort();
  };
  const place = (entry) => { const local = ev.requireClosure(psk, [entry]); return [...local.map(relP), ...town(crossSeeds(local)).map(relA)]; };
  const closures = {
    'area:internal': () => town(['gen_internal.js']).map(relA),
    'area:external': () => town(['gen_external_radial.js']).map(relA),
    'area:schematic': () => town(['gen_internal.js', 'schematize_internal.js', 'diagram_internal.js']).map(relA),
    'place:internal': () => place('gen_internal_place.js'),
    'place:external': () => place('gen_external_places.js'),
    'place:boarding': () => town(['gen_boarding.js']).map(relA),
  };
  const memo = new Map();
  const closureFor = (kind) => { if (!memo.has(kind)) memo.set(kind, closures[kind]()); return memo.get(kind); };
  const git = (argv) => { const r = spawnSync('git', ['-C', root, ...argv], { encoding: 'utf8' }); return { status: r.status, out: String(r.stdout || '') }; };
  const commitsIn = (from, to, kind) => {
    if (from === to) return { status: 'ok', commits: [] };
    for (const c of [from, to]) if (git(['cat-file', '-e', `${c}^{commit}`]).status !== 0) return { status: 'unknown', why: `engine commit ${short(c)} is not in the claude-skills clone at ${root}` };
    if (git(['merge-base', '--is-ancestor', from, to]).status !== 0) return { status: 'unknown', why: `the after build's engine ${short(to)} does not descend from the before build's ${short(from)}, so the commits between them are not a range` };
    const paths = closureFor(kind);
    if (!paths.length) return { status: 'unknown', why: `no generator closure was found for ${kind}` };
    const r = git(['log', '--no-merges', '--format=%H%x09%s', `${from}..${to}`, '--', ...paths]);
    if (r.status !== 0) return { status: 'unknown', why: `git log ${short(from)}..${short(to)} failed in ${root}` };
    return { status: 'ok', commits: r.out.split('\n').filter(Boolean).map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; }) };
  };
  return { commitsIn, closureFor, notInputs: NOT_INPUTS };
}
