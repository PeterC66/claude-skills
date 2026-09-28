#!/usr/bin/env node
// measure.mjs — the standing counts the codebase review compares between runs.
//
//   node assets/measure.mjs            # a table
//   node assets/measure.mjs --json     # the same numbers as JSON, for saving beside the review
//
// Run from this skill's folder, C:\u3a St Ives\.claude\skills\review-bus-codebases.
// Reads three checkouts and writes nothing. Their locations come from BUSES_DIR,
// SKILLS_DIR and BUSMAPS_PORTAL, or --buses / --skills / --portal, and only then
// from the laptop defaults printed below — the review itself counts laptop-path
// defaults as a finding, so this file states its own.
//
// WHY NUMBERS. The 2026-09-01 review found that a refactor's rule had held for
// zero of the next thirteen commits, and the only reason anyone noticed was a
// count in a headline that no longer matched `wc -l`. Impressions do not drift
// visibly; counts do. Every number here was a finding in that review, so a rise
// in any of them is a finding in the next one before a reviewer has read a line.
//
// These are MEASURES, not gates: nothing here exits non-zero on a count. The
// ratchet in make-bus-leaflet/tools/line-ratchet.js is the gate for the first
// group; the rest are the candidates for the next ratchets.
//
// EXIT CODES. 0 measured; 2 a checkout or the ratchet ledger is missing. Until
// 2026-09-28 a wrong --skills path printed zeros and exited 0 (review G11): a
// count over nothing reads exactly like a count of nothing, so an absent subject
// is refused, per the conventions page's "a check that cannot find its subject
// must exit non-zero". assets/test-measure.mjs holds this file to that, and to
// the population rule below; it is `npm run test:measure` here and a gates.yml step.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
/*
 * EVERY POPULATION IS WHAT GIT TRACKS, never a walk of the disk (2026-09-28,
 * review R3 F23, R6 N13). A disk walk counts what happens to be lying in a
 * checkout: the 2026-09-14 review reported buses-data's laptop paths doubling in
 * eleven days, and the truth was a worktree left inside that repository, a
 * second copy of every file. The fix then was a NEVER_WALK list of `.git` and
 * `.claude`, which excluded the tracked files under `.claude/` along with the
 * worktrees, and which knew about the two hiding places somebody had already
 * found. `git ls-files` answers the question the review asks, what is in the
 * repository, and has no list to keep: a worktree, a build output or a stray
 * file is untracked, so it is not counted, wherever it is.
 */
function tracked(repo, sub, { exts, skip = [] }) {
  const r = spawnSync('git', ['-C', repo, 'ls-files', '-z', '--', sub], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter(Boolean)
    .filter((rel) => exts.some((x) => rel.endsWith(x)))
    .filter((rel) => !rel.split('/').some((seg) => skip.includes(seg)))
    .map((rel) => path.join(repo, rel));
}
const isCheckout = (dir) => exists(dir) && spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).status === 0;

const countLines = (p) => { const r = read(p).replace(/\r/g, ''); return r === '' ? 0 : (r.endsWith('\n') ? r.split('\n').length - 1 : r.split('\n').length); };
const countIn = (p, re) => (read(p).match(re) || []).length;
const filesMatching = (files, re) => files.filter(f => re.test(read(f)));

/*
 * The whole measurement over three checkouts, as a function the test can call.
 * Returns `{ ok: true, result }`, or `{ ok: false, why }` when a checkout or the
 * ratchet ledger is missing; the CLI below turns the second into exit 2.
 */
export function measure({ BUSES, SKILLS, PORTAL, now = new Date() }) {
  for (const [name, dir] of [['buses-data', BUSES], ['claude-skills', SKILLS], ['portal', PORTAL]]) {
    if (!isCheckout(dir)) return { ok: false, why: `${name}: ${dir} is not a git checkout — pass --${name === 'buses-data' ? 'buses' : name === 'claude-skills' ? 'skills' : 'portal'} or set its variable` };
  }
  const ENGINE = path.join(SKILLS, 'make-bus-leaflet');
  const ledgerPath = path.join(ENGINE, 'tools', 'line-ratchet.json');
  if (!exists(ledgerPath)) return { ok: false, why: `no ratchet ledger at ${ledgerPath} — the sizes group would be empty and look measured` };

  const m = {};   // group -> { metric: value }
  const note = {}; // metric -> what it means, for the table

  // ---- 1. sizes the ratchet holds ---------------------------------------------
  m.sizes = {};
  const ledger = JSON.parse(read(ledgerPath));
  for (const rel of Object.keys(ledger.files)) {
    const abs = path.join(ENGINE, rel);
    m.sizes[path.basename(rel)] = exists(abs) ? countLines(abs) : null;
  }
  note.sizes = 'lines; the ratchet ceilings are in make-bus-leaflet/tools/line-ratchet.json';

  // ---- 2. helper copies ----------------------------------------------------------
  const engineJs = tracked(SKILLS, 'make-bus-leaflet/assets', { exts: ['.js'] });
  const engineTools = tracked(SKILLS, 'make-bus-leaflet/tools', { exts: ['.js', '.py'] });
  const portalScripts = tracked(PORTAL, 'scripts', { exts: ['.mjs', '.js'] });
  const portalSrc = tracked(PORTAL, 'src', { exts: ['.js', '.mjs'] });
  const portalPublic = tracked(PORTAL, 'public', { exts: ['.js', '.mjs'] });
  m.copies = {
    'parseArgs bodies (engine assets+tools)': filesMatching([...engineJs, ...engineTools], /function\s+parseArgs\s*\(/).length,
    'esc() definitions (engine assets)': filesMatching(engineJs, /(^|\n)\s*(function\s+esc\s*\(|const\s+esc\s*=)/).length,
    'findSheets definitions (engine assets+tools)': filesMatching([...engineJs, ...engineTools], /function\s+findSheets\s*\(/).length,
    'arg/has argv blocks (portal scripts)': filesMatching(portalScripts, /const\s+arg\s*=\s*\(name/).length,
    "createHash('sha256') sites (portal)": [...portalScripts, ...portalSrc].reduce((n, f) => n + countIn(f, /createHash\(['"]sha256['"]\)/g), 0),
    'HTML escapers (portal src+public)': filesMatching([...portalSrc, ...portalPublic], /function\s+(escapeHtml|htmlAttr|xmlEscape|esc)\s*\(|const\s+esc\s*=\s*\(/).length,
    'wcag luminance implementations (engine)': filesMatching(engineJs, /0\.2126|0\.7152/).length,
  };
  note.copies = 'independent implementations; each should fall to one';

  // ---- 3. the laptop as a dependency -------------------------------------------
  const laptop = /u3a St Ives|C:\/Claude\/|C:\\Claude\\/;
  const busesCode = tracked(BUSES, '.', { exts: ['.js', '.mjs', '.py', '.ps1'], skip: ['Areas', 'Places', '_archive', 'Temp', '_gtfs'] });
  const skillsCode = tracked(SKILLS, '.', { exts: ['.js', '.mjs', '.py'], skip: ['design-preview'] });
  const portalCode = tracked(PORTAL, '.', { exts: ['.js', '.mjs'], skip: ['data', 'backups'] });
  // Two counts per repo, because the 2026-09-03 run found the first one RISING (portal 17 -> 26)
  // for a reason that was a virtue: the conventions pages require every script's header to say
  // which folder it runs from, and that folder is the laptop's. A path in a comment is a
  // documented default; a path on a code line is a fallback that runs. Only the second is the
  // finding, so it is measured on its own. A code line is one not starting with //, #, * or /*.
  const codeLineNames = (p) => read(p).split(/\r?\n/).some(l => laptop.test(l) && !/^\s*(\/\/|#|\*|\/\*)/.test(l));
  const vendoredEngine = tracked(PORTAL, 'engine', { exts: ['.js'] });
  m.laptopPaths = {
    'files naming the laptop path (buses-data code)': filesMatching(busesCode, laptop).length,
    'files naming the laptop path (claude-skills code)': filesMatching(skillsCode, laptop).length,
    'files naming the laptop path (portal code)': filesMatching(portalCode, laptop).length,
    'vendored engine files naming it (portal engine/)': filesMatching(vendoredEngine, laptop).length,
    '  ...of which on a CODE line (buses-data)': busesCode.filter(codeLineNames).length,
    '  ...of which on a CODE line (claude-skills)': skillsCode.filter(codeLineNames).length,
    '  ...of which on a CODE line (portal)': portalCode.filter(codeLineNames).length,
    '  ...of which on a CODE line (portal engine/)': vendoredEngine.filter(codeLineNames).length,
  };
  note.laptopPaths = 'files containing the laptop path anywhere, then only on a code line (a header comment naming the folder to run from is the convention, not a finding)';

  // ---- 4. test wiring -----------------------------------------------------------
  const pkg = exists(path.join(PORTAL, 'package.json')) ? JSON.parse(read(path.join(PORTAL, 'package.json'))) : { scripts: {} };
  const testScript = (pkg.scripts && pkg.scripts.test) || '';
  const chainSegments = testScript.includes('&&') ? testScript.split('&&').length : 0;
  const portalTests = portalScripts.filter(f => /[\\/]test-[^\\/]+\.mjs$/.test(f)).map(f => path.basename(f));
  const portalProveRed = portalScripts.filter(f => /[\\/]prove-red-[^\\/]+\.mjs$/.test(f)).map(f => path.basename(f));
  // Since portal #197 (2026-09-02) `npm test` is `scripts/run-tests.mjs`, which DISCOVERS
  // test-*/prove-red-* by glob and takes each file's command from the package.json script that
  // owns it; a file no script owns runs as bare `node scripts/<file>` and is reported. The old
  // 'test-*.mjs not in npm test' key equalled the file total by construction under a runner and
  // was retired on 2026-09-28; the questions that survive are how many files the runner has to
  // guess a command for, and how many it skips. Both read the same sources the runner does.
  const ownerCount = (file) => Object.entries(pkg.scripts || {}).filter(([n]) => n !== 'test')
    .filter(([, cmd]) => new RegExp('scripts/' + file.replace(/\./g, '\\.') + '(\\s|$)').test(String(cmd))).length;
  const runnerFiles = [...portalTests, ...portalProveRed];
  const runnerSrc = exists(path.join(PORTAL, 'scripts', 'run-tests.mjs')) ? read(path.join(PORTAL, 'scripts', 'run-tests.mjs')) : '';
  const excludedCount = (runnerSrc.match(/^\s*'(test|prove-red)-[^']+\.mjs':/gm) || []).length;
  const engineTests = tracked(SKILLS, 'make-bus-leaflet/test', { exts: ['.test.js'] });
  const enginePkg = exists(path.join(ENGINE, 'package.json')) ? JSON.parse(read(path.join(ENGINE, 'package.json'))) : { scripts: {} };
  m.testWiring = {
    'portal npm test && segments (0 = a runner)': chainSegments,
    'portal test-*.mjs': portalTests.length,
    'portal prove-red-*.mjs': portalProveRed.length,
    'portal test/prove-red files with no owning npm script (runner guesses)': runnerFiles.filter(f => ownerCount(f) !== 1).length,
    'portal test/prove-red files run-tests.mjs EXCLUDES': excludedCount,
    ...wiringVerdict(SKILLS),
    'engine tools/* files': engineTools.filter(f => !/branch-coverage\./.test(path.basename(f))).length,
    'engine tests requiring ../assets/ directly': filesMatching(engineTests, /require\(['"]\.\.\/assets\//).length,
    'engine test files': engineTests.length,
    "engine npm scripts invoking 'python ' (CI uses python3)": Object.values(enginePkg.scripts || {}).filter(s => /^python /.test(String(s))).length,
  };
  note.testWiring = 'what runs where; every "not in" and "in no step" should be zero, and every declared exception has a written reason in check-wiring.js';

  // ---- 5. the portal's two big files ---------------------------------------------
  const serverJs = path.join(PORTAL, 'src', 'server.js');
  const dbJs = path.join(PORTAL, 'src', 'db', 'index.js');
  const schemaSql = path.join(PORTAL, 'src', 'db', 'schema.sql');
  m.portalStructure = {
    'server.js lines': exists(serverJs) ? countLines(serverJs) : null,
    'server.js route registrations': exists(serverJs) ? countIn(serverJs, /^\s*app\.(get|post|patch|put|delete)\(/gm) : null,
    'server.js schema: uses': exists(serverJs) ? countIn(serverJs, /schema:/g) : null,
    'routes registered outside server.js': portalSrc.filter(f => f.endsWith('.js') && path.resolve(f) !== path.resolve(serverJs)).reduce((n, f) => n + countIn(f, /^\s*(app|fastify|f)\.(get|post|patch|put|delete)\(/gm), 0),
    'db/index.js lines': exists(dbJs) ? countLines(dbJs) : null,
    'db/index.js exports': exists(dbJs) ? countIn(dbJs, /^export\s+(function|const|async function)\s/gm) : null,
    'schema.sql CHECK constraints': exists(schemaSql) ? countIn(schemaSql, /\bCHECK\s*\(/g) : null,
    'schema.sql indexes': exists(schemaSql) ? countIn(schemaSql, /CREATE\s+(UNIQUE\s+)?INDEX/gi) : null,
  };
  note.portalStructure = 'the seams Tier 4 cuts along';

  // ---- 6. swallowed errors in the generators -------------------------------------
  // gen_external_busway.js was dropped 2026-09-02 (OA-224 Tier 4.1). The .filter(exists)
  // meant this list degraded quietly rather than throwing, which is why the LABEL below
  // counts gens.length instead of saying a number: a measurement that names its own
  // population cannot go on describing a file that is gone.
  const gens = ['gen_internal.js', 'gen_external_radial.js', 'gen_boarding.js', 'diagram_internal.js', 'schematize_internal.js']
    .map(f => path.join(ENGINE, 'assets', f)).filter(exists);
  m.errors = {
    [`empty catch blocks (${gens.length} generators)`]: gens.reduce((n, f) => n + countIn(f, /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/g), 0),
    'bare except: (engine Python)': tracked(SKILLS, 'make-bus-leaflet/assets', { exts: ['.py'] }).reduce((n, f) => n + countIn(f, /^\s*except\s*:/gm), 0),
  };
  note.errors = 'places a fault is discarded';

  // Local date, not toISOString(): a run after 23:00 BST would otherwise be dated yesterday.
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  return { ok: true, result: { measured: today, roots: { BUSES, SKILLS, PORTAL }, groups: m }, note };
}

/*
 * WHETHER EVERY ENGINE TOOL RUNS IN CI is check-wiring.js's question, and this
 * asks it rather than answering it again (2026-09-28, review R2 N37). The old
 * metric was a substring match of each file name over the whole gates.yml; on the
 * fifth run it said 15 tools were in no step, while `npm run gate:wiring`, reading
 * the same tree that afternoon, said every tool was named and 16 were declared not
 * in CI with a reason. When a measurer and a gate disagree about a join, the gate
 * enumerates both sides. null when the checkout has no check-wiring.js.
 */
function wiringVerdict(SKILLS) {
  const cw = path.join(SKILLS, 'make-bus-leaflet', 'tools', 'check-wiring.js');
  const keys = ['check-wiring.js findings (should be 0)', 'scripts declared not in CI, each with a reason (check-wiring.js)'];
  if (!exists(cw)) return { [keys[0]]: null, [keys[1]]: null };
  const r = spawnSync(process.execPath, [cw, '--json'], { cwd: path.dirname(path.dirname(cw)), encoding: 'utf8', maxBuffer: 1 << 26 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* reported as null below: an answer we could not read is not a zero */ }
  if (!j) return { [keys[0]]: null, [keys[1]]: null };
  return {
    [keys[0]]: (j.findings || []).length,
    [keys[1]]: Object.values(j.notInCi || {}).reduce((n, o) => n + Object.keys(o).length, 0),
  };
}

// ---- the command line ---------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? null : argv[i + 1]; };
  const BUSES = flag('buses') || process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
  const SKILLS = flag('skills') || process.env.SKILLS_DIR || 'C:/u3a St Ives/.claude/skills';
  const PORTAL = flag('portal') || process.env.BUSMAPS_PORTAL || 'C:/Claude/community-bus-maps';
  const out = measure({ BUSES, SKILLS, PORTAL });
  if (!out.ok) { console.error('measure.mjs: ' + out.why); process.exit(2); }
  const { result, note } = out;
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return; }
  console.log('codebase-review measures, ' + result.measured);
  console.log('  buses-data ' + BUSES + '\n  claude-skills ' + SKILLS + '\n  portal ' + PORTAL + '\n');
  for (const [g, metrics] of Object.entries(result.groups)) {
    console.log(g + '  (' + (note[g] || '') + ')');
    const w = Math.max(...Object.keys(metrics).map(k => k.length));
    for (const [k, v] of Object.entries(metrics)) console.log('  ' + k.padEnd(w) + '  ' + (v == null ? '-' : v));
    console.log('');
  }
  console.log('Save with --json beside the review documents and diff against the previous run.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
