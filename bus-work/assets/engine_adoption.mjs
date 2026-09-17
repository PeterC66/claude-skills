#!/usr/bin/env node
/* engine_adoption.mjs — the census that says whether this skill's modules
 * actually USE `engine.mjs`, the one path resolver and argument parser they were
 * all given. buses-data OA-345, from the 2026-09-14 codebase review, R3 G1.
 *
 * WHY A CENSUS RATHER THAN A TIDY-UP. `engine.mjs` landed on 2026-09-03 as this
 * skill's single resolver. Eight modules were written in this folder after it
 * and not one of them imported it: its importer count was still the two files it
 * was cut from. That is the review's second theme — ADOPTION, NOT EXTRACTION —
 * and its stated conclusion is that **the unit of an extraction is the module
 * plus the check on its callers**. Where a test asserts the callers ARE the
 * helper, adoption completes; where none exists, the helper lands and adoption
 * stops on the day it lands. So the tidy-up without this file would be undone by
 * the next module somebody writes, silently, exactly as it was the first time.
 *
 * WHAT IT ASKS, of every `.mjs` in this folder:
 *
 *   1. `laptop-path` — does a CODE line carry a path literal off this one
 *      laptop? `C:/u3a St Ives/...`, `C:/Claude/...`, `C:/Users/...`. Comments
 *      are blanked first, because a header that documents where the repository
 *      lives is not the same act as a fallback that only works there.
 *
 *   2. `argv` — does the module read its own ARGUMENTS out of `process.argv`?
 *      `process.argv[2]` and up, or `process.argv.slice(1..)`. Reading
 *      `process.argv[1]` is NOT this: that is the main-module guard every file
 *      in the folder uses, and it is not an argument. A read that is the
 *      argument of `parseArgs(...)` in a file importing `parseArgs` from
 *      `engine.mjs` is the adopted idiom and passes.
 *
 * THE ALLOWLIST IS THE LOAD-BEARING HALF, and it is checked in both directions.
 * Each entry names a file, an idiom and a REASON a reader can disagree with. And
 * every entry must STILL MATCH the idiom it is excused for: an allowlisted file
 * that has stopped carrying the thing it was excused for is itself a finding,
 * because that is an excuse outliving its subject — and, more importantly, it is
 * the only way to prove the pattern fires on a real file in the real folder. A
 * census whose first run is green is the exact fault `make-bus-leaflet`'s own
 * `cli.test.js` carried until 2026-09-14, where the pattern matched ZERO of the
 * 80 files in its own population and its control sat in a different folder. So:
 * THE CONTROL IS INSIDE THE POPULATION.
 *
 * THREE ANSWERS, NOT TWO. `ok`, `findings`, and COULD NOT LOOK — a folder that
 * cannot be read, or that holds no `.mjs` at all, exits 2 and says so. A refusal
 * read as an absence measures the instrument instead of the subject.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node engine_adoption.mjs            # this folder; no placeholders
 *   node engine_adoption.mjs --dir <d>  # any folder, which is what the harness drives
 *   node engine_adoption.mjs --json
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './engine.mjs';

export const LAPTOP_PATH = 'laptop-path';
export const ARGV = 'argv';

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_CANNOT_LOOK = 2;

/*
 * The excuses. Each is a judgement with its reason, and each is held to still
 * matching by `controls()` below.
 */
export const ALLOW = [
  {
    file: 'engine.mjs',
    idiom: LAPTOP_PATH,
    why: 'It IS the resolver. The two laptop constants and the engine-folder candidate list are the fallback every other module is supposed to reach through, so this is the one file where the literal is the product rather than a shortcut past it.',
  },
  {
    file: 'town_status.mjs',
    idiom: ARGV,
    why: "Its parser is deliberately STRICTER than the shared one: it refuses an unknown flag BY NAME (buses-data Conventions, 2026-09-02 — a checker a typo can silently repoint answers a question the caller did not ask) and it takes the map name as a BARE argument. `parseArgs` is long-flags-only and silently ignores both, so adopting it here would drop a contract rather than share one. Its path resolution IS adopted — `resolveBuses` comes from engine.mjs.",
  },
  {
    file: 'prove-red-engine-adoption.mjs',
    idiom: LAPTOP_PATH,
    why: "It is THIS census's own falsification harness, and a harness for a pattern has to contain the pattern — its fixtures are laptop paths written on purpose. Excused as a whole file rather than line by line, because line numbers in a harness move every time a case is added. The control below is what keeps the excuse honest: if the fixtures ever stopped matching, the entry would report itself.",
  },
  {
    file: 'prove-red-engine-adoption.mjs',
    idiom: ARGV,
    why: 'The same, for the argv half: its fixture modules read `process.argv` exactly as a module written the old way would.',
  },
  {
    file: 'ci_state.mjs',
    idiom: ARGV,
    why: 'Its main-module block takes a LIST of repository folders as bare arguments, which a long-flags-only parser cannot express at all. It parses no flag and resolves no path.',
  },
  {
    file: 'loop_lock.mjs',
    idiom: ARGV,
    why: 'Same shape: a debug entry point taking a bare folder and an optional session id positionally. It parses no flag, and since OA-345 its folder DEFAULT comes from engine.mjs `resolveBuses()` rather than from a literal.',
  },
];

/* `C:/u3a St Ives/...`, `C:\\u3a St Ives\\...`, `C:/Claude/...`, `C:/Users/...` */
const LAPTOP_RE = /\bC:[\\/]{1,2}(?:u3a St Ives|Claude\b|Users\b)/;
/* `process.argv[2]` and up — NOT `[0]` or `[1]`, which are the main-module guard. */
const ARGV_INDEX_RE = /process\.argv\s*\[\s*([2-9]\d*)\s*\]/;
/* `process.argv.slice(1)` and up — `slice(0)` would be the whole command line. */
const ARGV_SLICE_RE = /process\.argv\.slice\s*\(\s*([1-9]\d*)/;
/* The adopted idiom, written on one line: `parseArgs(process.argv.slice(2))`. */
const ADOPTED_RE = /parseArgs\s*\(\s*process\.argv\.slice\s*\(\s*\d+\s*\)\s*\)/;
/* An import of parseArgs from this folder's own engine.mjs. */
const IMPORTS_PARSEARGS_RE = /import\s*\{[^}]*\bparseArgs\b[^}]*\}\s*from\s*['"]\.\/engine\.mjs['"]/;

/**
 * Blank every comment, preserving length and newlines so line numbers survive.
 *
 * String literals are KEPT — a laptop path inside a string is the thing this
 * census is about, and `'https://busmaps.uk'` must not open a line comment. The
 * one shape this scanner cannot see is a quote character inside a regular
 * expression literal, which would desync the string state; there is none in this
 * folder today and the harness holds a case that says so.
 */
export function blankComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i++; continue; }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; }
      out += c;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i++; continue; }
      out += (c === '\n' ? '\n' : ' ');
      continue;
    }
    /* inside a string: state holds the closing quote */
    if (c === '\\') { out += c + (d === undefined ? '' : d); i++; continue; }
    if (c === state) state = 'code';
    out += c;
  }
  return out;
}

/** Every idiom this one file's CODE carries, with the line each was seen on. */
export function idiomsIn(src) {
  const code = blankComments(src).split(/\r?\n/);
  const adopts = IMPORTS_PARSEARGS_RE.test(src);
  const hits = [];
  code.forEach((line, i) => {
    const n = i + 1;
    if (LAPTOP_RE.test(line)) hits.push({ idiom: LAPTOP_PATH, line: n, text: line.trim() });
    const argv = ARGV_INDEX_RE.test(line) || ARGV_SLICE_RE.test(line);
    if (!argv) return;
    /* The adopted idiom is not a finding — but only in a file that really does
     * take `parseArgs` from engine.mjs. A local `parseArgs` of its own would be
     * the very thing this census exists to notice. */
    if (adopts && ADOPTED_RE.test(line)) return;
    hits.push({ idiom: ARGV, line: n, text: line.trim() });
  });
  return hits;
}

const allowed = (allow, file, idiom) => allow.find((a) => a.file === file && a.idiom === idiom) || null;

/**
 * The census over a folder of `.mjs` files.
 *
 * Returns `{ dir, files, scanned, findings, controls, cannotLook }`. `findings`
 * are unexcused idioms; `controls` are the allowlist entries checked the other
 * way round, each `{ file, idiom, matched }`, and an entry that no longer
 * matches is a finding of its own.
 *
 * `allow` is an ARGUMENT so the harness can drive this over fixture folders with
 * a fixture allowlist. One of its cases drives it with the real `ALLOW` over
 * this real folder, which is the control that has to be inside the population.
 */
export function census(dir, allow = ALLOW) {
  let names;
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return { dir, cannotLook: `${dir} is not a directory`, files: [], scanned: 0, findings: [], controls: [] };
    names = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  } catch (e) {
    return { dir, cannotLook: `${dir} could not be read: ${e.message}`, files: [], scanned: 0, findings: [], controls: [] };
  }
  if (!names.length) return { dir, cannotLook: `${dir} holds no .mjs files — a census over an empty population is not a pass`, files: [], scanned: 0, findings: [], controls: [] };

  const findings = [];
  const seen = new Map();
  for (const file of names) {
    let src;
    try { src = readFileSync(path.join(dir, file), 'utf8'); } catch (e) {
      findings.push({ file, idiom: 'unreadable', line: 0, text: e.message });
      continue;
    }
    for (const hit of idiomsIn(src)) {
      seen.set(`${file}|${hit.idiom}`, true);
      const a = allowed(allow, file, hit.idiom);
      if (!a) findings.push({ file, ...hit });
    }
  }

  const controls = allow.map((a) => ({ file: a.file, idiom: a.idiom, why: a.why, matched: seen.has(`${a.file}|${a.idiom}`), present: names.includes(a.file) }));
  for (const c of controls) {
    if (c.matched) continue;
    findings.push({
      file: c.file,
      idiom: 'stale-allowlist',
      line: 0,
      text: c.present
        ? `allowed for \`${c.idiom}\` and no longer carries it — delete the entry, or find out what else changed`
        : `allowed for \`${c.idiom}\` and is not in this folder at all`,
    });
  }
  return { dir, files: names, scanned: names.length, findings, controls, cannotLook: null };
}

export function format(r) {
  const out = [];
  out.push(`engine adoption — ${r.dir}`);
  if (r.cannotLook) {
    out.push(`  COULD NOT LOOK — a refusal, not an absence: ${r.cannotLook}`);
    return out.join('\n') + '\n';
  }
  out.push(`  ${r.scanned} .mjs file(s) scanned · ${r.findings.length} finding(s) · ${r.controls.length} allowlist entr(ies)`);
  for (const f of r.findings) {
    out.push(f.line ? `  ✗ ${f.file}:${f.line}  [${f.idiom}]  ${f.text}` : `  ✗ ${f.file}  [${f.idiom}]  ${f.text}`);
  }
  for (const c of r.controls) {
    out.push(`  ${c.matched ? '·' : '✗'} allowed: ${c.file} [${c.idiom}] — ${c.matched ? 'still matches, so the pattern fires inside the population' : 'NO LONGER MATCHES'}`);
  }
  if (!r.findings.length) out.push('  every module reaches the engine through engine.mjs, or is excused here in writing.');
  return out.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || path.basename(process.argv[1] || '') === 'engine_adoption.mjs') {
  const args = parseArgs(process.argv.slice(2));
  const dir = typeof args.dir === 'string' ? path.resolve(args.dir) : path.dirname(fileURLToPath(import.meta.url));
  const r = census(dir);
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else process.stdout.write(format(r));
  process.exitCode = r.cannotLook ? EXIT_CANNOT_LOOK : r.findings.length ? EXIT_FINDINGS : EXIT_OK;
}
