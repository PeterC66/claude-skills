// Where the engine is, and the engine's own argument conventions, for both of
// this skill's entry points.
//
// OA-232 Tier 2.6, from the 2026-09-03 codebase review (satellite F12, cross-repo
// F30). Two things were wrong and they were the same thing twice.
//
// 1. `worklist.mjs` and `push-status.mjs` each carried their own `parseArgs`,
//    their own `loadPortalEnv` and their own `findSkillAssets` — byte-identical
//    after a whitespace strip except for ONE line: worklist probed the candidate
//    folder for `gate_lib.js` and push-status for `status.js`, so on a tree
//    holding one and not the other the two tools could resolve DIFFERENT engine
//    folders and neither would say so. `assetsDir()` probes both.
//
// 2. `bus-work` is the skill that OWNS the `BUSES_DIR` / `BUSMAPS_PORTAL`
//    convention — `make-bus-leaflet/assets/cli.js` says so in its own header,
//    naming this skill as the place that had it right when nothing else did —
//    and it reached the engine through bare path literals and re-implemented the
//    resolution it invented. It now READS `cli.js`, so there is one resolution
//    order in the system rather than a convention and a copy of it.
//
// `createRequire` because `cli.js` is CommonJS and this skill is ESM. Loading it
// is a `require` of a plain module with no side effects — `cli.js` opens nothing,
// which is the property `make-bus-leaflet/test/cli.test.js` holds.
//
// THE FALLBACK IS DELIBERATE AND IS NOT A SECOND CONVENTION. If the engine tree
// cannot be found — a checkout with no sibling skills folder — `parseArgs` and
// the two resolvers degrade to local copies rather than throwing, because a
// worklist that refuses to run because it cannot find a folder it only needs for
// argument parsing would be worse than one that parses arguments itself. The
// local copies are the same three functions; `resolveEngine()` reports which one
// you got, and `prove-red-commitments.mjs` covers the degraded path.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const LAPTOP_BUSES = 'C:/u3a St Ives/Using AI/Buses';
const LAPTOP_PORTAL = 'C:/Claude/community-bus-maps';

/**
 * The make-bus-leaflet assets folder, wherever the skills tree actually lives.
 *
 * Probes for BOTH `gate_lib.js` and `status.js`: the two callers used to probe
 * one each, which is a candidate list that can pick different answers for two
 * tools that must agree about which engine they are talking to.
 */
export function assetsDir() {
  const cands = [
    process.env.BUS_SKILL_ASSETS,
    path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets'),
    'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets',
    path.join(process.env.USERPROFILE || '', '.claude', 'skills', 'make-bus-leaflet', 'assets'),
  ].filter(Boolean);
  return cands.find((c) => existsSync(path.join(c, 'gate_lib.js')) && existsSync(path.join(c, 'status.js'))) || null;
}

/** Long flags only; a value is the next argument unless it is itself a flag. */
function localParseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    f[k] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}

const engineCli = (() => {
  const dir = assetsDir();
  if (!dir) return null;
  try { return require_(path.join(dir, 'cli.js')); } catch { return null; }
})();

/** Which parser you actually got: 'engine' when cli.js was loaded, else 'local'. */
export function resolveEngine() {
  return { assets: assetsDir(), source: engineCli ? 'engine' : 'local' };
}

export const parseArgs = engineCli ? engineCli.parseArgs : localParseArgs;

/** `--buses`, then `BUSES_DIR`, then the one named laptop path. */
export function resolveBuses(args = {}) {
  if (engineCli) return engineCli.resolveBuses(args);
  return path.resolve((typeof args.buses === 'string' && args.buses) || process.env.BUSES_DIR || LAPTOP_BUSES);
}

/** `--portal`, then `BUSMAPS_PORTAL`, then the one named laptop path. */
export function resolvePortal(args = {}) {
  if (engineCli) return engineCli.resolvePortal(args);
  return path.resolve((typeof args.portal === 'string' && args.portal) || process.env.BUSMAPS_PORTAL || LAPTOP_PORTAL);
}

/*
 * loadPortalEnv — the portal's own `.env`, read into `process.env`.
 *
 * Not strictly "the engine", and here anyway: it was the third function these
 * two files each carried a copy of, and its ORDER relative to everything else is
 * the part that has already gone wrong once. `push-status.mjs` computed
 * `URL_BASE` above its own call until 2026-09-02, so a `BUSMAPS_URL` set only in
 * the portal's `.env` was never seen and the script silently wrote the snapshot
 * into the dev store while `SKILL.md` promised the remote one (OA-224 Tier 1.1).
 * One copy is one place for that ordering note to live.
 *
 * Real environment wins, so an explicit override still works. Call it AFTER
 * `resolvePortal` (it needs the folder) and BEFORE `resolveBuses` (which reads
 * `BUSES_DIR`, and the portal's `.env` is where that is set).
 */
export function loadPortalEnv(dir) {
  const f = path.join(dir, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env) && v) process.env[m[1]] = v;
  }
}
