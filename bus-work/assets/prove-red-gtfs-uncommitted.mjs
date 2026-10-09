#!/usr/bin/env node
/* Prove the uncommitted-refresh source can raise a row AND stay quiet
 * (buses-data OA-505, Tier 2.1 of the codebase review of 2026-09-28).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-gtfs-uncommitted.mjs
 *
 * Written to the shape of prove-red-bods-scan.mjs: every case is a PAIR,
 * because appearing is only half of it. A row that never fires reads as a
 * committed refresh for ever; a row that never stops is the column everybody
 * learns to ignore. The first cases use a stub git; the last builds a REAL
 * throwaway repository, because a porcelain parser agreeing with a stub proves
 * only that it agrees with the stub.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readGtfsDirt, gtfsUncommittedItems, parsePorcelain, defaultGit } from './gtfs_uncommitted.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

const stubGit = (out) => {
  const asked = [];
  const git = (dir, argv) => { asked.push({ dir, argv }); return out; };
  return { git, asked };
};
const yes = () => true;

console.log('\n1. A committed refresh: nothing is raised');
{
  const st = readGtfsDirt({ busesDir: 'C:/x', git: stubGit('').git, exists: yes });
  check('state is ok with no files', st.status === 'ok' && st.files.length === 0, JSON.stringify(st));
  const out = gtfsUncommittedItems(st, { busesDir: 'C:/x' });
  check('no row and no warning', out.items.length === 0 && out.warnings.length === 0, JSON.stringify(out));
}

console.log('\n2. A refresh left uncommitted: one row naming the files');
{
  const porcelain = [
    ' M _gtfs/feed_info_cambridgeshire.json',
    ' M _gtfs/refresh-summary.txt',
    '?? _gtfs/upcoming/upcoming-report_2026-10-01.md',
    '',
  ].join('\n');
  const st = readGtfsDirt({ busesDir: 'C:/x', git: stubGit(porcelain).git, exists: yes });
  const out = gtfsUncommittedItems(st, { busesDir: 'C:/x' });
  check('exactly one row', out.items.length === 1, JSON.stringify(out.items.map((i) => i.key)));
  const row = out.items[0] || {};
  check('keyed gtfs-uncommitted at rank 4, a housekeeping chore', row.key === 'gtfs-uncommitted' && row.rank === 4 && row.type === 'housekeeping', `${row.key} / ${row.rank} / ${row.type}`);
  check('the title counts all three files', /3 file/.test(row.title), row.title);
  check('the why separates two changed from one new', /2 tracked file\(s\) changed and 1 new/.test(row.why), row.why);
  check('the new report is named by its own path, not its folder', (row.files || []).includes('_gtfs/upcoming/upcoming-report_2026-10-01.md'), JSON.stringify(row.files));
  check('no step stages or commits anything by itself', !/git (add|commit)/.test(JSON.stringify(row.do)), JSON.stringify(row.do));
}

console.log('\n3. The question asked of git');
{
  const { git, asked } = stubGit('');
  readGtfsDirt({ busesDir: 'C:/x', git, exists: yes });
  check('exactly one git call', asked.length === 1, JSON.stringify(asked));
  const a = (asked[0] || {}).argv || [];
  check('it is status --porcelain, limited to _gtfs', a[0] === 'status' && a.includes('--porcelain') && a[a.length - 1] === '_gtfs' && a.includes('--'), JSON.stringify(a));
  check('with -uall, so a new report is not folded into its folder', a.includes('-uall'), JSON.stringify(a));
  check('and NOT --ignored, so the sqlite builds never count', !a.includes('--ignored'), JSON.stringify(a));
}

console.log('\n4. A checkout with no _gtfs, and a git that will not answer');
{
  const { git, asked } = stubGit(' M _gtfs/x');
  const st = readGtfsDirt({ busesDir: 'C:/x', git, exists: () => false });
  check('no _gtfs reads no-dir and asks git nothing', st.status === 'no-dir' && asked.length === 0, JSON.stringify(st));
  const out = gtfsUncommittedItems(st, { busesDir: 'C:/x' });
  check('and raises neither row nor warning — a CI checkout is the wrong machine to ask', out.items.length === 0 && out.warnings.length === 0, JSON.stringify(out));
  const un = readGtfsDirt({ busesDir: 'C:/x', git: () => null, exists: yes });
  const o2 = gtfsUncommittedItems(un, { busesDir: 'C:/x' });
  check('a failed git raises no row but SAYS so, rather than reading as committed', un.status === 'unreadable' && o2.items.length === 0 && o2.warnings.length === 1, JSON.stringify(o2));
  const o3 = gtfsUncommittedItems({ status: 'weather' }, { busesDir: 'C:/x' });
  check('an unknown state names itself', o3.items.length === 0 && /weather/.test(o3.warnings[0] || ''), JSON.stringify(o3));
}

console.log('\n5. The porcelain parser');
{
  const p = parsePorcelain('R  _gtfs/a.json -> _gtfs/b.json\n M _gtfs/c.txt\r\n');
  check('a rename keeps the NEW name, the one that would be committed', p[0].path === '_gtfs/b.json', JSON.stringify(p));
  check('a CRLF line is not left carrying the CR', p[1].path === '_gtfs/c.txt', JSON.stringify(p));
  check('the first column is kept: " M" is not "M "', p[1].code === ' M', JSON.stringify(p[1].code));
}

console.log('\n6. Against a REAL repository: quiet when committed, a row when not');
{
  let tmp;
  try {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'oa505-'));
    const g = (...a) => execFileSync('git', ['-C', tmp, ...a], { stdio: 'ignore' });
    g('init', '-q');
    g('config', 'user.email', 'harness@example.invalid');
    g('config', 'user.name', 'harness');
    mkdirSync(path.join(tmp, '_gtfs', 'upcoming'), { recursive: true });
    writeFileSync(path.join(tmp, '.gitignore'), '_gtfs/*.sqlite\n');
    writeFileSync(path.join(tmp, '_gtfs', 'feed_info_x.json'), '{"v":1}\n');
    g('add', '.gitignore', '_gtfs/feed_info_x.json');
    g('commit', '-q', '-m', 'seed');
    writeFileSync(path.join(tmp, '_gtfs', 'x.sqlite'), 'binary');
    const clean = gtfsUncommittedItems(readGtfsDirt({ busesDir: tmp, git: defaultGit }), { busesDir: tmp });
    check('committed, with only an IGNORED sqlite beside it: quiet', clean.items.length === 0 && clean.warnings.length === 0, JSON.stringify(clean));
    writeFileSync(path.join(tmp, '_gtfs', 'feed_info_x.json'), '{"v":2}\n');
    writeFileSync(path.join(tmp, '_gtfs', 'upcoming', 'upcoming-report_2026-10-01.md'), '# r\n');
    const dirty = gtfsUncommittedItems(readGtfsDirt({ busesDir: tmp, git: defaultGit }), { busesDir: tmp });
    const files = (dirty.items[0] || {}).files || [];
    check('after a refresh rewrites one file and adds a report: one row', dirty.items.length === 1, JSON.stringify(dirty));
    check('naming exactly those two, and not the sqlite', files.length === 2 && files.includes('_gtfs/feed_info_x.json') && files.includes('_gtfs/upcoming/upcoming-report_2026-10-01.md'), JSON.stringify(files));
  } catch (e) {
    check('the real-repository case could run', false, e.message);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: the uncommitted-refresh row is not what gtfs_uncommitted.mjs says it is.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: an uncommitted _gtfs/ change is one rank-4 chore naming its files, a committed refresh is silent, ignored builds never count, and a tree with no _gtfs asks nothing.`);
}
