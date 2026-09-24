/*
 * local_decisions.mjs — the two rows a map's local-decisions.json can raise, as a
 * function over the buses tree (buses-data OA-083, 2026-09-24). Moved out of
 * worklist.mjs when it grew, because that file is under the line ratchet.
 *
 *   1. `corr-asked-<map>`    questions put to somebody local and still unanswered
 *   2. `corr-unasked-<map>`  questions recorded and never put to anyone
 *
 * EVERY MAP'S FILE, not every town's. A place map keeps its own
 * local-decisions.json beside its own manifest, under
 * Areas/<town>/Places/<place>/, and until 2026-09-24 the reader went one level
 * down only -- so all four place maps' questions, including the estate's only
 * blocking decision nobody had asked, raised nothing anywhere. A place row is
 * keyed by the place's name, which is how the portal and the board name it.
 *
 * THE SECOND ROW. `answer` null or absent (or a null `state`) is the value a
 * decision is born with, per make-bus-leaflet/references/local-decisions.md.
 * Nobody is waiting on it, which is exactly why it raised nothing: on 2026-09-19
 * six of the estate's decisions were in this state, one of them blocking. It is
 * OUR move -- put the question, or record that it was put -- so it ranks with
 * the housekeeping, not with a person waiting. `open` and `partly-answered` are
 * deliberately NOT never-asked: those are states somebody wrote.
 *
 * prove-red-correspondence.mjs sections 4, 4a and 4b are its harness.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const subdirs = (d) => (existsSync(d)
  ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : []);

/** Every map folder under Areas/ that could hold a local-decisions.json. */
function mapFolders(buses) {
  const areas = path.join(buses, 'Areas');
  const maps = [];
  for (const town of subdirs(areas)) {
    maps.push({ name: town, rel: `Areas/${town}` });
    for (const place of subdirs(path.join(areas, town, 'Places'))) maps.push({ name: place, rel: `Areas/${town}/Places/${place}` });
  }
  return maps;
}

export function localDecisionItems(buses, daysSince) {
  const out = [];
  for (const { name, rel } of mapFolders(buses)) {
    const f = path.join(buses, rel, 'local-decisions.json');
    if (!existsSync(f)) continue;
    let doc;
    try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    const all = (doc.decisions || []).filter(Boolean);
    const oldestOf = (ds) => ds.map((d) => d.raised).filter(Boolean).sort()[0];

    // A question we asked and never got an answer to. WAITING ON OTHERS, not
    // your move -- and one of these is a question the correspondent volunteered
    // to go and research for us.
    const asked = all.filter((d) => d?.answer?.state === 'asked');
    if (asked.length) {
      const oldest = oldestOf(asked);
      out.push({
        key: `corr-asked-${name}`, rank: 9, type: 'correspondence',
        title: `${name}: ${asked.length} question(s) asked locally and still unanswered`,
        why: `${asked.map((d) => d.id).join(', ')} — nothing but a person on the ground can settle these, and the map is drawn on our own judgement until one does.`,
        who: 'the local adviser', runbook: 'correspondence',
        ageDays: oldest ? daysSince(oldest) : null,
        do: [{ kind: 'chat', what: `Read ${rel}/local-decisions.json. Chase only if it has gone quiet — silence is not agreement, and it is not a refusal either.` }],
      });
    }

    const unasked = all.filter((d) => d.answer == null || d.answer.state == null);
    if (unasked.length) {
      const oldest = oldestOf(unasked);
      const blocking = unasked.filter((d) => d.severity === 'blocking').length;
      out.push({
        key: `corr-unasked-${name}`, rank: 8, type: 'correspondence',
        title: `${name}: ${unasked.length} local question(s) recorded but never put to anyone${blocking ? ` (${blocking} blocking)` : ''}`,
        why: `${unasked.map((d) => d.id).join(', ')} — each has no answer state at all, so no row asks after it; the sheet prints our default until somebody local is asked.`,
        who: 'Peter', runbook: 'correspondence',
        ageDays: oldest ? daysSince(oldest) : null,
        do: [{ kind: 'chat', what: `Read ${rel}/local-decisions.json. Put each question to whoever can answer it, then set its answer to { "state": "asked" } — or, if it was already asked, record that.` }],
      });
    }
  }
  return out;
}
