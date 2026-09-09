#!/usr/bin/env node
/* loop_lock.mjs — read the scheduled loop's mutex, `loop/LOCK.d`, so that a
 * MANUAL session can see it. buses-data OA-287.
 *
 * WHY THIS FILE EXISTS AT ALL. The loop takes `loop/LOCK.d` at step 3 of its
 * stored prompt, writes its name and lease into `holder`, and a later tick
 * refuses to steal from any holder whose first line is not a `sched-` name.
 * That half was written, falsified and deployed. The other half did not exist:
 * `bus-work/SKILL.md` never mentioned the lock, `concurrency.mjs` never read it,
 * and an ad-hoc manual prompt was told nothing. So a session started at 20:05
 * walked straight into a tick that took the lock at 20:00.
 *
 * AND IT WAS STRUCTURAL, NOT AN OVERSIGHT. `loop/` is gitignored, so the lock
 * directory can never appear as an uncommitted file in the `buses-tree`
 * verdict — the single signal a manual session does consult is blind to the
 * loop's existence by construction. A document addressed to the reader would
 * not have fixed that; only a reader in the tool they already run does.
 *
 * A MUTEX TAUGHT TO ONE PARTY IS NOT A MUTEX, IT IS A LOG.
 *
 * WHAT THIS FILE DOES NOT DO. It does not take the lock, release it, or decide
 * whether to steal it. Those are the caller's, and for a tick they are step 3 of
 * the stored prompt, which is deliberately left as the only place the steal rule
 * is written. This is a reader; the verdicts built on it live in
 * `concurrency.mjs` beside every other rule.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/* The lease the loop's own prompt sets, and the fallback for a holder that does
 * not carry a parseable `expires:`. Ninety minutes is NOT an estimate of how
 * long work takes — that claim was falsified by the first S6 red team — it is
 * the floor a holder may extend from. Kept here as the one number so a caller
 * cannot quietly disagree with the prompt. */
export const DEFAULT_LEASE_MIN = 90;

/* A tick's name is the only self-terminating one on this disk. A person's
 * session sitting idle looks exactly like an abandoned one, and idle is the
 * normal case — so the name decides what may be assumed, and nothing else. */
const TICK_NAME_RE = /^sched-/;

/* Lenient on purpose. The holder's first line is "<name> <time> <prose>" and the
 * second is "expires: <time>", but both are written by a language model into a
 * file no schema governs, so a format this cannot parse must degrade to a stated
 * unknown rather than to a throw or to a confident wrong answer. */
const ISO_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;

/* NO ISO MATCH MEANS NULL, and the fall-through this replaced is the reason
 * the comment above is worth its length. Until 2026-09-09 an unmatched line was
 * handed whole to `Date.parse`, and the holder's first line BEGINS WITH THE
 * SESSION NAME: V8's legacy parser reads `buses-04` as 2001-03-31 and
 * `buses-85 (interactive session, Peter at the keyboard)` as 1985-01-01. That
 * is the "confident wrong answer" the comment forbids, and it was not
 * cosmetic — `takenAt` came back non-null, so the mtime fallback below was
 * never reached, a lock taken nine minutes earlier printed as 365434h old and
 * permanently expired, and the sentence `concurrency.mjs` builds from it told
 * Peter to delete a live session's mutex. A stated unknown is what is wanted
 * here: return null, and let the caller fall back to the directory mtime that
 * the atomic `mkdir` set. */
function parseWhen(text) {
  if (!text) return null;
  const m = ISO_RE.exec(text);
  if (!m) return null;
  const t = Date.parse(m[0].replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

/*
 * READ THE LOCK. `busesDir` is the buses-data working tree; everything is
 * resolved under it, so a harness pointing at a throwaway directory gets a
 * throwaway answer and never the real one.
 *
 * Every field that could not be established is null rather than a guess, and
 * `*Source` says where the value came from — because "the lease expired" read
 * off a fallback and read off the holder's own line are different claims, and a
 * reader deciding whether to clear somebody's lock deserves to know which.
 */
export function readLoopLock(busesDir, { selfSession = null, now = Date.now(), leaseMin = DEFAULT_LEASE_MIN } = {}) {
  const out = {
    dir: null, present: false, readable: false, raw: null,
    name: null, isTick: false, mine: false,
    takenAt: null, takenSource: null, ageMin: null,
    expires: null, expiresSource: null, expired: null, overdueMin: null, remainMin: null,
    leaseMin,
  };
  if (!busesDir) return out;
  const dir = path.join(busesDir, 'loop', 'LOCK.d');
  out.dir = dir;
  if (!existsSync(dir)) return out;
  out.present = true;

  /* The directory is the lock. `holder` is the courtesy inside it, and a lock
   * whose holder file is missing or unreadable is still a held lock — which is
   * why `present` and `readable` are separate fields and the rule treats an
   * unreadable holder as a reason to go and look rather than as an absence. */
  let raw = null;
  try { raw = readFileSync(path.join(dir, 'holder'), 'utf8'); } catch { raw = null; }

  /* mtime of the directory, not of `holder`: the directory is created by the
   * atomic `mkdir` that IS the taking, so its mtime is the one timestamp on
   * this disk that no prose can be wrong about. Used only as a fallback. */
  let dirMtime = null;
  try { dirMtime = statSync(dir).mtimeMs; } catch { dirMtime = null; }

  if (raw !== null) {
    out.readable = true;
    out.raw = raw;
    const lines = raw.split(/\r?\n/);
    const first = (lines[0] || '').trim();
    out.name = first.split(/\s+/)[0] || null;
    out.takenAt = parseWhen(first);
    out.takenSource = out.takenAt === null ? null : 'holder';
    const exp = lines.find((l) => /^\s*expires\s*:/i.test(l));
    if (exp) {
      out.expires = parseWhen(exp.replace(/^\s*expires\s*:/i, ''));
      if (out.expires !== null) out.expiresSource = 'holder';
    }
  }

  if (out.takenAt === null && dirMtime !== null) {
    out.takenAt = dirMtime;
    out.takenSource = 'mtime';
  }
  /* "A holder with no parseable expires falls back to taken-plus-ninety — the
   * old behaviour, so an old-format or hand-written lock stays recoverable
   * rather than becoming immortal." loop/README.md, the lease rule. */
  if (out.expires === null && out.takenAt !== null) {
    out.expires = out.takenAt + leaseMin * 60000;
    out.expiresSource = 'fallback';
  }

  out.isTick = !!out.name && TICK_NAME_RE.test(out.name);
  out.mine = !!selfSession && !!out.name && out.name === selfSession;
  if (out.takenAt !== null) out.ageMin = Math.max(0, Math.floor((now - out.takenAt) / 60000));
  if (out.expires !== null) {
    out.expired = now > out.expires;
    out.overdueMin = out.expired ? Math.floor((now - out.expires) / 60000) : 0;
    /* Derived HERE, against the same `now` everything else on this object was
     * derived against. The rule that prints it must not reach for Date.now() of
     * its own — a verdict built from two different clocks is one a harness
     * cannot pin down, and the first draft of the rule did exactly that. */
    out.remainMin = out.expired ? 0 : Math.floor((out.expires - now) / 60000);
  }
  return out;
}

/* Minutes as something a person reads at a glance. Used in the rule's sentence,
 * which is the whole output anybody sees. */
export function fmtMin(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'an unknown time';
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* Run directly for a one-line answer about the real tree. Not a gate and not
 * wired into one: it is here so that "is the loop holding the lock right now?"
 * is answerable without reading JSON. */
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('loop_lock.mjs')) {
  const dir = process.argv[2] || 'C:/u3a St Ives/Using AI/Buses';
  const L = readLoopLock(dir, { selfSession: process.argv[3] || null });
  if (!L.present) console.log('loop/LOCK.d is not held.');
  else if (!L.readable) console.log(`loop/LOCK.d is held and its holder file cannot be read (${L.dir}).`);
  else console.log(`loop/LOCK.d held by ${L.name} — taken ${fmtMin(L.ageMin)} ago (${L.takenSource}), lease ${L.expired ? `EXPIRED ${fmtMin(L.overdueMin)} ago` : `live`} (${L.expiresSource})${L.isTick ? ', a scheduled tick' : ''}${L.mine ? ', and it is yours' : ''}.`);
}
