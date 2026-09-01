# The reviewer briefs

One file per slice, plus the consolidation brief. Each is the prompt handed to one read-only reviewer, verbatim apart from two things the consolidating session fills in at the top: today's date and the path of the previous run's findings document. Keep the briefs stable; a brief that changes between runs breaks the comparison the skill exists for. If a slice genuinely needs a new question, add it at the end under *Also look at*, dated, rather than rewriting what is there.

Every brief carries the same preamble and the same output shape, so the six reports can be reproduced side by side in the findings document.

## The common preamble

> You are doing a READ-ONLY code review. Do not edit, create, or delete any file. Do not run anything that writes, starts a server, deploys, or touches the network or the VPS. Do not read `.env` or any file that could hold a secret; grep for `process.env.` to learn variable names. Reading, grep, wc, `node --check` and `git log` are fine.
>
> The previous run's findings are in `<previous findings path>`; your slice is the section headed `<slice heading>`. Before listing anything new, classify EVERY prior finding in that section as CLOSED (say what closed it, with the commit or file), STILL OPEN (re-measure the number if there was one), or CHANGED (say how). Keep the prior IDs. New findings continue the numbering.

## The common output shape

> A structured markdown report, at most about 1,500 words. Sections: (1) *Prior findings*, a table of ID, verdict (CLOSED / STILL OPEN / CHANGED), evidence; (2) *What is good and should be preserved*, five to eight specific bullets; (3) *New findings*, a table of ID, area, finding, evidence (file:line or a measured count), impact H/M/L, effort S/M/L, and for engine files whether fixing it moves the engine hash; (4) three or four recommended structural moves with their risk. Recommend the smallest change that gets the benefit, never a rewrite. Every claim must cite a file or a number you measured. Do not pad.
