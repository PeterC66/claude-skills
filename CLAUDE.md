# claude-skills — what a session needs to know before touching this repo

This repository holds the skills. `make-bus-leaflet/assets/` **is the bus-map engine** — every generator, gate and helper that draws a sheet. The data those generators run on is not here; it is in `C:\u3a St Ives\Using AI\Buses` (repo `buses-data`), and the live site that also runs this engine is `C:\Claude\community-bus-maps` (repo `community-bus-maps`).

## The one rule that catches people out

**A generator change is not done when the gate passes. It is done when the portal has been re-vendored.**

Fifteen files under `make-bus-leaflet/assets/` and `make-place-bus-leaflet/assets/` exist as byte-for-byte copies in the portal's `engine/`, listed in `community-bus-maps/engine/vendored.json` with a CRLF-normalised SHA-256 each. Edit one here and the portal keeps running the old code until someone copies it across. `status.js` reports the drift; the portal's own `scripts/check-vendored.mjs` reports it from the other side.

Two traps inside that rule, both already paid for:

- **Compare the way the checker compares.** `vendored.json` hashes CRLF-normalised bytes on purpose, so a working tree under `core.autocrlf=true` does not read as wholly drifted. A plain `md5sum` will tell you a file has drifted when only its line endings differ. Use `node scripts/check-vendored.mjs` from the portal root, or `tr -d '\r' | sha256sum`.
- **A NEW module is a hand-off the drift table cannot warn you about.** A file nobody has listed is in neither the manifest nor the portal tree, so it is not a row in either direction. `requireScan()` covers this now, but if you add a module that a vendored generator requires, write its `vendored.json` row **by hand** in the same change — `--update` only restamps rows that already exist.

Read `make-bus-leaflet/references/changing-the-engine.md` §4 before any generator change.

## The gates, and proving they can fail

Run from `make-bus-leaflet`:

```bash
npm test
```

123 tests, about a second, no network and no data tree needed. Then the three falsification harnesses, which exist because a green check nobody has watched go red proves nothing — and, since 2026-08-27, because a check that has been made *quieter* needs proving it can still go loud:

```bash
npm run test:prove-red
```

Mutates a scratch copy of `assets/` 25 ways and requires the unit suite to object.

```bash
npm run test:prove-red-gates
```

Mutates each of the five generators and requires the **byte gate** to object — one target per sheet type. This is the one that matters before a refactor, because the byte gate is the only thing guarding the five big generators at all.

```bash
npm run test:prove-s6
```

Falsifies the **S6 verification checks** — the third thing neither of the others can reach, because `verify_report.js` is a top-to-bottom script like the generators. Four of its checks were rewritten on 2026-08-27 to stop manufacturing artefacts, and quietening a check and breaking it look identical from outside: fewer findings either way. So every case comes in a **pair** — quiet on the artefact, loud on a real fault of the same kind. 22 assertions; 12 of them go red against the pre-fix engine. It seeds from the **tracked** S1/S2/S3 runs plus `redteam.json`, never from an S6 run folder, because S4/S5/S6 folders are gitignored and a fresh clone has none of them.

**Nothing may edit `assets/` in place.** Every file there is vendored and hashed; both harnesses work on temp copies for exactly that reason.

The full board, run from `make-bus-leaflet`:

```bash
node assets/status.js --buses "C:/u3a St Ives/Using AI/Buses" --portal "C:/Claude/community-bus-maps"
```

## What cannot be unit-tested, and what to do instead

Five generators are top-to-bottom scripts that read their inputs and exit at load, so nothing in them can be `require`d: `gen_internal.js` (3,933 lines), `gen_boarding.js`, `diagram_internal.js`, `gen_external_radial.js`, `gen_external_places.js` — 8,178 lines between them. The Python half has no runner at all.

**So when a generator fault needs new logic, write the new logic as a module rather than as more lines in the script.** `lane_normals.js` was created that way and was requireable and tested from the day it existed. The re-vendor is owed either way, and this way the fault arrives with a test.

**But a unit test proves the module; only a caller proves the wiring.** `lane_normals.js` carried twelve green assertions against its documented `(segs, lateral, chain)` contract while `gen_internal.js`, its only caller, passed the chain pairs concatenated into `lateral` and `[]` as the third argument. No byte gate could see it, because the drawn output was unaffected. After extracting or adding a module, check that its caller list is exactly what you think and that the call site passes what the signature says.

## Git in this repo

**Direct push to `main`**, single branch, no PRs as a matter of course. The portal is the opposite — strictly PR-per-change. Check which convention a repo uses before pushing.

`C:\u3a St Ives\.claude\skills` and `C:\Users\Peter\.claude\skills` are **separate repos with different remotes**, and it is the individual skill *folders* that are junctioned between them, not the tree. Bus and u3a skill work belongs in `C:\u3a St Ives\.claude\skills`; `git status` in the personal checkout stays quiet about it. `stamp-docs`, `token-saver`, `impeccable` and several others live only in the personal one.

Other sessions run concurrently. Stage by name, never a directory; read `git diff --cached --stat` before committing; re-check `git branch --show-current` immediately before you commit.

## House style for documents

Markdown paragraphs are **one continuous line** — never hard-wrap prose. Any script written into a document states the folder to run it from and explains every placeholder, or says there are none.
