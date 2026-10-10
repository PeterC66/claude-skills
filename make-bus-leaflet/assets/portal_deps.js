/*
 * portal_deps.js — is the portal checkout's node_modules there? (buses-data
 * OA-567, the safety net under the hookify rule `node-modules-link`)
 *
 * The portal checkout lost its node_modules twice — 2026-09-12, and again around
 * 2026-10-03, missing until 2026-10-05 04:47. Every session that met it stopped
 * on `Cannot find package 'sharp'`, which names a package and not the cause, and
 * several ticks improvised a junction that a later `git worktree remove --force`
 * followed out and emptied. The cause is closed (the hookify rule refuses any link
 * named node_modules); this is what says so on the board the next time the folder
 * goes, with the one repair Peter has given a standing yes to (2026-10-05).
 *
 * A CHORE AND NEVER A RED, like process_size.js: status.js prints it and keeps it
 * out of `bad` and the exit code, and bus-work's worklist carries it as a row so
 * the morning brief shows it. Read-only, offline, no clock. Silent when the portal
 * is not a checkout on this machine (CI, a fresh clone) — that is not a fault.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** The package whose absence every session met first; present means the install ran. */
const PROBE = 'sharp';

/** null when `portal` is not a checkout here; else { portal, ok, missing: [paths] }. */
function read(portal) {
  if (!portal || !fs.existsSync(path.join(portal, 'package.json'))) return null;
  const missing = [];
  const nm = path.join(portal, 'node_modules');
  if (!fs.existsSync(nm)) missing.push('node_modules');
  else if (!fs.existsSync(path.join(nm, PROBE, 'package.json'))) missing.push(`node_modules/${PROBE}`);
  return { portal, ok: missing.length === 0, missing };
}

const repair = (portal) => `npm --prefix "${portal}" ci`;

function printSection(r) {
  if (!r || r.ok) return;
  console.log('\n=== Portal dependencies (a chore, not red — OA-567) ===');
  console.log('  ' + r.portal + ' is missing ' + r.missing.join(', ') + ', so every portal script stops on "Cannot find package \'' + PROBE + '\'".');
  console.log('  repair:  ' + repair(r.portal) + '   (installs only what package-lock.json pins; never a junction or symlink)');
}

/** The worklist row, or null. */
function item(portal) {
  const r = read(portal);
  if (!r || r.ok) return null;
  return {
    key: 'portal-deps', rank: 8, type: 'housekeeping',
    title: `The portal checkout has no ${r.missing[r.missing.length - 1]}, so every portal script stops on "Cannot find package '${PROBE}'"`,
    why: `${r.portal} is missing ${r.missing.join(', ')}. The repair is \`npm ci\`, which installs only what package-lock.json pins and is the one install with a standing yes (2026-10-05). Never a junction or symlink named node_modules: \`git worktree remove --force\` follows one out and empties it (12 Sep and 3 Oct). A chore, not a fault (OA-567).`,
    who: '—', runbook: 'portal',
    do: [{ kind: 'shell', cwd: r.portal, cmd: repair(r.portal), note: 'then run this board again; the row goes when node_modules/sharp is back' }],
  };
}

module.exports = { read, printSection, item, PROBE };
