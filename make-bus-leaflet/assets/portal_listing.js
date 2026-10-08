/*
 * portal_listing.js — IS THIS MAP ON THE PORTAL? (buses-data OA-607; the question
 * was first asked by s6_stale_limit.js for OA-484, and is asked here once for all).
 *
 * "On the portal" means LISTED by the live site's /api/public/maps: the one place a
 * published version, an active customer, public_listed and not-archived have all
 * been applied (bus-work/assets/town_status.mjs asks the same). A map only built
 * here, or published and hidden, is not listed, and the public cannot see it.
 *
 * THREE ANSWERS, NEVER TWO. isListed() is true, false, or null when the list was not
 * read (--no-live, or a site that could not be reached). Every caller treats null as
 * ON the portal, so a failed read raises every row exactly as before and never drops
 * one quietly: a map stops owing work only on a list somebody actually read.
 *
 * Read once per run by status.js and handed to s6_stale_limit.js and engine_lag.js;
 * read by worklist.mjs for its engine-rebuild rows. Outside both engine hashes — no
 * generator requires it — so changing it moves no ink. Node core only.
 */
'use strict';

const DEFAULT_LIVE_URL = 'https://busmaps.uk';
const slugOf = (n) => String(n).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** `{ listed: [{ name, slug }] | null, why }`. Never throws: a failure is `listed: null` with the reason. */
async function read({ liveUrl = DEFAULT_LIVE_URL, noLive = false, timeoutMs = 8000 } = {}) {
  if (noLive) return { listed: null, why: '--no-live' };
  const base = String(liveUrl || DEFAULT_LIVE_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(base + '/api/public/maps', { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body && (body.maps || body.data));
    if (!res.ok || !Array.isArray(list)) return { listed: null, why: 'the public maps API answered ' + res.status + ' without a list' };
    return { listed: list.map((p) => ({ name: p.name, slug: p.slug })), why: null };
  } catch (e) {
    return { listed: null, why: 'could not reach ' + base + ' — ' + String(e.message || e) };
  }
}

/** true / false, or null when no list was read. A map matches by its name or by the slug its name makes. */
function isListed(listing, name) {
  if (!listing || !Array.isArray(listing.listed)) return null;
  const slug = slugOf(name);
  return listing.listed.some((p) => p.name === name || p.slug === slug);
}

/** Rows still owed their work (`on`, which is EVERY row when no list was read) and rows off the portal (`off`). */
function split(rows, listing, nameOf = (r) => r.name) {
  const on = [], off = [];
  for (const r of rows) (isListed(listing, nameOf(r)) === false ? off : on).push(r);
  const measured = !!(listing && Array.isArray(listing.listed));
  return { on, off, measured, why: measured ? null : (listing && listing.why) || 'no listing was read' };
}

module.exports = { read, isListed, split, slugOf, DEFAULT_LIVE_URL };
