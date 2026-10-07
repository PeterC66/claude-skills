/*
 * pin_behind.js — is a vendoring mismatch the PORTAL being ahead of the engine
 * this checkout is pinned to, rather than the portal being wrong? (buses-data
 * OA-480, 2026-09-27)
 *
 * buses-data's gates.yml checks claude-skills out at engine.lock.json's commit
 * and compares it with the portal's floating `origin/main`. A tick that merges an
 * engine PR and re-vendors the portal puts the portal AHEAD of that pin, and the
 * pin moves only when the estate adopts the engine (OA-430), which nothing does on
 * a clock. So twelve hours later `portalDrift()` in status.js called the rows
 * DRIFTED and reddened main: four runs on 2026-09-25 (OA-396) and every push from
 * 07:45 on 2026-09-27 (icons.js, services_panel.js, gen_external_radial.js).
 *
 * Being behind is work waiting, not a sheet that is wrong (R3 of the 2026-09-17
 * process review), so such a row is a CHORE: printed as PIN-BEHIND, carried by the
 * worklist, and out of the exit code. The witness is deliberately narrow and every
 * doubt reads red: the checkout's HEAD must be an ancestor of claude-skills'
 * `origin/main`, and the portal's bytes must equal the source file at a commit in
 * `HEAD..origin/main` that touched it. A hand edit in the portal, a re-vendor from
 * an unmerged skills branch, a portal BEHIND the pin, a clone with no
 * `origin/main` or too shallow to answer — each returns null, which is DRIFTED.
 *
 * Offline: it reads refs that are already there. gates.yml fetches claude-skills'
 * main for it (the step named beside this file's purpose there).
 */
'use strict';
const { execFileSync } = require('node:child_process');
const { sameBytesIgnoringLineEndings } = require('./line_endings');

function git(dir, args, encoding = 'utf8') {
  try {
    const out = execFileSync('git', args, { cwd: dir, encoding, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return encoding === 'utf8' ? out.trim() : out;
  } catch { return null; }
}

/* One asker per skills repository, so the ancestry question is asked once a run
 * however many rows drifted. `pin` is a revision in that repository: HEAD for the
 * board (the engine it is running), engine.lock.json's commit for the worklist. */
function pinBehindAsker(skillsRoot, pin = 'HEAD') {
  const pinSha = git(skillsRoot, ['rev-parse', '--verify', '--quiet', pin + '^{commit}']);
  const tipSha = git(skillsRoot, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}']);
  const descends = !!(pinSha && tipSha && git(skillsRoot, ['merge-base', pinSha, tipSha]) === pinSha);
  const short = (s) => s.slice(0, 7);
  return {
    pin: pinSha ? short(pinSha) : null,
    tip: tipSha ? short(tipSha) : null,
    descends,
    /* The newest commit after the pin, on origin/main, whose `source` is the
     * portal's bytes; null when there is none. */
    commitFor(source, portalBuf) {
      if (!descends || !portalBuf || pinSha === tipSha) return null;
      const rel = String(source).replace(/\\/g, '/');
      const log = git(skillsRoot, ['log', '--format=%H', pinSha + '..' + tipSha, '--', rel]);
      for (const sha of String(log || '').split('\n').filter(Boolean)) {
        const blob = git(skillsRoot, ['show', sha + ':' + rel], 'buffer');
        if (blob && sameBytesIgnoringLineEndings(blob, portalBuf)) return { commit: short(sha), pin: short(pinSha), tip: short(tipSha) };
      }
      return null;
    },
  };
}

/* The worklist's half: every vendored file on the portal's `ref` whose bytes are
 * not the pin's and ARE a later origin/main's. Rows only; an ordinary drift is
 * the board's to report, not this. */
function pinBehindRows({ portal, skillsRoot, pin, ref = 'origin/main' }) {
  const asker = pinBehindAsker(skillsRoot, pin);
  const out = { pin: asker.pin, tip: asker.tip, rows: [] };
  if (!asker.descends) return out;
  let manifest = null;
  try { manifest = JSON.parse(git(portal, ['show', ref + ':engine/vendored.json']) || 'null'); } catch { manifest = null; }
  for (const e of (manifest && Array.isArray(manifest.files) ? manifest.files : [])) {
    if (e.kind === 'portal-owned' || !e.source) continue;
    const portalBuf = git(portal, ['show', ref + ':engine/' + String(e.path).replace(/\\/g, '/')], 'buffer');
    const pinBuf = git(skillsRoot, ['show', asker.pin + ':' + String(e.source).replace(/\\/g, '/')], 'buffer');
    if (!portalBuf || (pinBuf && sameBytesIgnoringLineEndings(pinBuf, portalBuf))) continue;
    const hit = asker.commitFor(e.source, portalBuf);
    if (hit) out.rows.push({ file: e.path, source: e.source, commit: hit.commit });
  }
  return out;
}

/* The bus-work worklist's row, built here so worklist.mjs carries one line of
 * wiring. Null when buses-data has no readable pin or nothing is behind it. The
 * `engine-stale` key prefix gives it the rollout's concurrency needs in
 * concurrency.mjs, which is what adopting an engine is. */
function pinBehindItem({ buses, portal, skillsRoot }) {
  let pin = null;
  try { pin = JSON.parse(require('node:fs').readFileSync(require('node:path').join(buses, 'engine.lock.json'), 'utf8')).commit; } catch { pin = null; }
  const pb = pin ? pinBehindRows({ portal, skillsRoot, pin }) : null;
  if (!pb || !pb.rows.length) return null;
  return {
    key: 'engine-stale-pin', rank: 8, type: 'housekeeping',
    title: `engine.lock.json pins ${pb.pin}; the portal runs a newer engine`,
    why: `${pb.rows.map((r) => r.file).join(', ')} in the portal came from claude-skills ${[...new Set(pb.rows.map((r) => r.commit))].join(', ')}, after the pin. `
      + 'status.js at the pin reads them PIN-BEHIND, a chore and not red; adopting the engine clears it (buses-data OA-480).',
    who: '—', runbook: 'engine',
    do: [{ kind: 'shell', cwd: buses, cmd: `node ".github/scripts/engine-pin.mjs" --bump --skills "${String(skillsRoot).replace(/\\/g, '/')}"`,
      note: 'after the weekly shadow rebuild has named the engine to adopt (it refuses otherwise); run it with no --bump first to see what it would say' }],
  };
}

module.exports = { pinBehindAsker, pinBehindRows, pinBehindItem };
