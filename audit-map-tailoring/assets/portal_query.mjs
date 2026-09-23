#!/usr/bin/env node
// portal_query.mjs — print the ONE command Peter runs to read the live portal's
// customer edits, read-only. It runs nothing itself.
//
//   node portal_query.mjs [--portal <portal checkout>]
//
// Why Peter runs it: the live database is on the VPS, and a session's ssh is refused
// (correctly — see the memory "The portal means the VPS"). The laptop's own
// portal.sqlite is seeded with demo rows that read exactly like real customers and
// must never be read in its place.
//
// The query opens /data/portal.sqlite with {readOnly: true} and prints, as one JSON
// line per map version, every version that carries overrides or a note: slug, kind,
// status, owning customer, version, review state, date, note, the overrides snapshot,
// and whether the version came from an accepted data refresh — then a total line.
// It is base64-encoded so no quote survives into PowerShell or ssh to be mangled.
// Output: the command on stdout. Exit 0; 2 on misuse.
import path from 'node:path';
import { createRequire } from 'node:module';
import { ENGINE, parseArgs, die } from './lib.mjs';

const require = createRequire(import.meta.url);
const { resolvePortal } = require(path.join(ENGINE, 'cli.js'));
const args = parseArgs(process.argv.slice(2));
if (args.help) die('usage: node portal_query.mjs [--portal <portal checkout>]', 0);
const portal = resolvePortal(args);

const js = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/portal.sqlite',{readOnly:true});
const rows=db.prepare("SELECT m.slug,m.kind,m.status,c.name AS customer,v.major||'.'||v.minor AS ver,v.review_state AS state,v.created_at AS at,v.note,v.overrides_json AS ov,v.data_change_json IS NOT NULL AS refresh FROM map m LEFT JOIN customer c ON c.id=m.customer_id JOIN map_version v ON v.map_id=m.id ORDER BY m.slug,v.id").all();
for(const r of rows){ if(r.ov==='{}'&&!r.note)continue; console.log(JSON.stringify(r)); }
console.log('TOTAL maps', db.prepare('SELECT count(*) n FROM map').get().n, 'versions', rows.length);
`;
const b64 = Buffer.from(js).toString('base64');
console.log(`npm --prefix "${portal.split('/').join('\\')}" run ssh -- "echo ${b64} | base64 -d | docker compose exec -T portal node -"`);
