#!/usr/bin/env node
/* Prove the weekly shadow rebuild can REFUSE, can count a regression without
 * failing, and never applies (buses-data OA-485 item 1).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-shadow-rebuild.mjs
 *
 * WHAT IS BEING FALSIFIED, AND WHY THE REFUSAL CASES ARE THE POINT. The job's
 * failure mode is a stamp that says "the estate is clean" about half an estate:
 * one rollout missing, refusing, dying, or writing something that is not its
 * report, and the other half's answer stamped as the whole. In every one of those
 * the runner must exit 2 and write NO stamp, so the next tick asks again. Case 6
 * holds the other promise — a dry run that wrote into Areas/ is refused, however
 * clean its report.
 *
 * AND A REGRESSION IS AN ANSWER. `rollout.js` exits 1 when a map would lose a
 * label; that is what the job counts, so case 8 holds that the runner still exits
 * 0 and stamps.
 *
 * Every fixture is a stub engine folder (two stub rollout scripts) and a little
 * buses tree in the temp folder, so nothing here builds a map or reads the real
 * estate.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'shadow_rebuild.mjs');

const report = (tool, counts, extra = {}) => ({
  tool, kind: tool === 'rollout.js' ? 'town' : 'place', engine: 'abc123', apply: false,
  counts: { total: counts.clean + counts.regressed + counts.unmeasured, ...counts },
  maps: [], ...extra,
});
const CLEAN_T = report('rollout.js', { clean: 3, regressed: 0, unmeasured: 0 });
const CLEAN_P = report('rollout_places.js', { clean: 2, regressed: 0, unmeasured: 1 });

/* A stub rollout: records its argv, optionally writes into the buses tree, writes
 * the JSON it is given to --json (or `raw` text, or nothing), exits with `code`. */
const stub = ({ json, raw, code = 0, writeArea = false }) => `
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const at = (k) => { const i = a.indexOf(k); return i < 0 ? null : a[i + 1]; };
fs.appendFileSync(path.join(__dirname, 'argv.log'), JSON.stringify(a) + '\\n');
${writeArea ? "fs.writeFileSync(path.join(at('--buses'), 'Areas', 'Stray', 'new.svg'), 'x');" : ''}
${json !== undefined ? `fs.writeFileSync(at('--json'), ${JSON.stringify(JSON.stringify(json))});` : ''}
${raw !== undefined ? `fs.writeFileSync(at('--json'), ${JSON.stringify(raw)});` : ''}
process.exit(${code});
`;

function fixture({ towns, places, git = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowrb-'));
  const engine = path.join(dir, 'engine');
  const buses = path.join(dir, 'buses');
  fs.mkdirSync(engine, { recursive: true });
  fs.mkdirSync(path.join(buses, 'Areas', 'Stray'), { recursive: true });
  if (towns !== null) fs.writeFileSync(path.join(engine, 'rollout.js'), towns, 'utf8');
  if (places !== null) fs.writeFileSync(path.join(engine, 'rollout_places.js'), places, 'utf8');
  if (git) {
    fs.writeFileSync(path.join(buses, 'Areas', 'Stray', 'kept.svg'), 'kept', 'utf8');
    const g = (...x) => spawnSync('git', ['-C', buses, '-c', 'user.name=t', '-c', 'user.email=t@t', ...x], { encoding: 'utf8' });
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'fixture');
  }
  return { dir, engine, buses, stamp: path.join(dir, 'stamp.json') };
}

const run = (f) => {
  const r = spawnSync(process.execPath, [RUNNER, '--buses', f.buses, '--engine', f.engine, '--out', f.stamp], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};

let failed = 0;
const ran = { 'RED  ': 0, GREEN: 0 };
const say = (ok, text, label = 'RED  ') => { if (!ok) failed++; ran[label]++; console.log(`  ${ok ? label : 'MISS '} ${text}`); };

function refusal(name, spec, want) {
  const f = fixture(spec);
  const { code, err } = run(f);
  const stamped = fs.existsSync(f.stamp);
  fs.rmSync(f.dir, { recursive: true, force: true });
  say(code === 2 && !stamped && want.test(err) && /No stamp was written/.test(err),
    name + (code === 2 && !stamped ? '' : `  <-- exited ${code}, stamped=${stamped}\n${err}`));
}

console.log('A half it cannot run — it must REFUSE, name which half, and stamp nothing:\n');

refusal('rollout.js not on disk — exit 2, named, no stamp',
  { towns: null, places: stub({ json: CLEAN_P }) }, /rollout\.js is not at/);
refusal('rollout_places.js refuses (exit 2) — exit 2, named, no stamp',
  { towns: stub({ json: CLEAN_T }), places: stub({ code: 2 }) }, /rollout_places\.js exited 2/);
refusal('rollout.js exits 0 and writes no --json report — exit 2, no stamp',
  { towns: stub({}), places: stub({ json: CLEAN_P }) }, /wrote no --json report/);
refusal('rollout_places.js writes text that is not JSON — exit 2, no stamp',
  { towns: stub({ json: CLEAN_T }), places: stub({ raw: 'DRY-RUN done' }) }, /is not JSON/);
refusal('rollout.js writes JSON that is not a rollout report — exit 2, no stamp',
  { towns: stub({ json: { ok: true } }), places: stub({ json: CLEAN_P }) }, /not a rollout report/);
refusal('a report that says it APPLIED — exit 2, no stamp',
  { towns: stub({ json: { ...CLEAN_T, apply: true } }), places: stub({ json: CLEAN_P }) }, /never applies/);
refusal('a dry run that wrote into Areas/ — exit 2, no stamp, however clean its report',
  { towns: stub({ json: CLEAN_T, writeArea: true }), places: stub({ json: CLEAN_P }), git: true }, /Areas\/ or Places\/ changed/);

console.log('\nControls — an answer, including a regression, is stamped:\n');

{
  const f = fixture({ towns: stub({ json: CLEAN_T }), places: stub({ json: CLEAN_P }), git: true });
  const { code, out, err } = run(f);
  const s = fs.existsSync(f.stamp) ? JSON.parse(fs.readFileSync(f.stamp, 'utf8')) : null;
  const argv = fs.readFileSync(path.join(f.engine, 'argv.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  fs.rmSync(f.dir, { recursive: true, force: true });
  say(code === 0 && s && s.counts.clean === 5 && s.counts.unmeasured === 1 && s.counts.total === 6 && s.estateUntouched === true
    && s.towns.tool === 'rollout.js' && s.places.tool === 'rollout_places.js' && s.engine === 'abc123',
    'both halves clean — exit 0, stamp sums both, estate checked untouched'
    + (code === 0 && s ? '' : `  <-- exited ${code}\n${out}${err}`), 'GREEN');
  say(argv.length === 2 && argv.every((a) => a.includes('--all') && a.includes('--json') && !a.includes('--apply') && !a.includes('--force') && !a.includes('--rebuild-stale')),
    'each rollout was called --all --json and never with --apply, --force or --rebuild-stale'
    + (argv.length === 2 ? '' : `  <-- ${argv.length} call(s)`), 'GREEN');
}

{
  const regressed = report('rollout.js', { clean: 1, regressed: 2, unmeasured: 0 }, {
    maps: [{ name: 'A', status: 'DRY-RUN', verdict: 'regressed', lost: 3 }, { name: 'B', status: 'FAIL', verdict: 'regressed' }],
  });
  const f = fixture({ towns: stub({ json: regressed, code: 1 }), places: stub({ json: CLEAN_P }) });
  const { code, out, err } = run(f);
  const s = fs.existsSync(f.stamp) ? JSON.parse(fs.readFileSync(f.stamp, 'utf8')) : null;
  fs.rmSync(f.dir, { recursive: true, force: true });
  say(code === 0 && s && s.counts.regressed === 2 && /regressed: A \(DRY-RUN, 3 label\(s\) lost\)/.test(out),
    'rollout.js exits 1 over two regressed maps — exit 0, stamped, both named'
    + (code === 0 && s ? '' : `  <-- exited ${code}\n${out}${err}`), 'GREEN');
}

console.log(`\n${ran['RED  ']} refusal case(s) and ${ran.GREEN} control(s) ran.`);
if (failed) { console.log(`${failed} case(s) MISSED — the shadow rebuild does not do what it says.`); process.exit(1); }
console.log('Every case held: the shadow rebuild refuses rather than stamping half an estate.');
