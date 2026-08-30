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
2. Remind him the checklist is **three** items, all server-enforced: **appearance · legible · alternative**. `legible` means actually opening the full-size JPG, not trusting the preview; `alternative` means opening `/m/<slug>/services`, confirming it agrees with the map, and checking the page works from the keyboard. **Read the items from `src/publish/index.js` (`CHECKLIST`/`CHECKLIST_VERSION`), never from memory** — the set was consolidated from six to three and this playbook went on saying "five items — services · colours · pois · legible · accurate" until 2026-08-21, long after the code had moved.
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
cd "C:\Claude\community-bus-maps"
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
| there is no owning organisation | **new 2026-08-30.** A map with `customer_id NULL` is dropped by every PUBLIC query, so it can be submitted, reviewed and published, report `status=published`, and still serve a 404 — St Ives Bus Station did exactly that. In `--request` mode the owner comes from the request and this cannot happen; building a fresh row outside that mode now needs `--customer "Org"`. `--unowned` is the deliberate way past, and the owner can be set afterwards with `POST /api/admin/maps/<id>/owner` from the admin console (admin, needs a sign-in from the last 30 minutes, refuses a move that would overspend the receiving org's quota) |

### 3. Verify the baseline is byte-identical

The entire system rests on v1.0 == the shipped leaflet.

```powershell
cd "C:\Claude\community-bus-maps"
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
2. **Stage it**, in `PORTAL` (`C:\Claude\community-bus-maps`):

   - **Against the live site** (item 4, 2026-08-10): `npm run deliver -- --map <slug> --kind area|place --src "<fresh S5-render dir>" --note "BODS <date> refresh"`. One laptop command — scp's the render to the VPS, verifies it byte-identical *before touching the live service*, stops the portal, runs `propose-update.mjs` inside a throwaway container, restarts, health-checks. Needs `DEPLOY_HOST`/`DEPLOY_SSH_KEY`/`DEPLOY_APP_DIR` in `.env`. `worklist.mjs` prints exactly this form when it's reading the live worklist (`--url`/`BUSMAPS_URL` set).
   - **Against local dev** (dev server stopped): `node scripts/propose-update.mjs --map <slug> --src "<fresh S5-render dir>" --note "BODS <date> refresh"` — same script, run directly, no SSH round-trip.

Either way it stages *beside* the live map and never touches it, computes a plain-language service-facts diff (routes added/removed, descriptions, stops, operators, validity dates) and prints it. **Read that diff** — it is the sanity check that the regeneration did what the scan said it would.

   **Two side effects of the live form, confirmed over a 13-map pass on 2026-08-18.** Each call **emails the customer** an "update is ready" notification, and each call does its own `docker compose stop/start portal`. A one-map refresh is unremarkable; a whole-estate pass means one email and one short outage *per map*, so warn the customer first and don't run it during anything time-sensitive. Windows absolute paths (`C:/u3a St Ives/…`, spaces and all) are fine as `--src` — `scp` handles the drive letter.

3. **It is then the customer's move**: they see an old-vs-new preview and Accept (their colours + POI toggles re-applied onto the fresh data as a new major version, which then goes through review) or Decline. **Accepting is blocked while a publication awaits review** — the accept returns a **409** ("Withdraw that request before accepting an update") until the open publish request is withdrawn, which is a real step and not a tidy-up. Accepting, withdrawing and changing a map's outputs are **HTTP endpoints only** — there is no UI-free CLI for a single one-off action, and it needs a signed-in admin session, so a lone map is browser work (or the admin console's **Refreshes** tab, `/app/admin`, which carries a link plus Accept/Decline buttons — added 2026-08-10, needs a VPS deploy to reach the live site since it's frontend code). **If you're clearing several staged maps at once — e.g. everything an engine upgrade left behind — see the `bulk-accept-publish` playbook below instead of clicking through each one.**
4. Refusals worth knowing: a newer refresh **supersedes** any still-pending one (one open per map); the script refuses if the map has no built data yet ("nothing to refresh" — build it first); don't stage a no-op if the diff says nothing changed.
5. If the item said "not yet flagged in the portal", run `npm run check-upcoming` in `PORTAL` once so the refresh-flag is recorded in the admin Messages inbox.

---

## `bulk-accept-publish` — several staged maps at once (after an engine upgrade or a multi-town rebuild)

The situation this is for: an engine change or a coordinated rebuild (frequency tiers, a new panel, a fixed defect — anything that touches the shared generator) has left a whole batch of maps sitting as staged proposed updates, all needing the same accept → submit → review → publish treatment. Clicking through the UI once per map is what this replaces. **The judgement — is each map actually fit to publish — is not replaced, and never will be by this playbook.**

### 1. Review every sheet at full resolution, before anything is accepted

Don't open the portal for this. `refresh_latest.js` runs as the last step of every S5/P5 build and keeps `Buses\Collected_latests\` current automatically (built 2026-08-08 after two place maps' collected copies went stale against a re-render and the staleness wasn't caught until this existed — see `project_bus_foolproofing_plan.md`). One flat JPG per map per sheet type, no digging into dated `S5-render` folders:

```
Collected_latests\Temp_areas_internal\*.jpg
Collected_latests\Temp_areas_external\*.jpg
Collected_latests\Temp_areas_internal-schematic\*.jpg
Collected_latests\Temp_areas_internal-diagram\*.jpg
Collected_latests\Temp_places_internal\*.jpg
Collected_latests\Temp_places_external\*.jpg
Collected_latests\Temp_places_internal-schematic\*.jpg
```

**Check the file's modified date against the build you're reviewing before trusting it** — that one glance is what would have caught the 2026-08-08 staleness incident, and the collection folder having auto-refreshed since doesn't make the habit optional. What you're looking for is the same class of thing that caught the High Wycombe regression on 2026-08-19: text or icons running off the edge, footer/key collisions, cut-off labels — anything wrong at a glance. A map that fails needs a real fix and a rebuild, the same as any other regression; it does not go into the batch below until it's re-reviewed clean.

### 2. Run the batch, for whichever maps passed

`community-bus-maps/scripts/accept-publish-batch.mjs` (`npm run accept-publish`, PR #54, 2026-08-19) drives withdraw → accept → submit → approve → live-verify against the public API, for a named set of already-staged maps, in one run. Run from `PORTAL`:

```powershell
cd "C:\Claude\community-bus-maps"
npm run accept-publish -- --cookie "<cbm_session value>" --reviewed-by "<your name>" --note "<what this round is>" --yes
```

**The `cd` is not decoration.** `npm` looks for `package.json` in the *current* directory, and there is none in the Buses repo — running this from `C:\u3a St Ives\Using AI\Buses` fails with `ENOENT ... Could not read package.json` and nothing else. It happened on 2026-08-19.

- `<cbm_session value>` — the admin session cookie. Sign in to busmaps.uk as admin, copy it from dev tools (Application/Storage → Cookies), or pass `--mint` instead to have it minted over SSH — same mint-and-revoke pattern as before, **ask Peter's OK each time**, it is not a standing approval.
- `<your name>` — mandatory. This is the record of who did step 1; the script never looks at a rendered sheet itself, so leaving this out (or filling it in without having actually reviewed anything) defeats the one check in this whole process that has caught a real regression before.
- `<what this round is>` — free text, lands in the audit trail on every accept/submit/approve call it makes.
- Add `--only 30,33,37` (the proposed-update `#` ids) to run a subset — e.g. holding one map back that failed step 1 while the rest proceed. Omit it to process everything pending.
- No `--yes` prints the full list and waits for you to type "yes"; add it once you trust the plan without re-reading it printed back.
- `--dry-run` shows the plan with no `--cookie`/`--mint` needed and makes no calls at all — use it to sanity-check `--only` before spending a real session on it.

**It only sees PENDING proposals.** A map whose proposal you accepted by hand is invisible to it from that moment on — the accept leaves a *draft* version, and the batch has nothing left to walk. Beaconsfield sat on the old version in public through the whole 2026-08-19 round for exactly this reason, with nothing flagging it. **Accept by hand and you must publish by hand, in the same breath.** Afterwards, check the count: every map you expected should appear in the summary, and one that is silently absent is this.

**Trust the public API, not the summary line.** The verify step reads `/api/public/maps/<slug>` back; when it says a map failed, confirm before re-running anything, because a broken *check* used to look exactly like a failed publish (fixed in PR #55, but the habit is the point). The quickest independent read:

```powershell
cd "C:\Claude\community-bus-maps"
node -e "fetch('https://busmaps.uk/api/public/maps/<slug>?_='+Date.now()).then(r=>r.json()).then(j=>console.log(j.map && j.map.version))"
```

`<slug>` — the map's public slug, e.g. `wisbech`. Prints the live published version, or `undefined` if the map is not published.

It sends **one digest email per customer** for the whole run (`"N maps published"`) rather than one per map — the fix this script shipped with, after a live `/health?deep=1` read on 2026-08-19 showed all thirteen pilot maps sharing a single customer account, which would otherwise have meant a dozen near-identical emails landing in one inbox from one batch. A per-map failure is logged and the run continues to the next map; an auth failure (401/403) aborts the rest immediately rather than repeating the same failure across every remaining map. It writes a JSON report to `PORTAL\data\accept-publish-reports\` and prints a pass/fail summary — read that summary before calling the round done, same as reading any other gate's actual output rather than trusting a clean exit code.

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
cd "C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets"
node rollout.js --all           # dry run: what would change
node rollout.js --all --apply   # writes; one commit per town, minor version bump each
```

(`--town "St Ives"` for one town; `--place "High Wycombe Aldi"` on `rollout_places.js` for a place. It finds the maps through `--buses`, which defaults to `C:\u3a St Ives\Using AI\Buses`, so only pass that if the tree has moved.) It creates a new S4 from the current template with the config unchanged, diffs the label set against the previous build, renders S5 and refreshes `_latest`. **It stops before publishing if a label was lost** — that is a real signal, not a nuisance; review the loss rather than reaching for `--force`.

### S6 missing or stale

S6 is the independent, antagonistic verification pass — a cross-model red-team that re-derives the services from scratch and is diffed against ours. It is what catches the worst class of error: a route we still draw that no longer runs.

- Run it one town at a time via `make-bus-leaflet` stage S6.
- Its findings are **HARD** (blocks) or **SOFT** (logged). A HARD finding needs a human call against the cited sources before any upstream stage is re-run — don't silently "fix" it, and don't batch four towns' findings into one decision.
- Expect BLOCKED results on towns that have never had it. That is the tool working.

---

## Output toggles — switching a sheet type on for a map

Which sheets a map publishes is `map.outputs`, changed with `PATCH /api/maps/:id/outputs` (browser work, or the map's own page in the portal). Three things about it are not obvious and cost a session's time on 2026-08-18:

- **Send the whole desired set, never a partial one.** `chooseOutputs()` falls any omitted key back to the *shipped default* (geographic on, expert styles off), so patching `{internal_schematic: true}` alone silently switches the other two to their defaults rather than leaving them as they are.
- **An expert style can only be switched on once the map's LIVE data carries its opt-in key.** `resolveGen()` refuses an expert output unless the map's own `routes.json` in its live data dir has the matching truthy key (`internalSchematic`, `internalDiagram`). So if a town's fresh render is what introduces that key, the toggle is **gated on the refresh landing first** — you cannot turn the sheet on in advance, and the API will just report it unavailable.
- **The sheet is probably already rendered.** `internal_schematic` is declared `buildAlways: true`, so the engine renders it into every new version whose data supports it *regardless of the flag* — the flag only controls visibility. Turning it on therefore exposes a file that already exists, with no re-render needed. And turning it on early cannot leak anything, because the public page lists only files actually present in the *published* version's folder.

**Two outputs are request-only**, and `chooseOutputs()` refuses to move either for a non-admin at all: the tube-map diagram (`internal_diagram`), which is hand-finished expert work with a price attached, and the boarding plan (`boarding_plan`, added 2026-08-23), whose frame radius, empty-stand rule and locator landmarks are judgements made per place. Neither is a tick-box.

### The boarding plan needs a step the other four do not, and the batch script has not got it

`PATCH /api/maps/:id/outputs` **sets a flag and renders nothing.** For `internal_schematic` that never bites, because it is `buildAlways` and is already in the version folder. For `internal_diagram` it never bites either, because the grant is a *side effect* of the pin editor's save (`POST /api/maps/:id/diagram`), which sets the flag and calls `renderVersion` in one act. The boarding plan has neither: there is no expert action to carry the render, so **granting it and stopping leaves the sheet absent from every version, with nothing saying so**.

`accept-publish-batch.mjs` runs withdraw → accept → submit → approve, with no step between accept and submit. **Run it on a map whose boarding plan has just arrived and it will publish the map without the sheet.** Until that is fixed (open action), land such a map by hand, in this order:

1. **accept** the proposed update — `POST /api/maps/:id/proposed/:pid/accept`. This is what puts `boardingPlan` into the map's **live** `routes.json`, so it must come first: before it, the grant is refused because the output is not `available`.
2. **grant** — `PATCH /api/maps/:id/outputs`, sending the *whole* desired set with `boarding_plan: true`. Admin only.
3. **save a version** — `POST /api/maps/:id/save`. This is the act that actually renders the sheet. Check the reply's `files` really lists `boarding.svg` before going on.
4. **submit + approve** as normal.

Proved end to end on St Neots Town Centre, 2026-08-23 (map #13, proposal #45 → v6.0 → **v6.1** live). Read the result back from `/api/public/maps/<slug>`, not from the admin reply — and note the public JPG is legitimately a different size from the one step 3 reported, because that URL serves the watermarked copy.

---

## `awaiting-customer` — staged, they haven't accepted

Not your work. Two cases:

- **Recent** — nothing to do. Don't chase.
- **Sat for two weeks or more** — their published map is going stale while they don't act. A nudge by email, naming the map and what changed. Record that you nudged.

If it stays unaccepted, it stays unaccepted: the customer owns their published map, and re-proposing next month is a normal outcome, not a failure.

