#!/usr/bin/env node
/*
 * ink_review.mjs — ONE review a month, of only the sheets whose ink moved
 * (buses-data OA-429, item 5 of R9 of the process review of 2026-09-17).
 *
 * WHAT IT IS FOR. R9 makes the monthly refresh unattended: a SAFE town is taken
 * through S1–S5 by a tick (`refresh_town.py`, OA-426) and delivered by a tick
 * (OA-428). The one human touch R9 leaves is THIS: Peter looks once a month, at
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
 * AN ANSWER IS ABOUT ONE BUILD. It records the S4 run it was given against, and a
 * map rebuilt after Peter answered loses the answer — kept under `superseded`,
 * never discarded — because an accept of v3.12 says nothing about v3.13.
 *
 * WHERE THINGS GO. The review and its answers are `_gtfs/ink-review_<scan>.json`,
 * tracked, beside the grading it was drawn from. The page and its crops are
 * rebuilt from the sheets on demand and go under `loop/ink-review/<scan>/`, which
 * is gitignored — a crop is evidence to look at, not a record.
 *
 * PURE CORE, INJECTED EDGE, like `refresh_grades.mjs`: `collect()` takes its disk
 * reads as arguments and reads no clock, so `prove-red-ink-review.mjs` can falsify
 * every rule with no Areas folder at all. Node core only, except that the crops
 * call `crop_compare.js` in the engine, which needs `sharp`.
 *
 * Run from anywhere. <scan> is a scan date such as 2026-10-01; <Town> is a folder
 * under Areas/; <who> is the answering session's name, e.g. buses-29 or sched-0015:
 *
 *   node ink_review.mjs --scan <scan>                       collect, write the record and the page
 *   node ink_review.mjs --scan <scan> --town "<Town>,<Town>" add towns a person rebuilt
 *   node ink_review.mjs --scan <scan> --no-crops            the record only, no sharp needed
 *   node ink_review.mjs --scan <scan> --answer "<Town>" --verdict accept|hold --by <who> [--note "<why>"]
 *   node ink_review.mjs --scan <scan> --deliverable [--json] which maps a tick may deliver
 *
 * Exit 0 on success, 2 on a refusal (the message names the remedy).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses, assetsDir } from './engine.mjs';
import { readGradeState, defaultReadGradeFiles } from './refresh_grades.mjs';

export const SCHEMA = 1;
export const VERDICTS = ['accept', 'hold'];

export class Refused extends Error {}

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
 * Build the review. `io` is the disk:
 *   readGradeFiles(dir)  as refresh_grades.mjs's
 *   readManifest(mapDir) → object | null
 *   readSheet(file)      → text | null
 * Returns `{ schema, scan, maps: [...] }` or throws Refused.
 */
export function collect({ busesDir, scan, towns = [], io }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scan || ''))) throw new Refused(`--scan must be a date like 2026-10-01, not ${JSON.stringify(scan)}.`);
  const population = new Map();
  const grades = readGradeState({ busesDir, readGradeFiles: io.readGradeFiles });
  if (grades.status === 'ok' && grades.date === scan) {
    for (const g of Object.values(grades.towns)) if (g.grade === 'SAFE') population.set(g.town.toLowerCase(), { town: g.town, why: 'SAFE' });
  } else if (!towns.length) {
    const said = grades.status === 'ok' ? `the newest grading is ${grades.date}` : `the grading is ${grades.status}${grades.why ? ` (${grades.why})` : ''}`;
    throw new Refused(`no grading for the ${scan} scan — ${said} — so there is no SAFE population to review. Name the towns with --town, or run the monthly job so the grading and the scan are one run.`);
  }
  for (const t of towns) if (!population.has(t.toLowerCase())) population.set(t.toLowerCase(), { town: t, why: 'named' });

  const maps = [];
  for (const { town, why } of [...population.values()].sort((a, b) => a.town.localeCompare(b.town))) {
    const rel = `Areas/${town}`;
    const mapDir = path.join(busesDir, 'Areas', town);
    const entry = { map: town, dir: rel, why, status: null, before: null, after: null, sheets: [], answer: null };
    const manifest = io.readManifest(mapDir);
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
 * Carry the answers of an earlier collection forward. An answer survives only if
 * it was given against the SAME build and the map still needs one; otherwise it
 * moves to `superseded` with the reason, and the map is unanswered again.
 */
export function mergeAnswers(prev, next) {
  if (!prev || !Array.isArray(prev.maps)) return next;
  const old = new Map(prev.maps.map((m) => [m.map.toLowerCase(), m]));
  return { ...next, maps: next.maps.map((m) => {
    const p = old.get(m.map.toLowerCase());
    if (!p) return m;
    /* What was staged is carried whatever the build now is: `deliverable()` asks
     * whether it was THIS build, so a rebuilt map is deliverable again by itself. */
    m = { ...m, ...(p.staged ? { staged: p.staged } : {}), ...(p.stagedBefore ? { stagedBefore: p.stagedBefore } : {}) };
    const superseded = [...(p.superseded || [])];
    if (p.answer) {
      if (p.answer.after === m.after && m.status === 'ink-moved') return { ...m, answer: p.answer, superseded };
      superseded.push({ ...p.answer, why: p.answer.after !== m.after ? `rebuilt as ${m.after} after this answer` : `now ${m.status}` });
    }
    return superseded.length ? { ...m, superseded } : m;
  }) };
}

/** Record Peter's answer for one map. `at` is passed in: the core reads no clock. */
export function answer(review, town, verdict, { by, note = null, at }) {
  if (!VERDICTS.includes(verdict)) throw new Refused(`--verdict must be ${VERDICTS.join(' or ')}, not ${JSON.stringify(verdict)}.`);
  if (!by || typeof by !== 'string' || !by.trim()) throw new Refused('--by is required: an answer nobody gave is not an answer.');
  const i = review.maps.findIndex((m) => m.map.toLowerCase() === String(town || '').toLowerCase());
  if (i < 0) throw new Refused(`${town} is not in the ${review.scan} review; it holds ${review.maps.map((m) => m.map).join(', ') || 'nothing'}.`);
  const m = review.maps[i];
  if (m.status !== 'ink-moved') throw new Refused(`${m.map} is ${m.status}, not ink-moved, so there is nothing for a person to answer${m.status === 'no-ink' ? ' — its ink did not move and it is deliverable as it stands' : ''}.`);
  const superseded = [...(m.superseded || [])];
  if (m.answer) superseded.push({ ...m.answer, why: 'answered again' });
  const maps = [...review.maps];
  maps[i] = { ...m, answer: { verdict, by: by.trim(), at, after: m.after, note }, ...(superseded.length ? { superseded } : {}) };
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The page Peter reads. `crops` maps `<map>/<sheet>` to `{ pairs: [relPath], note }`. */
export function page(review, crops = {}) {
  const moved = review.maps.filter((m) => m.status === 'ink-moved');
  const quiet = review.maps.filter((m) => m.status === 'no-ink');
  const other = review.maps.filter((m) => m.status !== 'ink-moved' && m.status !== 'no-ink');
  const sec = moved.map((m) => {
    const ans = m.answer ? `<p class="ans">Answered <b>${esc(m.answer.verdict)}</b> by ${esc(m.answer.by)}${m.answer.note ? ` — ${esc(m.answer.note)}` : ''}</p>` : '<p class="ans">Not answered yet.</p>';
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

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const busesDir = resolveBuses(args);
  const scan = typeof args.scan === 'string' ? args.scan : null;
  const file = path.join(busesDir, '_gtfs', `ink-review_${scan}.json`);
  const prev = readJson(file);

  if (typeof args.answer === 'string') {
    if (!prev) throw new Refused(`there is no review for ${scan} yet (${file}); collect it first.`);
    const next = answer(prev, args.answer, args.verdict, { by: typeof args.by === 'string' ? args.by : '', note: typeof args.note === 'string' ? args.note : null, at: new Date().toISOString() });
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    const m = next.maps.find((x) => x.map.toLowerCase() === args.answer.toLowerCase());
    console.log(`ink_review: ${m.map} ${m.answer.verdict} for ${m.after}, recorded in ${file}`);
    return;
  }
  if (args.deliverable) {
    if (!prev) throw new Refused(`there is no review for ${scan} (${file}), so nothing is deliverable.`);
    const d = deliverable(prev);
    if (args.json) { console.log(JSON.stringify({ scan, ...d })); return; }
    for (const k of ['deliver', 'staged', 'waiting', 'held', 'other']) console.log(`${k.padEnd(8)} ${d[k].join(', ') || '—'}`);
    return;
  }
  const towns = typeof args.town === 'string' ? args.town.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const review = mergeAnswers(prev, collect({ busesDir, scan, towns, io: diskIo }));
  writeFileSync(file, JSON.stringify(review, null, 2) + '\n');
  const counts = ['ink-moved', 'no-ink'].map((s) => `${review.maps.filter((m) => m.status === s).length} ${s}`);
  const other = review.maps.filter((m) => m.status !== 'ink-moved' && m.status !== 'no-ink');
  console.log(`ink_review: ${scan} — ${counts.join(', ')}${other.length ? `, ${other.length} not reviewable (${other.map((m) => `${m.map}: ${m.status}`).join('; ')})` : ''}`);
  console.log(`  record: ${file}`);
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
