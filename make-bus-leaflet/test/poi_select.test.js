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
const { classify, selectPois, sameThing, unnamed, CATEGORY_LABELS, printsName } =
  require('./_engine.js').load('poi_select.js');

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
  // NAMED on purpose since OA-338: an unnamed library is called `Library`, which
  // is a category label rather than a name, so it now defaults to `miss` and this
  // test would be asserting the tier rule instead of the coordinate one.
  const out = selectPois([[{ center: { lat: 52.3, lon: -0.07 }, tags: { amenity: 'library', name: 'Ash Library' } }]], {});
  assert.deepStrictEqual(out, [{ cat: 'library', name: 'Ash Library', ll: [52.3, -0.07] }]);
});

test('de-duplication keeps the FIRST of a pair, so the caller\'s file order decides the answer', () => {
  // 110 m apart, and BOTH HALVES OF THIS TEST ARE NOW LOAD-BEARING. It used to
  // use two Co-ops 11 km apart and assert only `[0]`, so it passed whether the
  // pair collapsed or not -- it could not tell the rule it is named after from
  // its absence. OA-338 makes those two Co-ops survive as two, which is correct
  // and would have left this test green for a brand new reason. The length
  // assertion is what makes the order claim mean anything.
  const a = [node(52.3, -0.07, { shop: 'supermarket', name: 'Co-op' })];
  const b = [node(52.301, -0.07, { shop: 'supermarket', name: 'Co-op' })];
  assert.strictEqual(selectPois([a, b], {}).length, 1, 'one Co-op mapped twice');
  assert.deepStrictEqual(selectPois([a, b], {})[0].ll, [52.3, -0.07]);
  assert.deepStrictEqual(selectPois([b, a], {})[0].ll, [52.301, -0.07]);
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
  // 110 m apart since OA-338, and the distance is now part of the claim: an
  // identical name collapses within 250 m because one site is often mapped as
  // two ways, and beyond that a shared name is a chain rather than a duplicate.
  // The subject here is still the ORDER -- tidy runs first, so these are one name
  // by the time dedup looks -- and the pair has to be close enough for that to be
  // the only thing under test.
  const out = selectPois([[node(52.3, -0.07, { amenity: 'school', name: 'St Ivo Academy (Upper)' }),
                           node(52.301, -0.07, { amenity: 'school', name: 'St Ivo Academy' })]], {});
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
  // NAMED since OA-338, for the reason given on the centre test above.
  const out = selectPois([[node(52.3, -0.07, { amenity: 'townhall', name: 'Ash Town Hall' })]], undefined);
  assert.deepStrictEqual(out, [{ cat: 'townhall', name: 'Ash Town Hall', ll: [52.3, -0.07] }]);
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

/* ------------------------------------------------------------------------- *
 * OA-234 and OA-238, landed together on 2026-09-04 inside OA-229's rollout.
 *
 * They are two halves of one silence. De-duplication compared two BLANK names
 * and found them equal, so the second unnamed chemist in a town was deleted at
 * any distance whatever — no candidate, no chooser row, no key, no error. And
 * the fix for that is what makes the second half necessary: once both survive,
 * a default of `may` would draw two nameless symbols nobody asked for, and a
 * default of "drop" would offer the local one row and lose the other, which is
 * the same silence arrived at deliberately.
 *
 * `classify()` supplies a fallback name for every category except `pharmacy` and
 * `gp`, so those two tags are the entire population of both rows. Everything
 * below uses them for that reason and not for flavour.
 * ------------------------------------------------------------------------- */

test('OA-234: two unnamed POIs of one category, far apart, are TWO — they used to be one', () => {
  // The exact measurement the row was re-diagnosed on: 5.5 km apart, both
  // nameless. Before the fix this returned a single {cat:'pharmacy', name:''}.
  const els = [[node(52.30, -0.07, { amenity: 'pharmacy' }),
                node(52.35, -0.07, { amenity: 'pharmacy' })]];
  const report = {};
  selectPois(els, {}, report);
  assert.strictEqual(report.candidates.length, 2,
    'the second unnamed pharmacy is deleted again — this is the OA-234 regression');
  assert.deepStrictEqual(report.candidates.map(c => c.key), ['pharmacy:', 'pharmacy:']);
});

test('OA-234: 60 m still collapses two unnamed POIs, because that is the same place mapped twice', () => {
  // The control. near() is the question the blank-name arm was always meant to be
  // asking, and removing the name arm must not have removed that one.
  const els = [[node(52.3000, -0.0700, { amenity: 'pharmacy' }),
                node(52.3001, -0.0700, { amenity: 'pharmacy' })]];
  const report = {};
  selectPois(els, {}, report);
  assert.strictEqual(report.candidates.length, 1);
});

test('OA-234: two NAMED POIs of one category far apart are still two (the untouched control)', () => {
  const els = [[node(52.30, -0.07, { shop: 'supermarket', name: 'Aldi' }),
                node(52.35, -0.07, { shop: 'supermarket', name: 'Lidl' })]];
  assert.deepStrictEqual(selectPois(els, {}).map(p => p.name), ['Aldi', 'Lidl']);
});

test('OA-234: two candidates sharing one key are REPORTED, which was unreachable before', () => {
  const els = [[node(52.30, -0.07, { amenity: 'pharmacy' }),
                node(52.35, -0.07, { amenity: 'pharmacy' })]];
  const report = {};
  selectPois(els, {}, report);
  assert.deepStrictEqual(report.duplicateCandidateKeys, ['pharmacy:'],
    'the key both survivors share has to be said out loud — nothing downstream can hold two');
  // Named POIs cannot collide here: dedup already removed equal names.
  const clean = {};
  selectPois([[node(52.30, -0.07, { shop: 'supermarket', name: 'Aldi' })]], {}, clean);
  assert.deepStrictEqual(clean.duplicateCandidateKeys, []);
});

test('OA-238: a nameless POI is NOT DRAWN by default, in a town that has classified nothing', () => {
  // Huntingdon and St Neots are exactly this case — no poi.tiers block at all —
  // and they are the two sheets the estate loses a symbol on. An early return on a
  // missing tiers block would have made this change do nothing where it matters.
  const els = [[node(52.30, -0.07, { amenity: 'pharmacy' }),
                node(52.31, -0.07, { amenity: 'doctors' }),
                node(52.32, -0.07, { shop: 'supermarket', name: 'Aldi' })]];
  assert.deepStrictEqual(selectPois(els, {}).map(p => p.name), ['Aldi'],
    'the nameless chemist and surgery keep their box for a glyph nobody chose');
});

test('OA-238: and it is STILL OFFERED — the row survives in candidates, marked miss', () => {
  // The half that makes this Peter's answer rather than "just drop them". A POI
  // absent from report.candidates could not be shown to the local as missed and
  // could never be turned back on.
  const els = [[node(52.30, -0.07, { amenity: 'pharmacy' })]];
  const report = {};
  selectPois(els, {}, report);
  assert.strictEqual(report.candidates.length, 1);
  assert.deepStrictEqual(
    { key: report.candidates[0].key, tier: report.candidates[0].tier, printsName: report.candidates[0].printsName },
    { key: 'pharmacy:', tier: 'miss', printsName: false });
});

test('OA-238: naming it with "as" promotes it, which is one of the two answers the local has', () => {
  const els = [[node(52.30, -0.07, { amenity: 'pharmacy' })]];
  const out = selectPois(els, { tiers: { 'pharmacy:': { as: 'Boots' } } });
  assert.deepStrictEqual(out.map(p => p.name), ['Boots'],
    'an object with no explicit tier reads as may, so naming it draws it');
});

test('OA-238: an explicit answer beats the default in BOTH directions', () => {
  const els = [[node(52.30, -0.07, { amenity: 'pharmacy' })]];
  // High Wycombe's routes.json says exactly this, which is why the estate loses
  // two symbols under this change and not the three the row predicted.
  const report = {};
  assert.strictEqual(selectPois(els, { tiers: { 'pharmacy:': 'may' } }, report).length, 1);
  assert.deepStrictEqual(report.namelessKeptByTier, ['pharmacy:'],
    'a sheet that disagrees with the default has to say so at build time');
  assert.strictEqual(selectPois(els, { tiers: { 'pharmacy:': 'must' } })[0].tier, 'must');
  // and a miss on a named POI is unchanged
  assert.deepStrictEqual(
    selectPois([[node(52.30, -0.07, { shop: 'supermarket', name: 'Aldi' })]], { tiers: { 'shop:Aldi': 'miss' } }), []);
});

test('OA-238: a nameless POI kept by default reports NOTHING, so the note means what it says', () => {
  // The control for namelessKeptByTier. Every named POI in an unclassified town
  // must leave it empty, or the message fires on every build of every town and is
  // muted inside a week.
  const report = {};
  selectPois([[node(52.30, -0.07, { shop: 'supermarket', name: 'Aldi' }),
               node(52.31, -0.07, { amenity: 'pharmacy' })]], {}, report);
  assert.deepStrictEqual(report.namelessKeptByTier, []);
});

test('OA-238 did not disturb the no-tiers path for named POIs', () => {
  // The early `if(!TIERS) return pois` had to go so the nameless default could
  // reach an unclassified town. This is the assertion that removing it changed
  // nothing else: a town with no tiers block still gets exactly its named POIs,
  // in order, untouched, and with no tier property on any of them.
  // The library is NAMED since OA-338 -- an unnamed one is called `Library`, a
  // category label, and defaults to `miss` like any other unnamed POI, so it
  // would drop out of this list and the test would be about tiers again.
  const els = [[node(52.30, -0.07, { shop: 'supermarket', name: 'Aldi' }),
                node(52.35, -0.07, { amenity: 'library', name: 'Ash Library' }),
                node(52.36, -0.07, { amenity: 'school', name: 'Ash School' })]];
  assert.deepStrictEqual(selectPois(els, {}), selectPois(els, { tiers: undefined }));
  assert.deepStrictEqual(selectPois(els, {}).map(p => [p.cat, p.name, p.tier]),
    [['shop', 'Aldi', undefined], ['library', 'Ash Library', undefined], ['school', 'Ash School', undefined]]);
});

/* ---------------------------------------------------------------------------
 * OA-338 - a category label is not a name, 2026-09-13.
 *
 * `classify()` supplies `Library`, `Leisure`, `School` and the rest when
 * OpenStreetMap has not named the place. That string is for DISPLAY, and three
 * other things were reading it as an identity: the de-duplication key, the
 * does-this-have-a-name default, and printsName. Measured across the eight town
 * sheets on the day: 32 real places deleted by the name arm alone - four Boots
 * in Wisbech drawn as one, five libraries in High Wycombe drawn as one - and ten
 * more by the distance arm, including Boots 24 m from Superdrug on the St Neots
 * sheet. Every case below is one of those, reduced.
 * ------------------------------------------------------------------------- */

test('OA-338: the label set is DERIVED from classify(), not typed beside it', () => {
  // The one assertion that stops a new category with a new fallback escaping the
  // rule silently. Every fallback classify() can return must be in the set, and
  // the set must not name a string classify() never produces.
  const cases = [
    [{ shop: 'supermarket' }, 'Supermarket'], [{ amenity: 'library' }, 'Library'],
    [{ tourism: 'museum' }, 'Museum'], [{ amenity: 'townhall' }, 'Town Hall'],
    [{ amenity: 'community_centre' }, 'Community Centre'],
    [{ leisure: 'sports_centre' }, 'Leisure'], [{ amenity: 'school' }, 'School'],
    [{ leisure: 'park' }, 'Park'], [{ landuse: 'allotments' }, 'Allotments'],
    [{ landuse: 'industrial' }, 'Industrial Estate'],
  ];
  const produced = new Set();
  for (const [tags, label] of cases) {
    const c = classify(tags, { include: ['allotments'] });
    assert.ok(c, JSON.stringify(tags) + ' should classify');
    assert.strictEqual(c[1], label, JSON.stringify(tags) + ' falls back to ' + label);
    produced.add(c[1]);
  }
  assert.deepStrictEqual([...produced].sort(), [...CATEGORY_LABELS].sort(),
    'CATEGORY_LABELS must be exactly the fallbacks classify() produces');
  // pharmacy and gp are the two that fall back to nothing at all
  assert.strictEqual(classify({ amenity: 'pharmacy' }, {})[1], '');
  assert.strictEqual(classify({ amenity: 'doctors' }, {})[1], '');
  assert.ok(unnamed('') && unnamed('Library') && !unnamed('Ash Library'));
});

test('OA-338: classify KEEPS the real name for library, museum and town hall', () => {
  // It used to return the constant whatever the tags said, so every library in a
  // town was one POI called `Library` and the name arm collapsed them all. High
  // Wycombe has five, all named in OpenStreetMap, and drew one.
  assert.strictEqual(classify({ amenity: 'library', name: 'Hazlemere Library' }, {})[1], 'Hazlemere Library');
  assert.strictEqual(classify({ tourism: 'museum', name: 'Wycombe Museum' }, {})[1], 'Wycombe Museum');
  assert.strictEqual(classify({ amenity: 'townhall', name: 'Ramsey Town Council' }, {})[1], 'Ramsey Town Council');
});

test('OA-338: five named libraries across a town are five POIs, and used to be one', () => {
  const els = [[node(51.64, -0.75, { amenity: 'library', name: 'Hazlemere Library' }),
                node(51.63, -0.75, { amenity: 'library', name: 'High Wycombe Library' }),
                node(51.64, -0.80, { amenity: 'library', name: 'West Wycombe Community Library' }),
                node(51.62, -0.73, { amenity: 'library', name: 'Micklefield Library' }),
                node(51.61, -0.77, { amenity: 'library', name: 'Flackwell Heath Library' })]];
  assert.strictEqual(selectPois(els, {}).length, 5);
});

test('OA-338: two DIFFERENT names 24 m apart are two places - the Boots case', () => {
  // St Neots draws four pharmacy symbols for five pharmacies: Boots is 24 m from
  // Superdrug, arrives second, and was deleted. Neither prints a name, so the
  // sheet lost a chemist invisibly and every gate stayed green.
  const els = [[node(52.2286, -0.2690, { amenity: 'pharmacy', name: 'Superdrug' }),
                node(52.2288, -0.2690, { amenity: 'pharmacy', name: 'Boots' })]];
  assert.deepStrictEqual(selectPois(els, {}).map(p => p.name), ['Superdrug', 'Boots']);
});

test('OA-338: but one name INSIDE the other, that close, is one place mapped twice', () => {
  // The control for the case above, and the reason the rule is containment rather
  // than inequality: `Tesco` and `Tesco Extra` 39 m apart are one shop.
  const close = [[node(52.3, -0.07, { shop: 'supermarket', name: 'Tesco' }),
                  node(52.30035, -0.07, { shop: 'supermarket', name: 'Tesco Extra' })]];
  assert.strictEqual(selectPois(close, {}).length, 1);
  const apart = [[node(52.3, -0.07, { shop: 'supermarket', name: 'Tesco' }),
                  node(52.302, -0.07, { shop: 'supermarket', name: 'Tesco Extra' })]];
  assert.strictEqual(selectPois(apart, {}).length, 2, '220 m apart is two shops');
});

test('OA-338: one name, 250 m is one site; beyond it is a chain', () => {
  const site = [[node(52.66, 0.16, { amenity: 'school', name: 'High March' }),
                 node(52.6616, 0.16, { amenity: 'school', name: 'High March' })]];
  assert.strictEqual(selectPois(site, {}).length, 1, '178 m - one school mapped as two ways');
  const chain = [[node(52.66, 0.16, { amenity: 'pharmacy', name: 'Boots' }),
                  node(52.664, 0.16, { amenity: 'pharmacy', name: 'Boots' })]];
  assert.strictEqual(selectPois(chain, {}).length, 2, '444 m - two branches, and Wisbech has four');
});

test('OA-338: an unnamed POI wearing a label defaults to miss, and is still OFFERED', () => {
  // Wisbech has four unnamed sports centres. They collapsed to one, and the one
  // printed the word `Leisure` on the sheet, because `leisure` is auto-named and
  // the label read as a name. Now: four candidates, none drawn.
  const els = [[node(52.660, 0.160, { leisure: 'sports_centre' }),
                node(52.664, 0.162, { leisure: 'sports_centre' }),
                node(52.670, 0.170, { leisure: 'sports_centre' }),
                node(52.680, 0.180, { leisure: 'sports_centre' })]];
  const report = {};
  assert.deepStrictEqual(selectPois(els, {}, report), [], 'none is drawn');
  assert.strictEqual(report.candidates.length, 4, 'all four are offered in the chooser');
  assert.ok(report.candidates.every(c => c.tier === 'miss'));
  // and the town can still say otherwise, which is what keeps it a default
  const kept = selectPois(els, { tiers: { 'leisure:Leisure': 'may' } });
  assert.strictEqual(kept.length, 4, 'an explicit answer still wins, in both directions');
});

test('OA-338: printsName reads the same label list, so `Leisure` prints nothing', () => {
  assert.strictEqual(printsName({ cat: 'leisure', name: 'Leisure' }), false);
  assert.strictEqual(printsName({ cat: 'park', name: 'Park' }), false, 'the original instance');
  assert.strictEqual(printsName({ cat: 'leisure', name: 'One Leisure' }), true);
  assert.strictEqual(printsName({ cat: 'pharmacy', name: 'Boots' }), false, 'symbol-only category');
});

test('OA-338: sameThing is symmetric, and a different category is never the same thing', () => {
  const a = { cat: 'shop', name: 'Tesco', ll: [52.3, -0.07] };
  const b = { cat: 'shop', name: 'Tesco Extra', ll: [52.30035, -0.07] };
  assert.strictEqual(sameThing(a, b), sameThing(b, a));
  assert.strictEqual(sameThing(a, Object.assign({}, b, { cat: 'pharmacy' })), false);
});

