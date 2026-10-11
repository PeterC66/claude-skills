/*
 * upcoming_sections.mjs — read the monthly BODS upcoming report's sections, and say
 * which portal maps each one belongs to (buses-data OA-615).
 *
 * THE JOIN IS THE PORTAL'S, and this is the second copy of it rather than a third
 * rule. `community-bus-maps/scripts/lib/upcoming-report.mjs` (`mapsForSection`)
 * has joined exactly, per kind, since the scan learned about places on 2026-08-17:
 * a place section matches the place map of the same name, and a town section
 * matches only the area map of that name. worklist.mjs kept the older rule — a place
 * map matched any section its portal `subject` CONTAINED — and its comment went on
 * claiming to share the portal's. A standalone place's subject is a street address
 * ("Co-op Food, 64 St Mary's Street, Ely"), which contains no section name, and no
 * town section exists for Ely or Godmanchester, so Ely Co-op and both Godmanchester
 * Co-ops never raised a refresh row while the report carried a section for each.
 * Found 2026-10-11, after Cambridge Road's v1.34 sat unstaged for five days.
 *
 * Two things here that the portal's copy does not do. A place map also matches the
 * section named for its own FOLDER, so a portal name that drifts from the folder's
 * still finds its section. And the counts are numbers, because the worklist adds
 * and compares them.
 *
 * The substring rule survives for a report written before places had sections of
 * their own (no `_kind place` meta line anywhere), where it is a place's only route
 * to a row; on a place-aware report it would attribute a town's changes to every
 * place in it, and give a place whose own section says "nothing upcoming" a row.
 *
 * Pure: text and arrays in, arrays out. prove-red-refresh-review.mjs falsifies the
 * join end to end through worklist.mjs.
 */
import { earliestEffective } from './refresh_deadline.mjs';

/**
 * Every section of a report, "nothing upcoming" ones included, because whether a
 * report is place-aware is a question about all of them. `actionable` is the one a
 * row needs. The verdict is read field by field, as the portal's parser does, so a
 * section of only "2 to verify" is not dropped.
 */
export function parseUpcoming(md) {
  return String(md || '').split(/^## /m).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const head = (nl >= 0 ? part.slice(0, nl) : part).replace(/\r$/, '');
    const body = nl >= 0 ? part.slice(nl + 1) : '';
    const h = head.match(/^(.+?) — (.+)$/);
    if (!h || h[1].trim() === 'Not checked') return null;
    const upcoming = Number((h[2].match(/(\d+) upcoming/) || [])[1] || 0);
    const toVerify = Number((h[2].match(/(\d+) to verify/) || [])[1] || 0);
    const meta = (body.split('\n').find((l) => l.trim().startsWith('_')) || '').trim();
    return {
      town: h[1].trim(), kind: /^_kind place\b/.test(meta) ? 'place' : 'area',
      upcoming, toVerify, actionable: upcoming > 0 || toVerify > 0, body, effective: earliestEffective(body),
    };
  }).filter(Boolean);
}

/** "5 upcoming service changes", or "1 upcoming service change, 2 to verify". */
export const changesPhrase = (s) => `${s.upcoming} upcoming service change${s.upcoming === 1 ? '' : 's'}${s.toVerify ? `, ${s.toVerify} to verify` : ''}`;

/**
 * The built portal maps one section belongs to. `placeAware` is whether ANY section
 * of the report is a place's; `folderOf(m)` is a place map's local folder name, or null.
 */
export function sectionMaps(maps, section, { placeAware, folderOf = () => null }) {
  const lower = section.town.toLowerCase();
  const kind = section.kind === 'place' ? 'place' : 'area';
  return (maps || []).filter((m) => {
    if (!m.built) return false;
    if (m.kind === 'area') return kind === 'area' && (m.name || '').toLowerCase() === lower;
    if (!placeAware) return (m.subject || '').toLowerCase().includes(lower);
    return kind === 'place' && [m.name, folderOf(m)].some((n) => n && n.toLowerCase() === lower);
  });
}
