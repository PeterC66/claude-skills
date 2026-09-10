#!/usr/bin/env node
/*
 * prove-red-town-status.mjs — break town_status.mjs on purpose, and keep a control green.
 *
 * WHY. `town_status.mjs` answers "what is the status of <map>?" by joining four
 * sources, and three of its four answers are NEGATIVES — this map is not on the
 * public site, no thread names it, nothing is outstanding. A negative is the one
 * kind of answer that looks identical whether the check works or does nothing at
 * all, which is the lesson recorded on 2026-09-10 as *the negative from a search
 * that was never shown to find anything*. So every case below comes in a pair:
 * one that must find the thing, one that must not.
 *
 * THE CASE THAT PAID FOR THIS FILE. The first version of `corrFacts()` searched a
 * thread README for the map's name anywhere in the file, and reported CORR-005 —
 * the Shelfords thread — as correspondence about RAMSEY, because its second
 * paragraph says "the Ramsey adviser was recruited out of a fault report" while
 * comparing candidate advisers. Case 2 is that shape, reduced to a fixture.
 *
 * THE STUB PORTAL is a real HTTP server on a loopback port serving a real JSON
 * body, not a monkey-patched `fetch`. The thing under test is whether the tool
 * reads the PUBLIC LIST correctly, and a stubbed client would test the stub.
 *
 * Run from anywhere. No arguments, no network, writes only to a temp directory it
 * deletes afterwards:
 *
 *   node prove-red-town-status.mjs
 *
 * Exit 0 every case behaved · 1 a case did not.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'town_status.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'town-status-red-'));

let failures = 0;
const ok = (name, cond, detail) => {
  process.stdout.write(`${cond ? '  ok  ' : '  FAIL'}  ${name}\n`);
  if (!cond) { failures++; if (detail) process.stdout.write(`        ${detail}\n`); }
};

/* ---- a throwaway buses-data ------------------------------------------- */
function write(rel, body) {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
const manifest = (name) => JSON.stringify({
  town: name,
  stages: {
    S1: { latest: 'r1', runs: [{ id: 'r1', at: '2026-09-01T10:00' }] },
    S5: { latest: 'v1.0_r1', runs: [{ id: 'v1.0_r1', at: '2026-09-02T10:00' }] },
    S6: { latest: 'r6', runs: [{ id: 'r6', at: '2026-09-03T10:00' }] },
  },
}, null, 1);

write('Areas/Fixtown/manifest.json', manifest('Fixtown'));
write('Areas/Fixtown/S6-verify/r6/verification.json', JSON.stringify({ findings: [] }));
write('Areas/Otherplace/manifest.json', manifest('Otherplace'));
write('Areas/Otherplace/S6-verify/r6/verification.json', JSON.stringify({ findings: [] }));

// The thread that IS about Fixtown — declares it on its About line.
write('Correspondence/CORR-900/README.md', `# CORR-900 — the Fixtown reader

**About:** the Fixtown map — \`Areas/Fixtown/\` · **Status:** open, waiting on them

| # | Date | Direction | Subject | Where |
|---|---|---|---|---|
| 001 | 2026-09-01 | in | It is wrong | here |
| 002 | 2026-09-02 | out | Thank you | here |
`);

// The CORR-005 shape: a thread about somewhere else that MENTIONS Fixtown in prose.
write('Correspondence/CORR-901/README.md', `# CORR-901 — the Otherplace volunteer

**About:** the Otherplace map — \`Areas/Otherplace/\` · **Status:** open

She is the first volunteer who came unprompted — the Fixtown adviser was recruited
out of a fault report, which is a different thing entirely.

| # | Date | Direction | Subject | Where |
|---|---|---|---|---|
| 001 | 2026-09-05 | in | Could you make one for us | here |
| 002 | 2026-09-06 | out | Yes — here is where it stands | here |
`);

/* ---- a stub portal ----------------------------------------------------- */
const PUBLIC_BODY = JSON.stringify([
  { slug: 'otherplace', name: 'Otherplace', version: 'v3.0', url: '/m/otherplace', servicesUrl: '/m/otherplace/services' },
]);
const server = http.createServer((req, res) => {
  if (req.url === '/api/public/maps') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(PUBLIC_BODY); }
  else { res.writeHead(404); res.end('{}'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const STUB = `http://127.0.0.1:${server.address().port}`;

/* ---- runner ------------------------------------------------------------ */
// ASYNC, and that is load-bearing. The stub portal is an http.Server in THIS
// process, so a synchronous execFileSync would block this event loop and the stub
// could never answer the child — every network case then failed with "no answer in
// 8s" and cases 4, 5 and 9 reported the tool broken when the HARNESS was. A test
// rig that cannot serve its own fixture produces findings about itself.
async function run(args) {
  try {
    const { stdout } = await execFileP(process.execPath, [TOOL, ...args, '--buses', tmp], { encoding: 'utf8' });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

process.stdout.write(`\nprove-red-town-status — fixture at ${tmp}\n\n`);

/* 1. It CAN find a thread. Without this, case 2 proves nothing. */
{
  const r = await run(['Fixtown', '--url', STUB]);
  ok('1  a thread that declares the map on its About line IS reported', /CORR-900/.test(r.out), r.out.slice(0, 300));
}

/* 2. THE BUG: a thread that merely mentions the map in prose is NOT reported. */
{
  const r = await run(['Fixtown', '--url', STUB]);
  ok('2  a thread that only MENTIONS the map in prose is NOT reported (the CORR-005 shape)',
    !/CORR-901/.test(r.out), 'CORR-901 is about Otherplace and only names Fixtown in a comparison');
}

/* 3. …and the same thread IS reported for the map it is actually about. */
{
  const r = await run(['Otherplace', '--url', STUB]);
  ok('3  that same thread IS reported for its own map', /CORR-901/.test(r.out), r.out.slice(0, 300));
}

/* 4. Absent from the public list -> INVISIBLE, exit 1. */
{
  const r = await run(['Fixtown', '--url', STUB]);
  ok('4  a map absent from the public list reports INVISIBLE and exits 1',
    r.code === 1 && /INVISIBLE/.test(r.out), `exit ${r.code}`);
}

/* 5. Present in the public list -> not invisible. The pair for case 4. */
{
  const r = await run(['Otherplace', '--url', STUB]);
  ok('5  a map present in the public list is NOT reported invisible',
    !/INVISIBLE/.test(r.out) && /yes — /.test(r.out), r.out.slice(0, 300));
}

/* 6. An unreachable portal is NOT an invisible map: exit 2, and say so. */
{
  const r = await run(['Fixtown', '--url', 'http://127.0.0.1:9']);
  ok('6  an unreachable portal exits 2 and does not claim the map is missing',
    r.code === 2 && /NOT a report that the map is missing/.test(r.out) && !/INVISIBLE/.test(r.out), `exit ${r.code}`);
}

/* 7. An unknown flag is refused by name, exit 2 — never silently ignored. */
{
  const r = await run(['Fixtown', '--tree', '--url', STUB]);
  ok('7  an unknown flag is refused by name with exit 2', r.code === 2 && /unknown flag --tree/.test(r.out), `exit ${r.code}`);
}

/* 8. An unknown map is exit 2 ("I cannot tell you"), never a clean 0. */
{
  const r = await run(['Nowhereville', '--url', STUB]);
  ok('8  an unknown map exits 2, not 0', r.code === 2, `exit ${r.code}`);
}

/* 9. THE CONTROL: a healthy, listed map with nothing outstanding exits 0.
      A tool that can never say "all clear" is as useless as one that can never
      go red, and this is the case that catches a rule left permanently on. */
{
  const r = await run(['Otherplace', '--url', STUB]);
  const clean = r.code === 0 && /Nothing on this map needs attention/.test(r.out);
  ok('9  CONTROL — a healthy listed map exits 0 and says nothing needs attention',
    clean, `exit ${r.code}\n${r.out.slice(0, 400)}`);
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${failures ? `${failures} case(s) did not behave.` : 'All 9 cases behaved.'}\n`);
process.exitCode = failures ? 1 : 0;
