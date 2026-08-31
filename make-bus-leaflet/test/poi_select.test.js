/*
 * poi_select — which points of interest reach the internal sheet, and as what.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). Unlike
 * strict_guards, this block is NOT dark to the byte gate: measured across the 20
 * committed maps, every optional branch is exercised by at least one of them —
 * poi.include by 1, industrialKeep as an array by 1, "none" by 15, defaulted by
 * 2, excludeName by 2, tidy by 9, canon by 2, and 2 maps carry no poi block at
 * all. So these assertions are not the safety net; the 20-map diff is.
 *
 * What they add is the properties the byte gate certifies only by accident of
 * which data happens to be committed today: that ORDER decides the answer.
 * De-duplication keeps the FIRST of a colliding pair, so the file order the
 * caller passes is load-bearing; and tidying runs BEFORE de-duplication, so two
 * spellings of one name collapse — swap those two steps and every map still
 * renders, most of them identically, and the one that does not looks like a data
 * change rather than a code change.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classify, selectPois } = require('./_engine.js').load('poi_select.js');

const node = (lat, lon, tags) => ({ lat, lon, tags });

test('an element with no recognised tag is not a POI at all', () => {
  assert.strictEqual(classify({ amenity: 'bench' }, {}), null);
  assert.strictEqual(classify({}, {}), null);
});

test('classification is first-match, so a school tagged as a park stays a school', () => {
  assert.deepStrictEqual(classify({ amenity: 'school', leisure: 'park', name: 'Ash School' }, {}),
    ['school', 'Ash School']);
});

test('allotments are opt-in per town, and land in "industrial" for nobody', () => {
  assert.strictEqual(classify({ landuse: 'allotments', name: 'Broad Leas' }, {}), null);
  assert.deepStrictEqual(classify({ landuse: 'allotments', name: 'Broad Leas' }, { include: ['allotments'] }),
    ['allotments', 'Broad Leas']);
});

test('a way with only a centre is placed at its centre', () => {
  const out = selectPois([[{ center: { lat: 52.3, lon: -0.07 }, tags: { amenity: 'library' } }]], {});
  assert.deepStrictEqual(out, [{ cat: 'library', name: 'Library', ll: [52.3, -0.07] }]);
});

test('de-duplication keeps the FIRST of a pair, so the caller\'s file order decides the answer', () => {
  const a = [node(52.3, -0.07, { shop: 'supermarket', name: 'Co-op' })];
  const b = [node(52.4, -0.08, { shop: 'supermarket', name: 'Co-op' })];
  assert.deepStrictEqual(selectPois([a, b], {})[0].ll, [52.3, -0.07]);
  assert.deepStrictEqual(selectPois([b, a], {})[0].ll, [52.4, -0.08]);
});

test('the same place mapped as node and building collapses — under 60 m, same category', () => {
  const close = selectPois([[node(52.3, -0.07, { shop: 'supermarket', name: 'Tesco' }),
                            node(52.30035, -0.07, { shop: 'supermarket', name: 'Tesco Extra' })]], {});
  assert.strictEqual(close.length, 1, '39 m apart is one shop mapped twice');
  const apart = selectPois([[node(52.3, -0.07, { shop: 'supermarket', name: 'Tesco' }),
                             node(52.302, -0.07, { shop: 'supermarket', name: 'Tesco Extra' })]], {});
  assert.strictEqual(apart.length, 2, '220 m apart is two shops');
});

test('a near-duplicate in a DIFFERENT category is a different place and survives', () => {
  const out = selectPois([[node(52.3, -0.07, { shop: 'supermarket', name: 'Co-op' }),
                           node(52.30005, -0.07, { amenity: 'pharmacy', name: 'Co-op Pharmacy' })]], {});
  assert.strictEqual(out.length, 2);
});

test('tidying runs BEFORE de-duplication, so two spellings of one name collapse', () => {
  const out = selectPois([[node(52.3, -0.07, { amenity: 'school', name: 'St Ivo Academy (Upper)' }),
                           node(52.9, -0.9, { amenity: 'school', name: 'St Ivo Academy' })]], {});
  assert.strictEqual(out.length, 1, 'the bracket strip makes these the same name');
  assert.strictEqual(out[0].name, 'St Ivo Academy');
});

test('per-town tidy replaces a suffix; canon replaces the whole name, case-insensitively', () => {
  const out = selectPois([[node(52.3, -0.07, { shop: 'supermarket', name: 'Waitrose & Partners' }),
                           node(52.9, -0.9, { amenity: 'doctors', name: 'THE OLD SURGERY' })]],
    { tidy: [[' & Partners$', '']], canon: [['^the old surgery$', 'Health Centre']] });
  assert.deepStrictEqual(out.map(p => p.name), ['Waitrose', 'Health Centre']);
});

test('a tidy rule must consume its own leading space — nothing trims the name again after it', () => {
  // The generic strip ends in .trim(), and the per-town rules run AFTER it, so a
  // rule anchored on the suffix alone leaves the space in front of it behind.
  // Measured 2026-08-27: 0 of the 532 POIs across the 20 committed maps are
  // affected, because every committed tidy rule happens to take its own space.
  // That makes this a trap for the next rule written, not a live defect — and
  // re-trimming here would move bytes on the nine maps that use tidy.
  const out = selectPois([[node(52.3, -0.07, { shop: 'supermarket', name: 'Waitrose & Partners' })]],
    { tidy: [['& Partners$', '']] });
  assert.strictEqual(out[0].name, 'Waitrose ');
});

test('industrialKeep: default keeps named estates, "none" drops all, an array keeps that list', () => {
  const els = [[node(52.3, -0.07, { landuse: 'industrial', name: 'Compass Point' }),
                node(52.9, -0.9, { landuse: 'industrial' })]];
  assert.deepStrictEqual(selectPois(els, {}).map(p => p.name), ['Compass Point'],
    'an unnamed estate reads as "Industrial Estate", which names nothing');
  assert.deepStrictEqual(selectPois(els, { industrialKeep: 'none' }), []);
  assert.deepStrictEqual(selectPois(els, { industrialKeep: ['Somewhere Else'] }), []);
  assert.deepStrictEqual(selectPois(els, { industrialKeep: ['Compass Point'] }).map(p => p.name), ['Compass Point']);
});

test('excludeName is one alternation over EVERY category, not just industrial', () => {
  const els = [[node(52.3, -0.07, { shop: 'supermarket', name: 'Petrol Station Shop' }),
                node(52.9, -0.9, { amenity: 'school', name: 'Ash School' })]];
  assert.deepStrictEqual(selectPois(els, { excludeName: ['petrol'] }).map(p => p.name), ['Ash School']);
});

test('an unnamed green names nothing and is always dropped, opted in or not', () => {
  const els = [[node(52.3, -0.07, { leisure: 'park' }),
                node(52.9, -0.9, { leisure: 'recreation_ground', name: 'Hill Rise' })]];
  assert.deepStrictEqual(selectPois(els, {}).map(p => p.name), ['Hill Rise']);
});

test('no poi block at all is a valid town, and two of the committed maps are one', () => {
  const out = selectPois([[node(52.3, -0.07, { amenity: 'townhall' })]], undefined);
  assert.deepStrictEqual(out, [{ cat: 'townhall', name: 'Town Hall', ll: [52.3, -0.07] }]);
});

/*
 * TIERS — the customer's must / may / miss answer (OA-202, 2026-08-31).
 *
 * These ARE the safety net, unlike everything above them: not one committed map
 * carried a `poi.tiers` block on the day the block was written, so the 20-map
 * byte diff certifies exactly one property of it — that it changes nothing when
 * absent — and says nothing whatever about what it does when present. The two
 * that matter most are the ones a passing build cannot show you: a key that
 * matched nothing did nothing, and a tier attached to a POI that de-duplication
 * was about to throw away would have been recorded as applied while no sheet
 * changed. That second one is why applyTiers runs LAST.
 */
test('tiers: absent means byte-identical, which is what lets it ship unrolled', () => {
  const els = [[node(52.3, -0.07, { amenity: 'school', name: 'Ash School' })]];
  assert.deepStrictEqual(selectPois(els, {}), selectPois(els, { tiers: undefined }));
});

test('tiers: "miss" drops the POI at SELECTION, so it never reserves a box', () => {
  const els = [[node(52.3, -0.07, { amenity: 'school', name: 'Ash School' }),
                node(52.9, -0.9, { amenity: 'school', name: 'Elm School' })]];
  assert.deepStrictEqual(selectPois(els, { tiers: { 'school:Ash School': 'miss' } }).map(p => p.name),
    ['Elm School']);
});

test('tiers: "must" marks the POI and leaves everything else alone', () => {
  const els = [[node(52.3, -0.07, { amenity: 'community_centre', name: 'The Hive' })]];
  const out = selectPois(els, { tiers: { 'community:The Hive': 'must' } });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tier, 'must');
  assert.strictEqual(out[0].name, 'The Hive');
});

test('tiers: "may" is the default and adds no tier field, so an unclassified map is unchanged', () => {
  const els = [[node(52.3, -0.07, { amenity: 'school', name: 'Ash School' })]];
  assert.strictEqual(selectPois(els, { tiers: { 'school:Ash School': 'may' } })[0].tier, undefined);
  assert.strictEqual(selectPois(els, {})[0].tier, undefined);
});

test('tiers: "as" renames, and the rename REPLACES the identity every override keys on', () => {
  const els = [[node(52.3, -0.07, { amenity: 'community_centre', name: 'Priory Centre Community Hall' })]];
  const out = selectPois(els, { tiers: { 'community:Priory Centre Community Hall': { tier: 'must', as: 'Priory Centre' } } });
  assert.strictEqual(out[0].name, 'Priory Centre');
  assert.strictEqual(out[0].tier, 'must');
});

test('tiers: "as" alone renames without promoting, because a shorter name is not a claim about value', () => {
  const els = [[node(52.3, -0.07, { amenity: 'school', name: 'Ash Hill Primary School' })]];
  const out = selectPois(els, { tiers: { 'school:Ash Hill Primary School': { as: 'Ash Hill' } } });
  assert.strictEqual(out[0].name, 'Ash Hill');
  assert.strictEqual(out[0].tier, undefined);
});

test('tiers: the key is read AFTER tidy and canon, not against the raw OSM name', () => {
  const els = [[node(52.3, -0.07, { shop: 'supermarket', name: 'Co-op Food (Market Hill)' })]];
  const cfg = { canon: [['co-?op', 'Co-op']], tiers: { 'shop:Co-op': 'miss' } };
  assert.deepStrictEqual(selectPois(els, cfg), [], 'the tidied name is the identity');
  const raw = { canon: [['co-?op', 'Co-op']], tiers: { 'shop:Co-op Food (Market Hill)': 'miss' } };
  assert.strictEqual(selectPois(els, raw).length, 1, 'the raw name is not, and must be reported instead');
});

test('tiers: a key that matched nothing is REPORTED, never silently ignored', () => {
  const els = [[node(52.3, -0.07, { amenity: 'school', name: 'Ash School' })]];
  const report = {};
  selectPois(els, { tiers: { 'school:Ash School': 'must', 'shop:Nowhere': 'miss' } }, report);
  assert.deepStrictEqual(report.unknownTierKeys, ['shop:Nowhere']);
  assert.deepStrictEqual(report.tierCounts, { must: 1, may: 0, miss: 1 });
});

test('tiers run AFTER de-duplication, so a tier cannot attach to the copy being thrown away', () => {
  // Two spellings of one shop, 20 m apart: dedup keeps the FIRST. Tiering earlier
  // would have marked the SECOND and reported the key as applied, and no sheet
  // would have changed. The key here names the survivor, which is the only
  // identity that can reach a page.
  const els = [[node(52.3000, -0.0700, { shop: 'supermarket', name: 'Co-op' }),
                node(52.3001, -0.0700, { shop: 'supermarket', name: 'Co-op Food' })]];
  assert.strictEqual(selectPois(els, {}).length, 1);
  const report = {};
  assert.deepStrictEqual(selectPois(els, { tiers: { 'shop:Co-op Food': 'miss' } }, report).map(p => p.name),
    ['Co-op'], 'the discarded duplicate is not classifiable, because it is not on the sheet');
  assert.deepStrictEqual(report.unknownTierKeys, ['shop:Co-op Food']);
});

test('tiers: a rename that collides is reported, because two POIs cannot share one key', () => {
  const els = [[node(52.30, -0.07, { amenity: 'school', name: 'Ash Hill Primary' }),
                node(52.90, -0.90, { amenity: 'school', name: 'Ash Hill Junior' })]];
  const report = {};
  const out = selectPois(els, { tiers: { 'school:Ash Hill Primary': { as: 'Ash Hill' },
                                         'school:Ash Hill Junior': { as: 'Ash Hill' } } }, report);
  assert.strictEqual(out.length, 2, 'both are still drawn — this reports, it does not repair');
  assert.deepStrictEqual(report.renameCollisions, ['school:Ash Hill']);
});
