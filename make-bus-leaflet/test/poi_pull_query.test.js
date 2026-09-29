/*
 * poi_pull_query — the town POI pull must ASK for every category a town can
 * switch on, or switching it on draws nothing.
 *
 * WHY (2026-09-27). `poi.include` opts a town into `allotments`, `pubs` and
 * `stations`, and classify() draws them — but only out of the elements S2
 * fetched. The town pull template `assets/overpass-pois.txt` asked for stations
 * and for neither of the other two, and `draft_town.py`'s `pois_query()`, the
 * same query written a second time for the unattended drafter, asked for none of
 * the three. Beaconsfield switched pubs on (OA-340) and has its nine pubs only
 * because a one-off `pull_pubs.py` appended them to `osm2.json`; its `osm.json`,
 * from the town pull, holds none. A fresh pull would have rebuilt that town with
 * the switch on and no pub on the page, and nothing would have said so: an
 * opt-in category with nothing to classify is indistinguishable from a town
 * with no pubs.
 *
 * The opt-in set is the engine's own OPT_IN_CATS rather than typed here, so a
 * sixth switch added there fails this test until the pull asks for it. It was
 * read out of classify()'s `on('…')` calls until OA-517, when classify() began
 * sorting by tag alone and the switch moved after it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine.js');
const { classify, selectPois, categoryOn, OPT_IN_CATS, SWITCH_CAT } = load('poi_select.js');

/* One OSM tag set per opt-in category, as OpenStreetMap writes it. */
const SAMPLES = {
  allotments: [{ landuse: 'allotments', name: 'Broad Leas' }],
  pubs: [{ amenity: 'pub', name: 'The Chiltern' }],
  stations: [{ railway: 'station', name: 'St Neots' }, { railway: 'halt', name: 'Manea' }],
  postoffices: [{ amenity: 'post_office', name: 'Ramsey Post Office' }],
  industrial: [{ landuse: 'industrial', name: 'Compass Point' }],
};

/* The always-drawn categories whose tags the 28 September review (OA-500) found
 * missing or mismatched: the pull asked for amenity=museum and the reader read
 * tourism=museum, and cinema, college and university were not asked for at all. */
const ALWAYS = [
  { amenity: 'hospital', name: 'Doddington Hospital' }, { amenity: 'theatre', name: 'Wycombe Swan' },
  { amenity: 'arts_centre', name: 'Priory Centre' }, { amenity: 'cinema', name: 'Cineworld' },
  { amenity: 'college', name: 'Huntingdonshire Regional College' }, { amenity: 'university', name: 'Bucks New' },
  { amenity: 'museum', name: 'Norris Museum' }, { tourism: 'museum', name: 'Norris Museum' },
];


/* The query's selectors as [type, [[key, op, value]...]]. Only the two forms the
 * pull uses: ["k"="v"] and ["k"~"^(a|b)$"]. */
function selectors(query) {
  const out = [];
  for (const m of query.matchAll(/^\s*(node|way|relation)((?:\["[^"]+"[=~]"[^"]+"\])+)\(/gm)) {
    const clauses = [...m[2].matchAll(/\["([^"]+)"([=~])"([^"]+)"\]/g)].map(c => [c[1], c[2], c[3]]);
    out.push([m[1], clauses]);
  }
  return out;
}

const clauseMatches = (tags, [k, op, v]) =>
  k in tags && (op === '=' ? tags[k] === v : new RegExp(v).test(tags[k]));

const asksFor = (sels, type, tags) =>
  sels.some(([t, cl]) => t === type && cl.every(c => clauseMatches(tags, c)));

const TEMPLATE = fs.readFileSync(path.join(ENGINE_DIR, 'overpass-pois.txt'), 'utf8');
const draftSrc = fs.readFileSync(path.join(ENGINE_DIR, 'draft_town.py'), 'utf8');
const DRAFT = (draftSrc.match(/def pois_query\(bbox\):[\s\S]*?out center tags;"""/) || [''])[0];

test('the opt-in categories named here are exactly the engine\'s switches, and classify() sorts each', () => {
  assert.deepStrictEqual(Object.keys(SAMPLES).sort(), [...OPT_IN_CATS].sort(),
    'the engine gained or lost a poi.include category: add its OSM tags to SAMPLES and to both POI pulls');
  for (const [cat, samples] of Object.entries(SAMPLES))
    for (const tags of samples) assert.strictEqual((classify(tags, {}) || [])[0], SWITCH_CAT[cat], JSON.stringify(tags));
});

test('each sample is drawn when its category is on, and not when it is switched off', () => {
  const drawn = (tags, poi) => selectPois([[{ lat: 52.3, lon: -0.07, tags }]], poi).length === 1;
  for (const [cat, samples] of Object.entries(SAMPLES)) {
    for (const tags of samples) {
      assert.strictEqual(drawn(tags, {}), categoryOn({}, cat), `${cat} does not follow its default`);
      assert.ok(drawn(tags, { include: [cat] }), `${cat} not drawn when switched on`);
      assert.ok(!drawn(tags, { exclude: [cat] }), `${cat} drawn when switched off`);
    }
  }
});

test('every always-drawn sample is drawn for a town that has said nothing', () => {
  for (const tags of ALWAYS) assert.notStrictEqual(classify(tags, {}), null, JSON.stringify(tags));
});

test('the selector reader finds the always-on categories and refuses a tag nobody asked for', () => {
  for (const [name, query] of [['overpass-pois.txt', TEMPLATE], ['draft_town.py pois_query()', DRAFT]]) {
    const sels = selectors(query);
    assert.ok(asksFor(sels, 'way', { shop: 'supermarket' }), `${name}: supermarket not found — the reader is broken`);
    assert.ok(asksFor(sels, 'node', { amenity: 'pharmacy' }), `${name}: pharmacy not found — the reader is broken`);
    assert.ok(!asksFor(sels, 'node', { amenity: 'bench' }), `${name}: a bench matched — the reader is too lax`);
  }
});

for (const [name, query] of [['overpass-pois.txt', TEMPLATE], ['draft_town.py pois_query()', DRAFT]]) {
  test(`${name} asks for every opt-in category, as a node and as a way`, () => {
    assert.ok(query.length > 0, `${name}: query not found`);
    const sels = selectors(query);
    for (const [cat, samples] of Object.entries(SAMPLES)) {
      for (const tags of samples) {
        for (const type of ['node', 'way']) {
          assert.ok(asksFor(sels, type, tags),
            `${name} does not ask for ${type} ${JSON.stringify(tags)}, so poi.include: ["${cat}"] would draw nothing from a fresh pull`);
        }
      }
    }
  });

  test(`${name} asks for every always-drawn category the review fixed, as a node and as a way`, () => {
    const sels = selectors(query);
    for (const tags of ALWAYS) for (const type of ['node', 'way'])
      assert.ok(asksFor(sels, type, tags), `${name} does not ask for ${type} ${JSON.stringify(tags)}`);
  });
}
