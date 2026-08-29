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
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Copy the previous S4's `.json` inputs into `destDir`.
 *
 * @param {string} destDir   where the new build is being assembled
 * @param {string} prevS4Dir the previous S4 run folder
 * @param {string[]} s3Carry filenames the S3 owns; never taken from S4
 * @returns {{carried: string[], shadowed: string[], skipped: string[]}}
 *   `carried`  — copied in, prevS4's bytes now on disk, sorted
 *   `shadowed` — of those, the ones that were already there with different bytes
 *   `skipped`  — `.json` files left alone because the caller owns them via S3
 */
function seedPrevS4(destDir, prevS4Dir, s3Carry) {
  const owned = new Set(s3Carry || []);
  const carried = [], shadowed = [], skipped = [];
  for (const name of fs.readdirSync(prevS4Dir).sort()) {
    const from = path.join(prevS4Dir, name);
    if (fs.statSync(from).isDirectory()) continue;
    if (!name.endsWith('.json')) continue;
    if (owned.has(name)) { skipped.push(name); continue; }
    const to = path.join(destDir, name);
    // Read both before writing: once the copy has happened the question of what
    // was there cannot be asked again, and "what was there" is the whole finding.
    if (fs.existsSync(to) && !fs.readFileSync(to).equals(fs.readFileSync(from))) shadowed.push(name);
    fs.copyFileSync(from, to);
    carried.push(name);
  }
  return { carried, shadowed, skipped };
}

module.exports = { seedPrevS4 };
