# Brief: the engine's pipeline, gates and tooling

Slice heading in the findings document: **Review 2 — the engine's pipeline, gates and tooling**.

Subject: the PIPELINE, GATES and TOOLING half of the bus-map engine at `C:\u3a St Ives\.claude\skills\make-bus-leaflet\` (repo claude-skills). Another reviewer covers the SVG generators and drawing modules; do not duplicate that. Your files:

- Orchestration and gates in `assets/`: `stage.js`, `status.js`, `gate_lib.js`, `gate.js`, `rollout.js`, `rollout_places.js`, `quality_gate.js`, `quality_metrics.js`, `verify_report.js`, `redteam_source.js`, `sync_ci_reference.js`, `refresh_latest.js`, `refresh_area_fixture.js`, `build_log.js`, `strict_guards.js`, `stray_outputs.js`, `index_guard.js`, `seed_prev_s4.js`, `render.js`, `render_sweep.js`, `contact_sheet.js`, `crop_compare.js`, `preview_design.js`, `edit-server.js`, `diagram_edit.js`, `scratch.js`, `line_endings.js`, `adopt_config.js`, `curate_services.js`, `match_routes.js`, `derive_intown.js`, `pull_*.js`, `backfill_coords.js`, `freeze_orientation.js`, `poi_worksheet.js`, and anything added since.
- All Python in `assets/`.
- `tools/` (the prove-red harnesses and gates listed in `package.json` scripts), `test/`, `package.json`, `.gitattributes`, and `.github/workflows/gates.yml` at the repo root.
- The skill's own docs, `SKILL.md` and `references/*.md`, only for whether the code and the docs agree on commands, flags and folder layout.

Review for: consistency of CLI conventions across the scripts (how each parses argv, prints usage, exits, names its flags; JSON on stdout vs human text; exit codes), duplicated helpers between JS and Python (reading `manifest.json`, walking `Areas/` and `Places/`, finding the latest run folder — count the independent implementations), error handling (bare or swallowing catches, `process.exit` inside library code), the JS/Python split, module hygiene (top-to-bottom scripts vs `require.main === module`, `module.exports` presence), test structure (what the unit tests cover vs the prove-red harnesses; tests that depend on the data repo, the laptop or the network; tests that bypass `test/_engine.js`), which `tools/` files run in no CI job, whether `package.json` names `python` where CI names `python3`, and whether `package.json` scripts are discoverable.

Method: sample. Grep for `process.argv`, `argparse`, `sys.argv`, `process.exit(`, `sys.exit(`, `require.main`, `if __name__`, `manifest.json`, `_latest`, `'Areas'`, `'Places'`, `console.error`, `catch {}`, `except:`, `u3a St Ives`. Read the head 80 lines of each file to classify its CLI style. Read `stage.js` and `gate_lib.js` more fully since everything depends on them. Diff the `run:` lines in `gates.yml` against the `tools/` listing.
