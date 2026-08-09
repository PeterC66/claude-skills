---
name: audit-bus-leaflet
description: Audit one or two existing bus-leaflet IMAGES for a British town against that town's already-stored bus data, and write a Word .docx audit listing every discrepancy with a justification, a verdict (is the leaflet wrong, or is our data the stale one?) and a source. The counterpart to make-bus-leaflet — that skill MAKES the maps; this one CHECKS a supplied leaflet (internal "Buses within <Town>" and/or external "Buses from <Town> to nearby towns"). Accepts pasted images or file paths, auto-detects which is internal vs external, identifies and confirms the town, checks the Buses folder for stored data (offering to generate it via make-bus-leaflet if absent), then audits SERVICE CONTENT (routes, operators, termini, intermediate towns/villages, days, fares), POIs / landmarks / linear features, and SPELLING / CONSISTENCY / DESIGN. Compares against the stored data AS-IS (offline, no live re-fetch) and flags discrepancies in BOTH directions — including where the leaflet looks newer than our data and a refresh is advised. Use when asked to audit / check / verify / proofread / fact-check a bus leaflet, bus map or bus poster image, or "is this bus leaflet right?".
---

# Audit a bus-leaflet image against the town's stored data

## What this produces
One deliverable per run: an **`image-audit_<date>.docx`** written into the town's folder (`C:\u3a St Ives\Using AI\Buses\Areas\<Town>\`), plus a short summary in chat. The DOCX is a full checklist of every discrepancy found between the supplied leaflet image(s) and the town's **stored** bus data, each row carrying:

- **Where** — internal map, external map, or both.
- **Category** — Service content · POI / landmark · Spelling / consistency / design.
- **What the image shows** vs **what our data says**.
- **Verdict** — `leaflet-error` (leaflet contradicts our authoritative data), `leaflet-newer` / `data-stale` (the leaflet looks more current than our data — refresh advised), `comment` (editorial: spelling, layout, inconsistency), or `ok` (confirmed match, optional).
- **Severity**, a **justification**, and a **source** (the exact stored file / field, or the reason).

This is the mirror image of **`make-bus-leaflet`**: that skill builds the maps and writes a `disagreements.docx` (bustimes-vs-operator). This skill takes a *finished* leaflet picture and asks "does it match what we know?". It never re-fetches live data — it judges the image against the data already on disk (decision locked: **stored data as-is**).

## Inputs
- **One or two images.** Either **pasted into the chat** or given as **file paths** on disk (paths are better — chat may downscale and blur small text). Auto-detect each image's role from its title:
  - **Internal** = title "**Buses within <Town>**" — a street schematic with POI icons.
  - **External** = title "**Buses from <Town> to nearby towns**" — a tube-map of routes to their termini. If only one image is supplied, audit just that one and note in the DOCX that the other view was not provided. If a title is unreadable or ambiguous, ask the user which is which.

## Procedure (four steps)

### 1 · Identify and confirm the town
Read the title text on the image(s) to get the town name (e.g. "Buses within **St Ives**"). Also note any **version / validity stamps** ("from 1st June 2026", "Version 2, Summer 2026") — record them; they matter for the currency judgement. **Confirm the town with the user** before proceeding ("These look like the **St Ives** leaflets — correct?"). If you cannot read a town name, **ask the user for it**. Do not guess silently.

### 2 · Find the town's stored data (offer to generate if missing)
Look for `C:\u3a St Ives\Using AI\Buses\Areas\<Town>\manifest.json`. Watch for spelling/disambiguation ("St Ives" vs "St. Ives"; two towns sharing a name). If found, read via the manifest the **latest** of each stage you need (see "What stored data to read" below).

**If there is no folder / no data for that town**, tell the user and **ask whether to generate it now using the `make-bus-leaflet` skill** ("I have no stored bus data for <Town>. Shall I build it first with make-bus-leaflet, then audit your image against it?"). If yes, hand off to make-bus-leaflet (S1→S5), then return here. If no, stop — there is nothing to audit against.

### 3 · Audit the image(s) against the stored data
Look at each image carefully and compare it, line by line, against the stored data. Cover the three locked dimensions (geometry/stop-order tracing is **out of scope** — do not grade whether a drawn line follows the exact road):

**A · Service content** (both maps) — for every route, operator, terminus, intermediate town/village, operating-days note, branch note and any fare shown on the image, check it against `verified-services.json` and `routes.json`:
  - Route **on the image but not in our data** → likely `leaflet-newer` (the leaflet may include a service we have under `notOnLeaflet`, e.g. St Ives 5A / 69) — advise a data refresh, don't assume the leaflet is wrong.
  - Route **in our data but missing from the image** (e.g. St Ives VL14) → `leaflet-error` *or* a deliberate omission — flag it, state both possibilities.
  - **Operator / days / termini / intermediate stops** that differ → compare to `routes.json` (`external[]` / `busway[]` stop lists and `days`) and `verified-services.json`; cite the field. Honour the **side-findings** already recorded in `verified-services.json` (`auditSummary.sideFindings`) and `disagreements.json` — e.g. a known-stale "market days only" note — and surface them as `data-stale` / `comment` rows.
  - **Fare** shown on the leaflet — our data carries **no fare unless confirmed**, so treat a fare figure as a `comment` ("present on leaflet; not in our data — cannot confirm") unless stored data says otherwise.

**B · POIs / landmarks / linear features** (internal map) — check the point-of-interest icons, named places, and the river / main-road / railway / canal labels against `pois.json` (the approved POI list) and `features_geo.json` / `river_geo.json`. Flag POIs **named on the map but not in our list**, approved POIs **missing from the map**, and any **mislabelled** landmark or road name. Minor icon-placement nuance is a `comment`, not an error.

**C · Spelling / consistency / design** (both maps) — your editorial pass:
  - **Spelling** of place names, road names, operators, headings (cross-check spellings against `atco2name.json` stop names, `pois.json`, and `routes.json` labels).
  - **Internal vs external consistency** — a service or place shown one way on one map and differently on the other; a route colour that differs between maps (check against `routes.json` `palette`).
  - **Legend / key completeness** — every route drawn has a legend entry and vice-versa; every icon used appears in the Key.
  - **Design / legibility** — mirrored or upside-down text that is not a deliberate label, overlaps, a missing/!contradictory version stamp, a route colour too close to the river blue (`#9ec9e8`), fonts that look smaller than the reference. Keep these as `comment` rows.

Be specific and cite the source for every finding. When the leaflet and our data disagree and the leaflet plausibly reflects a more recent change, say so explicitly and recommend re-running `make-bus-leaflet` S1 to refresh — **flag both directions, never blindly assume the leaflet is wrong** (decision locked).

### 4 · Write the DOCX
Assemble the findings into an **`image-audit.json`** (schema in `assets/image-audit.example.json`) and render it:

```
python "<SK>\gen_image_audit.py" image-audit.json "C:\u3a St Ives\Using AI\Buses\Areas\<Town>\image-audit_<YYYY-MM-DD>.docx"
```
where `<SK>` = `C:\u3a St Ives\.claude\skills\audit-bus-leaflet\assets`. The generator groups rows, colour-codes by verdict (red = leaflet-error, amber = leaflet-newer / data-stale, grey = comment, green = ok) and writes a landscape A4 table plus a per-category summary. Then give the user a tight chat summary: counts by verdict, the headline discrepancies, and whether a data refresh is advised.

## What stored data to read (via the manifest)
Let `T = C:\u3a St Ives\Using AI\Buses\Areas\<Town>`. Read `T\manifest.json`, then pull the latest:

| Stage | File | Used for |
|---|---|---|
| **S1** | `verified-services.json` | the authoritative service list, `notOnLeaflet`, `auditSummary.sideFindings` |
| **S1** | `disagreements.json` | known bustimes-vs-operator notes & resolutions to echo |
| **S3** | `routes.json` | per-route intermediate **stops**, **days**, **operators**, **palette** (the canonical "what the leaflet should depict") |
| **S2** | `pois.json` | approved POI list (names + categories) for the POI audit |
| **S2** | `atco2name.json` | correct stop / place **spellings** |
| **S2** | `features_geo.json` / `river_geo.json` | linear features (river / road / rail) for landmark checks |

(The make-bus-leaflet skill's `assets/stage.js` can print the latest run of a stage — `node "<MK>\stage.js" latest S1` from inside the town tree, where `<MK>` is that skill's assets — but reading `manifest.json` directly is fine.)

## Locked decisions (do not silently change)
- **Compare against stored data AS-IS — never live re-fetch.** "Currency" means: does the image match our last-known-good data, and if not, which side looks out of date.
- **Flag discrepancies in BOTH directions.** A leaflet showing more than our data usually means *our data is stale*, not that the leaflet is wrong — say so and advise a refresh.
- **Scope = service content + POIs/landmarks + spelling/consistency/design.** Do **not** grade fine map geometry / exact stop-order tracing from the flat image.
- **Output = one `image-audit_<date>.docx` in the town folder**, plus a chat summary. Mirror the `disagreements.docx` visual style.
- **Auto-detect internal vs external** from the title; accept pasted images or file paths.
- **No fare unless our stored data confirms one** — an on-leaflet fare is a `comment`.

## image-audit.json schema (summary)
```json
{
  "town": "St Ives",
  "auditedOn": "2026-06-05",
  "dataUsed": { "verifiedOn": "2026-06-05", "leafletVersion": "v1.0_2026-06-05",
                "files": ["verified-services.json", "routes.json", "pois.json"] },
  "images": [
    { "role": "internal", "title": "Buses within St Ives (from 1st June 2026) — Version 1, Summer 2026", "source": "pasted" },
    { "role": "external", "title": "Buses from St Ives to nearby towns — Version 2, Summer 2026", "source": "pasted" }
  ],
  "findings": [
    { "image": "external", "category": "Service content", "item": "Route 5A (Stephensons)",
      "image_shows": "5A 'St Ives to Bar Hill' drawn as a service",
      "data_says": "verified-services.json lists 5A under notOnLeaflet — 'live, candidate for inclusion at next refresh'",
      "verdict": "leaflet-newer", "severity": "Medium",
      "justification": "Leaflet is ahead of our v1.0 data; our data already earmarked 5A for inclusion. Refresh S1 to confirm.",
      "source": "verified-services.json → notOnLeaflet[5A]" }
  ]
}
```
- `image`: `internal` | `external` | `both`
- `category`: `Service content` | `POI / landmark` | `Spelling / consistency / design`
- `verdict`: `leaflet-error` | `leaflet-newer` | `data-stale` | `comment` | `ok`
- `severity`: `High` | `Medium` | `Low` | `Info`

