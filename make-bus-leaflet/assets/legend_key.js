/*
 * legend_key.js — which routes the external sheet's "Operators & services" legend
 * may badge. Shared by gen_external_radial.js and gen_external_places.js.
 *
 * THE LEGEND IS A KEY TO THE DIAGRAM (buses-data OA-305, Peter's choice 2026-10-01).
 * Both generators used to badge every route in operators[] and never ask whether it
 * had a spoke, so 20 badges on 8 of the 17 external sheets had no line under them and
 * five operator rows carried nothing at all — Wisbech's FACT and 68 is the one it was
 * found by, and only by a person looking at the JPG. Now a route is badged only when a
 * spoke carries it or localLoops[] declares it ({route,label}, or a bare route string),
 * which keeps the badge and adds a caption row saying why there is no line. An operator
 * left with nothing badged loses its row. A sheet with no spokeless route returns the
 * SAME operator objects it was given, which is what keeps it byte-identical.
 *
 * Every route dropped is named on stderr: the twin of services_panel.js's "badged in
 * the Services panel but draws no line" guard. Nothing asked the external sheet that
 * question before this.
 */
'use strict';

/**
 * @param {object}   a
 * @param {Array}    a.operators   operators[] after hiddenOperators is applied
 * @param {Iterable} a.spokeRoutes every route a spoke on this sheet draws
 * @param {Array}    [a.localLoops] routes.json localLoops[]
 * @param {Set}      [a.hidden]    HIDDEN_ROUTES; kept in place, the legend drops them itself
 * @returns {{ops: Array, loops: Array<{route,label?}>, dropped: string[]}}
 */
function keyLegend({ operators, spokeRoutes, localLoops, hidden }) {
  const HID = hidden || new Set();
  const loops = (localLoops || []).map(l => (typeof l === 'string' ? { route: l } : l)).filter(l => !HID.has(l.route));
  const keyed = new Set(loops.map(l => l.route));
  for (const r of spokeRoutes) keyed.add(r);
  const dropped = [];
  const ops = (operators || []).map(op => {
    const all = op.routes || [];
    const rs = all.filter(r => keyed.has(r) || HID.has(r));
    all.forEach(r => { if (!rs.includes(r)) dropped.push(r + ' (' + op.name + ')'); });
    if (rs.length === all.length) return op;
    return rs.some(r => !HID.has(r)) ? Object.assign({}, op, { routes: rs }) : null;
  }).filter(Boolean);
  return { ops, loops, dropped };
}

/** The build-time warning, or '' when nothing was dropped. */
function droppedWarning(dropped) {
  if (!dropped.length) return '';
  return 'legend: ' + dropped.join(', ') + ' — in operators[] but no spoke on this sheet draws '
    + (dropped.length > 1 ? 'them' : 'it') + ', so left out of the legend. Declare a town service in '
    + 'routes.json localLoops[] {route,label} to keep its badge with a caption.\n';
}

/**
 * Draw the localLoops[] caption rows: the route's badge, then its label in grey, one
 * row every 6mm from `y`. The place generator drew these inline from its first build;
 * the town generator gained them with OA-305, so both now call this and cannot drift.
 * @returns {{maxX:number, maxY:number, y:number}} the ink's extent and the next free y
 */
function drawLoopRows({ loops, x, y, badge, badgeXW, measure, esc, out }) {
  let maxX = x, maxY = -Infinity, yy = y;
  for (const l of loops) {
    const w = badgeXW(l.route, 2.9);
    badge(x + 3 + w, yy, l.route, 2.9);
    const t = l.label || 'local circular';
    out(`<text x="${x + 8 + 2 * w}" y="${(yy + 0.2).toFixed(2)}" font-family="Arial" font-size="3.0" fill="#666" dominant-baseline="central">${esc(t)}</text>`);
    maxX = Math.max(maxX, x + 8 + 2 * w + measure(t, 3.0));
    maxY = Math.max(maxY, yy + 3);
    yy += 6.0;
  }
  return { maxX, maxY, y: yy };
}

module.exports = { keyLegend, droppedWarning, drawLoopRows };
