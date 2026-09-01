# Brief: the portal's application source

Slice heading in the findings document: **Review 4 — the portal's application source**.

Subject: the APPLICATION SOURCE of the BusMaps.uk portal at `C:\Claude\community-bus-maps` (repo community-bus-maps, Node 22+, Fastify 5, ESM, sqlite). Your scope is `src/` (every module), `views/`, `public/`, `Dockerfile`, `compose.yaml`, `Caddyfile`, and the design docs `DESIGN.md`, `PRODUCT.md`, `README.md`, `CLAUDE.md` (read those for stated conventions, then check whether the code follows them). Another reviewer covers `scripts/` and `engine/`; do not duplicate.

Review for:

- Structure: `server.js` — count route registrations, inline HTML templating, business logic; what natural seams exist; whether any routes have moved into plugins since the last run. Are `src/*/index.js` modules coherent or grab-bags?
- Standards: input validation on routes (Fastify schemas vs ad hoc `str()`/`Number()`), error handling (per-route try/catch vs `setErrorHandler`), auth guards (one guard per scope or repeated per route — count), SQL (parameterised everywhere? grep for string-built SQL), HTML escaping in server-rendered views and in email bodies (is there one escaper and is it used consistently — count the copies), secrets handling (only via `config.js`?), logging.
- Consistency: naming (camelCase vs snake_case across db columns, JS, JSON API), date handling (storage format vs consumption, count the fix-ups), how map, sheet, pack, version, update and refresh are named across modules, response shapes.
- Maintainability: dead exports, TODO/FIXME, functions over 150 lines, module coupling and any cycle, test surface (which `src` modules have a test in `scripts/test-*.mjs` and which have none), the migration story in `db/index.js` (how schema changes are applied, whether they are ordered and idempotent, whether `schema.sql` carries `CHECK` constraints and indexes).
- Ops: Dockerfile and compose sanity, `.dockerignore`, healthcheck, log rotation, anything in `Caddyfile` the app duplicates.

Method: sample deliberately. Read the head of every `src` file and the full export list; read `server.js` in 300-line windows at the start, middle and end; grep counts for the patterns above.
