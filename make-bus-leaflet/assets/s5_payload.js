/*
 * s5_payload.js — `stage.js commit S5` refuses an S5 lacking any file its S4 holds.
 *
 * The S5 folder is what `npm run deliver --src` ships, and the host's pre-flight verify
 * re-draws from it. High Wycombe Aldi's v1.43 S5 (2026-10-13) was assembled by hand in an
 * attached worktree, where `stage.js pull` resolves the main checkout's manifest, and held
 * only the sheets and routes.json; deliver failed on the host with ENOENT atco2name.json,
 * and `--dry-run` skips that step so nothing local saw it. `pull S4` copies the lot, so
 * this is green on every S5 that came through it — measured the same day: 94 S5 runs with
 * an S4 on disk, none short of one file.
 *
 * Flat files only, as `pull` copies. A pruned S4 is not asked here; stage.js's routes.json
 * guard already notes it. Its own module because stage.js is held by the line ratchet.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const flat = (d) => fs.readdirSync(d).filter(n => fs.statSync(path.join(d, n)).isFile());

/* The names the S4 folder holds that the S5 folder does not; [] when the S4 is gone. */
function missingFromS5(s4Dir, runDir) {
  if (!s4Dir || !fs.existsSync(s4Dir)) return [];
  const have = new Set(flat(runDir));
  return flat(s4Dir).filter(n => !have.has(n));
}

/* Refuses through `die`, or warns when `force` (--force-partial-payload) is set. */
function guard({ townDir, s4Rec, s4Id, runDir, id, force, die }) {
  const missing = missingFromS5(s4Rec && path.join(townDir, s4Rec.dir), runDir);
  if (!missing.length) return;
  const list = missing.slice(0, 8).join(', ') + (missing.length > 8 ? ` and ${missing.length - 8} more` : '');
  if (!force)
    die(`S5 run ${id} cannot be committed: it lacks ${missing.length} file(s) its S4 ${s4Id} holds: ${list}\n`
      + `  The S5 folder is the payload \`npm run deliver\` ships, and the host's pre-flight verify\n`
      + `  re-draws from it, so this run would fail there (High Wycombe Aldi v1.43, ENOENT atco2name.json).\n`
      + `  Pull the S4 into it, which copies every file, and re-render:\n`
      + `    node "%SK%\\stage.js" pull S4 "${runDir}"\n`
      + `  Override with --force-partial-payload only if this S5 will never be delivered.`);
  console.log(`  WARNING: committing an S5 that lacks ${missing.length} file(s) of S4 ${s4Id} (--force-partial-payload)`);
}

module.exports = { missingFromS5, guard };
