#!/usr/bin/env node
/*
 * prove-red-s6-claims.mjs — falsify check-s6-claims.mjs.
 *
 * Run from anywhere, with no arguments and no placeholders:
 *
 *     node "C:/u3a St Ives/.claude/skills/tools/prove-red-s6-claims.mjs"
 *
 * WHY. The gate went green on the real estate on the day it landed (2026-09-08,
 * buses-data OA-273), after the register was written and one place's S3 run carried
 * its two decisions. It had been watched go red twice that morning — 22 uncovered
 * claims before the register existed, then two SILENCES after it — but a green that
 * has been red only on one laptop, once, is still a green that has to be provable.
 *
 * Every case builds a throwaway git repository, because the tracked half of the
 * checker reads `git ls-files` and the coverage half reads files git ignores — and
 * the split between those two is the thing most worth proving: case 9 shows that a
 * tree with no S6 report is green under --register-only and RED under
 * --require-reports, which is the difference between CI checking what it can and CI
 * claiming to have checked what it cannot see.
 *
 * THE LOAD-BEARING CASES ARE 4 AND 7. Case 4: a place's claim about a route its
 * PARENT TOWN has already declared off is covered — that is OA-004 decision 4 as a
 * mechanism, and it is what makes 100 claims into 20. Case 7: a decided register
 * entry whose scope names a map that is silent about the route is RED — the VL14
 * shape — even though every claim has a home. A register that could silence a claim
 * without the sheet ever learning the answer would be the mute button the
 * `redteamRejected` design refused to be.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, 'check-s6-claims.mjs');
const TMP = mkdtempSync(path.join(tmpdir(), 'prove-red-s6-claims-'));
let failures = 0, ran = 0;

function check(name, ok, detail) {
  ran++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!ok) failures++;
}

/**
 * A throwaway repo holding an estate. `maps` is a list of
 *   { dir, s1: verifiedServicesObject|null, s3: routesObject|null, s6: findings[]|null|'absent-file' }
 * The manifest, S1 and S3 files are TRACKED; verification.json is written and
 * gitignored, as it is in buses-data. `register` is the service-facts.json object,
 * or a string to write verbatim, or null for none.
 */
function repo(name, maps, register) {
  const root = path.join(TMP, name);
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'p@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'prove-red'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  writeFileSync(path.join(root, '.gitignore'), 'S6-verify/*/verification.json\n**/S6-verify/*/verification.json\n');
  const toAdd = ['.gitignore'];
  for (const m of maps) {
    const stages = {};
    const run = '2026-09-01_0000';
    if (m.s1) {
      const d = path.join(root, m.dir, 'S1-services', run); mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 'verified-services.json'), JSON.stringify(m.s1, null, 1));
      toAdd.push(path.join(m.dir, 'S1-services', run, 'verified-services.json'));
      stages.S1 = { latest: run, runs: [{ id: run, dir: `S1-services/${run}`, at: '2026-09-01T00:00' }] };
    }
    if (m.s3) {
      const d = path.join(root, m.dir, 'S3-config', run); mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 'routes.json'), JSON.stringify(m.s3, null, 1));
      toAdd.push(path.join(m.dir, 'S3-config', run, 'routes.json'));
      stages.S3 = { latest: run, runs: [{ id: run, dir: `S3-config/${run}`, at: '2026-09-01T00:00' }] };
    }
    if (m.s6 !== undefined && m.s6 !== null) {
      const d = path.join(root, m.dir, 'S6-verify', run); mkdirSync(d, { recursive: true });
      if (m.s6 === 'broken') writeFileSync(path.join(d, 'verification.json'), '{ not json');
      else if (m.s6 !== 'absent-file') {
        const findings = m.s6.map((f, i) => ({ id: `F${String(i + 1).padStart(3, '0')}`, severity: 'soft', ...f }));
        writeFileSync(path.join(d, 'verification.json'), JSON.stringify({ findings, summary: { hard: 0, soft: findings.length } }));
      }
      stages.S6 = { latest: run, runs: [{ id: run, dir: `S6-verify/${run}`, at: '2026-09-01T00:00' }] };
    }
    const md = path.join(root, m.dir); mkdirSync(md, { recursive: true });
    writeFileSync(path.join(md, 'manifest.json'), JSON.stringify({ town: path.basename(m.dir), stages }, null, 1));
    toAdd.push(path.join(m.dir, 'manifest.json'));
  }
  if (register !== null && register !== undefined) {
    writeFileSync(path.join(root, 'service-facts.json'), typeof register === 'string' ? register : JSON.stringify(register, null, 1));
    toAdd.push('service-facts.json');
  }
  execFileSync('git', ['add', '--', ...toAdd], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
  return root;
}

function run(root, ...flags) {
  const r = spawnSync(process.execPath, [CHECKER, ...flags], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* THE SAME RUN, STARTED SOMEWHERE ELSE INSIDE THE SAME ESTATE. Every case above
 * starts at the repository root, which is the one place where "the folder I am
 * standing in" and "the repository this is about" cannot differ — and the
 * stage engine never leaves the shell there (buses-data OA-275). */
function runFrom(root, sub, ...flags) {
  const r = spawnSync(process.execPath, [CHECKER, ...flags], { cwd: path.join(root, sub), encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const claim = (route, category = 'missing-service', operator = 'Fixture Buses') =>
  ({ category, route, evidence: { route, redteam: { operator } } });
const decided = (id, route, scope, extra = {}) => ({
  id, route, operator: 'Fixture Buses', scope, class: 'commercial', fact: { runs: true, public: true, summary: 'a fixture' },
  status: 'decided', decidedOn: '2026-09-01', decidedBy: 'prove-red', outcome: 'nothing', reason: 'fixture', recheckBy: '2027-09-01', ...extra,
});
const queued = (id, route, scope) => ({
  id, route, operator: 'Fixture Buses', scope, class: 'commercial', fact: { runs: null, public: true, summary: 'a fixture' },
  status: 'queued', question: 'is it real?', default: 'none',
});
const EMPTY = { facts: [] };
const town = (name, s1, s3, s6) => ({ dir: `Areas/${name}`, s1, s3, s6 });
const place = (townName, name, s3, s6) => ({ dir: `Areas/${townName}/Places/${name}`, s1: null, s3, s6 });
const standalone = (name, s3, s6) => ({ dir: `Places/_standalone/${name}`, s1: null, s3, s6 });

console.log('Falsifying check-s6-claims.mjs\n');

console.log('1. THE CONTROL — a town whose only claim is declared off in its own notOnLeaflet is green');
{
  const r = run(repo('control', [town('Fixture', { services: [{ route: '1' }], notOnLeaflet: [{ route: '99', note: 'school' }] }, { routeOrder: ['1'] }, [claim('99')])], EMPTY));
  check('exit 0', r.code === 0, `exit ${r.code}`);
  check('and it says what it looked at', /1 map\(s\) tracked/.test(r.out) && /1 map\(s\) had an S6 report/.test(r.out) && /own-exclusion 1/.test(r.out), r.out.trim().split('\n').slice(-4).join(' | '));
}

console.log('\n2. A claim with no home is RED, and the row says every place it looked');
{
  const r = run(repo('uncovered', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, [claim('77')])], EMPTY));
  check('exit 1', r.code === 1, `exit ${r.code}`);
  check('the row names the map, the run, the finding and the route', /Fixture  S6 2026-09-01_0000 F001  missing-service  77/.test(r.out), r.out.split('\n').find(l => l.includes('F001')));
  check('and says UNCOVERED with the register as the remedy', /UNCOVERED — no notOnLeaflet, no redteamRejected, no service-facts.json entry/.test(r.out), '');
}

console.log('\n3. Each of the three own-map homes covers, and the deprecated spelling still counts');
{
  const cases = [
    ['notOnLeaflet with servesTown:false (which known_off.js itself skips)', { services: [{ route: '1' }], notOnLeaflet: [{ route: '77', servesTown: false }] }, { routeOrder: ['1'] }, 'own-exclusion'],
    ['a deprecated field, read for ever', { services: [{ route: '1' }], notDisplayed: [{ route: '77', reason: 'old spelling' }] }, { routeOrder: ['1'] }, 'own-exclusion'],
    ['redteamRejected in S3', { services: [{ route: '1' }] }, { routeOrder: ['1'], redteamRejected: [{ route: '77', decidedOn: '2026-09-01', decidedBy: 'Peter', why: 'checked' }] }, 'own-rejection'],
  ];
  for (const [name, s1, s3, by] of cases) {
    const r = run(repo(`own-${by}-${cases.findIndex(c => c[0] === name)}`, [town('Fixture', s1, s3, [claim('77', by === 'own-rejection' ? 'serves-town' : 'missing-service')])], EMPTY));
    check(`${name} → ${by}, exit 0`, r.code === 0 && r.out.includes(`${by} 1`), `exit ${r.code}: ${r.out.split('\n').find(l => l.includes('claim(s) on'))}`);
  }
}

console.log('\n4. THE LOAD-BEARING CASE — a place\'s claim is covered by its PARENT TOWN\'s file (decision 4 as a mechanism)');
{
  const t = town('Wycombe', { services: [{ route: '1' }], notOnLeaflet: [{ route: '604', reason: 'school' }] }, { routeOrder: ['1'] }, null);
  const p = place('Wycombe', 'Aldi', { routeOrder: ['2'] }, [claim('604'), claim('1')]);
  const r = run(repo('parent', [t, p], EMPTY));
  check('exit 0 — neither claim is a new question', r.code === 0, `exit ${r.code}`);
  check('604 is parent-exclusion and 1 is parent-carries', /parent-exclusion 1/.test(r.out) && /parent-carries 1/.test(r.out), r.out.split('\n').find(l => l.includes('claim(s) on')));
  const r2 = run(repo('standalone-no-parent', [standalone('Lonely', { routeOrder: ['1'] }, [claim('604')])], EMPTY));
  check('...and a STANDALONE place has no parent to inherit from, so the same claim is red', r2.code === 1 && /UNCOVERED/.test(r2.out), `exit ${r2.code}`);
}

console.log('\n5. A register entry is a home — queued is enough, and scope is honoured');
{
  const t = town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, [claim('77')]);
  const r = run(repo('reg-queued', [t], { facts: [queued('SF-001', '77', ['Fixture'])] }));
  check('queued entry in scope: exit 0, counted as register-queued', r.code === 0 && /register-queued 1/.test(r.out), `exit ${r.code}`);
  check('and the summary names the queued id so the question is visible', /QUEUED register entry.*SF-001/.test(r.out), r.out.split('\n').find(l => l.includes('QUEUED')));
  const r2 = run(repo('reg-wrong-scope', [t], { facts: [queued('SF-001', '77', ['Elsewhere'])] }));
  check('the same entry scoped to another map covers nothing here', r2.code === 1 && /UNCOVERED/.test(r2.out), `exit ${r2.code}`);
  const r3 = run(repo('reg-star', [t], { facts: [queued('SF-001', '77', ['*'])] }));
  check('scope ["*"] covers every map', r3.code === 0, `exit ${r3.code}`);
  const p = place('Fixture', 'Shop', { routeOrder: ['1'] }, [claim('77')]);
  const r4 = run(repo('reg-parent-scope', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, null), p], { facts: [queued('SF-001', '77', ['Fixture'])] }));
  check('an entry scoped to the TOWN covers the town\'s nested place', r4.code === 0 && /register-queued 1/.test(r4.out), `exit ${r4.code}`);
}

console.log('\n6. Aliases and spellings: bracketed, slashed, and the alias list');
{
  const t = town('Fixture', { services: [{ route: '18', variants: { subServices: ['18A'] }, key: '18' }] }, { routeOrder: ['18'] }, [claim('18/18A'), claim('ZIP2(ELYZIPPER2)'), claim('THEAIRLINE')]);
  const r = run(repo('spellings', [t], { facts: [queued('SF-001', 'ZIP2', ['Fixture']), { ...queued('SF-002', 'LGW', ['Fixture']), aliases: ['The Airline'] }] }));
  check('18/18A meets the town\'s OWN 18 (a pairing failure, not a claim); ZIP2(brand) meets a register ZIP2; THEAIRLINE meets the alias', r.code === 0 && /own-carries 1/.test(r.out) && /register-queued 2/.test(r.out), `exit ${r.code}: ${r.out.split('\n').filter(l => /UNCOVERED|SILENT|claim\(s\) on/.test(l)).join(' | ')}`);
  const r2 = run(repo('own-carries-not-for-serves-town', [town('Fixture', { services: [{ route: '18' }] }, { routeOrder: ['18'] }, [claim('18', 'serves-town')])], EMPTY));
  check('...but a serves-town disagreement about a route we carry is NOT covered by carrying it — that is the disagreement', r2.code === 1 && /UNCOVERED/.test(r2.out), `exit ${r2.code}`);
}

console.log('\n7. THE OTHER LOAD-BEARING CASE — a decided entry over a SILENT map is red (the VL14 shape)');
{
  const a = town('Ives', { services: [{ route: 'VL14' }] }, { routeOrder: ['VL14'] }, null);
  const b = town('Huntingdon', { services: [{ route: '66' }] }, { routeOrder: ['66'] }, null);
  const r = run(repo('silence', [a, b], { facts: [decided('SF-001', 'VL14', ['Ives', 'Huntingdon'], { outcome: 'include' })] }));
  check('exit 1 although no claim is uncovered', r.code === 1 && /0 uncovered claim\(s\)/.test(r.out), `exit ${r.code}`);
  check('the row names the silent town and the remedy', /names Huntingdon in its scope, but Huntingdon's own file is SILENT/.test(r.out) && /VL14 shape/.test(r.out), r.out.split('\n').find(l => l.includes('SILENT')));
  check('and Ives, which carries it, is not named', !/Ives's own file is SILENT/.test(r.out), '');
  const r2 = run(repo('silence-queued-ok', [a, b], { facts: [queued('SF-001', 'VL14', ['Ives', 'Huntingdon'])] }));
  check('a QUEUED entry over the same silence is green — a question does not oblige a sheet yet', r2.code === 0, `exit ${r2.code}`);
  const r3 = run(repo('silence-cleared', [a, town('Huntingdon', { services: [{ route: '66' }], notOnLeaflet: [{ route: 'VL14', note: 'not at any stop here' }] }, { routeOrder: ['66'] }, null)], { facts: [decided('SF-001', 'VL14', ['Ives', 'Huntingdon'], { outcome: 'include' })] }));
  check('and the same entry is green once Huntingdon writes its own field', r3.code === 0, `exit ${r3.code}`);
}

console.log('\n8. The register\'s own shape: missing keys, bad status, bad outcome, duplicate id, unknown scope, contradiction');
{
  const t = town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, null);
  const cases = [
    ['a decided entry missing recheckBy', { facts: [{ ...decided('SF-001', '1', ['Fixture']), recheckBy: undefined }] }, /SF-001 is missing recheckBy/],
    ['a queued entry with no question', { facts: [{ ...queued('SF-001', '1', ['Fixture']), question: undefined }] }, /SF-001 is missing question/],
    ['status neither queued nor decided', { facts: [{ ...queued('SF-001', '1', ['Fixture']), status: 'maybe' }] }, /status "maybe" is not queued or decided/],
    ['an outcome outside include|off|nothing', { facts: [decided('SF-001', '1', ['Fixture'], { outcome: 'ignore' })] }, /outcome "ignore" is not one of/],
    ['two entries with one id', { facts: [decided('SF-001', '1', ['Fixture']), decided('SF-001', '2', ['Fixture'])] }, /id SF-001 is used twice/],
    ['a scope naming no tracked map', { facts: [decided('SF-001', '1', ['Atlantis'])] }, /scope names "Atlantis", which is no tracked map/],
    ['two decided entries that contradict on `runs`', { facts: [decided('SF-001', '1', ['Fixture'], { fact: { runs: true, public: true } }), decided('SF-002', '1', ['Fixture'], { fact: { runs: false, public: true } })] }, /SF-001 and SF-002 disagree about whether 1 .* `runs`/],
    ['a register that will not parse', '{ not json', /could not be parsed as JSON/],
    ['no register at all', null, /is not at the repository root/],
    ['a register with no facts array', { notFacts: [] }, /has no `facts` array/],
  ];
  for (const [name, reg, re] of cases) {
    const r = run(repo(`shape-${cases.findIndex(c => c[0] === name)}`, [t], reg));
    check(`${name}: exit 1 and named`, r.code === 1 && re.test(r.out), `exit ${r.code}: ${r.out.split('\n').find(l => l.includes('service-facts.json:')) || ''}`);
  }
}

console.log('\n9. THE SPLIT — what CI can and cannot see');
{
  const t = town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, 'absent-file');
  const r = run(repo('no-report', [t], EMPTY));
  check('a tree with an S6 run but no verification.json is green by default, and SAYS the map had none', r.code === 0 && /1 had none \(Fixture: S6 2026-09-01_0000 has no verification.json on this disk\)/.test(r.out), `exit ${r.code}: ${r.out.split('\n').find(l => l.includes('had none'))}`);
  const r2 = run(repo('no-report-required', [t], EMPTY), '--require-reports');
  check('--require-reports makes the same tree RED — a laptop run that finds nothing has checked nothing', r2.code === 1 && /RED: --require-reports/.test(r2.out), `exit ${r2.code}`);
  const r3 = run(repo('register-only', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, [claim('77')])], EMPTY), '--register-only');
  check('--register-only ignores an uncovered claim it did not look for, and says the half was NOT RUN', r3.code === 0 && /coverage half NOT RUN/.test(r3.out), `exit ${r3.code}`);
  const r4 = run(repo('register-only-still-checks', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, null)], { facts: [decided('SF-001', 'VL14', ['Fixture'], { outcome: 'include' })] }), '--register-only');
  check('...but still runs the register half, so a silence is red under it', r4.code === 1 && /SILENT/.test(r4.out), `exit ${r4.code}`);
}

console.log('\n10. An unreadable file is REPORTED, never skipped into silence');
{
  const r = run(repo('broken-report', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, 'broken')], EMPTY));
  check('a verification.json that will not parse is red and named', r.code === 1 && /verification.json\n\s+could not be parsed as JSON — its claims could not be counted/.test(r.out), `exit ${r.code}`);
}

console.log('\n12. A tree that is not a repository is a usage error (exit 2) — and under --json also a readable answer, so a board can tell it from a crash');
{
  const root = path.join(TMP, 'not-a-repo'); mkdirSync(root, { recursive: true });
  const r = run(root);
  check('exit 2 without --json', r.code === 2 && /could not list tracked files/.test(r.out), `exit ${r.code}`);
  const r2 = spawnSync(process.execPath, [CHECKER, '--json'], { cwd: root, encoding: 'utf8' });
  let j = null; try { j = JSON.parse(r2.stdout); } catch { /* left null */ }
  check('exit 2 with --json, and the JSON says notARepository and red:false', r2.status === 2 && !!j && j.notARepository === true && j.red === false, `exit ${r2.status}: ${(r2.stdout || '').slice(0, 80)}`);
}

console.log('\n11. --json carries the same verdict, and an unknown flag is a usage error');
{
  const root = repo('json', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, [claim('77')])], EMPTY);
  const r = run(root, '--json');
  let j = null; try { j = JSON.parse(r.out); } catch { /* left null */ }
  check('parses, red, one uncovered claim named', !!j && j.red === true && j.uncovered.length === 1 && j.uncovered[0].route === '77' && j.claims === 1, r.out.slice(0, 120));
  const r2 = spawnSync(process.execPath, [CHECKER, '--all'], { cwd: root, encoding: 'utf8' });
  check('exit 2 and the known flags are listed', r2.status === 2 && /known: --root/.test((r2.stdout || '') + (r2.stderr || '')), `exit ${r2.status}`);
}

console.log('\n13. STARTED IN A RUN FOLDER — the estate is the enclosing repository, not the cwd (OA-275 step 2)');
{
  /* THIS IS THE OBSERVED FAULT, NOT A CONTRIVED ONE. `stage.js`,
   * `redteam_source.js` and `verify_report.js` take their cwd as their SUBJECT
   * and have no directory argument, so every S1–S6 call is made from a map or a
   * run folder and leaves the shell there. Run from `Areas/Beaconsfield` on
   * 2026-09-08 this checker reported `2 map(s) tracked; 11 claim(s) — UNCOVERED
   * 11`; from the repository root, same commit, `20 map(s) tracked … every claim
   * has a home`. Both name a real directory and count real maps, and the wrong
   * one is the red — which is the better half of the accident, because the same
   * mechanism silently narrows the corpus of a checker that then reports GREEN.
   *
   * The fixture is the parent-town shape, because that is what a narrowed
   * corpus destroys: the place's claim is answered by a file one folder ABOVE
   * the place, so a checker scoped to the place cannot see the answer and the
   * claim reads as a new question. */
  const t = town('Wycombe', { services: [{ route: '1' }], notOnLeaflet: [{ route: '604', reason: 'school' }] }, { routeOrder: ['1'] }, null);
  const p = place('Wycombe', 'Aldi', { routeOrder: ['2'] }, [claim('604')]);
  const root = repo('cwd-run-folder', [t, p], EMPTY);
  const where = path.join('Areas', 'Wycombe', 'Places', 'Aldi', 'S6-verify', '2026-09-01_0000');
  const below = runFrom(root, where);
  check('started in the place\'s own S6 run folder: still exit 0, the parent town was read', below.code === 0 && /parent-exclusion 1/.test(below.out), `exit ${below.code}: ${below.out.split('\n').find(l => l.includes('map(s) tracked')) || below.out.trim().slice(0, 120)}`);
  check('and it counted the whole estate — 2 maps, the same as from the root', /2 map\(s\) tracked/.test(below.out) && /2 map\(s\) tracked/.test(run(root).out), below.out.split('\n').find(l => l.includes('map(s) tracked')));
  check('the line it prints names the repository root, not the folder it was started in', new RegExp(`check-s6-claims — ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(below.out), below.out.split('\n')[0]);
}

console.log('\n14. WHAT A DECIDED `include` STILL OWES — enumerated, never red, and able to answer "none" (buses-data OA-285)');
{
  /* THE CONTROL COMES FIRST, because this section ADDS output rather than a
   * finding, and the direction that gets a check muted is a line printed about
   * every decided entry. An `off` is FINISHED when the map declares the route
   * off; an `include` is UNFINISHED in exactly the same state, and only the
   * second may appear. */
  const offMap = (route) => town('Fixture', { services: [{ route: '1' }], notOnLeaflet: [{ route, note: 'awaiting the next rebuild' }] }, { routeOrder: ['1'] }, null);
  const carries = town('Fixture', { services: [{ route: '1' }, { route: 'TIGER' }] }, { routeOrder: ['1', 'TIGER'] }, null);

  const rOff = run(repo('owed-control-off', [offMap('TIGER')], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'off' })] }));
  check('CONTROL: a decided `off` in the same state is green and says NOTHING about a rebuild', rOff.code === 0 && !/WAITING on a rebuild/.test(rOff.out), `exit ${rOff.code}`);
  const rNothing = run(repo('owed-control-nothing', [offMap('TIGER')], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'nothing' })] }));
  check('CONTROL: so is a decided `nothing`', rNothing.code === 0 && !/WAITING on a rebuild/.test(rNothing.out), `exit ${rNothing.code}`);

  const r = run(repo('owed-include', [offMap('TIGER')], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'include', drawing: { Fixture: 'a Services-panel line carrying the booking number' } })] }));
  check('an `include` whose map still declares it off is ENUMERATED and still exit 0 — this is not a finding', r.code === 0 && /1 decided "include" entry is WAITING on a rebuild/.test(r.out), `exit ${r.code}: ${r.out.split('\n').find(l => l.includes('WAITING')) || ''}`);
  check('the row names the entry, the map, the route and the file the exclusion is written in', /SF-001  Fixture  TIGER — waiting; still declared off in Areas.Fixture.S1-services.2026-09-01_0000.verified-services.json/.test(r.out), r.out.split('\n').find(l => l.includes('SF-001')));
  check('and it carries what the register says is owed, so the reader does not have to open the file', /owes: a Services-panel line carrying the booking number/.test(r.out), '');

  /* THE COUNT MUST BE ABLE TO ANSWER "NONE OF THEM" — the shape recorded as
   * "the count that equalled the total". Once the map lists the route, the same
   * register entry reads as paid rather than disappearing from the output. */
  const rPaid = run(repo('owed-paid', [carries], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'include' })] }));
  check('once the map LISTS the route the same entry reads 0 waiting, and says the entry can be closed', rPaid.code === 0 && /0 decided "include" entries are WAITING/.test(rPaid.out) && /the map now lists this route/.test(rPaid.out), `exit ${rPaid.code}: ${rPaid.out.split('\n').find(l => l.includes('WAITING')) || ''}`);

  /* A SILENT map is the OTHER check's business and must not be double-reported
   * here, or the same fault would print twice under two different names. */
  const rSilent = run(repo('owed-silent', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, null)], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'include' })] }));
  check('a SILENT map is red as a silence and is NOT also listed as owed', rSilent.code === 1 && /SILENT/.test(rSilent.out) && !/WAITING on a rebuild/.test(rSilent.out), `exit ${rSilent.code}`);

  const rJson = run(repo('owed-json', [offMap('TIGER')], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'include' })] }), '--json');
  let j = null; try { j = JSON.parse(rJson.out); } catch { /* left null */ }
  check('--json carries register.owed, which is how the board and the worklist read it', !!j && Array.isArray(j.register.owed) && j.register.owed.length === 1 && j.register.owed[0].id === 'SF-001' && j.register.owed[0].state === 'waiting' && j.red === false, rJson.out.slice(0, 120));

  const rCi = run(repo('owed-register-only', [offMap('TIGER')], { facts: [decided('SF-001', 'TIGER', ['Fixture'], { outcome: 'include' })] }), '--register-only');
  check('and CI sees it too: the debt is register-half work, so --register-only prints it', rCi.code === 0 && /1 decided "include" entry is WAITING/.test(rCi.out), `exit ${rCi.code}`);
}

/* ---------------------------------------------------------------------------
 * THE QUEUED ENTRY NO CLAIM REACHES — the population, not the verdict.
 *
 * `queued` in the JSON is a list of CLAIMS covered by a queued entry, and for a
 * year that was also the list the worklist board built its "questions awaiting a
 * decision" row from. The two are not the same population: OA-004 decision 4
 * makes a fact about a service estate-wide, so an entry can be queued about a
 * town no red team has read, and such an entry produced no claim and therefore no
 * row. SF-015 (Tiger on Demand at March, `raisedBy: []`) sat that way, while the
 * checker's own text said "2 queued" and the board said one.
 *
 * BOTH DIRECTIONS, because the fix is a widening and a widening's own failure
 * mode is counting something twice: the unclaimed entry must appear AND be marked
 * unclaimed, and the claimed one must still be marked claimed and still name its
 * maps. The control that matters most is the last: a register with nothing queued
 * must produce an EMPTY list, not an absent field — the shape recorded as *the
 * count that equalled the total*.
 * ------------------------------------------------------------------------- */
{
  console.log('\nqueued register entries are enumerated whether or not a claim reaches them');

  const silentTown = town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, null);
  const claimingTown = town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'] }, [claim('TIGER')]);

  /* No S6 report anywhere, so no claim can exist; the entry is queued all the same.
   * The coverage half DOES run here — that is what makes `claimed:false` an
   * answer rather than an absence. See the --register-only pair at the end. */
  const rNone = run(repo('queued-no-claim', [silentTown], { facts: [queued('SF-050', 'TIGER', ['Fixture'])] }), '--json');
  let jNone = null; try { jNone = JSON.parse(rNone.out); } catch { /* left null */ }
  check('a queued entry that NO claim reaches is still in register.queuedFacts',
    !!jNone && Array.isArray(jNone.register.queuedFacts) && jNone.register.queuedFacts.length === 1 && jNone.register.queuedFacts[0].id === 'SF-050',
    rNone.out.slice(0, 140));
  /* Every dereference below is guarded. A harness that THROWS on a broken subject
   * still exits non-zero, so the gate is red either way — but it stops before the
   * later cases run, and a second fault hiding behind the first is exactly what a
   * falsification suite exists to prevent. Found by breaking this checker on
   * purpose: the first draft crashed here instead of printing five more results. */
  const qf0 = (jNone && jNone.register && (jNone.register.queuedFacts || [])[0]) || null;
  check('and it is marked claimed:false with no maps, so the reader is not told a red team named it',
    !!qf0 && qf0.claimed === false && Array.isArray(qf0.maps) && qf0.maps.length === 0, qf0 ? JSON.stringify(qf0) : '(no entry at all)');
  check('THE OLD LIST STILL MISSES IT — `queued` is claims, and this is what the board used to read',
    !!jNone && Array.isArray(jNone.queued) && jNone.queued.length === 0,
    'if this ever becomes non-empty the two fields have merged and the comment above is wrong');
  /* The text half is its OWN run: `--json` suppresses the prose entirely, and the
   * first draft of this case asserted on prose in a --json run and failed. Which
   * is the harness doing its job — the assertion was wrong, not the checker. */
  const rNoneText = run(repo('queued-no-claim-text', [silentTown], { facts: [queued('SF-050', 'TIGER', ['Fixture'])] }));
  check('the text output names it too, and says in words that nothing else enumerates it',
    /SF-050 {2}TIGER {2}scope Fixture — RAISED BY NO CLAIM/.test(rNoneText.out), rNoneText.out.split('\n').find((l) => l.includes('SF-050')) || '(no line mentioning SF-050)');
  check('and it is enumeration rather than a finding: still exit 0', rNone.code === 0 && rNoneText.code === 0, `exit ${rNone.code}/${rNoneText.code}`);

  /* CONTROL: the ordinary shape, where an S6 report did raise it. */
  const rClaimed = run(repo('queued-with-claim', [claimingTown], { facts: [queued('SF-050', 'TIGER', ['Fixture'])] }), '--json');
  let jClaimed = null; try { jClaimed = JSON.parse(rClaimed.out); } catch { /* left null */ }
  const qc0 = (jClaimed && jClaimed.register && (jClaimed.register.queuedFacts || [])[0]) || null;
  check('CONTROL: a queued entry a claim DOES reach is marked claimed:true and names the map',
    !!qc0 && jClaimed.register.queuedFacts.length === 1 && qc0.claimed === true && (qc0.maps || []).join() === 'Fixture',
    qc0 ? JSON.stringify(qc0) : rClaimed.out.slice(0, 140));
  check('CONTROL: and the claims list still carries it, so nothing the old row read was taken away',
    !!jClaimed && (jClaimed.queued || []).length === 1 && jClaimed.queued[0].id === 'SF-050', '');

  /* CONTROL: the count must be able to answer "none of them". */
  const rEmpty = run(repo('queued-none', [silentTown], { facts: [decided('SF-051', 'TIGER', ['Fixture'], { outcome: 'nothing' })] }), '--json', '--register-only');
  let jEmpty = null; try { jEmpty = JSON.parse(rEmpty.out); } catch { /* left null */ }
  check('CONTROL: a register with nothing queued gives an EMPTY list and an empty count, not a missing field',
    !!jEmpty && !!jEmpty.register && Array.isArray(jEmpty.register.queuedFacts) && jEmpty.register.queuedFacts.length === 0 && jEmpty.register.queued === 0, '');
  check('CONTROL: and prints no queued section at all', !/QUEUED register/.test(rEmpty.out), '');

  /* THE JOIN. The count and the list live in the same object and disagreed for as
   * long as one was read and the other was not; assert they cannot again. */
  const rTwo = run(repo('queued-two', [claimingTown], { facts: [queued('SF-050', 'TIGER', ['Fixture']), queued('SF-051', 'OTHER', ['Elsewhere'])] }), '--json', '--register-only');
  let jTwo = null; try { jTwo = JSON.parse(rTwo.out); } catch { /* left null */ }
  const twoReg = (jTwo && jTwo.register) || null;
  check('THE JOIN: register.queued (the count) equals register.queuedFacts.length (the list), which is the disagreement that hid SF-015',
    !!twoReg && twoReg.queued === 2 && (twoReg.queuedFacts || []).length === 2,
    `count ${twoReg && twoReg.queued}, list ${twoReg && (twoReg.queuedFacts || []).length}`);
  check('and an entry whose scope names no tracked map is in the list anyway — that scope is why SF-015 vanished',
    !!twoReg && (twoReg.queuedFacts || []).some((q) => q.id === 'SF-051'), '');

  /* THE NEGATIVE FROM A SEARCH THAT NEVER RAN. --register-only reads no S6
   * report, so `queued` is empty by CONSTRUCTION there and a naive
   * `queued.some(...)` reports every entry as raised by nobody. The first draft
   * of this field did that and printed it about SF-008 on the real estate, which
   * is raised by three claims. So under --register-only the answer is null and
   * the prose says it did not look — the distinction between "no" and "did not
   * ask" being the whole point. Both directions, on the SAME fixture. */
  const fixtureClaimed = { facts: [queued('SF-050', 'TIGER', ['Fixture'])] };
  const rRegOnly = run(repo('queued-register-only-null', [claimingTown], fixtureClaimed), '--json', '--register-only');
  let jReg = null; try { jReg = JSON.parse(rRegOnly.out); } catch { /* left null */ }
  const qr0 = (jReg && jReg.register && (jReg.register.queuedFacts || [])[0]) || null;
  check('--register-only reports claimed:null — "not looked at", not "nobody raised it"',
    !!qr0 && qr0.claimed === null, qr0 ? JSON.stringify(qr0) : '(no entry at all)');
  const rRegOnlyText = run(repo('queued-register-only-text', [claimingTown], fixtureClaimed), '--register-only');
  check('and its prose says so, instead of asserting a negative it did not measure',
    /SF-050.*was NOT CHECKED \(--register-only reads no S6 report\)/.test(rRegOnlyText.out) && !/RAISED BY NO CLAIM/.test(rRegOnlyText.out),
    rRegOnlyText.out.split('\n').find((l) => l.includes('SF-050')) || '(no line mentioning SF-050)');
  check('CONTROL, same fixture, coverage half RUN: the claim is found and the answer is claimed:true',
    !!qc0 && qc0.claimed === true, 'if this were false the null above would be hiding a real miss rather than an unasked question');
}

/* ---------------------------------------------------------------------------
 * 15. THE BADGE THE SHEET PRINTS vs THE KEY THE OPERATOR REGISTERED.
 *
 * A blind red team reads the SHEET, so its claim is keyed on the printed badge;
 * every file we own is keyed on the registration. `badgeLabels` in a map's S3 is
 * the join, and it is a normal deliberate thing this engine does — so the
 * mismatch is guaranteed for every route that carries one, not a rare accident.
 * SF-014 sat QUEUED for eleven days saying "neither the place nor the St Neots
 * town file carries a 61"; both carried it, as 61EY, badged "61".
 *
 * THIS IS A WIDENING, so the controls come first and there are three of them.
 * A widening's failure mode is covering something it should not, and the
 * dangerous direction here is real: Wisbech PRINTS "46" for `46L` and also
 * carries a genuine 46, so a label can be a live key on the same map. If the
 * alias were consulted before the direct tests, a claim about the real route
 * would be silently re-pointed at a different one — a false green on exactly the
 * question this checker exists to ask.
 * ------------------------------------------------------------------------- */
{
  console.log('\n15. A claim keyed on the BADGE, where the map carries the REGISTERED key, is ALIASED — not missing, and not silent');

  // St Neots' real shape: the place draws 61EY and prints "61" on it.
  const badged = (extra = {}) => ({ routeOrder: ['61EY'], badgeLabels: { '61EY': '61' }, ...extra });
  const aliasPlace = (s6) => place('Neots', 'Tesco', badged(), s6);
  const parentTown = { services: [{ route: '61EY' }] };

  /* CONTROL 1, THE LOAD-BEARING ONE — Wisbech's shape, where the printed label is
   * ALSO a real registered key on the same map. The claim must meet the route it
   * names, as itself, and the alias must never be reached. */
  const wisbech = town('Wisbech', { services: [{ route: '46' }, { route: '46L' }] }, { routeOrder: ['46', '46L'], badgeLabels: { '46L': '46' } }, [claim('46')]);
  const rReal = run(repo('alias-control-real-key', [wisbech], EMPTY), '--json');
  let jReal = null; try { jReal = JSON.parse(rReal.out); } catch { /* left null */ }
  check('CONTROL: a label that is ALSO a real key on the map meets the real route, as own-carries, and the alias is never consulted',
    rReal.code === 0 && !!jReal && (jReal.coveredBy || {})['own-carries'] === 1 && !(jReal.coveredBy || {})['badge-alias'],
    `exit ${rReal.code}: ${JSON.stringify(jReal && jReal.coveredBy)}`);

  /* CONTROL 2 — a `badgeLabels` line naming a key the map does not carry anywhere
   * is a stale config line, not a home. */
  const rStale = run(repo('alias-control-stale', [town('Fixture', { services: [{ route: '1' }] }, { routeOrder: ['1'], badgeLabels: { '61EY': '61' } }, [claim('61')])], EMPTY));
  check('CONTROL: a badgeLabels entry naming a key the map carries NOWHERE is still UNCOVERED and red',
    rStale.code === 1 && /UNCOVERED/.test(rStale.out), `exit ${rStale.code}`);

  /* CONTROL 3 — the same estate with the badgeLabels line removed is red, which is
   * what makes every green below attributable to the alias and to nothing else. */
  const rNoLabels = run(repo('alias-control-no-labels', [town('Neots', parentTown, { routeOrder: ['61EY'] }, null), place('Neots', 'Tesco', { routeOrder: ['61EY'] }, [claim('61')])], EMPTY));
  check('CONTROL: strip badgeLabels and the identical estate is RED — the alias is what changes the answer',
    rNoLabels.code === 1 && /UNCOVERED/.test(rNoLabels.out), `exit ${rNoLabels.code}`);

  /* THE CASE ITSELF — SF-014 on the day it was filed, with nothing written down. */
  const sf014 = [town('Neots', parentTown, { routeOrder: ['61EY'] }, null), aliasPlace([claim('61')])];
  const rAlias = run(repo('alias-covers', sf014, EMPTY));
  check('a missing-service claim keyed "61" is covered with an EMPTY register — eleven days of queue, answered for nothing',
    rAlias.code === 0 && /1 claim\(s\) are ALIASED/.test(rAlias.out), `exit ${rAlias.code}: ${rAlias.out.split('\n').find((l) => /ALIASED|UNCOVERED/.test(l)) || ''}`);
  check('and the row NAMES the registered key, the field it is carried in, and the file the join is declared in',
    /"61" is 61EY, carried by Tesco in its routeOrder — the join is `badgeLabels` in Areas.Neots.Places.Tesco.S3-config/.test(rAlias.out),
    rAlias.out.split('\n').find((l) => l.includes('61EY')) || '(no line naming 61EY)');

  const rAliasJson = run(repo('alias-covers-json', sf014, EMPTY), '--json');
  let jAlias = null; try { jAlias = JSON.parse(rAliasJson.out); } catch { /* left null */ }
  const ac0 = (jAlias && (jAlias.aliasedClaims || [])[0]) || null;
  check('--json carries aliasedClaims, which is how a board reads it without parsing prose',
    !!ac0 && ac0.by === 'badge-alias' && ac0.registered === '61EY' && ac0.label === '61' && ac0.map === 'Tesco' && jAlias.red === false,
    ac0 ? JSON.stringify(ac0) : rAliasJson.out.slice(0, 160));

  /* THE PARENT TOWN'S badgeLabels reaches its place, like every other home. */
  const rParent = run(repo('alias-parent', [town('Neots', parentTown, badged(), null), place('Neots', 'Tesco', { routeOrder: [] }, [claim('61')])], EMPTY));
  check('the PARENT TOWN\'s badgeLabels covers its place\'s claim, and the row says which map the join came from',
    rParent.code === 0 && /carried by Neots in its verified set/.test(rParent.out), `exit ${rParent.code}`);

  /* THE REGISTER STILL WINS, and this is the assertion that protects `queuedFacts`.
   * If the alias were tried first, a queued entry raised by exactly this claim
   * would report RAISED BY NO CLAIM — a negative from a search that stopped
   * early, which is the shape the field above this one exists to prevent. */
  const rReg = run(repo('alias-register-first', sf014, { facts: [queued('SF-014', '61', ['Tesco'])] }), '--json');
  let jReg = null; try { jReg = JSON.parse(rReg.out); } catch { /* left null */ }
  const qf = (jReg && jReg.register && (jReg.register.queuedFacts || [])[0]) || null;
  check('a claim that ALREADY has a register entry keeps it — register-queued, not badge-alias',
    !!jReg && (jReg.coveredBy || {})['register-queued'] === 1 && !(jReg.coveredBy || {})['badge-alias'], JSON.stringify(jReg && jReg.coveredBy));
  check('...which is what keeps the queued entry marked claimed:true instead of RAISED BY NO CLAIM',
    !!qf && qf.claimed === true && (qf.maps || []).join() === 'Tesco', qf ? JSON.stringify(qf) : '(no entry at all)');

  /* A DISAGREEMENT IS NOT LAUNDERED BY SPELLING IT DIFFERENTLY. Case 6 holds that
   * carrying a route is no home for a `serves-town` claim about it; the alias must
   * obey the same rule, or the widening quietly repeals it. */
  const rServes = run(repo('alias-serves-town', [town('Neots', parentTown, badged(), [claim('61', 'serves-town')])], EMPTY));
  check('a serves-town disagreement keyed on the badge, over the map\'s OWN carried route, is STILL UNCOVERED — carrying it is not an answer to "it does not serve"',
    rServes.code === 1 && /UNCOVERED/.test(rServes.out), `exit ${rServes.code}`);

  /* THE ASYMMETRY THAT VERSION OF THE ASSERTION FOUND — SETTLED ON 2026-09-11, and
   * the pin now holds the answer rather than the question. The checker excluded
   * `own-carries` for a serves-town claim and did NOT exclude `parent-carries`, so
   * the identical disagreement raised on a PLACE was covered silently by its parent
   * town carrying the route. It was settled by counting before deciding: on all 19
   * S6 reports the estate then held, 33 of 33 `parent-carries` claims were
   * `missing-service` and none was a `serves-town`, so extending the gate moved no
   * real claim and the checker's `--json` verdict is byte-identical either side.
   * The exclusion is a statement about the CLAIM, not about which file holds the
   * route; `parent-exclusion` and `parent-rejection` stay ungated because those are
   * adjudications rather than restatements. Both halves moved together, as the
   * previous version of this comment required. */
  const rServesDirect = run(repo('alias-serves-town-parent-direct', [town('Neots', parentTown, { routeOrder: ['61EY'] }, null), place('Neots', 'Tesco', { routeOrder: ['61EY'] }, [claim('61EY', 'serves-town')])], EMPTY));
  check('no alias in play: a place\'s serves-town claim is NOT covered by its parent town merely carrying the route',
    rServesDirect.code === 1 && /UNCOVERED/.test(rServesDirect.out) && !/parent-carries/.test(rServesDirect.out), `exit ${rServesDirect.code}`);
  const rServesParent = run(repo('alias-serves-town-parent', [town('Neots', parentTown, badged(), null), aliasPlace([claim('61', 'serves-town')])], EMPTY));
  check('...and the alias gives that same answer for the badge spelling — the two spellings must not be classified differently',
    rServesParent.code === 1 && /UNCOVERED/.test(rServesParent.out), `exit ${rServesParent.code}`);
  /* THE CONTROL THAT KEEPS THE NARROWING HONEST: the same parent, the same route,
   * a `missing-service` claim instead — still `parent-carries`, because there the
   * parent carrying the route IS the answer (it is a pairing failure, not a
   * disagreement). Without this, gating everything would pass the two above. */
  /* The place must NOT carry the route itself here, or `own-carries` answers first
   * and the control proves nothing about the parent — which is what it did on the
   * first run of this assertion. */
  const rMissParent = run(repo('parent-carries-missing-service-control', [town('Neots', parentTown, { routeOrder: ['61EY'] }, null), place('Neots', 'Tesco', { routeOrder: ['9'] }, [claim('61EY', 'missing-service')])], EMPTY));
  check('CONTROL — a missing-service claim about the same route IS still covered by the parent carrying it',
    rMissParent.code === 0 && /parent-carries 1/.test(rMissParent.out), `exit ${rMissParent.code}`);
  const rServesOff = run(repo('alias-serves-town-off', [town('Neots', parentTown, badged(), null), place('Neots', 'Tesco', { routeOrder: [], badgeLabels: { '61EY': '61' }, notOnLeaflet: [{ route: '61EY', note: 'not at this stop' }] }, [claim('61', 'serves-town')])], EMPTY));
  check('...but the same claim IS covered once the map declares the registered key off — the alias reaches an exclusion, as the direct test does',
    rServesOff.code === 0 && /1 claim\(s\) are ALIASED/.test(rServesOff.out), `exit ${rServesOff.code}`);

  /* THE SILENCE HALF — the other place the two spellings meet. */
  const silentSide = [town('Neots', parentTown, badged(), null)];
  const rSil = run(repo('alias-silence', silentSide, { facts: [decided('SF-014', '61', ['Neots'], { outcome: 'nothing' })] }));
  check('a decided entry keyed "61" over a map carrying 61EY is NOT SILENT — exit 0, and no VL14 row',
    rSil.code === 0 && !/SILENT/.test(rSil.out), `exit ${rSil.code}: ${rSil.out.split('\n').find((l) => l.includes('SF-014')) || ''}`);
  check('it is enumerated as ALIASED instead, naming the registered key and the aliases[] that would make the join explicit',
    /SF-014 names 61 and Neots carries it as 61EY in its verified set — ALIASED, not silent/.test(rSil.out) && /Add "61EY" to this entry's aliases\[\]/.test(rSil.out),
    rSil.out.split('\n').find((l) => l.includes('ALIASED')) || '(no ALIASED line)');
  const rSilNoLabel = run(repo('alias-silence-control', [town('Neots', parentTown, { routeOrder: ['61EY'] }, null)], { facts: [decided('SF-014', '61', ['Neots'], { outcome: 'nothing' })] }));
  check('CONTROL: the same entry over the same map WITHOUT badgeLabels is still SILENT and red',
    rSilNoLabel.code === 1 && /Neots's own file is SILENT/.test(rSilNoLabel.out), `exit ${rSilNoLabel.code}`);
  const rSilJson = run(repo('alias-silence-json', silentSide, { facts: [decided('SF-014', '61', ['Neots'], { outcome: 'nothing' })] }), '--json', '--register-only');
  let jSil = null; try { jSil = JSON.parse(rSilJson.out); } catch { /* left null */ }
  const al0 = (jSil && jSil.register && (jSil.register.aliased || [])[0]) || null;
  check('CI\'s half sees it too: --register-only carries register.aliased and an empty register.silences',
    !!al0 && al0.registered === '61EY' && al0.map === 'Neots' && (jSil.register.silences || []).length === 0 && jSil.red === false,
    al0 ? JSON.stringify(al0) : rSilJson.out.slice(0, 160));

  /* AND THE `owed` ENUMERATION MUST ASK THE SAME QUESTION THE SILENCE CHECK ASKS.
   * Before this it did not: an aliased `include` was not silent (so no row there)
   * and read as silent here (so no row here either), and the entry was enumerated
   * nowhere at all — *the claim with no named home*, inside the checker built to
   * stop exactly that. */
  const rOwed = run(repo('alias-owed', silentSide, { facts: [decided('SF-014', '61', ['Neots'], { outcome: 'include' })] }));
  check('a decided `include` carried only under the registered key reads CARRIED rather than vanishing from the enumeration',
    rOwed.code === 0 && /0 decided "include" entries are WAITING/.test(rOwed.out) && /the map now lists this route/.test(rOwed.out),
    `exit ${rOwed.code}: ${rOwed.out.split('\n').find((l) => l.includes('SF-014  Neots')) || '(no owed row)'}`);
  check('and the owed row says out loud that the two spellings are the reason it looks paid',
    /\[ALIASED: the map spells it 61EY and badges it "61"\]/.test(rOwed.out), rOwed.out.split('\n').find((l) => l.includes('SF-014  Neots')) || '');
}

console.log('\n' + '='.repeat(78));
rmSync(TMP, { recursive: true, force: true });
if (failures) {
  console.log(`FAILED — ${failures} of ${ran} assertions did not hold`);
  process.exit(1);
}
console.log(`OK — all ${ran} assertions held: a claim with no home is red, a parent town's decision reaches its places, a decided entry over a silent map is red, and CI's half says what it did not look at`);
