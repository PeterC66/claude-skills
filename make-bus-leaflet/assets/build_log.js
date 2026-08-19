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
// TWO SEVERITIES, and the line between them is deliberate.
//
//   BLOCKING — the sheet is wrong. Something the config asked for was refused and is
//   absent from the artwork, or a label was drawn somewhere it means nothing. A reader
//   cannot tell either from the sheet; only this log can. rollout.js stops on these.
//
//   WARN — the sheet is tight, or a device moved itself, or the engine is reporting a
//   judgement it made. Worth reading, never worth blocking a build over.
//
// Classified on the MESSAGE, not on the prefix, so a guard added later inherits the
// right severity without anyone remembering to come back here: any guard that says it
// did not draw something is a refusal, and any guard that says a label names nothing
// is the fourth question. Prefixes change; those two phrases are the contract.
'use strict';
const fs = require('fs');
const path = require('path');

// A refusal: the engine declined to draw something the config asked for.
const REFUSED = /\bnot drawn\b/i;
// A label that landed somewhere it means nothing, or has nothing to name at all.
const MEANINGLESS = /\bnames nothing\b|\bhas no geometry\b/i;

function severity(line) {
  return (REFUSED.test(line) || MEANINGLESS.test(line)) ? 'BLOCKING' : 'WARN';
}

// Split a captured stderr blob into one entry per message. The generators write
// multi-line messages (a warning that names its own remedy usually wraps), and they
// end every one with a newline — so a line that starts with a `prefix:` token begins
// a new message and anything else is a continuation of the one before it.
const HEAD = /^[a-zA-Z][a-zA-Z0-9]*:\s/;
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

// Collect from several generator runs at once. `runs` is [{source, stderr}, ...].
function collect(runs) {
  const all = [];
  for (const r of runs || []) all.push(...parse(r.stderr, r.source));
  return all;
}

const blocking = entries => entries.filter(e => e.severity === 'BLOCKING');

function format(entries) {
  if (!entries.length) return 'No warnings — every generator ran clean.\n';
  const lines = [];
  const nb = blocking(entries).length;
  lines.push(`${entries.length} warning${entries.length === 1 ? '' : 's'}, ${nb} blocking.`);
  lines.push('');
  lines.push('BLOCKING means the engine refused to draw something, or drew a label that names');
  lines.push('nothing — the sheet is wrong and the reader cannot tell. Fix the config it names.');
  lines.push('');
  for (const sev of ['BLOCKING', 'WARN']) {
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
