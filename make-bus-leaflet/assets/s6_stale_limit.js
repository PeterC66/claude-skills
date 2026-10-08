/*
 * s6_stale_limit.js — A PUBLISHED MAP'S VERIFICATION MAY GO STALE, BUT NOT FOR EVER
 * (buses-data OA-484 item 2, Peter's ruling of 2026-09-28).
 *
 * An S6 is stale when S1, S2 or S3 has moved since the report (status.js's own
 * rule). That was a chore with no limit, so a live sheet could sit unverified for
 * weeks: on 2026-09-27 St Ives, Beaconsfield Waitrose and High Wycombe Aldi were.
 * So a stale S6 on a PUBLISHED map turns the board RED fourteen days after the
 * LATER of its `staleSince` and LIMIT_LANDED. `staleSince` is the day of the first
 * S1/S2/S3 run after the report — the run that made it stale; Peter's words were
 * "the first S1 run", and S2/S3 count too because they are what the board calls
 * stale. LIMIT_LANDED is the grace s6_claims.js gives its facts: a map already
 * stale on landing gets one fortnight, because a check red on its first day gets
 * muted.
 *
 * PUBLISHED IS ASKED OF THE LIVE SITE, /api/public/maps, through portal_listing.js
 * (OA-607), which engine_lag.js and the worklist's rebuild rows ask too. A map only
 * built here is not published and its stale S6 stays a chore. --no-live, or a site that
 * cannot be reached, leaves the limit NOT MEASURED: printed, never red, the same
 * as the deployment row's `unreachable`. `today` is injectable (status.js
 * --owed-today) so the red can be proved rather than waited for.
 */
'use strict';

const LIMIT_DAYS = 14;
const LIMIT_LANDED = '2026-09-29';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const listing = require('./portal_listing.js');

/** The day of the first S1/S2/S3 run recorded after `s6At`, or null if none is. */
function staleSince(manifest, s6At) {
  if (!manifest || !manifest.stages || typeof s6At !== 'string') return null;
  const after = [];
  for (const k of ['S1', 'S2', 'S3']) {
    const st = manifest.stages[k];
    for (const r of (st && st.runs) || []) if (typeof r.at === 'string' && r.at > s6At) after.push(r.at);
  }
  return after.length ? after.sort()[0].slice(0, 10) : null;
}

/** Pure: judge every stale row against the published list. `published` null = not measured. */
function judge({ towns = [], places = [], published, why = null, today = todayIso() }) {
  if (!published) return { checked: false, why: why || 'the published list was not read', today, rows: [], overdue: [] };
  const rows = towns.map(r => ({ r, kind: 'town' })).concat(places.map(r => ({ r, kind: 'place' })))
    .filter(({ r }) => r.s6Stale && listing.isListed({ listed: published }, r.name))
    .map(({ r, kind }) => {
      const from = [r.s6StaleSince, LIMIT_LANDED].filter(d => typeof d === 'string' && ISO.test(d)).sort().pop();
      const due = addDays(from, LIMIT_DAYS);
      return { map: r.name, kind, s6: r.s6, staleSince: r.s6StaleSince || null, due, overdue: today > due };
    });
  return { checked: true, why: null, today, rows, overdue: rows.filter(x => x.overdue) };
}

/** Read the live list (or take the one `given`, as status.js does), then judge. Never throws: a failure is `checked: false`. */
async function measure({ towns, places, liveUrl, noLive = false, today, given }) {
  const t = typeof today === 'string' && ISO.test(today) ? today : todayIso();
  const l = given || await listing.read({ liveUrl, noLive });
  return judge({ towns, places, published: l.listed, why: l.why, today: t });
}

function isRed(m) { return !!(m && m.checked && m.overdue.length); }

/** The S6 STALE line status.js printed before this, and the limit under it. */
function printSection(m, townRows, placeRows, log = console.log) {
  const towns = townRows.filter(r => r.s6Stale).map(r => r.name);
  const places = placeRows.filter(r => r.s6Stale).map(r => r.name);
  if (towns.length || places.length) log('  S6 STALE: '
    + [towns.length ? 'towns ' + towns.join(', ') : '', places.length ? 'places ' + places.join(', ') : ''].filter(Boolean).join('; ')
    + '  -- the data moved since the last verification report; a chore the worklist carries as s6-stale, red only on a published map past its limit');
  if (!m.checked) { if (towns.length || places.length) log('  S6 LIMIT NOT MEASURED (' + LIMIT_DAYS + ' days on published maps, OA-484): ' + m.why); return; }
  if (m.rows.length) log('  S6 limit (' + LIMIT_DAYS + ' days on published maps, OA-484): ' + m.rows.map(x => x.map + ' ' + (x.overdue ? 'OVERDUE, was due by ' : 'due by ') + x.due).join(', '));
  for (const x of m.overdue) log('  RED S6 ' + x.map + ': published, and its verification (' + x.s6 + ') has been stale since '
    + (x.staleSince || 'an undated run') + ' — past ' + x.due + '. Run S6 for it, or unpublish it.');
}

module.exports = { measure, judge, isRed, printSection, staleSince, LIMIT_DAYS, LIMIT_LANDED };
