// Build warnings — capture, classify and persist what the generators say on stderr.
//
// WHY THIS EXISTS. gen_internal.js alone carries four guards on feature labels: is
// the label inside the map frame, is it clear of the Services panel, is it clear of
// the footer plate, and is it anywhere near the thing it names. All four print to
// stderr and three of them REFUSE TO DRAW. Nothing captured that stream: rollout.js
// took stderr from spawnSync and threw it away on success, preview_design.js
// discarded it, and an S4/S5 run folder held no log at all. So on 2026-08-18 the
// engine said, in words, that St Ives' river name had been refused and that Ramsey's
// river name was 85mm from the river — and the sheets shipped anyway, with the
// defects found later by eye, one at a time, in Peter's 32-comment review.
//
// The fix is not another guard. It is to make the guards BITE: write what they said
// into the run folder beside the artwork, and refuse to publish a build carrying a
// warning that means the sheet is WRONG rather than merely tight.
//
// THREE SEVERITIES, and the lines between them are deliberate.
//
//   BLOCKING — the sheet is wrong. Something the config asked for was refused and is
//   absent from the artwork, a label was drawn somewhere it means nothing, or a device
//   was drawn past the edge of the space it was given. A reader cannot tell any of the
//   three from the sheet; only this log can. rollout.js stops on these.
//
//   WARN — the sheet is tight, or a device moved itself, or the engine is reporting a
//   judgement it made. Worth reading, never worth blocking a build over.
//
//   MEASURED — a NUMBER the engine records on every build, and never a fault at all
//   (OA-118, added 2026-08-30). Not a quieter warning: a measurement that has to be
//   phrased as a complaint to be written down is a measurement nobody records, and
//   this project has now spent two rounds trying to infer from the drawn page a
//   quantity the engine already held in a variable. `lane_normals.js`'s
//   `orientSegments()` returns `{sign, components, conflicts, bridges}`, and a
//   corridor with `conflicts === 0` has a consistent orientation and therefore no
//   lane mirrors BY CONSTRUCTION — nothing needs to be read off the artwork.
//   `quality_metrics.js` could not see a mirror, two detectors were written to find
//   one from the geometry and BOTH were disproved on rendered crops, and the answer
//   was in `gen_internal.js` behind a DBG_LANES flag the whole time.
//
// Classified on the MESSAGE, not on the prefix, so a guard added later inherits the
// right severity without anyone remembering to come back here: any guard that says it
// did not draw something is a refusal, and any guard that says a label names nothing
// is the fourth question. Prefixes change; those two phrases are the contract.
//
// MEASURED IS THE ONE EXCEPTION, and it is the exception on purpose. It classifies on
// a PREFIX, because the other rules read prose written for a person — which gets
// reworded, which is exactly why they are phrase rules — whereas a measurement is a
// structured record whose marker is part of its format. It is checked FIRST, so a
// payload that happens to contain the words "not drawn" is still a measurement and
// not a refusal.
'use strict';
const fs = require('fs');
const path = require('path');

// A refusal: the engine declined to draw something the config asked for.
const REFUSED = /\bnot drawn\b/i;
// A label that landed somewhere it means nothing, or has nothing to name at all.
const MEANINGLESS = /\bnames nothing\b|\bhas no geometry\b/i;
// A device drawn PAST the edge of the space it was given. Added 2026-08-23, after Ely
// Co-op shipped a Key whose last rows — including a whole frequency tier — ran under
// the footer plate and off the page. gen_internal.js clamps the row pitch at its floor
// and then draws anyway, so this is not a refusal in the "not drawn" sense: the ink
// exists, it is simply somewhere no reader will ever see it. That is worse than
// absent, not better, and it is the same failure the boarding sheet already hit once
// (Stop E painted out under the plate on a sheet that rendered clean and gated PASS).
// It was WARN, so nothing stopped, and the sheet went into a review set.
//
// PROMOTED 2026-08-28 (OA-065). `gen_internal.js`'s mapNotes guard says a note
// "ends at y=…, inside/near the footer plate" — the same failure as the Ely
// Co-op Key that ran under the plate, and it shipped on all three diagram towns
// for the same reason: it was WARN, so nothing stopped. The words differ from the
// two already here, which is exactly why neither caught it — this file classifies
// on the MESSAGE, and a phrase that is not in the list is not in the contract.
// Swept over all 20 committed maps on 2026-08-28 before promoting it: 48 generator
// runs, ZERO footer-plate messages of any wording, so the gate starts green, which
// is the precondition OA-065 named. tools/prove-red-build-log.js is the proof it
// can still go red.
const OVERFLOWED = /\bunder the footer plate\b|\binside\/near the footer plate\b|\btoo long for this panel\b|\bpast the frame edge\b/i;
// A generator that DIED. Every rule above is a text rule and an uncaught exception
// is not phrased like a guard, so before 2026-08-28 a stack trace scored WARN —
// the mildest verdict this file has, for the one outcome where no sheet exists at
// all. Found while sweeping the estate for OA-065: ten runs exited non-zero and
// every one was filed as "worth reading, never worth blocking a build over".
const CRASHED = /^[A-Za-z]*Error:|^\s*at .+:\d+:\d+\)?$|\bis not vendored\b/m;
// A MEASUREMENT (OA-118). The marker is the prefix, not a phrase — see the header.
const MEASURED = /^\s*measure:\s/;

function severity(line) {
  // FIRST, and this order is load-bearing: a measurement's payload is arbitrary
  // text and may legitimately contain any of the phrases below.
  if (MEASURED.test(String(line))) return 'MEASURED';
  return (REFUSED.test(line) || MEANINGLESS.test(line) || OVERFLOWED.test(line)
          || CRASHED.test(line)) ? 'BLOCKING' : 'WARN';
}

// Split a captured stderr blob into one entry per message. The generators write
// multi-line messages (a warning that names its own remedy usually wraps), and they
// end every one with a newline — so a line that starts with a `prefix:` token begins
// a new message and anything else is a continuation of the one before it.
// A prefix token may carry an underscore: `gen_internal_place:` is one, and
// without this it was not recognised as a message head at all, so its entry got
// an empty `code` and the NEXT line would have been glued onto it as a
// continuation. Widened 2026-08-28, with no change to any classified entry on
// the 20 committed maps.
const HEAD = /^[a-zA-Z][a-zA-Z0-9_]*:\s/;
function parse(stderr, source) {
  const out = [];
  for (const raw of String(stderr || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (HEAD.test(line) || !out.length) out.push({ source, text: line });
    else out[out.length - 1].text += ' ' + line.trim();
  }
  return out.map(e => ({ ...e, code: (e.text.match(HEAD) || [''])[0].trim().replace(/:$/, ''),
                         severity: severity(e.text) }));
}

// Collect from several generator runs at once. `runs` is
// [{source, stderr, ok}, ...] — `ok` is optional, and where it is given a FALSE
// is blocking on its own account.
//
// WHY THE EXIT STATUS AND NOT ONLY THE TEXT. Every rule above is a text rule, and
// a text rule can only catch a failure that is PHRASED like one. A generator that
// dies of a bad path, a missing vendored file or an uncaught exception may say
// anything at all, or nothing — and then the log records a clean run, because
// "no message matched" and "no message" are the same thing to a matcher. The
// caller already knows the exit status; passing it in is free and closes the whole
// class. A run with no `ok` key behaves exactly as it did before.
function collect(runs) {
  const all = [];
  for (const r of runs || []) {
    all.push(...parse(r.stderr, r.source));
    if (r.ok === false && !all.some(e => e.source === r.source && e.severity === 'BLOCKING')) {
      all.push({ source: r.source, code: 'exit',
                 text: `exit: ${r.source} exited non-zero and produced no sheet`,
                 severity: 'BLOCKING' });
    }
  }
  return all;
}

const blocking = entries => entries.filter(e => e.severity === 'BLOCKING');

function format(entries) {
  if (!entries.length) return 'No warnings — every generator ran clean.\n';
  const lines = [];
  const nb = blocking(entries).length;
  // Measurements are counted APART from warnings, or every build reports more
  // faults than it has — and since the lane measurement is unconditional, every
  // build has at least one. A count that inflates the moment a measurement is
  // added is a count nobody will trust the next time it moves.
  const nm = entries.filter(e => e.severity === 'MEASURED').length;
  const nw = entries.length - nm;
  lines.push(`${nw} warning${nw === 1 ? '' : 's'}, ${nb} blocking`
    + (nm ? `, and ${nm} measurement${nm === 1 ? '' : 's'}.` : '.'));
  lines.push('');
  lines.push('BLOCKING means the engine refused to draw something, or drew a label that names');
  lines.push('nothing — the sheet is wrong and the reader cannot tell. Fix the config it names.');
  lines.push('MEASURED is a number this build recorded. It is never a fault.');
  lines.push('');
  for (const sev of ['BLOCKING', 'WARN', 'MEASURED']) {
    const set = entries.filter(e => e.severity === sev);
    if (!set.length) continue;
    lines.push(`--- ${sev} (${set.length}) ---`);
    for (const e of set) lines.push(`[${e.source}] ${e.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

// Written into the run folder beside the artwork it describes, ALWAYS — including
// when it is empty. A missing file is ambiguous (clean run, or a build that predates
// this?); a file saying "no warnings" is evidence.
const LOG_NAME = 'build-warnings.txt';
function write(dir, entries) {
  fs.writeFileSync(path.join(dir, LOG_NAME), format(entries));
  return LOG_NAME;
}

module.exports = { parse, collect, blocking, format, write, severity, LOG_NAME };
