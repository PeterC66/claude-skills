/*
 * run_id.js — the id `stage.js new` gives a run folder.
 *
 * An id is the LOCAL minute, `YYYY-MM-DD_HHMM`, with `v<version>_` in front for S4
 * and S5. That shape is anchored on by prune_runs.py, ink_review.mjs and
 * stage_refresh.mjs, so it must not grow a suffix.
 *
 * NEVER HAND BACK A FOLDER THAT IS ALREADY THERE. A second `new` inside the minute
 * used to compute the same id, and mkdir's `recursive` quietly accepted the existing
 * folder — on 2026-09-30 that reopened the already-committed S3-config/2026-09-30_0032
 * of Godmanchester Co-op Ermine Street and set `pending` on it. So `freshRunId` steps
 * on to the next free minute. The true start is `pending.startedAt`, in UTC, and a
 * later minute always sorts after the run it avoided, so `latest` ordering holds.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** The first `prefix + minute` id, from `now` on, with no folder in `stageDir` and no
 *  run in `runs`. Throws after an hour of taken ids: that is a caller in a loop. */
function freshRunId(stageDir, runs, prefix = '', now = Date.now()) {
  const taken = (x) => fs.existsSync(path.join(stageDir, x)) || (runs || []).some(r => r.id === x);
  for (let k = 0; k <= 60; k++) {
    const id = prefix + ts(new Date(now + k * 60000));
    if (!taken(id)) return id;
  }
  throw new Error(`every run id for the hour after ${prefix + ts(new Date(now))} is already taken in ${stageDir} — something is calling \`new\` in a loop`);
}

module.exports = { ts, freshRunId };
