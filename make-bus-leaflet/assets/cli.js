'use strict';
/*
 * cli.js — the one argument parser, the one estate resolver, the one usage exit.
 *
 * OA-224 Tier 3.1. Eleven scripts under assets/ and tools/ each carried their own
 * twenty-line `parseArgs`, and every one of them ended `path.resolve(args.buses ||
 * 'C:/u3a St Ives/Using AI/Buses')` — the laptop as the hard fallback, with no way
 * to say where the estate is on any other machine. `bus-work` already had the right
 * convention (BUSES_DIR, BUSMAPS_PORTAL) and nothing else adopted it. This is that
 * convention, written once, so a fix lands everywhere rather than in the copy the
 * session happened to be editing. The resolution order is stated in
 * `references/conventions.md` under "Flags"; this file is what makes it one function.
 *
 * THIS FILE IS DELIBERATELY OUTSIDE THE ENGINE HASH, and that is a precondition
 * rather than a happy accident. `engine_version.js` hashes the five entry points
 * and everything they REQUIRE, transitively; a module that any of them reached
 * would move the template hash and put all twenty maps STALE the moment it was
 * added. None of this file's callers is in that closure — measured before the
 * migration with `node -e "require('./assets/engine_version').engineFiles()"` and
 * again after, and the hash 8911f58625 did not move. If you are about to require
 * this from a generator, from `icons.js` or from `lane_normals.js`, stop: the
 * answer is to pass the value in, not to reach for the parser.
 *
 * WHAT IS NOT HERE. `--drop-framing` style camelCasing, `-h` short flags and
 * `--flag=value` are all absent because no caller uses them; `render_sweep.js`
 * keeps its own parser precisely because it WHITELISTS its flags and refusing an
 * unknown one is a property worth keeping, not a duplication worth removing.
 */
const fs = require('fs');
const path = require('path');

/* The laptop, named once. Everything else asks for it by function. */
const LAPTOP_BUSES = 'C:/u3a St Ives/Using AI/Buses';
const LAPTOP_PORTAL = 'C:/Claude/community-bus-maps';

/*
 * parseArgs — long flags only, a value is the next argument, everything else is
 * positional. `opts.repeat` names the flags that ACCUMULATE: `--town A --town B`
 * gives `['A','B']`, and a repeat flag is always an array, empty when unused, so
 * a caller can map over it without a guard.
 *
 * The value rule is copied exactly from the nine bodies it replaces, including
 * the corner they all share: a flag whose next argument is missing, empty or
 * itself a flag takes the value `true`. That is what makes `--apply` work with no
 * special case, and changing it would silently alter every caller.
 */
function parseArgs(argv, opts = {}) {
  const repeat = opts.repeat || [];
  const f = { _: [] };
  for (const name of repeat) f[name] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { f._.push(a); continue; }
    const name = a.slice(2);
    // A repeat flag takes the next argument unconditionally — that is what the
    // four owners did, and `--town --apply` is a typo rather than a boolean.
    if (repeat.includes(name)) { f[name].push(argv[++i]); continue; }
    f[name] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}

/*
 * die — the usage exit. Exit 2 means "the SCRIPT was used wrongly", which is the
 * distinction `references/conventions.md` draws against 1 ("the thing being
 * checked FAILED"); a caller that treats every non-zero as a failure reports a
 * missing flag as a broken map. The message goes to stderr because stdout carries
 * the answer.
 */
function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

/*
 * readJson — read and parse, naming the file in the error. `gate_lib.js` had the
 * one-liner `JSON.parse(fs.readFileSync(p,'utf8'))`, whose parse failure says
 * "Unexpected token }" and not WHICH of the estate's several hundred JSON files
 * it was reading; gate_lib now delegates here, so there is one implementation and
 * the message improves everywhere at once.
 *
 * It THROWS rather than exiting, which is the opposite of `die` above and is
 * deliberate: gate_lib's callers already catch this and decide for themselves
 * whether a missing file is fatal. `fallback` is returned when the file is
 * absent, and only then — a fallback that also swallowed a syntax error would
 * hide a corrupt config behind a default.
 */
function readJson(file, fallback) {
  if (fallback !== undefined && !fs.existsSync(file)) return fallback;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { throw new Error(`cannot read ${file} — ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`${file} is not valid JSON — ${e.message}`); }
}

/* The shared shape behind resolveBuses/resolvePortal: flag, then env, then laptop. */
function resolveDir(value, envValue, fallback, flagName) {
  if (value === true) die(`${flagName} needs a path`);
  return path.resolve((typeof value === 'string' && value) || envValue || fallback);
}

/**
 * resolveBuses — where the map estate is: `--buses`, then `BUSES_DIR`, then the
 * laptop. `env` is a parameter rather than a read of `process.env` so a test can
 * put the middle step under a microscope without mutating the process.
 */
function resolveBuses(args = {}, env = process.env) {
  return resolveDir(args.buses, env.BUSES_DIR, LAPTOP_BUSES, '--buses');
}

/** resolvePortal — the portal checkout: `--portal`, then `BUSMAPS_PORTAL`, then the laptop. */
function resolvePortal(args = {}, env = process.env) {
  return resolveDir(args.portal, env.BUSMAPS_PORTAL, LAPTOP_PORTAL, '--portal');
}

/*
 * byArgs — the `--by <who>` pass-through for every tool that drives `stage.js new`
 * or `stage.js commit`, in ONE place because there are four of them: both rollouts,
 * `adopt_config.js` and `poi_tiers_sync.js`. OA-427 built the flag on `stage.js` and
 * measured the result: 1,211 stage runs in the 30-day window, not one of them
 * carrying an actor, because no caller passed it. The window fills only when every
 * caller does, and a fifth caller written later is why this is a function rather
 * than four copies of a ternary.
 *
 * IT VALIDATES NOTHING, AND THAT IS THE POINT. `stage.js` owns the rules — empty,
 * multi-line, over-length — and says so in messages that name OA-427. A bare `--by`
 * (parseArgs gives `true` when the next argument is missing or is itself a flag) is
 * therefore forwarded as a bare `--by`, so the operator gets stage.js's own "--by
 * needs a name after it" rather than a second, drifting copy of it from here. The
 * one thing this must never do is invent a name: absent is the honest answer when
 * nobody said, and a guess would be indistinguishable from a statement the moment
 * it reached the manifest.
 */
function byArgs(v) {
  if (v === undefined || v === null || v === false) return [];
  return v === true ? ['--by'] : ['--by', String(v)];
}

/*
 * holderName / resolveBy — WHO is doing this, when nobody said (buses-data OA-586, A8 of the
 * 2026-10-06 simplification review). `--by` was optional and so was left off: the rate it feeds,
 * human touches per map-month, was a rate over the half of builds somebody happened to
 * attribute. The name is already written down for every run that may write a map: `loop/LOCK.d/
 * holder` in buses-data, whose first line is "<name> <time> ..." — `sched-HHMM` for a loop tick,
 * the session's own name otherwise — because a map build holds that lock. So a missing `--by`
 * is read from there, and a write that can find no name at all is REFUSED instead of recording
 * nobody. byArgs() above is untouched: it still invents nothing, and the name here is one a
 * person or tick wrote down, never a guess. A first word that starts with a digit is a time
 * and not a name, and is not used.
 */
function holderName(buses) {
  let raw;
  try { raw = fs.readFileSync(path.join(buses, 'loop', 'LOCK.d', 'holder'), 'utf8'); } catch { return null; }
  const m = /^\s*(\S+)/.exec(raw.split('\n')[0] || '');
  return m && !/^\d/.test(m[1]) ? m[1] : null;
}

/** The `--by` argv for a tool that is about to write: the flag if given (bare `--by` is forwarded
 * bare, for stage.js to refuse), else the lock holder's name; with `required` and neither, exit 2. */
function resolveBy(args, buses, { required = false, d = die } = {}) {
  const given = byArgs(args.by);
  if (given.length) return given;
  const held = holderName(buses);
  if (held) return ['--by', held];
  if (required) d('--by is required when writing: pass --by <who> (sched-HHMM for a loop tick, your session name otherwise), or take the loop lock so loop/LOCK.d/holder names you (buses-data OA-586). An unattributed build is how the touches-per-map-month rate went wrong.', 2);
  return [];
}

module.exports = { parseArgs, die, readJson, resolveBuses, resolvePortal, byArgs, holderName, resolveBy, LAPTOP_BUSES, LAPTOP_PORTAL };
