#!/usr/bin/env node
/*
 * contact_sheet.js — the then-and-now review artefact: every sheet on the board,
 * old beside new, with both defect rows and the LABEL-SET DIFF.
 *
 * Written 2026-08-16 for Phase 8 item 0b of the label-and-design-quality plan.
 * The reason it exists is in that plan: Phase 8's original review artefact was
 * "a green board across 8 towns + 5 places", and a green board proves the
 * generators are DETERMINISTIC, not that the sheets got better. Worse, a defect
 * total can be improved by printing less — 94 labels are dropped board-wide and
 * nothing counted them for four sessions — so the total on its own cannot answer
 * "no worse". The label-set diff can, which is why it is on every row here and
 * not in an appendix.
 *
 *   node contact_sheet.js --rev 9ec8106 --out ../../Development\ Docs/x.html
 *
 * Flags:
 *   --rev <git-rev>   the OLD side: a commit in the buses-data repo whose
 *                     ci-reference SVGs are the before. Default 9ec8106, the
 *                     parent of "Roll out design-quality Phases 1-4".
 *   --buses <dir>     the buses-data working tree (default the usual path)
 *   --out <file.html> where to write. Self-contained: images are embedded.
 *   --width <px>      raster width per panel, default 1000
 *   --quality <n>     JPEG quality, default 76
 *   --only <substr>   restrict to sheets whose path contains substr (for a
 *                     quick run while iterating on the page itself)
 *
 * THE TRAP, inherited from crop_compare.js and worth repeating because it is
 * silent: do NOT pass { density: 300 } to sharp for these SVGs. The generators
 * declare width="3508" height="2480" on the root, so sharp already rasterises an
 * A4 sheet at 300 dpi; a density on top makes it 14617 px wide and every
 * mm-to-pixel conversion downstream is wrong by 4.17x.
 *
 * A second trap this file hit: the OLD sheets are a different engine's output,
 * so `analyse()` must be allowed to fail on one without taking the run down —
 * a metric that cannot read the before is a blank cell, not a crash.
 *
 * THE THIRD TRAP, and it is the project's own standing lesson arriving on
 * schedule: an SVG cannot be measured without the JSON that sits beside it.
 * `quality_metrics.js` reads `routes.json` from the sheet's own `ci-reference`
 * directory to learn which colours are route ink; extract the .svg files alone
 * and every route-ink measure silently collapses — the first run of this tool
 * scored the 2026-08-15 baseline at 89 point-labels-over-ink instead of 244, and
 * the total at 500 instead of 655, with no error anywhere. So: extract the WHOLE
 * ci-reference directory at the old revision, and sanity-check the old-side
 * total against the frozen baseline in quality-baseline-scorecard_2026-08-15.md
 * before believing any delta on this page.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const { analyse, findSheets } = require('./quality_metrics');
const { labelDiff, labelSet } = require('./gate_lib');
const { scratchDir } = require('./scratch');
const { resolveBuses } = require('./cli');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };

const BUSES = resolveBuses({ buses: flag('buses') });
const REV = flag('rev', '9ec8106');
const OUT = flag('out', path.join(BUSES, 'Development Docs', 'then-and-now-contact-sheet.html'));
const WIDTH = +flag('width', 1000);
const QUALITY = +flag('quality', 76);
const ONLY = flag('only', null);

// ---------------------------------------------------------------- sheet lists

// The sheet enumeration is quality_metrics.js's, not a local walk. Until 2026-09-02
// this file kept its own copy, and that copy walked `Areas/` alone and did not skip
// `_portal-fixture` -- the exact fault test/find_sheets.test.js records as having
// happened three times in three other files. The three standalone places under
// `Places/_standalone/` were therefore never on this page (OA-224 Tier 1.3).

const git = (...a) => execFileSync('git', ['-C', BUSES, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });

// Repo-relative, forward slashes — that is how git names them, and it is the
// only key old and new can be joined on.
const rel = (p) => path.relative(BUSES, p).split(path.sep).join('/');

// A sheet's display name and whether it is a town or a place. `Areas/<Town>/…`
// is a town; `Areas/<Town>/Places/<Place>/…` is a place, and the place rows
// carry a caveat on this page because places are deliberately untouched.
function describe(r) {
  const parts = r.split('/');
  const i = parts.indexOf('ci-reference');
  const isPlace = parts.includes('Places');
  return { name: parts[i - 1], sheet: path.basename(r, '.svg'), isPlace };
}

// -------------------------------------------------------------------- metrics

function safeAnalyse(file) {
  try { return analyse(file); } catch (e) { return { error: String(e.message || e) }; }
}

// The columns worth showing per row. Deliberately not all 24 of
// quality_metrics.js's — this page is a judgement aid, and the ones that decide
// "no worse" are the totals plus the four HARD categories a reader loses
// something to.
const COLS = [
  ['labels', m => m.mapLabels],
  ['pt/ink', m => m.pointLabelsOverInk],
  ['lbl/lbl', m => m.labelLabelCollisions],
  ['lbl/icon', m => m.labelIconCollisions],
  ['dup', m => m.duplicateLabels],
  ['blob', m => m.iconBlobs],
  ['ftr.txt', m => m.textUnderFooter],
  ['lgnd', m => m.symbolsUnderLegend],
  ['drop', m => m.unplacedLabels ?? '—'],
  ['DEF', m => m.defects],
  ['HARD', m => m.hard],
  ['ALL', m => m.defectsAll],
  ['/100', m => m.defectsPer100],
];

// ---------------------------------------------------------------- rasterising

async function raster(svgPath) {
  const buf = fs.readFileSync(svgPath);
  // No { density }: the SVG carries its own 300 dpi pixel size. See the header.
  const jpg = await sharp(buf).resize({ width: WIDTH }).flatten({ background: '#ffffff' })
    .jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
  return 'data:image/jpeg;base64,' + jpg.toString('base64');
}

// -------------------------------------------------------------------- the page

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// labelSet() pulls the raw text node out of the SVG, so an ampersand arrives as
// the literal five characters `&amp;` and escaping it again prints `&amp;` on
// the page. Decode first, then escape once.
const unentity = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Split a raw lost/gained pair into three buckets. A lost string that is a
// PREFIX of a gained one is the same line with words added — the `scaleBar` key
// appending "Diagram — not to scale." to the footer disclaimer is the case that
// forced this — and reporting it as a loss inflates exactly the number this page
// exists to make trustworthy. It is shown as its own bucket rather than dropped,
// because "reworded" is a claim a reader should be able to check.
// The diff that actually answers "did the reader lose anything". `labelDiff`
// compares every <text> on the sheet, which on High Wycombe means 36 "lost"
// strings that are almost all panel rows reworded by panelCorridors — 22 equal
// service rows became 14 corridor lanes on purpose. Restricting to
// quality_metrics.js's own map-label classification separates the two.
//
// One correction inside it, and it is the reason this is not a two-line set
// difference. quality_metrics.js excludes `dominant-baseline="central"` text as
// a badge glyph — right for a route roundel, wrong for a radial sheet's TERMINUS
// LOZENGE, whose name is drawn the same way. Huntingdon external therefore reads
// as having "lost Cambridge" when the spider actually promoted Cambridge from a
// stop label to a lozenge: still on the sheet, more prominent than before. So a
// map-label loss that still appears ANYWHERE in the new sheet's text is a MOVE,
// not a loss, and is reported as one.
function mapDiff(om, nm, oldSvg, newSvg) {
  if (!om || !nm) return null;
  const a = om.detail.mapLabelTexts || [], b = nm.detail.mapLabelTexts || [];
  const allNew = new Set(labelSet(newSvg)), allOld = new Set(labelSet(oldSvg));
  const lostRaw = [...new Set(a.filter(x => !b.includes(x)))].sort();
  return {
    lost: lostRaw.filter(x => !allNew.has(x)),
    moved: lostRaw.filter(x => allNew.has(x)),
    gained: [...new Set(b.filter(x => !a.includes(x) && !allOld.has(x)))].sort(),
  };
}

function classify(diff) {
  const lost = [], gained = [...diff.gained], reworded = [];
  for (const l of diff.lost) {
    const i = gained.findIndex(g => g !== l && (g.startsWith(l) || l.startsWith(g)));
    if (i >= 0) { reworded.push([l, gained[i]]); gained.splice(i, 1); }
    else lost.push(l);
  }
  return { lost, gained, reworded };
}

// `drop` is unmeasurable on the OLD side and must not print a zero there.
// quality_metrics.js reads unplaced.json beside the sheet and treats a missing
// file on an internal sheet as "nothing was dropped", because today's engine
// unlinks it when the placer drops nothing. The 9ec8106 tree has no unplaced
// file anywhere — §1.9 shipped in Phase 2, after it — so that rule turns "the
// engine never told us" into "0 dropped". This project's own standing lesson is
// that a clean zero deserves the same suspicion as a number that will not move;
// the honest cell is blank.
const DROP_COL = COLS.findIndex(c => c[0] === 'drop');

function metricRow(label, m, { dropUnknown = false } = {}) {
  if (!m) return `<tr><th>${label}</th><td colspan="${COLS.length}" class="na">not analysable</td></tr>`;
  return `<tr><th>${label}</th>` + COLS.map((c, i) =>
    `<td>${(dropUnknown && i === DROP_COL) ? '<span class="na">n/a</span>' : esc(c[1](m))}</td>`).join('') + '</tr>';
}

function deltaRow(o, n, { dropUnknown = false } = {}) {
  if (!o || !n) return '';
  return '<tr class="delta"><th>change</th>' + COLS.map((c, i) => {
    if (dropUnknown && i === DROP_COL) return '<td class="flat">—</td>';
    const a = c[1](o), b = c[1](n);
    if (typeof a !== 'number' || typeof b !== 'number') return '<td>—</td>';
    const d = b - a;
    const cls = d < 0 ? 'good' : d > 0 ? 'bad' : 'flat';
    return `<td class="${cls}">${d > 0 ? '+' : ''}${d}</td>`;
  }).join('') + '</tr>';
}

(async () => {
  const news = findSheets(BUSES).filter(p => !ONLY || rel(p).includes(ONLY));
  // Everything under a ci-reference directory, not just the .svg — analyse()
  // needs routes.json beside the sheet. See the third trap in the header.
  const oldNames = git('ls-tree', '-r', '--name-only', REV).split('\n')
    .filter(l => l.includes('/ci-reference/'));

  const tmp = scratchDir('contact-old-');
  const oldPath = {};
  for (const r of oldNames) {
    const dest = path.join(tmp, r);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Binary-safe: git show of a JSON/SVG is text, but writing the raw buffer
    // avoids any encoding round-trip on the way through Node.
    fs.writeFileSync(dest, execFileSync('git', ['-C', BUSES, 'show', `${REV}:${r}`], { maxBuffer: 1 << 28 }));
    if (r.endsWith('.svg')) oldPath[r] = dest;
  }

  const rows = [];
  for (const nf of news) {
    const r = rel(nf);
    const of_ = oldPath[r] || null;
    const d = describe(r);
    process.stderr.write(`  ${d.name} · ${d.sheet}\n`);
    const nm = safeAnalyse(nf);
    const om = of_ ? safeAnalyse(of_) : null;
    const diff = classify(of_ ? labelDiff(of_, nf) : { lost: [], gained: [] });
    const identical = of_ && fs.readFileSync(of_, 'utf8') === fs.readFileSync(nf, 'utf8');
    rows.push({
      ...d, rel: r,
      oldImg: of_ ? await raster(of_) : null,
      newImg: await raster(nf),
      om: om && !om.error ? om.metrics : null,
      nm: nm && !nm.error ? nm.metrics : null,
      map: (of_ && om && !om.error && nm && !nm.error)
        ? mapDiff(om, nm, fs.readFileSync(of_, 'utf8'), fs.readFileSync(nf, 'utf8')) : null,
      diff, identical,
    });
  }

  const sum = (rs, side, k) => rs.reduce((s, r) => s + ((r[side] && typeof r[side][k] === 'number') ? r[side][k] : 0), 0);
  const towns = rows.filter(r => !r.isPlace), places = rows.filter(r => r.isPlace);
  const lost = rows.reduce((s, r) => s + r.diff.lost.length, 0);
  const gained = rows.reduce((s, r) => s + r.diff.gained.length, 0);
  const mLost = rows.reduce((s, r) => s + (r.map ? r.map.lost.length : 0), 0);
  const mGained = rows.reduce((s, r) => s + (r.map ? r.map.gained.length : 0), 0);
  const lossSheets = rows.filter(r => r.map && r.map.lost.length);

  const head = `<meta charset="utf-8"><title>Then and now — 31 sheets</title><style>
:root{--bg:#fff;--fg:#1c1f22;--mut:#666;--line:#dcdfe3;--good:#0a7d3f;--bad:#b3261e;--card:#f7f8f9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:30px;margin:0 0 6px}h2{font-size:19px;margin:38px 0 4px;border-top:2px solid var(--fg);padding-top:10px}
.sub{color:var(--mut);margin:0 0 24px}
.note{background:var(--card);border-left:3px solid var(--line);padding:12px 16px;margin:16px 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.pair figure{margin:0}.pair img{width:100%;border:1px solid var(--line);display:block}
.pair figcaption{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px}
table.m{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}
table.m th,table.m td{border:1px solid var(--line);padding:3px 6px;text-align:right}
table.m th:first-child{text-align:left;width:88px}
table.m thead th{background:var(--card);text-align:right;font-weight:600}
table.m thead th:first-child{text-align:left}
td.good{color:var(--good);font-weight:600}td.bad{color:var(--bad);font-weight:600}td.flat{color:var(--mut)}
tr.delta td,tr.delta th{background:#fbfbfc}
.diff{font-size:13px;margin:8px 0 4px}
.diff b{font-weight:600}.gain{color:var(--good)}.loss{color:var(--bad)}
.diffhead{font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:14px 0 2px;border-bottom:1px solid var(--line);padding-bottom:3px}
.tag{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border:1px solid var(--line);border-radius:3px;color:var(--mut);margin-left:8px;vertical-align:2px}
.na{text-align:left;color:var(--mut)}
table.sumt{border-collapse:collapse;font-size:14px;margin:10px 0}
table.sumt th,table.sumt td{border:1px solid var(--line);padding:5px 12px;text-align:right}
table.sumt th:first-child,table.sumt td:first-child{text-align:left}
</style>`;

  const body = [];
  body.push('<div class="wrap">');
  body.push(`<h1>Then and now — ${ONLY ? '' : 'all '}${rows.length} sheet${rows.length === 1 ? '' : 's'}</h1>`);
  body.push(`<p class="sub">Old side: buses-data <code>${esc(REV)}</code>, the state of the board before "Roll out design-quality Phases 1–4". New side: the working tree today. Generated ${new Date().toISOString().slice(0, 10)} by <code>contact_sheet.js</code>.</p>`);

  body.push(`<div class="note"><b>Read the label-set diff, not the defect total.</b> A defect total can be improved by putting less on the page — 94 labels are dropped board-wide and nothing counted them until session 10 — so "no worse" is a claim about <i>content</i>, and the label diff is the only column here that tests it. A row with losses is a row to look at whatever its numbers say.</div>`);

  body.push(`<div class="note"><b>Three things the columns cannot tell you.</b> <code>drop</code> is <b>n/a on the before side of every row</b> — <code>unplaced.json</code> did not exist at <code>${esc(REV)}</code>, and <code>quality_metrics.js</code> reads a missing file as "nothing dropped", so a printed zero there would be an artefact of the tool rather than a fact about the sheet. The before side's <code>HARD</code> and <code>ALL</code> are therefore missing their drop term, not carrying a zero for it. And some <b>gained</b> labels are engine furniture rather than content — the scale bar's <code>250 m</code> and <code>town centre scale</code>, the diagram's not-to-scale line — so the gained count is the weaker half of the diff. The lost count is the half that matters.</div>`);

  body.push(`<div class="note"><b>Two honest caveats.</b> (1) The ${places.length} place sheets read old ≈ new, because places are deliberately untouched until the Phase 8 portal re-vendor — those rows are the pending work, not the achievement. (2) <code>rollout.js</code>'s label diff has only ever run per-change against the shipped sheet; this is the first time it has been run across all nine sessions at once. Nothing between <code>${esc(REV)}</code> and today is a data refresh — every commit in that range is design work — so a lost or gained label here is the engine's doing, not a service change.</div>`);

  body.push('<table class="sumt"><thead><tr><th></th><th>sheets</th><th>DEF old</th><th>DEF new</th><th>map labels old</th><th>map labels new</th>'
    + '<th>lost off the map</th><th>gained on the map</th><th>lost anywhere</th></tr></thead><tbody>');
  for (const [nm, rs] of [['Towns', towns], ['Places', places], ['All', rows]]) {
    body.push(`<tr><th>${nm}</th><td>${rs.length}</td><td>${sum(rs, 'om', 'defects')}</td><td>${sum(rs, 'nm', 'defects')}</td>`
      + `<td>${sum(rs, 'om', 'mapLabels')}</td><td>${sum(rs, 'nm', 'mapLabels')}</td>`
      + `<td>${rs.reduce((s, r) => s + (r.map ? r.map.lost.length : 0), 0)}</td>`
      + `<td>${rs.reduce((s, r) => s + (r.map ? r.map.gained.length : 0), 0)}</td>`
      + `<td>${rs.reduce((s, r) => s + r.diff.lost.length, 0)}</td></tr>`);
  }
  body.push('</tbody></table>');
  // Only meaningful on a whole-board run; on a --only subset the frozen
  // baseline is not the right comparison and the sentence would be nonsense.
  if (!ONLY) body.push(`<p class="sub"><b>Both sides are measured with today's tool</b>, which is why the before column reads ${sum(rows, 'om', 'defects')} rather than the frozen baseline's 658. The baseline was measured before the four corrections to <code>quality_metrics.js</code> (clipped ink, the external legend's own text, <code>textUnderFooter</code>, <code>symbolsUnderLegend</code>) and comparing across two versions of a tool is the thing this project has already been caught by. The frozen 658 stays the historical record; ${sum(rows, 'om', 'defects')} &rarr; ${sum(rows, 'nm', 'defects')} is the like-for-like one.</p>`);
  body.push(`<p class="sub"><b>${mGained} map labels gained, ${mLost} lost</b> across ${rows.length} sheets — that is the "no worse" number. Counting every text on the sheet instead gives ${gained} gained and ${lost} lost, and the gap is mostly High Wycombe's panel: <code>panelCorridors</code> turned 22 equal service rows into 14 corridor lanes on purpose, so those strings are rewritten rather than lost. ${lossSheets.length} sheet${lossSheets.length === 1 ? '' : 's'} lost at least one label off the map${lossSheets.length ? ': ' + lossSheets.map(r => esc(r.name + ' · ' + r.sheet) + ' (' + r.map.lost.length + ')').join(', ') : ''}.</p>`);

  // The one thing a reviewer needs before scrolling 31 sheets: which sheets came
  // out with LESS on the map than they went in with. Everything else on this page
  // is evidence for or against that sentence.
  const netDown = rows.filter(r => r.map && r.map.lost.length > r.map.gained.length);
  body.push('<h2 id="verdict">Which sheets ended up with less on them</h2>');
  if (!netDown.length) {
    body.push('<p>None. Every sheet gained at least as many map labels as it lost.</p>');
  } else {
    body.push('<table class="sumt"><thead><tr><th>sheet</th><th>lost</th><th>gained</th><th>net</th><th>what was lost</th></tr></thead><tbody>'
      + netDown.map(r => `<tr><td>${esc(r.name + ' · ' + r.sheet)}</td><td>${r.map.lost.length}</td><td>${r.map.gained.length}</td>`
        + `<td class="bad">${r.map.gained.length - r.map.lost.length}</td><td style="text-align:left">${r.map.lost.map(s => esc(unentity(s))).join(' · ')}</td></tr>`).join('')
      + '</tbody></table>');
    body.push('<p class="sub">Check each of these against the sheet\'s own <code>unplaced*.json</code> before treating it as a surprise — a label the placer reports dropping is a known cost, and one it does not is a bug.</p>');
  }

  for (const r of rows) {
    body.push(`<h2>${esc(r.name)} · ${esc(r.sheet)}${r.isPlace ? '<span class="tag">place — untouched</span>' : ''}${r.identical ? '<span class="tag">byte-identical</span>' : ''}</h2>`);
    body.push('<div class="pair">');
    body.push(`<figure><figcaption>before — ${esc(REV)}</figcaption>${r.oldImg ? `<img src="${r.oldImg}" alt="">` : '<p class="na">no sheet at this revision</p>'}</figure>`);
    body.push(`<figure><figcaption>after — today</figcaption><img src="${r.newImg}" alt=""></figure>`);
    body.push('</div>');
    body.push('<table class="m"><thead><tr><th></th>' + COLS.map(c => `<th>${esc(c[0])}</th>`).join('') + '</tr></thead><tbody>');
    body.push(metricRow('before', r.om, { dropUnknown: true }));
    body.push(metricRow('after', r.nm));
    body.push(deltaRow(r.om, r.nm, { dropUnknown: true }));
    body.push('</tbody></table>');
    const li = (cls, name, arr) => arr.length
      ? `<div class="diff"><b class="${cls}">${name} ${arr.length}:</b> ${arr.map(s => esc(unentity(s))).join(' · ')}</div>`
      : '';
    if (r.map) {
      body.push('<div class="diffhead">Map labels — the reader\'s content</div>');
      if (!r.map.lost.length && !r.map.gained.length && !r.map.moved.length) body.push('<div class="diff">map label set unchanged</div>');
      body.push(li('loss', 'lost off the map', r.map.lost));
      body.push(li('gain', 'gained on the map', r.map.gained));
      body.push(li('', 'moved into a lozenge, panel or footer (still on the sheet)', r.map.moved));
    }
    body.push('<div class="diffhead">Every text on the sheet — panel, key and footer included</div>');
    if (!r.diff.lost.length && !r.diff.gained.length && !r.diff.reworded.length) body.push('<div class="diff">label set unchanged</div>');
    body.push(li('loss', 'lost', r.diff.lost));
    body.push(li('gain', 'gained', r.diff.gained));
    if (r.diff.reworded.length) body.push(`<div class="diff"><b>reworded ${r.diff.reworded.length}:</b> `
      + r.diff.reworded.map(([a, b]) => `${esc(unentity(a))} <span class="gain">&rarr; ${esc(unentity(b))}</span>`).join(' · ') + '</div>');
  }
  body.push('</div>');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, head + '\n' + body.join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`\n${OUT}  (${mb} MB, ${rows.length} sheets)`);
  console.log(`labels: ${gained} gained, ${lost} lost across ${rows.length} sheets`);
  console.log(`defects: ${sum(rows, 'om', 'defects')} -> ${sum(rows, 'nm', 'defects')}`);
  // Sanity check for the third trap. The frozen baseline is 658 defects / 245
  // point labels over route ink; today's tool reads the same sheets a little
  // lower because of the four measurement corrections since. Anything far below
  // that means the old tree was extracted without its JSON siblings.
  console.log(`old-side sanity (frozen baseline was 658 DEF / 245 pt-over-ink): `
    + `${sum(rows, 'om', 'defects')} DEF / ${sum(rows, 'om', 'pointLabelsOverInk')} pt-over-ink`);
})();
