#!/usr/bin/env node
/* Prove the engine-adoption census can go red — and, harder, that it goes red
 * AGAINST THE REAL FOLDER rather than only against fixtures. buses-data OA-345.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-engine-adoption.mjs
 *
 * No placeholders. Sections 1–6 build throwaway folders under the OS temp
 * directory; section 7 COPIES the real folder into one and mutates the copy.
 * Nothing here writes to `assets/`.
 *
 * WHY SECTION 7 IS THE POINT. The census exists because `engine.mjs` shipped in
 * September and nothing held its callers to it, so eight modules were written
 * without it. A census that has only ever been seen to fire on a fixture is the
 * same class of instrument: `make-bus-leaflet/test/cli.test.js` carried a
 * pattern that matched ZERO of the 80 files in its own population while its
 * control sat in a different folder, and it read green for as long as nobody
 * looked. So section 7 takes the REAL folder, puts back the exact line this
 * action removed — `return 'C:/u3a St Ives/Using AI/Buses';` in
 * `town_status.mjs`, which the 2026-09-14 review named as the file that must
 * turn the census red on its first run — and requires the census to name it.
 *
 * THE OTHER HALF OF THE SAME ARGUMENT is section 6: the allowlist is checked in
 * BOTH directions. An entry excuses a file, and the file must still carry the
 * thing it is excused for, or the entry itself is a finding. That is what keeps
 * the four excuses from outliving their subjects — and it is the only reason a
 * green run is evidence that the pattern fires at all.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { census, idiomsIn, blankComments, ALLOW, LAPTOP_PATH, ARGV, EXIT_OK, EXIT_FINDINGS, EXIT_CANNOT_LOOK } from './engine_adoption.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engadopt-'));
let bad = 0;

function ok(pass, label, detail) {
  if (pass) console.log(`  ok  ${label}`);
  else { bad++; console.log(`  ✗   ${label}${detail ? `  — ${detail}` : ''}`); }
}

/** A throwaway folder holding the named files. */
function mk(name, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  return dir;
}

const LAPTOP = 'C:/u3a St Ives/Using AI/Buses';
const has = (r, file, idiom) => r.findings.some((f) => f.file === file && f.idiom === idiom);

console.log('1  a laptop path on a CODE line is a finding, and a comment is not');
{
  const d = mk('laptop', {
    'a.mjs': `const dir = '${LAPTOP}';\n`,
    'b.mjs': `// the repository lives at ${LAPTOP} on Peter's laptop\nconst dir = process.env.BUSES_DIR;\n`,
    'c.mjs': `/*\n * ${LAPTOP}\n */\nexport const x = 1;\n`,
  });
  const r = census(d, []);
  ok(has(r, 'a.mjs', LAPTOP_PATH), 'the literal is caught');
  ok(!has(r, 'b.mjs', LAPTOP_PATH), 'a line comment naming the same path is silent');
  ok(!has(r, 'c.mjs', LAPTOP_PATH), 'a block comment naming the same path is silent');
  ok(r.findings.length === 1, 'exactly one finding over the three files', `${r.findings.length}`);
  const f = r.findings[0];
  ok(f.line === 1, 'the line number is the real one', `line ${f.line}`);
}

console.log('\n2  the comment blanker does not mistake a URL for a comment');
{
  /* This is the case that would silently switch the whole census off: if `//`
   * inside a string opened a line comment, every line after it in the file --
   * and every laptop path on them -- would be invisible. */
  const d = mk('url', {
    'a.mjs': `const u = 'https://busmaps.uk';\nconst dir = '${LAPTOP}';\n`,
    'b.mjs': `const u = 'https://busmaps.uk'; const dir = '${LAPTOP}';\n`,
  });
  const r = census(d, []);
  ok(has(r, 'a.mjs', LAPTOP_PATH), 'a path on the line AFTER a URL is still caught');
  ok(has(r, 'b.mjs', LAPTOP_PATH), 'a path on the SAME line as a URL is still caught');
  ok(blankComments(`const u = 'a//b'; // gone\n`).includes("'a//b'"), 'the string survives the blanking');
  ok(!blankComments(`const u = 1; // ${LAPTOP}\n`).includes('u3a'), 'the comment does not');
  const src8 = `a\n// ${LAPTOP}\nc\n`;
  ok(blankComments(src8).split('\n').length === src8.split('\n').length, 'blanking preserves the line count, which is what makes a reported line number the real one');
}

console.log('\n3  reading ARGUMENTS out of process.argv is a finding; the main-module guard is not');
{
  const d = mk('argv', {
    'a.mjs': `const dir = process.argv[2];\n`,
    'b.mjs': `if (import.meta.url === \`file://\${process.argv[1]}\`) run();\n`,
    'c.mjs': `const argv = process.argv.slice(2);\n`,
    'd.mjs': `const all = process.argv.slice(0);\n`,
  });
  const r = census(d, []);
  ok(has(r, 'a.mjs', ARGV), 'process.argv[2] is caught');
  ok(!has(r, 'b.mjs', ARGV), 'process.argv[1] — the main-module guard — is silent');
  ok(has(r, 'c.mjs', ARGV), 'process.argv.slice(2) is caught');
  ok(!has(r, 'd.mjs', ARGV), 'slice(0) is the whole command line, not an argument list');
}

console.log('\n4  the ADOPTED idiom passes, and only where the import is real');
{
  const adopted = `import { parseArgs } from './engine.mjs';\nconst args = parseArgs(process.argv.slice(2));\n`;
  const pretend = `function parseArgs(a) { return a; }\nconst args = parseArgs(process.argv.slice(2));\n`;
  const elsewhere = `import { parseArgs } from './somewhere-else.mjs';\nconst args = parseArgs(process.argv.slice(2));\n`;
  const d = mk('adopted', { 'a.mjs': adopted, 'b.mjs': pretend, 'c.mjs': elsewhere });
  const r = census(d, []);
  ok(!has(r, 'a.mjs', ARGV), 'parseArgs from engine.mjs is the adopted idiom and passes');
  ok(has(r, 'b.mjs', ARGV), "a LOCAL parseArgs of its own does not — that is the thing this census is about");
  ok(has(r, 'c.mjs', ARGV), 'nor a parseArgs imported from somewhere that is not engine.mjs');
}

console.log('\n5  three answers: ok, findings, and COULD NOT LOOK');
{
  const missing = census(path.join(root, 'no-such-folder'), []);
  ok(!!missing.cannotLook, 'a folder that is not there is a refusal', JSON.stringify(missing.cannotLook));
  const empty = census(mk('empty', {}), []);
  ok(!!empty.cannotLook, 'a folder with no .mjs in it is a refusal and NOT a pass', JSON.stringify(empty.cannotLook));
  ok(empty.findings.length === 0, 'and it reports no findings, so nobody reads the refusal as a clean run');
  const clean = census(mk('clean', { 'a.mjs': 'export const x = 1;\n' }), []);
  ok(!clean.cannotLook && clean.findings.length === 0, 'a clean folder is clean');
}

console.log('\n6  the allowlist, in BOTH directions');
{
  const d = mk('allow', { 'a.mjs': `const dir = '${LAPTOP}';\n`, 'b.mjs': 'export const x = 1;\n' });
  const excused = census(d, [{ file: 'a.mjs', idiom: LAPTOP_PATH, why: 'a fixture' }]);
  ok(excused.findings.length === 0, 'an excused idiom is not a finding');
  ok(excused.controls[0].matched === true, 'and the control says the pattern fired on it');

  const stale = census(d, [{ file: 'b.mjs', idiom: LAPTOP_PATH, why: 'a fixture' }]);
  ok(has(stale, 'b.mjs', 'stale-allowlist'), 'an excuse whose subject has gone is itself a finding');

  const absent = census(d, [{ file: 'gone.mjs', idiom: ARGV, why: 'a fixture' }]);
  ok(has(absent, 'gone.mjs', 'stale-allowlist'), 'so is an excuse for a file that is not in the folder');
  ok(absent.controls[0].present === false, 'and the control says which of the two it was');
}

console.log('\n7  THE REAL FOLDER — the census is green on it, and goes red when the fix is undone');
{
  const r = census(HERE);
  ok(r.cannotLook === null, 'the real folder could be read', String(r.cannotLook));
  ok(r.scanned >= 30, `it holds a real population (${r.scanned} .mjs files)`);
  ok(r.findings.length === 0, 'and it is GREEN today', r.findings.map((f) => `${f.file}:${f.line} ${f.idiom}`).join('; '));
  ok(r.controls.length === ALLOW.length && r.controls.every((c) => c.matched),
    'every allowlist entry STILL MATCHES, so the pattern is known to fire inside the population',
    r.controls.filter((c) => !c.matched).map((c) => `${c.file}[${c.idiom}]`).join(', '));

  /* The mutation. Copy the real folder and put back the one line OA-345 was
   * filed about. Watched go red here, not reasoned about. */
  const copy = path.join(root, 'real-copy');
  fs.mkdirSync(copy, { recursive: true });
  for (const f of fs.readdirSync(HERE).filter((n) => n.endsWith('.mjs'))) fs.copyFileSync(path.join(HERE, f), path.join(copy, f));
  const ts = path.join(copy, 'town_status.mjs');
  const src = fs.readFileSync(ts, 'utf8');
  const put = src.replace("const BUSES = resolveBuses({ buses: opts.buses });", `const BUSES = opts.buses || process.env.BUSES_DIR || '${LAPTOP}';`);
  ok(put !== src, 'the mutation anchor is still in town_status.mjs — if this fails the anchor moved, not the rule');
  fs.writeFileSync(ts, put);
  const m = census(copy);
  ok(has(m, 'town_status.mjs', LAPTOP_PATH), 'putting the literal back turns the REAL folder red, naming town_status.mjs');
  ok(m.findings.length === 1, 'and nothing else moved', m.findings.map((f) => `${f.file}:${f.line}`).join('; '));

  /* The second mutation: a NEW module written the old way. This is the case the
   * census is for -- not repairing today's folder, but catching tomorrow's file. */
  fs.copyFileSync(path.join(HERE, 'town_status.mjs'), ts);
  fs.writeFileSync(path.join(copy, 'zz_new_module.mjs'), `const argv = process.argv.slice(2);\nconst dir = argv[0] || '${LAPTOP}';\n`);
  const n = census(copy);
  ok(has(n, 'zz_new_module.mjs', ARGV) && has(n, 'zz_new_module.mjs', LAPTOP_PATH),
    'a new module written the old way is caught on both idioms', JSON.stringify(n.findings));
}

console.log('\n8  the exit codes are declared, and they are three');
{
  ok(EXIT_OK === 0 && EXIT_FINDINGS === 1 && EXIT_CANNOT_LOOK === 2, 'ok 0, findings 1, could-not-look 2');
  ok(EXIT_FINDINGS !== EXIT_CANNOT_LOOK, 'a refusal does not share an exit code with a finding');
}

fs.rmSync(root, { recursive: true, force: true });
console.log(bad ? `\n${bad} case(s) FAILED\n` : '\nall cases pass\n');
process.exitCode = bad ? 1 : 0;
