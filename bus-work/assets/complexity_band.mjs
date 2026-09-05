// The town's complexity band, read off the local map tree for a map REQUEST
// (buses-data OA-088, the pre-approval half).
//
// THE GAP. Approval of a map request is the quota gate — nothing is built
// until Peter approves, and approving spends the customer's slot. The one
// verdict in the pipeline that says "do not build the standard single sheet"
// is the end-of-S2 complexity band, and S2 runs AFTER approval, so a RED town
// was only ever discovered once the quota was spent. Peter's own guide
// (`README - How to publish a map to the portal.md`, 21 August 2026) has said
// since it was written that gate two shows him "whether the subject is one we
// can actually build — … is it in the difficult band for complexity", and
// nothing in this skill did that. The portal cannot: it holds no bus data.
// This machine can, because S1 and S2 cost no quota and a few minutes.
//
// Two answers, and the second is the useful one. A town with an S2 run says
// its band, the measure that tripped it, and when it was scored. A town with
// none says UNSCORED and how to score it before approving — running the skill
// through S1 and S2 only, which is free — rather than nothing, because
// "nothing" reads as "no problem" on a list that is scanned for problems.
//
// Node builtins only, like every module beside it, so the harness runs with
// no install. Pure apart from the one read.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const BANDS = new Set(['GREEN', 'AMBER', 'RED']);

/**
 * The band of the town whose folder this is, from its NEWEST S2 run — the one
 * the manifest names as latest, not the newest by directory sort, because a
 * v1.9/v1.15 sort has bitten this estate before and the manifest is the index.
 *
 * @param {string} townDir  `Areas/<Town>`
 * @returns {{band:'GREEN'|'AMBER'|'RED', failed:string[], scoredAt:string|null, run:string}|null}
 *   null when the town has no manifest, no S2 run, no score in it, or a file
 *   that is not the gate's — never a guessed band.
 */
export function bandForTownDir(townDir) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(townDir, 'manifest.json'), 'utf8')); } catch { return null; }
  const s2 = manifest && manifest.stages && manifest.stages.S2;
  const run = s2 && s2.latest && Array.isArray(s2.runs) ? s2.runs.find((r) => r.id === s2.latest) : null;
  if (!run || !run.dir) return null;
  let j;
  try { j = JSON.parse(readFileSync(path.join(townDir, run.dir, 'complexity.json'), 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object' || !BANDS.has(j.band)) return null;
  return {
    band: j.band,
    failed: Array.isArray(j.failedThresholds) ? j.failedThresholds.filter((s) => typeof s === 'string') : [],
    scoredAt: typeof j.scoredAt === 'string' ? j.scoredAt : null,
    run: run.id,
  };
}

/**
 * One sentence for the worklist, from a band or from its absence.
 * @param {ReturnType<typeof bandForTownDir>} b
 * @param {string} town
 */
export function bandSentence(b, town) {
  if (!b) return `${town} is UNSCORED for complexity — no S2 run on this machine, so nothing yet says whether it is a single-sheet town.`;
  const failed = b.failed.length ? ` (${b.failed.join(', ')})` : '';
  const when = b.scoredAt ? `, scored ${b.scoredAt}` : '';
  if (b.band === 'RED') return `${town} scored RED for complexity${failed}${when}: the gate's one "stop" verdict — the standard single sheet is past what an A4 page can carry, and approving spends the quota slot on it.`;
  if (b.band === 'AMBER') return `${town} scored AMBER for complexity${failed}${when}: over the green line on one measure; the build applies the remedy ladder and continues.`;
  return `${town} scored GREEN for complexity${when}: inside the envelope of the accepted towns.`;
}

/**
 * The step to put in front of the request's own steps.
 * @param {ReturnType<typeof bandForTownDir>} b
 * @param {string} town
 */
export function bandStep(b, town) {
  if (!b) {
    return {
      kind: 'skill',
      what: `Score ${town} BEFORE approving: run make-bus-leaflet for "${town}" through S1 and S2 only — no quota, a few minutes — and read the band the S2 gate prints. RED means choose a strategy first (make-bus-leaflet/references/complexity-triage.md), not a single sheet.`,
    };
  }
  if (b.band === 'RED') {
    return {
      kind: 'chat',
      what: `Before approving, decide the strategy for a RED town — the remedy ladder, a multi-sheet map (OA-089), or place maps — and say which in the approval note. See make-bus-leaflet/references/complexity-triage.md.`,
    };
  }
  return { kind: 'chat', what: `Complexity band ${b.band} — nothing to decide before approving.` };
}

/**
 * Annotate a portal worklist item for an AREA map request with the local band.
 * Returns a NEW item; the input is not touched. Anything that is not an area
 * request-decision or build item comes back as it went in, identical.
 *
 * @param {object} item     a worklist item (type, why, do, …)
 * @param {{kind:string, name:string}|null} map   the portal map row the item is about
 * @param {(name:string) => string|null} townDirFor   local `Areas/<Town>` for a town name, or null
 */
export function annotateRequest(item, map, townDirFor) {
  if (!item || !map || map.kind !== 'area') return item;
  if (item.type !== 'request-decision' && item.type !== 'build') return item;
  const dir = townDirFor(map.name);
  const b = dir ? bandForTownDir(dir) : null;
  return {
    ...item,
    band: b ? b.band : null,
    why: `${item.why} ${bandSentence(b, map.name)}`,
    do: [bandStep(b, map.name), ...(item.do || [])],
  };
}
