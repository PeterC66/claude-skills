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
 * and still waits. A note's `handPlaced` reason and its `fact`/`factWords` tags
 * (OA-648, `NOTE_TAGS`) move no ink at all, so they need no sighting and compose with
 * an adoption or a ruling: Godmanchester Co-op Cambridge Road waited on the 1 October
 * review, with Peter's ruling of its route 101 line recorded, only because three of its
 * notes had gained a fact tag since the build he last accepted (buses-data 28b77796).
 * The generator closure is not asked whether it reads those tags, so a generator that
 * starts drawing from them must take them out of `NOTE_TAGS`.
 *
 * A RULING PETER GAVE COVERS THE WORDS IT NAMES (buses-data OA-659, Peter, 2026-10-20).
 * On 19 October Peter ruled two "via" descriptions on the Beaconsfield place maps
 * (buses-data 3c4b5a87), and on the 20th he was asked to accept the very line he had
 * ruled, because rule 1 refuses any changed word and rule 2 any changed input. So a
 * ruling is now recorded where the rebuild records its config, as a field on the S3
 * run in `manifest.json`:
 *
 *     "ruling": { "by": "peter", "on": "2026-10-19", "said": "<his words>",
 *                 "where": "<commit or thread>", "set": { "internalDesc.31": "<the value>" } }
 *
 * `set` maps a routes.json path to the value he ruled, and `ink_review.mjs --rule`
 * writes it, reading each value from that S3 run's own routes.json so it cannot be
 * mistyped. Every ruling on an S3 run after the before build's and up to the after
 * build's `basedOn.S3` is read. A ruled path whose value in the after build is still
 * the ruled one is set aside from rule 2's input comparison, so the rest must still be
 * unchanged or an adoption. Rule 1 then sets aside every added string that is part of a
 * ruled value and every removed string that is part of what that path held before,
 * and what remains must be the same words, re-wrapped or reordered at most. A sheet
 * whose words the ruling touched counts as explained by it, so a ruling-only rebuild on
 * an unchanged engine is accepted. Anything else still waits: a ruled path changed
 * again later, a ruling not by Peter or without his words, an unruled string beside the
 * ruled one, or a sheet that moved where no ruled word is. A ruling explains WORDS and
 * not marks, so a ruled colour or coordinate does not explain the ink it moves. Nor is a
 * part-string test exact: an added string that happens to be part of a ruled value
 * (one place name, say) passes wherever it is drawn.
 *
 * A DELIVERY PETER QUEUED HIMSELF IS HIS ACCEPT (same OA). `adhoc/ready/` is his
 * in-tray, so a file there, or in `doing/` or `done/`, holding a sentence that starts
 * "Deliver" and names this map with the after build, is his accept of that build. The
 * build is named either by its full id or as `<map> v<version>`, and the version only
 * counts when exactly one S4 run in the manifest carries it. Only the prompt counts,
 * which is the text above a `## TAKEN` or `## DECLINED` section, because a run's own
 * report is not Peter's. "Don't deliver" does not start with "Deliver", and a build
 * named before a later rebuild names the old build and not the new one. The answer is
 * recorded with `self: true` and `basis: 'delivery'`, quoting the sentence and the
 * file, because `adhoc/` is gitignored and the quote is the only lasting record of it.
 * It is not a sighting, because Peter named a build and did not look at its ink.
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
const setAt = (o, p, v) => {
  const ks = p.split('.'), last = ks.pop();
  let cur = o;
  for (const k of ks) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[last] = structuredClone(v);
};
const without = (o, ks) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));

/*
 * The tags on a note that no generator reads: `fact` joins a line to the register and
 * `factWords` says why it keeps its own words (OA-648), and only `fact_notes.js --check`
 * and `knob_adopt.mjs` read them. Set aside on the note and on each `then` paragraph.
 */
export const NOTE_TAGS = ['fact', 'factWords'];
const untag = (n) => (n && typeof n === 'object' && !Array.isArray(n)
  ? Object.fromEntries(Object.entries(n).filter(([k]) => !NOTE_TAGS.includes(k)).map(([k, v]) => [k, k === 'then' && Array.isArray(v) ? v.map(untag) : v]))
  : n);

/** How one note changed, as an adoption label, '' for no ink change, or null when it is not an adoption. */
function noteAdoption(a0, b0) {
  if (JSON.stringify(a0) === JSON.stringify(b0)) return '';
  if (!a0 || !b0 || typeof a0 !== 'object' || typeof b0 !== 'object') return null;
  /* A fact tag added, changed or dropped moves no ink, so it composes with a handPlaced reason or a ruling. */
  const a = untag(a0), b = untag(b0);
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
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

/* ------------------------------------------------------------------ rulings (OA-659) */

/** A ruling the rule may stand on, or a reason it may not. */
export function rulingProblem(r) {
  if (!r || typeof r !== 'object') return 'it is not an object';
  if (String(r.by || '').trim().toLowerCase() !== 'peter') return `it is by ${JSON.stringify(r.by ?? null)}, and only Peter rules`;
  if (typeof r.said !== 'string' || !r.said.trim()) return 'it does not quote what Peter said';
  if (!r.set || typeof r.set !== 'object' || Array.isArray(r.set) || !Object.keys(r.set).length) return 'it sets no path';
  return null;
}

/** The rulings on S3 runs after the before build's S3 and up to the after build's, oldest first. */
export function rulingsBetween(manifest, b, a) {
  const lo = (b && b.basedOn && b.basedOn.S3) || '', hi = a && a.basedOn && a.basedOn.S3;
  if (!hi || hi === lo) return [];
  return ((manifest && manifest.stages && manifest.stages.S3 && manifest.stages.S3.runs) || [])
    .filter((r) => r && r.ruling && r.id > lo && r.id <= hi)
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .map((r) => ({ s3: r.id, ...r.ruling }));
}

const leaves = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : []);

/**
 * Set the ruled paths aside from two routes.json texts. Returns `{ before, after, ruled }`,
 * where `before` is the before text with each ruled path given its ruled value (so rule 2
 * no longer sees it) and `ruled` is `{ paths, rulings, to, from, refused }`: the ruled
 * strings, the strings they replaced, and a phrase for each ruling or path that could not
 * be used. The LATEST ruling of a path wins, and the after build must still hold it.
 */
export function applyRulings(beforeText, afterText, rulings) {
  const ruled = { paths: [], rulings: [], to: [], from: [], refused: [] };
  if (!rulings.length) return { before: beforeText, after: afterText, ruled };
  let b, a;
  try { b = JSON.parse(beforeText); a = JSON.parse(afterText); } catch { ruled.refused.push('routes.json could not be read'); return { before: beforeText, after: afterText, ruled }; }
  const latest = new Map();
  for (const r of rulings) {
    const why = rulingProblem(r);
    if (why) { ruled.refused.push(`the ruling on S3 ${r.s3} is not used, because ${why}`); continue; }
    for (const [p, v] of Object.entries(r.set)) latest.set(p, { v, r });
  }
  const masked = structuredClone(b);
  for (const [p, { v, r }] of latest) {
    if (JSON.stringify(getAt(a, p)) !== JSON.stringify(v)) { ruled.refused.push(`${p} in the after build is not what Peter ruled on S3 ${r.s3}`); continue; }
    ruled.from.push(...leaves(getAt(b, p)));
    ruled.to.push(...leaves(v));
    setAt(masked, p, v);
    ruled.paths.push(p);
    if (!ruled.rulings.includes(r)) ruled.rulings.push(r);
  }
  return { before: ruled.paths.length ? JSON.stringify(masked) : beforeText, after: afterText, ruled };
}

/**
 * A text change with the ruled words set aside: every added string that is part of a
 * ruled value and every removed string that is part of what a ruled path held. `touched`
 * says whether any were; `changed` is recomputed on what remains, re-wrap included.
 */
export function ruledTextChange(change, ruled) {
  if (!change || !ruled || !ruled.paths.length) return change;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const partOf = (t, xs) => xs.some((x) => norm(x).includes(norm(t)));
  const added = change.added.filter((t) => !partOf(t, ruled.to)), removed = change.removed.filter((t) => !partOf(t, ruled.from));
  const touched = added.length < change.added.length || removed.length < change.removed.length;
  if (!touched) return { ...change, touched };
  const words = (xs) => xs.join(' ').split(/\s+/).filter(Boolean).join(' ');
  const rewrapped = !!(added.length || removed.length) && words(added) === words(removed);
  return { added, removed, reordered: change.reordered, rewrapped, changed: !!(added.length || removed.length) && !rewrapped, touched };
}

/* ------------------------------------------------------------------ deliveries Peter queued (OA-659) */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versionOf = (r) => (r && typeof r.version === 'string' ? r.version : (/^v(\d+(?:\.\d+)*)_/.exec((r && r.id) || '') || [])[1] || null);

/**
 * The sentence in an ad-hoc prompt that orders this map's after build delivered, or
 * null. `s4runs` is the map's manifest S4 runs. Only the text above `## TAKEN` or
 * `## DECLINED` is read, and only a sentence that starts "Deliver".
 */
export function deliveryOrder(text, entry, s4runs) {
  const prompt = String(text || '').split(/^##\s+(?:TAKEN|DECLINED)\b/m)[0];
  const id = entry && entry.after;
  if (!id) return null;
  const ver = versionOf((s4runs || []).find((r) => r.id === id) || { id });
  const unique = !!ver && (s4runs || []).filter((r) => versionOf(r) === ver).length === 1;
  const named = new RegExp(`${esc(entry.map)}\\s+v${esc(ver)}(?![0-9]|\\.[0-9])`, 'gi');
  /* The name must follow "Deliver", a comma, "and", "both", "the" or "also", so "Old Beaconsfield v2.13" is not "Beaconsfield v2.13". */
  const lead = /(?:^\s*(?:please\s+)?deliver|,|\band|\bboth|\bthe|\balso)\s+$/i;
  for (const s of prompt.split(/(?<=[.!?])\s+|\n+/)) {
    if (!/^\s*(?:please\s+)?deliver\b/i.test(s)) continue;
    if (s.includes(id)) return s.trim();
    if (!unique) continue;
    for (const m of s.matchAll(named)) if (lead.test(s.slice(0, m.index))) return s.trim();
  }
  return null;
}

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
  const manifest = io.readManifest(mapDir);
  const runs = (manifest?.stages?.S4?.runs) || [];
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
  const ib0 = io.readInputs(path.join(mapDir, b.dir)), ia = io.readInputs(path.join(mapDir, a.dir));
  /* A ruling of Peter's is set aside from the inputs here and from the words in `decide()`. */
  const rulings = rulingsBetween(manifest, b, a);
  const masked = ib0['routes.json'] != null && ia['routes.json'] != null ? applyRulings(ib0['routes.json'], ia['routes.json'], rulings) : applyRulings('', '', []);
  if (rulings.length && ib0['routes.json'] == null) masked.ruled.refused.push('the before build holds no routes.json, so no ruled path can be set aside');
  const ib = masked.ruled.paths.length ? { ...ib0, 'routes.json': masked.before } : ib0;
  const from = ib0['routes.json'] != null ? engineCommitOf(ib0['routes.json']) : null;
  const to = ia['routes.json'] != null ? engineCommitOf(ia['routes.json']) : null;
  if (!from) return unknown(`the before build ${before} records no engineCommit${ib0['routes.json'] == null ? ' (its S4 folder holds no routes.json)' : ''}, so no engine commit can be named`);
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
  return { status: 'ok', from, to, sheets, inputs, adopted, byKind, ruled: masked.ruled };
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
  const ruled = evidence.ruled || { paths: [], rulings: [], to: [], from: [], refused: [] };
  const unused = ruled.refused.length ? ` (${ruled.refused.join('; ')})` : '';
  const words = new Map(moved.map((s) => [s.sheet, ruledTextChange(s.text, ruled)]));
  const worded = moved.find((s) => words.get(s.sheet) && words.get(s.sheet).changed);
  if (worded) return wait(`the text on ${worded.sheet} changed${ruled.paths.length ? ' beyond what Peter ruled' : ''}: ${describeText(words.get(worded.sheet))}${unused}`);
  if (evidence.inputs.length && !evidence.adopted) return wait(`the build's inputs changed — ${evidence.inputs.join(', ')} — and neither an engine commit, an OA-437 adoption nor a ruling of Peter's explains that change${unused}`);
  const other = (r) => r.map.toLowerCase() !== String(entry.map).toLowerCase();
  const attributed = [];
  for (const s of moved) {
    if (!s.kind) return wait(`${s.sheet} moved, and no rule covers a sheet of that name`);
    const commits = evidence.byKind[s.kind] || [];
    if (!commits.length && words.get(s.sheet) && words.get(s.sheet).touched) continue;
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
  const quiet = moved.filter((s) => s.text && !(words.get(s.sheet) || {}).touched).map((s) => `${s.sheet}: ${describeText(s.text)}`);
  const said = ruled.rulings.map((r) => `S3 ${r.s3}, "${clip(r.said)}"${r.where ? ` (${r.where})` : ''}`).join('; ');
  const rule = ruled.paths.length ? `Peter's ruling of ${ruled.paths.join(', ')} (${said})` : '';
  const what = (evidence.adopted || []).length ? `the OA-437 adoption of ${evidence.adopted.join(', ')}` : 'a handPlaced reason or a fact tag (neither moves ink)';
  const ins = evidence.inputs.length ? `the inputs differ only by ${what}${rule ? ` and ${rule}` : ''}` : rule ? `the inputs differ only by ${rule}` : 'the inputs are unchanged';
  const text = ruled.paths.length && moved.some((s) => (words.get(s.sheet) || {}).touched) ? 'the text is unchanged but for the words Peter ruled' : 'the text is unchanged';
  const ink = attributed.length ? `the ink is ${attributed.map((x) => `${short(x.sha)} (accepted on ${x.map} by ${x.by})`).join(', ')}` : 'no engine commit moved it';
  const note = `answered by rule: ${text} on ${moved.map((s) => s.sheet).join(', ')}${quiet.length ? ` (${quiet.join('; ')})` : ''}, ${ins}, and ${ink}`;
  return { verdict: 'accept', note, attributed, ...(ruled.paths.length ? { ruled: ruled.paths } : {}) };
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
/**
 * The newest earlier build of this map that Peter himself accepted, or null. His accept
 * covers every mark up to that build, so only what changed since then is the rule's to
 * explain. His newest superseded answer must be that accept: a later hold means there is
 * no base. A self-answer is never a base, for the reason it is never a sighting.
 */
export function acceptedBase(m) {
  const mine = (m.superseded || []).filter((a) => a && !a.self && a.after && a.after !== m.after && a.after > (m.before || ''));
  const last = mine.sort((x, y) => (x.at || '').localeCompare(y.at || '') || (x.after < y.after ? -1 : 1)).pop();
  return last && last.verdict === 'accept' ? last.after : null;
}

export function selfAnswer(review, { by, at, evidenceFor, register, ordersFor = () => null }) {
  if (!by || typeof by !== 'string' || !by.trim()) throw new Error('--by is required: a self-answer names the session that gave it.');
  const results = [];
  const maps = review.maps.map((m) => {
    if (m.status !== 'ink-moved' || (m.answer && m.answer.after === m.after)) return m;
    /* The rule is asked from the newest earlier build Peter accepted on this map, when it can still be read (OA-659). */
    const base = acceptedBase(m);
    const fromBase = base ? evidenceFor(m, base, m.after) : null;
    const ev = fromBase && fromBase.status === 'ok' ? fromBase : evidenceFor(m, m.before, m.after);
    const since = ev === fromBase ? ` (asked from ${base}, which Peter accepted, not from ${m.before})` : '';
    /* A delivery Peter queued, naming this build, is his accept, whatever the rule would say (OA-659). */
    const order = ordersFor(m);
    const d0 = order
      ? { verdict: 'accept', basis: 'delivery', note: `Peter queued its delivery himself: ${order.file} says "${order.sentence}"` }
      : decide({ entry: m, evidence: ev, register });
    const d = order ? d0 : d0.verdict === 'accept' ? { ...d0, note: `${d0.note}${since}` } : { ...d0, reason: `${d0.reason}${since}` };
    results.push({ map: m.map, outcome: d.verdict, why: d.verdict === 'accept' ? d.note : d.reason });
    if (d.verdict !== 'accept') return { ...m, selfCheck: { by: by.trim(), at, after: m.after, reason: d.reason } };
    const superseded = [...(m.superseded || []), ...(m.answer ? [{ ...m.answer, why: `rebuilt as ${m.after} after this answer` }] : [])];
    const { selfCheck, ...rest } = m;
    return { ...rest, answer: { verdict: 'accept', by: by.trim(), at, after: m.after, note: d.note, self: true, ...(d.basis ? { basis: d.basis } : {}), engine: recordable(ev) }, ...(superseded.length ? { superseded } : {}) };
  });
  return { review: { ...review, maps }, results };
}

/**
 * The manifest with a ruling of Peter's written onto one S3 run (OA-659). `read(path)`
 * gives the value at that path in the S3 run's own routes.json, so the ruled value is
 * the one the rebuild was given and cannot be mistyped. Throws, naming the problem,
 * rather than write a ruling the rule would refuse.
 */
export function recordRuling(manifest, { s3, paths, said, where, on, read }) {
  const run = ((manifest && manifest.stages && manifest.stages.S3 && manifest.stages.S3.runs) || []).find((r) => r.id === s3);
  if (!run) throw new Error(`there is no S3 run ${s3} in the manifest.`);
  if (!Array.isArray(paths) || !paths.length) throw new Error('--path names the routes.json path(s) Peter ruled, comma-separated, such as internalDesc.31.');
  const set = {};
  for (const p of paths) {
    const v = read(p);
    if (v === undefined) throw new Error(`S3 ${s3}'s routes.json has nothing at ${p}, so there is no value to record as ruled.`);
    set[p] = v;
  }
  const ruling = { by: 'peter', on, said: String(said || '').trim(), ...(where ? { where: String(where).trim() } : {}), set };
  const why = rulingProblem(ruling);
  if (why) throw new Error(`the ruling would not be used, because ${why}.`);
  if (run.ruling && JSON.stringify(run.ruling) !== JSON.stringify(ruling)) throw new Error(`S3 ${s3} already carries a different ruling; a ruling is a record, so it is not overwritten. Record a new S3 run.`);
  const next = structuredClone(manifest);
  next.stages.S3.runs.find((r) => r.id === s3).ruling = ruling;
  return { manifest: next, ruling };
}

/* ------------------------------------------------------------------ the edge */

/**
 * `ordersFor` for `selfAnswer`: the ad-hoc prompts in `adhoc/ready`, `doing` and `done`,
 * read once, each asked by `deliveryOrder()` against the map's own manifest.
 */
export function diskOrders(busesDir, readManifest) {
  const files = [];
  for (const sub of ['ready', 'doing', 'done']) {
    const dir = path.join(busesDir, 'adhoc', sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.md')) files.push({ file: `adhoc/${sub}/${f}`, text: readFileSync(path.join(dir, f), 'utf8') });
  }
  return (m) => {
    const runs = readManifest(path.join(busesDir, m.dir || path.join('Areas', m.map)))?.stages?.S4?.runs || [];
    for (const f of files) { const sentence = deliveryOrder(f.text, m, runs); if (sentence) return { file: f.file, sentence }; }
    return null;
  };
}

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
