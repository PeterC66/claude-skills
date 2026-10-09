#!/usr/bin/env node
/*
 * adhoc_pretest.mjs — is a file in `adhoc/ready/` still worth a run, and does it
 * still need nothing from Peter? (buses-data, 2026-10-08, at Peter's request.)
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets):
 *
 *   node adhoc_pretest.mjs [--buses <buses-data root>] [--json]
 *
 * `--buses` resolves as everywhere else in this folder (engine.mjs).
 * It reads and prints; it never moves, writes or commits. It always exits 0.
 *
 * WHY. A prompt is written on one day and reached by the ad-hoc loop on another.
 * Until now the only test of whether it still applied was a re-check of its
 * "premise" after it was fourteen days old, made by the run itself, after the run
 * had taken the lock and moved the file. A prompt overtaken at lunchtime cost a
 * full run to find out, and a prompt that could only end in a hold cost a run to
 * say so.
 *
 * THE CONTRACT. A ready file may carry either or both of these bold lines, under
 * its H1. Each holds one or more backticked conditions:
 *
 *   **Still needed if:** `oa-open OA-594` `exists Areas/March/manifest.json`
 *   **Needs Peter if:**  `oa-decision-peter OA-594` `your-move-has march`
 *
 * Every "still needed" condition must hold, or the file is SUPERSEDED. If it
 * holds, any "needs Peter" condition that is true makes the file BLOCKED. The
 * conditions are a closed vocabulary, deliberately, so that the test is a
 * reading and never a command a file can smuggle in:
 *
 *   oa-open OA-nnn            true while Development Docs/open-actions/ (or _parked/) holds OA-nnn.md
 *   oa-decision-peter OA-nnn  true while that OA's front matter says `decision: peter`
 *   exists <path>             true while <path> (relative to the Buses root) exists
 *   missing <path>            the opposite
 *   unchanged <sha> <path>    true while no commit after <sha> touched <path>
 *   contains <path> :: <text> true while the file holds the text
 *   your-move-has <text>      true while a file in loop/your-move/ has <text> in its NAME
 *
 * THREE VERDICTS THAT ARE NOT A DECISION. A condition the module cannot read
 * (unknown verb, missing argument, a git error) is UNREADABLE and the file is
 * DUE: it must never supersede a file on a test it could not run. A file with
 * neither line is UNDECLARED and falls back to the run's own fourteen-day
 * re-check. A standing file (`zz…`) is STANDING: it has a cadence gate of its own.
 *
 * `prove-red-adhoc-pretest.mjs` breaks each verdict on purpose.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses } from './engine.mjs';

/** The backticked conditions on the first `**<label>:**` line, or null if there is no such line. */
export function conditionsOf(text, label) {
  const m = new RegExp(`^\\*\\*${label}:\\*\\*(.*)$`, 'im').exec(text);
  if (!m) return null;
  return [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim());
}

const oaPath = (buses, ref) => {
  if (!/^OA-\d+$/.test(ref || '')) return null;
  for (const d of ['', '_parked']) {
    const p = path.join(buses, 'Development Docs', 'open-actions', d, `${ref}.md`);
    if (existsSync(p)) return p;
  }
  return null;
};

/** Evaluate one condition. Returns true, false, or undefined when it cannot be read. */
export function evaluate(cond, buses) {
  const m = /^(\S+)\s*(.*)$/.exec(cond);
  if (!m) return undefined;
  const [, verb, rest] = m;
  const rel = (p) => path.join(buses, p);
  try {
    switch (verb) {
      case 'oa-open':
        if (!/^OA-\d+$/.test(rest)) return undefined;
        return oaPath(buses, rest) !== null;
      case 'oa-decision-peter': {
        if (!/^OA-\d+$/.test(rest)) return undefined;
        const p = oaPath(buses, rest);
        if (!p) return false;
        const head = readFileSync(p, 'utf8').split(/\r?\n---\r?\n/)[0];
        return /^decision:\s*peter\s*$/m.test(head);
      }
      case 'exists': return rest ? existsSync(rel(rest)) : undefined;
      case 'missing': return rest ? !existsSync(rel(rest)) : undefined;
      case 'unchanged': {
        const [sha, ...p] = rest.split(/\s+/);
        if (!/^[0-9a-f]{7,40}$/i.test(sha || '') || !p.length) return undefined;
        const out = execFileSync('git', ['-C', buses, 'log', '--format=%H', `${sha}..HEAD`, '--', p.join(' ')], { encoding: 'utf8' });
        return out.trim() === '';
      }
      case 'contains': {
        const [p, text] = rest.split(/\s+::\s+/);
        if (!p || !text) return undefined;
        return existsSync(rel(p)) && readFileSync(rel(p), 'utf8').includes(text);
      }
      case 'your-move-has': {
        if (!rest) return undefined;
        const dir = path.join(buses, 'loop', 'your-move');
        return existsSync(dir) && readdirSync(dir).some((n) => n.toLowerCase().includes(rest.toLowerCase()));
      }
      default: return undefined;
    }
  } catch { return undefined; }
}

/** Verdict for one file's text. */
export function pretest(name, text, buses) {
  if (/^zz/i.test(name)) return { name, verdict: 'STANDING', why: 'a standing file has its own cadence gate' };
  const still = conditionsOf(text, 'Still needed if');
  const needs = conditionsOf(text, 'Needs Peter if');
  if (!still?.length && !needs?.length) return { name, verdict: 'UNDECLARED', why: 'no pre-test lines; the run applies its fourteen-day re-check' };
  const unreadable = [];
  for (const c of still || []) {
    const r = evaluate(c, buses);
    if (r === undefined) unreadable.push(c);
    else if (r === false) return { name, verdict: 'SUPERSEDED', why: `no longer true: ${c}` };
  }
  for (const c of needs || []) {
    const r = evaluate(c, buses);
    if (r === undefined) unreadable.push(c);
    else if (r === true) return { name, verdict: 'BLOCKED', why: `needs Peter: ${c}` };
  }
  if (unreadable.length) return { name, verdict: 'DUE', why: `unreadable, so not acted on: ${unreadable.join('; ')}` };
  return { name, verdict: 'DUE', why: 'every declared condition holds' };
}

/** Verdicts for every .md file in `adhoc/ready/`, in filename order. Absent folder → []. */
export function pretestAll(buses) {
  const dir = path.join(buses, 'adhoc', 'ready');
  let names;
  try { names = readdirSync(dir).filter((n) => /\.md$/i.test(n)).sort(); } catch { return []; }
  return names.map((n) => {
    try { return pretest(n, readFileSync(path.join(dir, n), 'utf8'), buses); }
    catch (e) { return { name: n, verdict: 'DUE', why: `unreadable file, not acted on: ${e.message}` }; }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  const rows = pretestAll(resolveBuses(args));
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  else if (!rows.length) console.log('adhoc/ready/ is empty or absent.');
  else for (const r of rows) console.log(`${r.verdict.padEnd(10)} ${r.name} — ${r.why}`);
}
