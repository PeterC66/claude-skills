/*
 * shadow_count.js — the board's "clean on today's engine" count (buses-data OA-485
 * item 3), read from the stamp the weekly shadow rebuild writes.
 *
 * Each map is gated against the engine that drew it (OA-430), so a green board
 * says every map REPRODUCES, not that today's engine still draws it well.
 * `bus-work/assets/shadow_rebuild.mjs` asks the second question as a dry run of
 * both estate rollouts and stamps the answer in `<buses>/loop/shadow-rebuild.json`;
 * this prints that answer under the gates so the two are read side by side.
 *
 * A CHORE AND NEVER A RED. A regressed map means LOOK — the lost-label rule cannot
 * tell a deliberate change from damage — and the board exits non-zero for a fault
 * only (buses-data CLAUDE.md). Nothing here is in `bad`.
 *
 * THE COUNT IS ONLY ABOUT TODAY'S ENGINE IF THE STAMP WAS TAKEN ON IT. The stamp
 * carries the town template hash its rollout ran on; when that is not the hash
 * this board computed, the section says the count is about an older engine rather
 * than printing it as today's. No stamp (CI, a machine that never ran the job) is
 * "not on this machine", never zero; a stamp that is not a shadow-rebuild report
 * is named, because a corrupt answer must not read as no answer.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const STAMP = path.join('loop', 'shadow-rebuild.json');
const DAY_MS = 86400000;

function read(buses, currentEngine, nowMs = Date.now()) {
  const file = buses ? path.join(buses, STAMP) : null;
  if (!file || !fs.existsSync(file)) return { status: 'none', file };
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    return { status: 'UNREADABLE', file, why: 'not JSON: ' + e.message };
  }
  const c = s && s.counts;
  const whole = c && ['clean', 'regressed', 'unmeasured', 'total'].every(k => Number.isInteger(c[k]));
  if (!whole || !s.towns || !s.places || !Array.isArray(s.towns.maps) || !Array.isArray(s.places.maps)) {
    return { status: 'UNREADABLE', file, why: 'not a shadow-rebuild stamp (no counts, towns or places)' };
  }
  const ran = Date.parse(s.ranAt);
  return {
    status: 'read', file,
    ranAt: s.ranAt || null,
    ageDays: Number.isFinite(ran) ? Math.floor((nowMs - ran) / DAY_MS) : null,
    engine: s.engine || null,
    onTodaysEngine: !!currentEngine && s.engine === currentEngine,
    counts: { clean: c.clean, regressed: c.regressed, unmeasured: c.unmeasured, total: c.total },
    regressed: [...s.towns.maps, ...s.places.maps].filter(m => m.verdict === 'regressed').map(m => m.name),
  };
}

function printSection(r, currentEngine) {
  if (!r) return;
  console.log('\n=== Clean on today\'s engine (information, not red — OA-485) ===');
  if (r.status === 'none') { console.log('  not on this machine: no loop/shadow-rebuild.json (bus-work/assets/shadow_rebuild.mjs writes it)'); return; }
  if (r.status === 'UNREADABLE') { console.log('  UNREADABLE   ' + r.file + ' — ' + r.why); return; }
  const c = r.counts;
  const when = r.ranAt ? ' — shadow rebuild of ' + r.ranAt.slice(0, 10) + (r.ageDays == null ? '' : ', ' + r.ageDays + 'd ago') : '';
  console.log('  ' + c.clean + ' of ' + c.total + ' maps clean, ' + c.regressed + ' regressed, ' + c.unmeasured + ' unmeasured' + when);
  if (!r.onTodaysEngine) console.log('  ...on engine ' + (r.engine || '(unknown)') + ', which is NOT today\'s ' + (currentEngine || '(unknown)')
    + ' — this count is about an older engine until the shadow rebuild runs again');
  if (r.regressed.length) console.log('  regressed (look, not fix): ' + r.regressed.join(', '));
}

module.exports = { read, printSection, STAMP };
