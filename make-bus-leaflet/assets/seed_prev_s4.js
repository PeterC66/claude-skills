'use strict';
/*
 * seed_prev_s4.js — ONE rule for carrying the previous S4's inputs forward into a
 * new build, used by BOTH halves of rollout_places.js.
 *
 * WHY THIS IS A MODULE AND NOT TWO LOOPS (OA-013).
 *
 * `rollout_places.js` had two of them, and they picked different winners. The dry
 * run copied every `.json` from the previous S4 unconditionally; the apply ran
 * `stage.js pull S1/S2/S3` first and then copied from the previous S4 only where
 * the file was NOT already there. So whichever stage happened to hold a file
 * decided the answer, differently in each path, and the dry run's label diff could
 * describe a build the apply would never make.
 *
 * It was not hypothetical. On 2026-08-24 St Ives Bus Station's dry run reported a
 * clean `GAINED: New Road` from the good `boarding_index.json` in the previous S4,
 * and the apply then built from the pre-`excludeRoutes` copy sitting in
 * `S2-geometry/2026-08-22_1732` — putting route 101's withdrawn summer destinations
 * (Hunstanton, Heacham, Ely, Fordham, Sutton, West Winch) onto a sheet bound for
 * the live portal. `internalRoads.fitExtra` went the same way and reverted the map
 * frame. The inversion worth remembering: the other three boarding places have no
 * `boarding_index.json` in S2 at all, and that absence is what protected them — the
 * place with the more complete stage history is the one that regressed. This is the
 * named shape *a dry run that cannot predict its apply*.
 *
 * THE RULE, stated once so it can be quoted: for an engine rollout, **the previous
 * S4's copy wins** for every `.json` except the ones the caller names as S3-owned.
 * A rollout is "same data, new engine" — the previous S4 holds precisely the inputs
 * that produced the sheet the diff is taken against, including the files a build
 * stage wrote back into the run folder and never registered as a stage output
 * (`roads_geo.json`, `routes_paths.json`, `boarding_index.json`). Preferring a
 * pulled stage copy silently swaps the data under a run that was only supposed to
 * change the code.
 *
 * AND IT SAYS WHEN THE QUESTION WAS EVEN ASKED. Every file that existed in the
 * destination with DIFFERENT bytes before being overwritten is returned in
 * `shadowed`. That list is empty on the dry-run path by construction — nothing has
 * been pulled there — and on the apply path it names exactly the ambiguity that
 * caused the incident. The choice is no longer silent, and it is no longer
 * different in the two paths.
 *
 * THE ONE CLASS OF `.json` THAT IS NOT AN INPUT (2026-09-10, from buses-data
 * OA-297 P0-B). The rule above says "the previous S4 holds precisely the inputs
 * that produced the sheet the diff is taken against". The unplaced-label sidecars
 * are not inputs — they are OUTPUTS, one per sheet, and each generator writes its
 * own or unlinks it, so an absent sidecar means zero. Carrying one forward is inert
 * for as long as the sheet is still built, because the generator overwrites or
 * removes it within the same run. It stops being inert the moment a sheet is
 * DROPPED: nothing runs, nothing unlinks, and the previous build's answer is seeded
 * into the new run with the previous run's mtime and no way to tell it from a fresh
 * one. That is what happened when the tube-map diagram was parked — the four towns
 * were rebuilt without it and `unplaced-diagram.json` came along, into two of the
 * new S4 runs, one step short of `sync_ci_reference.js` writing it into the tracked
 * golden master. So a sidecar is never carried, and the names come from
 * sheet_registry.js rather than from a pattern: `internal` writes `unplaced.json`,
 * which no `unplaced-*.json` glob would have caught.
 *
 * The general question this leaves open, deliberately unanswered here: every other
 * `.json` in an S4 run was checked on the day, and the rest really are inputs from
 * an earlier stage (`complexity.json`, the atco and route files) or are rewritten
 * unconditionally by a generator that always runs (`build-meta.json`). If a future
 * sheet writes a second kind of output beside itself, it belongs in the registry
 * row too, not in a new set here.
 */
const fs = require('node:fs');
const path = require('node:path');
const { SIDECARS } = require('./sheet_registry.js');

/**
 * Copy the previous S4's `.json` inputs into `destDir`.
 *
 * @param {string} destDir   where the new build is being assembled
 * @param {string} prevS4Dir the previous S4 run folder
 * @param {string[]} s3Carry filenames the S3 owns; never taken from S4
 * @returns {{carried: string[], shadowed: string[], skipped: string[], sidecars: string[]}}
 *   `carried`  — copied in, prevS4's bytes now on disk, sorted
 *   `shadowed` — of those, the ones that were already there with different bytes
 *   `skipped`  — `.json` files left alone because the caller owns them via S3
 *   `sidecars` — the previous build's own output sidecars, deliberately NOT carried
 */
function seedPrevS4(destDir, prevS4Dir, s3Carry) {
  const owned = new Set(s3Carry || []);
  const carried = [], shadowed = [], skipped = [], sidecars = [];
  for (const name of fs.readdirSync(prevS4Dir).sort()) {
    const from = path.join(prevS4Dir, name);
    if (fs.statSync(from).isDirectory()) continue;
    if (!name.endsWith('.json')) continue;
    if (owned.has(name)) { skipped.push(name); continue; }
    // Named rather than dropped in silence, for the same reason `shadowed` is: a
    // build that stops carrying a file is a change to what the next diff is taken
    // against, and the operator should be able to read it off the run.
    if (SIDECARS.has(name)) { sidecars.push(name); continue; }
    const to = path.join(destDir, name);
    // Read both before writing: once the copy has happened the question of what
    // was there cannot be asked again, and "what was there" is the whole finding.
    if (fs.existsSync(to) && !fs.readFileSync(to).equals(fs.readFileSync(from))) shadowed.push(name);
    fs.copyFileSync(from, to);
    carried.push(name);
  }
  return { carried, shadowed, skipped, sidecars };
}

/**
 * Assemble a rollout's S4 build directory — the ONE sequence, used by BOTH halves
 * of BOTH rollouts (OA-239).
 *
 * WHY THIS EXISTS ON TOP OF seedPrevS4. OA-013 made the two halves pick the same
 * WINNER when both held a file. It did not make them read the same FILES. The dry
 * run assembled its scratch from the previous S4 alone; the apply pulled the
 * stages first and seeded over the top. So a file the LATEST S2 declares and the
 * previous S4 does not have was in the apply and absent from the dry run — and in
 * `rollout.js`, which had no seedPrevS4 on its apply path at all, the divergence
 * ran both ways: the dry run had the previous S4's copy of every geometry file and
 * its undeclared extras (`roads_geo.json`, `routes_paths.json`, `boarding_index.json`),
 * and the apply had the latest S2's copy and no extras. The label diff a human
 * reads, the GAIN/LOST verdict the tool blocks on and the sheets that ship were
 * three statements about two different builds.
 *
 * THE DIRECTION OF THE FIX, because it is not the one the action proposed. The
 * obvious move is to make the DRY RUN read what the apply reads. It is the wrong
 * one: `rollout.js`'s own STALE-INPUTS refusal tells the operator that `--force`
 * will *"roll the OLD geometry forward anyway"*, and `--force` is the only window
 * in which the two halves can differ at all — OA-225's guard refuses every other
 * one. The dry run was the half keeping that promise. So the APPLY is corrected to
 * the rollout rule seedPrevS4 already states — same data, new engine, the previous
 * S4's copy wins — and both halves now call this function with the same arguments.
 * Divergence stops being something two lists have to agree about and becomes
 * unrepresentable.
 *
 * @param {object}   o
 * @param {string}   o.dest      the directory being assembled (scratch S4, or the real run dir)
 * @param {string}   o.prevS4Dir the previous S4 run folder
 * @param {string[]} o.s3Carry   filenames the S3 owns; never taken from S4
 * @param {string[]} o.stages    stages to pull, in order — ['S2','S3'] for a town, ['S1','S2','S3'] for a place
 * @param {(stage: string, dest: string) => void} o.pull  runs `stage.js pull <stage> <dest>`
 * @returns {{carried: string[], shadowed: string[], skipped: string[], sidecars: string[]}} from seedPrevS4
 */
function assembleS4Inputs({ dest, prevS4Dir, s3Carry, stages, pull }) {
  for (const st of stages) pull(st, dest);
  return seedPrevS4(dest, prevS4Dir, s3Carry);
}

/* THE internalRoads KEYS A PLACE BUILD WRITES BACK INTO ITS RUN'S routes.json, and
 * nowhere else. build_internal_place_roads.js injects `fitExtra` and `fitMargin`;
 * derive_termini.js writes `termini`. A rollout builds through build_s4.js and runs
 * neither, so a value in the previous S4 that the S3 lacks is lost on the rollout. */
const PLACE_WRITE_BACK_IR = ['fitExtra', 'fitMargin', 'termini'];

/**
 * Sort every routes.json key the previous S4 holds and the latest S3 does not into
 * STALE (refuse the rollout) or DROPPED (the S3 removed it on purpose; roll out).
 *
 * WHY THERE ARE TWO ANSWERS (buses-data adhoc rollout-issue, 2026-09-30). The guard
 * refused EVERY internalRoads key missing from the S3, which is right for a key a
 * build writes back and wrong for one the S3 took out deliberately: St Ives Bus
 * Station's `skeletonMaxW` was removed on 2026-09-29 (OA-430) and the rollout could
 * not carry the removal, so it had to be hand-built with build_s4.js and
 * seed_prev_s4.js. The difference is visible in the S3 history. A write-back key
 * never has to have been in an S3; a key the S3 dropped was in an EARLIER S3 run.
 *
 * - A write-back key (PLACE_WRITE_BACK_IR, `frequency`, `design.frequencyTiers`) is
 *   STALE whatever the history says, because the rollout will not recompute it.
 * - Any other internalRoads key is DROPPED if some earlier S3 run's routes.json
 *   held it, and STALE if none did — a key no S3 ever held came from a hand edit
 *   of an S4, and nobody has said it should go.
 *
 * @param {object}   o
 * @param {object}   o.s3   the latest S3's routes.json
 * @param {object}   o.s4   the previous S4's routes.json
 * @param {object[]} o.earlierS3  routes.json of every OTHER S3 run, any order
 * @returns {{stale: string[], dropped: string[]}} dotted key names
 */
function staleS3Keys({ s3, s4, earlierS3 }) {
  const ir = rj => (rj && rj.internalRoads && typeof rj.internalRoads === 'object') ? rj.internalRoads : {};
  const s3ir = ir(s3), s4ir = ir(s4);
  const stale = [], dropped = [];
  for (const k of Object.keys(s4ir)) {
    if (k in s3ir) continue;
    const name = 'internalRoads.' + k;
    if (PLACE_WRITE_BACK_IR.includes(k)) { stale.push(name); continue; }
    ((earlierS3 || []).some(rj => k in ir(rj)) ? dropped : stale).push(name);
  }
  if (s4 && s4.frequency && !(s3 && s3.frequency)) stale.push('frequency');
  if (s4 && s4.design && s4.design.frequencyTiers && !(s3 && s3.design && s3.design.frequencyTiers))
    stale.push('design.frequencyTiers');
  return { stale, dropped };
}

module.exports = { seedPrevS4, assembleS4Inputs, staleS3Keys, PLACE_WRITE_BACK_IR };
