// S2 helper — ensure atco2ll.json + atco2name.json cover EVERY stop in the full
// chains (routes_full's _all_atco.json), so the complete route+stop record has
// ATCO + name + lat/lon for every stop, not just in-town ones. Two sources:
//   1. OpenStreetMap Overpass: node[highway=bus_stop]["naptan:AtcoCode"] in a bbox
//      covering all termini (S,W,N,E). Sent with a User-Agent (else 406).
//   2. bustimes.org stop pages for any ATCO OSM lacks a NaPTAN node for — the map
//      centre coord appears as #15/<lat>/<lon> ('/'-separated) and the name in <h1>.
// Existing entries are kept; only missing ones are added. Coords rounded to 6 dp.
//
// Usage: node backfill_coords.js <_all_atco.json> <S,W,N,E> <atco2ll.json> <atco2name.json>
//   (atco2ll/atco2name are read if present and updated in place; pass paths in the S2 dir.)
const fs=require('fs');
const UA='make-bus-leaflet/1.0 (bus leaflet project)';
const ALL=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const BBOX=process.argv[3];                 // "south,west,north,east"
const LLF=process.argv[4], NMF=process.argv[5];
const rd=f=>{ try{ return JSON.parse(fs.readFileSync(f,'utf8')); }catch(e){ return {}; } };
const ll=rd(LLF), nm=rd(NMF);

async function overpass(){
  const q=`[out:json][timeout:180];node[highway=bus_stop]["naptan:AtcoCode"](${BBOX});out;`;
  for(const host of ['overpass-api.de','overpass.kumi.systems']){
    for(let t=0;t<3;t++){ try{
      const r=await fetch('https://'+host+'/api/interpreter',{method:'POST',
        headers:{'User-Agent':UA,'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},
        body:'data='+encodeURIComponent(q)});
      if(r.ok){ const j=await r.json(); if(j.elements&&j.elements.length) return j; }
    }catch(e){} await new Promise(r=>setTimeout(r,1500)); }
  }
  throw new Error('overpass failed');
}
async function bustimesStop(a){
  for(let t=0;t<3;t++){ try{
    const r=await fetch('https://bustimes.org/stops/'+a,{headers:{'User-Agent':UA}});
    if(r.ok){ const h=await r.text();
      const m=h.match(/#1[0-9]\/(-?\d+\.\d+)\/(-?\d+\.\d+)/);
      const name=((h.match(/<h1[^>]*>([^<]+)/)||[])[1]||'').replace(/\s+/g,' ').trim();
      if(m) return {ll:[+(+m[1]).toFixed(6),+(+m[2]).toFixed(6)], name}; }
  }catch(e){} await new Promise(r=>setTimeout(r,600)); }
  return null;
}
(async()=>{
  const j=await overpass();
  const omap={},onm={};
  for(const e of j.elements){ const a=e.tags&&e.tags['naptan:AtcoCode']; if(!a)continue;
    omap[a]=[+e.lat.toFixed(6),+e.lon.toFixed(6)];
    onm[a]=e.tags.name||e.tags['naptan:CommonName']||''; }
  let addOsm=0;
  for(const a of ALL){ if(!ll[a] && omap[a]){ ll[a]=omap[a]; if(!nm[a]) nm[a]=onm[a]; addOsm++; } }
  const miss=ALL.filter(a=>!ll[a]);
  let addBt=0;
  for(const a of miss){ const s=await bustimesStop(a); process.stderr.write(s?'.':'x');
    if(s){ ll[a]=s.ll; if(!nm[a]) nm[a]=s.name; addBt++; } }
  fs.writeFileSync(LLF, JSON.stringify(ll));
  fs.writeFileSync(NMF, JSON.stringify(nm));
  const stillMiss=ALL.filter(a=>!ll[a]);
  console.error('\nOSM elements',j.elements.length,'| added: OSM',addOsm,'bustimes',addBt,
    '| coverage',ALL.length-stillMiss.length,'/',ALL.length,
    stillMiss.length?('| STILL MISSING '+stillMiss.join(' ')):'');
})();
