/*
 * place_engine.js — how a place ASSET reaches the town engine, written once.
 *
 * OA-232 Tier 3.1, 2026-09-03. The town skill's shared code has been
 * self-resolving since 2026-09-02: `engine_paths.js` holds the search, and each
 * of its five entry points carries a four-line bootstrap whose only job is to
 * find THAT file. This skill adopted none of it (satellite F8, F10, F22) — its
 * assets each spelled out their own reach across, and four of them ended in an
 * absolute path that exists on one laptop.
 *
 * WHY THIS IS A MODULE HERE AND A BOOTSTRAP THERE. The town's entry points are
 * COPIED away from their siblings — into an S4 workspace by rollout.js, into
 * `engine/area/` by the portal — so each has to be able to find the resolver from
 * nowhere, which is why the bootstrap cannot be shared and is asserted identical
 * instead. The eleven build-time assets in this folder are never copied anywhere:
 * they run in place, as siblings of each other, so `require('./place_engine.js')`
 * always resolves and the bootstrap can live in exactly one of them.
 *
 * `gen_external_places.js` and `gen_internal_place.js` are the exception and keep
 * their own bootstrap: those two ARE vendored, to `engine/place/`, without this
 * file beside them. That is the same reason the town's five keep theirs.
 *
 * WHAT THE FOURTH ARM IS FOR. Sibling, then SKILL_ASSETS, then a hop across to
 * `make-bus-leaflet/assets/`, then the laptop. The third arm is this skill's, and
 * it is the one that answers when a place asset runs in place with nothing set —
 * which is the ordinary case here and the case CI is in, on a machine where the
 * fourth arm does not exist. It went into engine_paths.js rather than staying
 * private to this folder, so there is one search and not two.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// The bootstrap: byte-identical to the six in the entry points, and asserted so
// by make-bus-leaflet/test/engine_paths.test.js. It is the code that finds the
// resolver, so it cannot ask the resolver where to look.
const _EP = (() => { const local = path.join(__dirname, 'engine_paths.js');
  try { if (fs.existsSync(local)) return local; } catch (e) {}
  if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS, 'engine_paths.js');
  const across = path.join(__dirname, '..', '..', 'make-bus-leaflet', 'assets', 'engine_paths.js');
  try { if (fs.existsSync(across)) return across; } catch (e) {}
  return 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/engine_paths.js'; })();

const { engineDep, siblingOf, spawnTarget, ENGINE_HOME } = require(_EP);

/** dep(name) -> an absolute path to a TOWN engine module, from this folder. */
const dep = engineDep(__dirname);

/** The one argument parser, the one estate resolver, the one usage exit. Taken
 * through dep() like everything else, so a place script gets `parseArgs`, `die`,
 * `readJson` and `resolveBuses` without a second copy of any of them. */
const cli = require(dep('cli.js'));

/* TOWN_ASSETS — the town engine FOLDER, for the two build scripts that do not
 * require anything out of it but hand it to a child as SKILL_ASSETS (their `TSK`).
 * Derived from where the search actually landed rather than joined again, so it
 * follows all four arms; both scripts joined `../../make-bus-leaflet/assets`
 * themselves and so ignored SKILL_ASSETS entirely, which is the arm that matters
 * when the engine is not where the tree says. `env.TSK` still wins at each call
 * site, as it always did. */
const TOWN_ASSETS = path.dirname(dep('cli.js'));

module.exports = { dep, cli, TOWN_ASSETS, engineDep, siblingOf, spawnTarget, ENGINE_HOME };
