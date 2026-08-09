---
name: update-all-handouts
description: Update ALL three monthly St Ives (Cambs) u3a Members' Open Meeting handouts in one go by running the three single-handout skills back-to-back against the live u3a website. Use when asked to update/refresh/prepare ALL the handouts (plural) for the next Open Meeting, "do the whole MOM prep", "roll everything forward after the meeting", or "update the interest groups, monthly meetings and outings sheets together". This is the orchestrator: it establishes the meeting date/folder once, then runs update-interest-groups, update-monthly-meetings and update-outings in turn — each still pausing for its own confirmation before editing. For a single handout, invoke that handout's own skill instead.
---

# Update all three monthly Open Meeting handouts

## What this does
Runs the three single-handout skills in sequence for one Members' Open Meeting, so the user gets all three printable `.docx` handouts refreshed from one command. It is a thin orchestrator — **all the real work, rules and confirmations live in the three child skills**:

1. **`update-interest-groups`** → `<date> Interest Groups by interest area.docx`
2. **`update-monthly-meetings`** → `<date> MOM Open Meetings .docx`
3. **`update-outings`** → `<date> MOM Outings etc.docx`

The three target files sit side by side in the meeting folder `C:\u3a St Ives\1 Open Meetings\Handouts etc for Open Meetings\By month\<YYYYMMDD> Members Open Meeting\`.

## Why an orchestrator
The three jobs share the same context every month: the same **meeting date/folder**, the same **live website** as source of truth, the same **docx unpack/pack mechanics**, and the same housekeeping (Word must be closed; run the session from inside `C:\u3a St Ives\`). This skill establishes that shared context **once**, then hands off to each child skill so the user doesn't repeat themselves three times.

## Process
1. **Establish the meeting date once.**
   - If the user gave a date or folder, use it.
   - Otherwise default to the **next upcoming** meeting folder under `C:\u3a St Ives\1 Open Meetings\Handouts etc for Open Meetings\By month\` — the earliest `<YYYYMMDD> Members Open Meeting` folder whose date is ≥ today. State which one you picked.
   - Confirm the three expected docx files exist in that folder. If any is missing, say so and offer to continue with the ones present.

2. **Pre-flight once (covers all three).**
   - Check no `~$*.docx` lock files exist in the folder — a lock means that doc is open in Word. If any are open, ask the user to close Word before you start (the in-place overwrites fail otherwise).
   - Confirm the session is running from inside `C:\u3a St Ives\` (so the skills and folder `.claude/settings.json` load).

3. **Run the three child skills in order**, via the Skill tool, passing the meeting date/folder so each one skips its own "locate the doc / which meeting?" step:
   1. `update-interest-groups`
   2. `update-monthly-meetings`
   3. `update-outings`

   **Run them sequentially, not in parallel.** Each child pauses for its own proposed-changes approval, and two approval gates cannot be open at once; each drives Microsoft Word over COM to page-count or test-open its docx; and each ends by overwriting a file in the shared meeting folder. (Their *scratch* paths are distinct — `_un`/`_out.docx`, `mom_unpacked`/`mom_test.docx`, `outings_unpacked`/`outings_test.docx` — so scratch collision is **not** the reason, and finding they don't collide is not grounds to parallelise.) Finish one (through its overwrite + scratch cleanup) before starting the next.

4. **Honour each child skill's own confirmation gate.** Every child skill builds a proposed-changes table and **pauses for the user to approve before editing**. Do not suppress or auto-approve those pauses — the user reviews each handout's changes in turn. If a child skill offers overflow/two-page options, surface them and let the user choose.

5. **If one handout fails or the user wants to stop**, report where you got to and which handouts are done vs outstanding, then continue with the rest only if the user wants. One handout failing must not silently skip the others.

6. **Final summary.** When all three are done, give a short roll-up: for each handout, what changed (or "no changes needed"), and the shared **footer-date reminder** the child skills rely on — the user must open each updated doc in Word, make a tiny edit (type a space, delete it) and save, so the `SAVEDATE` "As at" footer refreshes to today. Opening and closing alone won't update it.

## Hard rules
- **Don't re-implement the handout logic here.** This skill only sequences the three child skills and shares the date/folder + pre-flight. All formatting rules, two-page limits, colour keys, source URLs and docx mechanics stay owned by the child skills — keep this file thin so it can't drift out of sync with them.
- **One meeting at a time.** All three handouts are for the same meeting date.
- **Sequential only** (shared scratch paths, see step 3).
- **Never skip a child skill's confirmation pause.**

## What the user does each month
1. Make sure this month's three docx files exist in the `<YYYYMMDD> Members Open Meeting` folder (usually renamed copies of last month's), and **close Word**.
2. Run the Claude session from inside `C:\u3a St Ives\`.
3. Invoke `/update-all-handouts` (or ask to "update all the handouts for the next Open Meeting").
4. Review and confirm each handout's proposed-changes table as it comes up.
5. Afterwards, for **each** updated doc: open in Word, make a tiny change and save (refreshes the footer date), then eyeball it.

