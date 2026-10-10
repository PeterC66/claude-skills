/*
 * row_groups.mjs — the printed board shows an estate-wide fact as ONE row
 * (buses-data OA-608 item 2, 2026-10-10).
 *
 * WHY. On 8 October 84 worklist rows were printed, and 33 of them were two facts
 * repeated: 19 "<map>'s landmark pull does not ask today's landmark question" and
 * 14 "<map> was drawn by an older engine". A board a third of which is the same
 * sentence teaches its reader to skim, and the row that matters scrolls past.
 *
 * WHY ONLY IN PRINT. The per-map rows are load-bearing everywhere else, and
 * OA-430 made them per-map on purpose: a tick takes ONE `engine-rebuild-<map>`
 * row as its unit of work (loop/README.md), a hold names one in `**Blocks:**`,
 * and the pass-over and town-lock code key on it. So `--json` keeps every row and
 * only the human rendering folds them; the numbers a person picks still lead to
 * the same commands, with `<map>` standing for one of the names listed.
 *
 * THE RULE IS STRUCTURAL, NOT A LIST OF TITLES. Rows fold when their key has a
 * prefix in GROUPED and their commands are identical once the map's own name is
 * replaced by `<map>` — so towns (rollout.js) and places (rollout_places.js) stay
 * two rows, because they are two different commands. A row carrying a hold is
 * never folded, because the hold is printed above its commands and gates them.
 * One member alone is printed as it is.
 */

import { SAFE, CHECK, DELAY } from './concurrency.mjs';

/** Key prefix -> the folded row's title for n maps (`places` when the commands say --place). */
export const GROUPED = {
  'engine-rebuild-': (n, places) => `${n} ${places ? 'place maps' : 'maps'} were drawn by an older engine`,
  'fresh-pull-': (n, places) => `${n} ${places ? 'place maps\'' : 'maps\''} landmark pulls do not ask today's landmark question`,
};

const VERDICT_ORDER = [SAFE, CHECK, DELAY];
const sentences = (s) => String(s || '').split(/(?<=\.)\s+/).filter(Boolean);
const swap = (s, name) => (s == null ? s : String(s).split(`"${name}"`).join('"<map>"').split(name).join('<map>'));

function prefixOf(key) {
  return Object.keys(GROUPED).find((p) => String(key || '').startsWith(p)) || null;
}

/** The row's steps with its own map name replaced by `<map>`, or null if it has none to compare. */
function template(it, name) {
  return (it.do || []).map((d) => ({ ...d, cmd: swap(d.cmd, name), what: swap(d.what, name), note: d.note }));
}

/**
 * @param {object[]} rows  the worklist rows in print order
 * @returns {object[]}     the same order, each foldable set replaced, at its first
 *                         member's place, by one row whose `members` lists the keys
 */
export function groupForPrint(rows) {
  const sets = new Map();
  for (const it of rows) {
    const p = prefixOf(it.key);
    if (!p || (it.onHold && it.onHold.length)) continue;
    const name = it.key.slice(p.length);
    const steps = template(it, name);
    const id = `${p}\u0000${JSON.stringify(steps)}`;
    if (!sets.has(id)) sets.set(id, { prefix: p, steps, members: [] });
    sets.get(id).members.push({ it, name });
  }
  const folded = new Map();   // first member -> folded row; other members -> null
  for (const s of sets.values()) {
    if (s.members.length < 2) continue;
    const its = s.members.map((m) => m.it);
    const shared = sentences(its[0].why).filter((x) => its.every((o) => sentences(o.why).includes(x)));
    const places = s.steps.some((d) => /--place\b/.test(d.cmd || ''));
    const worst = its.map((i) => i.safety).filter(Boolean)
      .sort((a, b) => VERDICT_ORDER.indexOf(b.verdict) - VERDICT_ORDER.indexOf(a.verdict))[0];
    const reasons = [];
    for (const i of its) for (const r of (i.safety && i.safety.reasons) || []) if (!reasons.some((x) => x.need === r.need)) reasons.push(r);
    const row = {
      group: `${s.prefix}*`, rank: its[0].rank, type: its[0].type,   // no `key`: a folded row is never a row anything acts on
      title: GROUPED[s.prefix](its.length, places),
      ageDays: its.reduce((a, i) => (i.ageDays == null ? a : Math.max(a ?? 0, i.ageDays)), null),
      why: `${shared.join(' ')} One row per map in --json, where a tick takes them one at a time (OA-430); folded here into one (OA-608).`.trim(),
      detail: s.members.map(({ it, name }) => {
        const own = sentences(it.why).filter((x) => !shared.includes(x)).join(' ');
        return `${name}${own ? ` — ${own}` : ''}`;
      }).join('\n'),
      do: s.steps.map((d, i) => (i === 0 && d.kind === 'shell' ? { ...d, note: `${d.note ? `${d.note}; ` : ''}<map> is one of the names above` } : d)),
      safety: worst ? { verdict: worst.verdict, reasons } : undefined,
      members: its.map((i) => i.key),
    };
    folded.set(its[0], row);
    for (const i of its.slice(1)) folded.set(i, null);
  }
  const out = [];
  for (const it of rows) {
    if (!folded.has(it)) out.push(it);
    else if (folded.get(it)) out.push(folded.get(it));
  }
  return out;
}
