#!/usr/bin/env node
/*
 * prove-red-portal-clicks.mjs — falsify portal_clicks.mjs before the worklist
 * puts its answer at the head of the board (buses-data OA-417).
 *
 *   node assets/prove-red-portal-clicks.mjs   (or: npm run test:prove-red-portal-clicks)
 *
 * Run it from `bus-work/` (the folder holding package.json); no flags, no
 * placeholders, no network, no clock. Exit 0 when every case holds, 1 otherwise.
 *
 * WHAT THIS HARNESS IS ACTUALLY FOR, because a projection looks too simple to
 * need one. The block is a SECOND rendering of rows that are already on the
 * board, and the only way it can be wrong is by disagreeing with the first —
 * naming a row that is not below it, or staying silent about one that is. Both
 * failures are invisible to a reader, who has no reason to cross-check a summary
 * against the list it summarises. So the cases below are almost all about the
 * join: what gets in, what stays out, and what happens when the shape changes
 * under it.
 *
 * THE LAST SECTION JOINS THE REAL PORTAL when community-bus-maps is on this
 * machine, and says out loud when it is not. That is the case that catches the
 * failure this estate actually fears: the portal renaming or dropping the
 * `portal-ui` step kind, leaving a projection that is green, silent and wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalClicks, portalSteps, screenOf, formatPortalClicks } from './portal_clicks.mjs';
import { resolvePortal } from './engine.mjs';

let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

/*
 * `one()` AND THE `= {}` DEFAULTS BELOW EXIST SO A RED STAYS READABLE, and that
 * is a correction rather than a style. Proved red by swapping the join in
 * portal_clicks.mjs for `who === 'Peter'`: section 1 named both failures
 * correctly and the next section then THREW on an undefined entry, so sections
 * 3 to 10 never ran and the operator saw a stack trace in place of the eight
 * other things that swap had broken. A harness that dies at the first fault
 * reports one fault.
 */
const one = (rows) => portalClicks(rows)[0] || {};

/** A worklist row, in the shape worklist.mjs sorts and prints. */
const row = (key, extra = {}) => ({
  key, rank: 2, title: `Title for ${key}`, why: 'because', who: '—', ageDays: 3, do: [], ...extra,
});
const ui = (what, url) => ({ kind: 'portal-ui', what, url });
const sh = (cmd) => ({ kind: 'shell', cwd: 'portal', cmd });

console.log('\n1  the join is the declared step, and nothing else');
{
  const rows = [
    row('applications', { do: [ui('Admin → Applications → Approve or Reject.', 'http://localhost:3000/app/admin')] }),
    row('build-7', { who: 'Peter', do: [{ kind: 'skill', what: 'Run make-bus-leaflet.' }, sh('node scripts/import-map.mjs')] }),
  ];
  const got = portalClicks(rows);
  check('a row with a portal-ui step is in', got.length === 1 && (got[0] || {}).key === 'applications', JSON.stringify(got.map((c) => c.key)));
  check('a row whose `who` is literally "Peter" but has no portal-ui step is OUT', !got.some((c) => c.key === 'build-7'));
  check('…which is the whole point: the join is not a regex over `who`', portalClicks([row('x', { who: 'Peter' })]).length === 0);
  check('a row with a shell step to the portal is OUT', portalClicks([row('y', { do: [sh('npm run deploy')] })]).length === 0);
  check('a row with a bare `what` step (no kind) is OUT', portalClicks([row('z', { do: [{ what: 'Think about it.' }] })]).length === 0);
}

console.log('\n2  what each entry carries, taken verbatim and never rewritten');
{
  // `= {}` for the reason given at `one()` above: this is the line the proving
  // run threw on, and a throw here costs eight later sections their report.
  const [c = {}] = portalClicks([row('review-4', {
    rank: 1, ageDays: 12, who: 'St Neots Town Council', title: 'Review "St Neots" v4.2 for publication',
    do: [ui('Open the review queue, work the three-item checklist, approve or send back.', 'https://busmaps.uk/app/review')],
  })]);
  check('the screen is the URL PATH', c.screen === '/app/review', c.screen);
  check('the url is kept whole, so the link still works', c.url === 'https://busmaps.uk/app/review', c.url);
  check('the step\'s own words are passed through unaltered', c.what === 'Open the review queue, work the three-item checklist, approve or send back.', c.what);
  check('the row\'s title comes across', /St Neots/.test(c.title), c.title);
  check('…and its age, so an old click reads old', c.ageDays === 12, String(c.ageDays));
  check('…and its rank, so a caller can band it', c.rank === 1, String(c.rank));
  check('…and its `who`, carried rather than parsed', c.who === 'St Neots Town Council', c.who);
}

console.log('\n3  the origin differs between the two portals and the screen does not');
{
  const local = one([row('a', { do: [ui('w', 'http://localhost:3000/app/admin')] })]);
  const live = one([row('a', { do: [ui('w', 'https://busmaps.uk/app/admin')] })]);
  check('dev checkout and live site give the SAME screen', local.screen === live.screen && local.screen === '/app/admin', `${local.screen} vs ${live.screen}`);
  check('a path with a fragment keeps only the path', screenOf(ui('w', 'https://busmaps.uk/app/admin#applications')) === '/app/admin');
  check('a query string does not become part of the screen', screenOf(ui('w', 'https://busmaps.uk/app/review?id=4')) === '/app/review');
}

console.log('\n4  a broken link is still work — it is never dropped');
{
  const got = portalClicks([row('broken', { do: [ui('Admin → Applications.', 'not a url at all')] })]);
  check('an unparseable url still yields an entry', got.length === 1);
  check('…whose screen is the raw string rather than null', (got[0] || {}).screen === 'not a url at all', String((got[0] || {}).screen));
  const none = portalClicks([row('nourl', { do: [{ kind: 'portal-ui', what: 'Click something.' }] })]);
  check('a portal-ui step with NO url still yields an entry', none.length === 1);
  check('…with screen null and url null, never a guess', (none[0] || {}).screen === null && (none[0] || {}).url === null);
}

console.log('\n5  order is the caller\'s, and more than one step is not assumed away');
{
  const rows = [
    row('first', { rank: 1, do: [ui('one', 'http://p/app/review')] }),
    row('second', { rank: 2, do: [ui('two', 'http://p/app/admin')] }),
    row('third', { rank: 3, do: [ui('three', 'http://p/app/admin')] }),
  ];
  check('rows come out in the order they went in', portalClicks(rows).map((c) => c.key).join(',') === 'first,second,third');
  check('reversing the input reverses the output — nothing re-sorts', portalClicks([...rows].reverse()).map((c) => c.key).join(',') === 'third,second,first');
  const two = portalClicks([row('multi', { do: [ui('a', 'http://p/app/admin'), sh('x'), ui('b', 'http://p/app/review')] })]);
  check('a row with TWO portal-ui steps yields two entries', two.length === 2, String(two.length));
  check('…in the row\'s own declared order', (two[0] || {}).what === 'a' && (two[1] || {}).what === 'b');
  check('CONTROL — portalSteps sees both and skips the shell between them', portalSteps(row('m', { do: [ui('a', 'u'), sh('x'), ui('b', 'u')] })).length === 2);
}

console.log('\n6  a hold is flagged and the row is still listed');
{
  const held = portalClicks([row('h', { onHold: [{ title: 'do not send this yet' }], do: [ui('w', 'http://p/app/review')] })]);
  check('a held row is NOT dropped from the summary', held.length === 1);
  check('…and is marked as held', (held[0] || {}).onHold === true);
  check('an unheld row is marked not-held, not undefined', one([row('u', { do: [ui('w', 'http://p/app/review')] })]).onHold === false);
  check('an empty onHold array is not a hold', one([row('e', { onHold: [], do: [ui('w', 'http://p/app/review')] })]).onHold === false);
}

console.log('\n7  demo rows are labelled rather than silently mixed in');
{
  const d = portalClicks([row('d', { demo: true, do: [ui('w', 'http://p/app/admin')] })]);
  check('a demo row that reached this far is flagged', (d[0] || {}).demo === true);
  check('…and the rendered line says so out loud', formatPortalClicks(d).some((l) => /\(demo data\)/.test(l)), formatPortalClicks(d).join('|'));
  check('a real row is not flagged', one([row('r', { do: [ui('w', 'http://p/app/admin')] })]).demo === false);
}

console.log('\n8  the rendering: silent when empty, complete when not');
{
  check('no clicks renders NO lines at all, not a heading over nothing', formatPortalClicks([]).length === 0);
  check('null renders nothing', formatPortalClicks(null).length === 0);
  const out = formatPortalClicks(portalClicks([
    row('applications', { ageDays: 9, do: [ui('Admin → Applications → Approve or Reject.', 'http://localhost:3000/app/admin')] }),
    row('review-4', { rank: 1, ageDays: 2, do: [ui('Open the review queue.', 'http://localhost:3000/app/review')] }),
  ])).join('\n');
  check('the heading names the block', /WAITING ON YOU IN THE PORTAL/.test(out));
  check('the count is the number of clicks and is plural-correct', /2 clicks only you can make/.test(out), out.split('\n')[1]);
  check('one click reads singular', /1 click only you can make/.test(formatPortalClicks(portalClicks([row('a', { do: [ui('w', 'http://p/app/admin')] })])).join('\n')));
  check('every screen appears', /\/app\/admin/.test(out) && /\/app\/review/.test(out));
  check('every step\'s words appear', /Approve or Reject/.test(out) && /Open the review queue/.test(out));
  check('the age appears', /\[9d\]/.test(out) && /\[2d\]/.test(out));
  check('it says each one is a row in full below', /row in full below/.test(out));
  // The promise has to match the OTHER output. Under --limit the list below is
  // cut and the block is not, so the untruncated sentence would be false — the
  // fault a real run caught and the reason `truncated` exists at all.
  const cut = formatPortalClicks(portalClicks([
    row('applications', { do: [ui('Admin → Applications.', 'http://localhost:3000/app/admin')] }),
    row('review-4', { rank: 1, do: [ui('Open the review queue.', 'http://localhost:3000/app/review')] }),
  ]), { truncated: true }).join('\n');
  check('under a cut list it does NOT promise every click is below', !/row in full below/.test(cut), cut.split('\n')[1]);
  check('…and says the cut is why', /cut short by --limit/.test(cut), cut.split('\n')[1]);
  check('the default is the untruncated sentence, so a caller that forgets the flag over-promises nothing new', /row in full below/.test(formatPortalClicks(portalClicks([row('a', { do: [ui('w', 'http://p/app/admin')] })])).join('\n')));
  check('a held row warns before the click', formatPortalClicks(portalClicks([row('h', { onHold: [{ t: 1 }], do: [ui('w', 'http://p/app/review')] })])).some((l) => /ON HOLD/.test(l)));
  const noAge = formatPortalClicks(portalClicks([row('n', { ageDays: null, do: [ui('w', 'http://p/app/admin')] })])).join('\n');
  check('a row with no age prints no bracket rather than [nulld]', !/\[/.test(noAge), noAge);
}

console.log('\n9  degenerate input does not throw — the board must still print');
{
  check('an empty list yields nothing', portalClicks([]).length === 0);
  check('undefined yields nothing', portalClicks(undefined).length === 0);
  check('a row with no `do` at all yields nothing', portalClicks([{ key: 'k', title: 't' }]).length === 0);
  check('a row whose `do` is not an array yields nothing', portalClicks([{ key: 'k', do: 'nope' }]).length === 0);
  check('a null step inside `do` is skipped', portalClicks([row('k', { do: [null, ui('w', 'http://p/app/admin')] })]).length === 1);
}

console.log('\n10  the real portal, when community-bus-maps is on this machine');
{
  /*
   * THE CASE THAT CATCHES THE SILENT FAILURE. Everything above tests this file
   * against rows this file's own harness invented; none of it would notice the
   * portal renaming `portal-ui`, which would leave the block permanently empty
   * and permanently green. So read the portal's own worklist module and count
   * the step kind in it. This is a grep and not an import on purpose: importing
   * buildWorklist would open its SQLite database, which is a side effect a
   * falsification harness has no business having.
   */
  const portalDir = resolvePortal();
  const wl = portalDir ? path.join(portalDir, 'src', 'worklist', 'index.js') : null;
  if (!wl || !fs.existsSync(wl)) {
    console.log(`  --  SKIPPED: no community-bus-maps checkout with src/worklist/index.js on this machine${portalDir ? ` (looked in ${portalDir})` : ''}; the join against the real row builder was not tested here`);
  } else {
    const src = fs.readFileSync(wl, 'utf8');
    const n = (src.match(/kind:\s*'portal-ui'/g) || []).length;
    check('the portal still builds rows with kind: \'portal-ui\'', n > 0, `found ${n}`);
    check(`…in more than one place (${n} today), so the block is not resting on a single row type`, n > 1, String(n));
    check('CONTROL — this grep can fail: a made-up kind is not found', (src.match(/kind:\s*'portal-ui-renamed'/g) || []).length === 0);
    /*
     * Every portal-ui step in that file carries BOTH a url and a what, which is
     * what this projection reads. A step that gained one without the other
     * would render a blank line on Peter's board.
     *
     * THE SLICE IS TAKEN TO THE END OF THE `add({ … });` CALL, not to a fixed
     * number of characters, and that is a correction rather than a preference.
     * Written first as `[\s\S]{0,400}?`, this check went RED on the fifth step
     * and read as a finding about the portal; the portal was fine and the window
     * was short — the unlisted-draft step's `what` is over 400 characters on its
     * own, so the scan stopped before it ever reached the `url:` two lines down.
     * A harness whose instrument is too small reports a fault in its subject,
     * which is this estate's *warning about the instrument* one layer up. The
     * control below is what makes the window falsifiable: it asserts the slice
     * actually reached a terminator, so a future step longer than the cut says
     * so instead of being reported as a missing field.
     */
    const ends = [];
    const steps = [];
    for (let i = src.indexOf("kind: 'portal-ui'"); i !== -1; i = src.indexOf("kind: 'portal-ui'", i + 1)) {
      const end = src.indexOf('});', i);
      ends.push(end !== -1);
      steps.push(src.slice(i, end === -1 ? src.length : end));
    }
    check('each step slice reached the end of its add() call, so the window cannot report a short read as a missing field', steps.length > 0 && ends.every(Boolean), `${ends.filter(Boolean).length} of ${ends.length}`);
    const withBoth = steps.filter((s) => /\bwhat:/.test(s) && /\burl:/.test(s)).length;
    check(`every portal-ui step in the portal carries both what and url (${withBoth}/${steps.length})`, steps.length > 0 && withBoth === steps.length, `${withBoth} of ${steps.length}`);
    check('CONTROL — that field test can fail: no step declares a field nobody wrote', steps.every((s) => !/\bnot_a_field:/.test(s)));
  }
  // And that the renderer in worklist.mjs still has a branch for the kind: if it
  // lost one, the list below would print the step wrong and the summary above it
  // would be the only place it read correctly — the two disagreeing, which is
  // the failure this whole file exists to prevent.
  const self = fs.readFileSync(new URL('./worklist.mjs', import.meta.url), 'utf8');
  check('worklist.mjs still renders portal-ui steps in the list below', /d\.kind === 'portal-ui'/.test(self));
  check('…and still feeds this projection from `shown`', /portalClicks\(shown\)/.test(self));
  check('…and still tells the renderer when the list below has been cut', /truncated: limited\.length < shown\.length/.test(self));
  check('CONTROL — that read reached a real file', self.length > 1000 && pathToFileURL(path.resolve('.')).href.length > 0);
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : '\n✓ every case held, and the block can be seen to include and exclude on the declared step');
process.exit(bad ? 1 : 0);
