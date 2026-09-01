# Brief: the data repository's own code, and cross-repository consistency

Slice heading in the findings document: **Review 6 — the data repository's own code, and cross-repository consistency**.

Subject A — the DATA repository `C:\u3a St Ives\Using AI\Buses` (repo buses-data): its own code and structure, not the map data itself. Cover `Documentation/*.mjs` (the checkers and their prove-red harnesses), `Development Docs/open-actions/assemble.mjs` and its README, `.githooks/pre-commit`, `.github/workflows/gates.yml`, `.gitignore` and `.gitattributes`, the PowerShell scripts at the root, `_gtfs/` (what is tracked vs generated, and whether tracked files are rewritten by a scheduled task that never commits), the loose files at the root (which are tracked, which are referenced by nothing, which sit outside every checker's scope), and the shape of `Areas/<Town>/` and `Places/` (is the layout uniform across all maps? sample three towns and three places and report any that deviate). Read `CLAUDE.md` here fully; it is the stated convention, and check its stated counts against the files.

Subject B — CROSS-REPOSITORY consistency across the three repos: buses-data, claude-skills (engine in `make-bus-leaflet/assets`), community-bus-maps. Other reviewers are reading each codebase's internals; your job is what only a cross-repo view can see:

- Tooling baseline: does any repo have an ESLint, Prettier, EditorConfig, ruff or pyproject config; an `engines` field; lockfile discipline; `.gitattributes`; a Node version pinned the same way? Report a three-column table.
- Module systems: count `.js` (CJS) vs `.mjs` (ESM) vs `.py` per repo, and where one repo's ESM script loads another's CJS module.
- Naming conventions across repos: kebab-case vs snake_case file names (count each per repo), and whether the rule is written anywhere.
- The three CI pipelines: what each repo's workflows run, what one repo's CI checks out of another, the dependency graph, any check that runs in a repo other than the one whose subject it tests (the OA-218 principle), and harnesses that run in two repos.
- Documentation topology: each repo's `CLAUDE.md` length, and whether they overlap or contradict on the same facts (vendored file counts, test counts, harness counts — check each stated number).
- Hardcoded laptop paths in code, per repo (exclude `Areas/` and `Places/`), and whether an env convention exists that they ignore.
- Version and stamp schemes, and whether any is derivable from another.
- Shared concepts named differently across repos (town/area/place/map/sheet/pack/version/update/run/stage), with examples and glossary rows.
