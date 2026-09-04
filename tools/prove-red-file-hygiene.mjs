// Falsify check-file-hygiene.mjs: plant each fault on purpose and insist it is
// found — and plant each EXEMPTION on purpose and insist it is not.
//
// WHY BOTH DIRECTIONS, which is the whole design. The lesson `check-doc-links.mjs`
// paid for on 2026-09-01 is that widening an exemption produces a FALSE PASS
// rather than a false finding: a file wrongly treated as exempt silences the
// finding that should have fired, and nothing anywhere says so. Every exemption
// is therefore tested with a CONTROL showing the same content is still reported
// when it sits outside the exemption. A harness proving only the red half would
// certify exactly the hole worth having.
//
// AND THE EXEMPTIONS ARE NOW A REPOSITORY'S OWN DECLARATION, not the checker's
// (buses-data OA-241, on moving this here). So the fixtures below write their own
// `.file-hygiene.json`, and two cases exist that could not have before: a
// repository with NO declaration gets the bare rules — the right default for one
// nobody has thought about — and a declaration that does not parse is a refusal
// rather than a silent fallback to no exemptions, which would look like a pass.
//
// Run from this repository's root (the claude-skills checkout). No placeholders:
//   node tools/prove-red-file-hygiene.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('./check-file-hygiene.mjs', import.meta.url));
const BOM = '﻿';

/* The fixture is a real git repository, because the checker enumerates from
 * `git ls-files` rather than walking the disk: a session mid-build has scratch
 * files across the estate, and a walk would check a neighbour's uncommitted work. */
function run(files, { commit = true, decl = null, args = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hygiene-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'x@y.z']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'x']);
  /* -text so git's own newline translation cannot rewrite a MIXED-EOL fixture
   * out from under the case that exists to detect it. */
  writeFileSync(path.join(dir, '.gitattributes'), '* -text\n', 'utf8');
  /* The declaration is itself a tracked file the checker will read, so it must
   * satisfy the rules — a fixture ending without a newline reports a finding
   * about the fixture rather than about the case. */
  if (decl !== null) writeFileSync(path.join(dir, '.file-hygiene.json'), decl.endsWith('\n') ? decl : `${decl}\n`, 'utf8');
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf8');
  }
  if (commit) execFileSync('git', ['-C', dir, 'add', '-A']);
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir, ...args], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const CLEAN = '# Doc\n\nA paragraph on one line.\n';
const DECL = JSON.stringify({
  neverRead: ['(^|/)_portal-fixture/', '(^|/)ci-reference/'],
  notAuthored: [['/S[1-6]-[a-z]+/', 'generated stage output'], ['^_archive/', 'a record']],
  notOurs: { 'imported.md': 'a converted PDF kept verbatim' },
}, null, 1) + '\n';

const CASES = [
  // ---- the five faults, each planted on purpose
  ['a BOM', { 'a.js': BOM + 'const x = 1;\n', 'ok.md': CLEAN }, 'BOM', null],
  ['two kinds of line ending', { 'a.json': '{\r\n  "a": 1,\n  "b": 2\r\n}\n', 'ok.md': CLEAN }, 'MIXED-EOL', null],
  ['trailing whitespace', { 'a.md': '# Doc\n\nA line with a space.   \n', 'ok.md': CLEAN }, 'TRAILING-WS', null],
  ['no final newline', { 'a.md': '# Doc\n\nEnds abruptly.', 'ok.md': CLEAN }, 'NO-FINAL-NEWLINE', null],
  ['three blank lines', { 'a.md': '# Doc\n\n\n\n\nA paragraph.\n', 'ok.md': CLEAN }, 'BLANK-RUN', null],

  // ---- exemption 1: `neverRead` is OUT OF SCOPE ENTIRELY, not merely exempt
  ['a BOM inside a declared ci-reference/', { 'imported.md': CLEAN, 'Areas/T/ci-reference/a.json': BOM + '{}\n', 'ok.md': CLEAN }, null, DECL],
  ['a BOM inside a declared _portal-fixture/', { 'imported.md': CLEAN, 'Places/_portal-fixture/a.json': BOM + '{}\n', 'ok.md': CLEAN }, null, DECL],
  ['CONTROL — the same BOM one folder out', { 'imported.md': CLEAN, 'Areas/T/refs/a.json': BOM + '{}\n', 'ok.md': CLEAN }, 'BOM', DECL],

  // ---- exemption 2: `notAuthored` lifts Tier 2 only, never Tier 1
  ['trailing whitespace in declared generated output', { 'imported.md': CLEAN, 'Areas/T/S3-config/x/routes.json': '{\n  "a": 1   \n}\n', 'ok.md': CLEAN }, null, DECL],
  ['CONTROL — a BOM in that SAME generated file', { 'imported.md': CLEAN, 'Areas/T/S3-config/x/routes.json': BOM + '{\n  "a": 1\n}\n', 'ok.md': CLEAN }, 'BOM', DECL],
  ['trailing whitespace in a declared archive', { 'imported.md': CLEAN, '_archive/x.md': '# Doc\n\nA line.   \n', 'ok.md': CLEAN }, null, DECL],
  ['CONTROL — the same whitespace outside the declaration', { 'imported.md': CLEAN, 'live/x.md': '# Doc\n\nA line.   \n', 'ok.md': CLEAN }, 'TRAILING-WS', DECL],

  // ---- exemption 3: `notOurs`, named file by file
  ['trailing whitespace in a declared notOurs file', { 'imported.md': '# Doc\n\nA line.   \n', 'ok.md': CLEAN }, null, DECL],
  ['CONTROL — a BOM in that SAME notOurs file', { 'imported.md': BOM + '# Doc\n\nA line.\n', 'ok.md': CLEAN }, 'BOM', DECL],

  // ---- exemption 4: a BOM is load-bearing in PowerShell and nowhere else
  ['a BOM in a .ps1', { 'a.ps1': BOM + 'Write-Host "hi"\n', 'ok.md': CLEAN }, null, null],
  ['CONTROL — the same BOM in a .mjs', { 'a.mjs': BOM + 'console.log(1);\n', 'ok.md': CLEAN }, 'BOM', null],

  // ---- NO declaration means the BARE rules, which is the right default for a
  //      repository nobody has thought about — NOT "everything is exempt"
  ['no .file-hygiene.json — generated-looking paths are still checked', { 'Areas/T/S3-config/x/routes.json': '{\n  "a": 1   \n}\n', 'ok.md': CLEAN }, 'TRAILING-WS', null],

  // ---- the control that must stay green
  ['CONTROL — a clean corpus', { 'a.md': CLEAN, 'b.json': '{\n  "a": 1\n}\n', 'c.js': 'const x = 1;\n' }, null, null],
];

let failed = 0;
const fail = (what, msg) => { failed++; console.error(`FAIL  ${what}\n      ${msg}`); };

for (const [what, files, expect, decl] of CASES) {
  const { code, out } = run(files, { decl });
  const ok = expect ? (code === 1 && out.includes(expect)) : code === 0;
  if (!ok) fail(what, `expected ${expect ? `a ${expect} finding` : 'a clean pass'}, got exit ${code}\n${out.split('\n').map((l) => '      ' + l).join('\n')}`);
  else console.log(`ok    ${what}${expect ? ` — reported ${expect}` : ' — clean, as it should be'}`);
}

/* A checker that cannot find its subject must not report clear. */
{
  const { code, out } = run({ 'a.md': CLEAN }, { commit: false });
  if (code !== 2) fail('an empty git index', `expected exit 2, got ${code}\n      ${out.trim()}`);
  else console.log('ok    an empty git index — exits 2 rather than reporting clean');
}

/* A declaration that does not parse is a REFUSAL. Falling back to "no
 * exemptions" would be a checker running rules nobody declared; falling back to
 * "all exempt" would be a silent pass. Neither is an answer. */
{
  const { code, out } = run({ 'a.md': CLEAN }, { decl: '{ this is not json' });
  if (code !== 2 || !out.includes('not valid JSON')) fail('an unparseable .file-hygiene.json', `expected exit 2 saying so, got ${code}\n      ${out.trim()}`);
  else console.log('ok    an unparseable .file-hygiene.json — refused, exit 2');
}

/* A STALE exemption is a hard error in a whole-corpus run — and must NOT be one
 * under --staged, which sees one commit and cannot make a claim about a corpus.
 * Written without that gate, the pre-commit hook refused every commit in any
 * repository but the checker's own (measured 2026-09-04). */
{
  const gone = JSON.stringify({ notOurs: { 'never-existed.md': 'a reason' } });
  const whole = run({ 'a.md': CLEAN }, { decl: gone });
  if (whole.code !== 2 || !whole.out.includes('never-existed.md')) fail('a stale notOurs entry', `expected exit 2 naming it, got ${whole.code}\n      ${whole.out.trim()}`);
  else console.log('ok    a stale notOurs entry — refused by name, exit 2');

  const st = run({ 'a.md': CLEAN }, { decl: gone, args: ['--staged'] });
  if (st.code !== 0) fail('CONTROL — the same stale entry under --staged', `expected exit 0 (a corpus claim --staged cannot make), got ${st.code}\n      ${st.out.trim()}`);
  else console.log('ok    CONTROL — --staged does not make that corpus claim');
}

/* An unknown flag is refused BY NAME rather than ignored: a checker a typo can
 * silently repoint is a checker that lies about what it read. The CONTROL
 * matters as much — one refusing every flag would have stopped the work. */
{
  const bad = spawnSync(process.execPath, [CHECKER, '--tree', '.'], { encoding: 'utf8' });
  const out = (bad.stdout || '') + (bad.stderr || '');
  if (bad.status !== 2 || !out.includes('--tree')) fail('an unknown flag', `expected exit 2 naming --tree, got ${bad.status}\n      ${out.trim()}`);
  else console.log('ok    an unknown flag — refused by name, exit 2');

  const good = run({ 'a.md': CLEAN });
  if (good.code !== 0) fail('CONTROL — a KNOWN flag is still accepted', `expected exit 0, got ${good.code}\n      ${good.out.trim()}`);
  else console.log('ok    CONTROL — --root is still accepted');
}

console.log(`\nprove-red-file-hygiene: ${CASES.length + 6} cases, ${failed} failed.`);
process.exit(failed ? 1 : 0);
