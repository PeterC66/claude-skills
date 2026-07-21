# Stages 4 & 5 — Generate (versioned) and Render

Detailed steps for S4 and S5 of the `make-bus-leaflet` workflow. They always run
together — one image version per build, both images. See SKILL.md for the stage model,
versioning, and the resume-routing table. `%SK%` = the skill's `assets` folder.

## Stage 4 — Generate (versioned)
1. Decide the bump: **`--bump major`** if you produced a new S1/S2/S3 run this time (data changed), else **`--bump minor`** (visual-only re-gen). First ever build → 1.0 automatically.
2. `S4=stage.js new S4 --bump <major|minor>`; `cd "$S4"`.
3. Assemble inputs: `stage.js pull S2 .` then `stage.js pull S3 .` (brings the data jsons + routes.json + the edited generators into `$S4`).
4. `node gen_internal.js` → `internal.svg`; `node gen_external.js` → `external.svg`.
5. **If `routes.json` has `internalSchematic{}`** (the opt-in tube-map-style third image): `node "%SK%\schematize_internal.js"` → `internal-schematic.svg` (+ a `schematic/` workspace subfolder with `debug-skeleton.svg`). Skip entirely when the key is absent. See [schematic-engine.md](schematic-engine.md).
6. **If `routes.json` has `internalDiagram{}`** (the opt-in fully-abstract tube-map DIAGRAM): `node "%SK%\diagram_internal.js"` → `internal-diagram.svg` (+ a `diagram/` workspace with `debug-skeleton.svg` + `solved-nodes.json`). Honours S3's `diagram-layout.json` (pins) and `diagram-overrides.json` when present. Skip when the key is absent. See [diagram-engine.md](diagram-engine.md).
7. `stage.js commit S4 "$S4" --outputs internal.svg,external.svg[,internal-schematic.svg][,internal-diagram.svg] --based-on "S2=$(basename $S2dir);S3=$(basename $S3dir)"`.

## Stage 5 — Render (same version as S4)
1. `S5=stage.js new S5` (inherits S4's version); `cd "$S5"`.
2. `stage.js pull S4 .` → `node "%SK%\render.js" internal.svg internal.jpg`; `node "%SK%\render.js" external.svg external.jpg`; plus `internal-schematic.svg → .jpg` and `internal-diagram.svg → .jpg` when present. `sharp` is bundled in the skill, so `render.js` runs from any folder.
3. **Open the JPGs and inspect.** Iterate — this is a visual craft (see `references/gotchas.md` for common fixes). A visual fix means a new **minor** build: re-do S4 `--bump minor` (pull the same S2/S3) → new S5.
4. `stage.js commit S5 "$S5" --outputs internal.jpg,external.jpg[,internal-schematic.jpg][,internal-diagram.jpg]`.

(Delivery and the end-of-session review step stay in SKILL.md.)
