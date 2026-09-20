'use strict';
/*
 * pick-fixture.js — which map a borrowed-fixture harness should borrow, ASKED of
 * the estate rather than written down (buses-data OA-398).
 *
 * THE FAULT THIS REMOVES. `prove-red-rollout-stamp.js` defaulted to `Ramsey` and
 * `St Neots / St Neots Co-op`; `prove-red-unrendered.js` to `Ramsey` and
 * `Places/_standalone/Ely Co-op`. Four town and place names, typed into two
 * files, describing a third repository's tree — which is precisely the complaint
 * OA-219 was filed about when `prove-red-held-back` did the same thing, and it
 * was fixed there and not here. It surfaced the moment those harnesses were
 * pointed at a small fixture estate: `Ramsey has no manifest.json`, which reads
 * like a broken harness and is a stale constant.
 *
 * A NAMED MAP IS STILL AN ERROR WHEN IT IS NOT THERE, never a substitution.
 * `--town` / `--place` mean somebody asked for something specific, and quietly
 * answering about a different map is how a harness comes to describe the
 * neighbour instead of its subject.
 *
 * WHAT MAKES A MAP USABLE HERE is stated as a list rather than assumed, because
 * every one of these has been the cause of a case that passed for the wrong
 * reason: a `manifest.json` (or `findTowns`/`findPlaces` cannot see it at all), a
 * `ci-reference/routes.json` and a `ci-reference/internal.svg` (the pack the
 * fixture is cut from), and a LATEST S3 RUN — without which `rolloutOne()` has
 * nothing to seed a rebuild from and the case that needs it returns SKIP, which
 * both harnesses' own comments call a pass for the wrong reason.
 *
 * In NAME ORDER, so the answer is stable across runs and across machines: a
 * harness that borrowed a different map on Tuesday would be a harness whose red
 * nobody could reproduce.
 */
const fs = require('node:fs');
const path = require('node:path');
const gl = require('../../assets/gate_lib');
const { loadManifest } = require('../../assets/stage');

function hasLatestS3(dir) {
  try {
    const m = loadManifest(dir);
    const s3 = m.stages && m.stages.S3;
    const rec = s3 && s3.runs && s3.runs.find((r) => r.id === s3.latest);
    return !!(rec && fs.existsSync(path.join(dir, rec.dir)));
  } catch { return false; }
}

function usable(dir) {
  return fs.existsSync(path.join(dir, 'ci-reference', 'routes.json'))
    && fs.existsSync(path.join(dir, 'ci-reference', 'internal.svg'))
    && hasLatestS3(dir);
}

/* `who` is the harness's own name, so a refusal says which run stopped and why. */
function refuse(who, kind, named, tried, buses) {
  if (named) {
    console.error(`${who}: no ${kind} called "${named}" under ${buses} with a manifest, a ci-reference pack and a latest S3 run.`);
    console.error(`  You named it, so this is an error rather than a reason to substitute another. Drop the flag to let`);
    console.error(`  the harness choose, or point at another checkout with --buses "<dir>".`);
  } else {
    console.error(`${who}: no ${kind} under ${buses} carries a manifest, a ci-reference pack and a latest S3 run.`);
    console.error(`  Looked at: ${tried.length ? tried.join(', ') : '(none found at all)'}`);
    console.error(`  This harness borrows a real map's committed skeleton; it cannot pose its cases without one.`);
  }
  process.exit(1);
}

/** The town to borrow: the one named, or the first in name order that is usable. */
function pickTown(buses, named, who) {
  const towns = gl.findTowns(buses);
  const sorted = towns.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (named) {
    const t = sorted.find((x) => x.name === named);
    if (!t || !usable(t.dir)) refuse(who, 'town', named, [], buses);
    return t;
  }
  const t = sorted.find((x) => usable(x.dir));
  if (!t) refuse(who, 'town', null, sorted.map((x) => x.name), buses);
  return t;
}

/* The place to borrow, across all three place layouts (findPlaces knows them).
 *
 * `requireTown` is for a harness that rebuilds the NESTED layout in its scratch
 * tree: `findPlaces` only sees a place under `Areas/<Town>/Places/` by way of the
 * town's own manifest, so such a fixture needs a town to copy that manifest from,
 * and a standalone place has none. Asked for by the caller rather than assumed,
 * because the other harness is happy with any layout and narrowing both would
 * shrink what can be borrowed for no reason. */
function pickPlace(buses, named, who, { requireTown = false } = {}) {
  const places = gl.findPlaces(gl.findTowns(buses), buses)
    .filter((p) => !requireTown || p.town);
  const sorted = places.slice().sort((a, b) => a.name.localeCompare(b.name));
  const kind = requireTown ? 'place under a town' : 'place';
  if (named) {
    const p = sorted.find((x) => x.name === named);
    if (!p || !usable(p.dir)) refuse(who, kind, named, [], buses);
    return p;
  }
  const p = sorted.find((x) => usable(x.dir));
  if (!p) refuse(who, kind, null, sorted.map((x) => x.name), buses);
  return p;
}

module.exports = { pickTown, pickPlace, usable };
