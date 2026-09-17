#!/usr/bin/env node
/*
 * prove-red-directory-places.mjs — falsify directory_places.mjs before the
 * worklist leans on it (buses-data OA-312, round 1).
 *
 *   node assets/prove-red-directory-places.mjs     (or: npm run test:prove-red-directory-places)
 *
 * Run it from `bus-work/` (the folder holding package.json); no flags, no
 * placeholders, no network, no clock. Exit 0 when every case holds, 1 otherwise.
 *
 * THE CLOCK IS INJECTED, never read: `directoryPlacesItems` takes `now`, so
 * "181 days quiet, 182 days loud" is an assertion and nothing here can start
 * failing on a calendar — the row is on the board rather than in CI for exactly
 * that reason, and its harness must not be the thing that smuggles the clock
 * back in.
 *
 * Every case builds its own bus-map-directory folder under the temp dir, because
 * the checkout this runs in (claude-skills) holds no places-source.json; the last
 * section joins the REAL file when buses-data is on this machine and says out
 * loud when it is not.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPlacesState, directoryPlacesItems, RECHECK_DAYS } from './directory_places.mjs';

let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-directory-places-'));
const NOW = Date.UTC(2027, 2, 20, 12, 0);                        // 2027-03-20
const dayStamp = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

/** Build a bus-map-directory folder holding places/places-source.json, or not. */
function mkDir(name, source) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'places'), { recursive: true });
  if (source !== undefined) {
    fs.writeFileSync(path.join(dir, 'places', 'places-source.json'),
      typeof source === 'string' ? source : JSON.stringify(source, null, 2));
  }
  return dir;
}
const src = (built, extra = {}) => ({ edition: 'July 2024', url: 'https://example.invalid/ipn', sha256: 'abc123def456', built, ...extra });
const items = (dir, now = NOW) => directoryPlacesItems({ state: readPlacesState(dir), now });

console.log('\n1  the cadence, either side of the boundary');
{
  check(`${RECHECK_DAYS - 1} days old raises nothing`, items(mkDir('fresh', src(dayStamp(RECHECK_DAYS - 1)))).length === 0);
  const due = items(mkDir('due', src(dayStamp(RECHECK_DAYS))));
  check(`${RECHECK_DAYS} days old raises one row`, due.length === 1, String(due.length));
  check('…keyed directory-places-edition', due[0] && due[0].key === 'directory-places-edition');
  check('…whose ageDays is the age', due[0] && due[0].ageDays === RECHECK_DAYS, String(due[0] && due[0].ageDays));
  check('…whose title names the edition and asks the question', due[0] && /July 2024/.test(due[0].title) && /newer edition/.test(due[0].title), due[0] && due[0].title);
  check('…and whose steps rebuild, check and sync', due[0] && due[0].do.some((d) => /build-places\.mjs/.test(d.cmd || '')) && due[0].do.some((d) => /check-places\.mjs/.test(d.cmd || '')) && due[0].do.some((d) => /sync:directory/.test(d.what || '')));
  check('a very old edition raises exactly one row, not one per day', items(mkDir('old', src(dayStamp(900)))).length === 1);
  check('a 30-day cadence would raise the fresh one', directoryPlacesItems({ state: readPlacesState(mkDir('fresh2', src(dayStamp(60)))), now: NOW, recheckDays: 30 }).length === 1);
  check('a 1000-day cadence would not raise the old one', directoryPlacesItems({ state: readPlacesState(mkDir('old2', src(dayStamp(900)))), now: NOW, recheckDays: 1000 }).length === 0);
}

console.log('\n2  the clock is an argument');
{
  const dir = mkDir('clock', src('2026-09-16'));
  check('the same file is quiet on 2026-12-01', directoryPlacesItems({ state: readPlacesState(dir), now: Date.UTC(2026, 11, 1) }).length === 0);
  check('…and loud on 2027-06-01', directoryPlacesItems({ state: readPlacesState(dir), now: Date.UTC(2027, 5, 1) }).length === 1);
}

console.log('\n3  "cannot tell" is louder than "old"');
{
  const nodate = items(mkDir('nodate', src(undefined)));
  check('a source with no `built` raises a row', nodate.length === 1);
  check('…that says it cannot tell', nodate[0] && /no readable build date/.test(nodate[0].title), nodate[0] && nodate[0].title);
  check('…with ageDays null, never a number pretending', nodate[0] && nodate[0].ageDays === null);
  const garbage = items(mkDir('garbage', src('sometime in 2024')));
  check('a `built` that is not a date raises the same row', garbage.length === 1 && /no readable build date/.test(garbage[0].title));
  const broken = items(mkDir('broken', '{ not json'));
  check('an unparseable file raises a row rather than silence', broken.length === 1);
  check('…and names the file', broken[0] && /places-source\.json/.test(broken[0].why), broken[0] && broken[0].why.slice(0, 200));
  check('CONTROL — readPlacesState records the parse error', /places-source\.json/.test(readPlacesState(mkDir('broken2', '{ not json')).unreadable || ''));
}

console.log('\n4  silent on purpose');
{
  check('no places-source.json at all — a checkout older than OA-312, or a worktree — is silent', items(mkDir('absent')).length === 0);
  check('no places/ folder at all is silent', items(path.join(tmp, 'nothing-here')).length === 0);
  check('CONTROL — the fresh file above was also silent for the RIGHT reason: present and dated', readPlacesState(mkDir('ctrl', src(dayStamp(1)))).present === true);
}

console.log('\n5  the real file, when buses-data is on this machine');
{
  const candidates = [process.env.BUSES_DIR, 'C:/u3a St Ives/Using AI/Buses', path.resolve(process.cwd(), '..', '..', 'buses-data')].filter(Boolean);
  const real = candidates.map((b) => path.join(b, 'BusMapsUK', 'bus-map-directory')).find((d) => fs.existsSync(path.join(d, 'places', 'places-source.json')));
  if (!real) {
    console.log('  --  SKIPPED: no buses-data checkout with places/places-source.json on this machine; the join against the real file was not tested here');
  } else {
    const st = readPlacesState(real);
    check('the real places-source.json parses', st.present && !st.unreadable, st.unreadable || '');
    check('…and carries a readable `built`', Number.isFinite(Date.parse((st.source || {}).built || '')), String((st.source || {}).built));
    const at = Date.parse(st.source.built);
    check('…which is quiet the day after it was built', directoryPlacesItems({ state: st, now: at + 86400000 }).length === 0);
    check(`…and loud ${RECHECK_DAYS} days later`, directoryPlacesItems({ state: st, now: at + RECHECK_DAYS * 86400000 }).length === 1);
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file locks */ }
console.log(bad ? `\n✗ ${bad} check(s) failed` : '\n✓ every case held, and the row can be seen to go loud and quiet');
process.exit(bad ? 1 : 0);
