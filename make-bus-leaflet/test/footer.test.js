/*
 * footer.js — the attribution band every one of the four generators draws.
 *
 * Two shipped faults are the shape of these tests. The note wrapped by CHARACTER
 * COUNT at 0.52/char, and on the five place-external sheets — the only ones whose
 * attribution is one long concatenated string — it ran to x=240.8 mm on a band
 * ending at 177–195, straight through the "Latest version:" block and into the
 * QR's quiet zone. And footerPlateTop used to derive the plate independently of
 * footerBand from the same inputs, which was two chances to disagree about where
 * the plate that buries map content actually starts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('./_engine.js');
const { footerBand, footerPlateTop } = E.load('footer.js');
const FM = E.load('font_metrics.js');

// The real place-external attribution: one string, long enough that the wrap has
// to break it. This is the input the character-count wrap got wrong.
const LONG_NOTE = 'Service data from the Bus Open Data Service; stop names, bay numbers and bearings '
  + 'from NaPTAN (Open Government Licence v3.0). Base map data from OpenStreetMap contributors, '
  + 'ODbL. Route alignments checked against operator timetables. Not an official publication.';

const noteTexts = (svg) => [...svg.matchAll(/<text x="8"[^>]*fill="#666"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
const plateY = (svg) => {
  const m = svg.match(/<rect x="0" y="([\d.]+)"/);
  assert.ok(m, 'the band drew no backing plate');
  return +m[1];
};

test('a long note is wrapped to stop clear of the right-hand block', () => {
  const svg = footerBand({ notes: [LONG_NOTE], version: '1.0',
    url: 'busmaps.uk/m/st-ives', urlLabel: 'Check for a newer version:', size: 2.8 });
  const lines = noteTexts(svg);
  assert.ok(lines.length > 1, 'a long note came back as one line — the wrap did not run');

  // Where the right-hand block actually begins, read off the drawing rather than
  // recomputed: the label is end-anchored, so its left edge is its x minus its
  // measured width. Character-count wrapping put the note 46–64 mm past this.
  const lab = svg.match(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*text-anchor="end">Check for a newer version:</);
  assert.ok(lab, 'test premise: the URL label was drawn end-anchored');
  const blockLeft = +lab[1] - FM.textWidth('Check for a newer version:', +lab[2], false);

  for (const ln of lines) {
    const right = 8 + FM.textWidth(ln, 2.8, false);
    assert.ok(right < blockLeft,
      `a note line reaches x=${right.toFixed(1)} mm; the right-hand block starts at ${blockLeft.toFixed(1)} mm`);
  }
});

test('every wrapped line is a whole-word break, and nothing is lost', () => {
  const lines = noteTexts(footerBand({ notes: [LONG_NOTE], version: '1.0', size: 2.8 }));
  assert.strictEqual(lines.join(' ').replace(/\s+/g, ' ').trim(), LONG_NOTE.replace(/\s+/g, ' ').trim(),
    'the wrap dropped or duplicated words');
});

test('a short note passes through unsplit', () => {
  // Hand-authored multi-line notes must render exactly as written.
  const lines = noteTexts(footerBand({ notes: ['Data: BODS.', 'Base map: OpenStreetMap.'], version: '1.0' }));
  assert.deepStrictEqual(lines, ['Data: BODS.', 'Base map: OpenStreetMap.']);
});

test('the plate rises to cover a taller note, and the bottom line never moves', () => {
  // The version line and the wordmark sit on a FIXED baseline so all four map
  // types keep an identical bottom-right corner however many note lines they need.
  const one = footerBand({ notes: ['One short line.'], version: '1.0' });
  const many = footerBand({ notes: [LONG_NOTE], version: '1.0' });
  assert.ok(plateY(many) < plateY(one), 'a taller note did not push the plate up');
  const lastBaseline = (svg) => Math.max(...[...svg.matchAll(/<text[^>]*\by="([\d.]+)"/g)].map(m => +m[1]));
  assert.strictEqual(lastBaseline(one), lastBaseline(many),
    'the bottom baseline moved with the note count');
});

test('footerPlateTop and footerBand cannot disagree about where the plate starts', () => {
  // They are one layout computed once precisely because two derivations were two
  // chances to be wrong, and the caller uses footerPlateTop to decide whether its
  // own map content is about to be buried.
  for (const args of [
    { notes: ['One short line.'] },
    { notes: [LONG_NOTE] },
    { notes: [LONG_NOTE], url: 'busmaps.uk/m/st-ives', urlLabel: 'Check for a newer version:' },
    { notes: ['One short line.'], x0: 12, x1: 250, bottomY: 200, size: 2.4 },
  ]) {
    assert.strictEqual(plateY(footerBand({ ...args, version: '1.0' })), +footerPlateTop(args).toFixed(2),
      `plate top disagreed for ${JSON.stringify(args).slice(0, 60)}`);
  }
});

test('the note is wrapped narrower when a URL block shares the line', () => {
  // "Latest version: <url>" is end-anchored on the line above, so a note wrapped
  // to the full width runs the whole span underneath it with 0.6 mm of air.
  const bare = noteTexts(footerBand({ notes: [LONG_NOTE], version: '1.0' }));
  const withUrl = noteTexts(footerBand({ notes: [LONG_NOTE], version: '1.0',
    url: 'busmaps.uk/m/st-ives', urlLabel: 'Check for a newer version:' }));
  assert.ok(withUrl.length >= bare.length, 'the URL block did not narrow the note');
  const widest = (lines) => Math.max(...lines.map(l => FM.textWidth(l, 2.8, false)));
  assert.ok(widest(withUrl) <= widest(bare) + 1e-9, 'a note line grew when the band got busier');
});

test('the band is deterministic for the same arguments', () => {
  const args = { notes: [LONG_NOTE], version: '1.0', url: 'busmaps.uk/m/st-ives', sheetVersion: '2.1' };
  assert.strictEqual(footerBand(args), footerBand(args));
});
