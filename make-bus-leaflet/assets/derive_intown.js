// S2 helper — derive routes_intown_atco.json (the in-town DISPLAY subset the
// internal map draws) from routes_full_atco.json. Method (reproduces the curated
// pre-full-data sequences at buf=0, and fixes pass-through "stub" routes at buf>=1):
//   1. Use the route's CANONICAL (primary) service pattern — not minor variants
//      (e.g. a Saturday-only town loop) that would over-represent the route.
//   2. For EACH direction of that pattern, clip the chain to the town CORE (stops
//      with the town's ATCO locality prefix + explicit extra in-town stops, e.g. a
//      retail-park stop) PLUS a directional BUFFER of `buf` stops immediately beyond
//      the core boundary — so a pass-through route traces to the town EDGE in the
//      correct outbound direction(s) instead of collapsing to a 1–4 stop stub.
//   3. Concatenate the directions' clips and dedup by first occurrence (this is how
//      both one-way directions' in-town stops are unioned into one drawn path).
//   4. For a circular route (cfg.circular) append the first stop to close the loop.
// The internal generator then draws this; the existing internalZoom compression pulls
// the edge stops in toward the town. routes_full_atco.json stays the complete record.
//
// Usage: node derive_intown.js <routes_full.json> <atco2ll.json> <intown_cfg.json> <out routes_intown.json>
//   intown_cfg.json = { "prefix":"0500HSTIV", "extraCore":["0500HHOLY010"], "buf":1,
//                       "circular":["300"], "anchor":"0500HSTIV002", "maxEdgeKm":3.5 }
//   maxEdgeKm (with anchor): a BUFFER (non-core) stop is kept only if within that many
//   km of the anchor — so the directional edge stop sits at the real town edge and a
//   route with no nearby out-of-town stop (e.g. an express) doesn't draw a long spoke
//   to a village 8 km away. Core stops are always kept regardless of distance. Omit to
//   keep all buffer stops.
const fs=require('fs');
const full=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const ll=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const cfg=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
const OUT=process.argv[5];
const PREFIX=cfg.prefix, EXTRA=new Set(cfg.extraCore||[]), BUF=cfg.buf==null?1:cfg.buf;
const CIRC=new Set(cfg.circular||[]);
// optional town-edge distance cap for buffer stops
const ANC=cfg.anchor&&ll[cfg.anchor], MAXM=(cfg.maxEdgeKm||0)*1000;
const kc=ANC?Math.cos(ANC[0]*Math.PI/180):1;
const distM=a=>(!ANC||!ll[a])?0:Math.hypot((ll[a][0]-ANC[0])*111320,(ll[a][1]-ANC[1])*111320*kc);
// optional GEOGRAPHIC cap on the CORE: a prefix-matched stop farther than
// coreMaxKm from the anchor is NOT treated as core (it may still be kept as a
// buffer/edge stop, subject to maxEdgeKm). Needed where the town's NaPTAN ATCO
// block is geographically large and covers neighbouring places (e.g. Bucks
// 040000001 spans Beaconsfield + Gerrards Cross + Denham). Absent ⇒ inert
// (prefix alone defines core), so pre-existing towns stay byte-identical.
const COREM=(cfg.coreMaxKm||0)*1000;
const isCore=a=> EXTRA.has(a) || (a.startsWith(PREFIX) && (!COREM || !ANC || distM(a)<=COREM));
const farFromTown=a=>{ if(!ANC||!MAXM||!ll[a]) return false; return distM(a) > MAXM; };

function clipDir(stops){               // core stops + buf-neighborhood, in chain order
  const chain=stops.filter(a=>ll[a]); const n=chain.length;
  const keep=new Array(n).fill(false);
  for(let i=0;i<n;i++) if(isCore(chain[i])) for(let j=Math.max(0,i-BUF);j<=Math.min(n-1,i+BUF);j++) keep[j]=true;
  const out=[]; for(let i=0;i<n;i++) if(keep[i] && (isCore(chain[i]) || !farFromTown(chain[i]))) out.push(chain[i]);
  return out;
}
const intown={};
for(const route in full){
  const dirs=full[route].canonical || full[route].directions;
  const seen=new Set(), list=[];
  for(const d of dirs) for(const a of clipDir(d.stops)) if(!seen.has(a)){ seen.add(a); list.push(a); }
  if(CIRC.has(route) && list.length && list[0]!==list[list.length-1]) list.push(list[0]);
  intown[route]=list;
}
fs.writeFileSync(OUT,JSON.stringify(intown,null,1));
for(const r in intown){ const core=intown[r].filter(isCore).length;
  console.error(r.padEnd(5),'intown',String(intown[r].length).padStart(3),
    '(core',core,'+edge',intown[r].length-core+')'); }
