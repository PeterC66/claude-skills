// Falsify check-doc-links.mjs: break each of its checks on purpose and insist
// it notices.
//
// WHY. `check-doc-links.mjs` is green on the real corpus, and a green check that
// has never been seen to go red proves nothing — this repository has paid for
// that lesson repeatedly and keeps two harnesses in the skills repo for the same
// reason (`npm run test:prove-red`, `npm run test:prove-red-gates`). This is the
// documentation set's equivalent, and it is cheap: no data tree, no network,
// about a second.
//
// It also falsifies the OTHER direction, which is the half that is usually
// skipped: a control document that exercises every check and is CORRECT must
// come out green. Without that, a checker that reported everything as broken
// would pass this harness with full marks.
//
// Run from the repository root (C:\u3a St Ives\Using AI\Buses). No placeholders:
//   node Documentation/prove-red-doc-links.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('./check-doc-links.mjs', import.meta.url));

function run(dir) {
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* Every fixture is a whole little doc set, written from scratch, so a fixture
 * cannot accidentally depend on the real one. `target.md` is the document the
 * broken ones point at; it is deliberately well-formed. */
function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'doclinks-'));
  const write = (name, body) => {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf8');
  };
  write('target.md', [
    '# Target',
    '',
    '## 1. First section',
    '',
    'Body.',
    '',
    '## 2. Second section',
    '',
    'Body.',
    '',
    /* An em dash in a heading, because that is where the two slug rules part
     * company. GitHub turns each space into a hyphen and does not collapse the
     * pair the removed dash leaves behind; this checker used to, so an anchor
     * into a heading like this one read as healthy here and 404 on GitHub. */
    '## 3. Third section \u2014 the em-dash case',
    '',
    'Body.',
    '',
  ].join('\n'));
  write('tool.mjs', '// a script a documented command may name\n');
  for (const [name, body] of Object.entries(files)) write(name, body);
  return dir;
}

const CASES = [
  {
    code: 'L1',
    what: 'a link to a file that is not there',
    doc: '# Doc\n\nSee [the plan](no-such-document.md) for the reasoning.\n',
  },
  {
    /* The class only a non-Windows checkout could see: on the machine that
     * wrote it the target really is there, one directory up and in another
     * repository, so it looks perfectly healthy locally and 404s for everyone
     * else. Three of these were live in the corpus on 2026-08-27. */
    code: 'L1',
    what: 'a link that climbs out of the repository',
    doc: '# Doc\n\nSee [the engine](../other-repo/engine/README.md) for the sequence.\n',
  },
  {
    code: 'L2',
    what: 'an anchor that matches no heading in the target',
    doc: '# Doc\n\nSee [the target](target.md#third-section) for the reasoning.\n',
  },
  {
    /* The class this checker could not see until 2026-08-31: an anchor into a
     * heading containing an em dash, written with ONE hyphen where the removed
     * dash was. GitHub writes two. Two of these were live in the corpus and
     * both were reported healthy. */
    code: 'L2',
    what: 'an em-dash heading cited with its hyphens collapsed \u2014 healthy here, 404 on GitHub',
    doc: '# Doc\n\nSee [the third part](target.md#3-third-section-the-em-dash-case) for the reasoning.\n',
  },
  {
    code: 'L3',
    what: 'a section citation the named target does not have',
    doc: '# Doc\n\nThe rule is set out in [`target.md`](target.md) \u00a77.\n',
  },
  {
    code: 'C1',
    what: 'a command with no folder declared for it',
    doc: '# Doc\n\nRebuild it:\n\n```bash\nnode tool.mjs\n```\n',
  },
  {
    code: 'C2',
    what: 'a command naming a script that does not exist',
    doc: '# Doc\n\nRun this from the repository root:\n\n```bash\nnode missing-tool.mjs\n```\n',
  },
];

let failed = 0;
const report = (ok, line, label = 'RED  ') => { if (!ok) failed++; console.log(`  ${ok ? label : 'MISS '} ${line}`); };

console.log('Each check, broken on purpose — the checker must fail and must say which one:\n');
for (const c of CASES) {
  const dir = fixture({ 'doc.md': c.doc });
  const { code, out } = run(dir);
  rmSync(dir, { recursive: true, force: true });
  const named = out.includes(`[${c.code} `);
  report(code === 1 && named,
    `${c.code}  ${c.what}` + (code === 1 ? (named ? '' : `  <-- failed, but never named ${c.code}`) : `  <-- exited ${code}, not 1`));
}

/* THE CONTROL. Every check exercised, nothing wrong. A harness made only of
 * broken fixtures is passed with full marks by a checker that fails on
 * everything, which is a real failure mode and not a hypothetical one: this
 * project has recorded a gate that reported 0 of 11 when all 11 had succeeded. */
console.log('\nThe control — the same constructs, all correct:\n');
const good = fixture({
  'doc.md': [
    '# Doc',
    '',
    'See [the target](target.md) and [its second part](target.md#2-second-section).',
    '',
    'And [its third part](target.md#3-third-section--the-em-dash-case), whose heading carries an em dash.',
    '',
    'The rule is set out in [`target.md`](target.md) \u00a72, and ODbL \u00a74.6 is a different matter.',
    '',
    /* An example of a link, shown rather than made. It must not be chased: a
     * document explaining a citation style writes one of these, and the first
     * version reported the illustration as a dead link. */
    'Cite a heading as an anchor \u2014 `[the second part](no-such-doc.md#2-second-section)` \u2014 so the checker can see it.',
    '',
    'Run this from the repository root:',
    '',
    '```bash',
    'node tool.mjs',
    '```',
    '',
  ].join('\n'),
});
const { code, out } = run(good);
rmSync(good, { recursive: true, force: true });
report(code === 0, `a correct document exercising every check` + (code === 0 ? '' : `  <-- exited ${code}\n${out}`), 'GREEN');

/* PORTABILITY, and this section exists because CI caught what this harness did
 * not. The house rule is that a documented command names the folder it runs
 * from, in the terms of the machine that runs it — so the declarations are
 * absolute Windows paths, and on a Linux runner none of them exists. The first
 * version fed the declared path straight to existsSync: green on the laptop, RED
 * on the first CI run it was ever wired into, naming four scripts as missing
 * that were all present. Both cases below are written with a drive letter that
 * exists on NO machine, so they exercise the Linux path from Windows. */
console.log('\nPortability — a folder declared as an absolute path on somebody else\'s machine:\n');

const inside = fixture({
  'sub/tool.mjs': '// here\n',
  'doc.md': '# Doc\n\nRun this from `Z:\\somewhere\\else\\sub`:\n\n```bash\nnode tool.mjs\n```\n',
});
const r1 = run(inside);
rmSync(inside, { recursive: true, force: true });
report(r1.code === 0, 'a path this repo does have, spelled for another machine — matched by its tail'
  + (r1.code === 0 ? '' : `  <-- exited ${r1.code}\n${r1.out}`), 'GREEN');

const elsewhere = fixture({
  'doc.md': '# Doc\n\nRun this from `Z:\\another\\repository\\assets`:\n\n```bash\nnode status.js\n```\n',
});
const r2 = run(elsewhere);
rmSync(elsewhere, { recursive: true, force: true });
report(r2.code === 0 && /another repository that is not checked out here/.test(r2.out),
  'a path in another repository, absent here — skipped AND said so'
  + (r2.code === 0 ? (/another repository/.test(r2.out) ? '' : '  <-- skipped silently, which is a silent filter') : `  <-- exited ${r2.code}`), 'GREEN');

/* THE ARGUMENT can be an absolute path too, and that is the form the second CI
 * run failed on after the declaration form was fixed — including the case where
 * the declaration says the folder does not matter, which resolved the script
 * "against false". Two more shapes, both green only if the resolver is applied
 * to the argument as well. */
const argInside = fixture({
  'sub/tool.py': '# here\n',
  'doc.md': '# Doc\n\n**Folder:** doesn\'t matter — run it from anywhere.\n\n```bash\npython "Z:\\somewhere\\else\\sub\\tool.py"\n```\n',
});
const r4 = run(argInside);
rmSync(argInside, { recursive: true, force: true });
report(r4.code === 0, 'an absolute-path ARGUMENT this repo does have, under a "folder does not matter" declaration'
  + (r4.code === 0 ? '' : `  <-- exited ${r4.code}\n${r4.out}`), 'GREEN');

const argElsewhere = fixture({
  'doc.md': '# Doc\n\nRun this from the repository root:\n\n```bash\nnode "Z:\\another\\repository\\assets\\preview.js"\n```\n',
});
const r5 = run(argElsewhere);
rmSync(argElsewhere, { recursive: true, force: true });
report(r5.code === 0 && /another repository that is not checked out here/.test(r5.out),
  'an absolute-path ARGUMENT in another repository — skipped AND said so'
  + (r5.code === 0 ? '' : `  <-- exited ${r5.code}\n${r5.out}`), 'GREEN');

/* And the obvious question about the fix above: did it make C2 always green? A
 * foreign-spelled path that DOES match this tree must still catch a missing
 * script, or the portability fix has quietened the check rather than fixed it. */
const stillRed = fixture({
  'sub/tool.mjs': '// here\n',
  'doc.md': '# Doc\n\nRun this from `Z:\\somewhere\\else\\sub`:\n\n```bash\nnode not-here.mjs\n```\n',
});
const r3 = run(stillRed);
rmSync(stillRed, { recursive: true, force: true });
report(r3.code === 1 && r3.out.includes('[C2 '),
  'C2  a missing script behind a foreign-spelled path — the portability fix did not quieten it'
  + (r3.code === 1 ? '' : `  <-- exited ${r3.code}, the fix made C2 unfalsifiable`));


/* THE ARCHIVE, added 2026-08-31. `_archive/` is deliberately outside the full
 * corpus — an archived plan is a record of what was said, so its § citations and
 * its commands are not ours to re-litigate. Its LINKS are another matter: the
 * archive README requires whoever moves a file to repoint what points at it, and
 * on the day this was written 18 links across five archived documents pointed at
 * nothing, ten of them broken by the move that archived them. Three cases: the
 * dead link must be caught, a correct archived document must stay green, and the
 * two checks the archive is exempt from must STAY exempt — otherwise the
 * widening quietly dragged the whole archive into the live corpus. */
/* THE THREE WIDENINGS OF 2026-09-01 (OA-222), each asserted in BOTH directions.
 *
 * This check was pointed at the skills repository for the first time and
 * reported 33 findings, and every script it named as missing was present. The
 * fault was this file's, not those documents': the declaration forms it knew
 * were the five buses-data happened to use. Widening a form here is the
 * dangerous direction — a paragraph wrongly read as a declaration does not
 * produce a false finding, it SILENCES the C1 that should have fired — so every
 * case below is paired with the thing that must still go red.
 */
console.log('\nThe declaration forms added for the skills repository:\n');

/* Form 1: a backticked absolute path. THIS CASE WAS REWRITTEN ON 2026-09-04, and
 * the rewrite is the point of it. Between 2026-09-01 and then it asserted that a
 * backticked absolute path declares a folder "keyword or none", with this exact
 * fixture — "Record it, in the assets folder (`Z:\…\sub`):" — and the comment
 * above it said the form was tight because it does not occur by accident. It
 * does. The portal's documents write one to LOCATE something in three separate
 * paragraphs of `docs/H1-operations-handbook.md`, and unbounded, one of them
 * silenced the C1 on a command appendix a hundred lines below and reported seven
 * live scripts as missing against a folder in another repository. So the same
 * fixture now asserts the opposite verdict: a sentence that only says where a
 * thing IS is not an instruction, and this one has no cue in it. */
const absOnly = fixture({
  'sub/tool.mjs': '// here\n',
  'doc.md': '# Doc\n\nRecord it, in the assets folder (`Z:\\somewhere\\else\\sub`):\n\n```bash\nnode tool.mjs\n```\n',
});
const w1 = run(absOnly);
rmSync(absOnly, { recursive: true, force: true });
report(w1.code === 1 && w1.out.includes('[C1 '),
  'C1  a backticked absolute path with no instruction in its sentence — NOT a declaration (narrowed 2026-09-04)'
  + (w1.code === 1 ? '' : `  <-- exited ${w1.code}, a location statement is still silencing C1\n${w1.out}`));

/* And the form the 2026-09-01 widening was actually FOR, which still declares:
 * `bus-work/SKILL.md` writes "Run `npm run rotate:secret` from
 * `C:\Claude\community-bus-maps`" — the path, and an instruction beside it. */
const absWithCue = fixture({
  'sub/only-here.mjs': '// here\n',
  'doc.md': '# Doc\n\nEvery block below runs in one shell session, started in `Z:\\somewhere\\else\\sub`.\n\nA paragraph of ordinary prose in between.\n\n```bash\nnode only-here.mjs\n```\n',
});
const w1c = run(absWithCue);
rmSync(absWithCue, { recursive: true, force: true });
report(w1c.code === 0, 'a backticked absolute path in an INSTRUCTION sentence — still the declaration it is'
  + (w1c.code === 0 ? '' : `  <-- exited ${w1c.code}, the narrowing is producing false C1s\n${w1c.out}`), 'GREEN');

const absOnlyMissing = fixture({
  'sub/only-here.mjs': '// here\n',
  'doc.md': '# Doc\n\nEvery block below runs in one shell session, started in `Z:\\somewhere\\else\\sub`.\n\n```bash\nnode gone.mjs\n```\n',
});
const w1b = run(absOnlyMissing);
rmSync(absOnlyMissing, { recursive: true, force: true });
report(w1b.code === 1 && w1b.out.includes('[C2 '),
  'C2  a missing script under that same declaration — the widening did not quieten it'
  + (w1b.code === 1 ? '' : `  <-- exited ${w1b.code}\n${w1b.out}`));

/* Form 2: `from` plus a backticked RELATIVE folder — how the skills repo names
 * its own folders, and the form that has to resolve to a real directory. */
const relDecl = fixture({
  'sub/tool.mjs': '// here\n',
  'doc.md': '# Doc\n\nThe full board, run from `sub`:\n\n```bash\nnode tool.mjs\n```\n',
});
const w2 = run(relDecl);
rmSync(relDecl, { recursive: true, force: true });
report(w2.code === 0, 'a backticked RELATIVE folder that exists — resolved against it, not the document'
  + (w2.code === 0 ? '' : `  <-- exited ${w2.code}\n${w2.out}`), 'GREEN');

/* THE CONTROL THAT KEEPS FORM 2 HONEST. A backticked token that is not a
 * directory must NOT be taken as a folder: if it were, every "from `x.js`" in
 * the corpus would redirect its commands somewhere arbitrary and pass. */
const relNotADir = fixture({
  'doc.md': '# Doc\n\nRun it from `tool.mjs`:\n\n```bash\nnode gone.mjs\n```\n',
});
const w2b = run(relNotADir);
rmSync(relNotADir, { recursive: true, force: true });
report(w2b.code === 1 && w2b.out.includes('[C2 '),
  'C2  a backticked token that is a FILE, not a folder — not accepted as a cwd'
  + (w2b.code === 1 ? '' : `  <-- exited ${w2b.code}\n${w2b.out}`));

/* AND PROSE WITHOUT BACKTICKS IS STILL NOT A DECLARATION. The backticks are the
 * whole of what keeps form 2 narrow; drop them and "from the engine folder"
 * would silence C1 across the corpus. */
const proseOnly = fixture({
  'doc.md': '# Doc\n\nYou can build this from the engine folder if you like:\n\n```bash\nnode tool.mjs\n```\n',
});
const w2c = run(proseOnly);
rmSync(proseOnly, { recursive: true, force: true });
report(w2c.code === 1 && w2c.out.includes('[C1 '),
  'C1  "from the engine folder" in bare prose — still undeclared, as it always was'
  + (w2c.code === 1 ? '' : `  <-- exited ${w2c.code}\n${w2c.out}`));

/* Form 3: a command path behind a %VAR%. Skipped, and the run SAYS SO — the
 * same contract as the outside-the-repo skip above it. */
const placeholder = fixture({
  'doc.md': '# Doc\n\nRun it from the repository root:\n\n```bash\nnode "%TSK%\\stage.js"\n```\n',
});
const w3 = run(placeholder);
rmSync(placeholder, { recursive: true, force: true });
report(w3.code === 0 && /behind a %VAR% placeholder/.test(w3.out),
  'a %VAR% command path — skipped AND said so, never silently passed'
  + (w3.code === 0 ? '' : `  <-- exited ${w3.code}\n${w3.out}`), 'GREEN');

const notAPlaceholder = fixture({
  'doc.md': '# Doc\n\nRun it from the repository root:\n\n```bash\nnode 100%real/gone.mjs\n```\n',
});
const w3b = run(notAPlaceholder);
rmSync(notAPlaceholder, { recursive: true, force: true });
report(w3b.code === 1 && w3b.out.includes('[C2 '),
  'C2  a path with a stray % that is not a placeholder — still resolved and still caught'
  + (w3b.code === 1 ? '' : `  <-- exited ${w3b.code}\n${w3b.out}`));

console.log('\nThe archive — links checked, claims not re-litigated:\n');

const archDead = fixture({
  'doc.md': '# Doc\n\nNothing to see.\n',
  '_archive/old.md': '# Old plan\n\nSee [the target](../target.md) and [the missing one](gone.md).\n',
});
const a1 = run(archDead);
rmSync(archDead, { recursive: true, force: true });
report(a1.code === 1 && a1.out.includes('[L1 ') && a1.out.includes('_archive'),
  'L1  a dead link in an ARCHIVED document — the class that broke on the last archive round'
  + (a1.code === 1 ? '' : `  <-- exited ${a1.code}, the archive is still unseen`));

const archGood = fixture({
  'doc.md': '# Doc\n\nNothing to see.\n',
  '_archive/old.md': '# Old plan\n\nSee [the target](../target.md).\n',
});
const a2 = run(archGood);
rmSync(archGood, { recursive: true, force: true });
report(a2.code === 0, 'an archived document whose links all resolve'
  + (a2.code === 0 ? '' : `  <-- exited ${a2.code}\n${a2.out}`), 'GREEN');

/* The exemption, and it is the half a widening usually gets wrong. Both of these
 * would be findings in a LIVE document; in the archive they must be silent. */
const archExempt = fixture({
  'doc.md': '# Doc\n\nNothing to see.\n',
  '_archive/old.md': '# Old plan\n\nThe rule is in [`../target.md`](../target.md) §7.\n\n```bash\nnode missing-tool.mjs\n```\n',
});
const a3 = run(archExempt);
rmSync(archExempt, { recursive: true, force: true });
report(a3.code === 0, 'an archived document’s § citation and command — exempt, and STILL exempt'
  + (a3.code === 0 ? '' : `  <-- exited ${a3.code}, the widening dragged the archive into the live corpus\n${a3.out}`), 'GREEN');

/* THE FOUR CHANGES OF 2026-09-04 (OA-227), each asserted in BOTH directions.
 *
 * This check was pointed at the PORTAL for the first time and reported 49
 * findings, of which 30 were its own. Two of the four changes are NARROWINGS of
 * a declaration form -- N1 and N2, whose cases sit in the declaration-forms
 * block above, beside the 2026-09-01 case N1 had to rewrite -- and two are
 * WIDENINGS of what counts as a checkable link. The two kinds fail in opposite
 * directions: a narrowed declaration produces visible false findings, a widened
 * one silences a C1 that should have fired. So every case here is paired with
 * the thing that must still be caught. */
console.log('\nThe portal widenings of 2026-09-04 -- each paired with what must still go red:\n');

/* N2, the other half. A backticked token that names an existing FILE is a
 * citation, not a folder: `docs/H1-operations-handbook.md` says "a short list
 * kept deliberately apart from `open-actions.md`", which the ``from `X` `` form
 * written for "run from `make-bus-leaflet`" was reading as a declaration. */
const n2Red = fixture({
  'doc.md': '# Doc\n\nA short list kept deliberately apart from `target.md`. Each of these matters.\n\n```bash\nnode tool.mjs\n```\n',
});
const n2a = run(n2Red);
rmSync(n2Red, { recursive: true, force: true });
report(n2a.code === 1 && n2a.out.includes('[C1 '),
  'C1  "apart from `a-file.md`" is prose, not a folder declaration'
  + (n2a.code === 1 ? '' : `  <-- exited ${n2a.code}, a citation is still silencing C1`));

/* W1. A leading slash is a route on the website, not a file. The portal's
 * documents write `/apply.html`; nothing in this corpus ever had, so all three
 * were reported as dead files. Skipped AND counted, never silently. */
const w1SiteOnly = fixture({
  'doc.md': '# Doc\n\nSee [the apply page](/apply.html) on the site.\n',
});
const s1 = run(w1SiteOnly);
rmSync(w1SiteOnly, { recursive: true, force: true });
report(s1.code === 0 && /site path/.test(s1.out),
  'a `/route` link is not a dead file -- skipped AND counted'
  + (s1.code === 0 ? (/site path/.test(s1.out) ? '' : '  <-- skipped silently, which is a silent filter') : `  <-- exited ${s1.code}\n${s1.out}`), 'GREEN');

const w1SiteAndDead = fixture({
  'doc.md': '# Doc\n\nSee [the apply page](/apply.html) and [the plan](no-such-document.md).\n',
});
const s2 = run(w1SiteAndDead);
rmSync(w1SiteAndDead, { recursive: true, force: true });
report(s2.code === 1 && s2.out.includes('[L1 '),
  'L1  an ordinary dead link beside a site path -- still caught'
  + (s2.code === 1 ? '' : `  <-- exited ${s2.code}, the site-path rule quietened L1`));

/* W2. `.doc-links.json` names the paths that render from the repository root --
 * the portal's `CHANGELOG.d/`, one file per entry, assembled into a page at the
 * root. 24 of its links were reported dead and every one of them resolves there.
 * Four cases, because a declaration can go wrong in four ways: applied to a
 * repository that made none, not applied where it was made, quietening a link
 * that is dead under BOTH bases, or failing to parse and passing as absence. */
const w2Undeclared = fixture({
  'frag/entry.md': '# Entry\n\nSee [the tool](tool.mjs).\n',
});
const d1 = run(w2Undeclared);
rmSync(w2Undeclared, { recursive: true, force: true });
report(d1.code === 1 && d1.out.includes('[L1 '),
  'L1  with no declaration, a root-relative link in a subfolder is still dead'
  + (d1.code === 1 ? '' : `  <-- exited ${d1.code}, a declaration is being applied to a repo that made none`));

const w2Declared = fixture({
  '.doc-links.json': '{ "resolveFromRoot": ["frag"] }',
  'frag/entry.md': '# Entry\n\nSee [the tool](tool.mjs).\n',
});
const d2 = run(w2Declared);
rmSync(w2Declared, { recursive: true, force: true });
report(d2.code === 0, 'a declared assembled fragment resolves from the root'
  + (d2.code === 0 ? '' : `  <-- exited ${d2.code}\n${d2.out}`), 'GREEN');

const w2StillRed = fixture({
  '.doc-links.json': '{ "resolveFromRoot": ["frag"] }',
  'frag/entry.md': '# Entry\n\nSee [the plan](no-such-document.md).\n',
});
const d3 = run(w2StillRed);
rmSync(w2StillRed, { recursive: true, force: true });
report(d3.code === 1 && d3.out.includes('[L1 '),
  'L1  a link dead under BOTH bases -- the declaration did not quieten L1'
  + (d3.code === 1 ? '' : `  <-- exited ${d3.code}, a declared path is now unfalsifiable`));

const w2Bad = fixture({
  '.doc-links.json': '{ this is not json',
  'doc.md': '# Doc\n\nNothing to see.\n',
});
const d4 = run(w2Bad);
rmSync(w2Bad, { recursive: true, force: true });
report(d4.code === 2 && /does not parse/.test(d4.out),
  'a `.doc-links.json` that does not parse is a refusal, not a silent fallback'
  + (d4.code === 2 ? '' : `  <-- exited ${d4.code}, an unreadable declaration passed as no declaration`));


/* ---------- THE DEFAULT CORPUS, from 2026-09-04 (buses-data OA-246) ----------
 *
 * Every case above drives --root, which names its own tree and reads no `dirs`.
 * The move put the corpus in the repository's `.doc-links.json` and made the
 * checker resolve it against the repository it is RUN FROM, and no --root case
 * can see either half. What is at risk is coverage: this checker's sibling has
 * twice reported a confident total over a population smaller than the truth.
 *
 * These therefore run the checker with its cwd set to a throwaway git repository
 * -- the path CI and a hook actually take -- and assert the DOCUMENT COUNT as
 * well as the verdict, because a verdict alone cannot express a corpus that
 * quietly shrank. */
function repoFixture(files, { staged = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'doclinks-repo-'));
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf8');
  }
  spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  if (staged) spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  const r = spawnSync(process.execPath, [CHECKER], { cwd: dir, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const counted = (out) => {
  const m = /(\d+) documents checked, plus (\d+) archived/.exec(out);
  return m ? { corpus: Number(m[1]), archived: Number(m[2]) } : null;
};

console.log('\nThe default corpus, resolved from the repository it is run from:\n');

/* NO DECLARATION MEANS THE WIDEST SCOPE, not the narrowest. A repository nobody
 * has written a `.doc-links.json` for gets its whole tree read -- which is what
 * claude-skills and the portal have always been given as `--root .`, and what
 * stops a fresh repository silently starting with a corpus of nothing. */
{
  const bare = repoFixture({
    'README.md': '# Root\n\nSee [the buried one](deep/inside/buried.md).\n',
    'deep/inside/buried.md': '# Buried\n\nSee [nothing at all](no-such-file.md).\n',
  });
  report(bare.code === 1 && /buried\.md/.test(bare.out),
    'L1  with no declaration, a dead link three folders down is still found'
    + (bare.code === 1 ? '' : `  <-- exited ${bare.code}\n${bare.out}`));
  const n = counted(bare.out);
  report(!!n && n.corpus === 2,
    `it read ${n ? n.corpus : 'no'} documents — both of them, not just the root`, 'GREEN');
}

/* A DECLARED `dirs` IS THE SCOPE, and the git enumeration adds every tracked
 * document it does not reach. That second half is the one that matters: it is
 * what OA-224 Tier 5 bought, and a move that dropped it would look identical to
 * a clean run. */
{
  const declared = repoFixture({
    '.doc-links.json': '{ "dirs": ["docs"], "files": ["README.md"] }',
    'README.md': '# Root\n\nAll well.\n',
    'docs/page.md': '# Page\n\nAll well.\n',
    'elsewhere/stray.md': '# Stray\n\nSee [nothing at all](no-such-file.md).\n',
  });
  report(declared.code === 1 && /stray\.md/.test(declared.out),
    'L1  a tracked document outside every declared folder is read anyway, from git'
    + (declared.code === 1 ? '' : `  <-- exited ${declared.code}\n${declared.out}`));
  const n = counted(declared.out);
  report(!!n && n.corpus === 3,
    `it read ${n ? n.corpus : 'no'} documents — the declared folder, the declared file and the one git found`,
    'GREEN');
}

/* AND THE ARCHIVE SPLIT SURVIVES THE MOVE. An `_archive` under a declared folder
 * is read for LINKS ONLY -- its § citations and its commands are a record of what
 * was said, not a live claim. Both halves are asserted, because a move that
 * dropped the archive from the scan and a move that promoted it to the full
 * corpus both pass a verdict-only test. */
{
  const arch = repoFixture({
    '.doc-links.json': '{ "dirs": ["docs"] }',
    'docs/page.md': '# Page\n\nAll well.\n',
    'docs/_archive/old.md': '# Old\n\nAs set out in §9.\n\n```bash\nnode no-such-script.mjs\n```\n',
  });
  report(arch.code === 0, 'an archived document’s § citation and command stay exempt under the declaration'
    + (arch.code === 0 ? '' : `  <-- exited ${arch.code}\n${arch.out}`), 'GREEN');
  const n = counted(arch.out);
  report(!!n && n.corpus === 1 && n.archived === 1,
    `${n ? `${n.corpus} in the corpus, ${n.archived} archived` : 'nothing counted'} — the split is still there`,
    'GREEN');
}

/* THE DECLARATION IS STILL READ UNDER --root, and this case is here because the
 * first cut of the move got it wrong: --root names a TREE, not a scope, and the
 * tree it names is usually a real repository whose assembled fragments depend on
 * `resolveFromRoot`. Skipping the file there reported 24 live portal links dead. */
{
  const dir = fixture({
    '.doc-links.json': '{ "resolveFromRoot": ["frag"] }',
    'tool.mjs': '// a real file at the root\n',
    'frag/entry.md': '# Entry\n\nSee [the tool](tool.mjs).\n',
  });
  const pointed = run(dir);
  rmSync(dir, { recursive: true, force: true });
  report(pointed.code === 0, 'under --root, the tree’s own resolveFromRoot is still honoured'
    + (pointed.code === 0 ? '' : `  <-- exited ${pointed.code}\n${pointed.out}`), 'GREEN');
}

console.log(`\n${failed ? `${failed} CHECK${failed === 1 ? '' : 'S'} COULD NOT BE FALSIFIED` : 'Every check was watched go red, every control stayed green, the portability cases behave the same on any platform, and the default corpus was counted rather than assumed.'}`);
process.exitCode = failed ? 1 : 0;
