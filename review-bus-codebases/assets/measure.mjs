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
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? null : argv[i + 1]; };
const BUSES = flag('buses') || process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
const SKILLS = flag('skills') || process.env.SKILLS_DIR || 'C:/u3a St Ives/.claude/skills';
const PORTAL = flag('portal') || process.env.BUSMAPS_PORTAL || 'C:/Claude/community-bus-maps';
const JSON_OUT = argv.includes('--json');
const ENGINE = path.join(SKILLS, 'make-bus-leaflet');

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
function walk(dir, { exts, skip = [] }, out = []) {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, { exts, skip }, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const countLines = (p) => { const r = read(p).replace(/\r/g, ''); return r === '' ? 0 : (r.endsWith('\n') ? r.split('\n').length - 1 : r.split('\n').length); };
const countIn = (p, re) => (read(p).match(re) || []).length;
const filesMatching = (files, re) => files.filter(f => re.test(read(f)));

const m = {};   // group -> { metric: value }
const note = {}; // metric -> what it means, for the table

// ---- 1. sizes the ratchet holds ---------------------------------------------
m.sizes = {};
const ledgerPath = path.join(ENGINE, 'tools', 'line-ratchet.json');
if (exists(ledgerPath)) {
  const ledger = JSON.parse(read(ledgerPath));
  for (const rel of Object.keys(ledger.files)) {
    const abs = path.join(ENGINE, rel);
    m.sizes[path.basename(rel)] = exists(abs) ? countLines(abs) : null;
  }
}
note.sizes = 'lines; the ratchet ceilings are in make-bus-leaflet/tools/line-ratchet.json';

// ---- 2. helper copies ----------------------------------------------------------
const engineJs = walk(path.join(ENGINE, 'assets'), { exts: ['.js'] });
const placeJs = walk(path.join(SKILLS, 'make-place-bus-leaflet', 'assets'), { exts: ['.js'] });
const engineTools = walk(path.join(ENGINE, 'tools'), { exts: ['.js', '.py'] });
const portalScripts = walk(path.join(PORTAL, 'scripts'), { exts: ['.mjs', '.js'] });
const portalSrc = walk(path.join(PORTAL, 'src'), { exts: ['.js', '.mjs'] });
const portalPublic = walk(path.join(PORTAL, 'public'), { exts: ['.js', '.mjs'] });
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
const busesCode = walk(BUSES, { exts: ['.js', '.mjs', '.py', '.ps1'], skip: ['Areas', 'Places', 'node_modules', '_archive', 'Temp', '_gtfs'] });
const skillsCode = walk(SKILLS, { exts: ['.js', '.mjs', '.py'], skip: ['node_modules', 'design-preview', '__pycache__'] });
const portalCode = walk(PORTAL, { exts: ['.js', '.mjs'], skip: ['node_modules', 'data', 'backups'] });
m.laptopPaths = {
  'files naming the laptop path (buses-data code)': filesMatching(busesCode, laptop).length,
  'files naming the laptop path (claude-skills code)': filesMatching(skillsCode, laptop).length,
  'files naming the laptop path (portal code)': filesMatching(portalCode, laptop).length,
  'vendored engine files naming it (portal engine/)': filesMatching(walk(path.join(PORTAL, 'engine'), { exts: ['.js'] }), laptop).length,
};
note.laptopPaths = 'files containing a hard-coded laptop path; target is zero outside stated defaults';

// ---- 4. test wiring -----------------------------------------------------------
const pkg = exists(path.join(PORTAL, 'package.json')) ? JSON.parse(read(path.join(PORTAL, 'package.json'))) : { scripts: {} };
const testScript = pkg.scripts.test || '';
const chainSegments = testScript.includes('&&') ? testScript.split('&&').length : 0;
const portalTests = portalScripts.filter(f => /[\\/]test-[^\\/]+\.mjs$/.test(f)).map(f => path.basename(f));
const portalProveRed = portalScripts.filter(f => /[\\/]prove-red-[^\\/]+\.mjs$/.test(f)).map(f => path.basename(f));
const notInChain = portalTests.filter(t => !testScript.includes(t)).length;
const gatesYml = exists(path.join(SKILLS, '.github', 'workflows', 'gates.yml')) ? read(path.join(SKILLS, '.github', 'workflows', 'gates.yml')) : '';
const enginePkg = exists(path.join(ENGINE, 'package.json')) ? JSON.parse(read(path.join(ENGINE, 'package.json'))) : { scripts: {} };
const npmRunNames = Object.keys(enginePkg.scripts || {});
const toolNamed = (f) => {
  const base = path.basename(f);
  if (gatesYml.includes(base)) return true;
  // named indirectly via `npm run <script>` whose body names the file
  return npmRunNames.some(n => gatesYml.includes('npm run ' + n) && String(enginePkg.scripts[n]).includes(base));
};
const engineToolFiles = engineTools.filter(f => !/branch-coverage\./.test(path.basename(f)));
const engineTests = walk(path.join(ENGINE, 'test'), { exts: ['.test.js'] });
m.testWiring = {
  'portal npm test && segments (0 = a runner)': chainSegments,
  'portal test-*.mjs not in npm test': notInChain,
  'portal test-*.mjs': portalTests.length,
  'portal prove-red-*.mjs': portalProveRed.length,
  'engine tools/* files in no gates.yml step': engineToolFiles.filter(f => !toolNamed(f)).length,
  'engine tools/* files': engineToolFiles.length,
  'engine tests requiring ../assets/ directly': filesMatching(engineTests, /require\(['"]\.\.\/assets\//).length,
  'engine test files': engineTests.length,
  "engine npm scripts invoking 'python ' (CI uses python3)": Object.values(enginePkg.scripts || {}).filter(s => /^python /.test(String(s))).length,
};
note.testWiring = 'what runs where; every "not in" and "in no step" should be zero';

// ---- 5. the portal's two big files ---------------------------------------------
const serverJs = path.join(PORTAL, 'src', 'server.js');
const dbJs = path.join(PORTAL, 'src', 'db', 'index.js');
m.portalStructure = {
  'server.js lines': exists(serverJs) ? countLines(serverJs) : null,
  'server.js route registrations': exists(serverJs) ? countIn(serverJs, /^\s*app\.(get|post|patch|put|delete)\(/gm) : null,
  'server.js schema: uses': exists(serverJs) ? countIn(serverJs, /schema:/g) : null,
  'routes registered outside server.js': walk(path.join(PORTAL, 'src'), { exts: ['.js'] }).filter(f => f !== serverJs).reduce((n, f) => n + countIn(f, /^\s*(app|fastify|f)\.(get|post|patch|put|delete)\(/gm), 0),
  'db/index.js lines': exists(dbJs) ? countLines(dbJs) : null,
  'db/index.js exports': exists(dbJs) ? countIn(dbJs, /^export\s+(function|const|async function)\s/gm) : null,
  'schema.sql CHECK constraints': exists(path.join(PORTAL, 'src', 'db', 'schema.sql')) ? countIn(path.join(PORTAL, 'src', 'db', 'schema.sql'), /\bCHECK\s*\(/g) : null,
  'schema.sql indexes': exists(path.join(PORTAL, 'src', 'db', 'schema.sql')) ? countIn(path.join(PORTAL, 'src', 'db', 'schema.sql'), /CREATE\s+(UNIQUE\s+)?INDEX/gi) : null,
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
  'bare except: (engine Python)': walk(path.join(ENGINE, 'assets'), { exts: ['.py'] }).reduce((n, f) => n + countIn(f, /^\s*except\s*:/gm), 0),
};
note.errors = 'places a fault is discarded';

// ---- output --------------------------------------------------------------------
// Local date, not toISOString(): a run after 23:00 BST would otherwise be dated yesterday.
const d = new Date();
const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const result = { measured: today, roots: { BUSES, SKILLS, PORTAL }, groups: m };
if (JSON_OUT) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); }
else {
  console.log('codebase-review measures, ' + result.measured);
  console.log('  buses-data ' + BUSES + '\n  claude-skills ' + SKILLS + '\n  portal ' + PORTAL + '\n');
  for (const [g, metrics] of Object.entries(m)) {
    console.log(g + '  (' + (note[g] || '') + ')');
    const w = Math.max(...Object.keys(metrics).map(k => k.length));
    for (const [k, v] of Object.entries(metrics)) console.log('  ' + k.padEnd(w) + '  ' + (v == null ? '-' : v));
    console.log('');
  }
  console.log('Save with --json beside the review documents and diff against the previous run.');
}
