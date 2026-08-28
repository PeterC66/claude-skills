#!/usr/bin/env node
/*
 * prove-red-design-keys.js — break `check-design-keys.js` on purpose and
 * require it to notice, because a green check that has never been seen to go
 * red proves nothing.
 *
 *   node tools/prove-red-design-keys.js
 *
 * Run from `make-bus-leaflet/`. No arguments.
 *
 * THE HARNESS HAS TWO HALVES AND THE CONTROL IS THE IMPORTANT ONE. Five
 * mutations each break one thing the checker claims to catch, and every one is
 * reverted before the next. The CONTROL runs the checker unmutated and
 * requires green — without it, a checker that failed on everything would pass
 * every red case and the run would look like proof.
 *
 * AND THE CONTROL COUNTS THE POPULATION ITSELF. `check-design-keys.js` exists
 * because a document asserted completeness and was a subset; a harness that
 * only read its verdict would be the same mistake one level up. So the control
 * re-counts the `design.*` keys by its own independent walk — line by line,
 * rather than the checker's whole-file `matchAll` — and requires the printed
 * number to match. A checker that quietly went blind to half the engine would
 * still print a tidy "every key documented" and would fail here.
 *
 * A CRASH IS NOT A RED. Each case asserts the MESSAGE, not just the non-zero
 * exit, and rejects any stderr carrying a stack frame: a checker that threw
 * while reading a mutated fixture exits 1 for a reason that has nothing to do
 * with the fault it was meant to find, and counting that as a pass is how a
 * harness certifies a check it never exercised.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SK = path.join(__dirname, '..');
const CHECKER = path.join(SK, 'tools/check-design-keys.js');
const REAL_ASSETS = path.join(SK, 'assets');
const REAL_DOC = path.join(SK, 'references/design-quality.md');

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-design-keys-'));
const FIX_ASSETS = path.join(WORK, 'assets');
const FIX_DOC = path.join(WORK, 'design-quality.md');
const EMPTY = path.join(WORK, 'empty');

fs.mkdirSync(FIX_ASSETS);
fs.mkdirSync(EMPTY);
for (const f of fs.readdirSync(REAL_ASSETS)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(REAL_ASSETS, f), path.join(FIX_ASSETS, f));
}
const DOC0 = fs.readFileSync(REAL_DOC, 'utf8');
const restoreDoc = () => fs.writeFileSync(FIX_DOC, DOC0);
restoreDoc();

const run = (assets, doc) => {
  const r = spawnSync(process.execPath, [CHECKER, '--assets', assets, '--doc', doc], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '' };
};

/* an independent count of the population, walked differently from the checker */
function countKeysIndependently(dir) {
  const seen = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      let rest = line;
      for (;;) {
        const i = rest.search(/\b(?:design|DESIGN)\./);
        if (i < 0) break;
        rest = rest.slice(i).replace(/^(?:design|DESIGN)\./, '');
        const m = rest.match(/^[A-Za-z][A-Za-z0-9]*/);
        if (m) seen.add(m[0]);
      }
    }
  }
  return seen.size;
}

let failures = 0;
const say = (ok, name, why) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + why}`);
};

/* ---- the control ------------------------------------------------------ */
console.log('control:');
{
  const r = run(FIX_ASSETS, FIX_DOC);
  say(r.code === 0, 'unmutated fixtures are green', `exit ${r.code}: ${r.out.trim().slice(0, 300)}`);
  const m = r.out.match(/(\d+) design\.\* keys read across (\d+) engine files, (\d+) rows in the register/);
  if (!m) {
    say(false, 'the control prints both counts', `no count line in: ${r.out.trim().slice(0, 200)}`);
  } else {
    const mine = countKeysIndependently(FIX_ASSETS);
    say(+m[1] === mine, 'the key count matches an independent walk', `checker says ${m[1]}, this harness counts ${mine}`);
    say(+m[1] === +m[3], 'every key has a row and every row a key', `${m[1]} keys against ${m[3]} rows`);
    say(mine > 25, 'the population is the whole engine, not a corner of it', `only ${mine} keys found — the scan is not reaching the engine`);
    console.log(`        (${m[1]} keys, ${m[2]} files, ${m[3]} rows)`);
  }
}

/* ---- the mutations ---------------------------------------------------- */
const cases = [
  {
    name: 'a register row deleted',
    expect: /design\.laneOrientation is read by the engine .* and has no row in the register/,
    apply() {
      const lines = DOC0.split(/\r?\n/);
      const i = lines.findIndex((l) => /^\|\s*`laneOrientation`\s*\|/.test(l));
      if (i < 0) throw new Error('fixture anchor gone: no laneOrientation row to delete');
      lines.splice(i, 1);
      fs.writeFileSync(FIX_DOC, lines.join('\n'));
    },
  },
  {
    name: 'a register row for a key nothing reads',
    expect: /design\.notARealKey has a register row .* and is read nowhere/,
    apply() {
      const lines = DOC0.split(/\r?\n/);
      const i = lines.findIndex((l) => /^\|\s*`footerSafe`\s*\|/.test(l));
      if (i < 0) throw new Error('fixture anchor gone: no footerSafe row to insert after');
      lines.splice(i + 1, 0, '| `notARealKey` | off | A row the engine has never read. |');
      fs.writeFileSync(FIX_DOC, lines.join('\n'));
    },
  },
  {
    name: 'a new key added to the engine',
    expect: /design\.freshlyInvented is read by the engine \(gen_internal\.js\) and has no row in the register/,
    apply() {
      fs.appendFileSync(path.join(FIX_ASSETS, 'gen_internal.js'), '\nconst FRESHLY = DESIGN.freshlyInvented || false;\n');
    },
    revert() {
      fs.copyFileSync(path.join(REAL_ASSETS, 'gen_internal.js'), path.join(FIX_ASSETS, 'gen_internal.js'));
    },
  },
  {
    name: 'the register heading renamed out from under it',
    expect: /heading in .* the register moved or was renamed/,
    apply() {
      fs.writeFileSync(FIX_DOC, DOC0.replace(/^## `design`$/m, '## `design` keys'));
    },
  },
  {
    name: 'the engine scan pointed at nothing',
    expect: /found no design\.\* reads at all/,
    assets: () => EMPTY,
    apply() {},
  },
];

console.log('mutations:');
for (const c of cases) {
  restoreDoc();
  c.apply();
  const r = run(c.assets ? c.assets() : FIX_ASSETS, FIX_DOC);
  if (c.revert) c.revert(); else restoreDoc();

  if (r.code === 0) { say(false, c.name, 'the checker stayed GREEN — this fault is not covered'); continue; }
  if (/^\s+at /m.test(r.err)) { say(false, c.name, `the checker THREW rather than reporting: ${r.err.trim().slice(0, 200)}`); continue; }
  say(c.expect.test(r.out), c.name, `red, but for the wrong reason: ${r.out.trim().slice(0, 260)}`);
}

/* ---- and green again once the fixtures are put back -------------------- */
restoreDoc();
console.log('control, repeated:');
{
  const r = run(FIX_ASSETS, FIX_DOC);
  say(r.code === 0, 'green again after every mutation is reverted', `exit ${r.code}: ${r.out.trim().slice(0, 300)}`);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log('');
if (failures) { console.error(`${failures} check${failures > 1 ? 's' : ''} failed — the design-key register gate is not proven.`); process.exit(1); }
console.log(`${cases.length} mutations, each caught for its own reason; controls green before and after.`);
