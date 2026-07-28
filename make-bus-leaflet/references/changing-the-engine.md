# Changing the engine safely — the invariants, the gates, and the portal hand-off

Read this **before editing any file in `assets/`**. The stage references (`s1-services.md` …)
tell you what each stage does; this one tells you what must remain true when you change the code
that does it, and what else has to be updated in the same session.

`%SK%` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`
`%PSK%` = `C:\u3a St Ives\.claude\skills\make-place-bus-leaflet\assets`

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

Each town keeps **its own copy** of the generator (current template + that town's small deltas), so
the gate is always *town's copy + town's S4 data + no overrides == that town's committed SVG*.

**Current gate set** — every built town, internal *and* external (12 runs):

| Town | Latest S4 |
|---|---|
| St Ives | `v6.6_2026-07-10_1523` |
| March | `v2.0_2026-07-12_1926` |
| Huntingdon | `v3.0_2026-07-12_2139` |
| Wisbech | `v1.0_2026-07-13_1205` |
| St Neots | `v2.1_2026-07-20_2056` |
| Beaconsfield | `v1.1_2026-07-21_1614` |
| High Wycombe | `v1.0_2026-07-28_0051` |

**Gate each town with the external generator it actually uses** — St Ives is the only **busway** town (`gen_external_busway.js`); every other town is **radial**. Gating St Ives against the radial file reports a meaningless DIFF.

(The older docs say "the 4-way gate: St Ives + March". That was the gate set when there were two
towns. It has grown with every town — gate them all; the whole point is that a template change is
invisible to towns that didn't ask for it.)

**When you change the template you must also re-derive each town's copy** — re-apply that town's
deltas onto the new template, then gate. Known deltas are listed in `overrides.md` §4.

For the schematic and diagram outputs, gate St Ives v6.6 (`internal-schematic.svg`,
`internal-diagram.svg`) the same way — run the pre-stage, then diff.

## 3. The place side

`make-place-bus-leaflet` reuses `gen_internal.js`, `render.js`, `stage.js`, `gtfs_query.py` and
`icons.js` **unchanged**. If your change touches any of them, also rebuild a place fixture and diff.
Worked places on disk: `…\Buses\Places\St Neots Tesco Extra`, `St Neots Town Centre`,
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
  `…\Buses\README - How to enhance the system.md` **and** this file's §4 table.
- Commit every repo you touched. Parts 1 and 2 have no remote — an uncommitted change is one disk
  failure from gone.

## 6. Known rough edge

The duplication in §4 is manual and has no automated drift check: nothing fails if the portal's
vendored copy diverges from the skill's. A written proposal to fix it is at
`…\Buses\engine-deduplication-proposal_2026-07-25.md`. Until it is actioned, §4 **is** the
mechanism — follow it every time.
