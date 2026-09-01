# Brief: the portal's operations and test tooling

Slice heading in the findings document: **Review 5 — the portal's operations and test tooling**.

Subject: the OPERATIONS and TEST tooling of the BusMaps.uk portal at `C:\Claude\community-bus-maps`: everything in `scripts/` (`test-*.mjs`, `prove-red-*.mjs`, `verify-*.mjs`, `deploy*.mjs`, `backup.mjs`, `deliver-map.mjs`, `import-map.mjs`, `accept-publish-batch.mjs`, `vendor-engine.mjs`, `track-engine.mjs`, `check-vendored.mjs`, `changelog-assemble.mjs`, `scripts/lib/*`, and anything added since), `engine/` (review the vendoring MECHANISM — `vendored.json` and the three scripts around it — not the generator code), `.github/workflows/`, `package.json` scripts, `CHANGELOG.d/` and the changelog assembly, `backups/`, `docs/`. Another reviewer covers `src/`; do not duplicate.

Review for:

- The test story: is `npm test` still one `&&` chain or a runner; does a failure stop the run so later reds are invisible; how long it takes; suites named after plan phases or dates rather than subjects (list them); whether every prove-red has a matching test and vice versa; which scripts need `.env` and what happens in CI without it; whether anything checks that every `test-*.mjs` is actually run.
- CLI convention across the ops scripts: argv parsing styles (count distinct ones), which mutating scripts have `--dry-run`, `--apply` or `--yes` and which have none (build the list), confirmation before destructive actions, exit codes, output format.
- Duplicated helpers across `scripts/` and between `scripts/` and `src/` (opening the DB, reading `vendored.json`, finding fixtures, CRLF-normalised hashing, `sha256`, SSH runners, finding the buses-data checkout) — count independent implementations.
- The vendoring mechanism: whether a NEW upstream module still needs a hand-written manifest row; whether `skillRootDefault` is still a laptop path in a tracked file.
- Workflows: what each runs, on what trigger, whether they duplicate `npm test`, secrets used, whether a fork or Dependabot PR can run them, how the Node version is chosen, action pinning, `concurrency:` groups, whether timings are measured or asserted in comments.
- `CHANGELOG.d`: the fragment convention and whether it is checked.
- Backups: what `backup.mjs` does, retention, whether restore is documented and when it was last drilled.

Method: sample deliberately; grep counts; read heads of files. Read `package.json` fully, all workflows fully, `vendored.json`'s shape, and `scripts/lib/*` fully.
