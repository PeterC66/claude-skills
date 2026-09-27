/*
 * rollout_places_fastpath.test.js — a place whose SCHEMATIC would be redrawn is not
 * UP-TO-DATE (buses-data OA-463, 2026-09-26).
 *
 * WHAT WENT WRONG. On 2026-09-24 OA-165 moved two forced labels on High Wycombe
 * Aldi's schematic. The dry run of rollout_places.js said every sheet gated PASS,
 * because its fast path gated internal, external and boarding and never the
 * schematic; a tick believed it and its pin bump went red in CI. rollout.js had
 * learned the same lesson for towns on 2026-08-28 (OA-147). The fast path now gates
 * the schematic and the diagram the way status.js does.
 *
 * HOW THIS PROVES IT. The fixture estate's Aldi has no S4 run folder, so the tool
 * reads its tracked ci-reference/ as the previous S4 (latestRunDir's fallback). The
 * control runs the dry run on an untouched copy and must say UP-TO-DATE — a case
 * that "fails" a gate which was already failing proves nothing. Then ONE label on
 * the committed schematic keeps its text and moves, which is exactly the OA-165
 * shape: the schematiser still draws it where it was, and the tool must no longer
 * call the place current. What it does next (the scratch build cannot pull S1 from
 * a fixture, so it stops) is not this test's subject; that it did not say
 * UP-TO-DATE or STAMP-STALE is.
 *
 * Before the fix, the second case printed UP-TO-DATE — watched on 2026-09-26.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR, load } = require('./_engine');

const PLACE = 'High Wycombe Aldi';
const FIXTURE = path.join(__dirname, 'fixtures', 'estate', 'Places', '_standalone', PLACE);
const SHEET = path.join('ci-reference', 'internal-schematic.svg');
const LABEL = 'Tannery Road Ind Est';

function estate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa463-'));
  fs.cpSync(FIXTURE, path.join(root, 'Places', '_standalone', PLACE), { recursive: true });
  return root;
}

function verdict(root) {
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, 'rollout_places.js'), '--buses', root, '--place', PLACE],
                      { encoding: 'utf8' });
  const m = /Summary: High Wycombe Aldi=(\S+)/.exec(r.stdout || '');
  assert.ok(m, 'the dry run printed no summary for the place:\n' + r.stdout + r.stderr);
  return { status: m[1], out: r.stdout };
}

test('the fixture still carries the schematic and the label this test moves', () => {
  const rj = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'ci-reference', 'routes.json'), 'utf8'));
  assert.ok(rj.internalSchematic, 'Aldi no longer asks for a schematic — pick another place for this test');
  assert.ok(fs.readFileSync(path.join(FIXTURE, SHEET), 'utf8').includes('>' + LABEL + '</text>'),
    `the schematic no longer prints "${LABEL}"`);
});

test('control: an untouched place with a schematic is UP-TO-DATE, and the schematic is named', () => {
  const root = estate();
  try {
    const v = verdict(root);
    assert.strictEqual(v.status, 'UP-TO-DATE', v.out);
    assert.match(v.out, /schematic/, 'the verdict must say the schematic was gated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a schematic label that kept its text and moved is not UP-TO-DATE', () => {
  const root = estate();
  try {
    const p = path.join(root, 'Places', '_standalone', PLACE, SHEET);
    const svg = fs.readFileSync(p, 'utf8');
    const re = new RegExp('<text x="([\\d.]+)"([^>]*>' + LABEL + '</text>)');
    assert.ok(re.test(svg), 'the label is not in the expected <text x="…"> form');
    fs.writeFileSync(p, svg.replace(re, (_, x, rest) => `<text x="${(Number(x) - 12).toFixed(2)}"${rest}`));
    const v = verdict(root);
    assert.ok(!['UP-TO-DATE', 'STAMP-STALE'].includes(v.status),
      `a schematic the current engine would redraw was reported ${v.status}:\n${v.out}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('labelDiff reports a label that kept its text and changed place', () => {
  const { labelDiff } = load('gate_lib.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa463-'));
  try {
    const put = (n, t) => { const f = path.join(dir, n); fs.writeFileSync(f, t); return f; };
    const before = ['<text x="10" y="20">Aldi</text>', '<text x="10" y="30">Uxbridge</text>',
                    '<text x="5" y="208">build 2.7 · 24 Aug 2026</text>'].join('\n');
    const after = ['<text x="14" y="20">Aldi</text>', '<text x="10" y="30">Uxbridge</text>',
                   '<text x="6" y="208">build 2.8 · 25 Aug 2026</text>'].join('\n');
    const d = labelDiff(put('old.svg', before), put('new.svg', after));
    assert.deepStrictEqual(d.moved, ['Aldi'], 'the moved label, and neither the still one nor the version stamp');
    assert.deepStrictEqual(d.lost, []);
    assert.deepStrictEqual(labelDiff(put('a.svg', before), put('b.svg', before)).moved, [], 'nothing moved, nothing reported');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
