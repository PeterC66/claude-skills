# Playbooks — one per worklist item type

The operative content of runbooks R1–R4 and Pol1, inlined so nobody has to open them mid-job. Where this file and a runbook disagree, the runbook in `community-bus-maps/docs/` is authoritative — and fix this file in the same session.

Paths used below:

- `PORTAL` = `C:\Claude\community-bus-maps`
- `SK` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`
- `BW` = `C:\u3a St Ives\.claude\skills\bus-work\assets`

---

## `gate` — a byte-identical gate is failing

Nothing else on the list matters while this is true: the engine no longer reproduces a map that was already shipped, so any delivery could ship a silently different sheet.

1. Reproduce it in isolation: `node "%SK%\status.js"` (in `SK`) and read which town/place/portal fixture, and whether it's `internal`, `external` or the portal vendoring row.
2. **Portal vendoring row failing** = a generator was improved in the skills tree and never re-copied into `community-bus-maps/engine/`. Re-vendor that one file, then re-run the portal's own gates: `npm test` and `npm run verify` (both must PASS with byte counts).
3. **A town failing** = the engine changed behaviour for real. That is either an intended change (roll the towns forward — see the `housekeeping` playbook) or a regression (fix the generator).
4. Never relax the gate, never regenerate the reference to match. If `verify` reports the SVG differs by a few hundred bytes, suspect a lost `stamp: false` in the verify scripts before suspecting the generator.

---

## `review` — a publish request is waiting (the third approval gate)

**Peter decides. Never approve or send back on his behalf.** What this skill does is make the decision cheap.

1. Open `/app/review`. Summarise for him, from the queue entry: which map, which customer, which version, and the **change summary** — because the editor can only recolour routes and show/hide POIs, that diff is *complete*; nothing else can have moved.
2. Remind him the checklist is five items, all server-enforced: **services · colours · pois · legible · accurate**. Item 4 means actually opening the full-size JPG, not trusting the preview.
3. Say plainly what it is *not*: a re-derivation of the routes from source data. It is a reasonableness check. Independent verification is S6, upstream.
4. Pilot note worth raising once, for the **first genuine customer map**: every published sheet carries the red PILOT — SAMPLE MAP band, and its wording ("Not published by any organisation") is wrong for a real customer. That's an edit in `src/config.js`, decided before sign-off, not after.
5. Outcome is his: **Publish** (sets the public-current pointer; never re-renders) or **Send back** (reason required, editing unlocks).

---

## `application` — an organisation wants to join

Also Peter's decision. Prepare it:

1. Summarise each applicant: name, type, contact, what they say they want.
2. Check against the vetting policy and flag anything that trips it: no evident connection to the area or place; commercial use implying council/operator endorsement; a request that only makes sense as automated any-town coverage; anything putting personal data on a public page.
3. State the default quota that will be applied — **1 area + 3 places** — and whether this applicant is an obvious case for more (e.g. a district council covering several parishes). Raising it needs a recorded reason.
4. He approves or rejects in **Admin → Applications**. Approval creates the customer, its first editor user, and issues a passwordless invite.

---

## `request-decision` — a customer asked for a map

Approval is the **quota gate**, so it comes before any building.

1. Show him: which customer, area or place, the subject, their note, and their current quota usage.
2. Check the subject is one we can actually build — is it in a GTFS region we have, is it a place with real bus stops near it, is it RED-band complexity.
3. He approves in **Admin → Map requests**. The row then appears on the worklist as a `build` item — that is the handover.
4. If it should not be built, rejecting/archiving the row frees the quota slot.

---

## `build` — an approved request with no map yet (R1)

The whole point: **the approved request row *becomes* the built map.** One row, quota counted once, no placeholder to tidy.

### 1. Make the map

Run the right skill for the item's `kind` — `make-bus-leaflet` (area) or `make-place-bus-leaflet` (place) — for the item's `subject`. Let it run S1 → S6 properly; this is the judgement half and it is not to be short-cut. Keep the verification `.docx` with the job: it is the red-team evidence.

**Area maps only:** run `node "%SK%\refresh_latest.js"` for the town before importing, so `_latest\disagreements.pdf` exists — the importer auto-detects it from there, and without it the map imports with no customer-facing disagreements PDF.

### 2. Import it

Stop the dev server first (the importer writes). Then, in `PORTAL`:

```powershell
node scripts/import-map.mjs --request <id> --src "<the S5-render dir>"
```

In `--request` mode only `--src` is required — owner, kind, name, slug and subject come from the request. `--name` / `--slug` / `--subject` still override, which is how you correct "Seam Village" to "Seam Village, Cambs" at build time.

It refuses, before touching anything, if:

| Refusal | What it means |
|---|---|
| the request is still `requested` | approval is the gate — it must be approved first |
| the map is already built | new data for a built map is a `refresh`, not an import |
| `--kind` differs from the request | quota is per kind; reject and re-request rather than repurpose the row |
| `--customer` names a different org | re-owning someone's map is not an import job — drop the flag |
| the slug belongs to another map | pick another `--slug` |

### 3. Verify the baseline is byte-identical

The entire system rests on v1.0 == the shipped leaflet.

```powershell
$env:FIXTURE_DIR = "<the S5-render dir>"; npm run verify:area
```

(place maps: `$env:PLACE_FIXTURE_DIR = "…"; npm run verify:place`)

**PowerShell form matters.** `npm run verify` **skips silently** when its fixture dir is unset, and bash's `FIXTURE_DIR=… npm run …` prefix does not set one in PowerShell — so run the bash way on this machine, the byte-identical check never runs and looks like it passed. R1 documented the bash form until 2026-08-07 and is now corrected; if you ever see it back, that is a regression. A run that doesn't print PASS *with byte counts* has proved nothing. If it genuinely fails, stop and check the `sharp`/libvips version against the desktop pipeline before anything else.

### 4. Hand over

Open `/app/maps/<id>` as admin and set which of the four outputs the map offers (v1.0 renders internal-geographic + external by default; the two expert styles are opt-in, and the diagram is request-only for customers). The map is a **draft** — it reaches the public only through the publish gate.

### Rollback

Pre-publish, the object store and v1.0 are disposable: delete the map row and its `maps/<id>/` dir, then re-import. A fulfilled request is an ordinary map by then, so redoing it means re-importing fresh with `--customer` — the request row is gone, it *is* the map. **Never** hand-edit a rendered file.

---

## `refresh` — a portal map whose services are changing (R4)

1. **Regenerate centrally.** Re-run the map's own skill for the town/place to produce a fresh S5-render dir. Same making step as a build, for an existing map. The worklist item's note carries the specific upcoming changes from the BODS scan — use them to check the regenerated data actually reflects them.
2. **Stage it** (dev server stopped), in `PORTAL`:

```powershell
node scripts/propose-update.mjs --map <slug> --src "<fresh S5-render dir>" --note "BODS <date> refresh"
```

It stages *beside* the live map and never touches it, computes a plain-language service-facts diff (routes added/removed, descriptions, stops, operators, validity dates) and prints it. **Read that diff** — it is the sanity check that the regeneration did what the scan said it would.

3. **It is then the customer's move**: they see an old-vs-new preview and Accept (their colours + POI toggles re-applied onto the fresh data as a new major version, which then goes through review) or Decline. Accepting is blocked while a publication awaits review.
4. Refusals worth knowing: a newer refresh **supersedes** any still-pending one (one open per map); the script refuses if the map has no built data yet ("nothing to refresh" — build it first); don't stage a no-op if the diff says nothing changed.
5. If the item said "not yet flagged in the portal", run `npm run check-upcoming` in `PORTAL` once so the refresh-flag is recorded in the admin Messages inbox.

---

## `refresh-local` — a town leaflet with no portal map

Same regeneration, no portal step. These towns are printed sheets used outside the portal, so nothing else flags them going stale.

1. Re-run `make-bus-leaflet` for the town, S1 → S5.
2. `node "%SK%\refresh_latest.js"` so `_latest\` carries the new version.
3. Commit the town's new run in the Buses repo. Note the version bump and what changed.

---

## `housekeeping` — engine-stale renders, missing S6

### Engine-stale

The town's shipped build was drawn by an older engine template. Harmless — it is not wrong, just not current — so this is opportunistic work, and it self-heals on the town's next real build. Do it deliberately when the current look matters or before a batch of deliveries.

```powershell
node rollout.js --all           # dry run: what would change
node rollout.js --all --apply   # writes; one commit per town, minor version bump each
```

(run in `SK`; `--town "St Ives"` for one town). It creates a new S4 from the current template with the config unchanged, diffs the label set against the previous build, renders S5 and refreshes `_latest`. **It stops before publishing if a label was lost** — that is a real signal, not a nuisance; review the loss rather than reaching for `--force`.

### S6 missing or stale

S6 is the independent, antagonistic verification pass — a cross-model red-team that re-derives the services from scratch and is diffed against ours. It is what catches the worst class of error: a route we still draw that no longer runs.

- Run it one town at a time via `make-bus-leaflet` stage S6.
- Its findings are **HARD** (blocks) or **SOFT** (logged). A HARD finding needs a human call against the cited sources before any upstream stage is re-run — don't silently "fix" it, and don't batch four towns' findings into one decision.
- Expect BLOCKED results on towns that have never had it. That is the tool working.

---

## `awaiting-customer` — staged, they haven't accepted

Not your work. Two cases:

- **Recent** — nothing to do. Don't chase.
- **Sat for two weeks or more** — their published map is going stale while they don't act. A nudge by email, naming the map and what changed. Record that you nudged.

If it stays unaccepted, it stays unaccepted: the customer owns their published map, and re-proposing next month is a normal outcome, not a failure.
