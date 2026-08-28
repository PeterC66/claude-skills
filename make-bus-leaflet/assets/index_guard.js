/*
 * index_guard.js — build a lookup from a list and REFUSE to lose a row.
 *
 * The whole module exists for one line that keeps being written by hand:
 *
 *     for (const s of services) byRoute[s.route] = s;
 *
 * That is not an index. It is an index AND a silent de-duplication, and nothing
 * distinguishes the two after the fact: every route appears exactly once, the
 * report looks complete, nothing throws. Wisbech runs two route 46s — Stagecoach
 * East to March and Lynx to King's Lynn — so on that one town the line above
 * builds ten entries out of eleven services and the tenth wears the eleventh's
 * facts. `verify_report.js` did exactly this until 2026-08-27: route 46's drawn
 * chain was checked against the LYNX termini and 46L was never checked at all.
 * See OA-134.
 *
 * The guard is the cheapest possible one — assert the resulting map's size equals
 * the source list's length — and it is the ONLY thing that tells "indexed" from
 * "silently deduplicated". It would have caught that the day it was written.
 *
 * A route NUMBER is not an identity. `verified-services.json` has carried a `key`
 * field (`46`, `46L`) since it was written, and so do routes_full_atco.json,
 * routes_intown_atco.json and the palette — but only on maps built since the field
 * was introduced: measured 2026-08-28, `key` is present on 4 of 8 towns and 0 of
 * 12 places. So `serviceKey()` falls back to the number, and on the twelve maps
 * with no key it is exactly today's behaviour. The FALLBACK is not the protection.
 * The guard is.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */

/**
 * The identity of a service row: its `key` if the data carries one, else its
 * route number. Never its number alone when a key exists.
 */
function serviceKey(s) {
  if (!s || typeof s !== 'object') return String(s);
  const k = s.key != null && s.key !== '' ? s.key : s.route;
  return String(k);
}

/**
 * Index `list` by `keyFn`, throwing rather than letting a row overwrite another.
 *
 *   indexUnique(services, serviceKey, 'verified-services.json services')
 *
 * `what` names the source in the error, because the message has to be readable
 * by someone who has never seen this file.
 */
function indexUnique(list, keyFn, what) {
  const rows = Array.isArray(list) ? list : [];
  const map = new Map();
  const clashes = new Map();          // key -> [first index, later index...]
  for (let i = 0; i < rows.length; i++) {
    const k = keyFn(rows[i], i);
    if (map.has(k)) {
      if (!clashes.has(k)) clashes.set(k, [map.get(k).i]);
      clashes.get(k).push(i);
    }
    map.set(k, { i, v: rows[i] });
  }
  if (clashes.size) throw new Error(collisionMessage(what, rows, clashes));
  const out = new Map();
  for (const [k, { v }] of map) out.set(k, v);
  return out;
}

/** The same, returning a plain object — for the many call sites that want `m[r]`. */
function indexUniqueObj(list, keyFn, what) {
  const m = indexUnique(list, keyFn, what);
  const o = Object.create(null);
  for (const [k, v] of m) o[k] = v;
  return o;
}

/**
 * The assertion on its own, for a map somebody else built. Cheap enough to leave
 * in a hot path and the only after-the-fact evidence that nothing was lost.
 */
function assertNoCollision(map, list, what) {
  const size = map instanceof Map ? map.size : Object.keys(map).length;
  const n = Array.isArray(list) ? list.length : 0;
  if (size !== n) {
    throw new Error(
      `${what}: indexed ${n} row(s) into ${size} entries — ${n - size} were silently ` +
      `overwritten. A route NUMBER is not unique (Wisbech runs two 46s); index on the ` +
      `\`key\` field the data carries, not on \`route\`. See OA-134.`);
  }
}

function collisionMessage(what, rows, clashes) {
  const parts = [];
  for (const [k, idxs] of clashes) {
    const who = idxs.map(i => {
      const r = rows[i] || {};
      const op = r.operator ? ` (${r.operator})` : '';
      return `#${i} ${r.route != null ? r.route : '?'}${op}`;
    }).join(' vs ');
    parts.push(`'${k}' <- ${who}`);
  }
  return `${what}: ${clashes.size} colliding key(s) — ${parts.join('; ')}. ` +
    `A route NUMBER is not unique (Wisbech runs two 46s, Stagecoach East and Lynx); ` +
    `index on the \`key\` field the data carries, and where there is no key, tell the ` +
    `two apart by OPERATOR — it is the only thing that does. See OA-134.`;
}

module.exports = { serviceKey, indexUnique, indexUniqueObj, assertNoCollision };
