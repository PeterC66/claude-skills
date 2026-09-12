#!/usr/bin/env node
/* Prove the register-recheck row in worklist.mjs can go red AND stay quiet.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-register-recheck.mjs
 *
 * WHY THIS EXISTS AT ALL. `check-s6-claims.mjs` deliberately does NOT decide
 * whether a recheck date has come round: comparing a stored date to today inside
 * a gate is a stored answer re-derived against an input nobody declares, and it
 * reddens `main` on the CALENDAR with nobody having committed anything — measured
 * on 2026-09-09 under buses-data OA-289, once a day, for as long as a claim was
 * held. So the checker hands over the dates bare and THIS board takes the
 * verdict. That split is only safe if the board half is actually watched firing,
 * and on the real register it cannot be: the earliest recheck date in it is
 * 2026-12-08, so the row has never appeared and would not appear for months.
 * A green check that has never been seen to go red proves nothing.
 *
 * Written to the same shape as prove-red-commitments.mjs, and for the same
 * reason: appearing is only half of it. A row that never fires is the failure
 * this source exists to prevent; a row that never STOPS is the failure it could
 * easily introduce. So each case is a pair — make the state, see the row; clear
 * the state, see it gone.
 *
 * Every date is computed RELATIVE TO TODAY. A fixture with 2026-12-08 written
 * into it passes today, starts failing in December for no reason anybody will
 * remember, and gets deleted rather than understood — which is the same fault
 * the checker half is written to avoid, appearing here instead.
 *
 * It builds a throwaway GIT repository, because check-s6-claims.mjs enumerates
 * the estate from `git ls-files` and answers `notARepository` over anything
 * else; a plain temp directory would make every case below quietly absent, which
 * is exactly the shape of a harness that proves nothing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/* fileURLToPath, not new URL(...).pathname: this tree lives under
 * "C:\u3a St Ives\.claude\..." and the latter percent-encodes the space. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'worklist.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recheck-worklist-'));
let bad = 0;

const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });

/* One town, tracked, carrying one service — enough for the checker to enumerate an
 * estate and for a register entry's scope to name a map that is not silent about it. */
function estate() {
  git('init', '-q');
  git('config', 'user.email', 'p@example.invalid');
  git('config', 'user.name', 'prove-red');
  git('config', 'core.autocrlf', 'false');
  const run = '2026-09-01_0000';
  const dir = path.join(root, 'Areas', 'Fixture');
  fs.mkdirSync(path.join(dir, 'S1-services', run), { recursive: true });
  fs.writeFileSync(path.join(dir, 'S1-services', run, 'verified-services.json'),
    JSON.stringify({ services: [{ route: '1', operator: 'Fixture Buses' }] }, null, 1));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    town: 'Fixture', stages: { S1: { latest: run, runs: [{ id: run, dir: `S1-services/${run}`, at: '2026-09-01T00:00' }] } },
  }, null, 1));
  git('add', '--', path.join('Areas', 'Fixture', 'manifest.json'), path.join('Areas', 'Fixture', 'S1-services', run, 'verified-services.json'));
  git('commit', '-q', '-m', 'fixture');
}

/* The register. `factBy` is the decided entry's own recheckBy; `operatorBy`, when
 * given, is a researched coverage row's — the two kinds the checker emits, and the
 * only two this row can ever carry. */
function writeRegister({ factBy, operatorBy }) {
  const fact = {
    id: 'SF-901', route: '1', operator: 'Fixture Buses', scope: ['Fixture'], class: 'commercial',
    fact: { runs: true, public: true, summary: 'a fixture' },
    status: 'decided', decidedOn: '2026-09-01', decidedBy: 'prove-red', outcome: 'nothing',
    reason: 'fixture', recheckBy: factBy,
  };
  const op = { name: 'Fixture Buses', aliases: [] };
  if (operatorBy) {
    op.coverage = {
      researchedOn: '2026-09-01', recheckBy: operatorBy,
      sources: [{ url: 'https://example.invalid/areas', kind: 'prose', read: '2026-09-01', says: 'the areas it serves' }],
      services: [{ fact: 'SF-901', calls: 'the fixture service', maps: ['Fixture'] }],
    };
  }
  const p = path.join(root, 'service-facts.json');
  fs.writeFileSync(p, JSON.stringify({ _operators: { operators: [op] }, facts: [fact] }, null, 1));
  git('add', '--', 'service-facts.json');
  git('commit', '-q', '-m', 'register');
}

function row() {
  const out = execFileSync('node', [TOOL, '--json', '--local', '--no-ci', '--buses', root, '--portal', path.join(root, 'no-portal-here')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out).items.find((i) => i.key === 's6-register-recheck') || null;
}

function expect(label, want, extra) {
  const hit = row();
  let ok = want.present ? !!hit : !hit;
  if (ok && hit && want.rank != null) ok = hit.rank === want.rank;
  if (ok && hit && extra) ok = extra(hit);
  console.log(`  ${ok ? (want.present ? 'RED  ' : 'QUIET') : 'MISS '} ${label}`);
  if (!ok) { bad++; console.log(`        want ${want.present ? 'present' : 'absent'}; saw: ${hit ? `${hit.key}@${hit.rank} — ${hit.title}` : '(no row)'}`); }
  return hit;
}

estate();

console.log('\n== register recheck: can it fire, and can it shut up? ==');

/* THE CONTROL FIRST. Every date in the real register is a year out, so "no row"
 * is the state this source is in every day — and a harness that only ever proves
 * the quiet case proves that the row is unreachable, not that it is correct. */
writeRegister({ factBy: dayOffset(365) });
expect('a recheck a year away — nothing is due, and the board says nothing', { present: false });

writeRegister({ factBy: dayOffset(-1) });
expect('a fact recheck one day past — the row appears at rank 8', { present: true, rank: 8 },
  (r) => /SF-901/.test(r.title) && r.ageDays === 1);

/* THE BOUNDARY, CENTRED RATHER THAN BUTTED: due TODAY is due. Off by one here is
 * the difference between a recheck that comes round on the day somebody chose and
 * one that comes round the day after, for ever, unnoticed. */
writeRegister({ factBy: dayOffset(0) });
expect('due exactly today — the boundary is inclusive', { present: true, rank: 8 }, (r) => r.ageDays === 0);

/* THE OPERATOR HALF, which is the one OA-307 step 2 added and the one no fact
 * carried before it: *given an operator, which places?* comes round on its own
 * date, and the row has to say that is what it is. */
writeRegister({ factBy: dayOffset(365), operatorBy: dayOffset(-30) });
const opRow = expect('a researched operator coverage row past its recheck — the row appears', { present: true, rank: 8 },
  (r) => /Fixture Buses/.test(r.title));
if (opRow && !/OPERATOR row asks the coverage question again/.test(opRow.why)) {
  bad++; console.log('        the row does not say an operator coverage question is what is due: ' + opRow.why);
}
if (opRow && !(opRow.towns || []).includes('Fixture')) {
  bad++; console.log('        the row does not carry the maps the coverage names: ' + JSON.stringify(opRow.towns));
}

/* BOTH AT ONCE — the count in the title has to be the count, not the word "one". */
writeRegister({ factBy: dayOffset(-2), operatorBy: dayOffset(-2) });
expect('a fact AND an operator both due — the row counts two', { present: true },
  (r) => /^2 register entries are due a recheck/.test(r.title));

/* AND THE ONE THAT MATTERS MOST: done means gone. Move the date forward — which is
 * what answering a recheck actually does — and the row must vanish rather than
 * linger. A nag that outlives the work is how the whole list stops being read. */
writeRegister({ factBy: dayOffset(365), operatorBy: dayOffset(365) });
expect('both dates moved forward — the row goes away', { present: false });

console.log('');
if (bad) { console.log(`FAILED — ${bad} case(s) did not behave as written`); fs.rmSync(root, { recursive: true, force: true }); process.exit(1); }
console.log('OK — the register-recheck row fires on a passed date, counts what is due, says when it is the operator question, and goes quiet when the date moves forward');
fs.rmSync(root, { recursive: true, force: true });
