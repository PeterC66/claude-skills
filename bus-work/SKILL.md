---
name: bus-work
description: Show what the BusMaps.uk bus-map system is waiting on — one ranked worklist gathered from the portal (publish reviews, organisation applications, map requests approved and awaiting a build, proposed updates) and from the local map tree (towns whose services change soon per the BODS scan, stale engine renders, missing S6 verification) — then carry the chosen item all the way through: run the right map skill, gate it, and deliver it into the portal with the exact command. Use when asked "what needs doing on the buses / the portal", "what's next", "do the monthly bus refresh", "is there anything waiting in the portal", "build the map someone asked for", "work the bus worklist", or when picking a numbered item from a worklist this skill printed. The entry point for routine BusMaps.uk operations — it replaces reading runbooks R1–R4 to remember which script, which flags, which order.
---

# Work the BusMaps.uk worklist

**The point of this skill: Peter should never have to open a runbook to do the routine month.** Everything the system is waiting on appears in one ranked list, and every item carries its own procedure. If you find yourself telling him to "see R4", you have failed — inline the step instead.

## The shape of the system (why the split exists)

| Zone | Where it happens | Why it can't move |
|---|---|---|
| **Know** what needs doing | the portal | it holds the customers, requests and queues |
| **Make** the map | this laptop, S1–S6 | needs live data, network and judgement — the portal is deliberately deterministic, no network, no AI at render time |
| **Deliver** into the portal | `import-map.mjs` / `propose-update.mjs` | writes the portal's SQLite + object store |

This skill is the spine across all three. It does not replace `make-bus-leaflet` / `make-place-bus-leaflet` — it *calls* them, then does everything either side.

## Step 1 — Print the worklist (always start here)

Let `BW=C:\u3a St Ives\.claude\skills\bus-work\assets` (this skill lives in the bus skills repo alongside `make-bus-leaflet`, and is junctioned into `~\.claude\skills\` like the others).

```powershell
node "%BW%\worklist.mjs"
```

The same list is on the web at **`/app/admin` → To do** (the admin landing tab) — same ranking, same wording, because both call the portal's `src/worklist/index.js`. The terminal version adds what only this machine can see: failing gates, engine-stale renders, missing S6, and towns with a leaflet but no portal map.

Read-only, safe to run at any time, and safe while the dev server is running (the portal DB is WAL). Add `--json` when you need to act on the fields, `--gates` to also run the full byte-identical gate sweep (slow — a minute or two; only worth it after an engine change or before a batch of deliveries).

Against a **remote** portal, add `--url https://busmaps.uk --cookie <cbm_session value>` (or set `BUSMAPS_URL` / `BUSMAPS_COOKIE`). See "Remote portals" below — reading works, delivery does not yet.

Present the result to Peter as a short numbered list — title, who's waiting, age. Do not paste the raw output wholesale; it is written for a terminal, and he wants the decision, not the dump. Lead with the bands in order: **BROKEN → SOMEONE IS BLOCKED → YOUR MOVE → HOUSEKEEPING → WAITING ON OTHERS**.

## Step 2 — Pick one

- If the invocation already names one ("do the St Ives refresh", "build the Waitrose map", "/bus-work 3"), take it and skip the question.
- Otherwise show the list and ask which — **one message, one question**. Recommend the top item unless something lower is obviously more urgent, and say why in a sentence.
- If the list is empty, say so plainly and stop. Do not invent work.

## Step 3 — Do it

Load [references/playbooks.md](references/playbooks.md) and follow the playbook for that item's `type`. One item at a time, start to finish, before offering the next.

The types and where each ends up:

| `type` | What it is | Ends with |
|---|---|---|
| `gate` | the engine no longer reproduces a committed map | diagnosed; nothing else ships until it is |
| `review` · `application` · `request-decision` | one of the **three approval gates** | Peter decides in the portal UI — **never decide for him** |
| `build` | an approved request with no map yet | map imported, v1.0 verified byte-identical |
| `refresh` | a portal map whose services are changing | proposed update staged for the customer |
| `refresh-local` | a town leaflet with no portal map | new S5 render + `_latest` refreshed |
| `housekeeping` | engine-stale renders, missing S6 | rollout applied / S6 run |
| `awaiting-customer` | staged, they haven't accepted | a nudge, or nothing |

## Step 4 — Close out

Every time, without being asked:

1. **Re-run the worklist** and confirm the item is gone. If it is still there, it is not done — say so.
2. Tell Peter what changed in one or two lines: the version number, the map, the customer, what the next actor is.
3. If anything about the *procedure* proved wrong or fiddly, fix it here (this file, the playbooks, or `worklist.mjs`) in the same session rather than leaving it for the next one.

## Rules that override convenience

- **Never decide an approval gate.** Organisation approval, map-request approval, and publish review are Peter's judgement and the system's integrity. Prepare the evidence, summarise it, open the URL — then stop.
- **Never hand-edit a rendered file.** Corrections go through a new version, always.
- **Never relax a gate to make it pass.** A `verify` that says DIFF is information, not an obstacle.
- **`npm run verify` skips silently** when its fixture dir is unset — a green run with no byte counts proves nothing. Require the word PASS *and* byte counts before calling an import verified.
- **PowerShell is the shell.** `FIXTURE_DIR=… npm run …` is bash and silently does nothing here; use `$env:FIXTURE_DIR = "…"; npm run …`. The worklist already emits the PowerShell form.
- **Stop the dev server before any command that writes** to the portal (`import-map.mjs`, `propose-update.mjs`, `seed-demo.mjs`). Reading — including this worklist — is fine either way.
- **Deliver only from the machine that hosts the portal.** See below.

## Remote portals — the honest state

**Reading a remote portal works now.** The admin API is cookie-authenticated and this tool only ever GETs, so `--url` + the `cbm_session` cookie from a signed-in admin browser session gives the same worklist from anywhere.

**Delivery does not.** `import-map.mjs` and `propose-update.mjs` write straight to a local SQLite and `DATA_DIR`; they must run on the machine the portal runs on. If the worklist is in remote mode and the chosen item needs a delivery command, **say so and stop before running it** — do not run a local delivery command and imply it reached the remote portal.

The remaining portal-side piece is **`POST /api/admin/ingest`** (not built): accept a packed S5-render dir plus an operator token (the `METRICS_TOKEN` pattern already in `.env`), run the existing import/propose logic server-side, and run the byte-identical verify *before* accepting. That retires the "stop the dev server", "which fixture env var" and "which machine am I on" traps in one go. It is item 4 of `Buses\Development Docs\foolproofing-plan_2026-08-07.md`.

## What feeds the worklist

Nothing here is a new source of truth; it is a join over what already exists.

| Source | Gives |
|---|---|
| the portal's own `src/worklist/index.js` — **imported locally, fetched (`GET /api/admin/worklist`) when remote; never re-implemented** | ranks 1–6 and 9: publish reviews, applications, map requests, awaiting-build, refresh flags, proposed updates. The admin console's To-do tab renders the same call, so the two cannot show different lists |
| `_gtfs/upcoming/upcoming-report_<date>.md` | which towns have service changes coming, matched to maps by the *same rule* `check-upcoming-refreshes.mjs` uses |
| each town's `manifest.json` + `routes.json.engine` vs `engine_version.js` | which renders pre-date the current engine, and how stale S6 is |
| `status.js --json` (only under `--gates`) | the expensive proof: regenerate everything and diff |

If a queue is missing from the list, fix the source that owns it — **a portal queue is fixed in `community-bus-maps/src/worklist/index.js`** (which fixes the admin console at the same time), a local-tree signal in `worklist.mjs`. Do not work around a gap by reading the admin console separately; that is the habit this skill exists to end.
