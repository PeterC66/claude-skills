# Changing the engine safely — the invariants, the gates, and the portal hand-off

Read this **before editing any file in `assets/`**. The stage references (`s1-services.md` …)
tell you what each stage does; this one tells you what must remain true when you change the code
that does it, and what else has to be updated in the same session.

`%SK%` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`
`%PSK%` = `C:\u3a St Ives\.claude\skills\make-place-bus-leaflet\assets`

> **2026-08-04.** The manual gate table in §2, the four-gate checklist in §2a, and the `cmp` loop
> over the §4 vendoring table are now automated: `node "%SK%\status.js"` gates every town, place,
> and portal fixture against the *current* template in one run (`--md` for a pasteable table,
> `--json` for scripting, non-zero exit on anything needing attention), and
> `node "%SK%\rollout.js" [--town "<Town>"|--all] [--apply]` does the §2a re-render sequence
> per town (dry-run by default; stops before publishing if a label is lost vs the previous build).
> Both are pure compute over data already on disk — no S1/S2 network fetch. The prose below still
> describes *what* the gate proves and *why* the re-render is needed; treat the tables as history,
> not as the thing to update by hand. Run `status.js` first — it already caught one real instance
> of the drift class in the next paragraph (`gen_external_places.js`, fixed the same day).
>
> **CI runs the same gates on every push** (`.github/workflows/gates.yml` in both `claude-skills` and
> `buses-data`, plus a daily schedule). It needed one extra piece: each town/place's `S4-generate`
> output is gitignored (rebuildable bulk, not tracked), so a fresh CI clone has nothing for `status.js`
> to diff a fresh regeneration against. `node "%SK%\sync_ci_reference.js"` mirrors just the
> `*.json`/`*.svg` files from each town/place's **latest** S4 run into a small tracked `ci-reference/`
> folder beside it (~19MB total, not covered by any gitignore rule); `gate_lib.js`'s `latestRunDir()`
> falls back to that folder only when the real `S4-generate` dir is missing on disk, so local runs are
> unaffected. `rollout.js --apply` calls the sync automatically, so it can't go stale — but if you ever
> commit an S4 run **outside** `rollout.js` (a manual `stage.js commit S4`), run
> `sync_ci_reference.js` yourself afterwards or CI will silently keep gating the *previous* published
> version. Two other CI traps already hit once each (2026-08-04): a real portal-vendoring fix can exist
> as a **local, unpushed commit** in `community-bus-maps` and CI will correctly fail until it's pushed
> — that's CI doing its job, not a bug; and don't add `--no-verify` to a test commit even when no hook
> is configured, since the rule against it is about intent, not about whether a hook happens to exist.
>
> **Also 2026-08-04 (item 3).** S3 no longer freezes a copy of the generators — see the rewritten §2a
> below and [s3-config.md](s3-config.md)'s `engine` field. Verified in a throwaway sandbox copy of
> March: a forced engine-only rollout produced a new S4 (v2.2→v2.3) with **no new S3 run**, stamped
> `routes.json.engine` to the live template's hash, and `status.js` picked the stamp straight back up.
> **Not yet applied to any live town** — every currently-built town still carries a pre-item-3 S3 with
> its own generator copy (harmless dead weight, per §2a) and reads `engine: (none)` until its next real
> S4 build. The portal-side half of "collapses the vendoring table into a version pin too" (§4) is
> **deferred** — `engine_version.js` exists and could stamp a hash file in the portal's `engine/`
> folder, but that repo hasn't been touched; §4's byte-diff `cmp` procedure is still how the portal side
> is checked today.
>
> **Also 2026-08-04: `internalRoads` graduated from opt-in to default.** Every built town (8/8) and
> place (5/5) had `internalRoads` set — the classic pre-road-skeleton stop-chord model had no live
> user left, and `draft_town.py` had already been hardcoding the key on every new town for weeks. In
> `gen_internal.js`, `IR` now defaults to the standard object when the key is **absent**; only an
> explicit `internalRoads:false` still selects classic (kept as an escape hatch, not expected to be
> used). This matches the pattern `make-place-bus-leaflet/assets/build_internal_place_roads.js` already
> used (`RJ.internalRoads == null || === true` → `{}`). No functional change for any existing town/place
> (all already set the key); `status.js` confirmed 8/8 towns, 5/5 places, and the portal fixture still
> PASS. Header doc comment updated to match. **Not done:** the classic-model code paths themselves
> (`if(IR)`/`IR?` branches, ~11 sites) are still in the file, just unreachable by default — a full
> removal is a separate, larger change (see the option-2 discussion this was weighed against). This
> edit drifts `gen_internal.js` from the portal's vendored copy (`engine/place/gen_internal.js`) —
> re-vendor next time that repo is touched, per §4.

---

## 0. First ask: does this need a code change at all?

Most "the map should look different" requests are a **`routes.json` key**, not code. The generators
are deliberately free of town literals. Check `s3-config.md` for an existing key before reaching for
`gen_internal.js`. If the behaviour you want is genuinely new, **add a config key** — never a town
literal (see the invariants below).

If it's a whole new *output* (a fourth kind of sheet), don't extend an existing generator: copy the
pre-stage pattern in `schematic-engine.md` / `diagram-engine.md` — a config-gated script that
rewrites geometry into a workspace and then runs the **unmodified** `gen_internal.js` there. Two
outputs have been added that way with zero regression risk.

## 1. The invariants (breaking one of these is a defect, not a trade-off)

1. **No town literals in a generator.** Everything town-specific comes from `routes.json`. If you
   find yourself typing a place name, stop and add a config key.
2. **Absent config ⇒ byte-identical output.** Every new key must default to exactly the previous
   behaviour. This is what makes the gates meaningful and what lets the portal trust the engine.
3. **Overrides are Tier-1 data, never hand-edited SVG.** Adjustments live in `overrides.json` and
   are re-applied on every regenerate. A hand-edited SVG is lost at the next build.
4. **No network at render time.** The generators read only files in the run folder. The portal
   depends on this absolutely — it renders untrusted customer edits on a server.
5. **Deterministic output.** No timestamps, no `Math.random`, no locale- or filesystem-order
   dependence in the SVG. Byte-identical means byte-identical.
6. **Env contract is fixed:** `LEAFLET_DIR` (data folder; **preferred over cwd**), `SKILL_ASSETS`
   (where `icons.js` resolves from), `OVERRIDES_FILE` (customer edits; absent/empty ⇒ baseline),
   `EDITOR_KEYS`. The portal sets all of these. Don't add a new env var without updating
   `docs/DEVELOPING.md` in the portal repo.
7. **`gen_internal.js` is shared with the place skill** and with the schematic/diagram pre-stages.
   A change to it affects five outputs, not one. See `make-place-bus-leaflet/references/internal-reuse.md`.

## 2. The byte-identical gate (the town side)

**Harness:** `%SK%\gate.sh <genfile> <S4-datadir> internal|external <committed_svg>`
It copies the data `*.json` + `icons.js` + the candidate generator into a temp dir, runs it, and
diffs the SVG against the committed one. Exit 0 = PASS.

Run it with **no `overrides.json` and no `EDITOR_KEYS`/`OVERRIDES_FILE`** — the gate proves the
*baseline* is unchanged.

**Gate the TEMPLATE, not the town's frozen copy.** Each town's `S3-config\<ts>\` and
`S4-generate\<ver>\` folders hold a *copy* of the generator taken when that run was made. Gating a
town against its own copy is circular — it passes by construction, because that copy is literally
what drew the SVG. The gate that means something is **`%SK%\gen_internal.js` + the town's S4 data +
no overrides == that town's committed SVG**, and that is what the table below asserts.

(Both runs are worth doing when you are diagnosing: *own copy* PASS + *template* DIFF says
"the shipped map is intact, the town is just behind the template". *Own copy* DIFF means the
data or the committed SVG has been tampered with — a different and more serious problem.)

**Current gate set** — every built town, internal *and* external (14 runs), all PASS as of
2026-08-03:

| Town | Latest S4 | External generator |
|---|---|---|
| St Ives | `v6.14_2026-08-03_1440` | **radial** (was busway through v6.8) |
| March | `v2.2_2026-08-03_1446` | radial |
| Huntingdon | `v3.2_2026-08-03_1452` | radial |
| Wisbech | `v1.2_2026-08-03_1724` | radial |
| St Neots | `v2.2_2026-08-03_1728` | radial |
| Beaconsfield | `v1.2_2026-08-03_1736` | radial |
| High Wycombe | `v2.2_2026-08-03_1741` | radial |

> **2026-08-03.** `gen_external_radial.js` (and the place skill's `gen_external_places.js`) gained an
> opt-in `minutesToDestination` time label under the destination box, plus `gtfs_build.py` gained
> `arrival_time`/`departure_time` columns and a new `gtfs_duration.py` derives the minutes from them
> (plan #3 of the 2026-08-03 five-feature plan). All 7 built towns' external + all 5 built places'
> external gated PASS before shipping, then **every built town was rolled out** with real
> `minutesToDestination` data (all a minor bump, engine/geometry unchanged): St Ives v6.14 (10/11
> spokes; only the DRT-only VL14 stays absent), March v2.2 (7/7), Huntingdon v3.2 (9/10; 401->Spaldwick
> absent — no sampled trip reaches a distinct Spaldwick stop), Wisbech v1.2 (12/12 — see the
> route-key-vs-GTFS-short-name gotcha below), St Neots v2.2 (7/10; 69/112/193 absent — confirmed
> "Ivel Sprinter (community)" operators, not in BODS), Beaconsfield v1.2 (7/8; 380->Holtspur & Loudwater
> absent — neither of the route's 2 GTFS trips reaches that stop) and High Wycombe v2.2 (19/20;
> 333->Speen absent — its only sampled trip is the return leg). Buckinghamshire's `buckinghamshire.sqlite`
> (used by Beaconsfield/High Wycombe) was rebuilt too, and `gtfs_duration.py` gained `--near lat,lon,km`
> since those two towns have no clean ATCO prefix (same trap as `gtfs_query.py`'s `town_prefixes.json`
> entries for them). A real bug was caught and fixed mid-rollout: the first "majority terminus" fallback
> (for single-arm routes whose GTFS name doesn't say the destination town) blended St Ives' two
> `301`-numbered arms into one wrong value — `allow_majority_fallback` now only applies when a route
> number has exactly one spoke in that town. See [s3-config.md](s3-config.md)
> `external[].minutesToDestination` for the full gotcha list (route-key-vs-short-name mismatches,
> round-trip/circular services, thin samples).

**Gate each town with the external generator it actually uses.** As of 2026-08-03 **no town uses `gen_external_busway.js` any more** — St Ives switched to radial (v6.9) with an `externalHubLabel` combining its Bus Station and Park & Ride into one hub, because Peter didn't want the two-hub busway layout. `gen_external_busway.js` is kept in `assets/` **unedited** and untested-by-gate for any future town that needs two genuinely separate, physically-distant hubs — re-add a row here if one adopts it.

> **2026-07-28 (P4).** Three `gen_internal.js` changes shipped with the High Wycombe v2.1 rebuild:
> `coreBox.minRun` (drop orphan stubs), `internalTitleColor`, and a **terminus badge-row frame
> clamp**. The first two are config-gated, so nothing else moved. The clamp is not: a terminus row
> is centred on `bx` and spreads `(n-1)/2 × 6.6 mm` each way, and only the centre was being clamped,
> so any multi-badge row near the frame ran off it — St Ives' 2-badge "to Cambridge" row by 1.7 mm,
> the Beaconsfield Waitrose and St Neots Town Centre place rows by ~8 mm into the panel column.
> Fixing it moved those three shipped outputs, so all three were re-rendered the same day
> (**St Ives v6.8**, **Beaconsfield Waitrose v1.1**, **St Neots Town Centre v1.3**) and the whole
> set is back to green: 14/14 towns, 4/4 place fixtures, St Ives schematic + diagram.

> **RESOLVED 2026-07-28.** This box used to record three standing RED internal gates (St Ives,
> March, Huntingdon), left behind by the accepted St Neots v2.x improvements. Those three towns were
> re-rendered the same day, and the whole set has been **14/14 PASS** ever since — re-verified as the
> before-baseline of the P2 corridor-bundling work. **Still take your own baseline before editing**;
> that is the habit the box was really for, and the cost is one command.

**The other four gates a `gen_internal.js` change must clear**, beyond the 14 above — it draws six
outputs, not two (verified 2026-07-28 for P2):

| Gate | How |
|---|---|
| 4 place fixtures | `gate.sh` against `…\Buses\Areas\*\Places\*\S4-generate\<latest>` — currently `Beaconsfield Simpson Centre v1.0`, `Beaconsfield Waitrose v1.1`, `St Neots Tesco Extra v1.2`, `St Neots Town Centre v1.3` |
| St Ives schematic | run `schematize_internal.js` in a copy of the S4 dir, diff `internal-schematic.svg` |
| St Ives diagram | run `diagram_internal.js` likewise, diff `internal-diagram.svg` |

**The portal's place fixture goes stale the same way a town does — and it is easier to miss.**
`gate the TEMPLATE, not the town's frozen copy` (§ above) applies to `PLACE_FIXTURE_DIR` too. The
portal reproduces a place leaflet using the generator **vendored into `engine/place/`**, and compares
it against a **frozen fixture** in `…\Buses\Places\_portal-fixture\`. If the vendored engine and the
fixture were frozen at the same moment, `npm run verify:place` passes **by construction** and keeps
passing however far the skill moves on. That is exactly what happened: on 2026-08-02 the fixture was
swapped from `Beaconsfield Simpson Centre` (v1.0, 2026-07-21) to `High Wycombe Aldi` (v1.1,
2026-07-30) and the internal SVG missed by 189 bytes — `engine/place/gen_internal.js` turned out to be
**445 lines behind**, predating the whole complexity-triage ladder. The gate had been green for weeks.

So: **whenever you re-vendor, also refresh the fixture to the newest available build**, and treat a
fixture swap as a test of the vendor chain rather than housekeeping. A fixture older than the last
engine change proves nothing.

The place fixtures **legitimately differ on exactly two lines** — the title (`Buses within X` vs
`Buses serving X`) and the `· Map v…` stamp — because `build_internal_place.js` post-edits both after
running the generator. So the place gate is "**4 differing lines, 0 outside `y="16"` and `y="208"`**",
not zero. Filter before judging, or you will chase a diff that has always been there:

```
diff new.svg shipped.svg | grep '^[<>]' | grep -v 'y="16"\|y="208"'   # must be empty
```

(The older docs say "the 4-way gate: St Ives + March". That was the gate set when there were two
towns. It has grown with every town — gate them all; the whole point is that a template change is
invisible to towns that didn't ask for it.)

**No town carries functional generator deltas any more** (verified 2026-07-28). Every town-specific
thing lives in `routes.json`, per invariant 1, so "re-deriving a town's copy" is now just *copy the
current template in*. The delta list in `overrides.md` §4 describes an era before those literals
migrated into config; treat it as history, not as a checklist.

### 2a. A template improvement leaves already-built towns STALE — and that is the normal state

The gate failing after a deliberate improvement does **not** mean the town is broken. It means the
town has not been re-rendered since. Before item 3 (2026-08-04) a build pulled its generator from its
**S3 run**, not from `%SK%`, so a town frozen at an old S3 kept drawing with the old engine
indefinitely — the shipped JPG and the code drifted apart silently and nothing complained. **Item 3
removed the freeze**: S3 no longer carries a generator copy at all, S4 always copies the two
generators fresh from the live `%SK%` template and stamps the hash it used into `routes.json`'s
`"engine"` field (`engine_version.js`, provenance only — see [s3-config.md](s3-config.md)). So a town's
*next ordinary build* is automatically current; staleness now only describes a town that hasn't been
**rebuilt at all** since an engine change, not one running old code by construction.

So a template change still has **two** halves, and the second is still easy to forget:

1. Prove the change (`node "%SK%\status.js"` gates every town; the affected ones will legitimately DIFF).
2. **Re-render every town the change affects** so code and shipped maps agree again — `node "%SK%\rollout.js" --all --apply` (or `--town "<Town>"` for one), or by hand below.

**How to re-render a town for an engine change only** (no data change) — the whole point of item 3 is
that this needs only a **new S4**, not a new S3 (routes.json/overrides.json are unchanged, and S3 no
longer holds anything to re-copy):

```
S4=$(stage.js new S4 --bump minor); cd "$S4"
stage.js pull S2 .; stage.js pull S3 .        # data unchanged; also syncs the version stamp
cp %SK%/gen_internal.js .                     # generator = the CURRENT TEMPLATE, copied fresh
cp %SK%/gen_external_{radial|busway}.js gen_external.js
node %SK%/engine_version.js --stamp routes.json
node gen_internal.js; node gen_external.js    # + schematize_internal.js / diagram_internal.js if configured
stage.js commit S4 --outputs internal.svg,external.svg[,...] --note "adopt current engine template: <what changes>"
# then S5 render, then refresh_latest.js
```

(`rollout.js` does exactly this sequence automatically — prefer it over the manual steps above.)

**A new S3 run does NOT force a `--bump major`, and after item 3 an engine-only rollout has no new S3
run to force one anyway.** §"Stage 4" in `s4-s5-build-and-render.md` used to read "major if you
produced a new S1/S2/S3 run" — the rule that has actually been followed since v6.2 is **major = new
*data* (S1/S2); minor = config- or engine-only re-gen**. Config/engine-only re-renders are **minor**.

**Pre-item-3 towns still work unchanged.** A town whose S3 predates 2026-08-04 still has a generator
copy sitting in it; that copy is simply never read any more (S4 always copies fresh from `%SK%`
regardless of what's in S3), so nothing breaks — it's just now dead weight in that folder. Its
`routes.json` will read `engine: (none)` in `status.js` until its *next* S4 build stamps it, which is
expected and not itself a problem to fix.

**Before you re-render, diff the label sets, not just the byte count.** A placement change can
silently drop or surface a label, which is a content change hiding inside a "cosmetic" diff:

```
grep -o '>[^<>]*</text>' old.svg | sed 's/^>//;s|</text>||' | sort > /tmp/a
grep -o '>[^<>]*</text>' new.svg | sed 's/^>//;s|</text>||' | sort > /tmp/b
comm -23 /tmp/a /tmp/b   # LOST     <- read every line before shipping
comm -13 /tmp/a /tmp/b   # GAINED
```

For the schematic and diagram outputs, gate St Ives v6.6 (`internal-schematic.svg`,
`internal-diagram.svg`) the same way — run the pre-stage, then diff.

## 3. The place side

`make-place-bus-leaflet` reuses `gen_internal.js`, `render.js`, `stage.js`, `gtfs_query.py` and
`icons.js` **unchanged**. If your change touches any of them, also rebuild a place fixture and diff.
Worked places on disk: `…\Buses\Areas\St Neots\Places\St Neots Tesco Extra`, `St Neots Town Centre`,
`Beaconsfield Waitrose`, `Beaconsfield Simpson Centre`. The portal's fixture is
`…\Buses\Places\_portal-fixture`.

## 4. The portal hand-off — a generator change is NOT done until this is done

The portal (`C:\Claude\community-bus-maps`) holds **byte-for-byte copies** of some engine files. It
does not import them from the skill; it vendors them. A skill-side change leaves the portal running
the old code, and its gates will keep passing against the *old* shipped fixture until you re-vendor.

| Skill file | Portal destination |
|---|---|
| `%SK%\icons.js`, `%SK%\render.js` | `engine\` |
| `%SK%\gen_internal.js` | `engine\place\` |
| `%PSK%\gen_external_places.js` | `engine\place\` |
| `%SK%\schematize_internal.js`, `%SK%\diagram_internal.js` | `engine\expert\` |

**Area (town) generators are NOT in this table** — `gen_internal.js`/`gen_external_*.js` for an area
map are copied straight into that map's own `data/maps/<id>/data/` by the portal's
`scripts/import-map.mjs`, from whatever `--src` was used at import time, not from `engine/`. So an
existing area map (St Ives, March, …) stays on whatever generator it was imported with, same as a
town in this repo stays on whatever its own S3 run committed — re-importing (or manually refreshing
that map's `data/maps/<id>/data/gen_*.js`) is the only way an already-built area map picks up a
skill-side change. **If you're live-verifying a change by clicking through the portal against an
existing demo area map, check that map's own generator copy first** — a stale one will silently no-op
the new behaviour even though the sanitize/validation layer accepts it fine, which reads exactly like
a bug in the new feature until you notice the file predates your change (caught 2026-08-03 verifying
`hiddenOperators` against March's demo map).

**Procedure after any change to a file in that table:**

1. Pass all the town gates in §2 first. Don't propagate a change that hasn't been proved locally.
2. Copy the changed file(s) verbatim to the portal destination.
3. In the portal, set `FIXTURE_DIR` and `PLACE_FIXTURE_DIR` in `.env` (git-ignored) to point at the
   staged fixtures in the Buses repo.
   **`npm run verify` exits 0 with "skipping" if they are unset — a green run then proves nothing.**
4. Run, and require all to pass:
   ```
   npm run verify:area
   npm run verify:place
   npm run test:p7
   npm test
   ```
5. If a gate now legitimately fails because the *output changed on purpose*, the shipped fixture is
   stale: re-render the fixture town/place from the new engine, re-import it, and record why in the
   portal `CHANGELOG.md`. Never edit a gate's expectation to make it pass.
6. Commit **both** repos in the same session — the skills repo (`C:\u3a St Ives\.claude\skills`) and
   the portal — and note the pairing in each commit message.

> ### ⚠ OPEN DRIFT: `gen_internal.js` is skill-ahead of the portal (since 2026-07-28, P2)
> The rung-1 `internalCorridors` change has **not** been re-vendored to
> `community-bus-maps\engine\place\gen_internal.js`. That is deliberate — the complexity-triage plan
> puts all portal work in its own phase (P6) — and it is safe, because the key is opt-in and the
> skill's own 14-run gate proves the absent-key output is byte-identical, so the portal's shipped
> fixtures are unaffected. But `cmp` **will** report this row as drifted until P6 copies the file
> across and re-runs `npm run verify:place`. It is a pending step, not a discovery.

**The `LEAFLET_DIR` trap.** `gen_internal.js` prefers `LEAFLET_DIR` over cwd. A pre-stage spawns it
with cwd = the workspace and an inherited environment — so an inherited `LEAFLET_DIR` sends the
render back to the parent folder and silently reproduces the ordinary geographic map instead of the
schematic/diagram. The portal wrappers delete it for the child; the skill's own invocation must run
**without `LEAFLET_DIR` set**. If a schematic or diagram comes out looking like the plain internal
map, this is why.

## 5. Finishing the session

Per the standing review step in `SKILL.md`:
- Fold anything that tripped you up into `gotchas.md` (or the relevant stage reference).
- If the change altered the duplication picture, update the duplication map in
  `…\Buses\Documentation\README - How to enhance the system.md` **and** this file's §4 table.
- Commit every repo you touched. Parts 1 and 2 have no remote — an uncommitted change is one disk
  failure from gone.

## 6. Known rough edges

The duplication in §4 is manual and has no automated drift check: nothing fails if the portal's
vendored copy diverges from the skill's. A written proposal to fix it is at
`…\Buses\Development Docs\engine-deduplication-proposal_2026-07-25.md`. Until it is actioned, §4 **is** the
mechanism — follow it every time.

A one-line drift check over the §4 table is worth running whenever you open this doc:

```
cmp -s "%SK%/<file>" "<portal dest>/<file>"   # per row; silence == in sync
```

**Drift found and RESOLVED, 2026-07-28.** `engine/expert/diagram_internal.js` had gone *portal-ahead*:
the portal's copy wrote a `wll` field (workspace lat/lon per solved junction) into
`solved-nodes.json` that the skill's copy did not, added during P7 for the admin pin editor
(`src/expert/index.js`), which needs it to line its handles up with the sheet. Back-ported to the
skill; the two files are byte-identical again (46,996 bytes) and **all six rows of the §4 table were
verified in sync**.

Two things that made the back-port safe to do by straight copy, and are worth repeating next time:

- **The change was confined to one block.** `diff` showed exactly two hunks, and both helpers it
  calls (`INV`, `rll`) already existed in the skill's copy, so `cp portal skill` back-ported the
  intended change and nothing else. Check that before copying a whole file in either direction.
- **`solved-nodes.json` is an editor sidecar, not a drawing input.** The block writes it after the
  SVG work is done, so the field is genuinely SVG-neutral. Proven rather than assumed: St Ives
  v6.7's `internal-diagram.svg`, `internal-schematic.svg` **and** `internal.svg` all re-hashed
  byte-identical, only `diagram/solved-nodes.json` changed (25/25 entries gained `wll`), and the
  14-run gate set stayed 14/14. Sanity-check the values land in the **workspace** coordinate space,
  not real lat/lon — St Ives' are ~±0.01, inside the workspace `atco2ll.json` range, which is the
  point of the field.

**A portal-ahead drift is the easy one to miss**, because the skill's own gates all pass — the
skill is self-consistent, it is simply behind. Only the `cmp` over the §4 table catches it, so run
that check whenever you open this doc, not just after you change something.

> **Caveat on that `cmp` — the two repos disagree about line endings** (noted 2026-07-28, not fixed).
> The skills repo has `core.autocrlf=true` and **no `.gitattributes`**; the portal has
> `core.autocrlf=false` plus `.gitattributes` `* text=auto eol=lf`. Both *store* LF, and both
> working copies are LF today, so `cmp` is honest right now. But a **fresh clone or checkout of the
> skills repo writes CRLF** into the working tree (~970 CRs in this file alone) while the portal's
> stays LF — after which `cmp` reports **every row of §4 as DRIFTED** when nothing has actually
> diverged. Don't react to that by copying files around; confirm with
> `diff <(tr -d '\r' < a) <(tr -d '\r' < b)` first. The clean fix is to give the skills repo the
> same `.gitattributes` as the portal, but that renormalises every tracked file, so it is Peter's
> call, not a side effect of an engine change. (Source line endings do **not** affect generator
> output — the SVG writers emit `\n` from string literals — so the byte-identical gates are
> unaffected either way.)
