/*
 * s6_next.mjs — which ONE stale S6 a loop tick takes next, and the recipe it takes it by
 * (buses-data, step 1 of `Development Docs/s6-commissioning-and-a-shared-job-runner_2026-10-17.md`,
 * Peter's yes on 17 October 2026).
 *
 * WHY THIS EXISTS. Until this landed the `s6-stale` and `s6-stale-places` rows carried no
 * unattended recipe, so the bus loop never took them, and the place row ended with "Ask
 * Peter before buying more than one" — a sentence written before the month's red-team
 * budget existed (`redteam-budget.json`, OA-427, 22 September), with no budget check behind
 * it. Built place maps sat undelivered because their S6 predated their data, and each S6
 * waited for Peter twice: once to start it and once to approve the second buy. The budget
 * file IS Peter's answer to "how many may be bought", so the ration is now
 * `redteam_source.js`'s alone: REUSE where it can, BUY while the month has room, WAIT (exit
 * 11, a chore and never a red) when it has none.
 *
 * THE ORDER. One S6 per tick. A map a delivery is waiting on comes first, because its S6 is
 * the last thing between a built map and its customer; then the map that has waited
 * longest, by the day its data first moved past its S6 (`staleSince`, s6_stale_limit.js);
 * a map with no S6 at all counts as having waited longest of all; then the name, so the
 * order never depends on the disk's.
 *
 * WHAT IS LEFT OUT. A map whose newest S6 is BLOCKED is not queued: an open action owns
 * those hard findings (undelivered.mjs says which), and a tick re-running S6 under it would
 * only file a second hold for the same findings.
 *
 * Pure: no disk, no clock. worklist.mjs passes the rows it already read.
 */
import path from 'node:path';

const posix = (p) => String(p).replace(/\\/g, '/');

/** Every map whose S6 a tick may take, in the order it should take them. */
export function s6Queue({ towns = [], places = [], undelivered = [] } = {}) {
  const pending = new Set(undelivered.filter((u) => u && !u.s6Blocked && u.subject).map((u) => u.subject));
  const blocked = (r) => !!(r.s6v && r.s6v.verdict === 'blocked');
  const rows = towns.filter((t) => t.built && t.s6Stale && !blocked(t)).map((t) => ({ row: t, kind: 'town' }))
    .concat(places.filter((p) => p.built && p.s6Stale && !blocked(p)).map((p) => ({ row: p, kind: 'place' })));
  return rows.map(({ row, kind }) => ({
    name: row.name, kind, dir: row.dir || null,
    parent: kind === 'place' && !row.standalone && row.dir ? path.dirname(path.dirname(row.dir)) : null, // Areas/<Town>/Places/<Place>
    parentName: kind === 'place' && !row.standalone ? (row.town || null) : null,
    standalone: kind === 'place' && !!row.standalone,
    deliveryPending: pending.has(row.name),
    waitingSince: row.s6 ? (row.s6StaleSince || null) : '',   // '' = never verified: sorts first
  })).sort((a, b) => (b.deliveryPending - a.deliveryPending)
    || (a.waitingSince === null) - (b.waitingSince === null)       // an unreadable date sorts last, never first
    || String(a.waitingSince).localeCompare(String(b.waitingSince))
    || a.name.localeCompare(b.name));
}

/**
 * The `unattended` block for the head of the queue, or null when there is nothing to take
 * or no engine folder to name. `queue` carries the rest, because on a WAIT the next map may
 * still REUSE for nothing (a dry run costs nothing); `steps` is the recipe, in order.
 */
export function s6Unattended(queue, { assetsDir = null, placeAssetsDir = null } = {}) {
  if (!assetsDir || !queue || !queue.length) return null;
  const [m] = queue;
  if (!m.dir) return null;
  const SK = posix(assetsDir), PSK = posix(placeAssetsDir || path.join(assetsDir, '..', '..', 'make-place-bus-leaflet', 'assets'));
  const dir = posix(m.dir);
  const source = `node "${SK}/redteam_source.js"`;
  const borrow = m.parent ? ` --build "${posix(m.parent)}" --foreign-build` : '';
  const dry = (b) => `\`${source} --dry-run${b} --into "${dir}/S6-verify/dry"\``;
  return {
    through: 'S6',
    map: m.name, kind: m.kind, dir, cwd: dir,
    why: m.deliveryPending ? 'a delivery is waiting on it' : (m.waitingSince ? `stale since ${m.waitingSince}` : 'never verified'),
    procedure: `${SK.replace(/\/assets$/, '')}/references/s6-verify.md`,
    steps: [
      `DECIDE FIRST, WRITING NOTHING: ${m.parent ? `${dry(borrow)}, which asks whether ${m.parentName}'s blind answer can be borrowed; if it does not exit 0, ${dry('')}, which asks about the place's own answers` : dry('')}. Exit 0 = REUSE, 10 = BUY, 11 = WAIT (the month's budget is spent). On WAIT, ask the next map in \`queue\` the same way and take the first that does not WAIT; when every one WAITs there is nothing to do, a chore and not a hold, and nothing is written.`,
      `From the map's folder: \`node "${SK}/stage.js" new S6\`; every later step runs from the run folder it prints, "<map folder>/S6-verify/<run id>".`,
      `\`node "${SK}/stage.js" pull S1\`, then \`pull S2\`, then \`pull S3\` (three calls), and copy corridors_report.json in from the latest S4 run if it wrote one.`,
      ...(m.kind === 'place' ? [`\`node "${PSK}/place_verified_services.js"\` (a place's S1 has no verified-services.json).`] : []),
      `The same \`redteam_source.js\` call the dry run chose, without --dry-run and without --into. REUSE: skip the agent. BUY: extend the lock's lease, then spawn the blind red-team agent IN THE FOREGROUND, with the exact prompt and the model rule in the procedure.`,
      `\`node "${SK}/verify_report.js"\`. Exit 1 (HARD) or 3 (unreviewed S1) = commit nothing and raise a HOLD naming the map and quoting its HARD lines; exit 2 = a HOLD quoting what it printed.`,
      `\`python3 "${SK}/gen_verification.py" verification.json\`; give every SERVICE claim a home before committing (notOnLeaflet[], redteamRejected[], or service-facts.json as \`queued\` with the question), checked by \`node "${posix(path.join(assetsDir, '..', '..', 'tools', 'check-s6-claims.mjs'))}"\` from the buses root.`,
      `\`node "${SK}/stage.js" commit S6 "<run folder>" --outputs redteam.json,verification.json,verification.docx --based-on "S1=…;S2=…;S3=…;S4=…" --note "<N hard / N soft; REUSED from <run> | BOUGHT>"\`, then commit what \`git status --porcelain --untracked-files=all -- "<map folder>"\` lists, with commit_paths.mjs. Never push.`,
    ],
    queue: queue.slice(1).map((q) => q.name),
    then: 'Stop there. Delivering the map is a separate unit and stays Peter\'s: the undelivered row offers it once this S6 passes.',
  };
}
