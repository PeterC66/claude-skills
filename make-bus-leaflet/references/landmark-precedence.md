# Landmark precedence — who decides whether a place is drawn

Five things can say whether a point of interest reaches the internal sheet: the engine's defaults, the map's own `poi` block in `routes.json`, the map's `poi.tiers`, the customer's answers in the portal's landmark chooser, and the customer's category switch on the same page. Until 29 September 2026 nothing said which of them won when they disagreed, and the order fell out of the code: a category that was off was dropped by `classify()` before any tier was read. That is how High Wycombe Aldi lost *Tannery Road Ind Est*, a place we had chosen for that map, the day the 28 September review (buses-data OA-500) turned industrial estates off by default. Peter settled the order on 2026-09-29 (buses-data OA-517), and this page is the statement of it. The code that implements it is `assets/poi_select.js`: `selectPois()`, `applyTiers()`, `categoryOn()` and `mergePoiOverlay()`.

## The order, strongest first

| Level | Who | Where it is written | What it can do |
|---|---|---|---|
| 1 | The customer's **category switch** | the portal's `overrides.json`, `internal.poiInclude` — `{ "pubs": false, "industrial": true }` | Both directions, over everything below. **Off** leaves every place in that category off the sheet, whatever any tier says, and takes the category's places out of the chooser. **On** makes the category available whatever the map's `poi.exclude`, its `poi.industrialKeep` or the engine default say. |
| 2 | A **per-place tier** | the customer's `internal.poiTiers` first, then the map's `routes.json` `poi.tiers`, merged key by key with the customer winning | `must` or `may` brings the place in, and `miss` leaves it out. This beats levels 3 and 4 in both directions, and it works on one place without switching its whole category on. |
| 3 | The **map's own configuration** | `routes.json` `poi.include`, `poi.exclude`, `poi.industrialKeep` | Switches a category on or off for this map, and chooses which estates are kept once estates are on. |
| 4 | The **engine default** | `DEFAULT_ON_CATS` and `applyTiers()` in `poi_select.js` | Pubs and stations on; allotments, post offices and industrial estates off; every other category always on. A named place defaults to `may` and a nameless one to `miss` (OA-238). |

Levels 3 and 4 are **defaults**, not filters: a place they leave out is still classified, still de-duplicated, still offered in `report.candidates` as a `miss`, and a tier can bring it in. Only level 1's *off* removes a place before tiers run.

## `force` is not on the list

An `internal.pois` override's `"force": true` means **print this place's name** and nothing else. It is read by `gen_internal.js` after selection, when the place is already on the sheet (`showName = o.force===true || must || …`), so it cannot bring a place in, and a place left out by any level above is not drawn however it is forced. To bring a place in, give it a tier: `"industrial:Tannery Road Ind Est": "may"` in `poi.tiers`. To bring it in *and* print its name, `must` does both, or keep a `may` tier beside the `force` as High Wycombe Aldi does.

## What each level looks like in practice

- **A map wants one estate while estates stay off.** Add the place to `poi.tiers` as `may` (or `must`). The key is `<category>:<name>` after tidying, the same key the chooser shows, so `industrial:Tannery Road Ind Est` and not the OpenStreetMap spelling `Tannery Road Industrial Estate`. `poi.include: ["industrial"]` would switch on every named estate instead.
- **A map switches a category off with `poi.exclude` but wants one of its places.** Tier that place `must` or `may`. Level 2 beats level 3.
- **`poi.industrialKeep`** is level 3. With estates on, a list keeps the estates it names and defaults the rest to `miss`; `"none"` defaults every estate to `miss`; absent keeps every named estate. It is read on the name as OpenStreetMap spells it, before tidying, because that is what every committed list was written against. An estate with no name of its own is dropped whatever it says, like an unnamed green. A tier on one estate beats it, and a customer who switches estates on beats it too.
- **The customer switches a category off.** Nothing in it is drawn, including a place either of us tiered `must`, and the chooser stops offering its places one by one. Their answers are kept rather than deleted: the portal validates saved keys against every category switched on (`editablePoiKeysFromDir()`), so switching the category back on brings the answers back with it.
- **The customer switches a category on.** Every named place in it defaults to `may`, over our `poi.exclude` and our `industrialKeep`. A place-by-place `miss`, theirs or ours, still leaves that one place out, because it is a level-2 answer about that place rather than about the category, and the chooser shows it as a row they can change.

## The chooser shows more rows than it used to

Since this change the landmark chooser lists the places of a category that is off at level 3 or 4 as `Do not show` rows — every allotment, post office and named industrial estate the map's pull holds, where before they were absent. That is the point of it: a customer can only bring one place in if it is offered. A category the customer has switched off is still absent, as it always was.

## One limit, known and not built for

`poi_tiers_sync.js` copies the customer's answer into a new S3, and it writes their category switch as `poi.include` / `poi.exclude` — level 3 — because `routes.json` has no customer layer. It never writes a tier in a category the customer switched off (`unreachableReasons()` culls it), so the two sides agree. They would part only if somebody hand-added a `must` or `may` to `poi.tiers` for a place in that category afterwards: the local build would then draw it and the portal, which still holds the switch, would not. If that is ever wanted, the switch needs a place of its own in `routes.json`.

## How the sync and the worklist judge a stored answer

A portal tier key is **unreachable** — reported, counted, not written and owed nothing — when it can change nothing: its category is one the customer switched off, or it is a `miss` for a place this map already leaves out (a category off at level 3 or 4, or an estate under `industrialKeep: "none"`). A `must` or `may` in a category that is off only at level 3 or 4 is reachable, because it brings the place in. `unreachableReasons()` in `poi_tiers_sync.js` is that rule, shared with `bus-work`'s `landmark_answers.mjs`, which the worklist uses to raise `landmark-owed-` rows.

## Drawn is not the same as placed: an opt-in symbol gives way

Everything above decides whether a place is **drawn**. Where its symbol then goes is decided in `gen_internal.js`, and since 2026-09-29 (buses-data OA-522) the two kinds of category are placed differently. A core symbol (shops, schools, the hospital and the rest) is placed where OpenStreetMap puts it, spread from its neighbours by `spreadIcons`, and reserved before anything else claims space, exactly as before. A symbol from a switchable category (`SWITCH_CAT` in `poi_select.js`: pubs, stations, post offices, allotments, industrial estates) is placed **last**, after the routes, the badges, the road names and every core symbol, at the nearest spot within `OPT_IN_REACH` (4 mm) that is clear of route ink, of every route badge and of everything already reserved. Where no such spot exists it is **left off**, and the build note `poi: N opt-in symbols left off …` names each one. A symbol placed by hand (`internal.pois` `pos` or `move`) and a `must` are exempt and keep the old placement: somebody chose that spot, or said the place matters.

It exists because March's first fresh landmark pull (v2.67, withdrawn) drew about ten pub glasses stacked on the route bundle round March Town, over the *Town Centre* name and over a 56 badge. On that pull the rule leaves nine of March's ten pubs off the internal sheet, because its town centre is route ink from end to end, and draws the one with room. On the towns' data of 2026-09-29 it moved four town sheets, and High Wycombe Aldi's schematic among the places: Beaconsfield leaves off *The Chiltern*, which sat on a route beside a trolley, and its schematic gains the *Forty Green* road name; March's station moves off the 56 line on the schematic and a 56 badge prints; High Wycombe's station glyph, which covered the 104 badge beside the *Rail Station* name, is left off and the badge prints. **A lost-label check cannot see a symbol left off without a name** — a station or a nameless pub leaves no line in a label diff — so read the build note.

## The tests

`test/poi_select.test.js` holds each level against the one below it, under the `OA-517:` tests, and they were watched failing against the engine before this change. `test/poi_tiers_sync.test.js` holds the reachability rule.
