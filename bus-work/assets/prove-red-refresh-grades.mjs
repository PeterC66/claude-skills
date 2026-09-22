#!/usr/bin/env node
/* Prove the refresh GRADING can speak and can refuse to (buses-data OA-426, item 2
 * of R9 of the process review, 2026-09-17).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-refresh-grades.mjs
 *
 * Written to the shape prove-red-bods-scan.mjs set: every case is a PAIR, because
 * saying something is only half of it.
 *
 * WHAT IS ACTUALLY AT RISK HERE, and it is not the JSON. This reader's answer is
 * the thing that will decide whether a tick rebuilds a town without a person
 * looking at it. A grade that never arrives costs a chore; a grade that arrives
 * WRONG — the right town from the wrong month, a file somebody edited, a payload
 * whose schema moved under it — is a machine saying "no judgement needed" about
 * changes nobody has read. So every refusal below is asserted as hard as every
 * answer, and the date rule gets a mutation arm of its own.
 *
 * No `_gtfs` folder and no clock: `readGradeState()` takes its file reader as an
 * argument, and nothing here reads the date of the day it is run.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGradeState, gradeFor, notCheckedFor, gradeSentence, gradeWarnings,
  defaultReadGradeFiles, SCHEMA, unattendedRefresh,
} from './refresh_grades.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

/* Two fixed dates. Nothing here is relative to today — OA-289's rule. */
const SCAN = '2026-10-01';
const OLDER = '2026-09-01';

const payload = (date, towns, notChecked = []) => JSON.stringify({
  date, tool: 'gtfs_refresh_report.py', schema: SCHEMA, towns, notChecked,
}, null, 2);

const MARCH = { grade: 'SAFE', actionable: 2, reasons: ['DAYS', 'OPERATOR'] };
const ELY = { grade: 'ESCALATE', actionable: 3, reasons: ['ADD?', 'WITHDRAWN?'] };
const STIVES = { grade: 'NOTHING', actionable: 0, reasons: [] };

/* A reader stub keyed on the folder the source actually asks for, so a wrong
 * question returns null — read as "no folder" — rather than something plausible. */
const readerFor = (files) => {
  const asked = [];
  return { read: (dir) => { asked.push(dir); return files; }, asked };
};
const stateOf = (files) => readGradeState({ busesDir: 'C:/anywhere', readGradeFiles: readerFor(files).read });

console.log('\n1. A grading is there and it is read');
{
  const st = stateOf([{ date: OLDER, text: payload(OLDER, { March: ELY }) },
                      { date: SCAN, text: payload(SCAN, { March: MARCH, Ely: ELY, 'St Ives': STIVES }) }]);
  check('state is ok and names the NEWEST grading', st.status === 'ok' && st.date === SCAN, JSON.stringify(st.date));
  check('and it is the newest file\'s content, not the older one\'s', gradeFor(st, 'March', SCAN).grade === 'SAFE', JSON.stringify(gradeFor(st, 'March', SCAN)));
  check('a town is matched case-insensitively, like every other join on this board', gradeFor(st, 'ST IVES', SCAN) !== null);
  check('a town that is not in the file gets nothing rather than a default', gradeFor(st, 'Wisbech', SCAN) === null);
  check('no warning when the grading and the scan are the same run', gradeWarnings(st, SCAN).length === 0, JSON.stringify(gradeWarnings(st, SCAN)));
}

console.log('\n2. The three grades each say their own thing, and NOTHING says nothing');
{
  const st = stateOf([{ date: SCAN, text: payload(SCAN, { March: MARCH, Ely: ELY, 'St Ives': STIVES }) }]);
  const safe = gradeSentence(st, 'March', SCAN);
  check('SAFE names the count and the tags, so the reader can see what "mechanical" meant', /SAFE/.test(safe) && /2 actionable/.test(safe) && /DAYS, OPERATOR/.test(safe), safe);
  check('and it says no judgement is wanted — the sentence the loop is being built on', /no judgement is wanted/.test(safe), safe);
  const esc = gradeSentence(st, 'Ely', SCAN);
  check('ESCALATE names the tags that escalated it and asks for a person', /ESCALATE/.test(esc) && /ADD\?, WITHDRAWN\?/.test(esc) && /a person decides/.test(esc), esc);
  check('NOTHING adds no sentence at all: a row with no actionable change has nothing to say', gradeSentence(st, 'St Ives', SCAN) === '', gradeSentence(st, 'St Ives', SCAN));
}

console.log('\n3. THE DATE RULE: a grade from another run is not this row\'s grade');
{
  const st = stateOf([{ date: OLDER, text: payload(OLDER, { March: MARCH }) }]);
  check('the state itself is fine', st.status === 'ok' && st.date === OLDER);
  check('asked as at the older scan it answers', gradeFor(st, 'March', OLDER) !== null);
  check('asked as at TODAY\'S scan it refuses — the whole point of the rule', gradeFor(st, 'March', SCAN) === null);
  check('and the row gets no sentence rather than last month\'s', gradeSentence(st, 'March', SCAN) === '');
  const w = gradeWarnings(st, SCAN);
  check('the mismatch is SAID: a silent refusal reads exactly like a quiet month', w.length === 1 && /different runs/.test(w[0]), JSON.stringify(w));
  check('and the warning names both dates, so the reader can tell which half is stale', w[0].includes(OLDER) && w[0].includes(SCAN), w[0]);
}

console.log('\n4. A grading that cannot be trusted is refused, four ways, each with its reason');
{
  const cases = [
    ['not JSON at all', 'this is not json {'],
    ['a payload that is not an object', '"a string"'],
    ['a schema this reader does not know', JSON.stringify({ date: SCAN, schema: 99, towns: {} })],
    ['no towns object', JSON.stringify({ date: SCAN, schema: SCHEMA })],
    ['a date that disagrees with its own filename', payload(OLDER, { March: MARCH })],
    ['a town whose grade is not a grade', payload(SCAN, { March: { grade: 'PROBABLY FINE', actionable: 1 } })],
  ];
  for (const [what, text] of cases) {
    const st = stateOf([{ date: SCAN, text }]);
    check(`${what}: unreadable, not ok`, st.status === 'unreadable', JSON.stringify(st.status));
    check('    no town gets a grade out of it', gradeFor(st, 'March', SCAN) === null);
    check('    and the refusal carries a reason a person can act on', typeof st.why === 'string' && st.why.length > 0, st.why);
    check('    and it is printed as a warning rather than swallowed', gradeWarnings(st, SCAN).some((w) => /ignored/.test(w)), JSON.stringify(gradeWarnings(st, SCAN)));
  }
}

console.log('\n5. A town the scan could NOT check is named, not silently ungraded');
{
  const st = stateOf([{ date: SCAN, text: payload(SCAN, { March: MARCH }, [{ town: 'Wisbech', reason: 'dataset not built' }]) }]);
  check('it has no grade', gradeFor(st, 'Wisbech', SCAN) === null);
  check('but it IS named, with the reason', (notCheckedFor(st, 'Wisbech') || {}).reason === 'dataset not built', JSON.stringify(notCheckedFor(st, 'Wisbech')));
  const s = gradeSentence(st, 'Wisbech', SCAN);
  check('and its row says so, so an absence is read as an absence', /could NOT check/.test(s) && /dataset not built/.test(s), s);
  check('a town that is in neither list gets silence, which is a different thing', gradeSentence(st, 'Huntingdon', SCAN) === '');
}

console.log('\n6. No grading at all, and no feeds at all, are different pictures');
{
  const none = readGradeState({ busesDir: 'C:/anywhere', readGradeFiles: () => [] });
  check('a folder with no grades file is "none"', none.status === 'none', none.status);
  check('and it says so once, naming OA-426 as the reason it may be missing', gradeWarnings(none, SCAN).length === 1 && /OA-426/.test(gradeWarnings(none, SCAN)[0]), JSON.stringify(gradeWarnings(none, SCAN)));
  const nodir = readGradeState({ busesDir: 'C:/anywhere', readGradeFiles: () => null });
  check('a tree with no _gtfs at all is "no-dir"', nodir.status === 'no-dir', nodir.status);
  check('and says NOTHING, because bods_scan.mjs already says this tree carries no feeds', gradeWarnings(nodir, SCAN).length === 0, JSON.stringify(gradeWarnings(nodir, SCAN)));
  check('neither one yields a grade', gradeFor(none, 'March', SCAN) === null && gradeFor(nodir, 'March', SCAN) === null);
}

console.log('\n7. The real disk reader, on the two cases a stub cannot check');
{
  check('a missing folder reads null, which is no-dir and not an empty estate', defaultReadGradeFiles('C:/definitely/not/a/gtfs/folder') === null);
  /* fileURLToPath, not `new URL('.', import.meta.url).pathname`: this tree lives
   * under a path with a SPACE in it, which the latter percent-encodes, so
   * existsSync() says no and this case reads `null` — indistinguishable from the
   * missing-folder case above. The same trap is recorded in the headers of
   * prove-red-deploy-pending.mjs and prove-red-bods-scan.mjs. */
  const here = defaultReadGradeFiles(path.dirname(fileURLToPath(import.meta.url)));
  check('a real folder with no refresh-grades_*.json reads as EMPTY, not as null', Array.isArray(here) && here.length === 0, JSON.stringify(here));
}

console.log('\n8. The mutation arm: the three ways this reader could be quietly wrong');
{
  /* (a) Trusting the listing's order. ISO dates sort as strings, which is why the
   * filenames carry them; a reader that took the last entry would pass every case
   * above, because they are all already sorted. */
  const shuffled = readGradeState({
    busesDir: 'C:/x',
    readGradeFiles: () => [{ date: SCAN, text: payload(SCAN, { March: MARCH }) },
                           { date: OLDER, text: payload(OLDER, { March: ELY }) }],
  });
  check('(a) an out-of-order listing still reads the NEWEST grading', shuffled.date === SCAN, shuffled.date);
  check('    and therefore grades March SAFE, where trusting the listing would have said ESCALATE', gradeFor(shuffled, 'March', SCAN).grade === 'SAFE');

  /* (b) Dropping the date rule. The mutant is the rule removed; it must change an
   * answer, or the rule was never doing anything. */
  const stale = stateOf([{ date: OLDER, text: payload(OLDER, { March: MARCH }) }]);
  const withoutTheRule = stale.towns['march'] || null;
  check('(b) without the date rule the stale file WOULD have answered — so the rule is load-bearing', withoutTheRule !== null && gradeFor(stale, 'March', SCAN) === null);

  /* (c) Reading the grade off the count instead of the grade. A town can have
   * actionable changes and still need a person; a town with the same count can
   * not. Two records with the SAME count and opposite verdicts. */
  const st = stateOf([{ date: SCAN, text: payload(SCAN, {
    Alpha: { grade: 'SAFE', actionable: 3, reasons: ['DAYS'] },
    Beta: { grade: 'ESCALATE', actionable: 3, reasons: ['ADD?'] },
  }) }]);
  check('(c) same actionable count, opposite grades — the verdict is the grade, not the size', gradeFor(st, 'Alpha', SCAN).grade === 'SAFE' && gradeFor(st, 'Beta', SCAN).grade === 'ESCALATE');
  check('    and the two sentences differ in what they ask of the reader', /no judgement is wanted/.test(gradeSentence(st, 'Alpha', SCAN)) && /a person decides/.test(gradeSentence(st, 'Beta', SCAN)));
}

console.log('\n6. Whether a TICK may take the row, and how far (OA-426, R9 item 2)');
{
  const st = stateOf([{ date: SCAN, text: payload(SCAN, { March: MARCH, Ely: ELY, 'St Ives': STIVES }) }]);
  const ASSETS = 'C:/engine/assets';
  const un = unattendedRefresh(st, 'March', SCAN, { kind: 'area', assetsDir: ASSETS });
  check('a SAFE town becomes a unit a tick can take', un !== null);
  check('  and the command names the town and the scan, with nothing left to work out', un && un.cmd.includes('--town "March"') && un.cmd.includes(`--scan ${SCAN}`), un && un.cmd);
  check('  and it applies rather than reporting', un && un.cmd.includes('--apply'));
  check('  and it runs in the engine assets folder it was given', un && un.cwd === ASSETS, un && un.cwd);
  check('  and the command is SELF-CONTAINED: it names the script by absolute path', un && un.cmd.includes(`"${ASSETS}/refresh_town.py"`), un && un.cmd);
  check('  so a tick never has to cd, which its own prompt forbids in one plain command', un && !/(^|\s)cd\s/.test(un.cmd), un && un.cmd);
  check('  and it stops at S5 — delivering is not a tick\'s move', un && un.through === 'S5', un && un.through);
  check('  and says so in words, naming the action that owns the rest', un && /OA-428/.test(un.then));

  /* A WINDOWS path is where this bites: this estate lives behind a drive letter and
   * backslashes, and a backslash inside a double-quoted shell argument is an escape. The
   * command carries forward slashes for that reason, and Windows accepts them everywhere
   * this runs. The fixture is String.raw so the harness cannot mangle its own input. */
  const WINDOWSY = String.raw`C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`;
  const winish = unattendedRefresh(st, 'March', SCAN, { assetsDir: WINDOWSY });
  check('a Windows assets path comes out with forward slashes, not escapes', winish.cmd.includes('"C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/refresh_town.py"'), winish.cmd);
  const BACKSLASH = String.fromCharCode(92);   // a raw template cannot END in one
  check('  and no backslash survives into the command', !winish.cmd.includes(BACKSLASH), winish.cmd);

  /* The three refusals, each one a row a tick must NOT take. */
  check('an ESCALATE town is not a tick\'s row', unattendedRefresh(st, 'Ely', SCAN, { assetsDir: ASSETS }) === null);
  check('a NOTHING town is not a tick\'s row either', unattendedRefresh(st, 'St Ives', SCAN, { assetsDir: ASSETS }) === null);
  check('a town with no grading at all is not a tick\'s row', unattendedRefresh(st, 'Wisbech', SCAN, { assetsDir: ASSETS }) === null);

  /* A PLACE has no grade to be SAFE, because the report diffs Areas/<town> only.
   * Posed with a SAFE record under the place's own name, so the refusal is the KIND
   * rule doing the work rather than the lookup failing to find anything. */
  const placeState = stateOf([{ date: SCAN, text: payload(SCAN, { 'Ely Co-op': MARCH }) }]);
  check('a place is refused even where a SAFE record carries its name', unattendedRefresh(placeState, 'Ely Co-op', SCAN, { kind: 'place', assetsDir: ASSETS }) === null);
  check('  and the same record WOULD have been taken as an area — so it is the kind that refuses', unattendedRefresh(placeState, 'Ely Co-op', SCAN, { kind: 'area', assetsDir: ASSETS }) !== null);

  /* The date rule reaches this side too: an older grading must not authorise a tick to
   * rebuild against a scan it has not seen. This is the (b) mutation one layer up. */
  const staleSt = stateOf([{ date: OLDER, text: payload(OLDER, { March: MARCH }) }]);
  check('an older grading does not authorise a rebuild for a newer scan', unattendedRefresh(staleSt, 'March', SCAN, { assetsDir: ASSETS }) === null);
  check('  where the same grading WOULD authorise one for its own scan — so the date is what refuses', unattendedRefresh(staleSt, 'March', OLDER, { assetsDir: ASSETS }) !== null);

  /* No engine on this machine means no command to give, rather than a command that
   * names a folder which is not there. */
  check('with no engine assets folder there is no unit, rather than a broken command', unattendedRefresh(st, 'March', SCAN, { assetsDir: null }) === null);

  /* And the prose half still says the same thing as the machine half, which is the
   * whole reason they live in one module. */
  check('the sentence and the verdict agree for a SAFE town', /no judgement is wanted/.test(gradeSentence(st, 'March', SCAN)) && unattendedRefresh(st, 'March', SCAN, { assetsDir: ASSETS }) !== null);
  check('and they agree for an ESCALATE town', /a person decides/.test(gradeSentence(st, 'Ely', SCAN)) && unattendedRefresh(st, 'Ely', SCAN, { assetsDir: ASSETS }) === null);
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: the refresh grading is not what refresh_grades.mjs says it is.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: a grading written by the same run as the scan reaches the row, one written by a different run does not and says so, an unreadable file grades nothing and names its reason, a town the scan could not check is named rather than ungraded in silence, and the verdict is the grade itself rather than the listing's order or the size of the count.`);
}
