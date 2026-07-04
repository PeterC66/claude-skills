// S2 helper — pull each route's COMPLETE ordered stop list to terminus, BOTH
// directions, from bustimes.org service pages. A route may have several bustimes
// sub-services (e.g. 301 + 301V + 301S + 301X) — they merge per direction in
// first-appearance order, and the FIRST slug is kept as the route's "canonical"
// (primary) pattern (used by derive_intown.js so minor variants don't over-draw a
// route in town). Output is the complete stored record; derive_intown.js makes the
// display subset from it.
//
// Output: routes_full_atco.json =
//   { "<route>": { directions:[{name,stops:[ATCO,…]}],   // merged across all sub-services
//                  canonical:[{name,stops:[ATCO,…]}],     // FIRST slug only (primary pattern)
//                  all:[ATCO,…] } }                       // union, outbound-first, deduped
//   plus _all_atco.json (the union ATCO set, for backfill_coords.js) and svc_<slug>.html.
//
// Usage: node pull_routes_full.js <route_slugs.json> <outDir>
//   route_slugs.json = { "<route>": ["<slug1>","<slug2>",…], … }
//   (slugs from the bustimes locality page: curl -sA UA <localityURL> | grep -oE '/services/[a-z0-9-]+')
const fs=require('fs'), path=require('path');
const UA='make-bus-leaflet/1.0 (bus leaflet project)';
const SLUGS=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const OUT=process.argv[3]; fs.mkdirSync(OUT,{recursive:true});

async function getHtml(slug){
  const url='https://bustimes.org/services/'+slug;
  for(let t=0;t<4;t++){
    try{ const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html'}});
      if(r.ok) return await r.text(); }catch(e){}
    await new Promise(r=>setTimeout(r,800*(t+1)));
  }
  throw new Error('fetch failed '+slug);
}
// Parse a service page into per-direction ordered ATCO lists. bustimes direction
// headers are <h2>Place A - Place B</h2> or <h2>Place A to Place B</h2>. EXCLUDE the
// operator h2 (itemprop="name") and the "Possibly similar services" h2, and stop
// collecting stops at the first such non-direction h2 (links after it belong to
// OTHER services). Some circulars have a single (unsplit) list.
function parseDirs(html){
  const h2Re=/<h2([^>]*)>([^<]*)<\/h2>/gi; const dirs=[]; let m; let cutoff=1e18;
  while((m=h2Re.exec(html))){
    const attrs=m[1]||'', txt=m[2].replace(/\s+/g,' ').trim();
    const isOperator=/itemprop\s*=\s*["']name["']/i.test(attrs);
    const isSimilar=/possibly similar/i.test(txt);
    const isDirection=!isOperator && !isSimilar && /\s(-|to)\s/.test(txt) && txt.length>4;
    if(isDirection){ dirs.push({pos:m.index, name:txt}); }
    else if((isOperator||isSimilar) && m.index<cutoff && dirs.length){ cutoff=m.index; }
  }
  const stopRe=/\/stops\/(0500[0-9A-Z]+)/g; const stops=[];
  while((m=stopRe.exec(html))){ if(m.index<cutoff) stops.push({pos:m.index, atco:m[1]}); }
  if(!dirs.length){
    const seen=new Set(), list=[]; for(const s of stops) if(!seen.has(s.atco)){seen.add(s.atco);list.push(s.atco);}
    return [{name:'(single)', stops:list}];
  }
  const res=[];
  for(let i=0;i<dirs.length;i++){ const lo=dirs[i].pos, hi=i+1<dirs.length?dirs[i+1].pos:cutoff;
    const seen=new Set(), list=[];
    for(const s of stops) if(s.pos>lo&&s.pos<hi && !seen.has(s.atco)){seen.add(s.atco);list.push(s.atco);}
    if(list.length) res.push({name:dirs[i].name, stops:list});
  }
  return res;
}
function mergeDirs(perSub){            // merge sub-services' direction lists by direction-name, in order
  const byName={}; const orderNames=[];
  for(const dirs of perSub) for(const d of dirs){
    if(!byName[d.name]){ byName[d.name]={name:d.name, seen:new Set(), stops:[]}; orderNames.push(d.name); }
    const slot=byName[d.name];
    for(const a of d.stops) if(!slot.seen.has(a)){ slot.seen.add(a); slot.stops.push(a); }
  }
  return orderNames.map(n=>({name:byName[n].name, stops:byName[n].stops}));
}

(async()=>{
  const full={}; const allAtco=new Set();
  for(const route of Object.keys(SLUGS)){
    const perSub=[];
    for(const slug of SLUGS[route]){
      const html=await getHtml(slug);
      fs.writeFileSync(path.join(OUT,'svc_'+slug+'.html'), html);
      perSub.push(parseDirs(html));
      process.stderr.write('.');
    }
    const directions=mergeDirs(perSub);
    const canonical=perSub[0];
    const seen=new Set(), all=[];
    for(const d of directions) for(const a of d.stops) if(!seen.has(a)){seen.add(a);all.push(a);}
    full[route]={directions, canonical, all};
    for(const a of all) allAtco.add(a);
    process.stderr.write(' '+route+'('+directions.map(d=>d.stops.length).join('/')+') ');
  }
  fs.writeFileSync(path.join(OUT,'routes_full_atco.json'), JSON.stringify(full,null,1));
  fs.writeFileSync(path.join(OUT,'_all_atco.json'), JSON.stringify([...allAtco].sort(),null,0));
  console.error('\nroutes:',Object.keys(full).length,'unique stops:',allAtco.size);
})();
