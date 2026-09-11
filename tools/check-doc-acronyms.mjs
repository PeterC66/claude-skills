// Check that every short form a reader MEETS is one they can look up.
//
// WHY THIS EXISTS. On 10 September 2026 Peter asked what `OA` and `SF` stood
// for, and neither was expanded anywhere in the estate — `OA` had been used
// 1,970 times. A scan turned up about forty more with no entry anywhere, and the
// worst was `EP`: ten uses in the strategy work, all of them load-bearing (*"the
// multi-operator information your EP scheme requires"* opens the outreach case),
// and not one expansion in any document in any of the three repositories. The
// glossary's `Abbreviations and reference codes` section was written that day;
// this checker is about the reason those forty went unnoticed for months.
//
// **No check asks the question at all.** The gap survived nine widenings of
// `check-tables.mjs` and `check-doc-links.mjs` because neither checker can see
// it. A link checker asks whether a pointer resolves. A table checker asks
// whether a row is a row. A hygiene checker asks about bytes. Every one of them
// asks about STRUCTURE, and this is the one documentation fault that is about
// COMPREHENSION — and the one that costs a NEW READER rather than a session.
// buses-data OA-300.
//
// WHERE IT LIVES. Beside the three checkers that already travel, and for the
// reason OA-246 settled: buses-data is PRIVATE, `claude-skills` and
// `community-bus-maps` are PUBLIC, and all three run these. A shared rule
// belongs in the repository anyone can read, so nothing hangs off a cross-repo
// token's expiry date.
//
// THE RULE TRAVELS; THE SCOPE STAYS HOME. The two thresholds below and the three
// definition recognisers are the RULE and live here. What each repository
// declares in a `.doc-acronyms.json` at its own root is its SCOPE: which folders
// hold its documents, which documents define, which short forms are not ours to
// define and why. Resolved against the repository ENCLOSING the folder you run
// from (OA-275), never `process.cwd()`.
//
// Run it from anywhere inside the repository you are checking. The path below is
// a real path on this machine, not a placeholder:
//   node "C:/u3a St Ives/.claude/skills/tools/check-doc-acronyms.mjs"
//
// Exits 1 and names each undefined short form with where it is used; exits 2 if
// the declaration does not parse or names something that is not there.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { untrackedFiles, trackedMarkdown } from './lib/tracked-docs.mjs';
import { enclosingRepoRoot } from './lib/repo-root.mjs';

/* ── The two thresholds, and the measurement that chose each ───────────────
 *
 * WORD_THRESHOLD — how many prose uses of a token's LOWER-CASE form make it an
 * ordinary English word shouted in capitals rather than a short form. Our house
 * style shouts constantly — PASS, HARD, SOFT, DONE, NEVER, STALE, RED, GREEN,
 * REFUSE — and `grep -ohE '\b[A-Z]{2,6}\b'` over buses-data returns `AND`, `THE`
 * and `NOT` in the top forty. An exclusion list of six hundred English words
 * would not be a check, it would be a dictionary somebody has to maintain, so
 * the corpus answers the question about itself instead.
 *
 * IT IS NOT A FUDGE FACTOR, AND THAT WAS MEASURED RATHER THAN ASSUMED. Over
 * buses-data on 2026-09-11, the lower-case prose counts were: ep 1, gp 1, svg 1,
 * ci 2, gtfs 2, poi 2, and zero for atco, bods, drt, lta, qr, jpg, osm, pii,
 * cic — against pass 208, hard 195, stale 202, done 270, refuse 51, never 1,133
 * and the 39,879 of `the`. **The highest count over a known short form was 2 and
 * the lowest over a known shout was 51**: the two populations are 25× apart with
 * nothing in between, and the candidate total moves by 6% across a threshold
 * sweep of 3 → 50. A knob whose answer does not change over an order of
 * magnitude is not the knob doing the work.
 *
 * THE FIRST VERSION OF THIS RULE HAD NO THRESHOLD AT ALL — a token whose
 * lower-case form appeared even ONCE was treated as a word — and it swallowed
 * `EP`, which is the exact abbreviation this action exists for. That is the
 * false-PASS direction, it was caught by measuring rather than by reasoning, and
 * `prove-red-doc-acronyms.mjs` holds it as a case for ever. */
const WORD_THRESHOLD = 10;

/* MIN_DOCUMENTS — how many documents a short form must appear in before it is
 * the estate's vocabulary rather than one document's own.
 *
 * THIS IS THE SAME RULE OA-300 ALREADY STATED, generalised. `P8b`, `B3`, `H1`
 * and their kind are deliberately out of scope: they are phases or findings
 * inside one plan, they are not permanent, and the same letter means something
 * else in the next plan. A checker demanding a glossary entry for each would be
 * demanding the opposite of that rule. The general form is that **a short form
 * confined to one document is that document's own vocabulary, and its reader has
 * the introducing sentence in front of them**; one that has escaped into a
 * SECOND document is estate vocabulary and needs a home somebody can find.
 *
 * It is also what keeps this check about our writing rather than about the
 * world's. 140 of the 253 candidates in buses-data appear in exactly one
 * document, and they are overwhelmingly bodies quoted once in a research note —
 * KPMG, RICS, ADEPT, CILT — plus the OCR of an imported DfT PDF. Demanding a
 * definition for a name quoted once is how a gate gets muted in its first week. */
const MIN_DOCUMENTS = 2;

/* ── Flags. Unknown ones are REFUSED, not ignored ──────────────────────────
 * `check-doc-links.mjs` used to read the flags it knew and say nothing about the
 * rest, so `--tree` — another checker's flag — silently ran the DEFAULT scope
 * and printed a confident verdict about a corpus nobody had asked for. */
{
  const KNOWN = ['--root'];
  const takesValue = new Set(['--root']);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    if (!KNOWN.includes(a)) {
      console.error(`check-doc-acronyms.mjs: unknown flag ${a} (known: ${KNOWN.join(', ')})`);
      process.exit(2);
    }
    if (takesValue.has(a)) i++;
  }
}
const rootArg = process.argv.indexOf('--root');
/* `--root <dir>` names a TREE and not a repository: it walks that folder and
 * everything under it, and nothing below asks git about anything. That is the
 * fault the last move of these checkers paid for twice — a mode that names a
 * tree must not depend on the repository you happen to be standing in, because
 * buses-data's CI checks its three repositories into SUBDIRECTORIES of a
 * workspace that is no repository at all. It is what the harness drives. */
const DEFAULT_CORPUS = rootArg === -1;
const REPO_ROOT = enclosingRepoRoot();

/* ── The declaration ──────────────────────────────────────────────────────
 * A file that does not parse is a REFUSAL rather than a silent fallback: a
 * declaration nobody can read must not look like a repository that made none.
 * The contract `.doc-tables.json`, `.doc-links.json` and `.file-hygiene.json`
 * already share.
 *
 *   {
 *     "dirs":        ["Documentation", "Development Docs"],
 *     "definitions": ["Documentation/README - Glossary of terms.md"],
 *     "defined":     { "FWT": "why it is defined here and not in a document" },
 *     "notAbbreviations": [ { "reason": "…", "tokens": ["PASS", "HARD"] } ],
 *     "excluded":    { "path/to/imported.md": "why it is not ours" }
 *   }
 *
 * AND WHATEVER GIT KNOWS ABOUT IS ADDED WHETHER IT IS DECLARED OR NOT, so a
 * repository that declares NOTHING gets its WHOLE tracked corpus. That is
 * deliberately the strong default: these checkers' own bug, three times, was
 * COVERAGE — a confident total over a population smaller than the truth — and a
 * scope that can only be got wrong by ADDING a folder is the one shape that
 * fault cannot take. */
function declaration(root) {
  const empty = { declared: false, dirs: [], definitions: [], defined: new Map(), notAbbrev: new Map(), excluded: new Map() };
  const file = path.join(root, '.doc-acronyms.json');
  if (!existsSync(file)) return empty;
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) {
    console.error(`check-doc-acronyms.mjs: ${file} does not parse — ${e.message}`);
    process.exit(2);
  }
  const die = (why) => { console.error(`check-doc-acronyms.mjs: ${file} — ${why}`); process.exit(2); };
  const dirs = parsed.dirs ?? [];
  const definitions = parsed.definitions ?? [];
  const defined = parsed.defined ?? {};
  const groups = parsed.notAbbreviations ?? [];
  const excluded = parsed.excluded ?? {};
  if (!Array.isArray(dirs) || dirs.some((d) => typeof d !== 'string')) die('dirs must be an array of repo-relative folders');
  if (!Array.isArray(definitions) || definitions.some((d) => typeof d !== 'string')) die('definitions must be an array of repo-relative documents');
  if (typeof defined !== 'object' || Array.isArray(defined) || Object.values(defined).some((v) => typeof v !== 'string')) die('defined must be an object of SHORT FORM → what it stands for');
  if (!Array.isArray(groups) || groups.some((g) => !g || typeof g.reason !== 'string' || !Array.isArray(g.tokens) || g.tokens.some((t) => typeof t !== 'string')))
    die('notAbbreviations must be an array of { "reason": …, "tokens": [ … ] }');
  if (typeof excluded !== 'object' || Array.isArray(excluded) || Object.values(excluded).some((v) => typeof v !== 'string')) die('excluded must be an object of path → reason');
  /* A REASON PER GROUP RATHER THAN PER TOKEN, and that is a considered trade.
   * OA-300 asked for "a declared file with reasons, not a regular expression
   * that quietly swallows a real acronym", and the thing that must not happen is
   * a token disappearing without anybody having said why. Eighty-odd separate
   * one-line reasons would be eighty copies of about ten sentences, and a file
   * nobody rereads; a group states the judgement once and lists what it covers,
   * so a reader can disagree with the judgement rather than with a token. */
  const notAbbrev = new Map();
  for (const g of groups) for (const t of g.tokens) {
    if (notAbbrev.has(t)) die(`${t} is listed in two notAbbreviations groups — "${notAbbrev.get(t)}" and "${g.reason}"`);
    notAbbrev.set(t, g.reason);
  }
  return {
    declared: true,
    dirs: dirs.map((d) => d.split('\\').join('/').replace(/\/+$/, '')),
    definitions: definitions.map((d) => d.split('\\').join('/')),
    defined: new Map(Object.entries(defined)),
    notAbbrev,
    excluded: new Map(Object.entries(excluded)),
  };
}

const DECL = DEFAULT_CORPUS ? declaration(REPO_ROOT) : declaration(path.resolve(process.argv[rootArg + 1]));

/* ── Which documents ──────────────────────────────────────────────────────── */
function walk(dir) {
  const IGNORED = new Set(['node_modules', '.git', '.github', 'attachments']);
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!IGNORED.has(e.name)) out.push(...walk(path.join(dir, e.name))); }
    else if (e.name.endsWith('.md')) out.push(path.join(dir, e.name));
  }
  return out;
}

const BASE = DEFAULT_CORPUS ? REPO_ROOT : path.resolve(process.argv[rootArg + 1]);
const rel = (abs) => path.relative(BASE, abs).split(path.sep).join('/');

let FILES;
if (DEFAULT_CORPUS) {
  const declared = DECL.dirs
    .filter((d) => existsSync(path.join(REPO_ROOT, d)) && statSync(path.join(REPO_ROOT, d)).isDirectory())
    .flatMap((d) => walk(path.join(REPO_ROOT, d)).map(rel));
  /* Declared folders are walked from DISK and the rest come from GIT, which is
   * the same split `check-tables.mjs` uses and for the same reason: git is the
   * population that does not move under a session mid-build, and a walk is what
   * reaches a declared folder before anything in it is committed. A document
   * reached both ways is counted once. */
  const tracked = new Set(trackedMarkdown(REPO_ROOT));
  FILES = [...new Set([...declared.filter((f) => tracked.has(f)), ...untrackedFiles(REPO_ROOT, DECL.dirs)])].sort();
} else {
  FILES = walk(BASE).map(rel).sort();
}

/* A stale exclusion is a HARD ERROR, so a document that leaves cannot leave an
 * exclusion behind — and only when the declaring repository is the subject. */
for (const p of DECL.excluded.keys()) {
  if (!existsSync(path.join(BASE, p))) {
    console.error(`check-doc-acronyms: ${BASE}/.doc-acronyms.json excludes ${p}, which is not there any more — remove the exclusion or fix the path.`);
    process.exit(2);
  }
}
for (const p of DECL.definitions) {
  if (!existsSync(path.join(BASE, p))) {
    console.error(`check-doc-acronyms: ${BASE}/.doc-acronyms.json names ${p} as a definitions document, and it is not there.`);
    process.exit(2);
  }
}
FILES = FILES.filter((f) => !DECL.excluded.has(f));

/* ── Reading a document ───────────────────────────────────────────────────
 * Fenced blocks, inline code, HTML comments (the docstamp) and link targets are
 * not prose. Nor is anything path- or filename-shaped that escaped the
 * backticks: `S4-generate/`, `gtfs_query.py` and `sheet.svg` say nothing about
 * whether a reader can look up SVG. */
function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/\S*[/\\_]\S*/g, ' ')
    /* A DOT ONLY COUNTS AS PATH-SHAPED WHEN SOMETHING FOLLOWS IT. The first
     * version stripped any token containing a dot, which quietly ate every word
     * that happened to end a sentence — including the short form itself. The
     * falsification harness caught it on a control fixture whose lower-case
     * count came out at 9 instead of 15, and the same bug was silently lowering
     * every use count in the real corpus. */
    .replace(/\S+\.[A-Za-z0-9]\S*/g, ' ');
}

const TOKEN = /\b[A-Z]{2,6}\b/g;
/* LETTERS ONLY, SO A TOKEN CARRYING A DIGIT IS NEVER A CANDIDATE. That single
 * property puts the whole of `S1`–`S6`, `P1`–`P6`, `R1`–`R6`, `F001`, `I27`,
 * `X31`, `A428`, `PE29`, `C2` and `EE6677` out of scope — stage codes, finding
 * ids, route numbers, roads, postcodes and hex colours — without one line of
 * exclusion list. The four permanent series that DO need a home are `OA`,
 * `CORR`, `SF` and a run's `F`, and every one of them is written with letters
 * before its number, so each is caught as a bare token here. */

const text = new Map();       // repo-relative path -> prose
for (const f of FILES) {
  try { text.set(f, prose(readFileSync(path.join(BASE, f), 'utf8'))); } catch { /* unreadable is not this check's business */ }
}

const uses = new Map();       // TOKEN -> { n, files: Map<file, firstLine> }
const lower = new Map();      // lower-case prose word -> count
for (const [f, p] of text) {
  const lines = p.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(TOKEN)) {
      const t = m[0];
      if (!uses.has(t)) uses.set(t, { n: 0, files: new Map() });
      const e = uses.get(t);
      e.n++;
      if (!e.files.has(f)) e.files.set(f, i + 1);
    }
  });
  for (const m of p.matchAll(/\b[a-z]{2,6}\b/g)) lower.set(m[0], (lower.get(m[0]) ?? 0) + 1);
}

/* ── The three recognisers, each falsified in BOTH directions ──────────────
 * Widening what counts as "already defined" is the DANGEROUS direction: it
 * silences the finding that should have fired, which is exactly what happened to
 * `check-doc-links.mjs`'s declaration forms on 2026-09-01, where a paragraph
 * merely LOCATING something was read as a declaration. So each of these has a
 * case in `prove-red-doc-acronyms.mjs` proving it recognises a real definition
 * AND a control proving it does not accept a near miss. */

/* (a) A DEFINITION ROW in a document the repository declares as a definition
 * source. The first cell of a table row names the short form; the second says
 * what it stands for. Markup is stripped, and a cell naming more than one — the
 * glossary writes `**CRLF** and **LF**`, `**SVG** and **JPG**` — defines each.
 * A row whose second cell is empty defines nothing: naming a term is not
 * expanding it. */
function definitionRows(body) {
  const found = new Map();
  let inTable = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\|[\s:|-]+\|[\s:|-]*$/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith('|')) { inTable = false; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const first = cells[0].replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const inFull = cells[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (!inFull) continue;
    for (const m of first.matchAll(/\b[A-Z]{2,6}\b/g)) found.set(m[0], inFull);
  }
  return found;
}

/* (b) A PARENTHETICAL EXPANSION in the document that uses it — the rule for a
 * repository with no glossary, and the one that would have caught `EP` on the
 * day it was written. `Enhanced Partnership (EP)` or `EP (Enhanced
 * Partnership)`, where the INITIALS OF THE EXPANSION SPELL THE TOKEN. That last
 * clause is the whole guard: without it, any capitalised phrase before any
 * bracket would silence any short form, which is the false-PASS shape. Small
 * joining words are skipped, so `Bus Open Data Service (BODS)` and `Association
 * of Transport Co-ordinating Officers (ATCO)` both count. */
const JOINERS = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'on', 'a', 'an']);
function initialsSpell(phrase, token) {
  const words = phrase.trim().split(/[\s-]+/).filter(Boolean);
  const initials = words.filter((w) => !JOINERS.has(w.toLowerCase())).map((w) => w[0]).join('').toUpperCase();
  if (initials === token) return true;
  /* `COVID-19 Bus Services Support Grant (CBSSG)` and the like: allow the
   * joining words to count too, but never allow a SHORTER phrase to match — the
   * expansion must supply every letter of the token in order. */
  const all = words.map((w) => w[0]).join('').toUpperCase();
  return all === token;
}
function parentheticals(body) {
  const found = new Map();
  /* Xxx Yyy (TOKEN) — and EVERY LENGTH OF PHRASE IS TRIED, longest first. The
   * first version used a non-greedy `{1,7}?`, which meant it only ever tested
   * the single word nearest the bracket: `your Enhanced Partnership (EP)`
   * offered it `Partnership`, whose initial is `P`, and the definition went
   * unrecognised. That is the FALSE-FINDING direction of this recogniser and
   * the harness caught it on the estate's own motivating example. */
  for (const m of body.matchAll(/((?:[A-Za-z][A-Za-z-]*[\s-]+){1,8})\(([A-Z]{2,6})\)/g)) {
    const words = m[1].trim().split(/[\s-]+/).filter(Boolean);
    for (let k = words.length; k >= 1; k--) {
      const phrase = words.slice(words.length - k).join(' ');
      if (initialsSpell(phrase, m[2])) { found.set(m[2], phrase); break; }
    }
  }
  // TOKEN (Xxx Yyy)
  for (const m of body.matchAll(/\b([A-Z]{2,6})\s*\(([^)]{3,80})\)/g)) {
    if (initialsSpell(m[2], m[1])) found.set(m[1], m[2].trim());
  }
  return found;
}

const GLOSSARY = new Map();   // TOKEN -> the document whose table defines it
for (const d of DECL.definitions) {
  const body = readFileSync(path.join(BASE, d), 'utf8');
  for (const t of definitionRows(body).keys()) if (!GLOSSARY.has(t)) GLOSSARY.set(t, d);
}

const perDocExpansions = new Map();  // file -> Map<TOKEN, phrase>
for (const [f, p] of text) perDocExpansions.set(f, parentheticals(p));

/* ── The verdict ─────────────────────────────────────────────────────────── */
const isWord = (t) => (lower.get(t.toLowerCase()) ?? 0) >= WORD_THRESHOLD;

let candidates = 0, defined = 0;
const findings = [];
for (const [t, e] of [...uses.entries()].sort((a, b) => b[1].n - a[1].n)) {
  if (isWord(t)) continue;
  if (e.files.size < MIN_DOCUMENTS) continue;
  if (DECL.notAbbrev.has(t)) continue;
  candidates++;
  if (GLOSSARY.has(t) || DECL.defined.has(t)) { defined++; continue; }
  /* A PARENTHETICAL COUNTS ONLY IN THE DOCUMENT THAT CARRIES IT, and one
   * stranded document is enough. A glossary row and a declaration entry are
   * estate-wide homes — a reader who knows the glossary exists can look the
   * short form up from anywhere — but an expansion is local by construction, so
   * a term expanded in one document and used bare in four is defined for one
   * reader in five. The finding names the documents that leave them stranded,
   * which is also the list of places to fix.
   *
   * MIN_DOCUMENTS is not applied a second time here, deliberately: it decides
   * whether a short form is the ESTATE's vocabulary at all, and once it is, one
   * reader with nowhere to look is the fault this check exists for. */
  const stranded = [...e.files.entries()].filter(([f]) => !(perDocExpansions.get(f) ?? new Map()).has(t));
  if (!stranded.length) { defined++; continue; }
  findings.push({ token: t, n: e.n, docs: e.files.size, stranded });
}

for (const fnd of findings) {
  const where = fnd.stranded.length === fnd.docs
    ? `across ${fnd.docs} documents, and expanded in none of them`
    : `across ${fnd.docs} documents and expanded in ${fnd.docs - fnd.stranded.length}, leaving ${fnd.stranded.length} with nowhere to look`;
  console.log(`✗ ${fnd.token} — used ${fnd.n} time${fnd.n === 1 ? '' : 's'} ${where}`);
  for (const [f, line] of fnd.stranded.slice(0, 4)) console.log(`      ${f}:${line}`);
  if (fnd.stranded.length > 4) console.log(`      …and ${fnd.stranded.length - 4} more`);
}

console.log(`\n${FILES.length} documents · ${candidates} short form${candidates === 1 ? '' : 's'} in use · ${defined} defined · ${findings.length ? `${findings.length} WITH NOWHERE TO LOOK THEM UP` : 'every one can be looked up'}.`);
console.log(`Out of scope by rule, and deliberately: a token carrying a digit (a stage, a finding, a route, a postcode),`);
console.log(`a token whose lower-case form is used ${WORD_THRESHOLD}+ times in prose (our house style shouts in capitals),`);
console.log(`and a short form appearing in fewer than ${MIN_DOCUMENTS} documents (one document's own vocabulary, not the estate's).`);
if (findings.length) {
  console.log('\nA short form a reader cannot look up is the one documentation fault that costs a NEW READER');
  console.log('rather than a session. Give each one a home: a row in a declared definitions document, an');
  console.log('expansion in the same document at or before first use, or an entry in .doc-acronyms.json');
  console.log('saying what it stands for. If it is not ours to define, say so in a notAbbreviations group.');
}
process.exitCode = findings.length ? 1 : 0;
