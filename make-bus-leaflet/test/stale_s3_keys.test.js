'use strict';
/*
 * stale_s3_keys.test.js — the place rollout's STALE-S3 guard tells a key a build
 * writes back from a key the S3 dropped on purpose.
 *
 * The fault this is written down from: the guard refused EVERY internalRoads key in
 * the previous S4 and absent from the latest S3. On 2026-09-29 St Ives Bus Station's
 * S3 deliberately dropped `skeletonMaxW` (buses-data OA-430), and the rollout could
 * not carry the removal, so the map was hand-built with build_s4.js and
 * seed_prev_s4.js instead. The rule is on staleS3Keys() in seed_prev_s4.js; the
 * fixtures below are that case and its controls, built by hand.
 */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_engine');
const { staleS3Keys, PLACE_WRITE_BACK_IR } = load('seed_prev_s4.js');

const S4 = { internalRoads: { skeletonMaxW: 40, fitExtra: ['a', 'b'], fitMargin: 8, keep: 1 } };

test('a key an earlier S3 held and the latest dropped is DROPPED, not stale', () => {
  const r = staleS3Keys({
    s3: { internalRoads: { fitExtra: ['a', 'b'], fitMargin: 8, keep: 1 } },
    s4: S4,
    earlierS3: [{ internalRoads: { skeletonMaxW: 40, keep: 1 } }],
  });
  assert.deepStrictEqual(r, { stale: [], dropped: ['internalRoads.skeletonMaxW'] });
});

test('a key no S3 ever held is STALE — it came from an edit of the S4', () => {
  const r = staleS3Keys({
    s3: { internalRoads: { fitExtra: ['a', 'b'], fitMargin: 8, keep: 1 } },
    s4: S4,
    earlierS3: [{ internalRoads: { keep: 1 } }],
  });
  assert.deepStrictEqual(r, { stale: ['internalRoads.skeletonMaxW'], dropped: [] });
});

test('a key the build writes back is STALE even when an earlier S3 held it', () => {
  // The 2026-08-24 case: St Neots Co-op and both Godmanchester Co-ops had fitExtra
  // in S4 and not S3, and a rollout would have re-fitted each map to one locality.
  for (const k of PLACE_WRITE_BACK_IR) {
    const s4 = { internalRoads: { [k]: 1 } };
    const r = staleS3Keys({ s3: { internalRoads: {} }, s4, earlierS3: [{ internalRoads: { [k]: 1 } }] });
    assert.deepStrictEqual(r, { stale: ['internalRoads.' + k], dropped: [] }, k);
  }
});

test('frequency and design.frequencyTiers missing from the S3 are STALE', () => {
  const r = staleS3Keys({
    s3: { design: {} },
    s4: { frequency: { x: 1 }, design: { frequencyTiers: [1] } },
    earlierS3: [{ frequency: { x: 1 }, design: { frequencyTiers: [1] } }],
  });
  assert.deepStrictEqual(r, { stale: ['frequency', 'design.frequencyTiers'], dropped: [] });
});

test('an S3 that holds every S4 key answers nothing', () => {
  assert.deepStrictEqual(staleS3Keys({ s3: S4, s4: S4, earlierS3: [] }), { stale: [], dropped: [] });
  assert.deepStrictEqual(staleS3Keys({ s3: {}, s4: {}, earlierS3: undefined }), { stale: [], dropped: [] });
});
