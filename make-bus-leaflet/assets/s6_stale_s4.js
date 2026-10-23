/*
 * s6_stale_s4.js — `stage.js commit S6` refuses an S6 whose S2 or S3 the latest S4 was not drawn from.
 *
 * buses-data 60358500 re-cut St Ives's S2 and committed an S6 against it, leaving S4 v7.1 —
 * basedOn S2 2026-07-04_0133 — standing because the ink would not move. The ink did not, but
 * the manifest then said the published sheets came from an S2 the S6 no longer verified;
 * gates.yml went red on stale_inputs.test.js (run 39879913992) and 8a8bddae cleared it with a
 * v8.0 rebuild that should have come before the S6.
 *
 * NOT A NEW COMPARISON. staleInputs() in gate_lib.js already asks "has S2/S3 moved since the
 * latest S4?" of a manifest; this hands it the S6's view of one — S2/S3 `latest` replaced by
 * the ids the S6 names in --based-on, or left as they are when it names none, which is what an
 * S6 audits by default. An S6 with no S4 to compare is not this guard's business, and
 * staleInputs() returns [] for it.
 *
 * The override takes a reason and RECORDS it: the returned object becomes the run record's
 * `staleS4`, so the manifest says in as many words what this S6 verified and what the sheets
 * were drawn from, rather than leaving the gap for stale_inputs.test.js to find.
 *
 * Returns null when nothing moved, else { s4, moved, why } for the run record.
 */
'use strict';
const { staleInputs } = require('./gate_lib');

function guard({ m, basedOn, id, force, die }) {
  const view = { stages: { ...m.stages } };
  for (const s of ['S2', 'S3']) if (basedOn[s] && view.stages[s]) view.stages[s] = { ...view.stages[s], latest: basedOn[s] };
  const moved = staleInputs(view);
  if (!moved.length) return null;
  const s4Id = m.stages.S4.latest;
  const say = moved.map(x => `${x.stage} ${x.now} (S4 ${s4Id} was drawn from ${x.was || 'an earlier ' + x.stage}, by ${x.how})`).join('; ');
  if (!force)
    die(`S6 run ${id} cannot be committed: it verifies inputs the latest S4 was not drawn from — ${say}.\n`
      + `  The manifest would then say the published sheets came from inputs this S6 no longer\n`
      + `  verified, and stale_inputs.test.js goes red on every push (buses-data 60358500).\n`
      + `  Rebuild S4 and S5 from these inputs first — new S4, pull S2 and S3, build_s4.js,\n`
      + `  commit S4 --based-on "S2=…;S3=…", then S5 — and commit this S6 against the new S4.\n`
      + `  Override with --force-stale-s4 "<why>" only if the S4 is deliberately left standing;\n`
      + `  the reason and the moved inputs are written into this run's record as "staleS4".`);
  const rec = { s4: s4Id, moved, why: typeof force === 'string' ? force : null };
  console.log(`  WARNING: recorded S6 ${id} as verifying ${say}, with staleS4 on its run record`
    + (rec.why ? ` — why: ${rec.why}` : ' and no reason given') + ' (--force-stale-s4)');
  return rec;
}

module.exports = { guard };
