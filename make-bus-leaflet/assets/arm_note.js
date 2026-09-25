/*
 * arm_note.js — the note under the external radial's legend that says which
 * routes run as more than one arm ("9 runs as two arms — to Hilton & Elsworth
 * and to Huntingdon.").
 *
 * J10 (buses-data OA-040, Peter's item 1 of the 18 August review): the AUTO note
 * is one line per route with the route number in bold, because the run-on
 * paragraph it used to be read as one sentence and was what widened the panel.
 * A hand-written `externalNote` is prose and is still wrapped as one paragraph,
 * byte for byte as before.
 *
 * WHY A MODULE. It was written inside gen_external_radial.js first and put that
 * file 33 lines over its line-ratchet ceiling; the OA-001 rule is that new
 * generator logic goes into a module. It is not in external_primitives.js because
 * that module is shared with the PLACE external, and a change there moves the
 * place engine hash — a re-render of every place map for a note they never draw.
 *
 * Pure: the generator hands in its own wrapper, text measure and escaper, so this
 * file measures and wraps exactly as the sheet does and requires nothing.
 */
'use strict';

// The auto note's items: one per route that has more than one spoke, in the
// order the spokes were first met. `note` is the same items as one line of
// prose, which is what the generator tests for emptiness.
function armItemsFrom(ext) {
  const arms = {};
  ext.forEach(b => { (arms[b.route] = arms[b.route] || []).push(b.label); });
  const items = Object.entries(arms).filter(([, v]) => v.length > 1)
    .map(([r, v]) => ({ route: String(r), rest: `runs as two arms — to ${v.slice(0, -1).join(', ')} and to ${v[v.length - 1]}.` }));
  return { items, note: items.map(it => it.route + ' ' + it.rest).join('  ') };
}

// Draws the note at (x, y), wrapped to `width` mm, and returns the ink's right
// and bottom edges so the panel can be sized from them. With `items` each route
// starts its own line and its number is a separate bold <text>, so the sheet
// gains no new SVG element; the rest starts one space after the number's REAL
// bold width. Without `items` the note is one wrapped paragraph.
function drawArmNote({ items, note, x, y, width, out, wrapMm, measureText, esc }) {
  const attrs = 'font-family="Arial" font-size="2.9" fill="#666"';
  if (!items) {
    const lines = wrapMm(note, width, 2.9);
    lines.forEach((ln, i) => out(`<text x="${x}" y="${(y + i * 3.6).toFixed(2)}" ${attrs}>${esc(ln)}</text>`));
    return { maxX: x + Math.max(...lines.map(ln => measureText(ln, 2.9))), maxY: y + (lines.length - 1) * 3.6 + 2 };
  }
  let row = 0, maxX = x;
  items.forEach(it => {
    wrapMm(it.route + ' ' + it.rest, width, 2.9).forEach((ln, j) => {
      const yy = (y + row * 3.6).toFixed(2);
      if (j === 0) {
        const bw = measureText(it.route, 2.9, true), sp = measureText(' ', 2.9);
        const tail = ln.slice(it.route.length + 1);
        out(`<text x="${x}" y="${yy}" font-family="Arial" font-weight="bold" font-size="2.9" fill="#666">${esc(it.route)}</text>`);
        if (tail) out(`<text x="${(x + bw + sp).toFixed(2)}" y="${yy}" ${attrs}>${esc(tail)}</text>`);
        maxX = Math.max(maxX, x + bw + sp + measureText(tail, 2.9));
      } else {
        out(`<text x="${x}" y="${yy}" ${attrs}>${esc(ln)}</text>`);
        maxX = Math.max(maxX, x + measureText(ln, 2.9));
      }
      row++;
    });
  });
  return { maxX, maxY: y + (row - 1) * 3.6 + 2 };
}

module.exports = { armItemsFrom, drawArmNote };
