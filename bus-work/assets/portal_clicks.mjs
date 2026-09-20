/*
 * portal_clicks.mjs — which worklist rows are a CLICK PETER MAKES IN THE PORTAL
 * (buses-data OA-417).
 *
 * The worklist gathers the portal's queues and the local map tree into one
 * ranked list, and every row carries a `who`. But `who` is free text — `Peter`,
 * a customer's name, `the local adviser`, `—` — and nothing grouped by the fact
 * that matters to him: THIS ROW IS A CLICK, ON THIS SCREEN, THAT ONLY HE CAN
 * MAKE. Approving an application, inviting a user, reviewing and publishing a
 * version, nudging a customer: each is his, each is in the portal, and each was
 * scattered through a list he reads as one thing. He said so on 2026-09-20 —
 * "this is yet another channel of work for me" — and the portal was the one
 * channel of his work with no summary of its own.
 *
 * THIS IS A PROJECTION AND NOT A SOURCE. It takes the rows the worklist has
 * already built and already sorted, and selects from them; it queries nothing,
 * reads no file and never touches the network. That is deliberate and it is the
 * whole safety argument: a second query against the portal would be a second
 * answer to "what is waiting", and the two would disagree the first week one of
 * them changed. Every row this block prints is a row printed in full below it.
 *
 * THE JOIN IS `do[].kind === 'portal-ui'`, NOT THE PROSE OF `who`. OA-417 is
 * explicit about this and it is worth the sentence: `who` is written for a
 * reader, three forms of it are already tested rather than one, and a regex over
 * it would break the first time somebody wrote "Peter and the adviser". The
 * `portal-ui` step is a DECLARED field, set in `src/worklist/index.js` where the
 * row is built, carrying both the screen (`url`) and what the click does
 * (`what`). It exists because the terminal has to render that step differently
 * from a shell command — so it is load-bearing already, and a row that gained a
 * portal click without gaining the step would render wrong in the list below
 * long before this block could lie about it.
 *
 * WHAT IS DELIBERATELY NOT HERE. Nothing infers a screen from a title, and
 * nothing rewrites the step's own words: `screen` is the URL's PATH, taken by
 * parsing the URL the row already carries, and `what` is the step's `what`
 * verbatim. If a row's wording is wrong the fix belongs in the portal, one file,
 * where every reader of that row gets it.
 */

/**
 * The portal-UI steps of one item, in the order the row declares them.
 * A row may carry more than one — none does today, and assuming one would be
 * the kind of quiet assumption this estate keeps paying for.
 */
export function portalSteps(item) {
  const steps = (item && Array.isArray(item.do)) ? item.do : [];
  return steps.filter((d) => d && d.kind === 'portal-ui');
}

/**
 * The screen a portal-UI step is on: the PATH of its url.
 *
 * The url is absolute and its origin is whichever portal this run looked at —
 * the live site under `--url`, `http://localhost:3000` on the dev checkout — so
 * the path is the part that means the same thing in both, and it is what Peter
 * recognises. A url that will not parse is returned as it stands rather than
 * dropped: a row with a broken link is still a row he has to act on, and hiding
 * it would be the board lying by omission.
 */
export function screenOf(step) {
  const raw = step && step.url ? String(step.url) : '';
  if (!raw) return null;
  try { return new URL(raw).pathname || raw; } catch { return raw; }
}

/**
 * Project the ranked rows onto the clicks Peter makes in the portal.
 *
 * @param {Array} rows   the worklist's own rows, already filtered and sorted.
 * @returns {Array} one entry per (row, portal-ui step) pair, in the order the
 *                  rows arrived, each carrying the row's key, title, age, band
 *                  rank and safety verdict alongside the step's screen, url and
 *                  what-the-click-does.
 *
 * ORDER IS THE CALLER'S, NOT OURS. The rows arrive sorted by band and age and
 * this preserves that, so the block reads in the same order as the list under
 * it. Sorting again here would be a second opinion about priority.
 *
 * WHICH ROWS THE CALLER SHOULD PASS, because the answer is not obvious and the
 * comment belongs beside the reasoning rather than at the call site.
 * `worklist.mjs` passes `shown` and NOT `limited`: `--limit` is a display cut on
 * how much of the list fits a screen, and a click of Peter's that fell off the
 * bottom of that cut is still waiting. Every other filter DOES apply, because
 * `--safe-only` and the demo hiding are statements about what is on the board at
 * all, and this block must never name a row the reader cannot find below it.
 * When the cut does bite, the caller says so through `truncated` below.
 */
export function portalClicks(rows) {
  const out = [];
  for (const it of (Array.isArray(rows) ? rows : [])) {
    for (const step of portalSteps(it)) {
      out.push({
        key: it.key,
        title: it.title,
        ageDays: it.ageDays == null ? null : it.ageDays,
        rank: it.rank,
        demo: !!it.demo,
        who: it.who == null ? null : it.who,
        onHold: !!(it.onHold && it.onHold.length),
        screen: screenOf(step),
        url: step.url || null,
        what: step.what || null,
      });
    }
  }
  return out;
}

/**
 * The terminal block, as an array of lines. Empty when nothing is waiting —
 * the caller prints nothing at all rather than a heading over an empty list,
 * because a standing heading that is usually empty is one a reader stops seeing.
 *
 * A HOLD IS CARRIED THROUGH AS A WARNING AND THE ROW IS STILL LISTED. OA-283's
 * rule is that a hold gates the COMMANDS, not the row's existence: the summary's
 * job is to tell him the click is there, and the full row below carries the hold
 * banner and the reason. Dropping a held row from the summary would reintroduce
 * exactly the invisibility this block was written to end.
 *
 * WHERE THE CALLER PUTS THESE LINES: at the HEAD of the board, above the
 * conditions and above the suppression notes, because this is the one part of
 * that output written for Peter rather than for whoever is about to run
 * something — these are the rows no session can take off his hands.
 *
 * AND THE SAME ARRAY GOES INTO `--json`, under OA-221's rule that a caller
 * reading the board as data must be able to see the same verdict a person does.
 * The terminal block renders this array and nothing else, so the two cannot
 * drift apart.
 */
export function formatPortalClicks(clicks, { truncated = false } = {}) {
  if (!clicks || !clicks.length) return [];
  const lines = [];
  const head = 'WAITING ON YOU IN THE PORTAL';
  lines.push(`── ${head} ${'─'.repeat(Math.max(0, 58 - head.length))}`);
  /*
   * `truncated` EXISTS BECAUSE THE SENTENCE WAS FALSE UNDER `--limit`. The block
   * is projected from every row on the board and the list below is cut to
   * `--limit`, so `worklist.mjs --limit 1` printed five clicks over the promise
   * that each was "a row in full below" and then printed one row. Caught by
   * running the real board rather than by a case, which is why it is written
   * down here: the projection is right and only its claim about the OTHER
   * output was wrong, and that is the exact shape of a summary that lies.
   */
  lines.push(`  ${clicks.length} click${clicks.length === 1 ? '' : 's'} only you can make. ${truncated
    ? 'The list below is cut short by --limit, so not every one of these is on it.'
    : 'Each is a row in full below.'}`);
  // Widest screen path, so the second column lines up without a table library.
  const w = Math.max(...clicks.map((c) => (c.screen || '').length));
  for (const c of clicks) {
    const age = c.ageDays == null ? '' : `  [${c.ageDays}d]`;
    lines.push('');
    lines.push(`  ${String(c.screen || '?').padEnd(w)}  ${c.title}${age}${c.demo ? '   (demo data)' : ''}`);
    lines.push(`  ${''.padEnd(w)}  ${c.what || '—'}`);
    lines.push(`  ${''.padEnd(w)}  ${c.url || ''}`);
    if (c.onHold) lines.push(`  ${''.padEnd(w)}  ON HOLD — read the row below before clicking.`);
  }
  lines.push('');
  return lines;
}
