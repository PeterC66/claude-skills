/* OA-424 — an S6 commit leaves its report behind unless somebody stages it.
 * `.gitignore` re-includes every `*.docx` under Areas/ and Places/, so they are
 * meant to be tracked, yet `disagreements.docx` (copied in by `pull S1`) and
 * `_latest/verification.docx` were left untracked by four builds. The buses-data
 * pre-commit hook REFUSES the run-folder case; this is the earlier, engine-side
 * half: it names the files while the person who ran the build is still looking.
 * A NOTE, never a refusal, for the reason refreshLatestMirror() in stage.js gives:
 * the commit has already happened. Silent when git is absent or the map is not in
 * a repository. A module of its own because stage.js is under a line ceiling. */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

function note(townDir, runDir) {
  const r = spawnSync('git', ['-C', townDir, 'ls-files', '--others', '--exclude-standard', '--', runDir, path.join(townDir, '_latest')], { encoding: 'utf8' });
  if (r.status !== 0) return;
  const docx = String(r.stdout || '').split(/\r?\n/).filter(l => /\.docx$/i.test(l));
  if (!docx.length) return;
  console.log(`  NOTE: ${docx.length} .docx file(s) from this S6 are untracked and will be left out of the commit unless staged by name:`);
  for (const d of docx) console.log('    ' + d);
}

module.exports = { note };
