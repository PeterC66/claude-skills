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

module.exports = { parseArgs, die, readJson, resolveBuses, resolvePortal, LAPTOP_BUSES, LAPTOP_PORTAL };
