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

**Gate the TEMPLATE, not the town's frozen copy.** Each town's `S3-config\<ts>\` and
`S4-generate\<ver>\` folders hold a *copy* of the generator taken when that run was made. Gating a
town against its own copy is circular — it passes by construction, because that copy is literally
what drew the SVG. The gate that means something is **`%SK%\gen_internal.js` + the town's S4 data +
no overrides == that town's committed SVG**, and that is what the table below asserts.

(Both runs are worth doing when you are diagnosing: *own copy* PASS + *template* DIFF says
"the shipped map is intact, the town is just behind the template". *Own copy* DIFF means the
data or the committed SVG has been tampered with — a different and more serious problem.)

**Current gate set** — every built town, internal *and* external (14 runs), all PASS as of
2026-07-28:

| Town | Latest S4 | External generator |
|---|---|---|
| St Ives | `v6.7_2026-07-28_0459` | busway |
| March | `v2.1_2026-07-28_0457` | radial |
| Huntingdon | `v3.1_2026-07-28_0457` | radial |
| Wisbech | `v1.1_2026-07-28_0459` | radial |
| St Neots | `v2.1_2026-07-20_2056` | radial |
| Beaconsfield | `v1.1_2026-07-21_1614` | radial |
| High Wycombe | `v1.0_2026-07-28_0051` | radial |

**Gate each town with the external generator it actually uses** — St Ives is the only **busway** town (`gen_external_busway.js`); every other town is **radial**. Gating St Ives against the radial file reports a meaningless DIFF.

> ### ⚠ THREE INTERNAL GATES ARE CURRENTLY RED — this is pre-existing, not your change
> Verified 2026-07-28. Run the internal gate today and **St Ives, March and Huntingdon DIFF against
> the current `gen_internal.js`**. Establish this baseline **before** you edit anything, so you can
> tell your diff from the standing one:
>
> | Town | Standing diff |
> |---|---|
> | St Ives | terminus tail label `x` 42.13 → 43.23; a shared "to Cambridge" label `#333` → `#111` |
> | March | terminus tail label `x` 189.14 → 188.04 |
> | Huntingdon | ~1438 lines — road skeleton `#888888`/1.6 → `#333333`/1.5, plus road-segment split differences |
>
> These look like the **deliberately accepted** St Neots v2.0/v2.1 improvements (black shared
> terminus labels, `minSegLen` railway declutter, `reachExtend` tail handling) and the High Wycombe
> work, with those three towns simply never re-rendered since. Wisbech, St Neots, Beaconsfield and
> High Wycombe pass.
>
> Per rule 5 in §4 below, the fix is to **re-render the three towns as minor bumps** so the shipped
> fixture matches the intended output — never to edit the generator back. Until that happens, gate
> those three by **diffing your change against this recorded baseline**, not against zero.

(The older docs say "the 4-way gate: St Ives + March". That was the gate set when there were two
towns. It has grown with every town — gate them all; the whole point is that a template change is
invisible to towns that didn't ask for it.)

**No town carries functional generator deltas any more** (verified 2026-07-28). Every town-specific
thing lives in `routes.json`, per invariant 1, so "re-deriving a town's copy" is now just *copy the
current template in*. The delta list in `overrides.md` §4 describes an era before those literals
migrated into config; treat it as history, not as a checklist.

### 2a. A template improvement leaves already-built towns STALE — and that is the normal state

The gate failing after a deliberate improvement does **not** mean the town is broken. It means the
town has not been re-rendered since. A build pulls its generator from its **S3 run**, not from
`%SK%`, so a town frozen at an old S3 keeps drawing with the old engine indefinitely — the shipped
JPG and the code drift apart silently and nothing complains.

So a template change has **two** halves, and the second is easy to forget:

1. Prove the change (gate every town; the affected ones will legitimately DIFF).
2. **Re-render every town the change affects** so code and shipped maps agree again.

**How to re-render a town for an engine change only** (no data change) — worked four times on
2026-07-28:

```
S3=$(stage.js new S3)                 # new S3 run, seeded from the previous one
cp <prev S3>/routes.json  "$S3"/      # config unchanged...
cp %SK%/gen_internal.js   "$S3"/      # ...generator = the CURRENT TEMPLATE
cp %SK%/gen_external_{radial|busway}.js "$S3"/gen_external.js
stage.js commit S3 "$S3" --outputs routes.json,gen_internal.js,gen_external.js --note "adopt current engine template: <what changes>"
S4=$(stage.js new S4 --bump minor); cd "$S4"; stage.js pull S2 .; stage.js pull S3 .
node gen_internal.js; node gen_external.js   # + schematize_internal.js / diagram_internal.js if configured
stage.js commit S4 ... ; then S5 render ; then refresh_latest.js
```

**A new S3 run does NOT force a `--bump major`.** §"Stage 4" in `s4-s5-build-and-render.md` reads
"major if you produced a new S1/S2/S3 run", but the rule that has actually been followed since v6.2
is **major = new *data* (S1/S2); minor = config- or engine-only re-gen**, and every historical minor
bump has its own new S3 run. Config-only re-renders are **minor**.

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

## 6. Known rough edges

The duplication in §4 is manual and has no automated drift check: nothing fails if the portal's
vendored copy diverges from the skill's. A written proposal to fix it is at
`…\Buses\engine-deduplication-proposal_2026-07-25.md`. Until it is actioned, §4 **is** the
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
