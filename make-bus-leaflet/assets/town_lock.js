/*
 * town_lock.js — the per-town build lock, `<town>/.lock.d` (buses-data OA-552).
 * Its own module so stage.js, which the line ratchet holds, does not grow; the
 * worklist reads it too, through `heldTowns`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/*
 * ONE LOCK PER TOWN, NOT ONE PER TREE. `loop/LOCK.d` is held for a whole tick and
 * an interactive holder is never stolen from, so a person building one map stalled
 * every other. This lock is the same shape — an atomic `mkdir`, a `holder` file —
 * but it fences a single town folder, so two sessions build two towns together and
 * neither builds the same one.
 *
 * IT LIVES IN THE MAIN CHECKOUT'S TOWN FOLDER, never a worktree's. A worktree has
 * its own `Areas/<Town>/`, so a lock there would fence nobody; `stage.js attach`
 * resolves the main folder and takes the lock there. The folder is gitignored
 * (`Areas/**` and `Places/**` `/.lock.d/`), so it cannot be committed.
 *
 * `holder`: line 1 is `<session name> <ISO time>`, line 2 `expires: <ISO time>`,
 * the loop lock's own format. Unlike that lock, a town lock whose lease has run out
 * MAY be taken over: it fences one town and a build is hours, not days, so an
 * abandoned one should cost a town for a lease and not for ever. The name is the
 * session's, as `ListAgents` shows it.
 */
const DEFAULT_LEASE_MIN = 180;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z/;

const lockDir = (townDir) => path.join(townDir, '.lock.d');

function parseWhen(text) {
  const m = ISO_RE.exec(text || '');
  const t = m ? Date.parse(m[0]) : NaN;
  return Number.isFinite(t) ? t : null;
}

// The lock as it stands: { held, name, takenAt, expires, expired, remainMin }. Absent fields are null, never guessed.
function read(townDir, now = Date.now()) {
  const dir = lockDir(townDir);
  const out = { held: false, dir, name: null, takenAt: null, expires: null, expired: null, remainMin: null };
  if (!fs.existsSync(dir)) return out;
  out.held = true;
  let raw = '';
  try { raw = fs.readFileSync(path.join(dir, 'holder'), 'utf8'); } catch (e) { /* the directory is the lock; an unreadable holder is still a held lock */ }
  const lines = raw.split(/\r?\n/);
  out.name = (lines[0] || '').trim().split(/\s+/)[0] || null;
  out.takenAt = parseWhen(lines[0]);
  const exp = lines.find((l) => /^\s*expires\s*:/i.test(l));
  out.expires = exp ? parseWhen(exp) : null;
  // No parseable expiry falls back to the directory's own mtime plus the default lease, so a hand-made lock still ends.
  if (out.expires === null) {
    let t = out.takenAt;
    if (t === null) { try { t = fs.statSync(dir).mtimeMs; } catch (e) { t = null; } }
    if (t !== null) out.expires = t + DEFAULT_LEASE_MIN * 60000;
  }
  if (out.expires !== null) {
    out.expired = now > out.expires;
    out.remainMin = out.expired ? 0 : Math.floor((out.expires - now) / 60000);
  }
  return out;
}

function writeHolder(dir, name, now, leaseMin) {
  const iso = (t) => new Date(t).toISOString();
  fs.writeFileSync(path.join(dir, 'holder'), `${name} ${iso(now)}\nexpires: ${iso(now + leaseMin * 60000)}\n`);
}

// Take the lock, or renew it when `name` already holds it, or take over an expired one. { ok, why, was }.
function take(townDir, name, { now = Date.now(), leaseMin = DEFAULT_LEASE_MIN } = {}) {
  if (!name || /\s/.test(name)) return { ok: false, why: 'a lock needs the session name, one word, as ListAgents shows it' };
  const dir = lockDir(townDir);
  const cur = read(townDir, now);
  if (cur.held && cur.name !== name && !cur.expired) {
    return { ok: false, why: `held by ${cur.name || 'an unreadable holder'}${cur.remainMin !== null ? `, ${cur.remainMin} min of lease left` : ''}`, was: cur };
  }
  if (cur.held && cur.name !== name) fs.rmSync(dir, { recursive: true, force: true }); // expired, somebody else's: a real folder, never a link
  try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; if (read(townDir, now).name !== name) return { ok: false, why: 'lost the race to another session', was: read(townDir, now) }; }
  writeHolder(dir, name, now, leaseMin);
  return { ok: true, was: cur.held ? cur : null };
}

// Release only a lock `name` holds, unless `force`. { ok, why }.
function release(townDir, name, { force = false } = {}) {
  const cur = read(townDir);
  if (!cur.held) return { ok: true, why: 'not held' };
  if (cur.name !== name && !force) return { ok: false, why: `held by ${cur.name || 'an unreadable holder'}, not ${name}` };
  fs.rmSync(lockDir(townDir), { recursive: true, force: true });
  return { ok: true };
}

// Every held town under a buses root: [{ name, holder, dir, ...read }]. The estate is walked by gate_lib, the one owner of that walk.
function heldTowns(busesDir, now = Date.now()) {
  const { findTowns, findPlaces } = require('./gate_lib');
  const towns = findTowns(busesDir);
  const out = [];
  for (const t of [...towns, ...findPlaces(towns)]) {
    const r = read(t.dir, now);
    if (r.held) out.push({ ...r, name: path.basename(t.dir), holder: r.name, dir: t.dir });
  }
  return out;
}

module.exports = { read, take, release, heldTowns, lockDir, DEFAULT_LEASE_MIN };
