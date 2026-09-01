# Local decisions — the questions only someone who lives there can answer

Every build throws up questions. Most of them are ours: is it legible, do the colours separate, is that label sitting on route ink. A few are not ours at all, and this file is about those few — the ones whose only source is a person who knows the ground.

Until August 2026 both kinds were settled the same way, by the one person who happened to live in one of the towns we had mapped. That does not survive contact with a town nobody here knows. The destination for these questions is the portal editor — the customer with the local knowledge — and the plan for getting them there is `…\Buses\Development Docs\local-decisions-to-the-editor-plan_2026-08-25.md`.

**What exists today is Phase 0: recording.** A build writes its local questions to a file. **Nothing reads that file yet** — no gate, no generator, no portal panel. Say so when you report a build, so an unfed file is never mistaken for a working mechanism.

## The rule

**If the answer is checkable against a source, it is ours. If the only source is a person who lives there, it is theirs.**

Ours, always, and never asked: legibility, type floors, colour distinctness and colour-blind separation, label collisions, casing weight, bend counts, frame coverage, whether a route's chain is drawable, whether the render reproduces the bytes. `quality_metrics.js`, S6 and the portal's publish checklist already cover these, and a customer has no better answer than the measurement. Asking a council clerk whether 2.4 mm type is legible is passing our job to someone with less evidence than us.

Theirs: naming, recognisability, local significance, and whether a thing belongs on the sheet at all.

There is a third kind, and it is the one that matters most because it looks like the second and behaves differently: **factual, but unresolvable from our sources**. Where the Ivel Sprinter boards at St Neots Market Square is the example — two independent records say Stand A, BODS does not carry the service at all, and no gate we own can re-derive it. Record these as **evidence with a question attached** ("two sources say Stand A — can you confirm?"), never as an open choice. An open question gets an opinion back; evidence gets a confirmation. On a boarding plan, whose one job is to stop a passenger standing at the wrong stop, that difference is the entire point.

## The catalogue — seven recurring types

These are not hypothetical. Every one is a live item in `open-actions.md` or in `boarding-plan-product_2026-08-22.md`, and knowing the list means a build can look for them rather than wait for one to occur to somebody.

| # | Type | What triggers it | Config key it would set |
|---|---|---|---|
| 1 | **Locator landmarks** — which named buildings will a local reader actually use to orient themselves? | Any boarding plan. The ranking promotes whatever is nearest the anchor, which at St Neots meant four places to eat out of 59 candidates. | `boardingPlan.locatorLandmarkNames` |
| 2 | **Naming a terminus or a stub** | A drawn leg whose far end is not a destination, so the ordinary arrow label would lie. | `internalRoads.termini` |
| 3 | **Does this service count?** — seasonal, school-day, bank-holiday-only, pre-book, community | S1 finds a service that runs, but barely, or only at times a reader would not expect. | `routes[]` inclusion, `internalDesc` |
| 4 | **Where does an unverifiable service board?** | A service outside BODS serving a place with lettered stands. | `boardingPlan` stand assignment |
| 5 | **Which landmark must appear**, even where the placer would drop it — and which should not be on the sheet at all | A locally important POI losing to the label placer every time; and the far commoner opposite, a sheet carrying places nobody navigates by. **Asked with the portal's landmark chooser since 2026-09-01** (OA-212), not by interview. | `poi.tiers` / `overrides.internal.poiTiers` |
| 6 | **Exit destinations** — what does the arrow at the frame edge say? | A route leaving the frame toward somewhere with more than one reasonable name. | `destinations[]` |
| 7 | **Area extent** — does this outlying village belong on the sheet? | A settlement on the edge of what the town would call "here". | frame / anchor / zoom |

Types 1 and 4 are place-and-boarding-plan work; see also `make-place-bus-leaflet`. Types 2, 3, 6 and 7 hit towns and places alike.

## Where it is recorded

One file per map, beside `manifest.json`, tracked in git:

```
C:\u3a St Ives\Using AI\Buses\Areas\<Town>\local-decisions.json
C:\u3a St Ives\Using AI\Buses\Areas\<Town>\Places\<Place>\local-decisions.json
```

It holds every local question raised for that map, answered or not, for the life of the map — it is not a per-run artefact and does not live in a stage folder. That is deliberate: an answer has to outlive the build that asked for it, or next month's refresh asks again. The shape:

```json
{
  "map": "St Neots Town Centre",
  "kind": "place",
  "updated": "2026-08-25",
  "_status": "Phase 0 — recorded only. Nothing reads this file: no generator, no gate, no portal panel.",
  "decisions": [
    {
      "id": "c2-stub-name",
      "type": "naming",
      "question": "What should the C2 stub be called, or should it not be drawn?",
      "why": "It is the Church Street leg of a two-journeys-a-week Thursday service that turns round in the town centre, so its far end is not a destination like the other arrows.",
      "ourDefault": "Drawn, unlabelled — internalRoads.termini sets end:false deliberately.",
      "options": [],
      "evidence": "",
      "configKey": "internalRoads.termini",
      "severity": "advisory",
      "raised": "2026-08-24",
      "source": "Development Docs/review-triage_2026-08-24.md item 17",
      "answer": null,
      "appliedIn": null
    }
  ]
}
```

Field notes, and each of these earns its place:

- **`ourDefault` is required and is never "none".** Something got printed. Write down what, and why, in the words you would use to the customer — that sentence is what the portal panel will show beside the question. A build that cannot state its default did not make a decision, it made an omission, and an omission reads to everyone downstream as a design choice.
- **`options`** — fill it whenever there is a real shortlist (candidate landmark names from `pull_locator.js`, the plausible names for a stub). A question with a shortlist gets answered; an open text box gets ignored.
- **`evidence`** — for type-3 questions above all. What we found, and from where. This is what turns an opinion into a confirmation.
- **`severity`** — `advisory` or `blocking`. `blocking` is reserved for the case where printing the wrong answer misdirects a passenger: type 4 always, type 3 when the wrong answer means a service is printed as running. **Nothing enforces this today** — it is recorded now so that Phase 3 has a real population to gate on rather than a guess.
- **`answer`** — `null` until the customer answers. Later it becomes `{ "state": "answered" | "dont-know", "value": …, "note": …, "by": …, "at": … }`. **`dont-know` is a real, terminal answer**, not a blank: it means our default stands and is now a recorded decision rather than a silent gap. A council clerk genuinely may not know where the Ivel Sprinter boards, and if the only exits are answered and unanswered, the question round-trips for ever and we quietly go back to deciding it ourselves — on exactly the maps this exists for.
- **`appliedIn`** — the S4 version that first carried the answer. An answered decision with no `appliedIn` is an answer that never reached a sheet, which is the failure mode worth being able to see.

## When to do it

**During the build, at the stage that raises the question — not at the end.** S1 raises type 3, S2 and S3 raise types 2, 6 and 7, the boarding-plan phases raise 1 and 4.

**Do not interview the user, and do not pause.** This is the point of the mechanism: a local question is *not* a blocker. Take your best default, print it, record the question with that default beside it, and carry on. A sheet that says "we used the sculpture because it was all we had" ships; a sheet waiting on someone who does not know the answer either does not.

**Do not silently decide a local question you have no standing to decide.** Recording it *is* the deliverable. The old habit — quietly pick something reasonable and mention it in the summary — loses the question the moment the session ends.

**Report the count when you report the build**, next to the version and the gate results: *"3 local decisions recorded, 1 blocking."* An unread file is worth nothing.

## What this becomes

Phase 1 puts these rows in the portal for the customer's editor to answer; Phase 2 pulls the answers back down into this same file's `answer` fields and seeds S3 from them on every subsequent build; Phase 3 makes an outstanding `blocking` decision stop a publish, with expiring waivers in the shape `s6-waivers.json` already uses. The file format above is the one all three phases read, which is why it is worth filling in properly now even though nothing consumes it yet. Full reasoning and phasing: `…\Buses\Development Docs\local-decisions-to-the-editor-plan_2026-08-25.md`.
