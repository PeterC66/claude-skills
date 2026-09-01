# Brief: the satellite skills

Slice heading in the findings document: **Review 3 — the satellite skills**.

Subject: the skills in repo claude-skills at `C:\u3a St Ives\.claude\skills\` other than the engine itself:

1. `make-place-bus-leaflet/` — `SKILL.md`, `assets/` (`gen_external_places.js`, `gen_internal_place.js`, `build_internal_place*.js`, `aggregate_destinations.js`, `derive_*`, `gtfs_chains.py`, `resolve_place.py`, `solve_external_layout.py`, `place_verified_services.js`), and any references or tests. Its stated design is that it REUSES the town engine at `../make-bus-leaflet/assets/` unchanged and adds only place-specific tools. Verify that claim: grep for `require(` targets that reach into make-bus-leaflet, and for any function that is a copy of one there (compare `gen_external_places.js` against `gen_external_radial.js` with whitespace-stripped `comm`, not raw `diff`, because the clone was re-styled). Note the stage mapping P1–P5 onto S1–S6 and whether it is applied consistently. Check whether the place external now carries STRICT_GUARDS and whether places have any verify stage.
2. `bus-work/` — `SKILL.md` and `assets/` (`worklist.mjs`, `concurrency.mjs`, `push-status.mjs`, `refresh_review.mjs`, `prove-red-*.mjs`). ESM where the engine is CommonJS: assess whether that split is principled and what it costs. It reads the portal over HTTP and the local map tree; check how it handles missing config and tokens, the order in which it reads env and `.env`, and how it parses argv. Check whether its harnesses run in CI.
3. `audit-bus-leaflet/` and `review-bus-codebases/` — whatever is in them; assess whether they are consistent with the others.

Also read the top-level `CLAUDE.md` and `.github/workflows/gates.yml` only to know which of these skills have tests in CI and which have none.

Review for: duplication against the town engine (quantify it), consistency of conventions with make-bus-leaflet (CLI flags, exit codes, manifest handling, JSON output, naming), the module-system split, test coverage per skill (count test files and prove-red harnesses per skill, and what has zero), whether each `SKILL.md`'s commands match the code's actual flags, and the vendoring implications (which of these files are vendored into the portal per `C:\Claude\community-bus-maps\engine\vendored.json`; read that file).
