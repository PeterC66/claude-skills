# Brief: consolidating the six reports into the plan

This is for the session running the skill, not for a reviewer.

**The findings document** (`Development Docs/codebase-review-findings_<date>.md`) opens with one paragraph saying what it is, which run it follows, and that the heaviest claims were re-measured; then a line naming the three repositories; then the six reports as delivered, each under `## Review n — <slice heading>` with the slice headings exactly as the briefs name them, so the next run's reviewers can find their section. Do not edit a reviewer's findings beyond fixing a table that `check-tables.mjs` rejects.

**The plan document** (`Development Docs/codebase-review_<date>.md`), in this order:

1. A header paragraph: date, scope, method (six reviewers, the measurer, what was re-checked), and that nothing was changed unless the run also fixed the no-decision items.
2. *Verdict up front*: what is good and is not at risk, then the two or three findings that change what the plan should do first. Lead with the measurer's diff against the previous run.
3. *What was re-checked before it drove the plan*: a table of claim, how it was re-measured, result.
4. *The findings that matter, grouped*: each group names the reviews and IDs behind it. Say which prior findings closed since the last run and which did not.
5. *The plan, in priority order*: tiers, each a table of item, what, effort (S under an hour, M a session, L more), source. Tier 1 is faults that need no decision; fix those in the same round if the request allows. Name the one or two decisions that are Peter's, with one recommendation each, not a menu.
6. *Not recommended*, with reasons.
7. *How this sits with the backlog*: every open row this plan serves or touches, by number — **and, separately, which Tier 2 findings deserve a backlog row of their own, named individually**. Nothing enumerates this plan: the worklist reads no open action, and the one row a round produces is its `loop/blocked/` note, which stops appearing the moment somebody answers it. The rule is *file an OA for what should be worked before the next review; leave in the plan what the next review can re-ask* — so this section is where the plan says which is which, and a round that names none has left that judgement to whoever happens to read the document. See [What happens to the plan afterwards](../../SKILL.md#what-happens-to-the-plan-afterwards--decided-2026-09-14-after-the-fourth-run).
8. *What surprised us*.
9. *Where this stands — <date>*: empty on the day, filled in by the sessions that do the work, with the commit and the proof per item.

Then: update the backlog row; re-date the `codebase-review` commitment; run the checkers; stamp; commit by pathspec; write the memory entry; release the claim.
