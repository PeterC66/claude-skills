#!/usr/bin/env node
/*
 * adopt.mjs — the edits Peter finished in the main buses-data tree, which a
 * scheduled tick may commit for him (buses-data OA-542).
 *
 * From any folder, with no placeholders, to see what a tick would do:
 *
 *   node "C:/u3a St Ives/.claude/skills/bus-work/assets/adopt.mjs" --json
 *
 * and, as a tick, to do it — `<run name>` is the tick's own `sched-HHMM`:
 *
 *   node "C:/u3a St Ives/.claude/skills/bus-work/assets/adopt.mjs" --apply --by <run name>
 *
 * WHY THIS EXISTS. On 2026-10-01 ticks 00:15, 01:15 and 02:15 all stopped at the
 * dirty-tree check on `.claude/settings.json`. Peter had edited it at 23:21 the
 * night before exactly as the hold `s4-svg-read-deny.md` asked, and step 2 of the
 * loop's prompt says never commit a file you did not write. The old orphan
 * adoption was retired on 2026-09-21 because its conditions never held. Peter
 * approved this replacement on 2026-10-01, and the conjunction below is the whole
 * of what he approved.
 *
 * WHAT A TICK MAY COMMIT. A path is adopted under one of two rules:
 *
 *   (a) a modified tracked file that a LIVE hold in `loop/your-move/` names in its
 *       `**File:**` field, when `git diff HEAD` shows exactly the change the hold
 *       spells out in a ```diff block and nothing else. The hold is then retired.
 *   (b) a modified tracked `.md` under `Documentation/`, `Development Docs/` or
 *       `BusMapsUK/`, untouched for 30 minutes or more, while check-tables,
 *       check-doc-links and check-file-hygiene are all green.
 *
 * WHAT IT NEVER COMMITS, whatever a hold says: anything under `Correspondence/`,
 * `Areas/` or `Places/`; an untracked, staged, deleted or renamed path; the
 * generated `Development Docs/open-actions.md`; and a settings change the hold did
 * not spell out — which needs no rule of its own, because a settings file is not a
 * `.md` and so can only arrive by (a), whose diff must match exactly. A path a live
 * hold names is judged by (a) ALONE: a doc whose hold asked for a different change
 * is not rescued by being quiet and green.
 *
 * ONE COMMIT PER PATH, by pathspec, subject `adopt: Peter's edit to <path>`. The
 * word is greppable on purpose, as it was for the rule this replaces. Each path is
 * re-read immediately before its commit and the commit is read back afterwards:
 * the path must be clean and HEAD's subject must be the one written.
 *
 * PURE CORE, INJECTED EDGES, like gtfs_uncommitted.mjs: `decide()` is a function
 * of the facts, `gather()` is the only thing that reads git, the disk and the
 * checkers, and each edge is a parameter. That is what lets
 * prove-red-adopt.mjs falsify every exclusion with a stub and again against a
 * real repository.
 *
 * Exit codes, per buses-data `Documentation/README - Conventions.md`: 0 decided
 * (adopting nothing is a normal answer); 1 an `--apply` commit failed or did not
 * read back; 2 used wrongly, or the tree is not one a tick may commit in.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses } from './engine.mjs';
import { readYourMoveDir, classify, parseHold } from './loop_your_move.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..', '..', 'tools');

export const QUIET_MIN = 30;
export const NEVER_ROOTS = ['Correspondence/', 'Areas/', 'Places/'];
export const DOC_ROOTS = ['Documentation/', 'Development Docs/', 'BusMapsUK/'];
export const GENERATED = new Set(['Development Docs/open-actions.md']);
export const CHECKERS = [
  { name: 'check-tables', argv: ['check-tables.mjs'] },
  { name: 'check-doc-links', argv: ['check-doc-links.mjs'] },
  { name: 'check-file-hygiene', argv: ['check-file-hygiene.mjs', '--root', '.'] },
];

/** git in `dir`: stdout untrimmed, or null on any failure. */
export const defaultGit = (dir, argv) => {
  try {
    return execFileSync('git', ['-C', dir, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

/**
 * `git status --porcelain=v1 -z -uall` into { code, path }. -z because a path
 * with a space or a non-ASCII character is quoted in the ordinary form and
 * verbatim in this one. A rename or copy carries its source as the NEXT record,
 * which is consumed so it is not read as an entry of its own.
 */
export function parseStatusZ(text) {
  const out = [];
  const recs = String(text || '').split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.length < 4) continue;
    const code = r.slice(0, 2);
    out.push({ code, path: r.slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i++;
  }
  return out;
}

/**
 * The changed lines of a unified diff, in order: every `+`, `-` and `\` line
 * inside a hunk. File headers before the first `@@` are skipped, which is why a
 * removed line that itself begins `--` is still read as a change. A trailing CR
 * is dropped so a hold written on Windows compares equal to git's output; nothing
 * else is normalised, because "exactly the change" is the rule.
 */
export function changedLines(diffText) {
  const out = [];
  let inHunk = false;
  for (const raw of String(diffText || '').split('\n')) {
    const l = raw.replace(/\r$/, '');
    if (l.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (l.startsWith('diff --git ')) { inHunk = false; continue; }
    if (l[0] === '+' || l[0] === '-' || l[0] === '\\') out.push(l);
  }
  return out;
}

/** The first ```diff fenced block in a hold, or null. */
export function holdDiff(text) {
  const m = /^```diff[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m.exec(String(text || ''));
  return m ? m[1] : null;
}

const under = (p, roots) => roots.some((r) => p.startsWith(r));

/** A porcelain code in words, for the refusal. Chooses wording only. */
export function codeWords(code) {
  if (code === '??') return 'untracked';
  if (code[0] !== ' ') return `staged (${JSON.stringify(code)})`;
  if (code[1] === 'D') return 'deleted';
  return `not a modification (${JSON.stringify(code)})`;
}

/**
 * The verdict for every dirty path. Pure.
 *
 * @param {object} f
 * @param {Array<{code, path}>} f.entries   parseStatusZ output
 * @param {Array<{ref, file, namesPath, text}>} f.holds  LIVE holds only
 * @param {Record<string,string|null>} f.diffs   `git diff HEAD -- <path>` per path
 * @param {Record<string,number|null>} f.mtimes  mtimeMs per path
 * @param {{ok: boolean, failed?: string[]}|null} f.checks  the three checkers, or null if not run
 * @param {number} f.now
 * @returns {Array<{path, code, adopt: boolean, rule: 'a'|'b'|null, hold?: string, why: string}>}
 */
export function decide({ entries = [], holds = [], diffs = {}, mtimes = {}, checks = null, now = Date.now() }) {
  const out = [];
  for (const e of entries) {
    const p = e.path.replace(/\\/g, '/');
    const v = { path: p, code: e.code, adopt: false, rule: null };
    const refuse = (why) => { v.why = why; out.push(v); };

    if (under(p, NEVER_ROOTS)) { refuse(`under ${NEVER_ROOTS.find((r) => p.startsWith(r))} — never adopted`); continue; }
    // ONE guard, not three: untracked, staged, deleted and renamed are all "not
    // exactly ' M'", and three tests in a row would let the first two be deleted
    // with every case still green because the third catches them. The wording
    // varies; the decision is this one comparison.
    if (e.code !== ' M') { refuse(`${codeWords(e.code)} — only a modified, unstaged, tracked file is adopted`); continue; }
    if (GENERATED.has(p)) { refuse('a generated file — the pre-commit hook rebuilds it'); continue; }

    const naming = holds.filter((h) => h.namesPath === p);
    if (naming.length) {
      v.rule = 'a';
      const got = changedLines(diffs[p]);
      if (!got.length) { refuse('rule (a): git shows no textual change for this path'); continue; }
      let matched = null;
      const tried = [];
      for (const h of naming) {
        const spelled = holdDiff(h.text);
        if (spelled === null) { tried.push(`${h.ref}: spells out no \`\`\`diff block`); continue; }
        const want = changedLines(spelled);
        if (!want.length) { tried.push(`${h.ref}: its diff block has no changed lines`); continue; }
        if (want.length === got.length && want.every((l, i) => l === got[i])) { matched = h; break; }
        const at = want.findIndex((l, i) => l !== got[i]);
        tried.push(`${h.ref}: the working tree differs from its diff at changed line ${at < 0 ? want.length + 1 : at + 1} (${got.length} changed in the tree, ${want.length} in the hold)`);
      }
      if (!matched) { refuse(`rule (a), judged by the hold alone: ${tried.join('; ')}`); continue; }
      v.adopt = true;
      v.lines = got;
      v.hold = matched.ref;
      v.holdFile = matched.file;
      v.why = `rule (a): ${matched.ref} names it and the diff is exactly the one it spells out`;
      out.push(v);
      continue;
    }

    v.rule = 'b';
    if (!/\.md$/i.test(p)) { refuse('rule (b) is for .md documents only, and no live hold names this path'); continue; }
    if (!under(p, DOC_ROOTS)) { refuse(`rule (b) is for ${DOC_ROOTS.join(', ')} only`); continue; }
    const m = mtimes[p];
    if (typeof m !== 'number') { refuse('rule (b): its modification time could not be read'); continue; }
    const ageMin = (now - m) / 60000;
    if (ageMin < 0) { refuse('rule (b): its modification time is in the future'); continue; }
    if (ageMin < QUIET_MIN) { refuse(`rule (b): touched ${Math.floor(ageMin)} min ago, under ${QUIET_MIN}`); continue; }
    if (!checks) { refuse('rule (b): the checkers were not run'); continue; }
    if (!checks.ok) { refuse(`rule (b): not green — ${(checks.failed || []).join(', ') || 'a checker'} failed`); continue; }
    v.adopt = true;
    v.mtime = m;
    v.ageMin = Math.floor(ageMin);
    v.why = `rule (b): untouched ${Math.floor(ageMin)} min, check-tables, check-doc-links and check-file-hygiene green`;
    out.push(v);
  }
  return out;
}

/** Run the three checkers from the repository root. */
export function defaultChecks(root, tools = TOOLS) {
  const failed = [];
  for (const c of CHECKERS) {
    const script = path.join(tools, c.argv[0]);
    if (!existsSync(script)) { failed.push(`${c.name} (missing)`); continue; }
    const r = spawnSync(process.execPath, [script, ...c.argv.slice(1)], { cwd: root, stdio: 'ignore' });
    if (r.status !== 0) failed.push(c.name);
  }
  return { ok: failed.length === 0, failed };
}

/** Holds that are in the folder NOW, with their text, for decide(). */
export function liveHolds(yourMoveDir) {
  const out = [];
  for (const f of classify(readYourMoveDir(yourMoveDir)).holds) {
    let h;
    try { h = parseHold(f); } catch { continue; }
    out.push({ ref: h.ref, file: f.name, namesPath: h.namesPath, text: f.text });
  }
  return out;
}

/**
 * Why this tree is not one a tick may commit in, or null. A rebase or a merge in
 * flight, or a checkout off main, is somebody's operation, not somebody's edit.
 */
export function treeRefusal(root, git = defaultGit) {
  const branch = git(root, ['branch', '--show-current']);
  if (branch === null) return 'git could not read the branch';
  if (branch.trim() !== 'main') return `the checkout is on ${JSON.stringify(branch.trim())}, not main`;
  const gitDir = (git(root, ['rev-parse', '--absolute-git-dir']) || '').trim();
  for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (gitDir && existsSync(path.join(gitDir, marker))) return `a ${marker} is in progress`;
  }
  return null;
}

/** Read every fact decide() needs. */
export function gather({ root, git = defaultGit, checks = defaultChecks, now = Date.now(), stat = statSync } = {}) {
  const status = git(root, ['status', '--porcelain=v1', '-z', '-uall']);
  if (status === null) return { error: 'git status failed' };
  const entries = parseStatusZ(status);
  const holds = liveHolds(path.join(root, 'loop', 'your-move'));
  const diffs = {};
  const mtimes = {};
  for (const e of entries) {
    if (e.code === ' M') {
      diffs[e.path] = git(root, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', e.path]);
      try { mtimes[e.path] = stat(path.join(root, e.path)).mtimeMs; } catch { mtimes[e.path] = null; }
    }
  }
  // The checkers cost seconds, so they run only when some path could turn on them.
  const pre = decide({ entries, holds, diffs, mtimes, checks: { ok: true }, now });
  const needChecks = pre.some((v) => v.adopt && v.rule === 'b');
  const checkResult = needChecks ? checks(root) : null;
  return { entries, holds, diffs, mtimes, checks: checkResult, now };
}

export const subjectFor = (p) => `adopt: Peter's edit to ${p}`;

function messageFor(v, by) {
  const lines = [subjectFor(v.path), ''];
  if (v.rule === 'a') {
    lines.push(`Adopted by ${by} under rule (a) of loop/README.md's adoption section (buses-data OA-542): the live hold ${v.hold} named this file in its File: field and the working tree held exactly the change its diff block spells out. The hold is retired to loop/retired/.`);
  } else {
    lines.push(`Adopted by ${by} under rule (b) of loop/README.md's adoption section (buses-data OA-542): a document untouched for ${v.ageMin} minutes, with check-tables, check-doc-links and check-file-hygiene green.`);
  }
  lines.push('', 'Which session made the edit is not recorded anywhere; git reset --soft HEAD~1 undoes this commit and loses nothing.', '');
  return lines.join('\n');
}

/**
 * Move a satisfied hold to loop/retired/ with a RESOLVED section. Until buses-data
 * OA-610 (2026-10-08) a retired hold went to loop/adhoc/done/; that queue became
 * the separate ad-hoc loop's `adhoc/`, and a retired hold is nobody's work, so it
 * goes to loop/retired/, which nothing reads and which keeps the reason.
 */
export function retireHold(root, holdFile, { by, sha, subject, date }) {
  const from = path.join(root, 'loop', 'your-move', holdFile);
  const doneDir = path.join(root, 'loop', 'retired');
  mkdirSync(doneDir, { recursive: true });
  let to = path.join(doneDir, holdFile);
  if (existsSync(to)) to = path.join(doneDir, `${date}_${holdFile}`);
  const text = readFileSync(from, 'utf8');
  const tail = `${text.endsWith('\n') ? '' : '\n'}\n## RESOLVED\n\n${by}, ${date}: adopted by adopt.mjs (buses-data OA-542) — commit ${sha}, "${subject}", carries exactly the change this hold spelled out.\n`;
  writeFileSync(from, text + tail);
  renameSync(from, to);
  return to;
}

/**
 * Commit each adoptable path. Re-reads the path's status and diff immediately
 * before committing it, so an edit made after the decision is not what lands
 * under the decision's name, and reads each commit back afterwards.
 */
export function apply({ root, verdicts, by, git = defaultGit, now = Date.now(), commit = defaultCommit, stat = statSync }) {
  const done = [];
  const date = new Date(now).toISOString().slice(0, 10);
  for (const v of verdicts.filter((x) => x.adopt)) {
    const st = parseStatusZ(git(root, ['status', '--porcelain=v1', '-z', '--', v.path]) || '');
    if (st.length !== 1 || st[0].code !== ' M') { done.push({ path: v.path, ok: false, why: 'its status changed since the decision' }); continue; }
    if (v.rule === 'a') {
      const again = changedLines(git(root, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', v.path]));
      const before = v.lines || [];
      if (again.length !== before.length || again.some((l, i) => l !== before[i])) { done.push({ path: v.path, ok: false, why: 'its diff changed since the decision' }); continue; }
    } else {
      let m = null;
      try { m = stat(path.join(root, v.path)).mtimeMs; } catch { /* unreadable reads as changed */ }
      if (m !== v.mtime) { done.push({ path: v.path, ok: false, why: 'it was written again since the decision' }); continue; }
    }
    const subject = subjectFor(v.path);
    const r = commit(root, v.path, messageFor(v, by));
    if (!r.ok) { done.push({ path: v.path, ok: false, why: `the commit failed: ${r.why}` }); return { done, failed: true }; }
    const head = (git(root, ['log', '-1', '--format=%H%x00%s']) || '').trim().split('\0');
    const after = git(root, ['status', '--porcelain=v1', '-z', '--', v.path]);
    if (head[1] !== subject || after !== '') { done.push({ path: v.path, ok: false, why: `the commit did not read back (HEAD ${JSON.stringify(head[1])}, path ${after ? 'still dirty' : 'clean'})` }); return { done, failed: true }; }
    const rec = { path: v.path, ok: true, sha: head[0].slice(0, 8), subject, rule: v.rule };
    if (v.rule === 'a') rec.retired = retireHold(root, v.holdFile, { by, sha: rec.sha, subject, date });
    done.push(rec);
  }
  return { done, failed: done.some((d) => !d.ok) };
}

function defaultCommit(root, p, message) {
  const r = spawnSync('git', ['-C', root, 'commit', '-q', '-F', '-', '--', p], { input: message, encoding: 'utf8' });
  return r.status === 0 ? { ok: true } : { ok: false, why: (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / ') || `exit ${r.status}` };
}

/** The engine's shared parser, then a refusal by name for any flag this script does not know. */
function readArgs(f) {
  const known = ['json', 'apply', 'by', 'buses'];
  // The engine's parser carries positional words under `_`; this script takes none.
  if (Array.isArray(f._) && f._.length) return { error: `unexpected argument ${JSON.stringify(f._[0])}` };
  const unknown = Object.keys(f).filter((k) => k !== '_' && !known.includes(k));
  if (unknown.length) return { error: `unknown flag --${unknown[0]}; known: ${known.map((k) => '--' + k).join(' ')}` };
  const a = { json: f.json === true, apply: f.apply === true, by: typeof f.by === 'string' ? f.by : null, buses: typeof f.buses === 'string' ? f.buses : null };
  if (f.apply !== undefined && f.apply !== true) return { error: '--apply takes no value' };
  if (a.apply && !a.by) return { error: '--apply needs --by <run name>' };
  return a;
}

function main() {
  const args = readArgs(parseArgs(process.argv.slice(2)));
  if (args.error) { console.error(`adopt: ${args.error}`); process.exit(2); }
  const root = resolveBuses({ buses: args.buses });
  const refusal = treeRefusal(root);
  if (refusal) { console.error(`adopt: not adopting anything — ${refusal}`); process.exit(2); }
  const facts = gather({ root });
  if (facts.error) { console.error(`adopt: ${facts.error}`); process.exit(2); }
  const verdicts = decide(facts);
  let result = null;
  if (args.apply) result = apply({ root, verdicts, by: args.by });
  const report = {
    root,
    adopt: verdicts.filter((v) => v.adopt).map(({ lines, ...v }) => v),
    refused: verdicts.filter((v) => !v.adopt),
    checks: facts.checks,
    applied: result ? result.done : null,
  };
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    if (!verdicts.length) console.log('adopt: the tree is clean — nothing to adopt.');
    for (const v of report.adopt) console.log(`ADOPT   ${v.path} — ${v.why}`);
    for (const v of report.refused) console.log(`refuse  ${v.path} — ${v.why}`);
    for (const d of report.applied || []) console.log(d.ok ? `ADOPTED ${d.path} — ${d.sha} "${d.subject}"${d.retired ? `; hold retired to ${path.relative(root, d.retired).replace(/\\/g, '/')}` : ''}` : `FAILED  ${d.path} — ${d.why}`);
  }
  process.exit(result && result.failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
