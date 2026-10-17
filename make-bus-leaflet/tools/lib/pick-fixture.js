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
 *
 * BUT A MAP DRAWN BY THE RUNNING ENGINE COMES FIRST (buses-data OA-536). Since
 * OA-430 each map is gated against the engine that drew it, so most of the estate
 * trails the engine by design — and a harness whose control rebuilds its borrowed
 * map under TODAY's engine needs a map today's engine reproduces. Name order handed
 * `prove-red-rollout-stamp` Beaconsfield, whose ci-reference the pinned engine no
 * longer draws byte for byte, so control A reached a rebuild and errored (OA-535),
 * and gates.yml was patched with `--town "St Ives"` — right only while the pin draws
 * St Ives. So the first usable map whose `ci-reference/routes.json` `engine` stamp
 * equals this checkout's hash wins, as prove-red-gates.js's pickMap() has chosen
 * since claude-skills #236; with none, name order as before. Still stable: the
 * answer moves only when the engine or the estate does.
 *
 * AND FOR A HARNESS WHOSE CONTROL REBUILDS, NAME ORDER IS NO ANSWER AT ALL
 * (buses-data OA-604). With no map stamped by the running engine, name order lends
 * one the engine does not reproduce, and `prove-red-rollout-stamp`'s control then
 * answers DRY-RUN where it must say UP-TO-DATE — red on the estate, with nothing
 * wrong in rollout.js or rollout_places.js. Every place under a town trails the
 * engine by design (OA-430), so for places this is the ordinary state after any
 * hashed edit. `requireCurrent` drops the fallback and refuses, naming the cause.
 * CI cannot meet it: the fixture-estate step before that harness fails unless
 * every fixture stamp is current. A harness that never rebuilds keeps name order.
 */
const fs = require('node:fs');
const path = require('node:path');
const gl = require('../../assets/gate_lib');
const { loadManifest } = require('../../assets/stage');
const { computeEngineVersion, computePlaceEngineVersion } = require('../../assets/engine_version');

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

function stampOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'ci-reference', 'routes.json'), 'utf8')).engine || null; } catch { return null; }
}

/** The first usable map drawn by `engine`, else (unless `requireCurrent`) the first
 *  usable one. `sorted` is in name order. */
function preferStamped(sorted, engine, requireCurrent) {
  const ok = sorted.filter((x) => usable(x.dir));
  const current = ok.find((x) => engine && stampOf(x.dir) === engine);
  return requireCurrent ? current : current || ok[0];
}

/* The refusal when `requireCurrent` finds no map drawn by the running engine: a
 * different fact from finding nothing usable, so it says so and lists the stamps. */
function refuseStale(who, kind, engine, sorted, buses) {
  const ok = sorted.filter((x) => usable(x.dir));
  if (!ok.length) return;   // nothing usable at all: refuse() says that
  console.error(`${who}: no ${kind} under ${buses} is stamped by the running engine ${engine}, so none can be borrowed.`);
  console.error(`  This harness's control rebuilds the map it borrows under TODAY's engine, and a map drawn by another`);
  console.error(`  engine answers DRY-RUN there with nothing wrong in the code (OA-604). Usable, with their stamps:`);
  for (const x of ok) console.error(`    ${x.name}  ${stampOf(x.dir) || '(none)'}`);
  console.error(`  Rebuild one under this engine, or name one with the flag if you know this engine still draws it.`);
  process.exit(1);
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

/** The town to borrow: the one named, or the first usable one drawn by the running
 *  engine, or the first usable one in name order. `engine` overrides the hash (tests). */
function pickTown(buses, named, who, { engine, requireCurrent = false } = {}) {
  const towns = gl.findTowns(buses);
  const sorted = towns.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (named) {
    const t = sorted.find((x) => x.name === named);
    if (!t || !usable(t.dir)) refuse(who, 'town', named, [], buses);
    return t;
  }
  const hash = engine === undefined ? computeEngineVersion() : engine;
  const t = preferStamped(sorted, hash, requireCurrent);
  if (!t && requireCurrent) refuseStale(who, 'town', hash, sorted, buses);
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
function pickPlace(buses, named, who, { requireTown = false, engine, requireCurrent = false } = {}) {
  const places = gl.findPlaces(gl.findTowns(buses), buses)
    .filter((p) => !requireTown || p.town);
  const sorted = places.slice().sort((a, b) => a.name.localeCompare(b.name));
  const kind = requireTown ? 'place under a town' : 'place';
  if (named) {
    const p = sorted.find((x) => x.name === named);
    if (!p || !usable(p.dir)) refuse(who, kind, named, [], buses);
    return p;
  }
  const hash = engine === undefined ? computePlaceEngineVersion() : engine;
  const p = preferStamped(sorted, hash, requireCurrent);
  if (!p && requireCurrent) refuseStale(who, kind, hash, sorted, buses);
  if (!p) refuse(who, kind, null, sorted.map((x) => x.name), buses);
  return p;
}

module.exports = { pickTown, pickPlace, usable };
